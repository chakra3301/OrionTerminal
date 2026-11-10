import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SceneGraph } from '@open-pencil/scene-graph';
import { roomEngine } from './xdesign-room-engine.mjs';
import { RoomStore } from './xdesign-room-store.mjs';
let engine;
const documentId = 'comment_document_001', pluginId = 'orion.xdesign.comments', key = 'threads';
before(async () => { engine = await roomEngine(); });
after(async () => { if (process.env.XDESIGN_COMMENT_EVIDENCE) await writeFile(process.env.XDESIGN_COMMENT_EVIDENCE, JSON.stringify({ node: process.version, bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, licenseAssets: engine.licenseAssets, warnings: engine.warnings, transport: 'dedicated-temporary-sqlite-no-sockets' }, null, 2) + '\n'); });
const author = actor => ({ id: actor.id, name: actor.name });
const message = (actor, id, body = 'Review this') => ({ id, author: author(actor), body, createdAt: 1000, reactions: [] });
const thread = (actor, id = 'thread_001') => ({ id, anchor: { points: [{ x: 10, y: 20 }], fallback: [{ x: 10, y: 20 }], format: 'local' }, messages: [message(actor, `${id}_root`)], resolved: false });
function read(graph, page) { const value = graph.getNode(page).pluginData.find(entry => entry.pluginId === pluginId && entry.key === key)?.value; return value ? JSON.parse(value).threads : []; }
function write(graph, page, threads) { const node = graph.getNode(page); graph.updateNode(page, { pluginData: [...node.pluginData.filter(entry => entry.pluginId !== pluginId || entry.key !== key), ...(threads.length ? [{ pluginId, key, value: JSON.stringify({ version: 1, threads }) }] : [])] }); }
function edit(peer, page, work) { peer.edit('Comment change', graph => { const threads = read(graph, page); work(threads, graph); write(graph, page, threads); }); }
function packet(peer, extra = {}) { return { version: 1, type: 'update', documentId, clientId: 'comment_client_001', requestId: randomUUID(), vector: engine.api.roomBinary(peer.stateVector(), true), update: engine.api.roomBinary(peer.update()), ...extra }; }
async function fixture(work) {
  const folder = await mkdtemp(join(tmpdir(), 'xdesign-comment-policy-')), path = join(folder, 'rooms.sqlite'), peers = [];
  let store = new RoomStore(path, engine.api, { grantSecret: 'comment-test-key-'.repeat(3) });
  const own = peer => { peers.push(peer); return peer; }, graph = new SceneGraph(), page = graph.getPages()[0].id, node = graph.createNode('RECTANGLE', page, { x: 12, width: 20, height: 30 }).id, seed = own(engine.api.SharedDesign.fromGraph(graph));
  const owner = store.create(documentId, 'Comments', 'Owner', seed.update()), member = store.invite(documentId, owner.actor, 'Reviewer', 'editor'), viewer = store.invite(documentId, owner.actor, 'Reader', 'viewer');
  const snapshot = () => store.db.prepare('SELECT hex(checkpoint) AS bytes,digest,revision FROM rooms WHERE id=?').get(documentId);
  const peer = () => own(engine.api.SharedDesign.fromUpdate(new Uint8Array(store.db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint)));
  const send = (peer, actor, outgoing = packet(peer)) => { const reply = store.exchange(actor, outgoing); peer.receive(engine.api.readRoomResponse(reply, outgoing).update); return reply; };
  const refused = (peer, actor, status = 403, outgoing = packet(peer)) => {
    const before = snapshot(), receipts = store.db.prepare('SELECT count(*) AS n FROM receipts').get().n;
    assert.throws(() => store.exchange(actor, outgoing), error => error.status === status && (status !== 403 || ['comments', 'readonly'].includes(error.code)));
    assert.deepEqual(snapshot(), before); assert.equal(store.db.prepare('SELECT count(*) AS n FROM receipts').get().n, receipts);
  };
  try { await work({ get store() { return store; }, owner, member, viewer, page, node, peer, send, refused, snapshot, restart() { store.close(); store = new RoomStore(path, engine.api, { grantSecret: 'comment-test-key-'.repeat(3) }); } }); }
  finally { peers.forEach(value => value.dispose()); store.close(); await rm(folder, { recursive: true, force: true }); }
}
function start(context, actor = context.owner.actor) { const peer = context.peer(); edit(peer, context.page, threads => threads.push(thread(actor))); context.send(peer, actor); return peer; }

test('unchanged opaque reserved metadata permits unrelated artwork, while changed unknown storage is preserved and refused', () => {
  const before = new SceneGraph(), after = new SceneGraph(), page = before.getPages()[0].id, actor = { id: 'member_identity_001', name: 'Member', role: 'editor' };
  before.updateNode(page, { pluginData: [{ pluginId, key, value: '{future-or-corrupt' }] }); after.nodes = new Map(before.nodes); after.rootId = before.rootId;
  after.nodes.set(page, { ...before.getNode(page), name: 'Unrelated rename' }); engine.api.assertRoomCommentChanges(before, after, actor);
  after.nodes.set(page, { ...before.getNode(page), pluginData: [] }); assert.throws(() => engine.api.assertRoomCommentChanges(before, after, actor)); assert.equal(before.getNode(page).pluginData[0].value, '{future-or-corrupt');
});
test('authenticated authors retain 128-character Unicode names; forged and stale member labels fail atomically', () => fixture(context => {
  const name = '🙂'.repeat(64); context.store.db.prepare('UPDATE members SET name=? WHERE id=?').run(name, context.member.actor.id);
  const current = context.store.principal(documentId, context.member.actor), peer = context.peer(); edit(peer, context.page, threads => threads.push(thread(current)));
  context.send(peer, { ...context.member.actor, name: 'Spoofed', role: 'owner' }); assert.equal(read(context.peer().graph, context.page)[0].messages[0].author.name, name);
  const stale = context.peer(); edit(stale, context.page, threads => threads[0].messages.push(message(context.member.actor, 'stale_message'))); context.refused(stale, current);
  for (const actor of [context.owner.actor, { ...current, name: 'Forged' }]) { const forged = context.peer(); edit(forged, context.page, threads => threads.push(thread(actor, randomUUID()))); context.refused(forged, current); }
}));
test('even an owner cannot rewrite another author, timestamp, body, reply or root ownership', () => fixture(context => {
  start(context, context.member.actor);
  for (const change of [threads => { threads[0].messages[0].body = 'Owner edit'; }, threads => { threads[0].messages[0].author = author(context.owner.actor); }, threads => { threads[0].messages[0].createdAt++; }, threads => { threads[0].messages.unshift(message(context.owner.actor, 'replacement_root')); }, threads => threads.splice(0, 1)]) {
    const peer = context.peer(); edit(peer, context.page, change); context.refused(peer, context.owner.actor);
  }
  const peer = context.peer(); edit(peer, context.page, threads => threads[0].messages.push(message(context.owner.actor, 'owner_reply'))); context.send(peer, context.owner.actor);
  const other = context.peer(); edit(other, context.page, threads => threads[0].messages.splice(1, 1)); context.refused(other, context.member.actor);
}));
test('own edits and replies, pin moves, reply deletion and empty-thread undo/redo are accepted', () => fixture(context => {
  const peer = start(context);
  edit(peer, context.page, threads => { threads[0].messages[0].body = 'Updated'; threads[0].messages[0].editedAt = 2000; threads[0].messages.push(message(context.owner.actor, 'own_reply')); threads[0].anchor.points[0].x = 50; }); context.send(peer, context.owner.actor);
  peer.undo(); context.send(peer, context.owner.actor); assert.equal(read(context.peer().graph, context.page)[0].messages.length, 1); peer.redo(); context.send(peer, context.owner.actor);
  edit(peer, context.page, threads => threads[0].messages.splice(1, 1)); context.send(peer, context.owner.actor);
  edit(peer, context.page, threads => threads.splice(0, 1)); context.send(peer, context.owner.actor); peer.undo(); context.send(peer, context.owner.actor); assert.equal(read(context.peer().graph, context.page)[0].messages[0].body, 'Updated');
}));
test('reaction changes affect only the current member and concurrent peer reactions both survive', () => fixture(context => {
  start(context); const a = context.peer(), b = context.peer();
  edit(a, context.page, threads => threads[0].messages[0].reactions.push({ emoji: '👍', authors: [context.owner.actor.id] }));
  edit(b, context.page, threads => threads[0].messages[0].reactions.push({ emoji: '👍', authors: [context.member.actor.id] })); context.send(a, context.owner.actor); context.send(b, context.member.actor);
  assert.deepEqual(new Set(read(context.peer().graph, context.page)[0].messages[0].reactions[0].authors), new Set([context.owner.actor.id, context.member.actor.id]));
  for (const change of [threads => { threads[0].messages[0].reactions = []; }, threads => { threads[0].messages[0].reactions.push({ emoji: '🎉', authors: [context.viewer.actor.id] }); }]) { const peer = context.peer(); edit(peer, context.page, change); context.refused(peer, context.member.actor); }
  const own = context.peer(); edit(own, context.page, threads => { threads[0].messages[0].reactions[0].authors = [context.owner.actor.id]; }); context.send(own, context.member.actor);
}));
test('concurrent authenticated replies merge without replacing or claiming the peer message', () => fixture(context => {
  start(context); const a = context.peer(), b = context.peer();
  edit(a, context.page, threads => threads[0].messages.push(message(context.owner.actor, 'owner_concurrent'))); edit(b, context.page, threads => threads[0].messages.push(message(context.member.actor, 'peer_concurrent')));
  context.send(a, context.owner.actor); context.send(b, context.member.actor); assert.equal(read(context.peer().graph, context.page)[0].messages.length, 3);
}));
test('resolution records the member doing the action, with own resolution undo/reopen and no forged attribution', () => fixture(context => {
  start(context); const forged = context.peer(); edit(forged, context.page, threads => Object.assign(threads[0], { resolved: true, resolvedBy: author(context.owner.actor), resolvedAt: 2000 })); context.refused(forged, context.member.actor);
  const own = context.peer(); edit(own, context.page, threads => Object.assign(threads[0], { resolved: true, resolvedBy: author(context.member.actor), resolvedAt: 2000 })); context.send(own, context.member.actor);
  own.undo(); context.send(own, context.member.actor); own.redo(); context.send(own, context.member.actor);
  edit(own, context.page, threads => { threads[0].resolved = false; delete threads[0].resolvedBy; delete threads[0].resolvedAt; }); context.send(own, context.member.actor);
}));
test('pin moves require the root author; authorized whole-page deletion keeps ordinary artwork semantics', () => fixture(context => {
  start(context); const move = context.peer(); edit(move, context.page, threads => { threads[0].anchor.fallback[0].x = 99; }); context.refused(move, context.member.actor);
  const peer = context.peer(); peer.edit('Delete page', graph => { graph.createNode('CANVAS', graph.rootId, { name: 'Remaining' }); graph.deleteNode(context.page); }); context.send(peer, context.member.actor); assert.equal(context.peer().graph.getNode(context.page), undefined);
}));
test('reserved comment storage on a normal artwork layer and hidden-page relocation are refused', () => fixture(context => {
  start(context); const layer = context.peer(); layer.edit('Hidden metadata', graph => graph.updateNode(context.node, { pluginData: [{ pluginId, key, value: '{bad' }] })); context.refused(layer, context.member.actor);
  const hidden = context.peer(); hidden.edit('Hide page', graph => { graph.createNode('CANVAS', graph.rootId, { name: 'Remaining' }); graph.updateNode(context.page, { internalOnly: true }); }); context.refused(hidden, context.owner.actor);
}));
test('comment permission failure rolls back accompanying artwork and does not acknowledge the rejected request', () => fixture(context => {
  start(context); const peer = context.peer(); edit(peer, context.page, (threads, graph) => { graph.updateNode(context.node, { x: 999 }); threads[0].messages[0].body = 'Forged'; }); context.refused(peer, context.member.actor); assert.equal(context.peer().graph.getNode(context.node).x, 12);
}));
test('accepted comment receipts recover after restart/downgrade, while new viewer writes and revoked retries fail', () => fixture(context => {
  const peer = context.peer(); edit(peer, context.page, threads => threads.push(thread(context.member.actor))); const outgoing = packet(peer), accepted = context.send(peer, context.member.actor, outgoing);
  context.restart(); context.store.changeMember(documentId, context.owner.actor, context.member.actor.id, 'viewer'); const retry = context.send(peer, context.member.actor, outgoing); assert.equal(retry.acceptedRevision, accepted.acceptedRevision); assert.equal(retry.revision, accepted.revision); assert.equal(retry.actor.role, 'viewer');
  const fresh = context.peer(); edit(fresh, context.page, threads => threads[0].messages.push(message(context.member.actor, 'viewer_reply'))); context.refused(fresh, context.member.actor);
  context.store.changeMember(documentId, context.owner.actor, context.member.actor.id, null); context.refused(peer, context.member.actor, 401, outgoing);
}));
