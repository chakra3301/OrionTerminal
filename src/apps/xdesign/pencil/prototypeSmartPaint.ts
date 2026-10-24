import type { DesignMotion } from './reactExportRuntime';
export function currentSmartPaint(element: HTMLElement, property: 'backgroundColor' | 'color' | 'fill'): string | undefined {
  const paints = [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-xdesign-motion-paint'));
  if (paints.length > 1) return;
  const paint = paints[0] ?? element;
  const opacity = Number.parseFloat(getComputedStyle(paint).opacity); if (paints.length && Number.isFinite(opacity) && opacity !== 1) return;
  if (property === 'fill') { const fills = [...paint.querySelectorAll<SVGElement>('svg [fill]')].filter(element => element.getAttribute('fill') !== 'none' && !element.closest('defs,clipPath')); if (!fills.length) return; const values = fills.map(element => getComputedStyle(element).fill || element.getAttribute('fill')); return values.every(value => value === values[0]) ? values[0] ?? undefined : undefined; }
  if (property === 'backgroundColor' && paint.querySelector('img,video,svg') || property === 'color' && paint.querySelector('img,video,svg')) return;
  return getComputedStyle(paint)[property];
}
export function smartPaintColor(paint: DesignMotion['paints'][number]): string {
  return `rgba(${paint.color.slice(0, 3).map(value => Math.round(Math.max(0, Math.min(1, value)) * 255)).join(',')},${Math.max(0, Math.min(1, paint.color[3] * paint.opacity))})`;
}
export function smartSolidVector(paint: HTMLElement): SVGElement[] | undefined {
  const image = paint.querySelector<HTMLImageElement>(':scope > img'), source = image?.getAttribute('src'), prefix = 'data:image/svg+xml;charset=utf-8,';
  if (!source?.startsWith(prefix) || source.length > 4 * 1024 * 1024) return;
  try {
    const document = new DOMParser().parseFromString(decodeURIComponent(source.slice(prefix.length)), 'image/svg+xml'), svg = document.documentElement;
    if (svg.localName !== 'svg' || document.querySelector('parsererror,[id],[clip-path],[mask]') || [...svg.querySelectorAll('[stroke]')].some(element => element.getAttribute('stroke') !== 'none')) return;
    const allowed = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'clipPath']);
    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      if (!allowed.has(element.localName)) return;
      for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name) || /href$/i.test(attribute.name) || /url\(\s*[^#]/i.test(attribute.value)) return;
    }
    const imported = window.document.importNode(svg, true) as unknown as SVGSVGElement, fills = [...imported.querySelectorAll<SVGElement>('[fill]')].filter(element => element.getAttribute('fill') !== 'none' && !element.closest('defs,clipPath'));
    if (!fills.length) return;
    Object.assign(imported.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' }); image!.replaceWith(imported); return fills;
  } catch { return; }
}
