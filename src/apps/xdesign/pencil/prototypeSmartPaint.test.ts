import { afterEach, expect, it } from 'vitest';
import { currentSmartPaint, smartPaintColor, smartSolidVector } from './prototypeSmartPaint';
import { prepareSmartMotion } from './prototypeSmartMotion';
import { prototypeSnapshot } from './prototypeMotion';
import { selectionToDesignModel } from './reactExport';
import { createEditor } from '@open-pencil/core/editor';
import type { DesignMotion } from './reactExportRuntime';
afterEach(() => { document.body.innerHTML = ''; });
function paint(svg: string) { const root = document.createElement('div'), image = document.createElement('img'); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; root.append(image); return root; }
it('converts isolated plain vector fills while preserving geometry and combining authored fill alpha', () => {
  const root = paint('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><path d="M0 0H40V20H0Z" fill="#f00" fill-opacity="0.5"/></svg>'), fills = smartSolidVector(root)!;
  expect(fills).toHaveLength(1); expect(fills[0]!.getAttribute('d')).toBe('M0 0H40V20H0Z'); expect(root.querySelector('img')).toBeNull(); expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 40 20');
  expect(smartPaintColor({ type: 'SOLID', color: [1, 0.5, 0, 0.8], opacity: 0.5, blend: 'NORMAL' })).toBe('rgba(255,128,0,0.4)');
});
it.each(['<script>alert(1)</script>', '<foreignObject/>', '<rect fill="url(https://example.com/resource)"/>', '<rect onclick="alert(1)"/>', '<path stroke="red"/>', '<rect id="clip"/>', '<use href="#other"/>'])('keeps unsupported vector artwork in the existing image crossfade for %s', content => {
  const root = paint(`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`), original = root.innerHTML; expect(smartSolidVector(root)).toBeUndefined(); expect(root.innerHTML).toBe(original);
});
// Plain opaque rectangles now export as CSS backgroundColor, not SVG; the smoothed corners keep
// the incoming layer on the SVG artwork path this test exercises.
it('interpolates fill CSS on actual engine-exported SVG geometry without mutating the native graph', () => {
  const editor = createEditor();
  try {
    const graph = editor.graph, page = editor.state.currentPageId, old = graph.createNode('RECTANGLE', page, { name: 'Old', width: 40, height: 20, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 0.8 }, opacity: 0.5, visible: true }] }), next = graph.createNode('RECTANGLE', page, { name: 'Next', width: 80, height: 40, cornerRadius: 6, cornerSmoothing: 0.6, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }] }), surface = document.createElement('div'), incoming = document.createElement('div'), source = document.createElement('div'); surface.append(incoming); document.body.append(surface);
    for (const [node, parent] of [[old, source], [next, incoming]] as const) { const model = selectionToDesignModel(graph, [node.id]), layer = document.createElement('div'), image = document.createElement('img'); image.src = model.nodes[0]!.image!; layer.setAttribute('data-xdesign-motion', JSON.stringify({ ...model.nodes[0]!.motion, name: node.name })); Object.assign(layer.style, { width: `${node.width}px`, height: `${node.height}px` }); layer.append(image); parent.append(layer); }
    const previous = JSON.stringify([...graph.nodes]), snapshot = prototypeSnapshot(source); surface.prepend(snapshot); const prepared = prepareSmartMotion(surface, incoming, snapshot, { action: 'back', transition: 'smart', duration: 200 })!;
    const fill = prepared.tracks.find(track => track.element instanceof SVGElement)!; expect(fill.frame(0)).toMatchObject({ fill: 'rgba(255,0,0,0.4)', fillOpacity: 1 }); expect(fill.frame(0.5).fill).toBe('rgba(72.857143,0,182.142857,0.7)'); expect(fill.frame(1).fill).toBe('rgba(0,0,255,1)'); expect(JSON.stringify([...graph.nodes])).toBe(previous); prepared.restore(); expect(incoming.querySelector('svg')).toBeNull(); expect(incoming.querySelector('img')).not.toBeNull();
  } finally { editor.dispose(); }
});
it('interpolates single-run text color without a duplicate text fade when text and typography are unchanged', () => {
  const motion: DesignMotion = { version: 1, root: true, type: 'TEXT', shape: 'text', shadow: false, width: 100, height: 20, local: [1, 0, 0, 1, 0, 0], radii: [0, 0, 0, 0], paints: [] }, source = document.createElement('div'), surface = document.createElement('div'), incoming = document.createElement('div');
  for (const [parent, color] of [[source, 'red'], [incoming, 'blue']] as const) { const text = document.createElement('span'); text.textContent = 'Same'; text.style.color = color; text.setAttribute('data-xdesign-motion', JSON.stringify({ ...motion, name: color })); parent.append(text); } surface.append(incoming); document.body.append(surface); const snapshot = prototypeSnapshot(source); surface.prepend(snapshot); const prepared = prepareSmartMotion(surface, incoming, snapshot, { action: 'back', transition: 'smart', duration: 200 })!;
  const fill = prepared.tracks.find(track => track.element.hasAttribute('data-xdesign-motion-paint'))!; expect(fill.frame(0).color).toBe('rgb(255, 0, 0)'); expect(fill.frame(1).color).toBe('rgb(0, 0, 255)'); prepared.restore(); expect(incoming.textContent).toBe('Same');
});

it('reads an interrupted single SVG paint and refuses mixed or faded proxy approximations', () => {
  const element = document.createElement('div'), proxy = paint('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#f00" d="M0 0H10V10Z"/></svg>'); proxy.setAttribute('data-xdesign-motion-paint', ''); proxy.style.opacity = '1'; element.append(proxy); document.body.append(element);
  const fills = smartSolidVector(proxy)!; fills[0]!.style.fill = 'rgba(120, 0, 135, 0.6)'; expect(currentSmartPaint(element, 'fill')).toBe('rgba(120, 0, 135, 0.6)'); expect(currentSmartPaint(element, 'backgroundColor')).toBeUndefined(); proxy.style.opacity = '0.5'; expect(currentSmartPaint(element, 'fill')).toBeUndefined(); proxy.style.opacity = '1'; element.append(proxy.cloneNode(true)); expect(currentSmartPaint(element, 'fill')).toBeUndefined();
});
