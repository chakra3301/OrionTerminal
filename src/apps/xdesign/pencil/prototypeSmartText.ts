import { smartColorTween } from './prototypeSmartColor';
import type { SmartMotionTrack } from './prototypeSmartMotion';

export const smartTextProperties = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variation-settings', 'font-feature-settings', 'font-kerning', 'font-optical-sizing', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness', 'text-decoration-skip-ink', 'text-underline-offset', 'white-space', 'direction', 'writing-mode'] as const;
type Run = { start: number; end: number; text: string; style: Record<string, string>; lang: string };
type Segment = { text: string; style: Record<string, string>; lang: string; frame: (progress: number) => Keyframe };
export type SmartTextPlan = { segments: number; apply: (paint: HTMLElement) => SmartMotionTrack[] };
const numericProperties: ReadonlyMap<string, readonly [number, number]> = new Map([['font-size', [0.0001, Infinity]], ['font-weight', [1, 1000]], ['line-height', [0, Infinity]], ['letter-spacing', [-Infinity, Infinity]], ['word-spacing', [-Infinity, Infinity]], ['text-decoration-thickness', [0, Infinity]], ['text-underline-offset', [-Infinity, Infinity]]]);
function textRoot(element: HTMLElement): HTMLElement | undefined {
  const paints = [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-xdesign-motion-paint'));
  if (paints.length > 1) return;
  if (!paints.length) return element;
  const opacity = getComputedStyle(paints[0]!).opacity;
  return !opacity || Number(opacity) === 1 ? paints[0] : undefined;
}
function runs(element: HTMLElement): Run[] | undefined {
  const root = textRoot(element); if (!root) return;
  const result: Run[] = [], pending: { node: Node; depth: number }[] = [{ node: root, depth: 0 }]; let length = 0, nodes = 1;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth > 128) return;
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      const text = node.textContent, parent = node.parentElement!, computed = getComputedStyle(parent);
      if (computed.visibility === 'hidden' || computed.display === 'none') return;
      const style = Object.fromEntries(smartTextProperties.map(property => [property, computed.getPropertyValue(property)]));
      const lang = parent.closest('[lang]')?.getAttribute('lang') ?? '';
      result.push({ start: length, end: length + text.length, text, style, lang }); length += text.length;
      if (result.length > 20000 || length > 1024 * 1024) throw new Error('This Smart Animate text exceeds the 20,000-run or 1,048,576-character text allowance.');
    } else if (node instanceof HTMLElement) {
      if (node !== root && (node.localName !== 'span' || node.hasAttribute('data-xdesign-motion'))) return;
      const style = getComputedStyle(node);
      if (node !== root && (style.transform && style.transform !== 'none' || style.opacity && Number(style.opacity) !== 1 || style.position && style.position !== 'static' || style.display && !['inline', 'contents'].includes(style.display))) return;
      nodes += node.childNodes.length; if (nodes > 40001) throw new Error('This Smart Animate text exceeds the 40,001-node text allowance.');
      const children = [...node.childNodes]; for (let index = children.length - 1; index >= 0; index--) pending.push({ node: children[index]!, depth: depth + 1 });
    } else if (node.nodeType !== Node.COMMENT_NODE) return;
  }
  return result;
}
function numeric(property: string, value: string): number | undefined {
  if (property === 'font-weight' && ['normal', 'bold'].includes(value)) return value === 'bold' ? 700 : 400;
  if (['letter-spacing', 'word-spacing'].includes(property) && value === 'normal') return 0;
  if (property === 'line-height' && value !== '0' && !value.endsWith('px')) return;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(value)) return;
  const result = Number.parseFloat(value); return Number.isFinite(result) ? result : undefined;
}
function axes(value: string): Map<string, number> | undefined {
  if (!value || value === 'normal') return new Map();
  const result = new Map<string, number>();
  for (const part of value.split(',')) { const match = /^\s*['"]([\x20-\x7e]{4})['"]\s+([+-]?(?:\d+\.?\d*|\.\d+))\s*$/.exec(part); if (!match || result.has(match[1]!) || !Number.isFinite(Number(match[2]))) return; result.set(match[1]!, Number(match[2])); }
  return result;
}
function tween(a: Run, b: Run): ((progress: number) => Keyframe) | undefined {
  if (a.lang !== b.lang) return;
  const properties: [string, (progress: number) => string | number][] = [];
  for (const property of smartTextProperties) {
    const from = a.style[property]!, to = b.style[property]!, camel = property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (from === to) continue;
    if (property === 'color' || property === 'text-decoration-color') {
      const color = smartColorTween(from === 'currentcolor' ? a.style.color! : from, to === 'currentcolor' ? b.style.color! : to); if (!color) return; properties.push([camel, color]);
    } else if (numericProperties.has(property)) {
      const left = numeric(property, from), right = numeric(property, to); if (left === undefined || right === undefined) return;
      const [minimum, maximum] = numericProperties.get(property)!;
      properties.push([camel, p => { if (p === 0) return from; if (p === 1) return to; const value = Number(Math.max(minimum, Math.min(maximum, left + (right - left) * p)).toFixed(6)); return property === 'font-weight' ? value : `${value}px`; }]);
    } else if (property === 'font-variation-settings') {
      const left = axes(from), right = axes(to); if (!left || !right || left.size !== right.size || [...left.keys()].some(key => !right.has(key))) return;
      properties.push([camel, p => p === 0 ? from : p === 1 ? to : [...left].map(([key, value]) => `${JSON.stringify(key)} ${Number((value + (right.get(key)! - value) * p).toFixed(6))}`).join(', ') || 'normal']);
    } else return;
  }
  return progress => { if (!Number.isFinite(progress)) throw new Error('Choose a finite Smart Animate text position.'); return Object.fromEntries(properties.map(([property, value]) => [property, value(progress)])); };
}
export function planSmartText(from: HTMLElement, to: HTMLElement): SmartTextPlan | undefined {
  const source = runs(from), target = runs(to); if (!source?.length || !target?.length) return;
  const text = source.map(run => run.text).join(''); if (text !== target.map(run => run.text).join('')) return;
  const boundaries = [...new Set([...source, ...target].flatMap(run => [run.start, run.end]))].sort((a, b) => a - b);
  if (boundaries.length > 20001) throw new Error('This Smart Animate text exceeds the 20,000-segment allowance.');
  const segments: Segment[] = []; let old = 0, next = 0;
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]!, end = boundaries[index + 1]!;
    if (start && /[\uD800-\uDBFF]/.test(text[start - 1]!) && /[\uDC00-\uDFFF]/.test(text[start]!)) return;
    while (source[old]!.end <= start) old++; while (target[next]!.end <= start) next++;
    const a = source[old]!, b = target[next]!, frame = tween(a, b); if (!frame) return;
    segments.push({ text: text.slice(start, end), style: b.style, lang: b.lang, frame });
  }
  return { segments: segments.length, apply: paint => {
    paint.replaceChildren();
    return segments.map(segment => {
      const element = segments.length === 1 ? paint : document.createElement('span');
      for (const [property, value] of Object.entries(segment.style)) if (value) element.style.setProperty(property, value);
      if (segment.lang) element.lang = segment.lang; else element.removeAttribute('lang');
      element.textContent = segment.text; if (element !== paint) { element.setAttribute('data-xdesign-motion-text', ''); paint.append(element); }
      return { element, sampled: true, frame: segment.frame };
    });
  } };
}

export function copySmartTextStyles(source: HTMLElement, copy: HTMLElement) {
  const nodes = [source, ...source.querySelectorAll<HTMLElement>('*')], clones = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  nodes.forEach((node, index) => {
    const text = node.hasAttribute('data-xdesign-motion-text') || node.hasAttribute('data-xdesign-motion-paint') || [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent);
    if (!text || !node.closest('[data-xdesign-motion]')) return;
    const style = getComputedStyle(node), clone = clones[index]!;
    for (const property of smartTextProperties) { const value = style.getPropertyValue(property); if (value) clone.style.setProperty(property, value); }
  });
}
