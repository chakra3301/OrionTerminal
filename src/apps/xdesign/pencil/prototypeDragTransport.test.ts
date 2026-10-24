import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { parseFigBuffer } from '@open-pencil/fig';
import { serializeGraph, deserializeGraph } from './document';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { parseFigWithSlots } from './figSlots';
import { setPrototypeInteractions, readPrototype, prototypeResolver } from './prototype';
import { installPrototypeEditing } from './prototypeEditing';
import { withClipboardVideoResources } from './videoClipboard';
let editor: Editor;
beforeEach(() => { editor = createEditor(); installPrototypeEditing(editor); });
afterEach(() => editor.dispose());
function scene() { const graph = editor.graph, first = graph.createNode('FRAME', editor.state.currentPageId, { name: 'First' }), second = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Second' }), node = graph.createNode('RECTANGLE', first.id, { name: 'Drag' }); setPrototypeInteractions(editor, node, [{ id: 'drag', trigger: { type: 'drag' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'navigate', target: second.id, transition: 'smart', duration: 375, easing: 'ease-in-out' }, { action: 'back', transition: 'push', direction: 'left', duration: 250 }] } }]); return { graph, first, second, node }; }
it('writes schema-native DRAG and all action fields, then reopens without plugin fallback or source changes', async () => {
  const { graph, node } = scene(), before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)), parsed = parseFigBuffer(new Uint8Array(bytes).buffer), target = parsed.nodeChanges.find(node => node.name === 'Second')!.guid;
  expect(parsed.nodeChanges.find(node => node.name === 'Drag')!.prototypeInteractions).toMatchObject([{ event: { interactionType: 'DRAG' }, actions: [{ connectionType: 'INTERNAL_NODE', transitionType: 'SMART_ANIMATE', transitionNodeID: target, transitionDuration: 0.375 }, { connectionType: 'BACK', transitionType: 'PUSH_FROM_LEFT', transitionDuration: 0.25 }] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer); for (const node of reopened.nodes.values()) node.pluginData = []; const drag = [...reopened.nodes.values()].find(node => node.name === 'Drag')!, destination = [...reopened.nodes.values()].find(node => node.name === 'Second')!;
  expect(readPrototype(drag, prototypeResolver(reopened)).interactions![0]!).toMatchObject({ trigger: { type: 'drag' }, navigation: { action: 'sequence', actions: [{ target: destination.id, transition: 'smart' }, { action: 'back', transition: 'push' }] } }); expect(serializeGraph(graph)).toBe(before); expect(readPrototype(deserializeGraph(before).getNode(node.id)!).interactions).toEqual(readPrototype(node).interactions);
});
it('preserves drag sequences and remaps destinations through undo, duplicate, snapshot and closed-session HTML', async () => {
  const { graph, first, second, node } = scene(); editor.undoAction(); expect(readPrototype(node).interactions).toBeUndefined(); editor.redoAction(); editor.select([first.id, second.id]);
  const check = (target: Editor) => { const [source, destination] = target.getSelectedNodes(); expect(readPrototype(target.graph.getNode(source!.childIds[0]!)!).interactions![0]!).toMatchObject({ trigger: { type: 'drag' }, navigation: { actions: [{ target: destination!.id }, { action: 'back' }] } }); };
  editor.duplicateSelected(); check(editor); editor.undoAction(); editor.select([first.id, second.id]); const before = serializeGraph(graph), payload = await editor.prepareCopy(); withClipboardVideoResources(graph, payload); const target = createEditor(); installPrototypeEditing(target);
  try { await target.pasteSnapshot(payload.snapshot!); check(target); target.undoAction(); await target.pasteFromHTML(payload.html); check(target); target.undoAction(); target.redoAction(); check(target); expect(serializeGraph(graph)).toBe(before); } finally { target.dispose(); }
});
it('refuses overlapping pointer triggers and unverified native drag timing atomically', () => {
  const { graph, node } = scene(), before = serializeGraph(graph), interaction = readPrototype(node).interactions![0]!;
  for (const type of ['press', 'pointer-down', 'pointer-up'] as const) expect(() => setPrototypeInteractions(editor, node, [interaction, { id: type, trigger: { type }, navigation: { action: 'back', transition: 'instant', duration: 0 } }])).toThrow('On drag'); expect(serializeGraph(graph)).toBe(before);
  const raw = graph.createNode('RECTANGLE', editor.state.currentPageId); for (const event of [{ interactionType: 'DRAG', interactionDuration: 0.1 }, { interactionType: 'DRAG', interactionMaintained: true }]) { raw.source.fig.rawNodeFields = { prototypeInteractions: [{ event, actions: [{ connectionType: 'BACK' }] }] }; expect(readPrototype(raw).issue).toContain('timing'); }
});
