// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { prepareNativeReactMotion } from './nativeReactMotion';
import { renderNativeReactModel } from './nativeReactRenderer';
import { serializeGraph } from './graphDocument';
import { setNavigation } from './prototype';
import { setPrototypeOverlay } from './prototypeOverlay';
import { setPrototypeScroll } from './prototypeScroll';
import { assignPrototypeVariable, emptyPrototypeSession } from './prototypeValues';
import { capturePrototypeVariables } from './prototypeVariableGraph';
import { bindComponentProperty, createComponentProperty } from './componentProperties';
import { setComponentBehaviour } from './behaviour/editor';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
const white = { r: 1, g: 1, b: 1, a: 1 }, red = { r: 1, g: 0, b: 0, a: 1 }, blue = { r: 0, g: 0, b: 1, a: 1 }, green = { r: 0, g: 1, b: 0, a: 1 };
const paint = (color = white) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color });
const smart = { action: 'navigate' as const, transition: 'smart' as const, duration: 300, easing: 'linear' as const };
function stage(graph: SceneGraph, width = 160) { return graph.createNode('FRAME', graph.getPages()[0]!.id, { name: 'Independent route', width, height: 80, clipsContent: false, fills: [] }); }

it('prepares bound geometry and native control endpoints, then matches independently authored intermediate route pixels', async () => {
  const editor = createEditor(), graph = editor.graph, page = editor.state.currentPageId;
  const from = graph.createNode('FRAME', page, { name: 'Start', width: 120, height: 80, fills: [paint()] }), to = graph.createNode('FRAME', page, { name: 'Finish', x: 240, width: 120, height: 80, fills: [paint()] });
  const a = graph.createNode('RECTANGLE', from.id, { name: 'Moving card', x: 10, y: 12, width: 40, height: 20, fills: [paint(red)], cornerRadius: 4 });
  const b = graph.createNode('RECTANGLE', to.id, { name: 'Moving card', x: 50, y: 30, width: 60, height: 30, fills: [paint(blue)], cornerRadius: 8 });
  const collection = graph.createCollection('Offsets'), offset = graph.createVariable('Y', 'FLOAT', collection.id, 12); graph.bindVariable(b.id, 'y', offset.id);
  const control = graph.createNode('COMPONENT', page, { name: 'Check', width: 12, height: 12, fills: [] }), mark = graph.createNode('RECTANGLE', control.id, { name: 'Mark', width: 12, height: 12, visible: false, fills: [paint(green)] });
  const checked = createComponentProperty(editor, control, 'Checked', 'BOOLEAN', 'false'); bindComponentProperty(editor, mark, 'VISIBLE', checked); setComponentBehaviour(editor, control, { kind: 'checkbox', values: { value: 'Checked' } });
  graph.createInstance(control.id, from.id, { x: 8, y: 56 }); graph.createInstance(control.id, to.id, { x: 8, y: 56 });
  setNavigation(editor, a, { ...smart, target: to.id });
  try {
    const before = serializeGraph(graph), destination = await renderNativeReactModel(kit, graph, [to.id]);
    const key = destination.nodes[0]!.children.find(node => node.control)?.control!.native!.key!;
    const session = assignPrototypeVariable(capturePrototypeVariables(graph), emptyPrototypeSession(), offset.id, { type: 'literal', value: 30 });
    const motion = await prepareNativeReactMotion(kit, graph, { sessionId: 1, from: { rootId: from.id, rootSizes: { [from.id]: { width: 160 } } }, to: { rootId: to.id, session, controls: { [key]: { value: true, state: 'rest' } }, rootSizes: { [to.id]: { width: 160 } } }, link: { ...smart, target: to.id } });
    expect(motion.motion.movements[`${from.id}/0`]).toEqual({ x: 40, y: 18 });
    const reference = createEditor();
    try {
      const root = stage(reference.graph), screen = reference.graph.createNode('FRAME', root.id, { name: 'Screen', width: 160, height: 80, fills: [paint()] });
      reference.graph.createNode('RECTANGLE', screen.id, { name: 'Card', x: 30, y: 21, width: 50, height: 25, cornerRadius: 6, fills: [paint({ r: .5, g: 0, b: .5, a: 1 })] });
      const check = reference.graph.createNode('FRAME', screen.id, { name: 'Check', x: 8, y: 56, width: 12, height: 12, fills: [] });
      reference.graph.createNode('RECTANGLE', check.id, { name: 'Mark', width: 12, height: 12, opacity: .5, fills: [paint(green)] });
      const actual = await motion.frame(.5), expected = await renderNativeReactModel(kit, reference.graph, [root.id]);
      expect(actual.nodes[0]!.image).toBe(expected.nodes[0]!.image); expect(actual.nodes[0]!.image!.length).toBeGreaterThan(100);
      expect(actual.nodes[0]!.image).not.toBe(motion.motion.initialModel.nodes[0]!.image);
      const finish = await motion.frame(1), quarter = await motion.frame(.25), middleAgain = await motion.frame(.5);
      expect(finish.nodes[0]!.image).not.toBe(actual.nodes[0]!.image); expect(quarter.nodes[0]!.image).not.toBe(actual.nodes[0]!.image);
      expect(middleAgain.nodes[0]!.image).toBe(actual.nodes[0]!.image);
    } finally { reference.dispose(); }
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it('composes base, modal position and backdrop as native route pixels and remaps live scroll offsets', async () => {
  const editor = createEditor(), graph = editor.graph, page = editor.state.currentPageId;
  const base = graph.createNode('FRAME', page, { name: 'Base', width: 120, height: 80, fills: [paint()] }), modal = graph.createNode('FRAME', page, { name: 'Modal', width: 60, height: 40, fills: [paint(green)] });
  setPrototypeOverlay(editor, modal, { position: 'bottom-right', closeOutside: true, background: { r: 0, g: 0, b: 0, a: .4 } });
  try {
    const before = serializeGraph(graph), request = { sessionId: 2, from: { rootId: base.id }, to: { rootId: base.id, overlays: [{ rootId: modal.id, controlScope: 'overlay-1', origin: { x: 0, y: 0 }, offset: { x: 0, y: 0 } }] }, link: { ...smart, action: 'overlay' as const, target: modal.id } };
    const motion = await prepareNativeReactMotion(kit, graph, request), actual = await motion.frame(.5), reference = createEditor();
    try {
      const root = stage(reference.graph, 120); reference.graph.createNode('FRAME', root.id, { name: 'Screen', width: 120, height: 80, fills: [paint()] });
      const overlay = reference.graph.createNode('FRAME', root.id, { name: 'Overlay', width: 120, height: 80, opacity: .5, fills: [paint({ r: 0, g: 0, b: 0, a: .4 })] });
      reference.graph.createNode('FRAME', overlay.id, { name: 'Modal', x: 60, y: 40, width: 60, height: 40, fills: [paint(green)] });
      const expected = await renderNativeReactModel(kit, reference.graph, [root.id]); expect(actual.nodes[0]!.image).toBe(expected.nodes[0]!.image);
    } finally { reference.dispose(); }
    expect(serializeGraph(graph)).toBe(before);
    setPrototypeScroll(editor, base, { axis: 'vertical' }); graph.createNode('RECTANGLE', base.id, { name: 'Scrolled', y: 130, width: 20, height: 20, fills: [paint(red)] });
    const scrolling = await prepareNativeReactMotion(kit, graph, { ...request, sessionId: 3, from: { rootId: base.id, scrollPositions: { [base.id]: { x: 0, y: 42 } } }, to: { rootId: base.id, scrollPositions: { [base.id]: { x: 0, y: 42 } } } });
    const frame = await scrolling.frame(.5), screen = frame.nodes[0]!.children[0]!;
    expect(screen.scroll?.axis).toBe('vertical'); expect(frame.scrollPositions?.[screen.id]).toEqual({ x: 0, y: 42 });
    const reset = await prepareNativeReactMotion(kit, graph, { ...request, sessionId: 4, from: { rootId: base.id, scrollPositions: { [base.id]: { x: 0, y: 42 } } }, to: { rootId: base.id } });
    const middle = await reset.frame(.5), end = await reset.frame(1);
    expect(middle.scrollPositions?.[middle.nodes[0]!.children[0]!.id]).toEqual({ x: 0, y: 21 });
    expect(end.scrollPositions?.[end.nodes[0]!.children[0]!.id]).toEqual({ x: 0, y: 0 });
  } finally { editor.dispose(); }
});

it('preserves a rotated reflected root at both native endpoints', async () => {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Reflected scene', x: 140, y: 20, rotation: 35, flipY: true, width: 100, height: 60, fills: [paint()] });
  graph.createNode('RECTANGLE', root.id, { name: 'Asymmetric detail', x: 8, y: 12, width: 22, height: 14, fills: [paint(red)] });
  const reference = createEditor();
  try {
    const before = serializeGraph(graph), referenceStage = stage(reference.graph, 100); referenceStage.height = 60;
    const angle = 35 * Math.PI / 180, rotated = reference.graph.createNode('FRAME', referenceStage.id, { name: 'Reflected scene', x: (100 * Math.cos(angle) + 60 * Math.sin(angle) - 100) / 2, y: (100 * Math.sin(angle) + 60 * Math.cos(angle) - 60) / 2, rotation: 35, flipY: true, width: 100, height: 60, fills: [paint()] });
    reference.graph.createNode('RECTANGLE', rotated.id, { name: 'Asymmetric detail', x: 8, y: 12, width: 22, height: 14, fills: [paint(red)] });
    const expected = await renderNativeReactModel(kit, reference.graph, [referenceStage.id]);
    const motion = await prepareNativeReactMotion(kit, graph, { sessionId: 4, from: { rootId: root.id }, to: { rootId: root.id }, link: { ...smart, target: root.id } });
    expect(motion.motion.initialModel.nodes[0]!.image).toBe(expected.nodes[0]!.image);
    expect((await motion.frame(1)).nodes[0]!.image).toBe(expected.nodes[0]!.image);
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); reference.dispose(); }
});
