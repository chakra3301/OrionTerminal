// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import type { Canvas, CanvasKit, Font, Paint, PathEffect, Surface } from 'canvaskit-wasm';
import { createNativeRenderer, destroyNativeRenderer, freeNativeSurfacePixels, withNativeOpacityLayers } from './nativeRendererLifecycle';
import { NativePaintRaster, nodeNativePaintState } from './prototypeNativePaint';
import { selectionToDesignModel } from './reactExport';
import { serializeGraph } from './document';
import { renderDesignNodes, designPaintSource } from './proceduralPaints';

vi.mock('@open-pencil/core/editor', async () => { const actual = await vi.importActual<typeof import('@open-pencil/core/editor')>('@open-pencil/core/editor'); return { ...actual, createEditor: vi.fn(actual.createEditor) }; });
let kit: CanvasKit, originalEditor: typeof createEditor;
beforeAll(async () => { kit = await getCanvasKit(); originalEditor = (await vi.importActual<typeof import('@open-pencil/core/editor')>('@open-pencil/core/editor')).createEditor; });
beforeEach(() => vi.mocked(createEditor).mockReset().mockImplementation(originalEditor));
afterEach(() => vi.restoreAllMocks());
type Handle = Paint | Font | PathEffect;
function trackedKit(fail?: { paint?: number; font?: boolean; reason: Error; cleanup?: Error }) {
  const local = Object.create(kit) as CanvasKit, handles: Handle[] = [], effects: PathEffect[] = []; let count = 0;
  Object.defineProperties(local, {
    Paint: { value: new Proxy(kit.Paint, { construct(target, args) {
      const paint = Reflect.construct(target, args, target) as Paint; handles.push(paint); count++;
      if (count === fail?.paint) vi.spyOn(paint, 'setStyle').mockImplementationOnce(() => { throw fail.reason; });
      if (count === 1 && fail?.cleanup) vi.spyOn(paint, 'delete').mockImplementationOnce(() => { throw fail.cleanup; });
      return paint;
    } }) },
    Font: { value: new Proxy(kit.Font, { construct(target, args) { if (fail?.font) throw fail.reason; const font = Reflect.construct(target, args, target) as Font; handles.push(font); return font; } }) },
    PathEffect: { value: { ...kit.PathEffect, MakeDash: (...args: Parameters<CanvasKit['PathEffect']['MakeDash']>) => { const effect = kit.PathEffect.MakeDash(...args); effects.push(effect); vi.spyOn(effect, 'delete'); return effect; } } },
  });
  return { kit: local, handles, effects, close: () => { for (const handle of [...handles, ...effects]) if (!handle.isDeleted()) handle.delete(); } };
}
function directSurface(size = 32) {
  const pixels = kit.Malloc(Uint8Array, size * size * 4), surface = kit.MakeRasterDirectSurface({ width: size, height: size, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, pixels, size * 4)!;
  return { surface, pixels, close: () => { if (!surface.isDeleted()) surface.delete(); kit.Free(pixels); } };
}
function outlinePixels(renderer: SkiaRenderer) {
  const canvas = renderer.surface.getCanvas(); canvas.clear(kit.TRANSPARENT); canvas.drawRect(kit.LTRBRect(2, 2, 28, 28), renderer.parentOutlinePaint); renderer.surface.flush();
  const image = renderer.surface.makeImageSnapshot();
  try { return [...image.readPixels(0, 0, { width: 32, height: 32, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!]; } finally { image.delete(); }
}
it('transfers actual SDK paints and font, frees its temporary dash wrapper and restores local factories without changing global CanvasKit', () => {
  const tracked = trackedKit(), display = directSurface(), original = { Paint: kit.Paint, Font: kit.Font, PathEffect: kit.PathEffect }; let renderer: SkiaRenderer | undefined;
  try {
    renderer = createNativeRenderer(tracked.kit, display.surface);
    expect(renderer).toBeInstanceOf(SkiaRenderer); expect(tracked.handles).toHaveLength(21); expect(tracked.handles.every(handle => !handle.isDeleted())).toBe(true); expect(tracked.effects).toHaveLength(1); expect(tracked.effects[0]!.isDeleted()).toBe(true); expect(tracked.effects[0]!.delete).toHaveBeenCalledOnce();
    expect(renderer.ck.Paint).toBe(tracked.kit.Paint); expect(renderer.ck.Font).toBe(tracked.kit.Font); expect(renderer.ck.PathEffect).toBe(tracked.kit.PathEffect); expect(kit.Paint).toBe(original.Paint); expect(kit.Font).toBe(original.Font); expect(kit.PathEffect).toBe(original.PathEffect);
    destroyNativeRenderer(renderer); destroyNativeRenderer(renderer); expect(tracked.handles.every(handle => handle.isDeleted())).toBe(true); expect(display.surface.isDeleted()).toBe(true); expect(tracked.effects[0]!.delete).toHaveBeenCalledOnce();
  } finally { if (renderer) destroyNativeRenderer(renderer); tracked.close(); display.close(); }
});
it('preserves exact native dashed outline pixels after releasing the constructor path-effect wrapper', () => {
  const tracked = trackedKit(), expectedTracked = trackedKit(), a = directSurface(), b = directSurface(); let renderer: SkiaRenderer | undefined, expected: SkiaRenderer | undefined;
  try {
    renderer = createNativeRenderer(tracked.kit, a.surface); expected = new SkiaRenderer(expectedTracked.kit, b.surface);
    const pixels = outlinePixels(renderer); expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true); expect(pixels).toEqual(outlinePixels(expected)); expect(tracked.effects[0]!.isDeleted()).toBe(true); expect(expectedTracked.effects[0]!.isDeleted()).toBe(false);
  } finally { if (renderer) destroyNativeRenderer(renderer); expected?.destroy(); tracked.close(); expectedTracked.close(); a.close(); b.close(); }
});
it.each([{ paint: 3 }, { paint: 5 }, { font: true }, { paint: 20 }])('unwinds actual constructor handles and preserves caller surface ownership after failure at %j', stage => {
  const failure = new Error('initialization failed'), tracked = trackedKit({ ...stage, reason: failure }), display = directSurface();
  try {
    expect(() => createNativeRenderer(tracked.kit, display.surface)).toThrow(failure); expect(tracked.handles.length).toBeGreaterThan(0); expect(tracked.handles.every(handle => handle.isDeleted())).toBe(true); expect(tracked.effects.every(handle => handle.isDeleted())).toBe(true); expect(display.surface.isDeleted()).toBe(false);
    display.surface.getCanvas().clear(kit.BLUE); display.surface.flush(); expect(display.pixels.toTypedArray().some(value => value > 0)).toBe(true);
  } finally { tracked.close(); display.close(); }
});
it('preserves initialization and cleanup failures while attempting every remaining constructor release', () => {
  const primary = new Error('initialization failed'), cleanup = new Error('paint release failed'), tracked = trackedKit({ paint: 5, reason: primary, cleanup }), display = directSurface();
  try {
    let failure: unknown; try { createNativeRenderer(tracked.kit, display.surface); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError); expect((failure as AggregateError).cause).toBe(primary); expect((failure as AggregateError).errors).toEqual([primary, cleanup]); expect(tracked.handles.slice(1).every(handle => handle.isDeleted())).toBe(true); expect(tracked.effects.every(handle => handle.isDeleted())).toBe(true); expect(display.surface.isDeleted()).toBe(false);
  } finally { tracked.close(); display.close(); }
});
const solid = { type: 'SOLID' as const, visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } };
it.each(['renderer', 'downsample'])('releases every caller-owned raster resource when the %s release throws', stage => {
  const editor = createEditor(), node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 16, height: 16, fills: [solid] }), before = serializeGraph(editor.graph), tracked = trackedKit(), display = kit.MakeSurface(16, 16)!, close = vi.spyOn(display, 'dispose'), malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free'), raster = new NativePaintRaster(tracked.kit, display, node, 16, 16), failure = new Error('release failed');
  const owned = raster as unknown as { renderer: SkiaRenderer; downsample: Surface; editor: Editor }, editorClose = vi.spyOn(owned.editor, 'dispose');
  try {
    raster.draw(nodeNativePaintState(node));
    if (stage === 'renderer') vi.spyOn(owned.renderer.fillPaint, 'delete').mockImplementationOnce(() => { throw failure; });
    else { const original = owned.downsample.delete; vi.spyOn(owned.downsample, 'delete').mockImplementationOnce(() => { original.call(owned.downsample); throw failure; }); }
    expect(() => raster.dispose()).toThrow(failure); expect(tracked.handles.every(handle => handle.isDeleted())).toBe(true); expect(owned.renderer.surface.isDeleted()).toBe(true); expect(owned.downsample.isDeleted()).toBe(true); expect(free.mock.calls.map(([value]) => value)).toEqual(malloc.mock.results.map(result => result.value)); expect(close).toHaveBeenCalledOnce(); expect(editorClose).toHaveBeenCalledOnce(); expect(serializeGraph(editor.graph)).toBe(before);
    raster.dispose(); expect(close).toHaveBeenCalledOnce(); expect(free.mock.calls).toHaveLength(2);
  } finally { raster.dispose(); tracked.close(); editor.dispose(); }
});
it.each(['before', 'after'])('continues constructor cleanup and guards live native backing when surface release throws %s deletion', timing => {
  const editor = createEditor(), node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 16, height: 16, fills: [solid] }), display = kit.MakeSurface(16, 16)!, close = vi.spyOn(display, 'dispose'), malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free'), original = kit.MakeRasterDirectSurface.bind(kit), secondary = new Error('surface release failed'); let high: Surface | undefined;
  vi.spyOn(kit, 'MakeRasterDirectSurface').mockImplementationOnce((...args) => { high = original(...args)!; const originalDelete = high.delete; vi.spyOn(high, 'delete').mockImplementationOnce(() => { if (timing === 'after') originalDelete.call(high); throw secondary; }); return high; }).mockReturnValueOnce(null);
  try {
    let failure: unknown; try { new NativePaintRaster(kit, display, node, 16, 16); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError); expect((failure as AggregateError).cause).toBeInstanceOf(Error); expect(((failure as AggregateError).cause as Error).message).toContain('premultiplied downsample'); expect((failure as AggregateError).errors).toContain(secondary); expect(close).toHaveBeenCalledOnce();
    const allocated = malloc.mock.results.map(result => result.value); expect(allocated).toHaveLength(2); expect(free.mock.calls.map(([value]) => value)).toEqual(timing === 'after' ? allocated : allocated.slice(1));
    if (timing === 'before') { expect(high!.isDeleted()).toBe(false); expect((failure as AggregateError).errors.some(error => error instanceof Error && error.message.includes('before releasing its pixel buffer'))).toBe(true); high!.getCanvas().clear(kit.RED); high!.flush(); expect(allocated[0]!.toTypedArray().some((value: number) => value > 0)).toBe(true); }
  } finally { if (high && !high.isDeleted()) { high.delete(); kit.Free(malloc.mock.results[0]!.value); } editor.dispose(); }
});
it('refuses to free a still-live surface backing and permits release once native ownership closes', () => {
  const display = directSurface(), free = vi.spyOn(kit, 'Free'); let released = false;
  try { expect(() => freeNativeSurfacePixels(kit, display.surface, display.pixels)).toThrow('before releasing its pixel buffer'); expect(free).not.toHaveBeenCalled(); display.surface.getCanvas().clear(kit.BLUE); display.surface.flush(); expect(display.pixels.toTypedArray().some(value => value > 0)).toBe(true); display.surface.delete(); freeNativeSurfacePixels(kit, display.surface, display.pixels); released = true; expect(free).toHaveBeenCalledOnce(); }
  finally { if (!released) display.close(); }
});
it.each([false, true])('closes the legacy editor after a pixel release error and preserves export failure (primary=%s)', failRender => {
  const editor = createEditor(), node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 8, height: 8, fills: [{ ...solid, type: 'GRADIENT_LINEAR' }] }), before = serializeGraph(editor.graph), originalFree = kit.Free.bind(kit), cleanup = new Error('pixel release failed'), primary = new Error('render failed'); let privateEditor: Editor | undefined;
  vi.mocked(createEditor).mockImplementationOnce(options => { privateEditor = originalEditor(options); vi.spyOn(privateEditor, 'dispose'); return privateEditor; });
  vi.spyOn(kit, 'Free').mockImplementation(value => { originalFree(value); if (value.length === 64 * 64 * 4) throw cleanup; });
  if (failRender) vi.spyOn(SkiaRenderer.prototype, 'renderNode').mockImplementationOnce(() => { throw primary; });
  try { let failure: unknown; try { selectionToDesignModel(editor.graph, [node.id], kit); } catch (error) { failure = error; }
    if (failRender) { expect(failure).toBeInstanceOf(AggregateError); expect((failure as AggregateError).cause).toBe(primary); expect((failure as AggregateError).errors).toEqual([primary, cleanup]); }
    else expect(failure).toBe(cleanup);
    expect(privateEditor!.dispose).toHaveBeenCalledOnce(); expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); }
});

it.each(['prototype', 'own data', 'own accessor'] as const)('preserves borrowed renderer %s methods, nested canvas identity and exact non-opacity calls after success or failure', ownership => {
  const opacity = {} as Paint, other = {} as Paint, bounds = new Float32Array([10, 20, 30, 40]), backdrop = {} as Parameters<Canvas['saveLayer']>[2], result = Symbol('native result'), failure = new Error('borrowed drawing failed');
  const graphs = [{} as Parameters<SkiaRenderer['renderNode']>[1], {} as Parameters<SkiaRenderer['renderNode']>[1]], overlays = {} as Parameters<SkiaRenderer['renderNode']>[3];
  let renderer: SkiaRenderer, fail = false, rawCanvas: Canvas;
  const receivers: unknown[] = [], calls: unknown[][] = [], proxies: Canvas[] = [];
  const saveLayer = function (this: Canvas, ...args: Parameters<Canvas['saveLayer']>) { expect(this).toBe(rawCanvas); calls.push(args); return 71; };
  const drawRect = function (this: Canvas, rect: Float32Array, paint: Paint) { expect(this).toBe(rawCanvas); expect(rect).toBe(bounds); expect(paint).toBe(other); return result; };
  rawCanvas = { saveLayer, drawRect, sentinel: result } as unknown as Canvas;
  const canvasDescriptors = Object.getOwnPropertyDescriptors(rawCanvas);
  const original = function (this: SkiaRenderer, canvas: Canvas, graph: typeof graphs[number], id: string, receivedOverlays: typeof overlays) {
    receivers.push(this); proxies.push(canvas); expect(graph).toBe(graphs[id === 'outer' ? 0 : 1]); expect(receivedOverlays).toBe(overlays);
    expect(canvas.saveLayer).toBe(canvas.saveLayer); expect(canvas.drawRect).toBe(canvas.drawRect); expect((canvas as unknown as { sentinel: symbol }).sentinel).toBe(result);
    expect(canvas.saveLayer(opacity, bounds, backdrop, kit.SaveLayerF16ColorType, kit.TileMode.Clamp)).toBe(71);
    expect(canvas.saveLayer(other, bounds, null, kit.SaveLayerInitWithPrevious, kit.TileMode.Decal)).toBe(71);
    expect(canvas.saveLayer()).toBe(71);
    expect(Reflect.apply(canvas.drawRect, null, [bounds, other])).toBe(result);
    if (id === 'outer') renderer.renderNode(canvas, graphs[1]!, 'inner', overlays);
    if (fail && id === 'outer') throw failure;
    return result;
  };
  renderer = Object.create({ renderNode: original }) as SkiaRenderer; Object.defineProperty(renderer, 'opacityPaint', { value: opacity });
  if (ownership === 'own data') Object.defineProperty(renderer, 'renderNode', { value: original, configurable: true, writable: false, enumerable: true });
  if (ownership === 'own accessor') Object.defineProperty(renderer, 'renderNode', { get: () => original, configurable: true, enumerable: true });
  const descriptor = Object.getOwnPropertyDescriptor(renderer, 'renderNode'), prototype = Object.getPrototypeOf(renderer), receiver = Object.create(renderer) as SkiaRenderer;
  for (fail of [false, true]) {
    proxies.length = 0; receivers.length = 0; calls.length = 0;
    const run = () => withNativeOpacityLayers(renderer, () => {
      const installed = renderer.renderNode;
      return withNativeOpacityLayers(renderer, () => { expect(renderer.renderNode).toBe(installed); return Reflect.apply(renderer.renderNode, receiver, [rawCanvas, graphs[0], 'outer', overlays]); });
    });
    if (fail) expect(run).toThrow(failure); else expect(run()).toBe(result);
    expect(proxies).toHaveLength(2); expect(proxies[0]).not.toBe(rawCanvas); expect(proxies[1]).toBe(proxies[0]); expect(receivers).toEqual([receiver, renderer]);
    for (let index = 0; index < calls.length; index += 3) {
      expect(calls[index]).toEqual([opacity, undefined, backdrop, kit.SaveLayerF16ColorType, kit.TileMode.Clamp]);
      expect(calls[index + 1]).toEqual([other, bounds, null, kit.SaveLayerInitWithPrevious, kit.TileMode.Decal]); expect(calls[index + 2]).toEqual([]);
    }
    expect(renderer.renderNode).toBe(original); expect(Object.getOwnPropertyDescriptor(renderer, 'renderNode')).toEqual(descriptor); expect(Object.getPrototypeOf(renderer)).toBe(prototype); expect(prototype.renderNode).toBe(original);
    expect(Object.getOwnPropertyDescriptors(rawCanvas)).toEqual(canvasDescriptors);
  }
});

it('keeps native renderer compatibility installed through nested borrowing and removes it on destruction', () => {
  const editor = createEditor(), display = directSurface(), renderer = createNativeRenderer(kit, display.surface), original = SkiaRenderer.prototype.renderNode, installed = renderer.renderNode;
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 8, height: 8, opacity: .5, flipX: true, fills: [solid] });
  const before = serializeGraph(editor.graph), canvas = display.surface.getCanvas(), descriptor = Object.getOwnPropertyDescriptor(canvas, 'saveLayer');
  try {
    expect(installed).not.toBe(original); renderer.worldViewport = { x: -100, y: -100, w: 200, h: 200 };
    withNativeOpacityLayers(renderer, () => withNativeOpacityLayers(renderer, () => renderer.renderNode(canvas, editor.graph, node.id, {})));
    expect(renderer.renderNode).toBe(installed); expect(Object.getOwnPropertyDescriptor(canvas, 'saveLayer')).toEqual(descriptor); expect(renderer.boundEffectLayersToViewport).toBe(false); expect(serializeGraph(editor.graph)).toBe(before);
    destroyNativeRenderer(renderer); expect(renderer.renderNode).toBe(original); expect(Object.hasOwn(renderer, 'renderNode')).toBe(false);
  } finally { destroyNativeRenderer(renderer); display.close(); editor.dispose(); }
});

it('restores borrowed actual export renderer state and resources when the internally allocated canvas fails', () => {
  const editor = createEditor(), display = directSurface(), renderer = new SkiaRenderer(kit, display.surface), node = editor.graph.createNode('FRAME', editor.state.currentPageId, { width: 32, height: 24, fills: [solid] });
  const nested = editor.graph.createNode('FRAME', node.id, { x: 4, y: 4, width: 16, height: 12, opacity: .75, flipX: true, fills: [solid] });
  const failure = new Error('internal export canvas failed'), original = renderer.renderNode, before = serializeGraph(editor.graph), hostCanvas = display.surface.getCanvas(), hostMethod = hostCanvas.saveLayer, viewport = renderer.worldViewport;
  let actualCanvas: Canvas | undefined;
  Object.defineProperty(renderer, 'renderNode', { configurable: true, enumerable: true, writable: true, value: function (this: SkiaRenderer, ...args: Parameters<SkiaRenderer['renderNode']>) { actualCanvas = args[0]; throw failure; } });
  const descriptor = Object.getOwnPropertyDescriptor(renderer, 'renderNode'), malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free');
  try {
    expect(() => renderDesignNodes(kit, renderer, editor.graph, editor.state.currentPageId, [node.id], { format: 'PNG', scale: 1 })).toThrow(failure);
    expect(actualCanvas).toBeDefined(); expect(actualCanvas).not.toBe(hostCanvas); expect(Object.getOwnPropertyDescriptor(renderer, 'renderNode')).toEqual(descriptor); expect(hostCanvas.saveLayer).toBe(hostMethod); expect(renderer.worldViewport).toBe(viewport); expect(renderer.boundEffectLayersToViewport).toBe(false); expect(designPaintSource(renderer, editor.graph)).toBe(editor.graph);
    expect(free.mock.calls.map(([value]) => value)).toEqual(malloc.mock.results.map(item => item.value)); expect(serializeGraph(editor.graph)).toBe(before); expect(editor.graph.getNode(nested.id)!.opacity).toBe(.75);
  } finally { renderer.renderNode = original; renderer.destroy(); display.close(); editor.dispose(); }
});
