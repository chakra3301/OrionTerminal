import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { SceneGraph } from '@open-pencil/scene-graph';
import { SharedDesign } from './sharedDesign';
import { assertRoomRawUpdate, RoomRawUpdateError } from './roomRawUpdate';
import { RoomCommentPermissionError, assertRoomCommentChanges } from './roomCommentPolicy';
import { encodeSharedValue } from './sharedValue';
import type { RoomActor } from './sharedRoomProtocol';
import { COMMENT_KEY, COMMENT_PLUGIN, allComments } from './comments';

const owner: RoomActor = { id: 'member_owner', name: 'Owner', role: 'owner' };
const peer: RoomActor = { id: 'member_peer', name: 'Peer', role: 'editor' };
const replicas: SharedDesign[] = [], docs: Y.Doc[] = [];
afterEach(() => { replicas.splice(0).forEach(value => value.dispose()); docs.splice(0).forEach(value => value.destroy()); });
const keep = (value: SharedDesign) => { replicas.push(value); return value; };
function fixture() {
  const graph = new SceneGraph(), page = graph.getPages()[0]!.id;
  const node = graph.createNode('RECTANGLE', page, { x: 12, width: 20, height: 30 }).id;
  graph.updateNode(page, { pluginData: [{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value: JSON.stringify({ version: 1, threads: [{ id: 'thread_1', anchor: { points: [{ x: 10, y: 20 }], fallback: [{ x: 10, y: 20 }], format: 'local' }, resolved: false, messages: [{ id: 'message_1', author: { id: owner.id, name: owner.name }, body: 'Original', createdAt: 1000, reactions: [] }] }] }) }] });
  const before = keep(SharedDesign.fromGraph(graph)), checkpoint = before.update();
  const doc = new Y.Doc({ gc: false }); docs.push(doc); Y.applyUpdate(doc, checkpoint);
  const vector = Y.encodeStateVector(doc), record = doc.getMap<Y.Map<unknown>>('comments').get('thread_1')!;
  const message = (record.get('messages') as Y.Map<Y.Map<unknown>>).get('message_1')!;
  const audit = (update = Y.encodeStateAsUpdate(doc, vector), actor = peer) => before.receive(update, (after, candidate) => {
    assertRoomRawUpdate(checkpoint, update, actor, before.graph, after, candidate);
    assertRoomCommentChanges(before.graph, after, actor);
  });
  return { before, checkpoint, doc, vector, record, message, node, page, audit };
}
type Struct = ReturnType<typeof Y.decodeUpdate>['structs'][number];
function packet(items: Struct[], deletes = new Map<number, { clock: number; len: number }[]>()) {
  const encoder = new Y.UpdateEncoderV1(), clients = new Map<number, Struct[]>();
  for (const item of items) { const values = clients.get(item.id.client) ?? []; values.push(item); clients.set(item.id.client, values); }
  encoding.writeVarUint(encoder.restEncoder, clients.size);
  for (const [client, values] of [...clients].sort(([a], [b]) => b-a)) {
    values.sort((a,b) => a.id.clock-b.id.clock); encoding.writeVarUint(encoder.restEncoder, values.length);
    encoder.writeClient(client); encoding.writeVarUint(encoder.restEncoder, values[0]!.id.clock);
    for (const item of values) item.write(encoder, 0);
  }
  encoding.writeVarUint(encoder.restEncoder, deletes.size);
  for (const [client, values] of [...deletes].sort(([a], [b]) => b-a)) {
    encoding.writeVarUint(encoder.restEncoder, client); encoding.writeVarUint(encoder.restEncoder, values.length);
    for (const value of values) { encoder.writeDsClock(value.clock); encoder.writeDsLen(value.len); }
  }
  return encoder.toUint8Array();
}
describe('raw room operation admission', () => {
  it('accepts exact checkpoint repeats, own edits and merged repeated values', () => {
    const f = fixture(); expect(() => f.audit(f.checkpoint)).not.toThrow();
    f.message.set('body', encodeSharedValue('First')); f.message.set('body', encodeSharedValue('Second')); f.message.set('body', encodeSharedValue('Original'));
    expect(() => f.audit(undefined, owner)).not.toThrow(); expect(allComments(f.before.graph)[0]!.messages[0]!.body).toBe('Original');
  });
  it('denies foreign intermediate bodies even when the visible value is restored', () => {
    const f = fixture(); f.message.set('body', encodeSharedValue('Hidden foreign write')); f.message.set('body', encodeSharedValue('Original'));
    expect(() => f.audit()).toThrow(RoomCommentPermissionError); expect(f.before.update()).toEqual(f.checkpoint);
  });
  it.each(['author', 'createdAt', 'id'] as const)('denies restored immutable %s writes by the original author', field => {
    const f = fixture(), original = f.message.get(field); f.message.set(field, encodeSharedValue(field === 'author' ? { id: owner.id, name: 'Rewritten' } : field === 'createdAt' ? 2000 : 'new_message'));
    f.message.set(field, original); expect(() => f.audit(undefined, owner)).toThrow(); expect(f.before.update()).toEqual(f.checkpoint);
  });
  it('checks reaction memberships inside replaced losing maps', () => {
    const f = fixture(), original = f.message.get('reactions') as Y.Map<unknown>;
    original.set(JSON.stringify(['👍', peer.id]), true); f.audit();
    const next = fixture(); next.message.set('reactions', new Y.Map([[JSON.stringify(['👍', peer.id]), true]])); next.message.set('reactions', new Y.Map());
    expect(() => next.audit(undefined, owner)).toThrow(RoomCommentPermissionError);
  });
  it('checks erased foreign data when only a container deletion is supplied', () => {
    const f = fixture(), map = f.record.get('messages') as Y.Map<unknown>;
    const item = map._item!; const update = packet([], new Map([[item.id.client, [{ clock: item.id.clock, len: 1 }]]]));
    expect(() => f.audit(update)).toThrow(); expect(f.before.update()).toEqual(f.checkpoint);
  });
  it('denies hidden reserved artwork metadata that is restored in the same packet', () => {
    const f = fixture(), node = f.doc.getMap<Y.Map<unknown>>('nodes').get(f.node)!;
    node.set('pluginData', encodeSharedValue([{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value: '{bad' }])); node.set('pluginData', encodeSharedValue([]));
    expect(() => f.audit()).toThrow(RoomCommentPermissionError); expect(f.before.graph.getNode(f.node)!.x).toBe(12);
  });
  it('denies rewritten document identities even after visible restoration', () => {
    const f = fixture(), meta = f.doc.getMap('meta'), root = meta.get('root'); meta.set('root', 'hidden_root'); meta.set('root', root);
    expect(() => f.audit()).toThrow(); expect(f.before.update()).toEqual(f.checkpoint);
  });
  it('requires every dependency, even when a sender advertises an older vector', () => {
    const f = fixture(); const item = new Y.Item(Y.createID(900001, 0), null, Y.createID(900002, 0), null, null, null, null, new Y.ContentAny([encodeSharedValue('Hidden')]));
    expect(() => f.audit(packet([item]))).toThrow(RoomRawUpdateError); expect(f.before.update()).toEqual(f.checkpoint);
  });
  it('requires contiguous clocks rather than buffering a missing prefix', () => {
    const f = fixture(), item = new Y.Item(Y.createID(900001, 4), null, null, null, null, null, 'x', new Y.ContentAny([encodeSharedValue(40)]));
    item.parent = 'variables' as unknown as Y.AbstractType<unknown>;
    expect(() => f.audit(packet([item]))).toThrow(RoomRawUpdateError);
  });
  it('rejects future deletion targets rather than retaining a latent delete set', () => {
    const f = fixture(); expect(() => f.audit(packet([], new Map([[900001, [{ clock: 0, len: 1 }]]])))).toThrow(RoomRawUpdateError); expect(f.before.update()).toEqual(f.checkpoint);
  });
  it('rejects contradictory values under already accepted clocks', () => {
    const f = fixture(), decoded = Y.decodeUpdate(f.checkpoint), item = decoded.structs.find(value => value instanceof Y.Item && value.content instanceof Y.ContentAny && value.content.getContent().includes(encodeSharedValue('Original'))) as Y.Item;
    item.content = new Y.ContentAny([encodeSharedValue('Contradictory')]); expect(() => f.audit(packet(decoded.structs, decoded.ds.clients))).toThrow(); expect(f.before.update()).toEqual(f.checkpoint);
  });
  it('rejects unsupported content, including arrays hidden by replacement', () => {
    const f = fixture(), node = f.doc.getMap<Y.Map<unknown>>('nodes').get(f.node)!;
    node.set('name', new Y.Array()); node.set('name', encodeSharedValue('Restored'));
    expect(() => f.audit()).toThrow(); expect(f.before.update()).toEqual(f.checkpoint);
  });
  it('accepts ordinary artwork changes alongside the current member’s reaction', () => {
    const f = fixture(), node = f.doc.getMap<Y.Map<unknown>>('nodes').get(f.node)!;
    node.set('x', encodeSharedValue(50)); (f.message.get('reactions') as Y.Map<unknown>).set(JSON.stringify(['👍', peer.id]), true);
    f.audit(); expect(f.before.graph.getNode(f.node)!.x).toBe(50); expect(allComments(f.before.graph)[0]!.messages[0]!.reactions).toEqual([{ emoji: '👍', authors: [peer.id] }]);
  });
  it('admits a bounded burst of repeated original metadata without rescanning it for every atom', () => {
    const f = fixture(), author = f.message.get('author'), createdAt = f.message.get('createdAt');
    for (let i=0;i<4096;i++) { f.message.set('author',author); f.message.set('createdAt',createdAt); }
    expect(() => f.audit(undefined, owner)).not.toThrow(); expect(allComments(f.before.graph)[0]!.messages[0]!.createdAt).toBe(1000);
  });
  it('rejects fresh garbage collection that cannot prove the discarded operation', () => {
    const f = fixture(); expect(() => f.audit(packet([new Y.GC(Y.createID(900001,0),1)]))).toThrow(); expect(f.before.update()).toEqual(f.checkpoint);
  });
  it('accepts a merged update that overlaps accepted clocks and adds a new suffix', () => {
    const f = fixture(); f.message.set('body',encodeSharedValue('First')); f.audit(undefined,owner);
    const checkpoint=f.before.update(); f.message.set('body',encodeSharedValue('Second')); f.message.set('body',encodeSharedValue('Final'));
    const update=Y.encodeStateAsUpdate(f.doc,f.vector);
    expect(()=>f.before.receive(update,(after,candidate)=>assertRoomRawUpdate(checkpoint,update,owner,f.before.graph,after,candidate))).not.toThrow();
    expect(allComments(f.before.graph)[0]!.messages[0]!.body).toBe('Final');
  });
});
