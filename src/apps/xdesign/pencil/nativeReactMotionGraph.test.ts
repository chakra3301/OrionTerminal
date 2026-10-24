// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { fontManager } from '@open-pencil/core/text';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { serializeGraph } from './document';
import { renderNativeSceneImage } from './nativeSceneArtwork';
import { createNativeReactMotionGraph } from './nativeReactMotionGraph';
import type { DesignNavigation } from './reactExportRuntime';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); await fontManager.loadFont('Inter', 'Regular'); fontManager.setOnlineFontProviders({ google: false, fontshare: false, fontsource: false }); });

const red = { r: 1, g: 0, b: 0, a: 1 }, blue = { r: 0, g: 0, b: 1, a: 1 };
const solid = (color = red) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color });
const gradient = (a: typeof red, b: typeof blue) => ({ type: 'GRADIENT_LINEAR' as const, visible: true, opacity: 1, color: a,
  gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, gradientStops: [{ position: 0, color: a }, { position: 1, color: b }] });
const navigation: DesignNavigation = { action: 'navigate', target: 'next', transition: 'smart', duration: 300, easing: 'linear' };

function makeEndpoint(end: 'from' | 'to' | 'quarter' | 'middle') {
  const editor = createEditor(), graph = editor.graph, pageId = editor.state.currentPageId;
  const p = end === 'from' ? 0 : end === 'to' ? 1 : end === 'middle' ? .5 : .25;
  const blend = (a: typeof red, b: typeof blue) => ({ r: a.r + (b.r - a.r) * p, g: a.g + (b.g - a.g) * p, b: a.b + (b.b - a.b) * p, a: 1 });
  const root = graph.createNode('FRAME', pageId, { name: 'Motion frame', width: 100 + 40 * p, height: 100, fills: [] });
  const panel = graph.createNode('FRAME', root.id, { name: 'Blurred panel', x: 20 + 20 * p, y: 10, width: 40 + 20 * p, height: 36, fills: [], effects: [{ type: 'LAYER_BLUR', visible: true, radius: 2 + 4 * p, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } }] });
  const rect = graph.createNode('RECTANGLE', panel.id, { name: 'Gradient with stroke', x: 4, y: 4, width: 32 + 20 * p, height: 26, fills: [gradient(blend(red, blue), blend(blue, red))], strokes: [{ ...solid(blend(blue, red)), weight: 2 + 2 * p, align: 'CENTER' }] });
  const mask = graph.createNode('ELLIPSE', root.id, { name: 'Clip mask', x: 76, y: 12, width: 24, height: 24, isMask: true, fills: [solid()] });
  const masked = graph.createNode('RECTANGLE', root.id, { name: 'Masked color', x: 76, y: 12, width: 30, height: 24, fills: [solid(blend(red, blue))] });
  const text = graph.createNode('TEXT', root.id, { name: 'Same face text', x: 14, y: 62, width: 84, height: 24, text: 'Motion text', fontFamily: 'Inter', fontSize: 12 + 8 * p, fontWeight: 400, fills: [solid(blue)] });
  const vectorWidth = 20 + 10 * p, vectorHeight = 20 - 10 * p;
  const vector = graph.createNode('VECTOR', root.id, { name: 'Morph vector', x: 72, y: 70, width: vectorWidth, height: vectorHeight, fills: [solid({ r: 0, g: .7, b: 0, a: 1 })], vectorNetwork: { vertices: [{ x: 0, y: 0 }, { x: vectorWidth, y: 0 }, { x: vectorWidth, y: vectorHeight }, { x: 0, y: vectorHeight }], segments: [0, 1, 2, 3].map(start => ({ start, end: (start + 1) % 4, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } })), regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }] } });
  return { editor, graph, root, panel, rect, mask, masked, text, vector };
}

function imageHash(graph: SceneGraph, node: SceneNode) {
  const image = renderNativeSceneImage(kit, graph, node, true);
  return createHash('sha256').update(image.bytes).digest('hex');
}

it('samples fresh native graphs that match an independently authored midpoint with gradient, stroke, blur, mask, and text', () => {
  const from = makeEndpoint('from'), to = makeEndpoint('to'), reference = makeEndpoint('middle');
  try {
    const beforeFrom = serializeGraph(from.graph), beforeTo = serializeGraph(to.graph);
    const motion = createNativeReactMotionGraph(from.graph, from.root.id, to.graph, to.root.id, navigation);
    const halfway = motion.sample(.5), second = motion.sample(.5), halfwayRoot = halfway.getNode(motion.rootId)!;
    expect(motion.matched).toBe(7);
    expect(halfway).not.toBe(second);
    expect(halfway.getNode(halfwayRoot.childIds[0]!)!.width).toBe(50);
    expect(halfway.getNode(halfway.getNode(halfwayRoot.childIds[0]!)!.childIds[0]!)!.strokes[0]!.weight).toBe(3);
    expect(halfway.getNode([...halfway.nodes.values()].find(node => node.name === 'Same face text')!.id)!.fontSize).toBe(16);
    expect(halfway.getNode([...halfway.nodes.values()].find(node => node.name === 'Morph vector')!.id)!.vectorNetwork!.vertices).toEqual([{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 15 }, { x: 0, y: 15 }]);
    expect(motion.sourceNodeId(from.masked.id)).toBe(halfway.getNode([...halfway.nodes.values()].find(node => node.name === 'Masked color')!.id)!.id);
    expect(imageHash(halfway, halfwayRoot)).toBe(imageHash(reference.graph, reference.root));
    const quarterReference = makeEndpoint('quarter'), quarter = motion.sample(.25);
    try { expect(imageHash(quarter, quarter.getNode(motion.rootId)!)).toBe(imageHash(quarterReference.graph, quarterReference.root)); }
    finally { quarterReference.editor.dispose(); }
    expect(serializeGraph(from.graph)).toBe(beforeFrom);
    expect(serializeGraph(to.graph)).toBe(beforeTo);
    expect(() => motion.sample(Number.NaN)).toThrow('finite');
    expect(() => motion.sample(101)).toThrow('within -100 to 100');
  } finally { from.editor.dispose(); to.editor.dispose(); reference.editor.dispose(); }
});

it('keeps added and removed native branches in the sampled graph with stable IDs and opacity', () => {
  const from = makeEndpoint('from'), to = makeEndpoint('to');
  try {
    const removed = from.graph.createNode('ELLIPSE', from.root.id, { name: 'Removed decoration', x: 4, y: 88, width: 5, height: 5, fills: [solid()] });
    const added = to.graph.createNode('ELLIPSE', to.root.id, { name: 'Added decoration', x: 12, y: 88, width: 5, height: 5, fills: [solid(blue)] });
    from.root.childIds = [removed.id, ...from.root.childIds.filter(id => id !== removed.id)];
    to.root.childIds = [added.id, ...to.root.childIds.filter(id => id !== added.id)];
    const motion = createNativeReactMotionGraph(from.graph, from.root.id, to.graph, to.root.id, navigation);
    const first = motion.sample(0), middle = motion.sample(.5), again = motion.sample(.5), last = motion.sample(1);
    const id = motion.sourceNodeId(added.id)!;
    expect(motion.sourceNodeId(removed.id)).toBeTruthy();
    expect(first.getNode(id)?.opacity).toBe(0);
    expect(middle.getNode(id)?.opacity).toBe(.5);
    expect(again.getNode(id)?.id).toBe(id);
    expect(last.getNode(id)?.opacity).toBe(1);
    expect(middle.getNode(motion.sourceNodeId(removed.id)!)?.opacity).toBe(.5);
  } finally { from.editor.dispose(); to.editor.dispose(); }
});

it('keeps compatible native subtree pixels at endpoints and reports matched world movement', () => {
  const from = makeEndpoint('from'), to = makeEndpoint('to');
  try {
    const motion = createNativeReactMotionGraph(from.graph, from.root.id, to.graph, to.root.id, navigation);
    const start = motion.sample(0), finish = motion.sample(1);
    expect(imageHash(start, start.getNode(motion.rootId)!)).toBe(imageHash(from.graph, from.root));
    expect(imageHash(finish, finish.getNode(motion.rootId)!)).toBe(imageHash(to.graph, to.root));
    expect(motion.movement(from.rect.id)).toEqual({ x: 20, y: 0 });
  } finally { from.editor.dispose(); to.editor.dispose(); }
});

it('samples a changed native mask role while preserving the common artwork identity', () => {
  const from = makeEndpoint('from'), to = makeEndpoint('to');
  try {
    to.graph.getNode(to.mask.id)!.isMask = false;
    const motion=createNativeReactMotionGraph(from.graph,from.root.id,to.graph,to.root.id,navigation);
    const sample=motion.sample(.5);expect(sample.getNode(motion.sourceNodeId(from.rect.id)!)).toBeTruthy();
    expect(motion.sourceNodeId(from.rect.id)).toBe(motion.sourceNodeId(to.rect.id));
  } finally { from.editor.dispose(); to.editor.dispose(); }
});

it('removes group blur on one interpolated child tree with independently authored native pixels', () => {
  const from = makeEndpoint('from'), to = makeEndpoint('to');
  const reference = makeEndpoint('middle');
  try {
    to.graph.getNode(to.panel.id)!.effects = [];
    reference.panel.effects[0]!.radius = 1;
    const motion = createNativeReactMotionGraph(from.graph, from.root.id, to.graph, to.root.id, navigation), middle = motion.sample(.5);
    expect([...middle.nodes.values()].filter(node => node.name === 'Gradient with stroke')).toHaveLength(1);
    expect(imageHash(middle, middle.getNode(motion.rootId)!)).toBe(imageHash(reference.graph, reference.root));
    const last = motion.sample(1); expect(imageHash(last, last.getNode(motion.rootId)!)).toBe(imageHash(to.graph, to.root));
  } finally { from.editor.dispose(); to.editor.dispose(); reference.editor.dispose(); }
});

it('keeps incompatible text faces as two native fading layers', () => {
  const from = makeEndpoint('from'), to = makeEndpoint('to');
  try {
    to.graph.getNode(to.text.id)!.fontFamily = 'Unbundled alternate face';
    const motion = createNativeReactMotionGraph(from.graph, from.root.id, to.graph, to.root.id, navigation), sample = motion.sample(.5);
    const texts = [...sample.nodes.values()].filter(node => node.name === 'Same face text');
    expect(texts).toHaveLength(2);
    expect(texts.map(node => node.opacity)).toEqual([.5, .5]);
    expect(texts.map(node => node.fontFamily)).toContain('Inter');
    expect(texts.map(node => node.fontFamily)).toContain('Unbundled alternate face');
  } finally { from.editor.dispose(); to.editor.dispose(); }
});
