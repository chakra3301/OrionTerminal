import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { SceneGraph } from '@open-pencil/scene-graph';
import { roomEngine } from './xdesign-room-engine.mjs';
import { RoomStore } from './xdesign-room-store.mjs';

let engine;
const documentId = 'raw_document_001', pluginId = 'orion.xdesign.comments', key = 'threads';
before(async () => { engine = await roomEngine(); });
after(async () => {
  if (process.env.XDESIGN_RAW_EVIDENCE) await writeFile(process.env.XDESIGN_RAW_EVIDENCE, JSON.stringify({ node: process.version, bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, licenseAssets: engine.licenseAssets, warnings: engine.warnings, transport: 'dedicated-temporary-sqlite-no-sockets', yjs: 'external fixture and bundled service exchange bytes only' }, null, 2) + '\n');
});
const encoded = input => engine.api.encodeSharedValue(input);
function packet(items = [], deletes = new Map()) {
  const encoder = new Y.UpdateEncoderV1(), clients = new Map();
  for (const item of items) { const values = clients.get(item.id.client) ?? []; values.push(item); clients.set(item.id.client, values); }
  encoding.writeVarUint(encoder.restEncoder, clients.size);
  for (const [client, values] of [...clients].sort(([a], [b]) => b-a)) {
    values.sort((a,b) => a.id.clock-b.id.clock); encoding.writeVarUint(encoder.restEncoder, values.length);
    encoder.writeClient(client); encoding.writeVarUint(encoder.restEncoder, values[0].id.clock);
    for (const item of values) item.write(encoder, 0);
  }
  encoding.writeVarUint(encoder.restEncoder, deletes.size);
  for (const [client, values] of [...deletes].sort(([a], [b]) => b-a)) {
    encoding.writeVarUint(encoder.restEncoder, client); encoding.writeVarUint(encoder.restEncoder, values.length);
    for (const range of values) { encoder.writeDsClock(range.clock); encoder.writeDsLen(range.len); }
  }
  return encoder.toUint8Array();
}
async function fixture(work) {
  const folder = await mkdtemp(join(tmpdir(), 'xdesign-raw-admission-')), path = join(folder, 'rooms.sqlite'), peers = [], docs = [];
  let store = new RoomStore(path, engine.api, { grantSecret: 'raw-admission-test-key-'.repeat(3) });
  const keep = peer => { peers.push(peer); return peer; }, graph = new SceneGraph(), page = graph.getPages()[0].id;
  const node = graph.createNode('RECTANGLE', page, { x: 12, width: 20, height: 30 }).id, seed = keep(engine.api.SharedDesign.fromGraph(graph));
  const owner = store.create(documentId, 'Raw admission', 'Owner', seed.update()), member = store.invite(documentId, owner.actor, 'Peer', 'editor');
  const checkpoint = () => new Uint8Array(store.db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint);
  const outgoing = (update, vector = new Uint8Array([0])) => ({ version: 1, type: 'update', documentId, clientId: 'raw_client_identity_001', requestId: randomUUID(), vector: engine.api.roomBinary(vector, true), update: engine.api.roomBinary(update) });
  const send = (update, actor = owner.actor, request = outgoing(update)) => store.exchange(actor, request);
  const first = keep(engine.api.SharedDesign.fromUpdate(checkpoint()));
  first.edit('Comment', graph => graph.updateNode(page, { pluginData: [{ pluginId, key, value: JSON.stringify({ version: 1, threads: [{ id: 'thread_1', anchor: { points: [{ x: 10, y: 20 }], fallback: [{ x: 10, y: 20 }], format: 'local' }, resolved: false, messages: [{ id: 'message_1', author: { id: owner.actor.id, name: owner.actor.name }, body: 'Original', createdAt: 1000, reactions: [] }] }] }) }] }));
  send(first.update());
  const raw = (bytes = checkpoint()) => {
    const doc = new Y.Doc({ gc: false }); docs.push(doc); Y.applyUpdate(doc, bytes);
    const vector = Y.encodeStateVector(doc), record = doc.getMap('comments').get('thread_1'), message = record?.get('messages')?.get('message_1');
    return { doc, vector, record, message, update: () => Y.encodeStateAsUpdate(doc, vector) };
  };
  const snapshot = () => ({ room: store.db.prepare('SELECT hex(checkpoint) AS bytes,digest,revision FROM rooms WHERE id=?').get(documentId), receipts: store.db.prepare('SELECT * FROM receipts ORDER BY rowid').all(), history: store.db.prepare('SELECT * FROM comment_history ORDER BY rowid').all(), fields: store.db.prepare('SELECT * FROM comment_fields ORDER BY rowid').all() });
  const refused = (update, actor = member.actor, status = 403, code = 'comments') => {
    const before = snapshot(); assert.throws(() => send(update, actor), error => error.status === status && error.code === code); assert.deepEqual(snapshot(), before);
  };
  const read = () => { const peer = keep(engine.api.SharedDesign.fromUpdate(checkpoint())); return { graph: peer.graph, thread: engine.api.allComments(peer.graph)[0] }; };
  try { await work({ get store() { return store; }, owner, member, page, node, raw, send, outgoing, refused, checkpoint, snapshot, read, restart() { store.close(); store = new RoomStore(path, engine.api, { grantSecret: 'raw-admission-test-key-'.repeat(3) }); } }); }
  finally { peers.forEach(peer => peer.dispose()); docs.forEach(doc => doc.destroy()); store.close(); await rm(folder, { recursive: true, force: true }); }
}
test('foreign write followed by visible restoration fails atomically with accompanying artwork', () => fixture(f => {
  const action = { version:1,type:'comment',documentId,clientId:'raw_history_client_001',requestId:randomUUID(),vector:'AA==',command:{type:'edit',threadId:'thread_1',messageId:'message_1',body:'Semantic original'} };
  f.store.comment(f.owner.actor,action); assert.equal(f.snapshot().history.length,1);
  const raw = f.raw(); raw.message.set('body', encoded('Forged')); raw.message.set('body', encoded('Semantic original')); raw.doc.getMap('nodes').get(f.node).set('x', encoded(999));
  f.refused(raw.update()); assert.equal(f.read().graph.getNode(f.node).x, 12);
  f.store.comment(f.owner.actor,{...action,requestId:randomUUID(),command:{type:'history',threadId:'thread_1',sourceClientId:action.clientId,sourceRequestId:action.requestId,direction:'undo',step:0}});
  assert.equal(f.read().thread.messages[0].body,'Original');
}));
test('every merged hidden value is checked rather than only the final atom', () => fixture(f => {
  const raw = f.raw(); raw.message.set('body', encoded('First foreign')); raw.message.set('body', encoded('Second foreign')); raw.message.set('body', encoded('Original'));
  assert.ok(Y.decodeUpdate(raw.update()).structs.some(item => item instanceof Y.Item && item.content instanceof Y.ContentAny && item.length > 1)); f.refused(raw.update());
}));
for (const field of ['author', 'createdAt', 'id']) test(`original authors cannot hide an immutable ${field} rewrite`, () => fixture(f => {
  const raw = f.raw(), original = raw.message.get(field); raw.message.set(field, encoded(field === 'author' ? { id: f.owner.actor.id, name: 'Forged name' } : field === 'createdAt' ? 2000 : 'other_message')); raw.message.set(field, original);
  f.refused(raw.update(), f.owner.actor, field === 'id' ? 422 : 403, field === 'id' ? 'invalid' : 'comments');
}));
test('losing concurrent foreign writes fail even when the visible owner edit wins', () => fixture(f => {
  const bytes = f.checkpoint(), legitimate = f.raw(bytes), foreign = f.raw(bytes);
  const largest = Math.max(...Y.decodeStateVector(legitimate.vector).keys()); legitimate.doc.clientID = largest+2; foreign.doc.clientID = largest+1;
  legitimate.message.set('body', encoded('Owner wins')); foreign.message.set('body', encoded('Foreign loses')); f.send(legitimate.update()); f.refused(foreign.update()); assert.equal(f.read().thread.messages[0].body, 'Owner wins');
}));
test('a known deleted thread still enforces author ownership on hidden descendant writes', () => fixture(f => {
  const stale = f.raw(), deletion = f.raw(); deletion.doc.getMap('comments').delete('thread_1'); f.send(deletion.update());
  stale.message.set('body', encoded('Tombstoned foreign')); f.refused(stale.update()); assert.equal(f.read().thread, undefined);
}));
test('fresh losing reaction maps cannot install a foreign membership', () => fixture(f => {
  const raw = f.raw(); raw.message.set('reactions', new Y.Map([[JSON.stringify(['👍', f.member.actor.id]), true]])); raw.message.set('reactions', new Y.Map()); f.refused(raw.update(), f.owner.actor);
}));
test('implicit container deletion cannot erase another member’s reaction', () => fixture(f => {
  const reaction = f.raw(); reaction.message.get('reactions').set(JSON.stringify(['👍', f.member.actor.id]), true); f.send(reaction.update(), f.member.actor);
  const raw = f.raw(), item = raw.message.get('reactions')._item;
  // The visible replacement is valid; the wire deletion omits child ranges.
  raw.message.set('reactions', new Y.Map()); const decoded = Y.decodeUpdate(raw.update());
  f.refused(packet(decoded.structs, new Map([[item.id.client, [{ clock: item.id.clock, len: 1 }]]])), f.owner.actor);
}));
test('whole-thread deletion retains root-author rights over peer replies and reactions', () => fixture(f => {
  const reaction = f.raw(); reaction.message.get('reactions').set(JSON.stringify(['👍', f.member.actor.id]), true); f.send(reaction.update(), f.member.actor);
  const raw = f.raw(); raw.doc.getMap('comments').delete('thread_1'); f.send(raw.update()); assert.equal(f.read().thread, undefined);
}));
test('pending origins with an empty advertised vector are refused without receipts', () => fixture(f => {
  const item = new Y.Item(Y.createID(900001, 0), null, Y.createID(900002, 0), null, null, null, null, new Y.ContentAny([encoded('Hidden')])); f.refused(packet([item]), f.member.actor, 409, 'dependencies');
}));
test('pending parents with an empty advertised vector are refused without receipts', () => fixture(f => {
  const item = new Y.Item(Y.createID(900001, 0), null, null, null, null, Y.createID(900002, 0), 'body', new Y.ContentAny([encoded('Hidden')])); f.refused(packet([item]), f.member.actor, 409, 'dependencies');
}));
test('missing clock prefixes are refused even for an otherwise valid root map atom', () => fixture(f => {
  const item = new Y.Item(Y.createID(900001, 4), null, null, null, null, 'variables', 'variable_1', new Y.ContentAny([encoded(4)])); f.refused(packet([item]), f.member.actor, 409, 'dependencies');
}));
test('future deletion ranges are refused with an empty advertised vector', () => fixture(f => {
  f.refused(packet([], new Map([[900001, [{ clock: 0, len: 1 }]]])), f.member.actor, 409, 'dependencies');
}));
test('contradictory accepted clocks fail even though Yjs ignores their repeated payload', () => fixture(f => {
  const decoded = Y.decodeUpdate(f.checkpoint()), original = f.raw().message.get('body');
  const item = decoded.structs.find(item => item instanceof Y.Item && item.content instanceof Y.ContentAny && item.content.getContent().includes(original)); item.content = new Y.ContentAny([encoded('Clock contradiction')]); f.refused(packet(decoded.structs, decoded.ds.clients), f.member.actor, 422, 'invalid');
}));
test('reserved metadata in losing artwork values is denied', () => fixture(f => {
  const raw = f.raw(), node = raw.doc.getMap('nodes').get(f.node); node.set('pluginData', encoded([{ pluginId, key, value: '{bad' }])); node.set('pluginData', encoded([])); f.refused(raw.update());
}));
test('hidden document-root rewrites and novel garbage-collection records are denied', () => fixture(f => {
  const raw = f.raw(), meta = raw.doc.getMap('meta'), root = meta.get('root'); meta.set('root', 'hidden_root'); meta.set('root', root); f.refused(raw.update(), f.member.actor, 422, 'invalid');
  f.refused(packet([new Y.GC(Y.createID(900001, 0), 1)]), f.member.actor, 422, 'invalid');
}));
test('unsupported nested content cannot hide behind a valid artwork replacement', () => fixture(f => {
  const raw = f.raw(), node = raw.doc.getMap('nodes').get(f.node); node.set('name', new Y.Array()); node.set('name', encoded('Valid final value')); f.refused(raw.update(), f.member.actor, 422, 'invalid');
}));
test('legitimate own raw changes and exact full-checkpoint repeats retain recoverable receipts', () => fixture(f => {
  const raw = f.raw(); raw.message.set('body', encoded('First')); raw.message.set('body', encoded('Original')); f.send(raw.update());
  const reaction = f.raw(); reaction.message.get('reactions').set(JSON.stringify(['👍', f.member.actor.id]), true);
  const request = f.outgoing(reaction.update()), accepted = f.send(reaction.update(), f.member.actor, request);
  f.send(f.checkpoint(), f.member.actor); f.restart(); f.store.changeMember(documentId, f.owner.actor, f.member.actor.id, 'viewer');
  const retry = f.send(reaction.update(), f.member.actor, request); assert.equal(retry.acceptedRevision, accepted.acceptedRevision); assert.equal(retry.actor.role, 'viewer');
}));
test('a partial known prefix and new merged suffix retain legitimate own editing', () => fixture(f => {
  const raw = f.raw(); raw.message.set('body', encoded('First accepted')); f.send(raw.update());
  raw.message.set('body', encoded('Second accepted')); raw.message.set('body', encoded('Final accepted')); f.send(raw.update());
  assert.equal(f.read().thread.messages[0].body, 'Final accepted');
}));
test('current membership may edit its original historical author name without rewriting it', () => fixture(f => {
  f.store.db.prepare('UPDATE members SET name=? WHERE id=?').run('Owner renamed', f.owner.actor.id);
  const raw = f.raw(); raw.message.set('body', encoded('Historical author retained')); raw.message.set('author', raw.message.get('author')); f.send(raw.update());
  assert.equal(f.read().thread.messages[0].author.name, 'Owner');
}));
test('own reply deletion may remove peer reactions while retaining the thread', () => fixture(f => {
  const raw = f.raw(), reply = new Y.Map([['id',encoded('reply_1')],['author',encoded({ id: f.owner.actor.id, name: f.owner.actor.name })],['body',encoded('Own reply')],['createdAt',encoded(2000)],['reactions',new Y.Map()]]);
  raw.record.get('messages').set('reply_1',reply); f.send(raw.update());
  const reacted = f.raw(); reacted.record.get('messages').get('reply_1').get('reactions').set(JSON.stringify(['👍',f.member.actor.id]),true); f.send(reacted.update(),f.member.actor);
  const removal = f.raw(); removal.record.get('messages').delete('reply_1'); f.send(removal.update()); assert.equal(f.read().thread.messages.length,1);
}));
test('a hidden type rewrite cannot change a page that is already deleted', () => fixture(f => {
  const peer = engine.api.SharedDesign.fromUpdate(f.checkpoint());
  try { peer.edit('Delete page',graph=>{graph.createNode('CANVAS',graph.rootId,{name:'Remaining'});graph.deleteNode(f.page);}); f.send(peer.update(),f.member.actor); }
  finally { peer.dispose(); }
  assert.equal(f.read().graph.getNode(f.page),undefined);
  const raw = f.raw(), page = raw.doc.getMap('nodes').get(f.page); page.set('type',encoded('RECTANGLE')); page.set('type',encoded('CANVAS')); f.refused(raw.update());
}));
test('unknown right origins cannot be buffered behind an older advertised vector', () => fixture(f => {
  const raw = f.raw(), item = new Y.Item(Y.createID(900001,0),null,raw.message._item.id,null,Y.createID(900002,0),null,null,new Y.ContentAny([encoded('Hidden')]));
  f.refused(packet([item]),f.member.actor,409,'dependencies');
}));
test('atomic tree fields cannot hide binary content behind a valid final string', () => fixture(f => {
  const raw = f.raw(), node = raw.doc.getMap('nodes').get(f.node), page = node.get('$page'); node.set('$page',new Uint8Array([1,2])); node.set('$page',page); f.refused(raw.update(),f.member.actor,422,'invalid');
}));
test('ordinary binary image insertion and exact binary checkpoint replay remain accepted', () => fixture(f => {
  const raw = f.raw(); raw.doc.getMap('images').set('image_1',new Uint8Array([1,2,3,4])); f.send(raw.update(),f.member.actor);
  f.send(f.checkpoint(),f.member.actor); assert.deepEqual(f.read().graph.images.get('image_1'),new Uint8Array([1,2,3,4]));
}));
