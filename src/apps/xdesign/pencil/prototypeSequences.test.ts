import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { parseFigBuffer } from '@open-pencil/fig';
import { deserializeGraph, serializeGraph } from './document';
import { designActions, MAX_DESIGN_ACTIONS, type DesignNavigation } from './reactExportRuntime';
import { prototypeActionContexts, prototypeResolver, readPrototype, setPrototypeInteractions } from './prototype';
import { installPrototypeEditing } from './prototypeEditing';
import { withClipboardVideoResources } from './videoClipboard';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { parseFigWithSlots } from './figSlots';
import { selectionToDesignModel } from './reactExport';

let editor: Editor, target: Editor;
beforeEach(() => { editor = createEditor(); target = createEditor(); installPrototypeEditing(editor); installPrototypeEditing(target); });
afterEach(() => { editor.dispose(); target.dispose(); });
const action = (action: DesignNavigation['action'], target?: string): DesignNavigation => ({ action, ...(target ? { target } : {}), transition: 'instant', duration: 0 });
const sequence = (...actions: DesignNavigation[]): DesignNavigation => ({ action: 'sequence', actions, transition: 'instant', duration: 0 });
const interaction = (navigation: DesignNavigation) => ({ id: 'click', trigger: { type: 'click' as const }, navigation });
function project() {
  const graph = editor.graph, page = editor.state.currentPageId;
  const home = graph.createNode('FRAME', page, { name: 'Home', width: 320, height: 480 }), details = graph.createNode('FRAME', page, { name: 'Details', width: 320, height: 480 }), modal = graph.createNode('FRAME', page, { name: 'Modal', width: 160, height: 120 });
  const trigger = graph.createNode('RECTANGLE', home.id, { name: 'Sequence' }), homeTarget = graph.createNode('RECTANGLE', home.id, { name: 'Home footer', y: 900 }), detailsTarget = graph.createNode('RECTANGLE', details.id, { name: 'Details footer', y: 800 });
  return { graph, home, details, modal, trigger, homeTarget, detailsTarget };
}
it('persists ordered steps in one native undo operation and preserves unrelated metadata on reopen', () => {
  const { graph, home, details, modal, trigger, homeTarget, detailsTarget } = project();
  trigger.pluginData = [{ pluginId: 'other', key: 'keep', value: 'original' }];
  const navigation = sequence(action('scroll', homeTarget.id), { ...action('navigate', details.id), transition: 'slide', direction: 'left', duration: 375, easing: 'linear', resetScroll: true }, action('scroll', detailsTarget.id), { ...action('overlay', modal.id), offset: { x: -8, y: 16 } }, action('close'), action('back'), action('scroll', homeTarget.id));
  setPrototypeInteractions(editor, trigger, [interaction(navigation)]);
  expect(readPrototype(trigger).link).toEqual(navigation);
  expect(readPrototype(deserializeGraph(serializeGraph(graph)).getNode(trigger.id)!).link).toEqual(navigation);
  editor.undoAction(); expect(trigger.pluginData).toEqual([{ pluginId: 'other', key: 'keep', value: 'original' }]); expect(graph.getNode(home.id)).toBe(home);
  editor.redoAction(); expect(readPrototype(trigger).link).toEqual(navigation);
  graph.updateNode(home.id, { locked: true }); const before = serializeGraph(graph);
  expect(() => setPrototypeInteractions(editor, trigger, [interaction(sequence(action('back')))])).toThrow('Unlock'); expect(serializeGraph(graph)).toBe(before);
});
it('bounds sequences, refuses nesting and invalid later steps atomically', () => {
  const { graph, trigger, details, homeTarget } = project();
  setPrototypeInteractions(editor, trigger, [interaction(sequence(...Array.from({ length: MAX_DESIGN_ACTIONS }, () => action('back'))))]);
  expect(designActions(readPrototype(trigger).link!)).toHaveLength(64);
  const before = serializeGraph(graph);
  for (const navigation of [sequence(), sequence(...Array.from({ length: 65 }, () => action('back'))), sequence(sequence(action('back'))), sequence(action('navigate', details.id), action('scroll', homeTarget.id)), sequence(action('back'), { ...action('back'), duration: Infinity })]) {
    expect(() => setPrototypeInteractions(editor, trigger, [interaction(navigation)])).toThrow(); expect(serializeGraph(graph)).toBe(before);
  }
  expect(() => designActions(sequence(sequence(action('back'))))).toThrow('64');
  const outside = graph.createNode('RECTANGLE', editor.state.currentPageId); expect(() => setPrototypeInteractions(editor, outside, [interaction(action('scroll', homeTarget.id))])).toThrow('visible layer');
});
it('tracks Back, Close, same-screen Navigate and Swap contexts and allows live-history targets', () => {
  const { graph, home, details, modal, trigger, homeTarget, detailsTarget } = project();
  const actions = [action('navigate', details.id), action('overlay', modal.id), action('close'), action('scroll', detailsTarget.id), action('back'), action('scroll', homeTarget.id), action('navigate', home.id), action('back'), action('scroll', detailsTarget.id)];
  expect(prototypeActionContexts(graph, trigger, actions).map(node => node?.name)).toEqual(['Home', 'Details', 'Modal', 'Details', 'Details', 'Home', 'Home', 'Home', undefined]);
  expect(() => setPrototypeInteractions(editor, trigger, [interaction(sequence(...actions))])).not.toThrow();
  expect(prototypeActionContexts(graph, trigger, [action('navigate', details.id), action('swap', modal.id), action('back'), action('scroll', homeTarget.id)]).map(node => node?.name)).toEqual(['Home', 'Details', 'Modal', 'Home']);
  detailsTarget.visible = false; expect(() => setPrototypeInteractions(editor, trigger, [interaction(sequence(action('back'), { ...action('scroll', detailsTarget.id), offset: { x: 0, y: 1 } }))])).toThrow('visible layer');
});
it('imports native ordered actions and refuses the entire interaction if any step is unsupported', () => {
  const { graph, details, modal, trigger } = project(); details.source.id = '90:2'; modal.source.id = '90:3';
  const actions: Record<string, unknown>[] = [{ connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 90, localID: 2 }, transitionType: 'DISSOLVE', transitionDuration: 0.25 }, { connectionType: 'INTERNAL_NODE', navigationType: 'OVERLAY', transitionNodeID: { sessionID: 90, localID: 3 }, overlayRelativePosition: { x: 4, y: -8 } }, { connectionType: 'CLOSE' }, { connectionType: 'BACK' }];
  trigger.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions }], opaqueData: { keep: true } };
  const before = structuredClone(trigger.source.fig.rawNodeFields);
  expect(designActions(readPrototype(trigger, prototypeResolver(graph)).link!)).toEqual([{ ...action('navigate', details.id), transition: 'dissolve', duration: 250 }, { ...action('overlay', modal.id), offset: { x: 4, y: -8 } }, action('close'), action('back')]);
  expect(trigger.source.fig.rawNodeFields).toEqual(before);
  actions.push({ connectionType: 'SET_VARIABLE' }); expect(readPrototype(trigger).issue).toContain('preserved'); expect(readPrototype(trigger).interactions).toBeUndefined();
  actions.pop(); actions.push(...Array.from({ length: 61 }, () => ({ connectionType: 'BACK' }))); expect(readPrototype(trigger).issue).toContain('sequence');
});
it('reconnects every sequence destination through duplicate, snapshot and closed-session HTML', async () => {
  const { graph, home, details, modal, trigger, homeTarget, detailsTarget } = project();
  setPrototypeInteractions(editor, trigger, [interaction(sequence(action('scroll', homeTarget.id), action('navigate', details.id), action('scroll', detailsTarget.id), action('overlay', modal.id), action('close'), action('back')))]);
  const check = (copy: Editor) => {
    const [h, d, m] = copy.getSelectedNodes(), children = copy.graph.getChildren(h!.id), steps = designActions(readPrototype(children.find(node => node.name === 'Sequence')!).link!);
    expect(steps.map(step => step.target)).toEqual([children.find(node => node.name === 'Home footer')!.id, d!.id, copy.graph.getChildren(d!.id)[0]!.id, m!.id, undefined, undefined]); expect(steps.every(step => !step.unresolved)).toBe(true);
  };
  editor.select([home.id, details.id, modal.id]); editor.duplicateSelected(); check(editor); editor.undoAction(); editor.select([home.id, details.id, modal.id]);
  const before = serializeGraph(graph), payload = await editor.prepareCopy(); withClipboardVideoResources(graph, payload); const snapshot = structuredClone(payload.snapshot); expect(serializeGraph(graph)).toBe(before);
  await target.pasteSnapshot(payload.snapshot!); check(target); expect(payload.snapshot).toEqual(snapshot); target.undoAction();
  await target.pasteFromHTML(payload.html); check(target); target.undoAction(); target.redoAction(); check(target);
});
it('retains unresolved external steps during partial repair and rejects missing destinations in strict exports', async () => {
  const { home, details, trigger, homeTarget, detailsTarget } = project();
  setPrototypeInteractions(editor, trigger, [interaction(sequence(action('scroll', homeTarget.id), action('navigate', details.id), action('scroll', detailsTarget.id)))]);
  editor.select([home.id]); await target.pasteSnapshot((await editor.prepareCopy()).snapshot!);
  const copy = target.getSelectedNodes()[0]!, hotspot = target.graph.getChildren(copy.id).find(node => node.name === 'Sequence')!, read = readPrototype(hotspot), actions = designActions(read.link!);
  expect(actions.map(step => !!step.unresolved)).toEqual([false, true, true]); actions[1] = action('navigate', copy.id); setPrototypeInteractions(target, hotspot, [interaction(sequence(...actions))]);
  expect(designActions(readPrototype(hotspot).link!)[2]?.unresolved).toBe(true); actions[2] = action('scroll', target.graph.getChildren(copy.id).find(node => node.name === 'Home footer')!.id); setPrototypeInteractions(target, hotspot, [interaction(sequence(...actions))]);
  expect(designActions(readPrototype(hotspot).link!).every(step => !step.unresolved)).toBe(true);
  const strict = selectionToDesignModel(editor.graph, [home.id]); expect(strict.prototypeIssues.join(' ')).toContain('scroll destination');
  const presentation = selectionToDesignModel(editor.graph, [home.id], undefined, true); expect(presentation.prototypeIssues).toEqual([]); expect(presentation.nodes[0]?.sourceId).toBe(home.id);
  editor.graph.deleteNode(details.id); await expect(exportFigImageCompatible(deserializeGraph(serializeGraph(editor.graph)))).rejects.toThrow('missing prototype');
});
it('round-trips native action order, GUID targets and per-step motion without plugin metadata', async () => {
  const { graph, details, modal, trigger, homeTarget, detailsTarget } = project();
  setPrototypeInteractions(editor, trigger, [interaction(sequence({ ...action('scroll', homeTarget.id), transition: 'scroll', duration: 250, offset: { x: 4, y: -8 }, easing: 'linear' }, { ...action('navigate', details.id), transition: 'slide', direction: 'top', duration: 375, resetScroll: true }, action('scroll', detailsTarget.id), { ...action('overlay', modal.id), offset: { x: -12, y: 24 }, preserveScroll: true }, action('close'), action('back')))]);
  const before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)); expect(serializeGraph(graph)).toBe(before);
  const parsed = parseFigBuffer(new Uint8Array(bytes).buffer), named = (name: string) => parsed.nodeChanges.find(node => node.name === name)!;
  expect(named('Sequence').prototypeInteractions).toMatchObject([{ actions: [{ navigationType: 'SCROLL_TO', transitionNodeID: named('Home footer').guid, transitionType: 'SCROLL_ANIMATE', transitionDuration: 0.25, extraScrollOffset: { x: 4, y: -8 } }, { navigationType: 'NAVIGATE', transitionNodeID: named('Details').guid, transitionType: 'SLIDE_FROM_TOP', transitionDuration: 0.375, transitionResetScrollPosition: true }, { navigationType: 'SCROLL_TO', transitionNodeID: named('Details footer').guid }, { navigationType: 'OVERLAY', transitionNodeID: named('Modal').guid, overlayRelativePosition: { x: -12, y: 24 }, transitionPreserveScroll: true }, { connectionType: 'CLOSE' }, { connectionType: 'BACK' }] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), reopenedTrigger = [...reopened.nodes.values()].find(node => node.name === 'Sequence')!;
  const own = readPrototype(reopenedTrigger, prototypeResolver(reopened)); reopenedTrigger.pluginData = [];
  expect(readPrototype(reopenedTrigger, prototypeResolver(reopened)).link).toEqual(own.link); expect(designActions(own.link!).map(step => step.action)).toEqual(['scroll', 'navigate', 'scroll', 'overlay', 'close', 'back']);
});
