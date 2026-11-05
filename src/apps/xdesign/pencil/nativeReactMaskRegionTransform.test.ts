// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit } from 'canvaskit-wasm';
import { getNodeLocalMatrix, getWorldMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import { prepareNativeReactMotion } from './nativeReactMotion';
import { renderNativeReactModel } from './nativeReactRenderer';
import { createNativeReactMotionGraph } from './nativeReactMotionGraph';
import { serializeGraph } from './graphDocument';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });

const link = { action: 'navigate' as const, transition: 'smart' as const, duration: 320, easing: 'linear' as const };
const ink = { r: .08, g: .26, b: .82, a: 1 };
const solid = (color = { r: 1, g: 1, b: 1, a: 1 }, opacity = 1) => ({ type: 'SOLID' as const, visible: true, color, opacity });
const samples = [.25, .5, .75] as const;

type PanelPose = { x: number; y: number; rotation: number };
type InsertScene = { name: string; panel: PanelPose; artX: number; masked: boolean; maskX?: number; maskY?: number };
type Built = { root: SceneNode; panel: SceneNode; art: SceneNode; mask?: SceneNode; nodes: Map<string, SceneNode> };

function insertScene(graph: SceneGraph, spec: InsertScene): Built {
  const root = graph.createNode('FRAME', graph.getPages()[0]!.id, { name: spec.name, width: 256, height: 192, fills: [] });
  const panel = graph.createNode('FRAME', root.id, { name: 'Rotating panel', x: spec.panel.x, y: spec.panel.y, width: 118, height: 88, rotation: spec.panel.rotation, fills: [] });
  let mask: SceneNode | undefined;
  if (spec.masked) {
    mask = graph.createNode('ELLIPSE', panel.id, {
      name: 'Inserted alpha mask', x: spec.maskX ?? 34, y: spec.maskY ?? 14, width: 68, height: 58,
      fills: [solid()], isMask: true, maskType: 'ALPHA', opacity: .78,
    });
  }
  const art = graph.createNode('RECTANGLE', panel.id, {
    name: 'One semantic artwork layer', x: spec.artX, y: 12, width: 76, height: 58,
    fills: [solid(ink, .9)],
  });
  const nodes = new Map<string, SceneNode>([['root', root], ['panel', panel], ['art', art]]);
  if (mask) nodes.set('mask', mask);
  return { root, panel, art, ...(mask ? { mask } : {}), nodes };
}

type BooleanScene = {
  name: string;
  panel: PanelPose;
  mask: { x: number; y: number; rotation: number };
  secondMask?: { x: number; y: number; width: number; height: number };
  rectangle: { x: number; y: number; width: number; height: number };
  ellipse: { x: number; y: number; width: number; height: number };
  art: { x: number; y: number };
};

function booleanScene(graph: SceneGraph, spec: BooleanScene): Built {
  const root = graph.createNode('FRAME', graph.getPages()[0]!.id, { name: spec.name, width: 256, height: 192, fills: [] });
  const panel = graph.createNode('FRAME', root.id, { name: 'Rotating boolean panel', x: spec.panel.x, y: spec.panel.y, width: 118, height: 88, rotation: spec.panel.rotation, fills: [] });
  const mask = graph.createNode('BOOLEAN_OPERATION', panel.id, {
    name: 'Nested vector mask root', x: spec.mask.x, y: spec.mask.y, width: 76, height: 62, rotation: spec.mask.rotation,
    fills: [solid()], isMask: true, maskType: 'VECTOR', booleanOperation: 'UNION',
  });
  const rectangle = graph.createNode('RECTANGLE', mask.id, {
    name: 'Boolean rectangle', x: spec.rectangle.x, y: spec.rectangle.y,
    width: spec.rectangle.width, height: spec.rectangle.height, fills: [solid()],
  });
  const ellipse = graph.createNode('ELLIPSE', mask.id, {
    name: 'Boolean ellipse', x: spec.ellipse.x, y: spec.ellipse.y,
    width: spec.ellipse.width, height: spec.ellipse.height, fills: [solid()],
  });
  const secondMask = spec.secondMask ? graph.createNode('ELLIPSE', panel.id, {
    name: 'Inserted vector intersection mask', x: spec.secondMask.x, y: spec.secondMask.y,
    width: spec.secondMask.width, height: spec.secondMask.height,
    fills: [solid()], isMask: true, maskType: 'VECTOR', opacity: 1,
  }) : undefined;
  const art = graph.createNode('RECTANGLE', panel.id, {
    name: 'One semantic artwork layer', x: spec.art.x, y: spec.art.y, width: 76, height: 58,
    fills: [solid(ink, .9)],
  });
  const nodes = new Map<string, SceneNode>([['root', root], ['panel', panel], ['mask', mask], ['rectangle', rectangle], ['ellipse', ellipse], ['art', art]]);
  if (secondMask) nodes.set('secondMask', secondMask);
  return { root, panel, art, mask, nodes };
}

function lerp(a: number, b: number, p: number) { return a + (b - a) * p; }
type Affine = [number, number, number, number, number, number];
function affine(node: SceneNode, graph: SceneGraph): Affine {
  const matrix = getWorldMatrix(node, graph);
  return [matrix[0]!, matrix[3]!, matrix[1]!, matrix[4]!, matrix[2]!, matrix[5]!];
}
function endpointPose(a: Affine, b: Affine, p: number): Affine {
  const from = Math.atan2(a[1], a[0]), to = Math.atan2(b[1], b[0]);
  let delta = to - from;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  const angle = from + delta * p, cosine = Math.cos(angle), sine = Math.sin(angle);
  return [cosine, sine, -sine, cosine, lerp(a[4], b[4], p), lerp(a[5], b[5], p)];
}
function multiply(a: Affine, b: Affine): Affine {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function invert(m: Affine): Affine {
  const determinant = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) throw new Error('Reference transform is singular.');
  const a = m[3] / determinant, b = -m[1] / determinant, c = -m[2] / determinant, d = m[0] / determinant;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
function applyWorldPose(graph: SceneGraph, node: SceneNode, desiredWorld: Affine) {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined;
  if (!parent) throw new Error('Reference transform needs a parent.');
  const local = multiply(invert(affine(parent, graph)), desiredWorld);
  node.rotation = Math.atan2(local[1], local[0]) * 180 / Math.PI;
  const zero = getNodeLocalMatrix(node, { x: 0, y: 0 });
  node.x = local[4] - zero[2]!;
  node.y = local[5] - zero[5]!;
  graph.clearAbsPosCache();
}
function installIndependentWorldPoses(referenceGraph: SceneGraph, reference: Built, fromGraph: SceneGraph, from: Built, toGraph: SceneGraph, to: Built, p: number, keepTargetOnlyAtEndpoint = false) {
  for (const [key, node] of reference.nodes) {
    if (key === 'root') continue;
    const a = from.nodes.get(key), b = to.nodes.get(key);
    let desired: Affine;
    if (a && b) desired = endpointPose(affine(a, fromGraph), affine(b, toGraph), p);
    else if (b && keepTargetOnlyAtEndpoint) desired = affine(b, toGraph);
    else if (a) desired = affine(a, fromGraph);
    else continue;
    applyWorldPose(referenceGraph, node, desired);
  }
}
function insertAt(a: InsertScene, b: InsertScene, p: number, masked: boolean): InsertScene {
  return {
    name: `Independent ${p} ${masked ? 'masked' : 'plain'}`,
    panel: { x: lerp(a.panel.x, b.panel.x, p), y: lerp(a.panel.y, b.panel.y, p), rotation: lerp(a.panel.rotation, b.panel.rotation, p) },
    artX: lerp(a.artX, b.artX, p), masked,
    ...(masked ? { maskX: b.maskX, maskY: b.maskY } : {}),
  };
}
function booleanAt(a: BooleanScene, b: BooleanScene, p: number, includeSecondMask: boolean): BooleanScene {
  const secondMask = a.secondMask ?? b.secondMask;
  return {
    name: `Independent nested boolean ${p}`,
    panel: { x: lerp(a.panel.x, b.panel.x, p), y: lerp(a.panel.y, b.panel.y, p), rotation: lerp(a.panel.rotation, b.panel.rotation, p) },
    mask: { x: lerp(a.mask.x, b.mask.x, p), y: lerp(a.mask.y, b.mask.y, p), rotation: lerp(a.mask.rotation, b.mask.rotation, p) },
    ...(includeSecondMask && secondMask ? { secondMask: { ...secondMask } } : {}),
    rectangle: { x: lerp(a.rectangle.x, b.rectangle.x, p), y: lerp(a.rectangle.y, b.rectangle.y, p), width: lerp(a.rectangle.width, b.rectangle.width, p), height: lerp(a.rectangle.height, b.rectangle.height, p) },
    ellipse: { x: lerp(a.ellipse.x, b.ellipse.x, p), y: lerp(a.ellipse.y, b.ellipse.y, p), width: lerp(a.ellipse.width, b.ellipse.width, p), height: lerp(a.ellipse.height, b.ellipse.height, p) },
    art: { x: lerp(a.art.x, b.art.x, p), y: lerp(a.art.y, b.art.y, p) },
  };
}

function pixels(image: string) {
  const bytes = new Uint8Array(Buffer.from(image.split(',')[1]!, 'base64'));
  const decoded = kit.MakeImageFromEncoded(bytes);
  if (!decoded) throw new Error('Native mask-transform image could not be decoded.');
  try {
    const width = decoded.width(), height = decoded.height();
    const data = decoded.readPixels(0, 0, { width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB });
    if (!data) throw new Error('Native mask-transform comparison pixels are unavailable.');
    return new Uint8Array(data);
  } finally { decoded.delete(); }
}
function maxDifference(a: Uint8Array, b: Uint8Array) {
  expect(a.length).toBe(b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
  return max;
}
async function render(graph: SceneGraph, root: SceneNode) {
  const model = await renderNativeReactModel(kit, graph, [root.id]);
  if (!model.nodes[0]?.image) throw new Error('Native mask-transform scene did not produce pixels.');
  return pixels(model.nodes[0].image);
}

it('inserts a mask beneath a rotated parent using full-image independent native endpoint references', async () => {
  const editor = createEditor(), fromRef = createEditor(), toRef = createEditor();
  const fromSpec: InsertScene = { name: 'From rotated panel', panel: { x: 68, y: 54, rotation: -17 }, artX: 12, masked: false };
  const toSpec: InsertScene = { name: 'To rotated panel', panel: { x: 74, y: 52, rotation: 21 }, artX: 25, masked: true, maskX: 33, maskY: 13 };
  const from = insertScene(editor.graph, fromSpec), to = insertScene(editor.graph, toSpec);
  try {
    const sourceSnapshot = serializeGraph(editor.graph);
    const startPixels = await render(editor.graph, from.root), endPixels = await render(editor.graph, to.root);
    const references = new Map<number, Uint8Array>();
    for (const p of samples) {
      const fromAt = insertScene(fromRef.graph, insertAt(fromSpec, toSpec, p, false));
      const toAt = insertScene(toRef.graph, insertAt(fromSpec, toSpec, p, true));
      installIndependentWorldPoses(fromRef.graph, fromAt, editor.graph, from, editor.graph, to, p);
      installIndependentWorldPoses(toRef.graph, toAt, editor.graph, from, editor.graph, to, p, true);
      const a = await render(fromRef.graph, fromAt.root), b = await render(toRef.graph, toAt.root);
      references.set(p, a.map((value, index) => Math.round(value * (1 - p) + b[index]! * p)));
    }
    const dissolved = startPixels.map((value, index) => Math.round(value * .5 + endPixels[index]! * .5));
    expect(maxDifference(references.get(.5)!, dissolved)).toBeGreaterThan(2);
    expect(references.get(.5)!.some((value, index) => index % 4 === 3 && value > 24)).toBe(true);

    const plan = await prepareNativeReactMotion(kit, editor.graph, {
      sessionId: 201, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id },
    });
    const sampler = createNativeReactMotionGraph(editor.graph, from.root.id, editor.graph, to.root.id, { ...link, target: to.root.id });
    const sourceId = sampler.sourceNodeId(from.art.id)!;
    expect(sampler.sourceNodeId(to.art.id)).toBe(sourceId);
    expect([...sampler.sample(.5).nodes.values()].filter(node => node.name === 'One semantic artwork layer')).toHaveLength(1);
    expect(maxDifference(pixels((await plan.frame(0)).nodes[0]!.image!), startPixels)).toBe(0);
    expect(maxDifference(pixels((await plan.frame(1)).nodes[0]!.image!), endPixels)).toBe(0);
    const retained = new Map<number, string>();
    for (const p of samples) {
      const frame = await plan.frame(p);
      const actual = pixels(frame.nodes[0]!.image!);
      expect(maxDifference(actual, references.get(p)!)).toBeLessThanOrEqual(2);
      retained.set(p, frame.nodes[0]!.image!);
    }
    await plan.frame(.75); await plan.frame(.25);
    expect((await plan.frame(.5)).nodes[0]!.image).toBe(retained.get(.5));
    expect(serializeGraph(editor.graph)).toBe(sourceSnapshot);
  } finally { editor.dispose(); fromRef.dispose(); toRef.dispose(); }
});

it('composes an inserted vector intersection mask around moving nested Boolean geometry and a rotated parent', async () => {
  const editor = createEditor(), fromRef = createEditor(), toRef = createEditor();
  const fromSpec: BooleanScene = {
    name: 'Nested Boolean from', panel: { x: 68, y: 54, rotation: -14 }, mask: { x: 12, y: 10, rotation: -5 },
    rectangle: { x: 2, y: 4, width: 36, height: 32 }, ellipse: { x: 28, y: 18, width: 37, height: 33 }, art: { x: 20, y: 14 },
  };
  const toSpec: BooleanScene = {
    name: 'Nested Boolean to', panel: { x: 74, y: 52, rotation: 19 }, mask: { x: 19, y: 13, rotation: 9 },
    secondMask: { x: 33, y: 17, width: 62, height: 54 },
    rectangle: { x: 7, y: 7, width: 39, height: 29 }, ellipse: { x: 23, y: 21, width: 34, height: 37 }, art: { x: 25, y: 19 },
  };
  const from = booleanScene(editor.graph, fromSpec), to = booleanScene(editor.graph, toSpec);
  try {
    const sourceSnapshot = serializeGraph(editor.graph);
    const startPixels = await render(editor.graph, from.root), endPixels = await render(editor.graph, to.root);
    const references = new Map<number, Uint8Array>();
    for (const p of samples) {
      const fromAt = booleanScene(fromRef.graph, booleanAt(fromSpec, toSpec, p, false));
      const toAt = booleanScene(toRef.graph, booleanAt(toSpec, fromSpec, 1 - p, true));
      installIndependentWorldPoses(fromRef.graph, fromAt, editor.graph, from, editor.graph, to, p);
      installIndependentWorldPoses(toRef.graph, toAt, editor.graph, from, editor.graph, to, p, true);
      const a = await render(fromRef.graph, fromAt.root), b = await render(toRef.graph, toAt.root);
      references.set(p, a.map((value, index) => Math.round(value * (1 - p) + b[index]! * p)));
    }
    const endpointDissolve = startPixels.map((value, index) => Math.round(value * .5 + endPixels[index]! * .5));
    expect(maxDifference(references.get(.5)!, endpointDissolve)).toBeGreaterThan(2);
    expect(references.get(.5)!.some((value, index) => index % 4 === 3 && value > 24)).toBe(true);
    const plan = await prepareNativeReactMotion(kit, editor.graph, {
      sessionId: 202, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id },
    });
    const sampler = createNativeReactMotionGraph(editor.graph, from.root.id, editor.graph, to.root.id, { ...link, target: to.root.id });
    const artworkSource = sampler.sourceNodeId(from.art.id)!;
    expect(sampler.sourceNodeId(to.art.id)).toBe(artworkSource);
    expect([...sampler.sample(.5).nodes.values()].filter(node => node.name === 'One semantic artwork layer')).toHaveLength(1);
    expect(maxDifference(pixels((await plan.frame(0)).nodes[0]!.image!), startPixels)).toBe(0);
    expect(maxDifference(pixels((await plan.frame(1)).nodes[0]!.image!), endPixels)).toBe(0);

    for (const p of samples) {
      const actual = pixels((await plan.frame(p)).nodes[0]!.image!);
      expect(actual.some((value, index) => index % 4 === 3 && value > 24)).toBe(true);
      expect(maxDifference(actual, references.get(p)!)).toBeLessThanOrEqual(2);
    }
    await plan.frame(.25); const midpoint = (await plan.frame(.5)).nodes[0]!.image!;
    expect((await plan.frame(.5)).nodes[0]!.image).toBe(midpoint);
    expect(serializeGraph(editor.graph)).toBe(sourceSnapshot);
  } finally { editor.dispose(); fromRef.dispose(); toRef.dispose(); }
}, 30_000);
