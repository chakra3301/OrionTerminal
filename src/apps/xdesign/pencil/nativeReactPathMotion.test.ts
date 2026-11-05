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

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
const red = { r: 1, g: 0, b: 0, a: 1 }, blue = { r: 0, g: 0, b: 1, a: 1 }, green = { r: 0, g: 1, b: 0, a: 1 };
const solid = (color = red, opacity = 1) => ({ type: 'SOLID' as const, visible: true, color, opacity });
const link = { action: 'navigate' as const, transition: 'smart' as const, duration: 300, easing: 'linear' as const };
function encode(commands: [number, number[]][]) {
  const bytes = new Uint8Array(commands.reduce((total, [, numbers]) => total + 1 + numbers.length * 4, 0)), data = new DataView(bytes.buffer); let offset = 0;
  for (const [command, numbers] of commands) { bytes[offset++] = command; for (const number of numbers) { data.setFloat32(offset, number, true); offset += 4; } }
  return bytes;
}
function curve(progress: number, width: number, stroke = false) {
  const x = (value: number) => value * width / 60;
  return stroke ? encode([[1, [x(8), 22]], [4, [x(14), 30 - 14 * progress, x(30), 30 + 5 * progress, x(40), 22 - 8 * progress]], [3, [x(48), 5, x(52), 22 + 5 * progress]], [2, [x(56), 30]], [0, []]])
    : encode([[1, [x(4), 6]], [4, [x(10), 3 + 16 * progress, x(30), 18 - 10 * progress, x(42), 8 + 12 * progress]], [3, [x(52), 20 + 10 * progress, x(46), 32]], [2, [x(6), 32 - 4 * progress]], [0, []]]);
}
function fixture(graph: SceneGraph, name: string, progress: number, masked: boolean, resized: boolean, fill?: SceneNode['fills'][number]) {
  const root = graph.createNode('FRAME', graph.getPages()[0]!.id, { name, width: 150, height: 80, fills: [] }), width = resized ? 60 + 40 * progress : 60;
  const path = graph.createNode('VECTOR', root.id, { name: 'Curved geometry', x: 10 + 16 * progress, y: 10, width, height: 40, fills: [solid()], isMask: masked, maskType: 'ALPHA', vectorNetwork: null,
    fillGeometry: [{ commandsBlob: curve(progress, width), windingRule: 'NONZERO', fills: [fill ?? solid({ r: 1 - progress, g: 0, b: progress, a: 1 }, .8 - .2 * progress)] }],
    strokeGeometry: [{ commandsBlob: curve(progress, width, true), windingRule: 'NONZERO' }],
    strokes: [{ color: green, opacity: .8, visible: true, weight: 2, align: 'CENTER' }],
  });
  if (masked) graph.createNode('RECTANGLE', root.id, { name: 'Masked content', x: 0, y: 0, width: 150, height: 80, fills: [solid(blue, .75)] });
  return { root, path };
}
function pixels(image: string) {
  const decoded = kit.MakeImageFromEncoded(new Uint8Array(Buffer.from(image.split(',')[1]!, 'base64')))!;
  try { const data = decoded.readPixels(0, 0, { width: decoded.width(), height: decoded.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }); if (!data) throw new Error('Missing native path pixels.'); return new Uint8Array(data); }
  finally { decoded.delete(); }
}
function difference(a: Uint8Array, b: Uint8Array) { expect(a.length).toBe(b.length); let max = 0; for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!)); return max; }

it.each([{ masked: false, resized: false }, { masked: true, resized: false }, { masked: false, resized: true }])('morphs encoded fill/stroke curves at unchanged or resized boxes (mask=$masked, resized=$resized)', async ({ masked, resized }) => {
  const editor = createEditor(), graph = editor.graph, from = fixture(graph, 'Start', 0, masked, resized), to = fixture(graph, 'End', 1, masked, resized);
  try {
    const before = serializeGraph(graph), plan = await prepareNativeReactMotion(kit, graph, { sessionId: 21, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
    for (const progress of [.25, .5, .75]) {
      const reference = createEditor();
      try {
        const expected = fixture(reference.graph, 'Reference', progress, masked, resized), actual = await plan.frame(progress), model = await renderNativeReactModel(kit, reference.graph, [expected.root.id]);
        const a = pixels(actual.nodes[0]!.image!), b = pixels(model.nodes[0]!.image!);
        expect(b.some((value, index) => index % 4 === 3 && value > 100)).toBe(true); expect(difference(a, b)).toBeLessThanOrEqual(2);
      } finally { reference.dispose(); }
    }
    const sampler = createNativeReactMotionGraph(graph, from.root.id, graph, to.root.id, link), sample = sampler.sample(.5), paths = [...sample.nodes.values()].filter(node => node.name === 'Curved geometry');
    expect(paths).toHaveLength(1); expect(paths[0]!.fillGeometry[0]!.commandsBlob).not.toEqual(from.path.fillGeometry[0]!.commandsBlob); expect(paths[0]!.fillGeometry[0]!.commandsBlob).not.toEqual(to.path.fillGeometry[0]!.commandsBlob);
    expect(plan.motion.initialModel.nodes[0]!.image).toBe((await renderNativeReactModel(kit, graph, [from.root.id])).nodes[0]!.image);
    expect((await plan.frame(1)).nodes[0]!.image).toBe((await renderNativeReactModel(kit, graph, [to.root.id])).nodes[0]!.image);
    const middle = (await plan.frame(.5)).nodes[0]!.image; await plan.frame(.1); expect((await plan.frame(.5)).nodes[0]!.image).toBe(middle);
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it.each([false, true])('blends changing path fill types around the same intermediate curve (mask=%s)', async masked => {
  const editor = createEditor(), aEditor = createEditor(), bEditor = createEditor(), graph = editor.graph;
  const from = fixture(graph, 'Start', 0, masked, false, solid(red, .8)), gradient: SceneNode['fills'][number] = { type: 'GRADIENT_LINEAR', visible: true, color: blue, opacity: .6, gradientStops: [{ position: 0, color: blue }, { position: 1, color: blue }], gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } }, to = fixture(graph, 'End', 1, masked, false, gradient);
  try {
    const a = fixture(aEditor.graph, 'Reference A', .5, masked, false, solid(red, .8)), b = fixture(bEditor.graph, 'Reference B', .5, masked, false, gradient);
    const pa = pixels((await renderNativeReactModel(kit, aEditor.graph, [a.root.id])).nodes[0]!.image!), pb = pixels((await renderNativeReactModel(kit, bEditor.graph, [b.root.id])).nodes[0]!.image!);
    expect(difference(pa, pb)).toBeGreaterThan(10);
    const expected = pa.map((value, i) => Math.round((value + pb[i]!) / 2)), plan = await prepareNativeReactMotion(kit, graph, { sessionId: 22, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
    expect(difference(pixels((await plan.frame(.5)).nodes[0]!.image!), expected)).toBeLessThanOrEqual(2);
  } finally { editor.dispose(); aEditor.dispose(); bEditor.dispose(); }
});
