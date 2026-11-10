// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import type { CanvasKit } from 'canvaskit-wasm';
import type { Effect, SceneNode, Stroke } from '@open-pencil/scene-graph';
import { NativePaintContext, NativePaintRaster, PrototypePaintSources, nativePaintEligible, nativePaintTween, nodeNativePaintState, renderNativePaintImage } from './prototypeNativePaint';
import { artworkInsetStyle, nativeAppearance, nativeAppearanceTween, nativeArtworkInsets } from './prototypeNativeAppearance';
import { prototypeMotionMetadata } from './prototypeMotionMetadata';
import type { SmartLayerSnapshot } from './prototypeSmartSnapshot';
import { renderDesignNodes } from './proceduralPaints';
import { selectionToDesignModel } from './reactExport';
import { DesignView } from './reactExportRuntime';
import { serializeGraph } from './document';
let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const red = { r: 1, g: 0, b: 0, a: 1 }, blue = { r: 0, g: 0, b: 1, a: 1 }, middle = { r: .5, g: 0, b: .5, a: 1 };
const solid = (color = red, opacity = 1) => ({ type: 'SOLID' as const, visible: true, opacity, color });
const stroke = (align: Stroke['align'], end: boolean): Stroke => ({ visible: true, align, color: end ? blue : red, weight: end ? 8 : 4, opacity: end ? .8 : .4, dashPattern: [4, 2], cap: 'ROUND', join: 'ROUND' });
const effect = (type: Effect['type'], end: boolean): Effect => ({ type, visible: true, color: end ? blue : red, radius: end ? 8 : 4, spread: 0, offset: { x: end ? 4 : 2, y: end ? 4 : 2 }, blendMode: 'NORMAL' });
function read(image: ReturnType<CanvasKit['MakeImageFromEncoded']>, width: number, height: number) { return [...image!.readPixels(0, 0, { width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!]; }
function compare(raster: NativePaintRaster, expected: SceneNode, graph: ReturnType<typeof createEditor>['graph'], renderer: SkiaRenderer, width: number, height: number) {
  const actual = raster.surface.makeImageSnapshot(), bytes = renderDesignNodes(kit, renderer, graph, expected.parentId!, [expected.id], { format: 'PNG', scale: 1 })!, oracle = kit.MakeImageFromEncoded(bytes)!;
  try { expect([oracle.width(), oracle.height()]).toEqual([width, height]); expect(read(actual, width, height)).toEqual(read(oracle, width, height)); }
  finally { actual.delete(); oracle.delete(); }
}
it.each(['INSIDE', 'CENTER', 'OUTSIDE'] as const)('interpolates %s stroke width/color/opacity and retains exact native pixels including expanded bounds', align => {
  const editor = createEditor(), expected = createEditor(), renderer = new SkiaRenderer(kit, kit.MakeSurface(40, 40)!);
  try {
    const a = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [solid()], strokes: [stroke(align, false)], cornerRadius: 5 }), b = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [solid()], strokes: [stroke(align, true)], cornerRadius: 5 }), before = serializeGraph(editor.graph), tween = nativePaintTween(nodeNativePaintState(a), nodeNativePaintState(b))!;
    for (const [p, paint] of [[0, stroke(align, false)], [.5, { ...stroke(align, false), weight: 6, opacity: .6, color: middle }], [1, stroke(align, true)]] as const) {
      const state = tween(p), insets = nativeArtworkInsets(state.appearance), width = 40 + insets.left + insets.right, height = 40 + insets.top + insets.bottom, raster = new NativePaintRaster(kit, kit.MakeSurface(width, height)!, b, width, height);
      try { raster.draw(state); const node = expected.graph.createNode('RECTANGLE', expected.state.currentPageId, { width: 40, height: 40, fills: [solid()], strokes: [paint], cornerRadius: 5 }); renderer.invalidateAllPictures(); compare(raster, node, expected.graph, renderer, width, height); }
      finally { raster.dispose(); }
    }
    expect(serializeGraph(editor.graph)).toBe(before);
  } finally { renderer.destroy(); editor.dispose(); expected.dispose(); }
});
it.each(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'FOREGROUND_BLUR'] as const)('interpolates isolated %s radius/offset/color with exact native pixels', type => {
  const editor = createEditor(), expected = createEditor(), renderer = new SkiaRenderer(kit, kit.MakeSurface(40, 40)!);
  try {
    const a = editor.graph.createNode('ELLIPSE', editor.state.currentPageId, { width: 40, height: 40, fills: [solid()], effects: [effect(type, false)] }), b = editor.graph.createNode('ELLIPSE', editor.state.currentPageId, { width: 40, height: 40, fills: [solid()], effects: [effect(type, true)] }), tween = nativePaintTween(nodeNativePaintState(a), nodeNativePaintState(b))!;
    for (const [p, paint] of [[0, effect(type, false)], [.5, { ...effect(type, false), radius: 6, offset: { x: 3, y: 3 }, color: middle }], [1, effect(type, true)]] as const) {
      const state = tween(p), insets = nativeArtworkInsets(state.appearance), width = 40 + insets.left + insets.right, height = 40 + insets.top + insets.bottom, raster = new NativePaintRaster(kit, kit.MakeSurface(width, height)!, b, width, height);
      try { raster.draw(state); const node = expected.graph.createNode('ELLIPSE', expected.state.currentPageId, { width: 40, height: 40, fills: [solid()], effects: [paint] }); renderer.invalidateAllPictures(); compare(raster, node, expected.graph, renderer, width, height); }
      finally { raster.dispose(); }
    }
  } finally { renderer.destroy(); editor.dispose(); expected.dispose(); }
});
it('renders matching solid multi-fill stacks numerically through the native compositor', () => {
  const editor = createEditor(), expected = createEditor(), renderer = new SkiaRenderer(kit, kit.MakeSurface(40, 40)!); let raster: NativePaintRaster | undefined;
  try {
    const a = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [solid(), solid(blue, .4)] }), b = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [solid(blue), solid(red, .8)] }), tween = nativePaintTween(nodeNativePaintState(a), nodeNativePaintState(b))!;
    raster = new NativePaintRaster(kit, kit.MakeSurface(40, 40)!, b, 40, 40); raster.draw(tween(.5)); const node = expected.graph.createNode('RECTANGLE', expected.state.currentPageId, { width: 40, height: 40, fills: [solid(middle), solid(middle, .6)] }); compare(raster, node, expected.graph, renderer, 40, 40); expect(nativePaintEligible(a)).toBe(true);
  } finally { raster?.dispose(); renderer.destroy(); editor.dispose(); expected.dispose(); }
});
it('preserves all pixels of wider independent outside borders using padded native bounds', () => {
  const editor = createEditor(), expected = createEditor(), renderer = new SkiaRenderer(kit, kit.MakeSurface(72, 72)!); let raster: NativePaintRaster | undefined;
  try {
    const properties = { width: 40, height: 40, fills: [solid()], strokes: [{ ...stroke('OUTSIDE', false), dashPattern: [] }], independentStrokeWeights: true, borderTopWeight: 8, borderRightWeight: 16, borderBottomWeight: 4, borderLeftWeight: 12 };
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, properties), frame = expected.graph.createNode('FRAME', expected.state.currentPageId, { width: 72, height: 72, fills: [], clipsContent: true }); expected.graph.createNode('RECTANGLE', frame.id, { ...properties, x: 16, y: 16 });
    raster = new NativePaintRaster(kit, kit.MakeSurface(72, 72)!, node, 72, 72); raster.draw(nodeNativePaintState(node)); compare(raster, frame, expected.graph, renderer, 72, 72);
    expect(nativeArtworkInsets(nativeAppearance(node))).toEqual({ left: 16, right: 16, top: 16, bottom: 16 });
  } finally { raster?.dispose(); renderer.destroy(); editor.dispose(); expected.dispose(); }
});
it('exports expanded own artwork with correct portable percentage placement and preserves the original graph', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [solid()], strokes: [stroke('OUTSIDE', true)] }), before = serializeGraph(editor.graph), model = selectionToDesignModel(editor.graph, [node.id], kit), exported = model.nodes[0]!;
    expect(exported.imageStyle).toEqual({ left: '-20%', top: '-20%', right: 'auto', bottom: 'auto', width: '140%', height: '140%' });
    const markup = renderToStaticMarkup(createElement(DesignView, { ...model })); expect(markup).toContain('left:-20%'); expect(markup).toContain('width:140%'); expect(markup).toContain('height:140%'); expect(serializeGraph(editor.graph)).toBe(before);
    const image = kit.MakeImageFromEncoded(new Uint8Array(Buffer.from(exported.image!.split(',')[1]!, 'base64')))!;
    try { expect([image.width(), image.height()]).toEqual([112, 112]); } finally { image.delete(); }
  } finally { editor.dispose(); }
});
it('retains stroke-only SVG artwork bounds without requiring a loaded native canvas', () => {
  const editor = createEditor();
  try { const node = editor.graph.createNode('ELLIPSE', editor.state.currentPageId, { width: 40, height: 40, fills: [], strokes: [stroke('CENTER', true)] }), exported = selectionToDesignModel(editor.graph, [node.id]).nodes[0]!; expect(exported.image).toMatch(/^data:image\/svg/); expect(exported.imageStyle?.left).toBe('-10%'); expect(exported.imageStyle?.width).toBe('120%'); }
  finally { editor.dispose(); }
});
it('preserves matching stroke dashes, independent borders and shadow spread while refusing structural or invalid appearances', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, strokes: [stroke('CENTER', false)], effects: [effect('DROP_SHADOW', false)] }), a = nodeNativePaintState(node), b = structuredClone(a); b.width = 80; b.radii = [10, 10, 10, 10]; b.appearance!.strokes[0]!.dashPattern = [8, 4]; b.appearance!.effects[0]!.spread = -4; b.appearance!.borders = [4, 8, 12, 16];
    const mid = nativePaintTween(a, b)!(.5); expect(mid.width).toBe(60); expect(mid.radii).toEqual([5, 5, 5, 5]); expect(mid.appearance!.strokes[0]!.dashPattern).toEqual([6, 3]); expect(mid.appearance!.effects[0]!.spread).toBe(-2); expect(mid.appearance!.borders).toEqual([2, 4, 6, 8]);
    const changed = structuredClone(b); changed.appearance!.strokes[0]!.align = 'OUTSIDE'; expect(nativePaintTween(a, changed)).toBeUndefined(); changed.appearance!.strokes[0]!.align = 'CENTER'; changed.appearance!.effects[0]!.type = 'INNER_SHADOW'; expect(nativePaintTween(a, changed)).toBeUndefined(); changed.appearance!.effects[0]!.type = 'DROP_SHADOW'; changed.appearance!.effects[0]!.radius = NaN; expect(nativePaintTween(a, changed)).toBeUndefined();
    const appearance = nativeAppearanceTween(a.appearance, b.appearance)!; expect(() => appearance(Infinity)).toThrow('finite');
  } finally { editor.dispose(); }
});
it('does not admit backdrop blur or effect groups while preserving own outside paint on content-clipped nodes', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [solid()], effects: [effect('BACKGROUND_BLUR', false)] }); expect(nativePaintEligible(node)).toBe(false);
    editor.graph.updateNode(node.id, { effects: [effect('DROP_SHADOW', false)] }); expect(nativePaintEligible(node)).toBe(true); editor.graph.createNode('RECTANGLE', node.id, { width: 10, height: 10 }); expect(nativePaintEligible(node)).toBe(false);
    editor.graph.updateNode(node.id, { childIds: [], effects: [], strokes: [stroke('OUTSIDE', false)], clipsContent: true }); expect(nativePaintEligible(node)).toBe(true);
  } finally { editor.dispose(); }
});
const layer = (node: SceneNode, artwork: string): SmartLayerSnapshot => ({ element: { children: [] } as unknown as HTMLElement, key: 'box', motion: { ...prototypeMotionMetadata(node, true), name: 'Box', artwork }, pose: { matrix: [1, 0, 0, 1, 0, 0], width: node.width, height: node.height, opacity: 1 } });
it('admits stroke/effect work before allocation and counts expanded pixel bounds', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 1, height: 1, fills: [], strokes: Array.from({ length: 64 }, () => stroke('INSIDE', false)) }), sources = new PrototypePaintSources(kit), key = sources.add(node)!, snapshot = layer(node, key), allocate = vi.fn(), context = new NativePaintContext([sources], allocate);
    for (let i = 0; i < 64; i++) expect(context.plan(snapshot, snapshot)).toBeDefined(); expect(() => context.plan(snapshot, snapshot)).toThrow('4,096'); expect(allocate).not.toHaveBeenCalled();
    editor.graph.updateNode(node.id, { width: 40, height: 40, strokes: [{ ...stroke('OUTSIDE', false), weight: 10000 }] }); const large = layer(node, sources.add(node)!), expanded = new NativePaintContext([sources], allocate);
    for (let i = 0; i < 4; i++) expect(expanded.plan(large, large)).toBeDefined(); expect(() => expanded.plan(large, large)).toThrow('16-megapixel'); expect(allocate).not.toHaveBeenCalled();
  } finally { editor.dispose(); }
});
it('keeps changing native blur filter caches bounded across frames and closes the raster', () => {
  const editor = createEditor(); let raster: NativePaintRaster | undefined;
  try {
    const node = editor.graph.createNode('ELLIPSE', editor.state.currentPageId, { width: 16, height: 16, fills: [solid()], effects: [effect('LAYER_BLUR', false)] }), state = nodeNativePaintState(node); raster = new NativePaintRaster(kit, kit.MakeSurface(32, 32)!, node, 32, 32);
    for (let i = 0; i < 40; i++) { state.appearance!.effects[0]!.radius = 1 + i / 10; raster.draw(state); const renderer = (raster as unknown as { renderer: SkiaRenderer }).renderer; expect(renderer.imageFilterCache.size).toBeLessThanOrEqual(1); }
    const exported = renderNativePaintImage(kit, node); expect(exported.bytes.length).toBeGreaterThan(0); expect(artworkInsetStyle(40, 40, { left: 8, right: 8, top: 8, bottom: 8 }).width).toBe('140%');
  } finally { raster?.dispose(); editor.dispose(); }
});
it('frees both owned premultiplied heap buffers and the convenience display buffer exactly once', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 16, height: 16, fills: [solid()], strokes: [stroke('OUTSIDE', false)] }), surface = kit.MakeSurface(32, 32)!, malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free'), close = vi.spyOn(surface, 'dispose'), raster = new NativePaintRaster(kit, surface, node, 32, 32);
    raster.draw(nodeNativePaintState(node)); const allocated = malloc.mock.results.map(result => result.value); expect(allocated).toHaveLength(2); expect(allocated.map(value => value.length)).toEqual([16384, 4096]); raster.dispose(); raster.dispose(); expect(free.mock.calls.map(([value]) => value)).toEqual(allocated); expect(close).toHaveBeenCalledOnce();
  } finally { editor.dispose(); }
});
it('releases allocated native buffers and the display if downsample allocation fails', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 16, height: 16, fills: [solid()] }), surface = kit.MakeSurface(16, 16)!, malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free'), close = vi.spyOn(surface, 'dispose'), original = kit.MakeRasterDirectSurface.bind(kit);
    vi.spyOn(kit, 'MakeRasterDirectSurface').mockImplementationOnce(original).mockReturnValueOnce(null);
    expect(() => new NativePaintRaster(kit, surface, node, 16, 16)).toThrow('premultiplied downsample'); expect(free.mock.calls.map(([value]) => value)).toEqual(malloc.mock.results.map(result => result.value)); expect(close).toHaveBeenCalledOnce();
  } finally { editor.dispose(); }
});
