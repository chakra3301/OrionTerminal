// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import { fontManager } from '@open-pencil/core/text';
import { renderNodesToImage } from '@open-pencil/core/io';
import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm';
import { nativeSceneArtworkPlan, renderNativeSceneImage } from './nativeSceneArtwork';
import { createNativeRenderer, destroyNativeRenderer } from './nativeRendererLifecycle';
import { prepareDesignModelFonts, selectionToDesignModel } from './reactExport';
import { capturePrototypeVariables, materializePrototypeBindings } from './prototypeVariableGraph';
import { assignPrototypeVariable, emptyPrototypeSession, setPrototypeSessionMode, type PrototypeSession } from './prototypeValues';
import { cloneDesignSubgraph } from './graphSubset';
import { serializeGraph } from './document';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); fontManager.setOnlineFontProviders({ google: false, fontshare: false, fontsource: false }); });
afterEach(() => vi.restoreAllMocks());
const solid = (r = 1, b = 0) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g: 0, b, a: 1 } });
const effect = { type: 'LAYER_BLUR' as const, visible: true, radius: 3, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } };
function fixture(text = false) {
  const editor = createEditor(), graph = editor.graph, root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Scene', width: 120, height: 60, fills: [], effects: [effect], clipsContent: false });
  const child = graph.createNode(text ? 'TEXT' : 'RECTANGLE', root.id, { name: 'Artwork', x: 10, y: 8, width: 80, height: 28, fills: [solid()], text: 'Ready café', fontFamily: 'Inter', fontSize: 18, fontWeight: 400, styleRuns: text ? [{ start: 6, length: 4, style: { fontWeight: 700, fills: [solid(0, 1)] } }] : [] });
  return { editor, graph, root, child };
}
function decoded(bytes: Uint8Array) {
  const image = kit.MakeImageFromEncoded(bytes)!;
  try { return { width: image.width(), height: image.height(), rgba: new Uint8Array(image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!) }; } finally { image.delete(); }
}
function imageBytes(image: string) { return new Uint8Array(Buffer.from(image.split('base64,')[1]!, 'base64')); }
async function independentScene(f: ReturnType<typeof fixture>, artwork: ReturnType<typeof renderNativeSceneImage>, session?: PrototypeSession) {
  const copy = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(copy, capturePrototypeVariables(f.graph), session, { detachResolved: true });
  const root = copy.getNode(f.root.id)!, page = copy.getNode(f.editor.state.currentPageId)!, size = decoded(artwork.bytes), wrapper = copy.createNode('FRAME', page.id, { width: size.width / artwork.scale, height: size.height / artwork.scale, fills: [], clipsContent: false });
  Object.assign(root, { parentId: wrapper.id, x: -artwork.bounds.minX, y: -artwork.bounds.minY, rotation: 0, flipX: false, flipY: false, opacity: 1, visible: true }); wrapper.childIds = [root.id]; page.childIds = [wrapper.id]; copy.clearAbsPosCache();
  const backing = kit.Malloc(Uint8Array, 64 * 64 * 4), surface = kit.MakeRasterDirectSurface({ width: 64, height: 64, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, backing, 64 * 4)!, renderer = createNativeRenderer(kit, surface);
  try { await renderer.loadFonts(); return decoded(renderNodesToImage(kit, renderer, copy, page.id, [wrapper.id], { format: 'PNG', scale: artwork.scale })!); } finally { destroyNativeRenderer(renderer); kit.Free(backing); }
}
it('renders prepared mixed-weight text through native group blur with exact SDK pixels and preserved semantic text', async () => {
  const f = fixture(true);
  try {
    const before = serializeGraph(f.graph); await prepareDesignModelFonts(f.graph, [f.root.id]); expect(nativeSceneArtworkPlan(f.graph, f.root)).toEqual({ needed: true });
    const artwork = renderNativeSceneImage(kit, f.graph, f.root), pixels = decoded(artwork.bytes); expect(pixels).toEqual(await independentScene(f, artwork)); expect(pixels.rgba.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    const model = selectionToDesignModel(f.graph, [f.root.id], kit, true); expect(model.prototypeIssues).toEqual([]); expect(model.nodes[0]!.children[0]!.text).toBe('Ready café'); expect(model.nodes[0]!.children[0]!.runs).toHaveLength(2); expect(model.nodes[0]!.children[0]!.sceneCovered).toBe(true); expect(model.nodes[0]!.children[0]!.image).toBeUndefined(); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('checks the text node itself and every styled-run face before admitting a native group', async () => {
  const f = fixture(true);
  try {
    await prepareDesignModelFonts(f.graph, [f.root.id]); expect(nativeSceneArtworkPlan(f.graph, f.root)).toEqual({ needed: true }); f.child.styleRuns[0]!.style.fontFamily = 'Unavailable styled scene face'; const before = serializeGraph(f.graph);
    const plan = nativeSceneArtworkPlan(f.graph, f.root); expect(plan.issue).toContain('text fonts that are loading or unavailable'); expect(() => renderNativeSceneImage(kit, f.graph, f.root)).toThrow(plan.issue); expect(selectionToDesignModel(f.graph, [f.root.id], kit, true).prototypeIssues.join(' ')).toContain('text fonts that are loading or unavailable'); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('updates assigned group fill/stroke colors, width, stroke weight and root opacity in native presentation without changing definitions', async () => {
  const f = fixture();
  try {
    const collection = f.graph.createCollection('Session'), ink = f.graph.createVariable('Ink', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }), width = f.graph.createVariable('Width', 'FLOAT', collection.id, 80), weight = f.graph.createVariable('Stroke', 'FLOAT', collection.id, 1), opacity = f.graph.createVariable('Opacity', 'FLOAT', collection.id, 1);
    f.child.strokes = [{ color: { r: 1, g: 0, b: 0, a: 1 }, weight: 1, align: 'OUTSIDE', opacity: 1, visible: true }];
    for (const [field, variable] of [['fills/0/color', ink.id], ['strokes/0/color', ink.id], ['width', width.id], ['strokeWeight', weight.id]]) f.graph.bindVariable(f.child.id, field!, variable!); f.graph.bindVariable(f.root.id, 'opacity', opacity.id);
    const definitions = capturePrototypeVariables(f.graph); let session = assignPrototypeVariable(definitions, emptyPrototypeSession(), ink.id, { type: 'literal', value: { r: 0, g: 0, b: 1, a: 1 } }); session = assignPrototypeVariable(definitions, session, width.id, { type: 'literal', value: 40 }); session = assignPrototypeVariable(definitions, session, weight.id, { type: 'literal', value: 4 }); session = assignPrototypeVariable(definitions, session, opacity.id, { type: 'literal', value: .5 });
    const before = serializeGraph(f.graph), model = selectionToDesignModel(f.graph, [f.root.id], kit, true, session), root = model.nodes[0]!; expect(root.motion?.composition).toBe('scene'); expect(root.style.opacity).toBe(.5); expect(root.children[0]!.style.width).toBe(40); expect(model.prototypeIssues).toEqual([]);
    const pixels = decoded(imageBytes(root.image!)); expect(pixels.rgba.some((value, index) => index % 4 === 2 && value > 200 && pixels.rgba[index + 1]! > 0)).toBe(true); expect(pixels.rgba.filter((_, index) => index % 4 === 0).every(value => value === 0)).toBe(true);
    const snapshot = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(snapshot, definitions, session, { detachResolved: true }); expect(snapshot.getNode(f.child.id)!.strokes[0]!.weight).toBe(4); expect(snapshot.getNode(f.child.id)!.boundVariables).toEqual({}); const artwork = renderNativeSceneImage(kit, snapshot, snapshot.getNode(f.root.id)!); expect(decoded(artwork.bytes)).toEqual(await independentScene(f, artwork, session)); expect(serializeGraph(f.graph)).toBe(before);
    expect(selectionToDesignModel(f.graph, [f.root.id], kit).prototypeIssues.join(' ')).toContain('variable-bound artwork');
  } finally { f.editor.dispose(); }
});
it('prepares the current session font and text size rather than saved unavailable definitions', async () => {
  const f = fixture(true);
  try {
    f.child.fontFamily = 'Unavailable saved scene font'; const collection = f.graph.createCollection('Typography'), family = f.graph.createVariable('Family', 'STRING', collection.id, f.child.fontFamily), size = f.graph.createVariable('Size', 'FLOAT', collection.id, 18); f.graph.bindVariable(f.child.id, 'fontFamily', family.id); f.graph.bindVariable(f.child.id, 'fontSize', size.id);
    const definitions = capturePrototypeVariables(f.graph), session = assignPrototypeVariable(definitions, assignPrototypeVariable(definitions, emptyPrototypeSession(), family.id, { type: 'literal', value: 'Inter' }), size.id, { type: 'literal', value: 24 }), before = serializeGraph(f.graph);
    await prepareDesignModelFonts(f.graph, [f.root.id], session); const model = selectionToDesignModel(f.graph, [f.root.id], kit, true, session), text = model.nodes[0]!.children[0]!; expect(model.prototypeIssues).toEqual([]); expect(text.style.fontFamily).toContain('Inter'); expect(text.style.fontSize).toBe(24); expect(text.sceneCovered).toBe(true);
    const snapshot = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(snapshot, definitions, session, { detachResolved: true }); const artwork = renderNativeSceneImage(kit, snapshot, snapshot.getNode(f.root.id)!); expect(decoded(imageBytes(model.nodes[0]!.image!))).toEqual(await independentScene(f, artwork, session)); expect(serializeGraph(f.graph)).toBe(before); expect(f.child.fontFamily).toBe('Unavailable saved scene font');
  } finally { f.editor.dispose(); }
});
it('rebuilds inherited modes and formerly hidden variable artwork while retaining explicit child modes', () => {
  const f = fixture();
  try {
    const collection = f.graph.createCollection('Theme'), dark = 'dark'; f.graph.addMode(collection.id, dark, 'Dark'); const ink = f.graph.createVariable('Ink', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }), shown = f.graph.createVariable('Shown', 'BOOLEAN', collection.id, false); f.editor.updateVariableValue(ink.id, dark, { r: 0, g: 0, b: 1, a: 1 });
    f.graph.bindVariable(f.child.id, 'fills/0/color', ink.id); f.graph.bindVariable(f.child.id, 'visible', shown.id); f.child.visible = false;
    const pinned = f.graph.createNode('RECTANGLE', f.root.id, { name: 'Pinned', x: 96, y: 8, width: 12, height: 12, fills: [solid()], variableModes: { [collection.id]: collection.defaultModeId } }); f.graph.bindVariable(pinned.id, 'fills/0/color', ink.id);
    const defs = capturePrototypeVariables(f.graph), session = assignPrototypeVariable(defs, setPrototypeSessionMode(defs, emptyPrototypeSession(), collection.id, dark), shown.id, { type: 'literal', value: true }), before = serializeGraph(f.graph);
    const baseline = selectionToDesignModel(f.graph, [f.root.id], kit, true), current = selectionToDesignModel(f.graph, [f.root.id], kit, true, session); expect(baseline.nodes[0]!.children[0]!.visible).toBe(false); expect(current.nodes[0]!.children[0]!.visible).toBe(true); expect(current.nodes[0]!.children.every(node => node.sceneCovered)).toBe(true); expect(current.nodes[0]!.image).not.toBe(baseline.nodes[0]!.image);
    const pixels = decoded(imageBytes(current.nodes[0]!.image!)); expect(pixels.rgba.some((value, index) => index % 4 === 0 && value > 200)).toBe(true); expect(pixels.rgba.some((value, index) => index % 4 === 2 && value > 200)).toBe(true); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('preserves unresolved binding diagnostics and rejects unavailable paints before a native snapshot can misrepresent the session', () => {
  const f = fixture();
  try {
    const collection = f.graph.createCollection('Unknown'), variable = f.graph.createVariable('Value', 'FLOAT', collection.id, 2); f.child.boundVariables = { unsupported: variable.id }; const before = serializeGraph(f.graph); expect(selectionToDesignModel(f.graph, [f.root.id], kit, true).prototypeIssues.join(' ')).toContain('variable-bound artwork'); expect(serializeGraph(f.graph)).toBe(before);
    const ink = f.graph.createVariable('Ink', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }); f.child.boundVariables = { 'fills/1/color': ink.id }; expect(() => selectionToDesignModel(f.graph, [f.root.id], kit, true)).toThrow('unavailable paint');
  } finally { f.editor.dispose(); }
});
it.each(['success', 'registration', 'glyphs', 'cleanup'] as const)('preserves the active font provider and closes its private provider on %s', async mode => {
  const f = fixture(true); await prepareDesignModelFonts(f.graph, [f.root.id]); const original = kit.TypefaceFontProvider.Make(); fontManager.attachProvider(kit, original);
  const local = Object.create(kit) as CanvasKit, providers: TypefaceFontProvider[] = [], failure = new Error('private font failure'), malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free');
  Object.defineProperty(local, 'TypefaceFontProvider', { value: { Make: () => { const provider = kit.TypefaceFontProvider.Make(); providers.push(provider); if (mode === 'registration') vi.spyOn(provider, 'registerFont').mockImplementation(() => { throw failure; }); return provider; } } });
  if (mode === 'glyphs') vi.spyOn(SkiaRenderer.prototype, 'nodeFontReadiness').mockReturnValueOnce('pending');
  if (mode === 'cleanup') { const render = SkiaRenderer.prototype.renderNode; vi.spyOn(SkiaRenderer.prototype, 'renderNode').mockImplementationOnce(function (this: SkiaRenderer, ...args) { vi.spyOn(this.fillPaint, 'delete').mockImplementationOnce(() => { throw failure; }); return render.apply(this, args); }); }
  try {
    if (mode === 'success') expect(renderNativeSceneImage(local, f.graph, f.root).bytes.length).toBeGreaterThan(0);
    else expect(() => renderNativeSceneImage(local, f.graph, f.root)).toThrow(mode === 'glyphs' ? 'every glyph and font' : failure);
    expect(providers).toHaveLength(1); expect(providers[0]!.isDeleted()).toBe(true); expect(fontManager.provider()).toBe(original); expect(original.isDeleted()).toBe(false); expect(free.mock.calls.map(([value]) => value)).toEqual(malloc.mock.results.map(result => result.value));
  } finally { fontManager.detachProvider(original); original.delete(); f.editor.dispose(); }
});
