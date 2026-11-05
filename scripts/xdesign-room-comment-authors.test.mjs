import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { SceneGraph } from '@open-pencil/scene-graph';
import { roomEngine } from './xdesign-room-engine.mjs';
import { createRoomRelay } from './xdesign-room-relay.mjs';
import { RoomStore } from './xdesign-room-store.mjs';
let engine;
const documentId = 'author_document_001', administrator = 'author-admin-'.repeat(4), base = `/v1/rooms/${documentId}/comments/authors`;
const legacy = { id: 'local_author', name: 'Original 🙂' }, foreign = { id: 'other_local_author', name: 'Original 🙂' };
const anchor = { format: 'local', points: [{ x: 10, y: 20 }], fallback: [{ x: 10, y: 20 }] };
before(async () => { engine = await roomEngine(); });
after(async () => { if (process.env.XDESIGN_AUTHOR_EVIDENCE) await writeFile(process.env.XDESIGN_AUTHOR_EVIDENCE, JSON.stringify({ node: process.version, bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, licenseAssets: engine.licenseAssets, warnings: engine.warnings, transport: 'dedicated-temporary-sqlite-and-node-stream-handlers-no-sockets' }, null, 2) + '\n'); });
function threads(peer, page) { return engine.api.allComments(peer.graph).filter(thread => thread.ownerPageId === page).map(({ ownerPageId, ...thread }) => structuredClone(thread)); }
function write(graph, page, threads) { graph.updateNode(page, { pluginData: threads.length ? [{ pluginId: 'orion.xdesign.comments', key: 'threads', value: JSON.stringify({ version: 1, threads }) }] : [] }); }
async function fixture(work) {
  const folder = await mkdtemp(join(tmpdir(), 'xdesign-author-grants-')), database = join(folder, 'rooms.sqlite'), replicas = [];
  let relay = await createRoomRelay({ database, adminSecret: administrator, engine });
  const graph = new SceneGraph(), page = graph.getPages()[0].id, node = graph.createNode('RECTANGLE', page, { x: 10, width: 20, height: 30 }).id;
  write(graph, page, [{ id: 'thread_1', anchor, resolved: false, messages: [{ id: 'message_1', author: legacy, body: 'Original', createdAt: 1000, reactions: [] }, { id: 'message_2', author: foreign, body: 'Peer', createdAt: 2000, reactions: [] }] }]);
  const seed = engine.api.SharedDesign.fromGraph(graph); replicas.push(seed);
  const owner = relay.store.create(documentId, 'Imported', 'Owner', seed.update()), editor = relay.store.invite(documentId, owner.actor, 'Editor', 'editor'), viewer = relay.store.invite(documentId, owner.actor, 'Viewer', 'viewer');
  const peer = () => { const value = engine.api.SharedDesign.fromUpdate(new Uint8Array(relay.store.db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint)); replicas.push(value); return value; };
  const state = () => Object.fromEntries(['rooms','members','receipts','comment_history','comment_fields','comment_authors','comment_author_receipts'].map(table => [table, relay.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const packet = command => ({ version: 1, type: 'comment', documentId, clientId: 'author_client_001', requestId: randomUUID(), vector: 'AA==', command });
  const call = async (grant = owner, input, path = base, method = input === undefined ? 'GET' : 'POST') => {
    const request = Readable.from(input === undefined ? [] : [Buffer.from(JSON.stringify(input))]); Object.assign(request, { method, url: path, headers: { authorization: `Bearer ${grant.credential}`, 'content-type': 'application/json' }, socket: { remoteAddress: randomUUID() } }); let status, data;
    await relay.handle(request, { destroyed: false, writeHead(code) { status = code; }, end(bytes) { data = JSON.parse(bytes); } }); return { status, data };
  };
  const assign = (memberId = editor.actor.id, authorId = legacy.id, step = 0, requestId = randomUUID()) => ({ version: 1, authorId, memberId, step, requestId });
  const comment = (grant, command, outgoing = packet(command), recover = false) => call(grant, outgoing, `/v1/rooms/${documentId}/comments${recover ? '/recover' : ''}`);
  const send = async (...args) => { const result = await comment(...args); assert.equal(result.status, 200, JSON.stringify(result)); return result.data; };
  const rawPacket = peer => ({ version: 1, type: 'update', documentId, clientId: 'author_artwork_001', requestId: randomUUID(), vector: engine.api.roomBinary(peer.stateVector(), true), update: engine.api.roomBinary(peer.update()) });
  const raw = (peer, grant = editor, outgoing = rawPacket(peer)) => relay.store.exchange(grant.actor, outgoing);
  const editRaw = (peer, work) => peer.edit('Comment edit', graph => { const value = threads(peer, page); work(value, graph); write(graph, page, value); });
  const refused = async (action, status) => { const saved = state(), result = await action(); assert.equal(result.status, status, JSON.stringify(result)); assert.deepEqual(state(), saved); return result; };
  try { await work({ get relay() { return relay; }, database, page, node, owner, editor, viewer, peer, state, packet, call, assign, comment, send, raw, rawPacket, editRaw, refused, async restart() { await relay.close(); relay = await createRoomRelay({ database, adminSecret: administrator, engine }); } }); }
  finally { replicas.forEach(peer => peer.dispose()); await relay.close(); await rm(folder, { recursive: true, force: true }); }
}
const edit = body => ({ type: 'edit', threadId: 'thread_1', messageId: 'message_1', body });
const replay = (outgoing, direction = 'undo', step = 0) => ({ type: 'history', threadId: 'thread_1', sourceClientId: outgoing.clientId, sourceRequestId: outgoing.requestId, direction, step });

test('imported author catalog is unassigned, owner-only and independent of equal display names', () => fixture(async c => {
  const before = c.state(), list = await c.call(); assert.equal(list.status, 200); assert.deepEqual(list.data.authors.map(item => [item.authorId, item.name, item.memberId, item.step]), [[legacy.id, legacy.name, null, 0], [foreign.id, foreign.name, null, 0]]);
  assert.deepEqual(c.state(), before); await c.refused(() => c.call(c.editor), 403); await c.refused(() => c.call(c.viewer), 403);
  for (const member of [c.owner, c.editor, c.viewer]) await c.refused(() => c.comment(member, edit('Forbidden')), 403);
}));
test('explicit owner assignment admits semantic edit/pin/delete while preserving original attribution and peer replies', () => fixture(async c => {
  assert.equal((await c.call(c.owner, c.assign())).status, 200); await c.send(c.editor, edit('Edited'));
  const message = threads(c.peer(), c.page)[0].messages[0]; assert.deepEqual(message.author, legacy); assert.equal(message.createdAt, 1000); assert.equal(message.body, 'Edited'); assert.ok(message.editedAt > 1000);
  await c.send(c.editor, { type: 'move', threadId: 'thread_1', pageId: c.page, anchor: { ...anchor, points: [{ x: 40, y: 50 }] } });
  await c.refused(() => c.comment(c.editor, { type: 'edit', threadId: 'thread_1', messageId: 'message_2', body: 'Spoofed' }), 403);
  await c.send(c.editor, { type: 'delete', threadId: 'thread_1', messageId: 'message_1' }); assert.equal(threads(c.peer(), c.page).length, 0);
}));
test('legacy grants give viewers semantic comment ownership without artwork access; new replies and reactions use current IDs', () => fixture(async c => {
  await c.call(c.owner, c.assign(c.viewer.actor.id)); await c.send(c.viewer, edit('Viewer edit'));
  await c.send(c.viewer, { type: 'reply', threadId: 'thread_1', body: 'New reply' }); await c.send(c.viewer, { type: 'react', threadId: 'thread_1', messageId: 'message_1', emoji: '👍' });
  const thread = threads(c.peer(), c.page)[0]; assert.equal(thread.messages[2].author.id, c.viewer.actor.id); assert.deepEqual(thread.messages[0].reactions[0].authors, [c.viewer.actor.id]);
  const peer = c.peer(); c.editRaw(peer, (_threads, graph) => graph.updateNode(c.node, { x: 777 })); const before = c.state(); assert.throws(() => c.raw(peer, c.viewer), error => error.status === 403 && error.code === 'readonly'); assert.deepEqual(c.state(), before);
}));
test('current author grants authorize all hidden raw atoms while preventing author/time/peer/reaction impersonation and mixed-artwork commits', () => fixture(async c => {
  await c.call(c.owner, c.assign());
  for (const change of [thread => { thread.messages[0].author.name = 'Changed'; }, thread => { thread.messages[0].createdAt++; }, thread => { thread.messages[1].body = 'Peer edit'; }, thread => { thread.messages[0].reactions = [{ emoji: '👍', authors: [legacy.id] }]; }]) {
    const peer = c.peer(); c.editRaw(peer, (threads, graph) => { change(threads[0]); graph.updateNode(c.node, { x: 777 }); }); const before = c.state(); assert.throws(() => c.raw(peer), error => error.status === 403); assert.deepEqual(c.state(), before);
  }
  const peer = c.peer(); c.editRaw(peer, threads => { threads[0].messages[0].body = 'Hidden rejected'; }); c.editRaw(peer, threads => { threads[0].messages[0].body = 'Original'; });
  await c.call(c.owner, c.assign(null, legacy.id, 1)); const before = c.state(); assert.throws(() => c.raw(peer), error => error.status === 403); assert.deepEqual(c.state(), before);
}));
test('assigned authors can use raw edit/undo/pin and reply deletion; fresh threads cannot impersonate a claimed legacy ID', () => fixture(async c => {
  await c.call(c.owner, c.assign()); const peer = c.peer(); c.editRaw(peer, threads => { threads[0].messages[0].body = 'Raw edit'; threads[0].anchor.points[0].x = 99; }); c.raw(peer); peer.undo(); c.raw(peer); assert.equal(threads(c.peer(), c.page)[0].messages[0].body, 'Original');
  const forgery = c.peer(); c.editRaw(forgery, threads => threads.push({ id: 'forged_thread', anchor, resolved: false, messages: [{ id: 'forged_message', author: legacy, body: 'Forged', createdAt: 1000, reactions: [] }] })); const before = c.state(); assert.throws(() => c.raw(forgery), error => error.status === 403); assert.deepEqual(c.state(), before);
  await c.call(c.owner, c.assign(c.editor.actor.id, foreign.id)); const deletion = c.peer(); c.editRaw(deletion, threads => threads[0].messages.splice(1, 1)); c.raw(deletion); deletion.undo(); c.raw(deletion); assert.deepEqual(threads(c.peer(), c.page)[0].messages[1].author, foreign);
  const root = c.peer(); c.editRaw(root, threads => threads.splice(0, 1)); c.raw(root); root.undo(); c.raw(root); assert.deepEqual(threads(c.peer(), c.page)[0].messages.map(message => message.author), [legacy, foreign]);
}));
test('semantic undo/redo retains original metadata and revalidates removed/reassigned grants before every new action', () => fixture(async c => {
  await c.call(c.owner, c.assign()); const outgoing = c.packet(edit('Change')); await c.send(c.editor, outgoing.command, outgoing); await c.send(c.editor, replay(outgoing)); await c.send(c.editor, replay(outgoing, 'redo', 1));
  await c.call(c.owner, c.assign(c.viewer.actor.id, legacy.id, 1)); await c.refused(() => c.comment(c.editor, replay(outgoing, 'undo', 2)), 403); await c.refused(() => c.comment(c.viewer, replay(outgoing, 'undo', 2)), 404);
  await c.call(c.owner, c.assign(c.editor.actor.id, legacy.id, 2)); await c.send(c.editor, replay(outgoing, 'undo', 2)); assert.deepEqual(threads(c.peer(), c.page)[0].messages[0].author, legacy); assert.equal(threads(c.peer(), c.page)[0].messages[0].createdAt, 1000);
}));
test('deleted legacy roots restore server-held peer metadata only under a current grant', () => fixture(async c => {
  await c.call(c.owner, c.assign()); const outgoing = c.packet({ type: 'delete', threadId: 'thread_1', messageId: 'message_1' }), original = threads(c.peer(), c.page); await c.send(c.editor, outgoing.command, outgoing);
  await c.call(c.owner, c.assign(null, legacy.id, 1)); await c.refused(() => c.comment(c.editor, replay(outgoing)), 403);
  await c.call(c.owner, c.assign(c.editor.actor.id, legacy.id, 2)); await c.send(c.editor, replay(outgoing)); assert.deepEqual(threads(c.peer(), c.page), original);
}));
test('lost assignment replies recover after restart and later changes without replaying a superseded grant', () => fixture(async c => {
  const input = c.assign(), accepted = await c.call(c.owner, input); assert.equal(accepted.status, 200); const unchanged = c.state(); assert.deepEqual((await c.call(c.owner, input)).data, accepted.data); assert.deepEqual(c.state(), unchanged);
  await c.call(c.owner, c.assign(null, legacy.id, 1)); await c.restart(); const state = c.state(), recovered = await c.call(c.owner, undefined, `${base}/grants/${input.requestId}`); assert.equal(recovered.status, 200); assert.deepEqual(recovered.data.assignment, accepted.data.assignment); assert.deepEqual(recovered.data.current, { authorId: legacy.id, memberId: null, step: 2 });
  assert.deepEqual((await c.call(c.owner, input)).data.current, recovered.data.current); assert.deepEqual(c.state(), state); await c.refused(() => c.call(c.owner, { ...input, memberId: null }), 409); await c.refused(() => c.call(c.owner, undefined, `${base}/grants/${randomUUID()}`), 404);
}));
test('accepted comment receipts recover after grant removal but cannot create new edits or undo steps', () => fixture(async c => {
  await c.call(c.owner, c.assign()); const outgoing = c.packet(edit('Accepted')), result = await c.send(c.editor, outgoing.command, outgoing);
  await c.call(c.owner, c.assign(null, legacy.id, 1)); await c.restart(); const before = c.state(), retry = await c.send(c.editor, outgoing.command, outgoing, true); assert.equal(retry.acceptedRevision, result.acceptedRevision); assert.deepEqual(c.state(), before);
  await c.refused(() => c.comment(c.editor, edit('New edit')), 403); await c.refused(() => c.comment(c.editor, replay(outgoing)), 403);
}));
test('stale concurrent assignment steps, unknown authors, foreign/revoked members and current member identities cannot be claimed', () => fixture(async c => {
  const foreignRoom = c.relay.store.create('foreign_author_room_001', 'Other', 'Foreign', c.peer().update());
  await c.refused(() => c.call(c.owner, c.assign(foreignRoom.actor.id)), 404); await c.refused(() => c.call(c.owner, c.assign(c.editor.actor.id, 'unknown')), 404);
  const input = c.assign(); await c.call(c.owner, input); await c.refused(() => c.call(c.owner, c.assign(null)), 409);
  c.relay.store.changeMember(documentId, c.owner.actor, c.editor.actor.id, null); await c.refused(() => c.call(c.owner, c.assign(c.editor.actor.id, legacy.id, 1)), 404); await c.refused(() => c.comment(c.editor, edit('Revoked')), 401);
  const db = c.relay.store.db; db.prepare('INSERT INTO comment_authors(room_id,author_id,name) VALUES(?,?,?)').run(documentId, c.owner.actor.id, 'Injected catalog row'); await c.refused(() => c.call(c.owner, c.assign(c.viewer.actor.id, c.owner.actor.id)), 403);
  assert.deepEqual([...c.relay.store.authors.grants(documentId, c.owner.actor)], []);
}));
test('reassigned local authors remain separate from new authenticated comment identities and cannot grant peer history access', () => fixture(async c => {
  await c.call(c.owner, c.assign()); await c.send(c.viewer, { type: 'reply', threadId: 'thread_1', body: 'Member reply' });
  const thread = threads(c.peer(), c.page)[0], input = c.assign(c.editor.actor.id, c.viewer.actor.id); await c.refused(() => c.call(c.owner, input), 404); await c.refused(() => c.comment(c.editor, { type: 'edit', threadId: 'thread_1', messageId: thread.messages[2].id, body: 'Claim' }), 403);
}));
test('assignment/checkpoint/history/receipt writes roll back together after an injected receipt failure', () => fixture(async c => {
  c.relay.store.db.exec("CREATE TRIGGER fail_author_receipt BEFORE INSERT ON comment_author_receipts BEGIN SELECT RAISE(ABORT,'assignment receipt failure'); END;");
  await c.refused(() => c.call(c.owner, c.assign()), 500); c.relay.store.db.exec('DROP TRIGGER fail_author_receipt'); assert.equal((await c.call(c.owner, c.assign())).status, 200);
}));
test('request fields, transfer limits and methods are strict; current owner authority is rechecked after reading the body', () => fixture(async c => {
  for (const patch of [{ version: 2 }, { step: -1 }, { step: 1.5 }, { memberId: undefined }, { authorId: '../unsafe?author' }, { actor: c.editor.actor }, { requestId: 'small' }, { checkpoint: 'AA==' }]) await c.refused(() => c.call(c.owner, { ...c.assign(), ...patch }), 422);
  await c.refused(() => c.call(c.owner, { ...c.assign(), authorId: 'x'.repeat(5000) }), 413); await c.refused(() => c.call(c.owner, undefined, base, 'DELETE'), 405);
  const request = new PassThrough(), input = Buffer.from(JSON.stringify(c.assign())); Object.assign(request, { method: 'POST', url: base, headers: { authorization: `Bearer ${c.owner.credential}`, 'content-type': 'application/json' }, socket: { remoteAddress: randomUUID() } }); let status;
  const outcome = c.relay.handle(request, { destroyed: false, writeHead(code) { status = code; }, end() {} }); request.write(input.subarray(0, 5));
  await new Promise(resolve => setImmediate(resolve)); c.relay.store.db.prepare('UPDATE members SET role=? WHERE id=?').run('viewer', c.owner.actor.id); const before = c.state(); request.end(input.subarray(5)); await outcome; assert.equal(status, 403); assert.deepEqual(c.state(), before);
}));
test('format-three upgrade appends author tables atomically, leaves accepted documents/history unchanged and preserves current members', () => fixture(async c => {
  await c.send(c.viewer, { type: 'reply', threadId: 'thread_1', body: 'Existing member' }); const before = c.state(), db = c.relay.store.db;
  db.exec("DROP TABLE room_images;DROP TABLE room_image_revisions;DROP TABLE room_image_chunks;DROP TABLE room_image_uploads;DROP TABLE room_library_receipts;DROP TABLE room_library_revisions;DROP TABLE room_libraries;DROP TABLE comment_author_receipts;DROP TABLE comment_authors;UPDATE room_meta SET value='3' WHERE key='version';CREATE TRIGGER fail_author_upgrade BEFORE UPDATE ON room_meta WHEN NEW.value='4' BEGIN SELECT RAISE(ABORT,'author upgrade failure'); END;"); await c.relay.close(); const bytes = await readFile(c.database); await assert.rejects(c.restart(), /author upgrade failure/); assert.ok(bytes.equals(await readFile(c.database)));
  const repair = new DatabaseSync(c.database); assert.equal(repair.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'comment_author%'").get().n, 0); repair.exec('DROP TRIGGER fail_author_upgrade'); repair.close(); await c.restart();
  for (const table of ['rooms','members','receipts','comment_history','comment_fields']) assert.deepEqual(c.state()[table], before[table]); assert.equal(c.relay.store.db.prepare("SELECT value FROM room_meta WHERE key='version'").get().value, '6'); assert.deepEqual((await c.call()).data.authors.map(row => row.authorId), [legacy.id, foreign.id]);
}));
test('damaged grant receipts fail closed and leave subsequent legitimate comment permissions unchanged', () => fixture(async c => {
  const input = c.assign(); await c.call(c.owner, input); c.relay.store.db.prepare('UPDATE comment_author_receipts SET result=? WHERE request_id=?').run('{}', input.requestId); await c.refused(() => c.call(c.owner, undefined, `${base}/grants/${input.requestId}`), 500); await c.send(c.editor, edit('Still authorized'));
}));

test('pin history and reply deletion history recheck their original author grants without mutating provenance on refusal', () => fixture(async c => {
  await c.call(c.owner, c.assign()); await c.call(c.owner, c.assign(c.editor.actor.id, foreign.id));
  const pin = c.packet({ type: 'move', threadId: 'thread_1', pageId: c.page, anchor: { ...anchor, points: [{ x: 80, y: 90 }] } });
  await c.send(c.editor, pin.command, pin); const reply = c.packet({ type: 'delete', threadId: 'thread_1', messageId: 'message_2' }); await c.send(c.editor, reply.command, reply);
  await c.call(c.owner, c.assign(null, legacy.id, 1)); await c.call(c.owner, c.assign(null, foreign.id, 1));
  await c.refused(() => c.comment(c.editor, replay(pin)), 403); await c.refused(() => c.comment(c.editor, replay(reply)), 403);
  await c.call(c.owner, c.assign(c.editor.actor.id, legacy.id, 2)); await c.call(c.owner, c.assign(c.editor.actor.id, foreign.id, 2));
  await c.send(c.editor, replay(pin)); await c.send(c.editor, replay(reply)); assert.deepEqual(threads(c.peer(), c.page)[0].messages.map(message => message.author), [legacy, foreign]);
}));

test('self ownership is authenticated, member-scoped and separate from the private owner catalog', () => fixture(async c => {
  const path = `/v1/rooms/${documentId}/comments/ownership`; await c.call(c.owner, c.assign()); const before = c.state();
  for (const [grant, ids] of [[c.owner, []], [c.editor, [legacy.id]], [c.viewer, []]]) {
    const result = await c.call(grant, undefined, path); assert.equal(result.status, 200); const parsed = engine.api.readCommentOwnership(result.data, documentId); assert.equal(parsed.actor.id, grant.actor.id); assert.deepEqual(parsed.authorIds, ids); assert.ok(!JSON.stringify(result.data).includes('memberId'));
  }
  assert.deepEqual(c.state(), before); await c.refused(() => c.call(c.viewer), 403); await c.refused(() => c.call(c.editor, {}, path, 'POST'), 405);
  await c.call(c.owner, c.assign(c.viewer.actor.id, legacy.id, 1)); assert.deepEqual((await c.call(c.editor, undefined, path)).data.authorIds, []); assert.deepEqual((await c.call(c.viewer, undefined, path)).data.authorIds, [legacy.id]);
  c.relay.store.changeMember(documentId, c.owner.actor, c.viewer.actor.id, null); await c.refused(() => c.call(c.viewer, undefined, path), 401);
}));
