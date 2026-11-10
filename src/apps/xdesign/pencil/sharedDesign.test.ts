import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SceneGraph, getInstanceOverride, setInstanceOverride } from '@open-pencil/scene-graph';
import { createEditor } from '@open-pencil/core/editor';
import { SharedDesign } from './sharedDesign';
import { serializeGraph, deserializeGraph } from './graphDocument';
import { addComment, allComments, createCommentAnchor, reactToComment, replyToComment } from './comments';
import { decodeSharedValue, encodeSharedValue } from './sharedValue';
import { installSharedIds } from './sharedIds';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { parseFigWithSlots } from './figSlots';
import { resolveCommentAnchor } from './comments';

const sessions: SharedDesign[] = [];
const register = (session: SharedDesign) => { sessions.push(session); return session; };
afterEach(() => sessions.splice(0).forEach(session => session.dispose()));
function pair(graph = new SceneGraph()) {
  const a = register(SharedDesign.fromGraph(graph)), b = register(SharedDesign.fromUpdate(a.update()));
  return { a, b, page: graph.getPages()[0]!.id };
}
function sync(a: SharedDesign, b: SharedDesign) {
  const left = a.update(b.stateVector()), right = b.update(a.stateVector()); a.receive(right); b.receive(left);
  expect(serializeGraph(a.graph)).toBe(serializeGraph(b.graph));
}
describe('shared design graph', () => {
  it('merges different properties on the same layer and supports selective local undo/redo', () => {
    const graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0]!.id, { x: 10, y: 20, width: 100, height: 80 }), { a, b } = pair(graph);
    a.edit('Move horizontally', graph => graph.updateNode(node.id, { x: 200 }));
    b.edit('Resize', graph => graph.updateNode(node.id, { width: 320 })); sync(a, b);
    expect(a.graph.getNode(node.id)).toMatchObject({ x: 200, width: 320 });
    const undo = a.undo()!; expect(undo.label).toBe('Move horizontally'); b.receive(undo.update); sync(a, b);
    expect(b.graph.getNode(node.id)).toMatchObject({ x: 10, width: 320 });
    const redo = a.redo()!; expect(redo.label).toBe('Move horizontally'); b.receive(redo.update); sync(a, b);
    expect(b.graph.getNode(node.id)).toMatchObject({ x: 200, width: 320 });
    b.undo(); sync(a, b); expect(a.graph.getNode(node.id)).toMatchObject({ x: 200, width: 100 });
  });
  it('does not undo an intervening remote value of the same property', () => {
    const graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0]!.id), { a, b } = pair(graph);
    b.receive(a.edit('Local', graph => graph.updateNode(node.id, { x: 50 })).update);
    a.receive(b.edit('Remote', graph => graph.updateNode(node.id, { x: 90 })).update);
    a.undo(); sync(a, b); expect(a.graph.getNode(node.id)!.x).toBe(90);
  });
  it('preserves a remote new layer when committing an edit against an older base', () => {
    const { a, b, page } = pair(), before = a.graph, after = deserializeGraph(serializeGraph(before));
    after.getNode(page)!.name = 'Local page';
    const remote = b.edit('Remote layer', graph => graph.createNode('TEXT', page, { text: 'Remote' })); a.receive(remote.update);
    a.commit(before, after, 'Page name'); sync(a, b);
    expect(a.graph.getChildren(page).map(node => node.text)).toContain('Remote'); expect(a.graph.getNode(page)!.name).toBe('Local page');
  });
  it('gives concurrent creations different IDs, preserves relative order, and is duplicate tolerant', () => {
    const { a, b, page } = pair();
    const ca = a.edit('A', graph => { graph.createNode('RECTANGLE', page, { name: 'A1' }); graph.createNode('RECTANGLE', page, { name: 'A2' }); });
    const cb = b.edit('B', graph => { graph.createNode('RECTANGLE', page, { name: 'B1' }); graph.createNode('RECTANGLE', page, { name: 'B2' }); });
    expect(a.graph.getChildren(page).map(node => node.id).some(id => b.graph.nodes.has(id))).toBe(false);
    a.receive(cb.update); b.receive(ca.update); a.receive(cb.update); b.receive(ca.update); sync(a, b);
    const names = a.graph.getChildren(page).map(node => node.name); expect(names).toHaveLength(4);
    expect(names.indexOf('A1')).toBeLessThan(names.indexOf('A2')); expect(names.indexOf('B1')).toBeLessThan(names.indexOf('B2'));
  });
  it('holds reordered updates until their dependencies arrive and resumes from binary checkpoints', () => {
    const { a, b, page } = pair(); let id = '';
    const create = a.edit('Create', graph => { id = graph.createNode('RECTANGLE', page).id; });
    const move = a.edit('Move', graph => graph.updateNode(id, { x: 400 }));
    b.receive(move.update); expect(b.graph.nodes.has(id)).toBe(false); b.receive(create.update); expect(b.graph.getNode(id)!.x).toBe(400);
    const c = register(SharedDesign.fromUpdate(b.update())); expect(c.canUndo).toBe(false); sync(a, c);
    expect(a.update(new Uint8Array([0])).byteLength).toBeGreaterThan(2);
  });
  it('resolves simultaneous cyclic reparenting deterministically and preserves undo', () => {
    const graph = new SceneGraph(), page = graph.getPages()[0]!.id, frameA = graph.createNode('FRAME', page), frameB = graph.createNode('FRAME', page), { a, b } = pair(graph);
    a.edit('A into B', graph => graph.reparentNode(frameA.id, frameB.id)); b.edit('B into A', graph => graph.reparentNode(frameB.id, frameA.id)); sync(a, b);
    const resolved = a.graph; expect([resolved.getNode(frameA.id)!.parentId, resolved.getNode(frameB.id)!.parentId]).toContain(page);
    a.undo(); sync(a, b); expect(a.graph.getNode(frameA.id)!.parentId).toBe(page);
  });
  it('recovers a concurrently created child of a deleted parent onto its owning page', () => {
    const graph = new SceneGraph(), page = graph.getPages()[0]!.id, frame = graph.createNode('FRAME', page), { a, b } = pair(graph); let child = '';
    a.edit('Delete frame', graph => graph.deleteNode(frame.id)); b.edit('Create in frame', graph => { child = graph.createNode('RECTANGLE', frame.id, { x: 50 }).id; }); sync(a, b);
    expect(a.graph.getNode(child)).toMatchObject({ parentId: page, x: 50 }); expect(a.graph.nodes.has(frame.id)).toBe(false);
    a.undo(); sync(a, b); expect(a.graph.getNode(child)!.parentId).toBe(frame.id);
  });
  it('recovers a deterministic public seed page when different pages are deleted offline', () => {
    const graph = new SceneGraph(), home = graph.getPages()[0]!.id, second = graph.addPage('Page 2').id, { a, b } = pair(graph);
    a.edit('Delete first', graph => graph.deleteNode(home)); b.edit('Delete second', graph => graph.deleteNode(second)); sync(a, b);
    expect(a.graph.getPages().map(page => page.id)).toEqual([home]);
  });
  it('retains a public seed page when distinct pages become internal on offline peers', () => {
    const graph = new SceneGraph(), home = graph.getPages()[0]!.id, second = graph.addPage('Page 2').id, { a, b } = pair(graph);
    a.edit('Hide first', graph => graph.updateNode(home, { internalOnly: true })); b.edit('Hide second', graph => graph.updateNode(second, { internalOnly: true })); sync(a, b);
    expect(a.graph.getPages().map(page => page.id)).toEqual([home]); expect(a.graph.getPages(true)).toHaveLength(2);
  });
  it('merges a reordering with a concurrent insertion without discarding either layer', () => {
    const graph = new SceneGraph(), page = graph.getPages()[0]!.id, ids = ['A', 'B', 'C'].map(name => graph.createNode('RECTANGLE', page, { name }).id), { a, b } = pair(graph);
    a.edit('Move C first', graph => graph.insertChildAt(ids[2]!, page, 0)); b.edit('Insert D', graph => { const node = graph.createNode('RECTANGLE', page, { name: 'D' }); graph.insertChildAt(node.id, page, 1); }); sync(a, b);
    const names = a.graph.getChildren(page).map(node => node.name); expect(names).toContain('D'); expect(names.indexOf('C')).toBeLessThan(names.indexOf('A')); expect(names.indexOf('A')).toBeLessThan(names.indexOf('B'));
  });
  it('preserves image bytes, source geometry, variable membership, overrides and library data', () => {
    const graph = new SceneGraph(), page = graph.getPages()[0]!.id, component = graph.createNode('COMPONENT', page), child = graph.createNode('RECTANGLE', component.id), instance = graph.createInstance(component.id, page)!;
    setInstanceOverride(instance.instanceOverrides, instance.id, instance.childIds[0]!, 'name', 'Override'); child.fillGeometry = [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([1, 2, 3]) }];
    graph.images.set('image', new Uint8Array([1, 2, 3, 255])); const collection = graph.createCollection('Theme');
    graph.enabledLibraries.set('library', { libraryId: 'library', revisionId: 'revision', enabled: true });
    component.librarySource = { identity: { libraryId: 'library', assetKey: 'button', revisionId: 'revision' }, sourceNodeId: null, readOnly: true };
    graph.figKiwiVersion = 106; graph.figSchemaDeflated = new Uint8Array([1, 2, 3, 4]);
    const { a, b } = pair(graph); a.edit('Variable A', graph => graph.createVariable('Gap', 'FLOAT', collection.id, 12)); b.edit('Variable B', graph => graph.createVariable('Radius', 'FLOAT', collection.id, 8)); sync(a, b);
    expect(a.graph.variableCollections.get(collection.id)!.variableIds).toHaveLength(2); expect(a.graph.images.get('image')).toEqual(new Uint8Array([1, 2, 3, 255]));
    expect(a.graph.getNode(child.id)!.fillGeometry[0]!.commandsBlob).toEqual(child.fillGeometry[0]!.commandsBlob);
    expect(getInstanceOverride(a.graph.getNode(instance.id)!.instanceOverrides, instance.id, instance.childIds[0]!, 'name')).toBe('Override');
    expect(a.graph.enabledLibraries).toEqual(graph.enabledLibraries); expect(a.graph.getNode(component.id)!.librarySource).toEqual(component.librarySource); expect(a.graph.figSchemaDeflated).toEqual(graph.figSchemaDeflated); expect(a.graph.figKiwiVersion).toBe(106);
  });
  it('merges concurrent comment replies and per-author reactions with selective undo', () => {
    const editor = createEditor(), owner = { id: 'owner', name: 'Owner' }, reviewer = { id: 'reviewer', name: 'Reviewer' }, page = editor.state.currentPageId;
    const id = addComment(editor, page, createCommentAnchor(editor.graph, page, [{ x: 20, y: 40 }]), owner, 'Root'), root = allComments(editor.graph)[0]!.messages[0]!.id, { a, b } = pair(editor.graph); editor.dispose();
    const editComments = (session: SharedDesign, label: string, work: (editor: ReturnType<typeof createEditor>) => void) => session.edit(label, graph => { const editor = createEditor({ graph }); try { work(editor); } finally { editor.dispose(); } });
    editComments(a, 'Reply A', editor => replyToComment(editor, id, owner, 'A')); editComments(b, 'Reply B', editor => replyToComment(editor, id, reviewer, 'B')); sync(a, b);
    expect(allComments(a.graph)[0]!.messages.map(message => message.body).sort()).toEqual(['A', 'B', 'Root']);
    editComments(a, 'React A', editor => reactToComment(editor, id, root, '👍', owner)); editComments(b, 'React B', editor => reactToComment(editor, id, root, '👍', reviewer)); sync(a, b);
    expect(allComments(a.graph)[0]!.messages[0]!.reactions[0]!.authors).toEqual(['owner', 'reviewer']); a.undo(); sync(a, b);
    expect(allComments(b.graph)[0]!.messages[0]!.reactions[0]!.authors).toEqual(['reviewer']); a.undo(); sync(a, b);
    expect(allComments(b.graph)[0]!.messages.map(message => message.body)).toEqual(['Root', 'B']);
  });
  it('rejects malformed updates, root changes and failed admission without altering graph or history', () => {
    const { a, b, page } = pair(), before = serializeGraph(a.graph), vector = a.stateVector();
    for (const bytes of [new Uint8Array(), new Uint8Array([255, 255]), new Uint8Array(32 * 1024 * 1024 + 1)]) expect(() => a.receive(bytes)).toThrow();
    expect(() => a.edit('Rejected', graph => graph.createNode('RECTANGLE', page), () => { throw new Error('Publication rejected'); })).toThrow('Publication rejected');
    const hostile = new Y.Doc(); Y.applyUpdate(hostile, a.update()); hostile.getMap('meta').set('root', 'different');
    expect(() => a.receive(Y.encodeStateAsUpdate(hostile))).toThrow(); hostile.destroy();
    const remote = b.edit('Remote', graph => graph.createNode('TEXT', page)); expect(() => a.receive(remote.update, () => { throw new Error('Publisher'); })).toThrow('Publisher');
    expect(serializeGraph(a.graph)).toBe(before); expect(a.stateVector()).toEqual(vector); expect(a.canUndo).toBe(false); a.receive(remote.update); sync(a, b);
  });
  it('keeps a failed edit from erasing redo and does not relabel a previous edit for a no-op', () => {
    const { a, page } = pair(); a.edit('Create', graph => graph.createNode('RECTANGLE', page));
    a.edit('No-op', () => {}); expect(a.undo()!.label).toBe('Create'); expect(a.canRedo).toBe(true);
    expect(() => a.edit('Bad root', graph => graph.nodes.delete(graph.rootId))).toThrow(); expect(a.canRedo).toBe(true); expect(a.redo()!.label).toBe('Create');
  });
  it('disposes independently and rejects work after the session closes', () => {
    const { a, b } = pair(); a.dispose(); expect(() => a.graph).toThrow('closed'); expect(a.canUndo).toBe(false); expect(() => b.graph).not.toThrow();
  });
  it('preserves new peer IDs, components, variables and comment targets through the actual native FIG codec', async () => {
    const { a, b, page } = pair(); let componentId = '', leafId = '', instanceId = '';
    a.edit('Component', graph => {
      const component = graph.createNode('COMPONENT', page, { name: 'Shared button', width: 200, height: 80 }); componentId = component.id;
      leafId = graph.createNode('RECTANGLE', component.id, { name: 'Background', width: 200, height: 80 }).id;
      instanceId = graph.createInstance(componentId, page, { name: 'Placed button', x: 300, y: 200 })!.id;
      const editor = createEditor({ graph }); try { addComment(editor, page, createCommentAnchor(graph, page, [{ x: 350, y: 220 }], instanceId), { id: 'owner', name: 'Owner' }, 'Peer target'); } finally { editor.dispose(); }
      const collection = graph.createCollection('Theme'); graph.createVariable('Spacing', 'FLOAT', collection.id, 12);
    }); sync(a, b);
    expect(componentId).not.toMatch(/^0:/); expect(leafId).not.toBe(componentId);
    const source = serializeGraph(b.graph), bytes = await exportFigImageCompatible(deserializeGraph(source)), reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer);
    expect(serializeGraph(b.graph)).toBe(source); expect([...reopened.nodes.values()].find(node => node.name === 'Placed button')?.type).toBe('INSTANCE');
    expect([...reopened.variables.values()].find(variable => variable.name === 'Spacing')).toBeDefined();
    expect(resolveCommentAnchor(reopened, allComments(reopened)[0]!)).toMatchObject({ points: [{ x: 350, y: 220 }], missingTarget: false, target: { name: 'Placed button' } });
  });
  it('converges three offline branches regardless of packet arrival order', () => {
    const graph = new SceneGraph(), page = graph.getPages()[0]!.id, nodes = ['One', 'Two', 'Three'].map(name => graph.createNode('FRAME', page, { name }).id), { a, b } = pair(graph), c = register(SharedDesign.fromUpdate(a.update()));
    const ua = a.edit('One to two', graph => graph.reparentNode(nodes[0]!, nodes[1]!)).update;
    const ub = b.edit('Two to three', graph => graph.reparentNode(nodes[1]!, nodes[2]!)).update;
    const uc = c.edit('Three to one', graph => { graph.reparentNode(nodes[2]!, nodes[0]!); graph.createNode('TEXT', page, { name: 'Survive' }); }).update;
    a.receive(uc); a.receive(ub); b.receive(ua); b.receive(uc); c.receive(ub); c.receive(ua); sync(a, b); sync(b, c);
    expect(c.graph.getChildren(page).some(node => node.name === 'Survive')).toBe(true);
  });
  it('rejects decoded invalid layer/comment data while keeping the accepted bytes and redo', () => {
    const { a, page } = pair(); a.edit('Create', graph => graph.createNode('RECTANGLE', page)); a.undo(); const before = a.update(), source = serializeGraph(a.graph);
    for (const change of [
      (doc: Y.Doc) => (doc.getMap('nodes').get(page) as Y.Map<unknown>).set('x', encodeSharedValue('not a coordinate')),
      (doc: Y.Doc) => (doc.getMap('nodes').get(page) as Y.Map<unknown>).set('$parents', 'not a parent map'),
      (doc: Y.Doc) => doc.getMap('comments').set('bad', new Y.Map()),
      (doc: Y.Doc) => doc.getMap('meta').set('format', 99),
      (doc: Y.Doc) => doc.getMap('unknown').set('value', 1),
    ]) {
      const hostile = new Y.Doc(); Y.applyUpdate(hostile, before); change(hostile); expect(() => a.receive(Y.encodeStateAsUpdate(hostile))).toThrow(); hostile.destroy();
      expect(a.update()).toEqual(before); expect(serializeGraph(a.graph)).toBe(source); expect(a.canRedo).toBe(true);
    }
    a.redo(); expect(a.graph.getChildren(page)).toHaveLength(1);
  });
});
describe('shared values and public ID adapters', () => {
  it('round-trips every supported typed array, maps, sets, undefined and reserved-looking source keys', () => {
    const value = { arrays: [new Uint8Array([0, 255]), new Uint8ClampedArray([2]), new Uint16Array([65535]), new Uint32Array([0xffffffff]), new Int8Array([-1]), new Int16Array([-300]), new Int32Array([-123456]), new Float32Array([1.25]), new Float64Array([Math.PI])], overrides: new Map([['root', new Map([['fill', new Set(['a', 'b'])]])]]), source: { $xdesign: 'Map', values: [1, 2], missing: undefined }, zero: -0 };
    expect(decodeSharedValue(encodeSharedValue(value))).toEqual(value); expect(Object.is((decodeSharedValue(encodeSharedValue(value)) as typeof value).zero, -0)).toBe(true);
    expect(decodeSharedValue(encodeSharedValue(JSON.parse('{"__proto__":{"harmless":true}}')))).toEqual(JSON.parse('{"__proto__":{"harmless":true}}'));
    expect(({} as any).harmless).toBeUndefined();
  });
  it('rejects cycles, executable/class objects, unknown tags and malformed binary data', () => {
    const cycle: any = {}; cycle.self = cycle;
    for (const value of [cycle, () => {}, new Date(), Infinity, new Float32Array([NaN])]) expect(() => encodeSharedValue(value)).toThrow();
    for (const value of ['["Uint16Array","AQ=="]', '["array",null]', '["unknown",[]]', '["Uint8Array","%%%%"]', '["object",[["a",1],["a",2]]]']) expect(() => decodeSharedValue(value)).toThrow();
  });
  it('allocates unique node/variable/collection/mode IDs and restores only its own method wrappers', () => {
    const graph = new SceneGraph(), create = graph.createNode, restore = installSharedIds(graph, () => 123), page = graph.getPages()[0]!.id;
    const node = graph.createNode('RECTANGLE', page), collection = graph.createCollection('Color'), variable = graph.createVariable('Blue', 'FLOAT', collection.id, 2);
    expect(new Set([node.id, collection.id, variable.id, collection.modes[0]!.modeId]).size).toBe(4); expect(node.id).toMatch(/^123:/);
    const other = graph.createNode; graph.createNode = (...args) => other(...args); const later = graph.createNode; restore(); expect(graph.createNode).toBe(later);
    graph.createNode = create;
  });
});
