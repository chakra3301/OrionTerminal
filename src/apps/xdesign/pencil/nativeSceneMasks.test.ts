// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit, Surface } from 'canvaskit-wasm';
import type { MaskType } from '@open-pencil/scene-graph';
import { nativeSceneArtworkPlan, renderNativeSceneImage } from './nativeSceneArtwork';
import { selectionToDesignModel, selectionToReact } from './reactExport';
import { capturePrototypeVariables } from './prototypeVariableGraph';
import { assignPrototypeVariable, emptyPrototypeSession } from './prototypeValues';
import { serializeGraph } from './document';
import { setPrototypeInteractions } from './prototype';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
afterEach(() => vi.restoreAllMocks());
const paint = (r = 1, g = 1, b = 1, a = 1) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g, b, a } });
function fixture(type: MaskType = 'ALPHA') {
  const editor = createEditor(), graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Masked', width: 64, height: 48, fills: [], clipsContent: false }), mask = graph.createNode('RECTANGLE', frame.id, { name: 'Shape', x: 8, y: 8, width: 24, height: 24, isMask: true, maskType: type, fills: [paint()] }), target = graph.createNode('RECTANGLE', frame.id, { name: 'Target', width: 64, height: 48, fills: [paint(1, 0, 0)] });
  setPrototypeInteractions(editor, target, [{ id: 'activate', trigger: { type: 'click' }, navigation: { action: 'back', transition: 'instant', duration: 0 } }]);
  return { editor, graph, frame, mask, target };
}
function pixels(bytes: Uint8Array) {
  const image = kit.MakeImageFromEncoded(bytes)!;
  try { return { width: image.width(), height: image.height(), rgba: new Uint8Array(image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!) }; } finally { image.delete(); }
}
function alphaAt(artwork: ReturnType<typeof renderNativeSceneImage>, x: number, y: number) {
  const p = pixels(artwork.bytes), px = Math.floor((x - artwork.bounds.minX) * artwork.scale), py = Math.floor((y - artwork.bounds.minY) * artwork.scale); return p.rgba[(py * p.width + px) * 4 + 3];
}
it.each(['ALPHA', 'VECTOR', 'LUMINANCE'] as const)('composes %s masks with covered semantic regions and preserves original bytes', type => {
  const f = fixture(type);
  try {
    const before = serializeGraph(f.graph), artwork = renderNativeSceneImage(kit, f.graph, f.frame), region = artwork.maskRegions.get(f.frame.id)![0]!, model = selectionToDesignModel(f.graph, [f.frame.id], kit, true), semantic = model.nodes[0]!.children[0]!;
    expect(nativeSceneArtworkPlan(f.graph, f.frame)).toEqual({ needed: true }); expect(model.prototypeIssues).toEqual([]); expect(alphaAt(artwork, 16, 16)).toBe(255); expect(alphaAt(artwork, 40, 16)).toBe(0); expect(region.masks).toEqual([f.mask.id]); expect(region.children).toEqual([f.target.id]);
    const path = kit.Path.MakeFromSVGString(region.path)!; try { expect(path.contains(16, 16)).toBe(true); expect(path.contains(40, 16)).toBe(false); } finally { path.delete(); }
    expect(semantic.maskPath).toBe(region.path); expect(semantic.children[0]!.sourceId).toBe(f.target.id); expect(semantic.children[0]!.sceneCovered).toBe(true); expect(semantic.children[0]!.image).toBeUndefined(); expect(semantic.children[0]!.interactions?.[0]?.id).toBe('activate'); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('uses layer and paint alpha once and makes vector coverage opaque regardless of paint/layer opacity', () => {
  const f = fixture();
  try {
    f.mask.opacity = .3; f.mask.fills[0]!.color!.a = .5; const before = serializeGraph(f.graph), alpha = renderNativeSceneImage(kit, f.graph, f.frame); expect(alphaAt(alpha, 16, 16)).toBeGreaterThanOrEqual(37); expect(alphaAt(alpha, 16, 16)).toBeLessThanOrEqual(39); expect(serializeGraph(f.graph)).toBe(before);
    f.mask.maskType = 'VECTOR'; expect(alphaAt(renderNativeSceneImage(kit, f.graph, f.frame), 16, 16)).toBe(255);
  } finally { f.editor.dispose(); }
});
it('matches an independently calculated complete RGBA rectangle mask', () => {
  const f = fixture();
  try {
    const before = serializeGraph(f.graph), artwork = renderNativeSceneImage(kit, f.graph, f.frame), p = pixels(artwork.bytes), expected = new Uint8Array(p.width * p.height * 4);
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (x >= 8 * artwork.scale && x < 32 * artwork.scale && y >= 8 * artwork.scale && y < 32 * artwork.scale) { expected[(y * p.width + x) * 4] = 255; expected[(y * p.width + x) * 4 + 3] = 255; }
    expect(p.rgba).toEqual(expected); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('matches every native alpha pixel with the generated hit path, including ellipse holes and soft edges', () => {
  const f = fixture();
  try {
    f.mask.type = 'ELLIPSE'; f.mask.opacity = .2; const before = serializeGraph(f.graph), artwork = renderNativeSceneImage(kit, f.graph, f.frame), p = pixels(artwork.bytes), path = kit.Path.MakeFromSVGString(artwork.maskRegions.get(f.frame.id)![0]!.path)!, actual = new Uint8Array(p.width * p.height), expected = new Uint8Array(p.width * p.height);
    try { for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) { actual[y * p.width + x] = Number(path.contains(artwork.bounds.minX + (x + .5) / artwork.scale, artwork.bounds.minY + (y + .5) / artwork.scale)); expected[y * p.width + x] = Number(p.rgba[(y * p.width + x) * 4 + 3]! > 0); } } finally { path.delete(); }
    expect(actual).toEqual(expected); expect(expected.includes(0)).toBe(true); expect(expected.includes(1)).toBe(true); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('hides fully black luminance regions and reveals their current variable-selected brightness without authoring changes', () => {
  const f = fixture('LUMINANCE');
  try {
    const collection = f.graph.createCollection('Mask'), color = f.graph.createVariable('Light', 'COLOR', collection.id, { r: 0, g: 0, b: 0, a: 1 }); f.graph.bindVariable(f.mask.id, 'fills/0/color', color.id); const before = serializeGraph(f.graph), definitions = capturePrototypeVariables(f.graph), session = assignPrototypeVariable(definitions, emptyPrototypeSession(), color.id, { type: 'literal', value: { r: 1, g: 1, b: 1, a: 1 } });
    const dark = selectionToDesignModel(f.graph, [f.frame.id], kit, true), light = selectionToDesignModel(f.graph, [f.frame.id], kit, true, session); expect(dark.nodes[0]!.children[0]!.visible).toBe(false); expect(dark.nodes[0]!.children[0]!.maskPath).toBe(''); expect(light.nodes[0]!.children[0]!.visible).toBe(true); expect(light.nodes[0]!.children[0]!.maskPath).toBeTruthy(); expect(dark.nodes[0]!.image).not.toBe(light.nodes[0]!.image); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('unions consecutive masks, retains their following sibling ranges and changes region coverage when masks become hidden', () => {
  const f = fixture();
  try {
    const second = f.graph.createNode('RECTANGLE', f.frame.id, { x: 40, y: 8, width: 8, height: 24, isMask: true, fills: [paint()] }), nextMask = f.graph.createNode('RECTANGLE', f.frame.id, { x: 8, y: 36, width: 24, height: 8, isMask: true, fills: [paint()] }), next = f.graph.createNode('RECTANGLE', f.frame.id, { width: 64, height: 48, fills: [paint(0, 0, 1)] }); f.frame.childIds = [f.mask.id, second.id, f.target.id, nextMask.id, next.id];
    const before = serializeGraph(f.graph), artwork = renderNativeSceneImage(kit, f.graph, f.frame), regions = artwork.maskRegions.get(f.frame.id)!; expect(regions.map(region => [region.masks, region.children])).toEqual([[[f.mask.id, second.id], [f.target.id]], [[nextMask.id], [next.id]]]); expect(alphaAt(artwork, 16, 16)).toBe(255); expect(alphaAt(artwork, 44, 16)).toBe(255); expect(alphaAt(artwork, 36, 16)).toBe(0); expect(alphaAt(artwork, 16, 40)).toBe(255); expect(serializeGraph(f.graph)).toBe(before);
    second.visible = false; const hidden = renderNativeSceneImage(kit, f.graph, f.frame); expect(alphaAt(hidden, 44, 16)).toBe(0); expect(hidden.maskRegions.get(f.frame.id)![0]!.masks).toEqual([f.mask.id]);
  } finally { f.editor.dispose(); }
});
it('renders group masks and nested masks, preserving overflow transforms and excluding mask source children from semantics', () => {
  const f = fixture();
  try {
    f.mask.type = 'GROUP'; f.mask.fills = []; f.mask.x = 4; f.mask.y = 4; f.mask.rotation = 20; f.mask.flipX = true; const innerMask = f.graph.createNode('ELLIPSE', f.mask.id, { x: 4, y: 4, width: 16, height: 16, isMask: true, fills: [paint()] }); f.graph.createNode('RECTANGLE', f.mask.id, { x: -4, y: -4, width: 32, height: 32, fills: [paint()] }); const before = serializeGraph(f.graph), artwork = renderNativeSceneImage(kit, f.graph, f.frame), model = selectionToDesignModel(f.graph, [f.frame.id], kit, true);
    expect(artwork.maskRegions.size).toBe(1); expect(artwork.maskRegions.has(innerMask.id)).toBe(false); expect(pixels(artwork.bytes).rgba.some((value, index) => index % 4 === 3 && value > 0)).toBe(true); expect(model.nodes[0]!.children[0]!.children.map(child => child.sourceId)).toEqual([f.target.id]); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('removes disjoint nested targets from keyboard access while retaining visible overflow under an outside container', () => {
  const f = fixture();
  try {
    f.target.type = 'FRAME'; f.target.fills = []; f.target.clipsContent = false; const inner = f.graph.createNode('RECTANGLE', f.target.id, { x: 40, y: 8, width: 16, height: 16, isMask: true, fills: [paint()] }), hidden = f.graph.createNode('RECTANGLE', f.target.id, { name: 'Disjoint', width: 64, height: 48, fills: [paint()] }); setPrototypeInteractions(f.editor, hidden, [{ id: 'invisible', trigger: { type: 'click' }, navigation: { action: 'back', transition: 'instant', duration: 0 } }]);
    const model = selectionToDesignModel(f.graph, [f.frame.id], kit, true), descendant = model.nodes[0]!.children[0]!.children[0]!.children[0]!.children[0]!; expect(descendant.sourceId).toBe(hidden.id); expect(descendant.visible).toBe(false); expect(descendant.hitHidden).toBe(true);
    inner.visible = false; hidden.visible = false; f.target.x = 40; f.target.y = 8; f.target.width = 8; f.target.height = 8; const visible = f.graph.createNode('RECTANGLE', f.target.id, { name: 'Overflow', x: -28, width: 16, height: 16, fills: [paint()] }); const before = serializeGraph(f.graph), current = selectionToDesignModel(f.graph, [f.frame.id], kit, true), container = current.nodes[0]!.children[0]!.children[0]!; expect(container.sourceId).toBe(f.target.id); expect(container.hitHidden).toBe(true); expect(container.visible).toBe(true); expect(container.children.find(child => child.sourceId === visible.id)!.visible).toBe(true); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('exports static masked artwork with inline React clipping and rejects a selected mask without its containing group', () => {
  const f = fixture(); try { const before = serializeGraph(f.graph), output = selectionToReact(f.graph, [f.frame.id], 'Masked', kit); expect(output.code).toContain('maskPath'); expect(output.code).toContain('clipPathUnits="userSpaceOnUse"'); expect(() => selectionToDesignModel(f.graph, [f.mask.id], kit, true)).toThrow('containing group'); expect(serializeGraph(f.graph)).toBe(before); } finally { f.editor.dispose(); }
});
it('bounds mask count before native allocation and releases capture resources after alpha-read failure', () => {
  const f = fixture(), malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free');
  try {
    for (let i = 0; i < 128; i++) f.graph.createNode('RECTANGLE', f.frame.id, { width: 1, height: 1, isMask: true, fills: [paint()] }); expect(() => renderNativeSceneImage(kit, f.graph, f.frame)).toThrow('128 native mask'); expect(malloc).not.toHaveBeenCalled();
    f.frame.childIds = [f.mask.id, f.target.id]; const local = Object.create(kit) as CanvasKit, surfaces: Surface[] = []; let allocations = 0;
    Object.defineProperty(local, 'MakeRasterDirectSurface', { value: (...args: Parameters<CanvasKit['MakeRasterDirectSurface']>) => { const surface = kit.MakeRasterDirectSurface(...args)!; surfaces.push(surface); if (++allocations === 4) { const original = surface.makeImageSnapshot; vi.spyOn(surface, 'makeImageSnapshot').mockImplementation(() => { const image = original.call(surface); vi.spyOn(image, 'readPixels').mockReturnValue(null); return image; }); } return surface; } }); const before = serializeGraph(f.graph);
    expect(() => renderNativeSceneImage(local, f.graph, f.frame)).toThrow('hit-region pixels'); expect(surfaces.every(surface => surface.isDeleted())).toBe(true);
    const buffers = malloc.mock.results.map(result => result.value), freed = free.mock.calls.map(([value]) => value);
    expect(buffers).toHaveLength(5); expect(freed).toHaveLength(5);
    [buffers[0], buffers[1], buffers[4], buffers[2], buffers[3]].forEach((buffer, index) => expect(freed[index]).toBe(buffer));
    expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
