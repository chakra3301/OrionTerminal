import type { DesignNavigation } from './reactExportRuntime';
import { captureSmartLayers, savedSmartLayers, smartComputedMatrix, type SmartLayerSnapshot } from './prototypeSmartSnapshot';
import { smartCss, smartGeometryCompatible, smartIdentity, smartInverse, smartMultiply, smartWorldAt, type SmartMatrix, type SmartPose } from './prototypeSmartGeometry';
import { currentSmartPaint, smartPaintColor, smartSolidVector } from './prototypeSmartPaint';
import { smartColorTween } from './prototypeSmartColor';
import { planSmartText, smartTextProperties, type SmartTextPlan } from './prototypeSmartText';
import type { NativePaintContext, NativePaintPlan } from './prototypeNativePaint';

export type SmartMotionTrack = { element: HTMLElement | SVGElement; frame: (progress: number) => Keyframe; sampled?: boolean; apply?: (progress: number) => void };
type Matched = { from: SmartLayerSnapshot; to: SmartLayerSnapshot; text?: SmartTextPlan; native?: NativePaintPlan; world: (progress: number) => SmartMatrix };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const interpolate = (from: number, to: number, progress: number) => from + (to - from) * progress;
const paintProperties = ['background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', 'color'] as const;
function ownChildren(element: HTMLElement) {
  return [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE || node instanceof HTMLElement && !node.hasAttribute('data-xdesign-motion') && !node.querySelector('[data-xdesign-motion]') && !node.hasAttribute('data-xdesign-scene-covered') && !node.hasAttribute('data-xdesign-content-clip') && !node.hasAttribute('data-xdesign-scroll') && !node.hasAttribute('data-xdesign-snapshot-scroll') && !node.hasAttribute('data-xdesign-fixed'));
}
function ownPaint(element: HTMLElement) {
  const paint = element.cloneNode(false) as HTMLElement, computed = getComputedStyle(element);
  for (const property of [...paintProperties, ...smartTextProperties, 'border-radius']) paint.style.setProperty(property, computed.getPropertyValue(property));
  for (const child of ownChildren(element)) paint.append(child.cloneNode(true));
  for (const video of paint.querySelectorAll('video')) { const poster = document.createElement('img'); poster.src = video.poster; poster.alt = ''; poster.style.cssText = video.style.cssText; video.replaceWith(poster); }
  for (const node of [paint, ...paint.querySelectorAll<HTMLElement>('*')]) {
    for (const attribute of [...node.attributes]) if (attribute.name === 'id' || attribute.name === 'tabindex' || attribute.name.startsWith('data-xdesign-')) node.removeAttribute(attribute.name);
  }
  Object.assign(paint.style, { position: 'absolute', inset: '0', left: '0', top: '0', width: '100%', height: '100%', margin: '0', transform: 'none', transformOrigin: '0 0', opacity: '1', pointerEvents: 'none' });
  paint.setAttribute('data-xdesign-motion-paint', ''); paint.setAttribute('aria-hidden', 'true'); paint.setAttribute('inert', '');
  return paint;
}
function paintIdentity(element: HTMLElement) {
  const style = getComputedStyle(element);
  return JSON.stringify([[...paintProperties, ...smartTextProperties].map(property => style.getPropertyValue(property)), ownChildren(element).map(node => node instanceof HTMLElement ? node.outerHTML : node.textContent)]);
}
function paintTracks(from: SmartLayerSnapshot, to: SmartLayerSnapshot, tracks: SmartMotionTrack[], restore: (() => void)[], omit = false, text?: SmartTextPlan, native?: NativePaintPlan) {
  const target = to.element;
  if (!omit && !native && paintIdentity(from.element) === paintIdentity(target)) return;
  const oldPaint = omit ? undefined : ownPaint(from.element), newPaint = omit ? undefined : ownPaint(target), children = ownChildren(target).filter((node): node is HTMLElement => node instanceof HTMLElement), visibility = children.map(child => child.style.visibility);
  const properties = ['background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', ...(to.motion.type === 'TEXT' ? ['color'] : [])], styles = properties.map(property => ({ property, value: target.style.getPropertyValue(property), priority: target.style.getPropertyPriority(property) }));
  target.style.backgroundColor = 'transparent'; target.style.backgroundImage = 'none'; for (const property of ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color']) target.style.setProperty(property, 'transparent'); target.style.boxShadow = 'none';
  if (to.motion.type === 'TEXT') target.style.color = 'transparent';
  const applied = properties.map(property => target.style.getPropertyValue(property));
  // A control may update its own style during playback; undo only our still-current overrides.
  restore.push(() => { styles.forEach(({ property, value, priority }, index) => { if (target.style.getPropertyValue(property) === applied[index]) { if (value) target.style.setProperty(property, value, priority); else target.style.removeProperty(property); } }); children.forEach((child, index) => { if (child.style.visibility === 'hidden') child.style.visibility = visibility[index]!; }); oldPaint?.remove(); newPaint?.remove(); });
  children.forEach(child => { child.style.visibility = 'hidden'; });
  if (!oldPaint || !newPaint) return;
  Object.assign(oldPaint.style, { width: `${from.pose.width}px`, height: `${from.pose.height}px`, transform: `scale(${to.pose.width / from.pose.width},${to.pose.height / from.pose.height})` });
  target.prepend(oldPaint, newPaint);
  const sameEdges = paintProperties.filter(property => !['background-color', 'color'].includes(property)).every(property => getComputedStyle(from.element).getPropertyValue(property) === newPaint!.style.getPropertyValue(property));
  const oldFlatColor = currentSmartPaint(from.element, 'backgroundColor');
  const composed = from.motion.composition === 'scene' || to.motion.composition === 'scene';
  const flat = !composed && oldFlatColor !== undefined && sameEdges && from.motion.paints.length === 1 && to.motion.paints.length === 1 && from.motion.paints[0]!.type === 'SOLID' && to.motion.paints[0]!.type === 'SOLID' && ownChildren(from.element).every(child => child instanceof HTMLElement && child.hasAttribute('data-xdesign-motion-paint')) && !ownChildren(target).filter(child => child !== oldPaint && child !== newPaint).length;
  const flatTween = flat ? smartColorTween(oldFlatColor!, newPaint.style.backgroundColor) : undefined;
  const vectorTween = !composed && from.motion.paints.length === 1 && to.motion.paints.length === 1 && from.motion.paints[0]!.type === 'SOLID' && to.motion.paints[0]!.type === 'SOLID' && from.motion.paints[0]!.blend === 'NORMAL' && to.motion.paints[0]!.blend === 'NORMAL' && (currentSmartPaint(from.element, 'fill') !== undefined || !from.element.querySelector('[data-xdesign-motion-paint]')) ? smartColorTween(currentSmartPaint(from.element, 'fill') ?? smartPaintColor(from.motion.paints[0]!), smartPaintColor(to.motion.paints[0]!)) : undefined;
  if (native) {
    const attached = native.attach(newPaint); restore.push(attached.dispose); oldPaint.remove(); tracks.push(attached.track);
  } else if (text) {
    oldPaint.remove(); tracks.push(...text.apply(newPaint));
  } else if (flatTween) {
    oldPaint.remove(); tracks.push({ element: newPaint, sampled: true, frame: p => ({ backgroundColor: flatTween(p) }) });
  } else if (vectorTween && smartSolidVector(newPaint)) {
    oldPaint.remove();
    for (const element of newPaint.querySelectorAll<SVGElement>('[fill]')) if (element.getAttribute('fill') !== 'none' && !element.closest('defs,clipPath')) tracks.push({ element, sampled: true, frame: p => ({ fill: vectorTween(p), fillOpacity: 1 }) });
  } else {
    tracks.push({ element: oldPaint, frame: p => ({ opacity: 1 - clamp(p) }) }, { element: newPaint, frame: p => ({ opacity: clamp(p) }) });
  }
}
function shifted(pose: SmartPose, x: number, y: number): SmartMatrix { return smartMultiply([1, 0, 0, 1, x, y], pose.matrix); }
function directional(link: DesignNavigation, size: { width: number; height: number }, incoming: boolean, fixed: boolean) {
  const [x, y] = link.direction === 'left' ? [-size.width, 0] : link.direction === 'top' ? [0, -size.height] : link.direction === 'bottom' ? [0, size.height] : [size.width, 0];
  if (fixed || link.transition === 'smart') return { x: 0, y: 0, fade: true };
  if (incoming) return { x: link.transition === 'move-out' ? 0 : x! * (link.transition === 'slide-out' ? -0.25 : 1), y: link.transition === 'move-out' ? 0 : y! * (link.transition === 'slide-out' ? -0.25 : 1), fade: link.transition === 'slide-out' };
  const factor = link.transition === 'move-in' ? 0 : link.transition === 'slide' ? -0.25 : link.transition === 'push' ? -1 : 1;
  return { x: x! * factor, y: y! * factor, fade: link.transition === 'slide' };
}

export function prepareSmartMotion(surface: HTMLElement, incoming: HTMLElement, outgoing: HTMLElement, link: DesignNavigation, nativePaints?: NativePaintContext): { tracks: SmartMotionTrack[]; movement: (key?: string) => { x: number; y: number } | undefined; restore: () => void } | undefined {
  const old = savedSmartLayers(outgoing), next = captureSmartLayers(surface).filter(state => incoming.contains(state.element));
  if (!old.length || !next.length) return;
  const previous = new Map(old.map(state => [state.key, state])), destination = new Map(next.map(state => [state.key, state])), matches = new Map<string, Matched>(), unsupported = new Set<string>(), tracks: SmartMotionTrack[] = [], restorations: (() => void)[] = [];
  const ancestors = (state: SmartLayerSnapshot, states: Map<string, SmartLayerSnapshot>, blocked: Set<string>) => { let key = state.parent, depth = 0; while (key) { if (++depth > 128) throw new Error('This Smart Animate hierarchy exceeds 128 levels.'); if (blocked.has(key)) return true; key = states.get(key)?.parent; } return false; };
  const layout = (state: SmartLayerSnapshot, parent: Matched | undefined) => {
    const base = smartComputedMatrix(getComputedStyle(state.element).transform); if (!base) throw new Error('This layer needs a dissolve for its 3D transform.');
    return smartMultiply(smartInverse(parent?.to.pose.matrix ?? smartIdentity()), smartMultiply(state.pose.matrix, smartInverse(base)));
  };
  const size = { width: surface.clientWidth || Number.parseFloat(surface.style.width) || 100, height: surface.clientHeight || Number.parseFloat(surface.style.height) || 100 };
  let textSegments = 0;
  try {
    for (const state of next) {
      const from = previous.get(state.key);
      if (!from || ancestors(state, destination, unsupported)) { unsupported.add(state.key); continue; }
      if (from.motion.type !== state.motion.type || from.motion.shape !== state.motion.shape || !smartGeometryCompatible(from.pose, state.pose)) { unsupported.add(state.key); continue; }
      if (from.motion.composition !== state.motion.composition) { unsupported.add(state.key); continue; }
      const fixed = !!state.element.closest('[data-xdesign-fixed]') && !!from.element.closest('[data-xdesign-fixed]');
      const native = !(link.matchLayers && fixed) && state.motion.composition !== 'scene' ? nativePaints?.plan(from, state) : undefined;
      if ((from.motion.shadow || state.motion.shadow) && !native && state.motion.composition !== 'scene') { unsupported.add(state.key); continue; }
      // Resizing a flow box would move siblings beyond their captured placement matrices.
      const textBox = state.motion.type === 'TEXT' && (from.pose.width === state.pose.width && from.pose.height === state.pose.height || [from.element, state.element].every(element => ['absolute', 'fixed'].includes(getComputedStyle(element).position)));
      const text = !(link.matchLayers && fixed) && state.motion.type === 'TEXT' && textBox ? planSmartText(from.element, state.element) : undefined;
      textSegments += text?.segments ?? 0; if (textSegments > 20000) throw new Error('This Smart Animate transition exceeds the 20,000-text-segment allowance.');
      // Text reflows inside its interpolated box; scaling its glyphs as well would apply size changes twice.
      const fromPose = text ? { ...from.pose, width: state.pose.width, height: state.pose.height } : from.pose;
      matches.set(state.key, { from, to: state, text, native, world: p => link.matchLayers && fixed ? state.pose.matrix : smartWorldAt(fromPose, state.pose, p) });
    }
    if (!matches.size) return;
    for (const state of next) {
      if (ancestors(state, destination, unsupported)) continue;
      const match = matches.get(state.key), parent = state.parent ? matches.get(state.parent) : undefined, placement = layout(state, parent), target = state.element, origin = target.style.transformOrigin;
      target.style.transformOrigin = '0 0'; restorations.push(() => { target.style.transformOrigin = origin; });
      if (match) {
        const fixed = link.matchLayers && !!target.closest('[data-xdesign-fixed]') && !!match.from.element.closest('[data-xdesign-fixed]');
        tracks.push({ element: target, sampled: true, frame: p => ({ transform: smartCss(smartMultiply(smartInverse(placement), smartMultiply(smartInverse(parent?.world(p) ?? smartIdentity()), match.world(p)))), ...(match.text ? { width: `${Math.max(0.0001, interpolate(match.from.pose.width, state.pose.width, p))}px`, height: `${Math.max(0.0001, interpolate(match.from.pose.height, state.pose.height, p))}px` } : {}), opacity: fixed ? state.pose.opacity : clamp(interpolate(match.from.pose.opacity, state.pose.opacity, p)), borderRadius: state.motion.radii.map((radius, index) => `${fixed ? radius : Math.max(0, interpolate(match.from.pose.radii?.[index] ?? match.from.motion.radii[index] ?? 0, radius, p))}px`).join(' ') }) });
        const omit = !!link.matchLayers && state.motion.root && ['slide', 'slide-out', 'move-in', 'move-out'].includes(link.transition);
        if (!fixed) paintTracks(match.from, state, tracks, restorations, omit, match.text, match.native);
      } else {
        const motion = directional(link, size, true, !!target.closest('[data-xdesign-fixed]'));
        tracks.push({ element: target, sampled: true, frame: p => ({ transform: smartCss(smartMultiply(smartInverse(placement), smartMultiply(smartInverse(parent?.world(p) ?? smartIdentity()), shifted(state.pose, motion.x * (1 - p), motion.y * (1 - p))))), ...(motion.fade ? { opacity: clamp(p) * state.pose.opacity } : {}) }) });
      }
    }
    const removed: { state: SmartLayerSnapshot; parent?: Matched; host: HTMLElement; fixed: boolean }[] = [];
    const laterSibling = new Map<string, SmartLayerSnapshot>();
    const anchors = new Map<string, SmartLayerSnapshot>();
    for (let index = old.length - 1; index >= 0; index--) { const state = old[index]!, namespace = state.parent ?? ''; const anchor = laterSibling.get(namespace); if (anchor) anchors.set(state.key, anchor); if (matches.has(state.key)) laterSibling.set(namespace, state); }
    // Move outgoing unmatched branches into the destination's paint order; only detached clones move.
    for (const state of old) {
      if (matches.has(state.key) || state.parent && !matches.has(state.parent)) continue;
      const parent = state.parent ? matches.get(state.parent) : undefined;
      const later = anchors.get(state.key), anchor = later ? matches.get(later.key)!.to.element : undefined;
      const host = anchor?.parentElement ?? parent?.to.element ?? incoming, branch = state.element;
      const fixed = !!state.element.closest('[data-xdesign-fixed]');
      const oldParent = branch.parentElement, sibling = branch.nextSibling;
      restorations.push(() => { if (oldParent) oldParent.insertBefore(branch, sibling?.parentNode === oldParent ? sibling : null); });
      if (anchor) host.insertBefore(branch, anchor); else host.append(branch);
      branch.setAttribute('inert', ''); branch.setAttribute('aria-hidden', 'true');
      Object.assign(branch.style, { position: 'absolute', left: '0', top: '0', margin: '0', pointerEvents: 'none', transformOrigin: '0 0', width: `${state.pose.width}px`, height: `${state.pose.height}px` });
      removed.push({ state, parent, host, fixed });
    }
    const moved = removed.length ? new Map(captureSmartLayers(surface).map(state => [state.element, state])) : new Map<HTMLElement, SmartLayerSnapshot>();
    for (const { state, parent, host, fixed } of removed) {
      const branch = state.element, hostState = moved.get(branch), parentFinal = parent?.to.pose.matrix ?? smartIdentity();
      // Wrapper layout (scroll/fixed/component slots) remains in the inherited world matrix.
      const placement = host === parent?.to.element || host === incoming ? smartIdentity() : hostState ? smartMultiply(smartInverse(parentFinal), smartMultiply(hostState.pose.matrix, smartInverse(smartComputedMatrix(getComputedStyle(branch).transform) ?? smartIdentity()))) : smartIdentity();
      const motion = directional(link, size, false, fixed);
      tracks.push({ element: branch, sampled: true, frame: p => ({ transform: smartCss(smartMultiply(smartInverse(placement), smartMultiply(smartInverse(parent?.world(p) ?? smartIdentity()), shifted(state.pose, motion.x * p, motion.y * p)))), ...(motion.fade ? { opacity: (1 - clamp(p)) * state.pose.opacity } : {}) }) });
    }
    for (const fragment of outgoing.querySelectorAll<HTMLElement>('[data-xdesign-frozen-composite]')) {
      if (fragment.parentElement?.closest('[data-xdesign-frozen-composite]')) continue;
      const parent = fragment.parentElement, sibling = fragment.nextSibling, alpha = Number.parseFloat(getComputedStyle(fragment).opacity);
      restorations.push(() => { if (parent) parent.insertBefore(fragment, sibling?.parentNode === parent ? sibling : null); });
      fragment.style.left = `${(Number.parseFloat(fragment.style.left) || 0) + (Number.parseFloat(outgoing.style.left) || 0)}px`; fragment.style.top = `${(Number.parseFloat(fragment.style.top) || 0) + (Number.parseFloat(outgoing.style.top) || 0)}px`;
      const after = fragment.getAttribute('data-xdesign-frozen-composite') === 'after'; fragment.style.zIndex = after ? '2' : '-1'; if (after) incoming.append(fragment); else incoming.prepend(fragment);
      tracks.push({ element: fragment, frame: p => ({ opacity: (1 - clamp(p)) * (Number.isFinite(alpha) ? alpha : 1) }) });
    }
    outgoing.style.visibility = 'hidden';
    const movement = (key?: string) => {
      const match = key ? matches.get(key) : undefined; if (!match) return;
      if (link.matchLayers && match.to.element.closest('[data-xdesign-fixed]') && match.from.element.closest('[data-xdesign-fixed]')) return { x: 0, y: 0 };
      const from = match.from.pose, to = match.to.pose, x = to.matrix[4] - from.matrix[4], y = to.matrix[5] - from.matrix[5];
      if (x || y) return { x, y };
      const edge = (pose: SmartPose) => ({ x: pose.matrix[0] * pose.width + pose.matrix[2] * pose.height, y: pose.matrix[1] * pose.width + pose.matrix[3] * pose.height });
      const a = edge(from), b = edge(to); return { x: b.x - a.x, y: b.y - a.y };
    };
    return { tracks, movement, restore: () => { restorations.reverse().forEach(restore => restore()); } };
  } catch (error) { restorations.reverse().forEach(restore => restore()); throw error; }
}
