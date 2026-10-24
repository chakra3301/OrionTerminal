// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { renderNodesToImage } from '@open-pencil/core/io';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit, Surface } from 'canvaskit-wasm';
import { nativeSceneArtworkPlan, renderNativeReactLayer, renderNativeSceneImage } from './nativeSceneArtwork';
import { cloneDesignSubgraph } from './graphSubset';
import { createNativeRenderer, destroyNativeRenderer } from './nativeRendererLifecycle';
import { selectionToDesignModel } from './reactExport';
import { serializeGraph } from './document';
import { setPrototypeScroll } from './prototypeScroll';
import { setPrototypeInteractions } from './prototype';
import { prepareNativeSceneComponents } from './nativeSceneComponents';
import { installSlotSupport } from './slots';
import { renderDesignNodes } from './proceduralPaints';
import { setComponentBehaviour } from './behaviour/editor';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
afterEach(() => vi.restoreAllMocks());
const paint = (r = 1, b = 0) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g: 0, b, a: 1 } });
const blur = (radius = 6) => ({ type: 'LAYER_BLUR' as const, visible: true, radius, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } });
function fixture() {
  const editor = createEditor(), root = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Composed', x: 140, y: 90, width: 64, height: 48, fills: [], clipsContent: false, effects: [blur()] });
  const child = editor.graph.createNode('RECTANGLE', root.id, { name: 'Child', x: 12, y: 8, width: 24, height: 24, fills: [paint()] });
  return { editor, root, child };
}
function pixels(bytes: Uint8Array) {
  const image = kit.MakeImageFromEncoded(bytes)!;
  try { return { width: image.width(), height: image.height(), rgba: new Uint8Array(image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!) }; } finally { image.delete(); }
}
function independentExport(graph: SceneGraph, node: SceneNode, artwork: ReturnType<typeof renderNativeSceneImage>) {
  const copy = cloneDesignSubgraph(graph, [node.id]), root = copy.getNode(node.id)!;
  let page = root; while (page.parentId && page.type !== 'CANVAS') page = copy.getNode(page.parentId)!;
  const wrapper = copy.createNode('FRAME', page.id, { width: pixels(artwork.bytes).width / artwork.scale, height: pixels(artwork.bytes).height / artwork.scale, fills: [], clipsContent: false });
  Object.assign(root, { parentId: wrapper.id, x: -artwork.bounds.minX, y: -artwork.bounds.minY, rotation: 0, flipX: false, flipY: false, opacity: 1, visible: true }); wrapper.childIds = [root.id]; page.childIds = [wrapper.id]; copy.clearAbsPosCache();
  const backing = kit.Malloc(Uint8Array, 64 * 64 * 4), surface = kit.MakeRasterDirectSurface({ width: 64, height: 64, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, backing, 64 * 4)!;
  const renderer = createNativeRenderer(kit, surface);
  try { return pixels(renderNodesToImage(kit, renderer, copy, page.id, [wrapper.id], { format: 'PNG', scale: artwork.scale })!); } finally { destroyNativeRenderer(renderer); kit.Free(backing); }
}
it.each(['horizontal', 'vertical'] as const)('captures a zero-axis %s native layer with finite pixel placement', axis => {
  const editor = createEditor(), graph = editor.graph;
  try {
    const line = graph.createNode('LINE', editor.state.currentPageId, { name: 'Zero axis', width: axis === 'horizontal' ? 32 : 0, height: axis === 'vertical' ? 32 : 0, fills: [], strokeCap: 'SQUARE', strokes: [{ color: { r: 1, g: 0, b: 0, a: 1 }, visible: true, opacity: 1, weight: 6, align: 'CENTER', cap: 'SQUARE' }] });
    const before = serializeGraph(graph), artwork = renderNativeReactLayer(kit, graph, line.id), actual = pixels(artwork.bytes);
    expect(actual.rgba.some((value, index) => index % 4 === 3 && value === 255)).toBe(true);
    expect(Object.values(artwork.style).every(value => !String(value).includes('Infinity') && !String(value).includes('NaN'))).toBe(true);
    expect(axis === 'horizontal' ? artwork.style.top : artwork.style.left).toBe('-3px');
    expect(axis === 'horizontal' ? artwork.style.height : artwork.style.width).toBe('6px');
    expect(axis === 'horizontal' ? actual.height : actual.width).toBe(12);
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});
it('composes assigned nested swaps and visibility with exact independent native pixels and preserved navigation', () => {
  const { editor, root, child } = fixture(); installSlotSupport(editor.graph);
  try {
    const graph = editor.graph, main = graph.createNode('COMPONENT', editor.state.currentPageId, { name: 'Card', width: 40, height: 30, fills: [] });
    const old = graph.createNode('COMPONENT', editor.state.currentPageId, { name: 'Old icon', width: 12, height: 12, fills: [paint()] });
    const replacement = graph.createNode('COMPONENT', editor.state.currentPageId, { name: 'New icon', width: 16, height: 10, fills: [paint(0, 1)], componentKey: 'new-icon-key' });
    const nested = graph.createInstance(old.id, main.id, { x: 8, y: 5 })!;
    nested.componentPropertyReferences = [{ propertyId: 'icon', field: 'INSTANCE_SWAP' }];
    main.componentPropertyDefinitions = [{ id: 'icon', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: old.id }, { id: 'visible', name: 'Visible', type: 'BOOLEAN', defaultValue: 'true' }];
    graph.createNode('RECTANGLE', main.id, { name: 'Optional', x: 4, y: 19, width: 12, height: 8, fills: [paint()], componentPropertyReferences: [{ propertyId: 'visible', field: 'VISIBLE' }] });
    const placed = graph.createInstance(main.id, root.id, { x: 20, y: 10 })!; placed.componentPropertyAssignments = { icon: replacement.componentKey!, visible: 'false' }; child.visible = false;
    setPrototypeInteractions(editor, placed, [{ id: 'component-link', trigger: { type: 'click' }, navigation: { action: 'back', transition: 'instant', duration: 0 } }]);
    const before = serializeGraph(graph), copy = cloneDesignSubgraph(graph, [root.id]); prepareNativeSceneComponents(copy, [root.id]);
    const artwork = renderNativeSceneImage(kit, copy, copy.getNode(root.id)!);
    const expected = cloneDesignSubgraph(graph, [root.id]), expectedPlaced = expected.getNode(placed.id)!, expectedChildren = expected.getChildren(placed.id);
    expected.swapInstanceComponent(expectedChildren[0]!.id, replacement.id); expectedChildren[1]!.visible = false; expectedPlaced.componentPropertyAssignments = {};
    expect(pixels(artwork.bytes)).toEqual(independentExport(expected, expected.getNode(root.id)!, artwork));
    const model = selectionToDesignModel(graph, [root.id], kit, true), semantic = model.nodes[0]!.children.find(node => node.sourceId === placed.id)!;
    expect(model.prototypeIssues).toEqual([]); expect(model.nodes[0]!.image).toBe(`data:image/png;base64,${Buffer.from(artwork.bytes).toString('base64')}`);
    expect(semantic.sceneCovered).toBe(true); expect(semantic.interactions?.[0]?.id).toBe('component-link'); expect(semantic.children[1]!.visible).toBe(false); expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});
it('prepares fresh component-root instances while retaining the live-control composition diagnostic', () => {
  const { editor, root, child } = fixture(); installSlotSupport(editor.graph);
  try {
    root.type = 'COMPONENT';
    root.componentPropertyDefinitions = [{ id: 'show', name: 'Show', type: 'BOOLEAN', defaultValue: 'true' }]; child.componentPropertyReferences = [{ propertyId: 'show', field: 'VISIBLE' }];
    const before = serializeGraph(editor.graph), model = selectionToDesignModel(editor.graph, [root.id], kit, true);
    expect(model.prototypeIssues).toEqual([]); expect(model.nodes[0]!.image).toMatch(/^data:image\/png/); expect(model.nodes[0]!.children[0]!.sceneCovered).toBe(true); expect(serializeGraph(editor.graph)).toBe(before);
    const button = editor.graph.createNode('COMPONENT', editor.state.currentPageId, { name: 'Button', width: 20, height: 20, fills: [paint()] }); setComponentBehaviour(editor, button, { kind: 'button' }); editor.graph.createInstance(button.id, root.id);
    const live = selectionToDesignModel(editor.graph, [root.id], kit, true);
    expect(live.prototypeIssues.join(' ')).toContain('component controls and properties'); expect(live.nodes[0]!.children.some(node => !!node.control)).toBe(true);
  } finally { editor.dispose(); }
});
it('renders children through the actual group filter and retains semantic metadata without duplicate artwork or mutation', () => {
  const { editor, root, child } = fixture();
  try {
    setPrototypeInteractions(editor, child, [{ id: 'child-link', trigger: { type: 'click' }, navigation: { action: 'back', transition: 'instant', duration: 0 } }]);
    root.rotation = 25; root.flipX = true; root.opacity = .4;
    const before = serializeGraph(editor.graph), artwork = renderNativeSceneImage(kit, editor.graph, root), actual = pixels(artwork.bytes);
    expect(actual).toEqual(independentExport(editor.graph, root, artwork)); expect(actual.rgba.some((value, index) => index % 4 === 3 && value > 0 && value < 255)).toBe(true);
    const model = selectionToDesignModel(editor.graph, [root.id], kit, true), composed = model.nodes[0]!, semantic = composed.children[0]!;
    expect(composed.motion?.composition).toBe('scene'); expect(composed.motion?.artwork).toBeUndefined(); expect(composed.style.opacity).toBe(.4); expect(composed.image).toBe(`data:image/png;base64,${Buffer.from(artwork.bytes).toString('base64')}`);
    expect(semantic.sceneCovered).toBe(true); expect(semantic.image).toBeUndefined(); expect(semantic.motion).toBeUndefined(); expect(semantic.sourceId).toBe(child.id); expect(semantic.interactions?.[0]?.id).toBe('child-link'); expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); }
});
it('preserves nested rotated overflow and both group blurs without cropping child pixels to the root box', () => {
  const { editor, root, child } = fixture();
  try {
    child.x = 70; child.y = -18; child.rotation = 30;
    const group = editor.graph.createNode('FRAME', root.id, { x: -25, y: 45, width: 24, height: 24, rotation: -35, fills: [], clipsContent: false, effects: [blur(4)] });
    editor.graph.createNode('RECTANGLE', group.id, { x: 18, y: 4, width: 24, height: 20, fills: [paint(0, 1)] });
    const artwork = renderNativeSceneImage(kit, editor.graph, root), actual = pixels(artwork.bytes);
    expect(artwork.bounds.minX).toBeLessThan(-25); expect(artwork.bounds.width).toBeGreaterThan(100); expect(artwork.bounds.height).toBeGreaterThan(70);
    expect(actual).toEqual(independentExport(editor.graph, root, artwork));
    for (const edge of [0, actual.height - 1]) expect(actual.rgba.slice(edge * actual.width * 4, (edge + 1) * actual.width * 4).filter((_, index) => index % 4 === 3).every(value => value === 0)).toBe(true);
  } finally { editor.dispose(); }
});
it('composes descendant blends and opacity inside the group filter with the same native pixels as selection export', () => {
  const { editor, root, child } = fixture();
  try {
    root.fills = [paint(0, 1)]; child.blendMode = 'DIFFERENCE'; child.opacity = .5;
    const artwork = renderNativeSceneImage(kit, editor.graph, root); expect(pixels(artwork.bytes)).toEqual(independentExport(editor.graph, root, artwork));
  } finally { editor.dispose(); }
});
it('keeps equally sized groups with different descendants out of the own-artwork cache', () => {
  const { editor, root } = fixture();
  try {
    const second = editor.graph.createNode('FRAME', editor.state.currentPageId, { width: root.width, height: root.height, fills: [], clipsContent: false, effects: [blur()] });
    editor.graph.createNode('RECTANGLE', second.id, { x: 12, y: 8, width: 24, height: 24, fills: [paint(0, 1)] });
    const model = selectionToDesignModel(editor.graph, [root.id, second.id], kit); expect(model.nodes[0]!.image).not.toBe(model.nodes[1]!.image); expect(model.nodes.every(node => node.motion?.composition === 'scene')).toBe(true);
  } finally { editor.dispose(); }
});
it.each(['text', 'video', 'variables', 'hidden variables', 'layout', 'instance', 'scroll', 'external blend', 'external backdrop blur'] as const)('reports %s as a dynamic composition requirement instead of freezing its state', kind => {
  const { editor, root, child } = fixture();
  try {
    if (kind === 'text') { child.type = 'TEXT'; child.text = 'Unprepared'; child.fontFamily = 'Unavailable scene test font'; }
    if (kind === 'video') child.fills = [{ ...paint(), type: 'VIDEO' }];
    if (kind.includes('variables')) { const collection = editor.graph.createCollection('State'), variable = editor.graph.createVariable('Visible', 'BOOLEAN', collection.id, true); editor.graph.bindVariable(child.id, 'visible', variable.id); if (kind === 'hidden variables') child.visible = false; }
    if (kind === 'layout') root.layoutMode = 'HORIZONTAL';
    if (kind === 'instance') child.type = 'INSTANCE';
    if (kind === 'scroll') setPrototypeScroll(editor, root, { axis: 'vertical' });
    if (kind === 'external blend') root.blendMode = 'MULTIPLY';
    if (kind === 'external backdrop blur') root.effects.push({ ...blur(), type: 'BACKGROUND_BLUR' });
    const plan = nativeSceneArtworkPlan(editor.graph, root); expect(plan.needed).toBe(true); expect(plan.issue).toBeTruthy(); expect(() => renderNativeSceneImage(kit, editor.graph, root)).toThrow(plan.issue);
    if (kind === 'text' || kind === 'layout' || kind.includes('variables')) expect(selectionToDesignModel(editor.graph, [root.id], kit).prototypeIssues.some(issue => issue.includes('dynamic scene composition'))).toBe(true);
  } finally { editor.dispose(); }
});
it.each(['high', 'low', 'render', 'encode'] as const)('releases both native scene buffers and surfaces after %s failure, preserving the original design', stage => {
  const { editor, root } = fixture(), local = Object.create(kit) as CanvasKit, surfaces: Surface[] = [], failure = new Error('scene render failed'), malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free'); let made = 0;
  Object.defineProperty(local, 'MakeRasterDirectSurface', { value: (...args: Parameters<CanvasKit['MakeRasterDirectSurface']>) => {
    made++; if (stage === 'high' && made === 1 || stage === 'low' && made === 2) return null;
    const surface = kit.MakeRasterDirectSurface(...args)!; surfaces.push(surface);
    if (stage === 'encode' && made === 2) { const snapshot = surface.makeImageSnapshot; vi.spyOn(surface, 'makeImageSnapshot').mockImplementation(() => { const image = snapshot.call(surface); vi.spyOn(image, 'encodeToBytes').mockReturnValue(null); return image; }); }
    return surface;
  } });
  if (stage === 'render') vi.spyOn(SkiaRenderer.prototype, 'renderNode').mockImplementationOnce(() => { throw failure; });
  try {
    const before = serializeGraph(editor.graph); expect(() => renderNativeSceneImage(local, editor.graph, root)).toThrow(stage === 'render' ? failure : stage === 'encode' ? 'composed PNG' : stage === 'high' ? 'supersampled scene surface' : 'premultiplied scene surface');
    expect(surfaces.every(surface => surface.isDeleted())).toBe(true); expect(free.mock.calls.map(([value]) => value)).toEqual(malloc.mock.results.map(result => result.value)); expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); }
});

function translucentFixture(flip: 'x' | 'y', filtered = false) {
  const editor = createEditor(), graph = editor.graph;
  const solid = (r: number, g: number, b: number) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g, b, a: 1 } });
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Static opacity scene', x: 140, y: 90, width: 64, height: 48, clipsContent: true, fills: [solid(1, 1, 1)], effects: filtered ? [blur(2)] : [] });
  const group = graph.createNode('FRAME', root.id, { name: 'Reflected translucent group', x: 4, y: 8, width: 24, height: 20, opacity: .75, flipX: flip === 'x', flipY: flip === 'y', clipsContent: true, fills: [solid(0, 0, 1)] });
  const inner = graph.createNode('FRAME', group.id, { name: 'Rotated translucent group', x: 6, y: 4, width: 12, height: 8, rotation: flip === 'x' ? 90 : -90, opacity: .5, clipsContent: true, fills: [solid(1, 0, 0)] });
  graph.createNode('RECTANGLE', inner.id, { name: 'Ordered green child', x: 2, y: 2, width: 4, height: 2, fills: [solid(0, 1, 0)] });
  return { editor, root };
}

// Independently authored rectangles/matrices omit graph bounds and renderer dispatch entirely.
function translucentReference(flip: 'x' | 'y', filtered = false) {
  const padding = filtered ? 4 : 0, width = 64 + 2 * padding, height = 48 + 2 * padding;
  const high = kit.MakeSurface(width * 4, height * 4)!, low = kit.MakeSurface(width * 2, height * 2)!, brush = new kit.Paint(), opacity = new kit.Paint(), innerOpacity = new kit.Paint(), filterPaint = new kit.Paint();
  const filter = filtered ? kit.ImageFilter.MakeBlur(1, 1, kit.TileMode.Clamp, null) : null;
  try {
    const canvas = high.getCanvas(); canvas.clear(kit.TRANSPARENT); canvas.scale(4, 4); canvas.translate(padding, padding); brush.setAntiAlias(true);
    if (filtered) { filterPaint.setImageFilter(filter); canvas.saveLayer(filterPaint, kit.LTRBRect(-4, -4, 68, 52)); }
    brush.setColor(kit.WHITE); canvas.drawRect(kit.XYWHRect(0, 0, 64, 48), brush);
    canvas.save(); canvas.clipRect(kit.XYWHRect(0, 0, 64, 48), kit.ClipOp.Intersect, true); canvas.translate(4, 8); opacity.setAlphaf(.75); canvas.saveLayer(opacity);
    canvas.concat(flip === 'x' ? [-1, 0, 24, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 20, 0, 0, 1]);
    brush.setColor(kit.BLUE); canvas.drawRect(kit.XYWHRect(0, 0, 24, 20), brush);
    canvas.save(); canvas.clipRect(kit.XYWHRect(0, 0, 24, 20), kit.ClipOp.Intersect, true); canvas.translate(6, 4); innerOpacity.setAlphaf(.5); canvas.saveLayer(innerOpacity);
    canvas.concat(flip === 'x' ? [0, -1, 10, 1, 0, -2, 0, 0, 1] : [0, 1, 2, -1, 0, 10, 0, 0, 1]);
    brush.setColor(kit.RED); canvas.drawRect(kit.XYWHRect(0, 0, 12, 8), brush);
    canvas.save(); canvas.clipRect(kit.XYWHRect(0, 0, 12, 8), kit.ClipOp.Intersect, true); brush.setColor(kit.GREEN); canvas.drawRect(kit.XYWHRect(2, 2, 4, 2), brush); canvas.restore();
    canvas.restore(); canvas.restore(); canvas.restore(); canvas.restore(); if (filtered) canvas.restore(); high.flush();
    const highImage = high.makeImageSnapshot();
    try { const downsample = low.getCanvas(); downsample.clear(kit.TRANSPARENT); downsample.drawImageRectOptions(highImage, kit.XYWHRect(0, 0, width * 4, height * 4), kit.XYWHRect(0, 0, width * 2, height * 2), kit.FilterMode.Linear, kit.MipmapMode.None, null); low.flush(); }
    finally { highImage.delete(); }
    const image = low.makeImageSnapshot(); try { return pixels(image.encodeToBytes()!); } finally { image.delete(); }
  } finally { filterPaint.delete(); filter?.delete(); innerOpacity.delete(); opacity.delete(); brush.delete(); low.delete(); high.delete(); }
}
function expectTranslucentPixels(actual: ReturnType<typeof pixels>, expected: ReturnType<typeof pixels>, label: string, premultiplied = false) {
  expect([actual.width, actual.height], label).toEqual([expected.width, expected.height]); let maximum = 0, worst = 0;
  // Straight RGB magnifies sub-byte storage rounding at blur fringes with alpha near zero.
  const channel = (rgba: Uint8Array, index: number) => premultiplied && index % 4 !== 3 ? rgba[index]! * rgba[index - index % 4 + 3]! / 255 : rgba[index]!;
  for (let i = 0; i < actual.rgba.length; i++) { const delta = Math.abs(channel(actual.rgba, i) - channel(expected.rgba, i)); if (delta > maximum) { maximum = delta; worst = i - i % 4; } }
  expect(maximum, `${label} ${premultiplied ? 'premultiplied RGBA' : 'straight RGBA'} at${worst / 4 % actual.width},${Math.floor(worst / 4 / actual.width)} actual${[...actual.rgba.slice(worst, worst + 4)]} expected${[...expected.rgba.slice(worst, worst + 4)]}`).toBeLessThanOrEqual(2);
}
function expectTranslucentCalibration(actual: ReturnType<typeof pixels>, filtered = false) {
  const white = filtered ? (34 * 2 * actual.width + 54 * 2) * 4 : 0;
  expect([...actual.rgba.slice(white, white + 4)]).toEqual([255, 255, 255, 255]);
  const sample = filtered ? (22 * 2 * actual.width + 12 * 2) * 4 : (8 * 2 * actual.width + 4 * 2) * 4;
  for (const [channel, value] of [64, 64, 255, 255].entries()) expect(Math.abs(actual.rgba[sample + channel]! - value)).toBeLessThanOrEqual(1);
}

it.each(['x', 'y'] as const)('preserves nested reflected-%s and rotated translucent groups in actual borrowed PNG and static native exports', flip => {
  const { editor, root } = translucentFixture(flip), surface = kit.MakeSurface(8, 8)!, renderer = new SkiaRenderer(kit, surface), source = serializeGraph(editor.graph), descriptor = Object.getOwnPropertyDescriptor(renderer, 'renderNode'), viewport = renderer.worldViewport;
  try {
    const expected = translucentReference(flip), png = pixels(renderDesignNodes(kit, renderer, editor.graph, editor.state.currentPageId, [root.id], { format: 'PNG', scale: 2 })!), native = renderNativeSceneImage(kit, editor.graph, root, true), actual = pixels(native.bytes);
    expect(native.bounds).toEqual({ minX: 0, minY: 0, width: 64, height: 48 }); expect(native.scale).toBe(2);
    expectTranslucentPixels(png, expected, `borrowed PNG reflection${flip}`); expectTranslucentPixels(actual, expected, `static native reflection${flip}`);
    for (const output of [expected, png, actual]) expectTranslucentCalibration(output);
    expect(Object.getOwnPropertyDescriptor(renderer, 'renderNode')).toEqual(descriptor); expect(renderer.worldViewport).toBe(viewport); expect(renderer.boundEffectLayersToViewport).toBe(false); expect(serializeGraph(editor.graph)).toBe(source);
  } finally { renderer.destroy(); if (!surface.isDeleted()) surface.delete(); editor.dispose(); }
});

it.each(['x', 'y'] as const)('retains the ancestor native blur around nested reflected-%s translucent groups', flip => {
  const { editor, root } = translucentFixture(flip, true), before = serializeGraph(editor.graph);
  try {
    const expected = translucentReference(flip, true), artwork = renderNativeSceneImage(kit, editor.graph, root), actual = pixels(artwork.bytes);
    expect(artwork.bounds).toEqual({ minX: -4, minY: -4, width: 72, height: 56 }); expectTranslucentPixels(actual, expected, `blurred native reflection${flip}`, true); for (const output of [expected, actual]) expectTranslucentCalibration(output, true); expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); }
});

it('keeps repeated nested-opacity native captures within existing surface sizes, frees every explicit buffer and plateaus native heap capacity', () => {
  const { editor, root } = translucentFixture('x'), source = serializeGraph(editor.graph), expected = translucentReference('x');
  const nativeHeap = kit as CanvasKit & { HEAPU8: Uint8Array }, sizes: number[] = [];
  const malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free');
  try {
    for (let iteration = 0; iteration < 24; iteration++) {
      const artifact = renderNativeSceneImage(kit, editor.graph, root, true); expectTranslucentPixels(pixels(artifact.bytes), expected, `capture${iteration}`);
      expect([artifact.width, artifact.height, artifact.scale]).toEqual([128, 96, 2]); sizes.push(nativeHeap.HEAPU8.byteLength);
      expect(free.mock.calls.length).toBe(malloc.mock.results.length);
    }
    expect(malloc.mock.results).toHaveLength(48); expect(free.mock.calls.map(([value]) => value)).toEqual(malloc.mock.results.map(result => result.value)); expect(new Set(sizes.slice(8)).size).toBe(1); expect(serializeGraph(editor.graph)).toBe(source);
  } finally { editor.dispose(); }
});
