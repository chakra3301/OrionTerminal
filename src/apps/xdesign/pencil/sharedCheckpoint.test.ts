import { describe, expect, it, vi } from 'vitest';
import { SceneGraph } from '@open-pencil/scene-graph';
import { createEditor } from '@open-pencil/core/editor';
import { SharedDesign } from './sharedDesign';
import { SharedEditorBinding } from './sharedEditor';
import { deserializeGraph, serializeGraph, validatePencilDocument, type PencilDocument } from './document';
import { decodeSharedCheckpoint, encodeSharedCheckpoint, restoreSharedDesign } from './sharedCheckpoint';
const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
function saved(replica: SharedDesign): PencilDocument {
  const graph = replica.graph;
  return { formatVersion: 1, graph: serializeGraph(graph), pageId: graph.getPages()[0]!.id, panX: 4, panY: 8, zoom: 1.25, photoLinks: {}, shared: encodeSharedCheckpoint(id, replica.update()) };
}
describe('shared project checkpoints', () => {
  it('retains exact binary state and rejects noncanonical or malformed base64', () => {
    const bytes = new Uint8Array([0, 128, 255, 1]);
    const record = encodeSharedCheckpoint(id, bytes); expect(decodeSharedCheckpoint(record)).toEqual(bytes);
    for (const checkpoint of ['A', 'AAA', 'AB==', 'A===', 'AA=A', 'AAAA\n', 'AAAA-', 'AAAA=']) expect(() => decodeSharedCheckpoint({ ...record, checkpoint })).toThrow();
  });
  it('refuses unknown versions, fields, endpoint identities and oversized binary before encoding', () => {
    const record = encodeSharedCheckpoint(id, new Uint8Array([0, 0]));
    for (const value of [null, [], { ...record, version: 2 }, { ...record, token: 'secret' }, { ...record, documentId: 'https://relay.example/room' }, { ...record, documentId: '' }, { ...record, checkpoint: 2 }]) expect(() => decodeSharedCheckpoint(value)).toThrow();
    const encoder = vi.spyOn(globalThis, 'btoa'); expect(() => encodeSharedCheckpoint(id, new Uint8Array(32 * 1024 * 1024 + 1))).toThrow('oversized'); expect(encoder).not.toHaveBeenCalled(); encoder.mockRestore();
  });
  it('validates saved artwork against the actual shared projection without altering the original document', () => {
    const graph = new SceneGraph(), page = graph.getPages()[0]!, node = graph.createNode('RECTANGLE', page.id, { name: 'Original' }), replica = SharedDesign.fromGraph(graph);
    try {
      const document = saved(replica), original = JSON.stringify(document); validatePencilDocument(document); expect(JSON.stringify(document)).toBe(original);
      const changed = deserializeGraph(document.graph); changed.updateNode(node.id, { width: 900 });
      expect(() => validatePencilDocument({ ...document, graph: serializeGraph(changed) })).toThrow('do not match'); expect(JSON.stringify(document)).toBe(original);
      expect(() => validatePencilDocument({ ...document, shared: { ...document.shared!, checkpoint: 'AAAA' } })).toThrow();
    } finally { replica.dispose(); }
  });
  it('reopens tombstones and concurrent offline work with new peer IDs and converges with the original peer', () => {
    const graph = new SceneGraph(), page = graph.getPages()[0]!, removed = graph.createNode('RECTANGLE', page.id), a = SharedDesign.fromGraph(graph), b = SharedDesign.fromUpdate(a.update());
    let reopened: SharedDesign | undefined, other: SharedDesign | undefined;
    try {
      const oldPeer = a.peerId; a.edit('Delete', draft => draft.deleteNode(removed.id));
      const document = JSON.parse(JSON.stringify(saved(a))) as PencilDocument; reopened = restoreSharedDesign(document); other = restoreSharedDesign(document);
      expect(reopened.peerId).not.toBe(oldPeer); expect(reopened.canUndo).toBe(false); expect(reopened.graph.nodes.has(removed.id)).toBe(false);
      let first = '', second = '';
      reopened.edit('Offline one', draft => { first = draft.createNode('TEXT', page.id, { text: 'Offline one' }).id; });
      other.edit('Offline two', draft => { second = draft.createNode('TEXT', page.id, { text: 'Offline two' }).id; }); expect(first).not.toBe(second);
      b.edit('Original peer', draft => draft.createNode('RECTANGLE', page.id, { name: 'Peer artwork' }));
      reopened.receive(other.update(reopened.stateVector())); reopened.receive(b.update(reopened.stateVector())); b.receive(reopened.update(b.stateVector())); other.receive(reopened.update(other.stateVector()));
      expect(serializeGraph(reopened.graph)).toBe(serializeGraph(b.graph)); expect(serializeGraph(other.graph)).toBe(serializeGraph(b.graph)); expect(b.graph.nodes.has(removed.id)).toBe(false);
    } finally { a.dispose(); b.dispose(); reopened?.dispose(); other?.dispose(); }
  });
  it('retains image bytes, FIG schema, component identities and variable metadata across JSON reopening', () => {
    const graph = new SceneGraph(), page = graph.getPages()[0]!, component = graph.createNode('COMPONENT', page.id, { name: 'Card' });
    graph.createNode('TEXT', component.id, { text: 'Retained' }); graph.createInstance(component.id, page.id); graph.images.set('bytes', new Uint8Array([128, 0, 255])); graph.figKiwiVersion = 99; graph.figSchemaDeflated = new Uint8Array([1, 2, 3]);
    const collection = graph.createCollection('Palette'); graph.createVariable('Accent', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 });
    const replica = SharedDesign.fromGraph(graph), restored = restoreSharedDesign(JSON.parse(JSON.stringify(saved(replica))));
    try { expect(serializeGraph(restored.graph)).toBe(serializeGraph(replica.graph)); expect(restored.graph.getInstances(component.id)).toHaveLength(1); }
    finally { replica.dispose(); restored.dispose(); }
  });
  it('publishes artwork and its candidate checkpoint together before the live replica is updated', () => {
    const graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0]!.id), replica = SharedDesign.fromGraph(graph), editor = createEditor({ graph }); let binding!: SharedEditorBinding, admissions = 0;
    binding = new SharedEditorBinding(editor, replica, { publish: () => {
      const snapshot = binding.snapshot(), document: PencilDocument = { formatVersion: 1, graph: snapshot.graph, pageId: snapshot.view.page, panX: 0, panY: 0, zoom: 1, photoLinks: {}, shared: encodeSharedCheckpoint(id, snapshot.checkpoint) };
      const restored = restoreSharedDesign(document); try { expect(restored.graph.getNode(node.id)!.x).toBe(editor.graph.getNode(node.id)!.x); admissions++; } finally { restored.dispose(); }
    } });
    try { editor.updateNodeWithUndo(node.id, { x: 300 }); expect(admissions).toBe(1); editor.undoAction(); expect(admissions).toBeGreaterThan(1); expect(node.x).toBe(0); }
    finally { binding.dispose(); replica.dispose(); }
  });
  it('saves accepted artwork during provisional batches and canceled interactive previews', () => {
    const graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0]!.id), replica = SharedDesign.fromGraph(graph), editor = createEditor({ graph }), binding = new SharedEditorBinding(editor, replica);
    try {
      editor.undo.beginBatch('Draft'); editor.graph.updateNode(node.id, { x: 100 }); const snapshot = binding.snapshot(); expect(deserializeGraph(snapshot.graph).getNode(node.id)!.x).toBe(0); const checkpoint = SharedDesign.fromUpdate(snapshot.checkpoint); try { expect(checkpoint.graph.getNode(node.id)!.x).toBe(0); } finally { checkpoint.dispose(); } editor.undo.rollbackBatch();
      const finish = editor.beginInteractiveEdit(); editor.graph.updateNodePositionPreview(node.id, 200, 0); const preview = binding.snapshot(); expect(deserializeGraph(preview.graph).getNode(node.id)!.x).toBe(0); editor.graph.updateNodePositionPreview(node.id, 0, 0); finish(); binding.flush(); expect(replica.canUndo).toBe(false);
    } finally { binding.dispose(); replica.dispose(); }
  });
  it('reuses an accepted checkpoint for viewport snapshots and invalidates it after accepted changes', () => {
    const graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0]!.id), replica = SharedDesign.fromGraph(graph), editor = createEditor({ graph }), binding = new SharedEditorBinding(editor, replica);
    try {
      const original = binding.snapshot(), encoding = vi.spyOn(replica, 'update'); editor.state.panX = 90; binding.snapshot(); editor.state.zoom = 2; const moved = binding.snapshot(); expect(encoding).not.toHaveBeenCalled(); expect(moved.checkpoint).toEqual(original.checkpoint);
      editor.updateNodeWithUndo(node.id, { x: 20 }); const changed = binding.snapshot(); expect(changed.checkpoint).not.toEqual(original.checkpoint); const restored = SharedDesign.fromUpdate(changed.checkpoint); try { expect(restored.graph.getNode(node.id)!.x).toBe(20); } finally { restored.dispose(); }
    } finally { binding.dispose(); replica.dispose(); }
  });
});
