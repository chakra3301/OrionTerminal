// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { prepareNativeReactMotion } from './nativeReactMotion';
import { createNativeReactMotionGraph } from './nativeReactMotionGraph';
import { renderNativeReactModel } from './nativeReactRenderer';
import { serializeGraph } from './graphDocument';
import { hasNativeMotionComposite, setNativeMotionComposite } from './nativeReactMotionComposite';
import { setPrototypeScroll } from './prototypeScroll';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
const red = { r: 1, g: 0, b: 0, a: 1 }, blue = { r: 0, g: 0, b: 1, a: 1 }, green = { r: 0, g: 1, b: 0, a: 1 };
const solid = (color = red, opacity = 1) => ({ type: 'SOLID' as const, visible: true, color, opacity });
const gradient = (color = blue, opacity = 1) => ({ type: 'GRADIENT_LINEAR' as const, visible: true, color, opacity, gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, gradientStops: [{ position: 0, color }, { position: 1, color }] });
const link = { action: 'navigate' as const, transition: 'smart' as const, duration: 300, easing: 'linear' as const };
function pixels(image: string, premultiplied = false) {
  const decoded = kit.MakeImageFromEncoded(new Uint8Array(Buffer.from(image.split(',')[1]!, 'base64')))!;
  try {
    const width = decoded.width(), height = decoded.height(), data = decoded.readPixels(0, 0, { width, height, colorType: kit.ColorType.RGBA_8888, alphaType: premultiplied ? kit.AlphaType.Premul : kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB });
    if (!data) throw new Error('Missing native comparison pixels.');
    return { width, height, data: new Uint8Array(data) };
  } finally { decoded.delete(); }
}
const root = (graph: SceneGraph, name: string) => graph.createNode('FRAME', graph.getPages()[0]!.id, { name, width: 80, height: 70, fills: [] });
function panel(graph: SceneGraph, parent: SceneNode, fills: SceneNode['fills'], childX: number) {
  const group = graph.createNode('FRAME', parent.id, { name: 'Changing panel', x: 10, y: 10, width: 60, height: 40, fills });
  graph.createNode('RECTANGLE', group.id, { name: 'Moving child', x: childX, y: 10, width: 10, height: 12, fills: [solid(green, .4)] });
  return group;
}
function maxDifference(a: Uint8Array, b: Uint8Array) { expect(a.length).toBe(b.length); let maximum = 0; for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i]! - b[i]!)); return maximum; }

it('blends incompatible group fills in premultiplied space around one moving child with independent native reference pixels', async () => {
  const editor = createEditor(), graph = editor.graph, from = root(graph, 'Start'), to = root(graph, 'End');
  panel(graph, from, [solid(red, .8)], 5); panel(graph, to, [gradient(blue, .6)], 25);
  const reference = createEditor();
  try {
    const before = serializeGraph(graph), expectedRoot = root(reference.graph, 'Reference');
    panel(reference.graph, expectedRoot, [solid({ r: 4 / 7, g: 0, b: 3 / 7, a: 1 }, .7)], 15);
    const plan = await prepareNativeReactMotion(kit, graph, { sessionId: 1, from: { rootId: from.id }, to: { rootId: to.id }, link: { ...link, target: to.id } });
    const actual = await plan.frame(.5), expected = await renderNativeReactModel(kit, reference.graph, [expectedRoot.id]);
    const a = pixels(actual.nodes[0]!.image!), b = pixels(expected.nodes[0]!.image!);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    expect(maxDifference(a.data, b.data)).toBeLessThanOrEqual(2);
    const center = (30 * a.width + 30) * 4;
    expect(a.data[center + 3]).toBeGreaterThan(170);
    const motionGraph = createNativeReactMotionGraph(graph, from.id, graph, to.id, { ...link, target: to.id }), sampled = motionGraph.sample(.5);
    expect([...sampled.nodes.values()].filter(node => node.name === 'Moving child')).toHaveLength(1);
    expect([...sampled.nodes.values()].find(node => node.name === 'Moving child')!.x).toBe(15);
    const source = await renderNativeReactModel(kit, graph, [from.id]), destination = await renderNativeReactModel(kit, graph, [to.id]);
    expect(plan.motion.initialModel.nodes[0]!.image).toBe(source.nodes[0]!.image);
    expect((await plan.frame(1)).nodes[0]!.image).toBe(destination.nodes[0]!.image);
    await plan.frame(.25); expect((await plan.frame(.5)).nodes[0]!.image).toBe(actual.nodes[0]!.image);
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); reference.dispose(); }
});

it('preserves per-stroke cap changes as a native appearance blend at the interpolated line pose', async () => {
  const editor = createEditor(), graph = editor.graph, from = root(graph, 'Start'), to = root(graph, 'End');
  const line = (parent: SceneNode, cap: 'ROUND' | 'SQUARE', x: number, y: number) => graph.createNode('LINE', parent.id, { name: 'Moving line', x, y, width: 36, height: 8, fills: [], strokes: [{ color: red, opacity: 1, visible: true, weight: 6, align: 'CENTER', cap }], strokeCap: cap });
  line(from, 'ROUND', 10, 15); line(to, 'SQUARE', 20, 35);
  const aEditor = createEditor(), bEditor = createEditor();
  try {
    const reference = async (referenceGraph: SceneGraph, cap: 'ROUND' | 'SQUARE') => {
      const r = root(referenceGraph, 'Reference'); referenceGraph.createNode('LINE', r.id, { name: 'Moving line', x: 15, y: 25, width: 36, height: 8, fills: [], strokes: [{ color: red, opacity: 1, visible: true, weight: 6, align: 'CENTER', cap }], strokeCap: cap });
      return pixels((await renderNativeReactModel(kit, referenceGraph, [r.id])).nodes[0]!.image!, true);
    };
    const a = await reference(aEditor.graph, 'ROUND'), b = await reference(bEditor.graph, 'SQUARE'), plan = await prepareNativeReactMotion(kit, graph, { sessionId: 2, from: { rootId: from.id }, to: { rootId: to.id }, link: { ...link, target: to.id } }), actual = pixels((await plan.frame(.5)).nodes[0]!.image!, true);
    expect(maxDifference(a.data, b.data)).toBeGreaterThan(2);
    expect([...a.data].filter((_value, index) => index % 4 === 3).some(alpha => alpha > 200)).toBe(true);
    const expected = new Uint8Array(a.data.length);
    for (let i = 0; i < expected.length; i++) expected[i] = Math.round((a.data[i]! + b.data[i]!) / 2);
    expect(maxDifference(actual.data, expected)).toBeLessThanOrEqual(2);
  } finally { editor.dispose(); aEditor.dispose(); bEditor.dispose(); }
});

it.each(['horizontal', 'vertical'] as const)('keeps zero-axis %s LINE samples exact and composites caps at one shared native pose', async axis => {
  const editor = createEditor(), graph = editor.graph, from = root(graph, 'Start'), to = root(graph, 'End');
  const geometry = (node: SceneNode) => axis === 'horizontal'
    ? { x: node === from ? 10 : 20, y: 24, width: node === from ? 24 : 40, height: 0 }
    : { x: 26, y: node === from ? 10 : 20, width: 0, height: node === from ? 24 : 40 };
  const addLine = (parent: SceneNode, cap: 'ROUND' | 'SQUARE') => graph.createNode('LINE', parent.id, { name: 'Degenerate-axis line', ...geometry(parent), fills: [], strokes: [{ color: red, opacity: 1, visible: true, weight: 6, align: 'CENTER', cap }], strokeCap: cap });
  addLine(from, 'ROUND'); addLine(to, 'SQUARE');
  const references = [createEditor(), createEditor()];
  try {
    const before = serializeGraph(graph), motion = createNativeReactMotionGraph(graph, from.id, graph, to.id, { ...link, target: to.id });
    for (const progress of [0, .5, 1]) {
      const sampled = motion.sample(progress), line = [...sampled.nodes.values()].find(node => node.name === 'Degenerate-axis line')!;
      expect(axis === 'horizontal' ? line.height : line.width).toBe(0);
      expect(axis === 'horizontal' ? line.width : line.height).toBe(24 + 16 * progress);
    }

    const plan = await prepareNativeReactMotion(kit, graph, { sessionId: axis === 'horizontal' ? 21 : 22, from: { rootId: from.id }, to: { rootId: to.id }, link: { ...link, target: to.id } });
    const actual = pixels((await plan.frame(.5)).nodes[0]!.image!, true);
    const referenceRoots = references.map((reference, index) => {
      const frame = root(reference.graph, `Reference ${index}`), cap = index % 2 ? 'SQUARE' : 'ROUND';
      const pose = axis === 'horizontal' ? { x: 15, y: 24, width: 32, height: 0 } : { x: 26, y: 15, width: 0, height: 32 };
      reference.graph.createNode('LINE', frame.id, { name: 'Reference line', ...pose, fills: [], strokes: [{ color: red, opacity: 1, visible: true, weight: 6, align: 'CENTER', cap }], strokeCap: cap });
      return { reference, frame };
    });
    const round = pixels((await renderNativeReactModel(kit, referenceRoots[0]!.reference.graph, [referenceRoots[0]!.frame.id])).nodes[0]!.image!, true);
    const square = pixels((await renderNativeReactModel(kit, referenceRoots[1]!.reference.graph, [referenceRoots[1]!.frame.id])).nodes[0]!.image!, true);
    expect([round.width, round.height]).toEqual([square.width, square.height]);
    expect(maxDifference(round.data, square.data)).toBeGreaterThan(2);
    expect([...round.data].some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect([...square.data].some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    const expected = new Uint8Array(round.data.length);
    for (let i = 0; i < expected.length; i++) expected[i] = Math.round((round.data[i]! + square.data[i]!) / 2);
    expect(actual.width).toBe(round.width); expect(actual.height).toBe(round.height);
    expect(maxDifference(actual.data, expected)).toBeLessThanOrEqual(2);
    const sourceModel = await renderNativeReactModel(kit, graph, [from.id]);
    expect((await plan.frame(0)).nodes[0]!.image).toBe(sourceModel.nodes[0]!.image);
    expect((await plan.frame(1)).nodes[0]!.image).toBe((await renderNativeReactModel(kit, graph, [to.id])).nodes[0]!.image);
    const replay = pixels((await plan.frame(.5)).nodes[0]!.image!, true);
    expect(maxDifference(actual.data, replay.data)).toBe(0);
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); references.forEach(reference => reference.dispose()); }
});

it.each(['horizontal', 'vertical'] as const)('preserves selected-root %s LINE axes at both endpoints and midpoint', axis => {
  const from = createEditor(), to = createEditor();
  try {
    const make = (graph: SceneGraph, endpoint: 0 | 1, cap: 'ROUND' | 'SQUARE') => graph.createNode('LINE', graph.getPages()[0]!.id, {
      name: 'Selected line', x: axis === 'horizontal' ? 8 + 6 * endpoint : 24, y: axis === 'vertical' ? 8 + 6 * endpoint : 18,
      width: axis === 'horizontal' ? 24 + 16 * endpoint : 0, height: axis === 'vertical' ? 24 + 16 * endpoint : 0,
      fills: [], strokes: [{ color: red, opacity: 1, visible: true, weight: 6, align: 'CENTER', cap }], strokeCap: cap,
    });
    const start = make(from.graph, 0, 'ROUND'), finish = make(to.graph, 1, 'SQUARE');
    const motion = createNativeReactMotionGraph(from.graph, start.id, to.graph, finish.id, { ...link, target: finish.id });
    for (const progress of [0, .5, 1]) {
      const line = motion.sample(progress).getNode(motion.rootId)!;
      expect(axis === 'horizontal' ? line.height : line.width).toBe(0);
      expect(axis === 'horizontal' ? line.width : line.height).toBe(24 + 16 * progress);
    }
  } finally { from.dispose(); to.dispose(); }
});

it('keeps a changing frame paint separate from its live scroll content and logical offsets', async () => {
  const editor = createEditor(), graph = editor.graph, from = root(graph, 'Scroll start'), to = root(graph, 'Scroll end');
  panel(graph, from, [solid(red, .8)], 5); panel(graph, to, [gradient(blue, .6)], 25);
  const a = graph.getChildren(from.id)[0]!, b = graph.getChildren(to.id)[0]!;
  setPrototypeScroll(editor, a, { axis: 'vertical' }); setPrototypeScroll(editor, b, { axis: 'vertical' });
  graph.getChildren(a.id)[0]!.y = 90; graph.getChildren(b.id)[0]!.y = 90;
  try {
    const plan = await prepareNativeReactMotion(kit, graph, { sessionId: 3, from: { rootId: from.id, scrollPositions: { [`${from.id}/0`]: { x: 0, y: 20 } } }, to: { rootId: to.id, scrollPositions: { [`${to.id}/0`]: { x: 0, y: 40 } } }, link: { ...link, target: to.id } }), frame = await plan.frame(.5);
    const pending = [...frame.nodes]; let scrollNode: typeof frame.nodes[number] | undefined;
    while (pending.length) { const node = pending.pop()!; if (node.name === 'Changing panel') scrollNode = node; pending.push(...node.children); }
    expect(scrollNode?.scroll?.axis).toBe('vertical'); expect(scrollNode?.image).toBeTruthy(); expect(scrollNode?.children.some(node => node.name === 'Moving child')).toBe(true);
    expect(frame.scrollPositions?.[scrollNode!.id]).toEqual({ x: 0, y: 30 });
  } finally { editor.dispose(); }
});

it('does not serialize private appearance state and rejects backdrop or masked paint changes', () => {
  const editor = createEditor(), graph = editor.graph, from = root(graph, 'Start'), to = root(graph, 'End');
  const a = panel(graph, from, [solid(red)], 5), b = panel(graph, to, [gradient(blue)], 25);
  try {
    const before = serializeGraph(graph); setNativeMotionComposite(graph, a.id, a, b, .5);
    expect(hasNativeMotionComposite(graph, a.id)).toBe(true); expect(serializeGraph(graph)).toBe(before);
    b.isMask = true; expect(() => setNativeMotionComposite(graph, a.id, a, b, .5)).toThrow('mask, live media or external backdrop');
    b.isMask = false; b.effects = [{ type: 'BACKGROUND_BLUR', visible: true, radius: 4, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } }];
    expect(() => setNativeMotionComposite(graph, a.id, a, b, .5)).toThrow('mask, live media or external backdrop');
  } finally { editor.dispose(); }
});
