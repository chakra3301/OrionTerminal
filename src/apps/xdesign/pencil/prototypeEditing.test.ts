import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { installPrototypeEditing } from './prototypeEditing';
import { readPrototype, setPrototypeInteractions, readNavigation, setNavigation } from './prototype';
import { serializeGraph, deserializeGraph } from './document';
import { withClipboardVideoResources } from './videoClipboard';
import { installSlotEditing } from './slotEditing';
import { navigatePrototype } from './prototype';
import { readPrototypeOverlay, setPrototypeOverlay } from './prototypeOverlay';

let source: Editor, target: Editor;
beforeEach(() => { source = createEditor(); target = createEditor(); installPrototypeEditing(source); installPrototypeEditing(target); });
afterEach(() => { source.dispose(); target.dispose(); });
function screens() {
  const graph = source.graph, page = source.state.currentPageId;
  const first = graph.createNode('FRAME', page, { name: 'Home' }), second = graph.createNode('FRAME', page, { name: 'Details' });
  const hotspot = graph.createNode('RECTANGLE', first.id, { name: 'Next' });
  setNavigation(source, hotspot, { action: 'navigate', target: second.id, transition: 'dissolve', duration: 300 });
  source.select([first.id, second.id]); return { first, second, hotspot };
}
function copiedTarget(editor: Editor) {
  const [first, second] = editor.getSelectedNodes();
  expect(readNavigation(editor.graph.getNode(first!.childIds[0]!)!)?.target).toBe(second!.id);
  return [first!.id, second!.id];
}
it('reconnects duplicated screens and preserves source identities in one undo step', () => {
  const { first, second, hotspot } = screens(); source.duplicateSelected(); const ids = copiedTarget(source);
  expect(readNavigation(hotspot)?.target).toBe(second.id);
  source.undoAction(); expect(ids.every(id => !source.graph.getNode(id))).toBe(true); expect(source.graph.getNode(first.id)).toBe(first);
  source.redoAction(); copiedTarget(source);
  expect(readNavigation(deserializeGraph(serializeGraph(source.graph)).getNode(source.graph.getNode(ids[0]!)!.childIds[0]!)!)?.target).toBe(ids[1]);
});

it('reconnects copied overlay and swap destinations while preserving destination settings and offsets', async () => {
  const { first, second, hotspot } = screens();
  setPrototypeOverlay(source, second, { position: 'manual', closeOutside: true, background: { r: 0, g: 0, b: 0, a: 0.5 } });
  setPrototypeInteractions(source, hotspot, [{ id: 'open', trigger: { type: 'click' }, navigation: { action: 'overlay', target: second.id, offset: { x: 3, y: 8 }, transition: 'instant', duration: 0 } }, { id: 'swap', trigger: { type: 'key', keyCodes: [65] }, navigation: { action: 'swap', target: second.id, transition: 'instant', duration: 0 } }]);
  const check = (editor: Editor) => { const [home, dialog] = editor.getSelectedNodes(); expect(readPrototype(editor.graph.getNode(home!.childIds[0]!)!).interactions?.map(interaction => interaction.navigation.target)).toEqual([dialog!.id, dialog!.id]); expect(readPrototype(editor.graph.getNode(home!.childIds[0]!)!).link?.offset).toEqual({ x: 3, y: 8 }); expect(readPrototypeOverlay(dialog!).settings).toMatchObject({ position: 'manual', closeOutside: true, background: { a: 0.5 } }); };
  source.duplicateSelected(); check(source); source.undoAction(); source.select([first.id, second.id]);
  const payload = await source.prepareCopy(); withClipboardVideoResources(source.graph, payload); await target.pasteSnapshot(payload.snapshot!); check(target); target.undoAction(); await target.pasteFromHTML(payload.html); check(target); target.undoAction(); target.redoAction(); check(target);
});
it('keeps targets outside the copied selection attached to their original screen', () => {
  const { first, second } = screens(); source.select([first.id]); source.duplicateSelected();
  const copy = source.getSelectedNodes()[0]!; expect(readNavigation(source.graph.getNode(copy.childIds[0]!)!)?.target).toBe(second.id);
});
it('marks external clipboard destinations unresolved even when a different project reuses the ID', async () => {
  const { first, second } = screens(); source.select([first.id]);
  target.graph.createNode('FRAME', target.state.currentPageId, { id: second.id, name: 'Unrelated screen' });
  await target.pasteSnapshot((await source.prepareCopy()).snapshot!);
  const node = target.graph.getNode(target.getSelectedNodes()[0]!.childIds[0]!)!, link = readNavigation(node)!;
  expect(link.unresolved).toBe(true); expect(() => navigatePrototype(first.id, [], link, new Set([second.id]))).toThrow('paste');
});
it('reconnects clipboard snapshots across projects without changing the snapshot', async () => {
  const { first } = screens(); const snapshot = (await source.prepareCopy()).snapshot!, before = structuredClone(snapshot);
  await target.pasteSnapshot(snapshot); const ids = copiedTarget(target); expect(snapshot).toEqual(before);
  target.undoAction(); expect(ids.every(id => !target.graph.getNode(id))).toBe(true); target.redoAction(); copiedTarget(target);
  expect(source.graph.getNode(first.id)).toBe(first);
});
it('retains native FIG click connections through closed-session HTML clipboard transport', async () => {
  const { second, hotspot } = screens(); second.source.id = '19:8'; hotspot.pluginData = [];
  hotspot.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 19, localID: 8 }, transitionDuration: 0.2 }] }] };
  const before = serializeGraph(source.graph), payload = await source.prepareCopy(); withClipboardVideoResources(source.graph, payload);
  expect(serializeGraph(source.graph)).toBe(before);
  await target.pasteFromHTML(payload.html); const ids = copiedTarget(target);
  target.undoAction(); expect(target.graph.getNode(ids[0]!)).toBeUndefined(); target.redoAction(); copiedTarget(target);
});
it('reconnects imported links during duplicate without losing opaque import fields', () => {
  const { second, hotspot } = screens(); second.source.id = '3:2'; hotspot.pluginData = [];
  hotspot.source.fig.rawNodeFields = { connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 3, localID: 2 }, opaqueData: { keep: true } };
  source.duplicateSelected(); copiedTarget(source);
  const copy = source.graph.getNode(source.getSelectedNodes()[0]!.childIds[0]!)!; expect(copy.source.fig.rawNodeFields).toEqual(hotspot.source.fig.rawNodeFields);
});
it('rolls native creation back if clipboard completion fails', async () => {
  screens(); const snapshot = (await source.prepareCopy()).snapshot!;
  const failing = createEditor(), native = failing.pasteSnapshot;
  const before = serializeGraph(failing.graph);
  failing.pasteSnapshot = async (...args) => { await native(...args); throw new Error('Font import failed'); }; installPrototypeEditing(failing);
  try { await expect(failing.pasteSnapshot(snapshot)).rejects.toThrow('Font import failed'); expect(serializeGraph(failing.graph)).toBe(before); }
  finally { failing.dispose(); }
});
it('composes with the slot editing adapter and restores its methods on disposal', () => {
  const editor = createEditor(), original = editor.duplicateSelected;
  const slots = installSlotEditing(editor), slotMethod = editor.duplicateSelected, prototype = installPrototypeEditing(editor);
  try { prototype(); expect(editor.duplicateSelected).toBe(slotMethod); slots(); expect(editor.duplicateSelected).toBe(original); }
  finally { editor.dispose(); }
});

it('reconnects every multi-interaction destination through duplicate, snapshot and closed-session HTML', async () => {
  const { first, second, hotspot } = screens(); const navigation = { action: 'navigate' as const, target: second.id, transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(source, hotspot, [{ id: 'click', trigger: { type: 'click' }, navigation }, { id: 'delay', trigger: { type: 'delay', delay: 1000 }, navigation }, { id: 'key', trigger: { type: 'key', keyCodes: [65] }, navigation }]);
  const expectCopies = (editor: Editor) => { const [home, details] = editor.getSelectedNodes(); const read = readPrototype(editor.graph.getNode(home!.childIds[0]!)!); expect(read.interactions).toHaveLength(3); expect(read.interactions!.every(interaction => interaction.navigation.target === details!.id)).toBe(true); };
  source.duplicateSelected(); expectCopies(source); source.undoAction(); source.select([first.id, second.id]);
  const payload = await source.prepareCopy(); withClipboardVideoResources(source.graph, payload);
  await target.pasteSnapshot(payload.snapshot!); expectCopies(target); target.undoAction();
  await target.pasteFromHTML(payload.html); expectCopies(target); target.undoAction(); target.redoAction(); expectCopies(target);
  expect(readPrototype(hotspot).interactions!.every(interaction => interaction.navigation.target === second.id)).toBe(true);
});

it('reconnects descendant Scroll To and retains legacy fixed sections after duplicate and closed-session clipboard paste', async () => {
  const { readScrollBehaviour } = await import('./prototypeScroll');
  const { first } = screens(), graph = source.graph, destination = graph.createNode('RECTANGLE', first.id, { name: 'Scroll destination' }), fixed = graph.createNode('RECTANGLE', first.id, { name: 'Fixed header' });
  first.source.fig.rawNodeFields = { scrollDirection: 'VERTICAL', fixedChildrenDivider: 'c' }; graph.getChildren(first.id).forEach((node, index) => { node.source.orderKey = String.fromCharCode(97 + index); });
  setNavigation(source, first, { action: 'scroll', target: destination.id, transition: 'instant', duration: 0 }); source.select([first.id]);
  const check = (editor: Editor) => { const copy = editor.getSelectedNodes()[0]!, children = editor.graph.getChildren(copy.id), target = children.find(node => node.name === 'Scroll destination')!, header = children.find(node => node.name === 'Fixed header')!; expect(readNavigation(copy)?.target).toBe(target.id); expect(readScrollBehaviour(header, editor.graph).behaviour).toBe('fixed'); expect(readScrollBehaviour(target, editor.graph).behaviour).toBe('scroll'); };
  source.duplicateSelected(); check(source); source.undoAction(); source.select([first.id]);
  const payload = await source.prepareCopy(); withClipboardVideoResources(source.graph, payload); const snapshot = structuredClone(payload.snapshot);
  await target.pasteSnapshot(payload.snapshot!); check(target); expect(payload.snapshot).toEqual(snapshot); target.undoAction(); await target.pasteFromHTML(payload.html); check(target); target.undoAction(); target.redoAction(); check(target); expect(readScrollBehaviour(fixed, graph).behaviour).toBe('fixed');
});

it('enriches a legacy fixed-only HTML clipboard payload even when it has no interactions or video', async () => {
  const { readScrollBehaviour } = await import('./prototypeScroll'); const graph = source.graph, owner = graph.createNode('FRAME', source.state.currentPageId, { name: 'Legacy fixed frame' }), child = graph.createNode('RECTANGLE', owner.id, { name: 'Legacy fixed child' }); owner.source.fig.rawNodeFields = { fixedChildrenDivider: 'b' }; child.source.orderKey = 'b'; source.select([owner.id]); const payload = await source.prepareCopy(); const before = payload.html; withClipboardVideoResources(graph, payload); expect(payload.html.length).toBeGreaterThan(before.length); await target.pasteFromHTML(payload.html); expect(readScrollBehaviour(target.graph.getChildren(target.getSelectedNodes()[0]!.id)[0]!, target.graph).behaviour).toBe('fixed');
});

it('reconnects held and one-way pointer destinations through snapshot, HTML, duplicate and undo', async () => {
  const { first, second, hotspot } = screens(), navigation = { action: 'navigate' as const, target: second.id, transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(source, hotspot, [{ id: 'hover', trigger: { type: 'hover', delay: 125 }, navigation }, { id: 'press', trigger: { type: 'press' }, navigation }, { id: 'up', trigger: { type: 'pointer-up' }, navigation }]);
  const check = (editor: Editor) => { const [home, details] = editor.getSelectedNodes(), interactions = readPrototype(editor.graph.getNode(home!.childIds[0]!)!).interactions!; expect(interactions.map(({ trigger }) => trigger)).toEqual([{ type: 'hover', delay: 125 }, { type: 'press' }, { type: 'pointer-up' }]); expect(interactions.every(({ navigation }) => navigation.target === details!.id)).toBe(true); };
  source.duplicateSelected(); check(source); source.undoAction(); source.select([first.id, second.id]); const before = serializeGraph(source.graph), payload = await source.prepareCopy(); withClipboardVideoResources(source.graph, payload); await target.pasteSnapshot(payload.snapshot!); check(target); target.undoAction(); await target.pasteFromHTML(payload.html); check(target); target.undoAction(); target.redoAction(); check(target); expect(serializeGraph(source.graph)).toBe(before);
});

it('retains real inline video resources and media triggers while reconnecting cross-project destinations', async () => {
  const { placePreparedVideo } = await import('./videoPaints'); const { first, second } = screens(), id = placePreparedVideo(source, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Timed clip', width: 320, height: 180, duration: 3 }, 0, 0), clip = source.graph.getNode(id)!; source.graph.reparentNode(clip.id, first.id);
  const navigation = { action: 'navigate' as const, target: second.id, transition: 'instant' as const, duration: 0 }; setPrototypeInteractions(source, clip, [{ id: 'time', trigger: { type: 'media-hit', time: 1.25 }, navigation }, { id: 'end', trigger: { type: 'media-end' }, navigation }]); source.select([first.id, second.id]); const before = serializeGraph(source.graph), payload = await source.prepareCopy(); withClipboardVideoResources(source.graph, payload);
  const check = () => { const [home, details] = target.getSelectedNodes(), node = target.graph.getChildren(home!.id).find(node => node.name === 'Timed clip')!; expect(readPrototype(node).interactions?.map(({ trigger, navigation }) => ({ trigger, target: navigation.target }))).toEqual([{ trigger: { type: 'media-hit', time: 1.25 }, target: details!.id }, { trigger: { type: 'media-end' }, target: details!.id }]); expect(node.fills[0]?.type).toBe('VIDEO'); expect(target.graph.images.size).toBeGreaterThan(0); };
  await target.pasteSnapshot(payload.snapshot!); check(); target.undoAction(); await target.pasteFromHTML(payload.html); check(); target.undoAction(); target.redoAction(); check(); expect(serializeGraph(source.graph)).toBe(before);
});
