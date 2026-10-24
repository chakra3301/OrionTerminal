// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import { computeAllLayouts, getTextMeasurer, setTextMeasurer } from '@open-pencil/core/layout';
import { fontManager } from '@open-pencil/core/text';
import { renderNodesToImage } from '@open-pencil/core/io';
import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm';
import type { VectorNetwork } from '@open-pencil/scene-graph';
import { prepareNativeSceneLayout, hasNativeSceneLayout } from './nativeSceneLayout';
import { renderNativeSceneImage } from './nativeSceneArtwork';
import { prepareDesignModelFonts, selectionToDesignModel } from './reactExport';
import { capturePrototypeVariables, materializePrototypeBindings } from './prototypeVariableGraph';
import { assignPrototypeVariable, emptyPrototypeSession } from './prototypeValues';
import { cloneDesignSubgraph } from './graphSubset';
import { createNativeRenderer, destroyNativeRenderer } from './nativeRendererLifecycle';
import { serializeGraph } from './document';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); fontManager.setOnlineFontProviders({ google: false, fontshare: false, fontsource: false }); });
afterEach(() => vi.restoreAllMocks());
const paint = (r = 1, b = 0) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g: 0, b, a: 1 } });
const network = (width: number, height: number): VectorNetwork => ({ vertices: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }], segments: [0, 1, 2, 3].map(start => ({ start, end: (start + 1) % 4, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } })), regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }] });
const effect = { type: 'LAYER_BLUR' as const, visible: true, radius: 3, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } };
function fixture(mode: 'HORIZONTAL' | 'VERTICAL' | 'GRID' = 'HORIZONTAL', text = false) {
  const editor = createEditor(), graph = editor.graph, root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Layout', width: 160, height: 80, layoutMode: mode, primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED', counterAxisAlign: 'MIN', itemSpacing: 8, paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, effects: [effect], fills: [], clipsContent: false, ...(mode === 'GRID' ? { gridTemplateColumns: [{ sizing: 'FR', value: 1 }, { sizing: 'FR', value: 1 }], gridTemplateRows: [{ sizing: 'FIXED', value: 30 }, { sizing: 'FIXED', value: 30 }], gridColumnGap: 8, gridRowGap: 4 } : {}) });
  const fixed = graph.createNode('RECTANGLE', root.id, { name: 'Fixed', width: 40, height: 24, fills: [paint()] }), flexible = graph.createNode(text ? 'TEXT' : 'VECTOR', root.id, { name: 'Flexible', width: 20, height: 24, fills: [paint(0, 1)], layoutGrow: mode === 'GRID' ? 0 : 1, ...(text ? { text: 'Ready café with a second line', fontFamily: 'Inter', fontSize: 18, textAutoResize: 'HEIGHT' } : { vectorNetwork: network(20, 24) }) }), hidden = graph.createNode('RECTANGLE', root.id, { name: 'Optional', width: 10, height: 24, visible: false, fills: [paint()] });
  return { editor, graph, root, fixed, flexible, hidden };
}
function pixels(bytes: Uint8Array) { const image = kit.MakeImageFromEncoded(bytes)!; try { const rgba = new Uint8Array(image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!); return { width: image.width(), height: image.height(), rgbaSha256: createHash('sha256').update(rgba).digest('hex') }; } finally { image.delete(); } }
const imageBytes = (image: string) => new Uint8Array(Buffer.from(image.split('base64,')[1]!, 'base64'));
async function oracle(f: ReturnType<typeof fixture>, graph: ReturnType<typeof cloneDesignSubgraph>, artwork: ReturnType<typeof renderNativeSceneImage>) {
  const previous = getTextMeasurer(), backing = kit.Malloc(Uint8Array, 64 * 64 * 4), surface = kit.MakeRasterDirectSurface({ width: 64, height: 64, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, backing, 64 * 4)!, renderer = createNativeRenderer(kit, surface);
  try {
    await renderer.loadFonts(); setTextMeasurer((node, width) => renderer.measureTextNode(node, width)); computeAllLayouts(graph, f.root.id); computeAllLayouts(graph, f.root.id);
    const vector = graph.getNode(f.flexible.id)!; if (vector.type === 'VECTOR') vector.vectorNetwork = network(vector.width, vector.height);
    const root = graph.getNode(f.root.id)!, page = graph.getNode(f.editor.state.currentPageId)!, size = pixels(artwork.bytes), wrapper = graph.createNode('FRAME', page.id, { width: size.width / artwork.scale, height: size.height / artwork.scale, fills: [], clipsContent: false }); Object.assign(root, { parentId: wrapper.id, x: -artwork.bounds.minX, y: -artwork.bounds.minY, rotation: 0, flipX: false, flipY: false, opacity: 1 }); wrapper.childIds = [root.id]; page.childIds = [wrapper.id]; graph.clearAbsPosCache();
    return pixels(renderNodesToImage(kit, renderer, graph, page.id, [wrapper.id], { format: 'PNG', scale: artwork.scale })!);
  } finally { setTextMeasurer(previous); destroyNativeRenderer(renderer); kit.Free(backing); }
}
it('reflows a native vector group and its semantic targets after width and visibility assignments', async () => {
  const f = fixture();
  try {
    const collection = f.graph.createCollection('Responsive'), width = f.graph.createVariable('Width', 'FLOAT', collection.id, 160), shown = f.graph.createVariable('Shown', 'BOOLEAN', collection.id, false); f.graph.bindVariable(f.root.id, 'width', width.id); f.graph.bindVariable(f.hidden.id, 'visible', shown.id); const defs = capturePrototypeVariables(f.graph), session = assignPrototypeVariable(defs, assignPrototypeVariable(defs, emptyPrototypeSession(), width.id, { type: 'literal', value: 240 }), shown.id, { type: 'literal', value: true }), before = serializeGraph(f.graph);
    const initial = selectionToDesignModel(f.graph, [f.root.id], kit, true), current = selectionToDesignModel(f.graph, [f.root.id], kit, true, session), frame = current.nodes[0]!; expect(current.prototypeIssues).toEqual([]); expect(frame.motion?.composition).toBe('scene'); expect(frame.style.width).toBe(240); expect(frame.style.padding).toBeUndefined(); expect(frame.style.display).toBeUndefined(); expect(frame.children[0]!.style).toMatchObject({ position: 'absolute', left: 4, top: 4, width: 40, height: 24 }); expect(frame.children[1]!.style).toMatchObject({ position: 'absolute', left: 52, top: 4, width: 166, height: 24 }); expect(frame.children[2]!.style).toMatchObject({ left: 226, width: 10 }); expect(frame.children.every(node => node.sceneCovered)).toBe(true); expect(initial.nodes[0]!.image).not.toBe(frame.image);
    const copy = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(copy, defs, session, { detachResolved: true }); prepareNativeSceneLayout(kit, copy, [f.root.id]); expect(copy.getNode(f.flexible.id)!.vectorNetwork!.vertices).toEqual(network(166, 24).vertices); const artwork = renderNativeSceneImage(kit, copy, copy.getNode(f.root.id)!); const expected = cloneDesignSubgraph(f.graph, [f.root.id]); expected.getNode(f.root.id)!.width = 240; expected.getNode(f.hidden.id)!.visible = true; for (const node of expected.nodes.values()) node.boundVariables = {}; expect(pixels(imageBytes(frame.image!))).toEqual(await oracle(f, expected, artwork)); expect(serializeGraph(f.graph)).toBe(before); expect(selectionToDesignModel(f.graph, [f.root.id], kit).prototypeIssues.join(' ')).toContain('dynamic scene composition');
  } finally { f.editor.dispose(); }
});
it.each(['HORIZONTAL', 'VERTICAL', 'GRID'] as const)('composes %s layout using actual SDK boxes and native pixels without changing the authoring scene', async mode => {
  const f = fixture(mode);
  try {
    f.hidden.visible = true; const before = serializeGraph(f.graph), copy = cloneDesignSubgraph(f.graph, [f.root.id]); expect(prepareNativeSceneLayout(kit, copy, [f.root.id])).toEqual({ needed: true }); expect(hasNativeSceneLayout(copy)).toBe(true); const artwork = renderNativeSceneImage(kit, copy, copy.getNode(f.root.id)!), model = selectionToDesignModel(f.graph, [f.root.id], kit, true); expect(model.prototypeIssues).toEqual([]); expect(pixels(imageBytes(model.nodes[0]!.image!))).toEqual(await oracle(f, cloneDesignSubgraph(f.graph, [f.root.id]), artwork)); for (const child of model.nodes[0]!.children) { const native = copy.getNode(child.sourceId!)!; expect(child.style).toMatchObject({ position: 'absolute', left: native.x, top: native.y, width: native.width, height: native.height }); } expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('uses prepared native glyph measurement for wrapped text and restores the previous measurer', async () => {
  const f = fixture('HORIZONTAL', true), original = getTextMeasurer(), previous = () => ({ width: 777, height: 999 });
  try {
    await prepareDesignModelFonts(f.graph, [f.root.id]); setTextMeasurer(previous); const before = serializeGraph(f.graph), copy = cloneDesignSubgraph(f.graph, [f.root.id]); prepareNativeSceneLayout(kit, copy, [f.root.id]); expect(getTextMeasurer()).toBe(previous); const text = copy.getNode(f.flexible.id)!; expect(text.width).toBe(104); expect(text.height).toBeGreaterThan(24); expect(text.height).toBeLessThan(999); const artwork = renderNativeSceneImage(kit, copy, copy.getNode(f.root.id)!), model = selectionToDesignModel(f.graph, [f.root.id], kit, true); expect(model.prototypeIssues).toEqual([]); expect(model.nodes[0]!.children[1]!.style.height).toBe(text.height); expect(pixels(imageBytes(model.nodes[0]!.image!))).toEqual(await oracle(f, cloneDesignSubgraph(f.graph, [f.root.id]), artwork)); expect(getTextMeasurer()).toBe(previous); expect(serializeGraph(f.graph)).toBe(before);
  } finally { setTextMeasurer(original); f.editor.dispose(); }
});
it('retains a native-layout diagnostic when the exact text font is unavailable, without allocating or substituting it', () => {
  const f = fixture('HORIZONTAL', true);
  try {
    f.flexible.fontFamily = 'Unavailable layout font'; const before = serializeGraph(f.graph), allocate = vi.spyOn(kit, 'Malloc'), copy = cloneDesignSubgraph(f.graph, [f.root.id]); expect(prepareNativeSceneLayout(kit, copy, [f.root.id]).issue).toContain('exact fonts'); expect(hasNativeSceneLayout(copy)).toBe(false); expect(allocate).not.toHaveBeenCalled(); expect(selectionToDesignModel(f.graph, [f.root.id], kit, true).prototypeIssues.join(' ')).toContain('exact fonts'); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it.each([Infinity, -1])('rejects invalid native layout width %s before entering Yoga or allocating a renderer', value => {
  const f = fixture(); try { f.root.width = value; const before = serializeGraph(f.graph), copy = cloneDesignSubgraph(f.graph, [f.root.id]), allocate = vi.spyOn(kit, 'Malloc'); expect(() => prepareNativeSceneLayout(kit, copy, [f.root.id])).toThrow('invalid native layout geometry'); expect(allocate).not.toHaveBeenCalled(); expect(hasNativeSceneLayout(copy)).toBe(false); expect(serializeGraph(f.graph)).toBe(before); } finally { f.editor.dispose(); }
});
it('refuses nonsettling native text layout and restores the previous measurer instead of publishing moving hit regions', async () => {
  const f = fixture('HORIZONTAL', true), previous = getTextMeasurer();
  try { f.root.counterAxisSizing = 'HUG'; await prepareDesignModelFonts(f.graph, [f.root.id]); const before = serializeGraph(f.graph), copy = cloneDesignSubgraph(f.graph, [f.root.id]); vi.spyOn(SkiaRenderer.prototype, 'measureTextNode').mockImplementation((node, width) => ({ width: width ?? node.width, height: node.height + 1 })); expect(() => prepareNativeSceneLayout(kit, copy, [f.root.id])).toThrow('did not settle'); expect(hasNativeSceneLayout(copy)).toBe(false); expect(getTextMeasurer()).toBe(previous); expect(serializeGraph(f.graph)).toBe(before); } finally { f.editor.dispose(); }
});
it.each(['surface', 'measurement', 'cleanup', 'registration'] as const)('restores font/measurer ownership and closes known native resources after layout %s failure', async mode => {
  const f = fixture('HORIZONTAL', true); await prepareDesignModelFonts(f.graph, [f.root.id]); const originalMeasurer = getTextMeasurer(), originalProvider = kit.TypefaceFontProvider.Make(); fontManager.attachProvider(kit, originalProvider); const before = serializeGraph(f.graph), failure = new Error('native layout failure'), local = Object.create(kit) as CanvasKit, providers: TypefaceFontProvider[] = [], malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free');
  Object.defineProperty(local, 'TypefaceFontProvider', { value: { Make: () => { const provider = kit.TypefaceFontProvider.Make(); providers.push(provider); if (mode === 'registration') vi.spyOn(provider, 'registerFont').mockImplementation(() => { throw failure; }); return provider; } } });
  if (mode === 'surface') Object.defineProperty(local, 'MakeRasterDirectSurface', { value: () => null });
  if (mode === 'measurement') vi.spyOn(SkiaRenderer.prototype, 'measureTextNode').mockImplementationOnce(() => { throw failure; });
  if (mode === 'cleanup') { const measure = SkiaRenderer.prototype.measureTextNode; vi.spyOn(SkiaRenderer.prototype, 'measureTextNode').mockImplementationOnce(function (this: SkiaRenderer, ...args) { vi.spyOn(this.fillPaint, 'delete').mockImplementationOnce(() => { throw failure; }); return measure.apply(this, args); }); }
  try {
    const copy = cloneDesignSubgraph(f.graph, [f.root.id]); expect(() => prepareNativeSceneLayout(local, copy, [f.root.id])).toThrow(mode === 'surface' ? 'native layout surface' : failure); expect(getTextMeasurer()).toBe(originalMeasurer); expect(fontManager.provider()).toBe(originalProvider); expect(originalProvider.isDeleted()).toBe(false); expect(providers.every(provider => provider.isDeleted())).toBe(true); expect(providers).toHaveLength(mode === 'surface' ? 0 : 1); expect(free.mock.calls.map(([value]) => value)).toEqual(malloc.mock.results.map(result => result.value)); expect(serializeGraph(f.graph)).toBe(before);
  } finally { fontManager.detachProvider(originalProvider); originalProvider.delete(); setTextMeasurer(originalMeasurer); f.editor.dispose(); }
});
