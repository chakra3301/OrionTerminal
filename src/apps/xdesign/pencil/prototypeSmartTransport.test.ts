import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { parseFigBuffer } from '@open-pencil/fig';
import { serializeGraph, deserializeGraph } from './document';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { parseFigWithSlots } from './figSlots';
import { setNavigation, readNavigation, readPrototype, prototypeResolver } from './prototype';
import { installPrototypeEditing } from './prototypeEditing';
import { withClipboardVideoResources } from './videoClipboard';
import type { DesignNavigation } from './reactExportRuntime';
let editor: Editor;
beforeEach(() => { editor = createEditor(); installPrototypeEditing(editor); });
afterEach(() => editor.dispose());
it('round-trips native Smart Animate and all twenty directional matching families with GUIDs and authored timing', async () => {
  const graph = editor.graph, source = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Source' }), target = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Target' }), expected = new Map<string, DesignNavigation>();
  for (const transition of ['smart', 'slide', 'slide-out', 'move-in', 'move-out', 'push'] as const) for (const direction of transition === 'smart' ? [undefined] : ['left', 'right', 'top', 'bottom'] as const) {
    const name = `${transition}/${direction ?? 'none'}`, node = graph.createNode('RECTANGLE', source.id, { name }), navigation: DesignNavigation = { action: 'navigate', target: target.id, transition, duration: 375, easing: [0.25, -0.125, 0.75, 1.125], ...(direction ? { direction, matchLayers: true } : {}) }; setNavigation(editor, node, navigation); expected.set(name, navigation);
  }
  const before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)), native = parseFigBuffer(new Uint8Array(bytes).buffer), guid = native.nodeChanges.find(node => node.name === 'Target')!.guid; expect(serializeGraph(graph)).toBe(before);
  expect(native.nodeChanges.find(node => node.name === 'smart/none')!.prototypeInteractions).toMatchObject([{ actions: [{ transitionNodeID: guid, transitionType: 'SMART_ANIMATE', transitionDuration: 0.375, easingType: 'CUSTOM_CUBIC', easingFunction: [0.25, -0.125, 0.75, 1.125] }] }]);
  for (const [name, navigation] of expected) if (navigation.matchLayers) expect(native.nodeChanges.find(node => node.name === name)!.prototypeInteractions).toMatchObject([{ actions: [{ transitionShouldSmartAnimate: true }] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer); reopened.nodes.forEach(node => { node.pluginData = []; }); const nodes = [...reopened.nodes.values()], resolve = prototypeResolver(reopened), targetId = nodes.find(node => node.name === 'Target')!.id;
  for (const [name, navigation] of expected) expect(readNavigation(nodes.find(node => node.name === name)!, resolve)).toEqual({ ...navigation, target: targetId });
});
it('supports overlay swaps and preserves/refuses Smart Animate overlay open/close and invalid matching flags', () => {
  const source = editor.graph.createNode('FRAME', editor.state.currentPageId), target = editor.graph.createNode('FRAME', editor.state.currentPageId), navigation: DesignNavigation = { action: 'swap', target: target.id, transition: 'smart', duration: 200 };
  setNavigation(editor, source, navigation); expect(readNavigation(source)).toEqual(navigation); const before = serializeGraph(editor.graph);
  for (const patch of [{ action: 'overlay' }, { action: 'close' }, { transition: 'dissolve', matchLayers: true }, { transition: 'smart', matchLayers: true }, { transition: 'push', matchLayers: 'yes' }]) expect(() => setNavigation(editor, source, { ...navigation, ...patch } as DesignNavigation)).toThrow('valid');
  expect(serializeGraph(editor.graph)).toBe(before); const imported = editor.graph.createNode('RECTANGLE', source.id);
  imported.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'INTERNAL_NODE', navigationType: 'OVERLAY', transitionNodeID: { sessionID: 9, localID: 2 }, transitionType: 'SMART_ANIMATE' }] }] }; expect(readPrototype(imported)).toMatchObject({ imported: true, issue: expect.stringContaining('cannot play') });
});
it('preserves Smart Animate/matching through native undo, save/reopen, duplicate and closed-session snapshot/HTML clipboard', async () => {
  const graph = editor.graph, first = graph.createNode('FRAME', editor.state.currentPageId), second = graph.createNode('FRAME', editor.state.currentPageId), smart = graph.createNode('RECTANGLE', first.id), matched = graph.createNode('RECTANGLE', first.id);
  setNavigation(editor, smart, { action: 'navigate', target: second.id, transition: 'smart', duration: 750, easing: 'ease-in-out' }); setNavigation(editor, matched, { action: 'navigate', target: second.id, transition: 'push', direction: 'top', matchLayers: true, duration: 500 }); editor.undoAction(); expect(readNavigation(matched)).toBeUndefined(); editor.redoAction(); expect(readNavigation(matched)?.matchLayers).toBe(true);
  const restored = deserializeGraph(serializeGraph(graph)); expect(readNavigation(restored.getNode(smart.id)!)).toEqual(readNavigation(smart)); expect(readNavigation(restored.getNode(matched.id)!)).toEqual(readNavigation(matched));
  editor.select([first.id, second.id]); const check = (target: Editor) => { const [from, to] = target.getSelectedNodes(); expect(readNavigation(target.graph.getNode(from!.childIds[0]!)!)).toMatchObject({ target: to!.id, transition: 'smart', duration: 750 }); expect(readNavigation(target.graph.getNode(from!.childIds[1]!)!)).toMatchObject({ target: to!.id, transition: 'push', matchLayers: true, direction: 'top' }); };
  editor.duplicateSelected(); check(editor); editor.undoAction(); editor.select([first.id, second.id]); const payload = await editor.prepareCopy(); withClipboardVideoResources(graph, payload); const target = createEditor(); installPrototypeEditing(target);
  try { await target.pasteSnapshot(payload.snapshot!); check(target); target.undoAction(); await target.pasteFromHTML(payload.html); check(target); target.undoAction(); target.redoAction(); check(target); } finally { target.dispose(); }
});
