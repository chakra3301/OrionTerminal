import { afterEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { allDesignActions, type DesignNavigation } from './reactExportRuntime';
import { readPrototype, prototypeResolver, setPrototypeInteractions } from './prototype';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { parseFigWithSlots } from './figSlots';
import { parseFigBuffer } from '@open-pencil/fig';
import { deserializeGraph, serializeGraph } from './document';
import { installPrototypeEditing, readClipboardPrototypeVariables } from './prototypeEditing';
import { withClipboardVideoResources } from './videoClipboard';
import { deflateSync } from 'fflate';
import { encodeBase64 } from '@open-pencil/core/bytes';
const editors: Editor[] = []; const editor = () => { const result = createEditor(); editors.push(result); installPrototypeEditing(result); return result; }; afterEach(() => editors.splice(0).forEach(editor => editor.dispose()));
const action = (patch: Partial<DesignNavigation>): DesignNavigation => ({ action: 'back', transition: 'instant', duration: 0, ...patch });
function fixture() {
  const source = editor(), graph = source.graph, page = source.state.currentPageId, home = graph.createNode('FRAME', page, { name: 'Variables Home', width: 320, height: 480 }), next = graph.createNode('FRAME', page, { name: 'Variables Next' });
  const collection = graph.createCollection('Prototype'), mode = { modeId: crypto.randomUUID(), name: 'Other' }, count = graph.createVariable('Counter', 'FLOAT', collection.id, 0), shown = graph.createVariable('Shown', 'BOOLEAN', collection.id, false);
  graph.addMode(collection.id, mode.modeId, mode.name);
  const navigation = action({ action: 'sequence', actions: [action({ action: 'set-variable', variable: count.id, value: { type: 'expression', operator: 'ADDITION', arguments: [{ type: 'variable', id: count.id }, { type: 'literal', value: 1 }] } }), action({ action: 'set-mode', collection: collection.id, mode: mode.modeId }), action({ action: 'conditional', branches: [{ condition: { type: 'expression', operator: 'GREATER_THAN', arguments: [{ type: 'variable', id: count.id }, { type: 'literal', value: 0 }] }, actions: [action({ action: 'set-variable', variable: shown.id, value: { type: 'literal', value: true } }), action({ action: 'navigate', target: next.id })] }, { actions: [action({ action: 'back' })] }] })] });
  setPrototypeInteractions(source, home, [{ id: 'run', trigger: { type: 'click' }, navigation }]); source.select([home.id, next.id]); return { source, graph, home, next, count, shown, collection, mode };
}
it('round-trips variable expressions, modes and nested branch destinations using schema-native GUID references', async () => {
  const { graph } = fixture(), before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)); expect(serializeGraph(graph)).toBe(before);
  const parsed = parseFigBuffer(new Uint8Array(bytes).buffer), native = parsed.nodeChanges.find(node => node.name === 'Variables Home')!; expect(native.prototypeInteractions).toMatchObject([{ actions: [{ connectionType: 'SET_VARIABLE', targetVariableData: { dataType: 'EXPRESSION', value: { expressionValue: { expressionFunction: 'ADDITION' } } } }, { connectionType: 'SET_VARIABLE_MODE' }, { connectionType: 'CONDITIONAL', conditionalActions: [{ condition: { value: { expressionValue: { expressionFunction: 'GREATER_THAN' } } }, actions: [{ connectionType: 'SET_VARIABLE' }, { connectionType: 'INTERNAL_NODE' }] }, { actions: [{ connectionType: 'BACK' }] }] }] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), home = [...reopened.nodes.values()].find(node => node.name === 'Variables Home')!, next = [...reopened.nodes.values()].find(node => node.name === 'Variables Next')!, own = readPrototype(home, prototypeResolver(reopened)); expect(own.issue).toBeUndefined();
  const actions = allDesignActions(own.link!); expect(actions.filter(action => action.variable).every(action => reopened.variables.has(action.variable!))).toBe(true); expect(actions.find(action => action.target)!.target).toBe(next.id);
  home.pluginData = []; const nativeOnly = readPrototype(home, prototypeResolver(reopened)); expect(nativeOnly.issue).toBeUndefined(); expect(nativeOnly.link).toEqual(own.link);
});
it.each(['snapshot', 'html'] as const)('imports action-only dependencies and reconnects every %s reference atomically with undo/redo', async type => {
  const { source, graph, count, collection } = fixture(), target = editor(), before = serializeGraph(target.graph), sourceBefore = serializeGraph(graph), payload = await source.prepareCopy(); withClipboardVideoResources(graph, payload); const immutable = structuredClone(payload.snapshot);
  if (type === 'snapshot') await target.pasteSnapshot(payload.snapshot!); else await target.pasteFromHTML(payload.html);
  const home = target.getSelectedNodes()[0]!, actions = allDesignActions(readPrototype(home).link!), assigned = actions[0]!, setMode = actions[1]!; expect(assigned.variable).not.toBe(count.id); expect(target.graph.variables.has(assigned.variable!)).toBe(true); expect(target.graph.variableCollections.get(setMode.collection!)!.modes.some(mode => mode.modeId === setMode.mode)).toBe(true); expect(setMode.collection).not.toBe(collection.id); expect(actions.find(action => action.target)!.target).toBe(target.getSelectedNodes()[1]!.id);
  expect(payload.snapshot).toEqual(immutable); expect(serializeGraph(graph)).toBe(sourceBefore); const after = serializeGraph(target.graph); target.undoAction(); expect(serializeGraph(target.graph)).toBe(before); target.redoAction(); expect(serializeGraph(target.graph)).toBe(after);
});
it('duplicates branches using existing document variables and reconnects only copied screen identities', () => { const { source, count, next } = fixture(); source.duplicateSelected(); const navigation = readPrototype(source.getSelectedNodes()[0]!).link!; expect(allDesignActions(navigation)[0]!.variable).toBe(count.id); expect(allDesignActions(navigation).find(action => action.target)!.target).not.toBe(next.id); });
it('preserves an unsupported native expression atomically and refuses dangling authored variable exports', async () => {
  const { source, graph, home, count } = fixture(); home.pluginData = []; home.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'SET_VARIABLE', targetVariableID: { sessionID: 3, localID: 1 }, targetVariableData: { dataType: 'EXPRESSION', value: { expressionValue: { expressionFunction: 'VAR_MODE_LOOKUP', expressionArguments: [] } } } }] }] }; expect(readPrototype(home).issue).toContain('preserved'); expect(readPrototype(home).link).toBeUndefined();
  const other = graph.createNode('TEXT', home.id, { text: 'Set' }); setPrototypeInteractions(source, other, [{ id: 'set', trigger: { type: 'click' }, navigation: action({ action: 'set-variable', variable: count.id, value: { type: 'literal', value: 2 } }) }]); graph.removeVariable(count.id); await expect(exportFigImageCompatible(deserializeGraph(serializeGraph(graph)))).rejects.toThrow('missing prototype variable');
});
it('rejects invalid compressed variable clipboard data before creating nodes', async () => { const target = editor(), before = serializeGraph(target.graph), html = `<!--(xdesign-variables)${encodeBase64(deflateSync(new TextEncoder().encode(JSON.stringify({ variables: [], collections: [], activeModes: [['missing', 'mode']] }))))}(/xdesign-variables)-->`; expect(() => readClipboardPrototypeVariables(html)).toThrow('active mode'); await expect(target.pasteFromHTML(html)).rejects.toThrow(); expect(serializeGraph(target.graph)).toBe(before); });
