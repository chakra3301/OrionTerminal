// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRequire } from 'node:module';
import { renderNodesToImage } from '@open-pencil/core/io';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { DesignView } from './reactExportRuntime';
import { createNativeRenderer, destroyNativeRenderer } from './nativeRendererLifecycle';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { prepareGraphFonts } from '@open-pencil/core/text';
import type { CanvasKit } from 'canvaskit-wasm';
import { renderNativeReactModel } from './nativeReactRenderer';
import { renderNativeReactLayer } from './nativeSceneArtwork';
import { cloneDesignSubgraph } from './graphSubset';
import { setPrototypeScroll, setScrollBehaviour } from './prototypeScroll';
import { placePreparedVideo } from './videoPaints';
import { serializeGraph } from './graphDocument';
import { assignPrototypeVariable, emptyPrototypeSession } from './prototypeValues';
import { capturePrototypeVariables, materializePrototypeBindings } from './prototypeVariableGraph';
import { prepareNativeSceneLayout } from './nativeSceneLayout';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
const paint = (r = 1, g = 0, b = 0) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g, b, a: 1 } });
const data = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
it('keeps live scroll/video ancestry and ordered native glyph/art pixels at two host sizes', async () => {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Responsive scroll', width: 120, height: 80, fills: [paint(0, 0, 1)] }); setPrototypeScroll(editor, root, { axis: 'vertical' });
  const shape = graph.createNode('RECTANGLE', root.id, { name: 'Native gradient', x: 8, y: 16, width: 50, height: 22, horizontalConstraint: 'STRETCH', fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1, color: paint().color, gradientStops: [{ position: 0, color: paint().color }, { position: 1, color: paint(0, 1).color }] }] });
  const text = graph.createNode('TEXT', root.id, { name: 'Native glyphs', x: 8, y: 64, width: 104, height: 28, text: 'Café scroll', fontFamily: 'Inter', fontSize: 14, fills: [paint()] });
  const collection = graph.createCollection('Rows'), vertical = graph.createVariable('Row offset', 'FLOAT', collection.id, 64); graph.bindVariable(text.id, 'y', vertical.id);
  const surface = kit.MakeSurface(4, 4)!; surface.getCanvas().clear(kit.Color(0, 255, 0, 1)); const poster = surface.makeImageSnapshot();
  const video = placePreparedVideo(editor, { bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]), poster: poster.encodeToBytes()!, name: 'Clip.mp4', mime: 'video/mp4', width: 4, height: 4, duration: 1 }, 8, 104, root.id); poster.delete(); surface.delete();
  try {
    const before = serializeGraph(graph), session = assignPrototypeVariable(capturePrototypeVariables(graph), emptyPrototypeSession(), vertical.id, { type: 'literal', value: 72 });
    for (const width of [160, 220]) {
      const model = await renderNativeReactModel(kit, graph, [root.id], { session, rootSizes: { [root.id]: { width } } }), output = model.nodes[0]!;
      expect(output.scroll?.axis).toBe('vertical'); expect(output.image).toMatch(/^data:image\/png/);
      expect(output.children.map(node => node.sourceId)).toEqual([shape.id, text.id, video]);
      expect(output.children[2]!.image).toBeUndefined(); expect(output.children[2]!.video?.src).toMatch(/^data:video\/mp4/);
      const glyphs = output.children[1]!; expect(glyphs.image).toMatch(/^data:image\/png/); expect(glyphs.sceneCovered).toBe(true); expect(glyphs.style.top).toBe(72);
      const independent = cloneDesignSubgraph(graph, [root.id]); materializePrototypeBindings(independent, capturePrototypeVariables(independent), session, { detachResolved: true });
      independent.getNode(root.id)!.width = width; independent.getNode(shape.id)!.width = 50 + width - 120;
      await prepareGraphFonts(independent, [root.id]); prepareNativeSceneLayout(kit, independent, [root.id]);
      expect(output.children[0]!.image).toBe(data(renderNativeReactLayer(kit, independent, shape.id).bytes));
      expect(glyphs.image).toBe(data(renderNativeReactLayer(kit, independent, text.id).bytes));
    }
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it('keeps a selected native text root semantic while preventing a second visible DOM glyph paint', async () => {
  const editor = createEditor(), graph = editor.graph;
  const text = graph.createNode('TEXT', editor.state.currentPageId, { name: 'Selected native glyphs', width: 120, height: 32, text: 'Café native', fontFamily: 'Inter', fontSize: 14, fills: [paint()] });
  try {
    const before = serializeGraph(graph), model = await renderNativeReactModel(kit, graph, [text.id]);
    expect(model.nodes[0]).toMatchObject({ sourceId: text.id, text: 'Café native', sceneCovered: true });
    expect(model.nodes[0]!.image).toMatch(/^data:image\/png;base64,/);
    const pixels = kit.MakeImageFromEncoded(Buffer.from(model.nodes[0]!.image!.split(',')[1]!, 'base64'))!;
    try { expect(new Uint8Array(pixels.readPixels(0, 0, { width: pixels.width(), height: pixels.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!).some((value, index) => index % 4 === 3 && value > 0)).toBe(true); }
    finally { pixels.delete(); }
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it.each(['fixed', 'sticky'] as const)('keeps a nested live %s child and its native artwork at two host sizes', async behaviour => {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Non-scrolling screen', width: 120, height: 100, fills: [] });
  const inner = graph.createNode('FRAME', root.id, { name: 'Nested scroller', x: 8, y: 8, width: 100, height: 80, fills: [], clipsContent: true });
  setPrototypeScroll(editor, inner, { axis: 'vertical', initial: { x: 0, y: 11 } });
  const positioned = graph.createNode('RECTANGLE', inner.id, { name: 'Live positioned child', x: 4, y: 4, width: 20, height: 12, fills: [paint()] });
  setScrollBehaviour(editor, positioned, behaviour);
  const ordinary = graph.createNode('RECTANGLE', inner.id, { name: 'Scrolling content', x: 40, y: 140, width: 20, height: 12, fills: [paint(0, 1)] });
  const before = serializeGraph(graph);
  try {
    for (const width of [120, 180]) {
      const model = await renderNativeReactModel(kit, graph, [root.id], { rootSizes: { [root.id]: { width } } });
      const output = model.nodes[0]!, scroller = output.children[0]!, child = scroller.children[0]!;
      expect(output.style.width).toBe(width);
      expect(output.scroll?.axis).toBe('none');
      expect(scroller).toMatchObject({ sourceId: inner.id, scroll: { axis: 'vertical', initial: { x: 0, y: 11 } }, clipContent: true });
      expect(scroller.image).toBeUndefined();
      expect(scroller.children.map(node => node.sourceId)).toEqual([positioned.id, ordinary.id]);
      expect(child).toMatchObject({ sourceId: positioned.id, scrollBehaviour: behaviour, style: { left: 4, top: 4, width: 20, height: 12 } });
      expect(child.sceneCovered).toBeUndefined();
      expect(child.image).toBe(data(renderNativeReactLayer(kit, graph, positioned.id).bytes));
      expect(scroller.children[1]!.image).toBe(data(renderNativeReactLayer(kit, graph, ordinary.id).bytes));
      if (behaviour === 'fixed') expect(child.fixedStyle).toMatchObject({ position: 'absolute', left: 4, top: 4, width: 20, height: 12 });
      else expect(child.fixedStyle).toBeUndefined();
      expect(serializeGraph(graph)).toBe(before);
    }
  } finally { editor.dispose(); }
});

it.each(['fixed', 'sticky'] as const)('retains a nested %s overlap in authored native model order without changing its source', async behaviour => {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Non-scrolling screen', width: 120, height: 100, fills: [] });
  const inner = graph.createNode('FRAME', root.id, { name: 'Nested scroller', width: 100, height: 80, fills: [] });
  setPrototypeScroll(editor, inner, { axis: 'vertical' });
  const positioned = graph.createNode('RECTANGLE', inner.id, { name: 'Live positioned child', x: 4, y: 4, width: 20, height: 12, fills: [paint()] });
  setScrollBehaviour(editor, positioned, behaviour);
  const cover = graph.createNode('RECTANGLE', inner.id, { name: 'Authored cover', x: 10, y: 4, width: 20, height: 12, fills: [paint(0, 1)] });
  const before = serializeGraph(graph);
  try {
    const output = (await renderNativeReactModel(kit, graph, [root.id])).nodes[0]!.children[0]!;
    expect(output.children.map(node => node.sourceId)).toEqual([positioned.id, cover.id]);
    expect(output.children[0]).toMatchObject({ scrollBehaviour: behaviour, style: { left: 4, top: 4, width: 20, height: 12 } });
    expect(output.children.map(node => node.image)).toEqual([positioned, cover].map(node => data(renderNativeReactLayer(kit, graph, node.id).bytes)));
    expect(output.children.every(node => !node.sceneCovered)).toBe(true);
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

// This compositor reads the mounted DOM, not DesignNode geometry or the planner's order.
function mountedPixels(element: HTMLElement, width: number, height: number, videoColor: [number, number, number]) {
  const surface = kit.MakeSurface(width * 2, height * 2)!, canvas = surface.getCanvas(), brush = new kit.Paint();
  const length = (value: string, parent: number, fallback = 0) => value ? value.endsWith('%') ? Number.parseFloat(value) * parent / 100 : Number.parseFloat(value) : fallback;
  const visit = (node: HTMLElement, parentWidth: number, parentHeight: number) => {
    const style = node.style;
    if (node.hidden || style.display === 'none') return;
    const w = length(style.width, parentWidth, parentWidth), h = length(style.height, parentHeight, parentHeight);
    canvas.save(); canvas.translate(length(style.left, parentWidth), length(style.top, parentHeight));
    const transform = style.transform, origin = (style.transformOrigin || '0 0').split(/\s+/).map((value, index) => length(value, index ? h : w));
    canvas.translate(origin[0]!, origin[1]!);
    for (const match of transform.matchAll(/(matrix|translate)\(([^)]+)\)/g)) {
      const values = match[2]!.split(',').map(value => Number.parseFloat(value));
      if (match[1] === 'matrix') { expect(values).toHaveLength(6); const [a, b, c, d, x, y] = values; canvas.concat([a!, c!, x!, b!, d!, y!, 0, 0, 1]); }
      else canvas.translate(values[0]!, values[1]!);
    }
    expect(transform.replace(/(?:matrix|translate)\([^)]+\)/g, '').trim()).toBe('');
    canvas.translate(-origin[0]!, -origin[1]!);
    if ([style.overflow, style.overflowX, style.overflowY].some(value => ['hidden', 'auto', 'scroll'].includes(value))) canvas.clipRect(kit.XYWHRect(0, 0, w, h), kit.ClipOp.Intersect, false);
    if (node.hasAttribute('data-xdesign-scroll')) canvas.translate(-node.scrollLeft, -node.scrollTop);
    const opacity = Number(style.opacity || 1);
    if (opacity !== 1) { const layer = new kit.Paint(); layer.setAlphaf(opacity); canvas.saveLayer(layer); layer.delete(); }
    if (node.tagName === 'IMG') {
      const image = kit.MakeImageFromEncoded(Buffer.from((node as HTMLImageElement).src.split(',')[1]!, 'base64'))!;
      try { canvas.drawImageRect(image, kit.XYWHRect(0, 0, image.width(), image.height()), kit.XYWHRect(0, 0, w, h), brush); } finally { image.delete(); }
    } else if (node.tagName === 'VIDEO') {
      brush.setColor(kit.Color(...videoColor, 1)); canvas.drawRect(kit.XYWHRect(0, 0, w, h), brush);
    } else for (const child of node.children) visit(child as HTMLElement, w, h);
    if (opacity !== 1) canvas.restore();
    canvas.restore();
  };
  try {
    canvas.clear(kit.TRANSPARENT); canvas.scale(2, 2); visit(element, width, height);
    const image = surface.makeImageSnapshot();
    try { return new Uint8Array(image.readPixels(0, 0, { width: width * 2, height: height * 2, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!).slice(); }
    finally { image.delete(); }
  } finally { brush.delete(); surface.delete(); }
}

function wholeScenePixels(graph: SceneGraph, rootId: string, width: number, height: number) {
  const surface = kit.MakeSurface(8, 8)!, renderer = createNativeRenderer(kit, surface);
  // The default opacity bounds double-count a reflected origin; use the renderer's viewport path.
  renderer.boundEffectLayersToViewport = true; renderer.worldViewport = { x: 0, y: 0, w: width, h: height };
  let page = graph.getNode(rootId)!; while (page.parentId && page.type !== 'CANVAS') page = graph.getNode(page.parentId)!;
  try {
    const image = kit.MakeImageFromEncoded(renderNodesToImage(kit, renderer, graph, page.id, [rootId], { format: 'PNG', scale: 2 })!)!;
    try { expect([image.width(), image.height()]).toEqual([width * 2, height * 2]); return new Uint8Array(image.readPixels(0, 0, { width: width * 2, height: height * 2, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!).slice(); }
    finally { image.delete(); }
  } finally { destroyNativeRenderer(renderer); }
}

it.each(['fixed', 'sticky'] as const)('matches an independent whole-scene paint order for overlapping %s, fixed video and an independently scrolled fixed frame', async behaviour => {
  const editor = createEditor(), graph = editor.graph;
  const screen = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Ordered screen', width: 96, height: 64, clipsContent: true, fills: [paint(1, 1, 1)] }); setPrototypeScroll(editor, screen, { axis: 'vertical' });
  const before = graph.createNode('FRAME', screen.id, { name: 'Behind', x: 4, y: 8, width: 60, height: 44, opacity: .75, flipX: true, clipsContent: true, fills: [paint(0, 0, 1)] });
  graph.createNode('RECTANGLE', before.id, { name: 'Clipped group child', x: -6, y: 8, width: 24, height: 50, fills: [paint(0, 1, 1)] });
  const positioned = graph.createNode('RECTANGLE', screen.id, { name: 'Positioned', x: 14, y: 12, width: 40, height: 24, fills: [paint()] }); setScrollBehaviour(editor, positioned, behaviour);
  const middle = graph.createNode('RECTANGLE', screen.id, { name: 'Middle', x: 12, y: 16, width: 50, height: 20, fills: [{ ...paint(1, 1), opacity: .5 }] });
  const posterSurface = kit.MakeSurface(4, 4)!; posterSurface.getCanvas().clear(kit.Color(0, 255, 255, 1)); const poster = posterSurface.makeImageSnapshot();
  const videoId = placePreparedVideo(editor, { bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]), poster: poster.encodeToBytes()!, name: 'Fixed video', mime: 'video/mp4', width: 4, height: 4, duration: 1 }, 18, 16, screen.id); poster.delete(); posterSurface.delete();
  Object.assign(graph.getNode(videoId)!, { width: 24, height: 16, rotation: 90 }); setScrollBehaviour(editor, graph.getNode(videoId)!, 'fixed');
  const inner = graph.createNode('FRAME', screen.id, { name: 'Fixed own scroller', x: 44, y: 10, width: 34, height: 32, fills: [paint(0, 0, .5)], clipsContent: true }); setPrototypeScroll(editor, inner, { axis: 'vertical' }); setScrollBehaviour(editor, inner, 'fixed');
  const scrolling = graph.createNode('RECTANGLE', inner.id, { name: 'Inner content', x: -4, y: 2, width: 40, height: 60, fills: [paint(0, 1)] });
  const reflected = graph.createNode('RECTANGLE', inner.id, { name: 'Inner fixed reflection', x: 2, y: 5, width: 20, height: 12, rotation: 90, flipX: true, fills: [paint(1, 0, 1)] }); setScrollBehaviour(editor, reflected, 'fixed');
  const foreground = graph.createNode('RECTANGLE', screen.id, { name: 'Foreground', x: 10, y: 14, width: 68, height: 22, fills: [{ ...paint(1, .5), opacity: .5 }] });
  const source = serializeGraph(graph);
  type TestDOM = { window: Window & typeof globalThis };
  const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { pretendToBeVisual: boolean }) => TestDOM };
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLVideoElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const) vi.stubGlobal(name, dom.window[name]);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window)); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(dom.window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(dom.window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    let comparisons = 0;
    for (const width of [96, 128]) {
      const model = await renderNativeReactModel(kit, graph, [screen.id], { rootSizes: { [screen.id]: { width } } });
      const output = model.nodes[0]!;
      expect(output.children.map(node => node.sourceId)).toEqual([before.id, positioned.id, middle.id, videoId, inner.id, foreground.id]);
      expect(output.children[3]).toMatchObject({ scrollBehaviour: 'fixed', video: { src: expect.stringMatching(/^data:video/) }, style: { width: 24, height: 16, transformOrigin: '0 0' } });
      expect(output.children[3]!.image).toBeUndefined();
      expect(output.children[4]).toMatchObject({ scrollBehaviour: 'fixed', scroll: { axis: 'vertical' }, clipContent: true });
      const modelBefore = JSON.stringify(model);
      await act(async () => root.render(<DesignView nodes={model.nodes} width={model.width} height={model.height} />));
      const outerViewport = host.querySelector<HTMLElement>(`[data-xdesign-scroll="${output.id}"]`)!, innerNode = output.children[4]!;
      const innerViewport = host.querySelector<HTMLElement>(`[data-xdesign-scroll="${innerNode.id}"]`)!, positionedDOM = host.querySelector<HTMLElement>(`[data-xdesign-source="${positioned.id}"]`)!, videoDOM = host.querySelector('video');
      Object.defineProperty(positionedDOM, 'offsetTop', { configurable: true, value: 12 }); Object.defineProperty(positionedDOM, 'offsetLeft', { configurable: true, value: 14 });
      expect([...outerViewport.firstElementChild!.children].map(element => element.hasAttribute('data-xdesign-fixed') ? element.firstElementChild!.getAttribute('data-xdesign-source') : element.getAttribute('data-xdesign-source'))).toEqual([before.id, positioned.id, middle.id, videoId, inner.id, foreground.id]);
      const distinct = new Set<string>();
      for (const [outerOffset, innerOffset] of [[0, 0], [12, 6], [28, 14]] as const) {
        await act(async () => { outerViewport.scrollTop = outerOffset; outerViewport.dispatchEvent(new Event('scroll')); innerViewport.scrollTop = innerOffset; innerViewport.dispatchEvent(new Event('scroll')); });
        expect(host.querySelector('video')).toBe(videoDOM);
        for (const videoColor of [[0, 255, 255], [255, 255, 0]] as [number, number, number][]) {
          const reference = cloneDesignSubgraph(graph, [screen.id]); reference.getNode(screen.id)!.width = width;
          // The reference retains authored order and uses only independent scene geometry.
          for (const node of [before, middle, foreground]) reference.getNode(node.id)!.y -= outerOffset;
          reference.getNode(positioned.id)!.y = behaviour === 'fixed' ? 12 : Math.max(0, 12 - outerOffset);
          reference.getNode(scrolling.id)!.y -= innerOffset;
          reference.getNode(videoId)!.fills = [paint(...videoColor.map(channel => channel / 255) as [number, number, number])]; reference.clearAbsPosCache();
          const expected = wholeScenePixels(reference, screen.id, width, 64), actual = mountedPixels(host.querySelector<HTMLElement>('[data-xdesign-view]')!, width, 64, videoColor);
          if (outerOffset === 0) {
            const blueOffset = (16 * width * 2 + 8) * 4;
            for (const pixels of [expected, actual]) { expect([...pixels.slice(0, 4)]).toEqual([255, 255, 255, 255]); for (const [channel, value] of [64, 64, 255, 255].entries()) expect(Math.abs(pixels[blueOffset + channel]! - value)).toBeLessThanOrEqual(1); }
          }
          expect(actual.length).toBe(expected.length); let maximum = 0, worst = 0; const first: number[] = [];
          for (let index = 0; index < actual.length; index++) { const difference = Math.abs(actual[index]! - expected[index]!); if (difference > maximum) { maximum = difference; worst = index; } if (difference > 2 && first.length < 4 && !first.includes(index - index % 4)) first.push(index - index % 4); }
          const sample = (index: number) => { const offset = index - index % 4; return { x: offset / 4 % (width * 2), y: Math.floor(offset / 4 / (width * 2)), actual: [...actual.slice(offset, offset + 4)], expected: [...expected.slice(offset, offset + 4)] }; };
          const diagnostic = maximum <= 2 ? '' : JSON.stringify({ first: first.map(sample), worst: sample(worst), layers: [...host.querySelectorAll<HTMLElement>('[data-name],[data-xdesign-fixed],[data-xdesign-scroll]')].map(element => ({ name: element.dataset.name ?? (element.dataset.xdesignFixed ? 'fixed clip' : 'viewport'), style: element.style.cssText, scroll: [element.scrollLeft, element.scrollTop] })) });
          expect(maximum, `${behaviour} width=${width} scroll=${outerOffset}/${innerOffset} frame=${videoColor} ${diagnostic}`).toBeLessThanOrEqual(2);
          distinct.add(Buffer.from(actual).toString('base64')); comparisons++;
        }
      }
      expect(distinct.size).toBe(6); expect(JSON.stringify(model)).toBe(modelBefore); expect(serializeGraph(graph)).toBe(source);
    }
    expect(comparisons).toBe(12);
  } finally { await act(async () => root.unmount()); editor.dispose(); dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
}, 30000);
