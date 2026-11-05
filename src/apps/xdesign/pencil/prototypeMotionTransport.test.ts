import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { parseFigBuffer } from '@open-pencil/fig';
import { serializeGraph, deserializeGraph } from './document';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { prepareFigPrototype } from './figPrototype';
import { parseFigWithSlots } from './figSlots';
import { setNavigation, readNavigation, readPrototype, prototypeResolver } from './prototype';
import { installPrototypeEditing } from './prototypeEditing';
import { withClipboardVideoResources } from './videoClipboard';
import { designSpringDuration, type DesignNavigation, type DesignSpring } from './reactExportRuntime';
let editor: Editor;
const spring: DesignSpring = { type: 'spring', mass: 2, stiffness: 160, damping: 20, initialVelocity: -1 };
beforeEach(() => { editor = createEditor(); installPrototypeEditing(editor); });
afterEach(() => editor.dispose());
const enums = { slide: 'SLIDE_FROM', 'slide-out': 'SLIDE_OUT_TO', 'move-in': 'MOVE_FROM', 'move-out': 'MOVE_OUT_TO', push: 'PUSH_FROM' } as const;
it('round-trips all twenty directional transitions and long authored durations through native FIG without plugin fallback', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, source = graph.createNode('FRAME', page, { name: 'Source' }), destination = graph.createNode('FRAME', page, { name: 'Destination' });
  const actions: { name: string; navigation: DesignNavigation; native: string }[] = [];
  for (const [transition, prefix] of Object.entries(enums)) for (const direction of ['left', 'right', 'top', 'bottom'] as const) {
    const name = `${transition}/${direction}`, node = graph.createNode('RECTANGLE', source.id, { name }), navigation: DesignNavigation = { action: 'navigate', target: destination.id, transition: transition as DesignNavigation['transition'], direction, duration: direction === 'bottom' ? 10000 : 4000, easing: [0.25, -1, 0.75, 2] };
    setNavigation(editor, node, navigation); actions.push({ name, navigation, native: `${prefix}_${direction.toUpperCase()}` });
  }
  const before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)), parsed = parseFigBuffer(new Uint8Array(bytes).buffer), target = parsed.nodeChanges.find(node => node.name === 'Destination')!;
  expect(serializeGraph(graph)).toBe(before);
  for (const action of actions) expect(parsed.nodeChanges.find(node => node.name === action.name)?.prototypeInteractions).toMatchObject([{ actions: [{ transitionType: action.native, transitionDuration: action.navigation.duration / 1000, transitionNodeID: target.guid, easingType: 'CUSTOM_CUBIC', easingFunction: [0.25, -1, 0.75, 2] }] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), nodes = [...reopened.nodes.values()]; nodes.forEach(node => { node.pluginData = []; }); const resolve = prototypeResolver(reopened), targetId = nodes.find(node => node.name === 'Destination')!.id;
  for (const action of actions) expect(readNavigation(nodes.find(node => node.name === action.name)!, resolve)).toEqual({ ...action.navigation, target: targetId });
});
it('canonicalizes saved physical springs and duration, with native undo and portable reopen', () => {
  const graph = editor.graph, source = graph.createNode('FRAME', editor.state.currentPageId), destination = graph.createNode('FRAME', editor.state.currentPageId);
  const navigation: DesignNavigation = { action: 'navigate', target: destination.id, transition: 'push', direction: 'left', duration: 50, easing: { ...spring, extra: 'discard' } as DesignSpring };
  setNavigation(editor, source, navigation); const expected = { ...navigation, duration: designSpringDuration(spring), easing: spring }; expect(readNavigation(source)).toEqual(expected);
  expect(readNavigation(deserializeGraph(serializeGraph(graph)).getNode(source.id)!)).toEqual(expected);
  editor.undoAction(); expect(readNavigation(source)).toBeUndefined(); editor.redoAction(); expect(readNavigation(source)).toEqual(expected);
  const before = serializeGraph(graph);
  for (const easing of [{ ...spring, initialVelocity: null }, { ...spring, damping: 0 }, { ...spring, damping: 0.01 }]) expect(() => setNavigation(editor, source, { ...navigation, easing: easing as DesignSpring })).toThrow('valid');
  expect(serializeGraph(graph)).toBe(before);
});
it('retains springs and rebinds destinations through duplicate, snapshot and closed-session HTML clipboard', async () => {
  const graph = editor.graph, first = graph.createNode('FRAME', editor.state.currentPageId, { name: 'First' }), second = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Second' }), link = graph.createNode('RECTANGLE', first.id, { name: 'Link' });
  setNavigation(editor, link, { action: 'navigate', target: second.id, transition: 'move-in', duration: 100, easing: spring }); editor.select([first.id, second.id]);
  const check = (target: Editor) => { const [from, to] = target.getSelectedNodes(); expect(readNavigation(target.graph.getNode(from!.childIds[0]!)!)).toMatchObject({ target: to!.id, transition: 'move-in', duration: designSpringDuration(spring), easing: spring }); };
  editor.duplicateSelected(); check(editor); editor.undoAction(); editor.select([first.id, second.id]); const before = serializeGraph(graph), payload = await editor.prepareCopy(); withClipboardVideoResources(graph, payload); expect(serializeGraph(graph)).toBe(before);
  const target = createEditor(); installPrototypeEditing(target);
  try { const snapshot = structuredClone(payload.snapshot); await target.pasteSnapshot(payload.snapshot!); check(target); expect(payload.snapshot).toEqual(snapshot); target.undoAction(); await target.pasteFromHTML(payload.html); check(target); target.undoAction(); target.redoAction(); check(target); }
  finally { target.dispose(); }
});
it('refuses unsupported native spring serialization before mutating its graph, including conditional branches', async () => {
  const graph = editor.graph, node = graph.createNode('FRAME', editor.state.currentPageId);
  setNavigation(editor, node, { action: 'conditional', transition: 'instant', duration: 0, branches: [{ actions: [{ action: 'back', transition: 'dissolve', duration: 100, easing: spring }] }] });
  const before = serializeGraph(graph); expect(() => prepareFigPrototype(graph)).toThrow('authored-file comparison'); expect(serializeGraph(graph)).toBe(before);
  await expect(exportFigImageCompatible(deserializeGraph(before))).rejects.toThrow('portable XDesign'); expect(serializeGraph(graph)).toBe(before);
});
it.each(['SPRING', 'GENTLE_SPRING', 'CUSTOM_SPRING', 'SPRING_PRESET_ONE', 'SPRING_PRESET_TWO', 'SPRING_PRESET_THREE'])('preserves native %s parameter bytes and identifies its unverified transport', async easingType => {
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { name: 'Native spring' }), raw = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK', transitionType: 'MOVE_FROM_RIGHT', transitionDuration: 2, easingType, easingFunction: [1, 100, 10, -1] }] }] };
  node.source.fig.rawNodeFields = structuredClone(raw); expect(readPrototype(node)).toMatchObject({ imported: true, issue: expect.stringContaining('easing') }); const before = serializeGraph(editor.graph);
  const bytes = await exportFigImageCompatible(deserializeGraph(before)), parsed = parseFigBuffer(new Uint8Array(bytes).buffer); expect(parsed.nodeChanges.find(node => node.name === 'Native spring')!.prototypeInteractions).toEqual(raw.prototypeInteractions); expect(serializeGraph(editor.graph)).toBe(before);
});
it('bounds native and portable durations at ten seconds without rounding an excessive native duration into range', () => {
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId);
  for (const transitionDuration of [4, 10]) { node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK', transitionType: 'DISSOLVE', transitionDuration }] }] }; expect(readNavigation(node)?.duration).toBe(transitionDuration * 1000); }
  for (const transitionDuration of [10.00001, 11, Infinity, -1]) { node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK', transitionType: 'DISSOLVE', transitionDuration }] }] }; expect(readPrototype(node).issue).toContain('duration'); }
  expect(() => setNavigation(editor, node, { action: 'back', transition: 'dissolve', duration: 10001 })).toThrow('valid');
});
