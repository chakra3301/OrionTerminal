// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { createNativeReactMotionGraph } from './nativeReactMotionGraph';
import { prepareNativeReactMotion } from './nativeReactMotion';
import { renderNativeReactModel } from './nativeReactRenderer';
import { renderNativeSceneImage } from './nativeSceneArtwork';
import { serializeGraph } from './graphDocument';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
const red = { r: 1, g: 0, b: 0, a: 1 }, blue = { r: 0, g: 0, b: 1, a: 1 };
const solid = (color = red, opacity = 1) => ({ type: 'SOLID' as const, visible: true, color, opacity });
const link = { action: 'navigate' as const, transition: 'smart' as const, duration: 300, easing: 'linear' as const };
function pixels(image: string) {
  const decoded = kit.MakeImageFromEncoded(new Uint8Array(Buffer.from(image.split(',')[1]!, 'base64')))!;
  try {
    const width = decoded.width(), height = decoded.height(), data = decoded.readPixels(0, 0, { width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB });
    if (!data) throw new Error('Missing native mask comparison pixels.');
    return new Uint8Array(data);
  } finally { decoded.delete(); }
}
function maximum(a: Uint8Array, b: Uint8Array) { expect(a.length).toBe(b.length); let result = 0; for (let i = 0; i < a.length; i++) result = Math.max(result, Math.abs(a[i]! - b[i]!)); return result; }
function scene(graph: SceneGraph, name: string, type: SceneNode['type'], maskType: SceneNode['maskType'], x: number, childX: number, fields: Partial<SceneNode> = {}) {
  const root = graph.createNode('FRAME', graph.getPages()[0]!.id, { name, width: 90, height: 75, fills: [] });
  const mask = graph.createNode(type, root.id, { name: 'Changing mask', x, y: 15, width: 35, height: 30, isMask: true, maskType, opacity: .8, fills: [solid()], ...fields });
  const child = graph.createNode('RECTANGLE', root.id, { name: 'Moving masked artwork', x: childX, y: 0, width: 75, height: 65, fills: [solid(blue, .75)] });
  return { root, mask, child };
}

it.each([
  { label: 'alpha to vector silhouettes', fromType: 'ELLIPSE' as const, toType: 'RECTANGLE' as const, fromMode: 'ALPHA' as const, toMode: 'VECTOR' as const },
  { label: 'luminance to alpha coverage', fromType: 'RECTANGLE' as const, toType: 'RECTANGLE' as const, fromMode: 'LUMINANCE' as const, toMode: 'ALPHA' as const },
])('blends $label around one moving child with independent native midpoint and endpoint pixels', async ({ fromType, toType, fromMode, toMode }) => {
  const editor = createEditor(), aEditor = createEditor(), bEditor = createEditor();
  const graph = editor.graph, from = scene(graph, 'Start', fromType, fromMode, 10, 0), to = scene(graph, 'End', toType, toMode, 20, 20);
  try {
    const before = serializeGraph(graph), a = scene(aEditor.graph, 'Reference A', fromType, fromMode, 15, 10), b = scene(bEditor.graph, 'Reference B', toType, toMode, 15, 10);
    const referenceA = pixels((await renderNativeReactModel(kit, aEditor.graph, [a.root.id])).nodes[0]!.image!), referenceB = pixels((await renderNativeReactModel(kit, bEditor.graph, [b.root.id])).nodes[0]!.image!);
    expect(maximum(referenceA, referenceB)).toBeGreaterThan(20);
    const expected = referenceA.map((value, index) => Math.round((value + referenceB[index]!) / 2));
    const plan = await prepareNativeReactMotion(kit, graph, { sessionId: 10, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
    const frame = await plan.frame(.5), actual = pixels(frame.nodes[0]!.image!);
    expect(maximum(actual, expected)).toBeLessThanOrEqual(2);
    const sampler = createNativeReactMotionGraph(graph, from.root.id, graph, to.root.id, { ...link, target: to.root.id }), sample = sampler.sample(.5), artwork = renderNativeSceneImage(kit, sample, sample.getNode(sampler.rootId)!, true);
    expect([...sample.nodes.values()].filter(node => node.name === 'Changing mask')).toHaveLength(1);
    expect([...sample.nodes.values()].filter(node => node.name === 'Moving masked artwork')).toHaveLength(1);
    expect(sample.getNode(sampler.sourceNodeId(from.child.id)!)!.x).toBe(10);
    const regions = artwork.maskRegions.get(sampler.rootId)!;
    expect(regions).toHaveLength(1); expect(regions[0]!.masks).toHaveLength(1); expect(regions[0]!.children).toEqual([sampler.sourceNodeId(from.child.id)]); expect(regions[0]!.path).toBeTruthy();
    const start = sampler.sample(0), atStart = renderNativeSceneImage(kit, start, start.getNode(sampler.rootId)!, true);
    expect(regions[0]!.path).not.toBe(atStart.maskRegions.get(sampler.rootId)![0]!.path);
    expect(plan.motion.initialModel.nodes[0]!.image).toBe((await renderNativeReactModel(kit, graph, [from.root.id])).nodes[0]!.image);
    expect((await plan.frame(1)).nodes[0]!.image).toBe((await renderNativeReactModel(kit, graph, [to.root.id])).nodes[0]!.image);
    await plan.frame(.25); expect((await plan.frame(.5)).nodes[0]!.image).toBe(frame.nodes[0]!.image);
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); aEditor.dispose(); bEditor.dispose(); }
});

it('changes an alpha mask fill stack without duplicating its masked sibling run', async () => {
  const editor = createEditor(), reference = createEditor(), graph = editor.graph;
  const from = scene(graph, 'Start', 'RECTANGLE', 'ALPHA', 10, 0, { fills: [solid({ ...red, a: .5 }, .8)] }), to = scene(graph, 'End', 'RECTANGLE', 'ALPHA', 20, 20, { fills: [] });
  try {
    const expectedScene = scene(reference.graph, 'Reference', 'RECTANGLE', 'ALPHA', 15, 10, { fills: [solid({ ...red, a: .5 }, .4)] });
    const plan = await prepareNativeReactMotion(kit, graph, { sessionId: 11, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
    const actual = pixels((await plan.frame(.5)).nodes[0]!.image!), expected = pixels((await renderNativeReactModel(kit, reference.graph, [expectedScene.root.id])).nodes[0]!.image!);
    expect(maximum(actual, expected)).toBeLessThanOrEqual(2); expect(actual.some((value, index) => index % 4 === 3 && value > 20)).toBe(true);
  } finally { editor.dispose(); reference.dispose(); }
});

it('adds, removes, and reorders children inside unchanged native mask regions', async () => {
  const editor = createEditor(), reference = createEditor(), graph = editor.graph;
  const build = (g: SceneGraph, name: string, destination: boolean, expected = false) => {
    const root = g.createNode('FRAME', g.getPages()[0]!.id, { name, width: 100, height: 70, fills: [] });
    const add = (type: SceneNode['type'], nodeName: string, x: number, color: typeof red) => g.createNode(type, root.id, { name: nodeName, x, y: 8, width: 12, height: 14, fills: [solid(color)] });
    g.createNode('RECTANGLE', root.id, { name: 'Region A mask', x: 4, y: 6, width: 60, height: 20, fills: [solid()], isMask: true, maskType: 'ALPHA' });
    const a1 = () => add('RECTANGLE', 'A1', expected ? 10 : destination ? 12 : 8, red);
    const a2 = () => add('ELLIPSE', 'A2', 22, blue);
    if (destination) { a2(); a1(); } else { a1(); a2(); }
    if (destination) add('ELLIPSE', 'Added A', 36, blue);
    if (!destination || expected) add('RECTANGLE', 'Removed A', 50, red);
    g.createNode('ELLIPSE', root.id, { name: 'Region B mask', x: 68, y: 6, width: 30, height: 20, fills: [solid()], isMask: true, maskType: 'ALPHA' });
    add('RECTANGLE', 'B2', 84, blue); add('ELLIPSE', 'B1', 70, red);
    return root;
  };
  const from = build(graph, 'Start', false), to = build(graph, 'End', true);
  const expectedRoot = build(reference.graph, 'Independent midpoint', true, true);
  try {
    const expectedAdded = [...reference.graph.nodes.values()].find(node => node.name === 'Added A')!;
    expectedAdded.opacity = .5;
    const expectedRemoved = [...reference.graph.nodes.values()].find(node => node.name === 'Removed A')!;
    expectedRemoved.opacity = .5;
    const before = serializeGraph(graph);
    const expectedPixels = pixels((await renderNativeReactModel(kit, reference.graph, [expectedRoot.id])).nodes[0]!.image!);
    const plan = await prepareNativeReactMotion(kit, graph, { sessionId: 15, from: { rootId: from.id }, to: { rootId: to.id }, link: { ...link, target: to.id } });
    const midpoint = await plan.frame(.5), actualPixels = pixels(midpoint.nodes[0]!.image!);
    expect(actualPixels.some(value => value > 20)).toBe(true);
    expect(maximum(actualPixels, expectedPixels)).toBeLessThanOrEqual(2);

    const sampler = createNativeReactMotionGraph(graph, from.id, graph, to.id, { ...link, target: to.id });
    const sample = sampler.sample(.5), sampledRoot = sample.getNode(sampler.rootId)!;
    expect(sampledRoot.childIds.map(id => sample.getNode(id)!.name)).toEqual(['Region A mask', 'A2', 'A1', 'Added A', 'Removed A', 'Region B mask', 'B2', 'B1']);
    for (const name of ['A1', 'A2', 'B1', 'B2']) {
      const item = [...sample.nodes.values()].find(node => node.name === name)!;
      expect(sampler.sourceNodeId(graph.getChildren(from.id).find(node => node.name === name)!.id)).toBe(item.id);
      expect(sampler.sourceNodeId(graph.getChildren(to.id).find(node => node.name === name)!.id)).toBe(item.id);
      if (name === 'A1') expect(item.x).toBe(10);
    }
    expect([...sample.nodes.values()].find(node => node.name === 'Added A')!.opacity).toBeCloseTo(.5);
    expect([...sample.nodes.values()].find(node => node.name === 'Removed A')!.opacity).toBeCloseTo(.5);
    const regions = renderNativeSceneImage(kit, sample, sampledRoot, true).maskRegions.get(sampler.rootId)!;
    expect(regions).toHaveLength(2);
    expect(regions.map(region => region.children.map(id => sample.getNode(id)!.name))).toEqual([
      ['A2', 'A1', 'Added A', 'Removed A'], ['B2', 'B1'],
    ]);
    expect(regions.every(region => region.masks.length === 1 && !!region.path)).toBe(true);

    const startPixels = pixels((await plan.frame(0)).nodes[0]!.image!);
    const endPixels = pixels((await plan.frame(1)).nodes[0]!.image!);
    expect(maximum(startPixels, pixels((await renderNativeReactModel(kit, graph, [from.id])).nodes[0]!.image!))).toBe(0);
    expect(maximum(endPixels, pixels((await renderNativeReactModel(kit, graph, [to.id])).nodes[0]!.image!))).toBe(0);
    await plan.frame(.25);
    expect((await plan.frame(.5)).nodes[0]!.image).toBe(midpoint.nodes[0]!.image);
    expect(serializeGraph(graph)).toBe(before);
    const movedAcrossRegion = graph.getChildren(to.id).find(node => node.name === 'A1')!;
    const destinationChildren = graph.getNode(to.id)!.childIds;
    destinationChildren.splice(destinationChildren.indexOf(movedAcrossRegion.id), 1);
    destinationChildren.push(movedAcrossRegion.id);
    expect(() => createNativeReactMotionGraph(graph, from.id, graph, to.id, link)).not.toThrow();
    destinationChildren.pop(); destinationChildren.unshift(movedAcrossRegion.id);
    expect(() => createNativeReactMotionGraph(graph, from.id, graph, to.id, link)).not.toThrow();
    expect(() => createNativeReactMotionGraph(graph, to.id, graph, from.id, link)).not.toThrow();
  } finally { editor.dispose(); reference.dispose(); }
});

it('changes vector-mask topology with one native coverage plane and keeps changed membership child-preserving', async () => {
  const editor = createEditor(), aEditor = createEditor(), bEditor = createEditor(), graph = editor.graph;
  const polygon = (count: number): SceneNode['vectorNetwork'] => ({ vertices: count === 3 ? [{ x: 0, y: 0 }, { x: 35, y: 0 }, { x: 0, y: 30 }] : [{ x: 0, y: 0 }, { x: 35, y: 0 }, { x: 35, y: 30 }, { x: 0, y: 30 }], segments: Array.from({ length: count }, (_, start) => ({ start, end: (start + 1) % count, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } })), regions: [{ windingRule: 'NONZERO', loops: [Array.from({ length: count }, (_, i) => i)] }] });
  const from = scene(graph, 'Start', 'VECTOR', 'VECTOR', 10, 0, { vectorNetwork: polygon(3) }), to = scene(graph, 'End', 'VECTOR', 'VECTOR', 20, 20, { vectorNetwork: polygon(4) });
  try {
    const a = scene(aEditor.graph, 'Reference A', 'VECTOR', 'VECTOR', 15, 10, { vectorNetwork: polygon(3) }), b = scene(bEditor.graph, 'Reference B', 'VECTOR', 'VECTOR', 15, 10, { vectorNetwork: polygon(4) });
    const pa = pixels((await renderNativeReactModel(kit, aEditor.graph, [a.root.id])).nodes[0]!.image!), pb = pixels((await renderNativeReactModel(kit, bEditor.graph, [b.root.id])).nodes[0]!.image!);
    expect(maximum(pa, pb)).toBeGreaterThan(20);
    const plan = await prepareNativeReactMotion(kit, graph, { sessionId: 12, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
    expect(maximum(pixels((await plan.frame(.5)).nodes[0]!.image!), pa.map((value, i) => Math.round((value + pb[i]!) / 2)))).toBeLessThanOrEqual(2);
    to.mask.isMask = false; expect(() => createNativeReactMotionGraph(graph, from.root.id, graph, to.root.id, link)).not.toThrow();
  } finally { editor.dispose(); aEditor.dispose(); bEditor.dispose(); }
});

it('preserves changing composed paint inside one alpha-mask source without losing scratch metadata', async () => {
  const editor = createEditor(), reference = createEditor(), graph = editor.graph;
  const from = scene(graph, 'Start', 'FRAME', 'ALPHA', 10, 0, { fills: [] }), to = scene(graph, 'End', 'FRAME', 'ALPHA', 20, 20, { fills: [] });
  const add = (g: SceneGraph, mask: SceneNode, fill: SceneNode['fills'][number], childX: number) => {
    const group = g.createNode('FRAME', mask.id, { name: 'Changing mask content', width: 35, height: 30, fills: [fill] });
    g.createNode('RECTANGLE', group.id, { name: 'Persistent mask child', x: childX, y: 5, width: 8, height: 12, fills: [solid({ r: 0, g: 1, b: 0, a: .5 }, .4)] });
  };
  add(graph, from.mask, solid(red, .8), 4);
  add(graph, to.mask, { type: 'GRADIENT_LINEAR', visible: true, opacity: .6, color: blue, gradientStops: [{ position: 0, color: blue }, { position: 1, color: blue }], gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } }, 16);
  try {
    const expectedScene = scene(reference.graph, 'Reference', 'FRAME', 'ALPHA', 15, 10, { fills: [] });
    add(reference.graph, expectedScene.mask, solid({ r: 4 / 7, g: 0, b: 3 / 7, a: 1 }, .7), 10);
    const plan = await prepareNativeReactMotion(kit, graph, { sessionId: 13, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
    expect(maximum(pixels((await plan.frame(.5)).nodes[0]!.image!), pixels((await renderNativeReactModel(kit, reference.graph, [expectedScene.root.id])).nodes[0]!.image!))).toBeLessThanOrEqual(2);
  } finally { editor.dispose(); reference.dispose(); }
});

it('blends changing native boolean mask operations on the same sampled child shapes', async () => {
  const editor = createEditor(), aEditor = createEditor(), bEditor = createEditor(), graph = editor.graph;
  const create = (g: SceneGraph, name: string, operation: 'UNION' | 'INTERSECT', x: number, childX: number) => {
    const result = scene(g, name, 'BOOLEAN_OPERATION', 'VECTOR', x, childX, { booleanOperation: operation });
    g.createNode('RECTANGLE', result.mask.id, { name: 'Boolean rectangle', width: 20, height: 30, fills: [solid()] });
    g.createNode('ELLIPSE', result.mask.id, { name: 'Boolean ellipse', x: 10, width: 25, height: 30, fills: [solid()] });
    return result;
  };
  const from = create(graph, 'Start', 'UNION', 10, 0), to = create(graph, 'End', 'INTERSECT', 20, 20);
  try {
    const a = create(aEditor.graph, 'Reference A', 'UNION', 15, 10), b = create(bEditor.graph, 'Reference B', 'INTERSECT', 15, 10);
    const pa = pixels((await renderNativeReactModel(kit, aEditor.graph, [a.root.id])).nodes[0]!.image!), pb = pixels((await renderNativeReactModel(kit, bEditor.graph, [b.root.id])).nodes[0]!.image!);
    expect(maximum(pa, pb)).toBeGreaterThan(20);
    const plan = await prepareNativeReactMotion(kit, graph, { sessionId: 14, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
    expect(maximum(pixels((await plan.frame(.5)).nodes[0]!.image!), pa.map((value, i) => Math.round((value + pb[i]!) / 2)))).toBeLessThanOrEqual(2);
  } finally { editor.dispose(); aEditor.dispose(); bEditor.dispose(); }
});
