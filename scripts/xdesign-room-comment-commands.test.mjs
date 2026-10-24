import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { SceneGraph } from '@open-pencil/scene-graph';
import { roomEngine } from './xdesign-room-engine.mjs';
import { createRoomRelay } from './xdesign-room-relay.mjs';
let engine;
const documentId = 'comment_commands_001', administrator = `fixture-${randomUUID()}`, grantSecret = 'comment-command-test-key-'.repeat(3), pluginId = 'orion.xdesign.comments';
before(async () => { engine = await roomEngine(); });
after(async () => { if (process.env.XDESIGN_COMMENT_COMMAND_EVIDENCE) await writeFile(process.env.XDESIGN_COMMENT_COMMAND_EVIDENCE, JSON.stringify({ node: process.version, bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, licenseAssets: engine.licenseAssets, warnings: engine.warnings, transport: 'dedicated-temporary-sqlite-and-node-stream-handlers-no-sockets' }, null, 2) + '\n'); });
const anchor = (nodeId) => ({ points: [{ x: .25, y: .5 }], fallback: [{ x: 12, y: 24 }], format: 'local', ...(nodeId ? { nodeId } : {}) });
function read(graph) { return graph.getPages().flatMap(page => { const value = page.pluginData.find(entry => entry.pluginId === pluginId && entry.key === 'threads')?.value; return value ? JSON.parse(value).threads.map(thread => ({ ...thread, ownerPageId: page.id })) : []; }); }
function request(peer, command, extra = {}) { return { version: 1, type: 'comment', documentId, clientId: 'comment_client_001', requestId: randomUUID(), vector: engine.api.roomBinary(peer.stateVector(), true), command, ...extra }; }
async function call(relay, credential, packet, recovery = false, extra = {}) {
  const input = extra.stream ?? Readable.from([Buffer.from(JSON.stringify(packet))]); Object.assign(input, { method: extra.method ?? 'POST', url: extra.path ?? `/v1/rooms/${documentId}/comments${recovery ? '/recover' : ''}`, headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json', ...extra.headers }, socket: { remoteAddress: randomUUID() } });
  let status, value; const response = { destroyed: false, writeHead(code) { status = code; }, end(bytes) { value = JSON.parse(bytes); } }; await relay.handle(input, response); return { status, value };
}
async function fixture(work) {
  const folder = await mkdtemp(join(tmpdir(), 'xdesign-comment-commands-')), database = join(folder, 'rooms.sqlite'), peers = [];
  let relay = await createRoomRelay({ database, adminSecret: administrator, grantSecret, engine });
  const own = peer => { peers.push(peer); return peer; }, graph = new SceneGraph(), page = graph.getPages()[0].id, node = graph.createNode('RECTANGLE', page, { x: 12, width: 100, height: 80 }).id, source = own(engine.api.SharedDesign.fromGraph(graph));
  const owner = relay.store.create(documentId, 'Comments', 'Owner', source.update()), viewer = relay.store.invite(documentId, owner.actor, 'Reader 👩🏽‍🎨', 'viewer'), editor = relay.store.invite(documentId, owner.actor, 'Editor', 'editor');
  const snapshot = () => relay.store.db.prepare('SELECT hex(checkpoint) AS bytes,digest,revision FROM rooms WHERE id=?').get(documentId);
  const peer = () => own(engine.api.SharedDesign.fromUpdate(new Uint8Array(relay.store.db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint)));
  const send = async (grant, command, local = peer(), outgoing = request(local, command), recovery = false) => {
    const response = await call(relay, grant.credential, outgoing, recovery); assert.equal(response.status, 200, JSON.stringify(response));
    const parsed = engine.api.readRoomCommentResponse(response.value, outgoing); local.receive(parsed.update, (_graph, checkpoint) => assert.ok(engine.api.roomCheckpointCovers(checkpoint, parsed.vector))); return { ...parsed.packet, outgoing, peer: local };
  };
  const refused = async (grant, outgoing, status, recovery = false, extra = {}) => {
    const before = snapshot(), receipts = relay.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n, result = await call(relay, grant.credential, outgoing, recovery, extra);
    assert.equal(result.status, status, JSON.stringify(result)); assert.deepEqual(snapshot(), before); assert.equal(relay.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n, receipts); return result;
  };
  try { await work({ get relay() { return relay; }, database, owner, viewer, editor, page, node, peer, send, refused, snapshot, async restart() { await relay.close(); relay = await createRoomRelay({ database, adminSecret: administrator, grantSecret, engine }); } }); }
  finally { peers.forEach(peer => peer.dispose()); await relay.close(); await rm(folder, { recursive: true, force: true }); }
}
const add = context => context.send(context.viewer, { type: 'add', pageId: context.page, anchor: anchor(context.node), body: '  שלום 日本語 👋\n<script>plain text</script>  ' });

test('viewer creation uses current server identity/time and never uploads caller artwork', () => fixture(async context => {
  const local = context.peer(); local.edit('Unsent artwork', graph => graph.updateNode(context.node, { x: 999 })); const before = Date.now();
  const result = await context.send(context.viewer, { type: 'add', pageId: context.page, anchor: anchor(context.node), body: 'Viewer note' }, local), stored = read(context.peer().graph)[0];
  assert.deepEqual(stored.messages[0].author, { id: context.viewer.actor.id, name: context.viewer.actor.name }); assert.ok(stored.messages[0].createdAt >= before && stored.messages[0].createdAt <= Date.now()); assert.equal(stored.id, result.result.threadId); assert.equal(stored.messages[0].id, result.result.messageId);
  assert.equal(context.peer().graph.getNode(context.node).x, 12); assert.equal(local.graph.getNode(context.node).x, 999); assert.equal(result.actor.role, 'viewer');
  const packet = { version: 1, type: 'update', documentId, clientId: 'viewer_artwork_001', requestId: randomUUID(), vector: engine.api.roomBinary(local.stateVector(), true), update: engine.api.roomBinary(local.update()) };
  const denied = await call(context.relay, context.viewer.credential, packet, false, { path: `/v1/rooms/${documentId}/sync` }); assert.equal(denied.status, 403); assert.equal(context.peer().graph.getNode(context.node).x, 12);
}));
test('owner/editor/viewer commands preserve immutable historical authors and enforce message/root ownership', () => fixture(async context => {
  const first = await add(context), threadId = first.result.threadId, rootId = first.result.messageId;
  const reply = await context.send(context.editor, { type: 'reply', threadId, body: 'Peer reply' });
  for (const grant of [context.owner, context.viewer]) await context.refused(grant, request(context.peer(), { type: 'edit', threadId, messageId: reply.result.messageId, body: 'Forged edit' }), 403);
  await context.refused(context.editor, request(context.peer(), { type: 'delete', threadId, messageId: rootId }), 403);
  await context.refused(context.owner, request(context.peer(), { type: 'move', threadId, pageId: context.page, anchor: anchor() }), 403);
  context.relay.store.db.prepare('UPDATE members SET name=? WHERE id=?').run('Renamed reader', context.viewer.actor.id);
  await context.send(context.viewer, { type: 'edit', threadId, messageId: rootId, body: 'Own edit' }); assert.equal(read(context.peer().graph)[0].messages[0].author.name, context.viewer.actor.name);
  await context.send(context.editor, { type: 'delete', threadId, messageId: reply.result.messageId }); assert.equal(read(context.peer().graph)[0].messages.length, 1);
  await context.send(context.viewer, { type: 'delete', threadId, messageId: rootId }); assert.deepEqual(read(context.peer().graph), []);
}));
test('viewer reactions/resolution/reopen affect only comment metadata and retain peer reactions', () => fixture(async context => {
  const first = await add(context), threadId = first.result.threadId, messageId = first.result.messageId;
  await context.send(context.viewer, { type: 'react', threadId, messageId, emoji: '👍' }); await context.send(context.editor, { type: 'react', threadId, messageId, emoji: '👍' }); await context.send(context.viewer, { type: 'react', threadId, messageId, emoji: '👍' });
  assert.deepEqual(read(context.peer().graph)[0].messages[0].reactions, [{ emoji: '👍', authors: [context.editor.actor.id] }]);
  await context.send(context.viewer, { type: 'resolve', threadId, resolved: true }); assert.deepEqual(read(context.peer().graph)[0].resolvedBy, { id: context.viewer.actor.id, name: context.viewer.actor.name });
  await context.send(context.editor, { type: 'resolve', threadId, resolved: false }); const thread = read(context.peer().graph)[0]; assert.equal(thread.resolved, false); assert.equal(thread.resolvedBy, undefined); assert.equal(thread.resolvedAt, undefined); assert.equal(context.peer().graph.getNode(context.node).x, 12);
}));
test('readers can move their pins across visible pages while stale/hidden/cross-page layer targets fail atomically', () => fixture(async context => {
  const first = await add(context), threadId = first.result.threadId;
  const source = context.peer(); let second, hidden;
  source.edit('Pages', graph => { second = graph.createNode('CANVAS', graph.rootId, { name: 'Other' }).id; hidden = graph.createNode('CANVAS', graph.rootId, { name: 'Internal', internalOnly: true }).id; });
  context.relay.store.exchange(context.owner.actor, { version: 1, type: 'update', documentId, clientId: 'page_creator_0001', requestId: randomUUID(), vector: engine.api.roomBinary(source.stateVector(), true), update: engine.api.roomBinary(source.update()) });
  for (const [pageId, target, status] of [[second, context.node, 409], [context.page, 'deleted_node', 409], [hidden, undefined, 404], ['missing_page', undefined, 404]]) await context.refused(context.viewer, request(context.peer(), { type: 'move', threadId, pageId, anchor: anchor(target) }), status);
  await context.send(context.viewer, { type: 'move', threadId, pageId: second, anchor: anchor() }); const threads = read(context.peer().graph); assert.equal(threads.length, 1); assert.equal(threads[0].ownerPageId, second); assert.equal(threads[0].messages[0].author.id, context.viewer.actor.id);
}));
test('lost creation/reply acknowledgements recover after restart without duplicate messages or historical name changes', () => fixture(async context => {
  const first = await add(context), reply = await context.send(context.viewer, { type: 'reply', threadId: first.result.threadId, body: 'Durable reply' }), before = context.snapshot();
  await context.restart(); context.relay.store.db.prepare('UPDATE members SET name=? WHERE id=?').run('Fresh label', context.viewer.actor.id);
  for (const accepted of [first, reply]) { const recovered = await context.send(context.viewer, accepted.outgoing.command, context.peer(), accepted.outgoing, true); assert.equal(recovered.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(recovered.result, accepted.result); assert.equal(recovered.actor.name, 'Fresh label'); }
  assert.deepEqual(context.snapshot(), before); assert.equal(read(context.peer().graph)[0].messages.length, 2); assert.equal(read(context.peer().graph)[0].messages[0].author.name, context.viewer.actor.name);
}));
test('reaction retry/recovery does not toggle twice; recovery never executes an unaccepted operation', () => fixture(async context => {
  const first = await add(context), command = { type: 'react', threadId: first.result.threadId, messageId: first.result.messageId, emoji: '❤️' }, accepted = await context.send(context.viewer, command), before = context.snapshot();
  await context.send(context.viewer, command, context.peer(), accepted.outgoing); await context.send(context.viewer, command, context.peer(), accepted.outgoing, true); assert.deepEqual(context.snapshot(), before); assert.equal(read(context.peer().graph)[0].messages[0].reactions[0].authors.length, 1);
  const missing = await context.refused(context.viewer, request(context.peer(), command), 404, true); assert.equal(missing.value.error, 'receipt-missing');
}));
test('receipts bind command/vector/member/client/document and conflict with reuse in the artwork receipt namespace', () => fixture(async context => {
  const first = await add(context);
  for (const patch of [{ command: { ...first.outgoing.command, body: 'Changed' } }, { vector: 'AA==' }]) await context.refused(context.viewer, { ...first.outgoing, ...patch }, 409, true);
  await context.refused(context.editor, first.outgoing, 404, true); await context.refused(context.viewer, { ...first.outgoing, clientId: 'other_client_0001' }, 404, true);
  await context.refused(context.viewer, { ...first.outgoing, documentId: 'other_document_001' }, 409);
  const source = context.peer(), packet = { version: 1, type: 'update', documentId, clientId: first.outgoing.clientId, requestId: first.outgoing.requestId, vector: engine.api.roomBinary(source.stateVector(), true), update: engine.api.roomBinary(source.update()) };
  assert.throws(() => context.relay.store.exchange(context.viewer.actor, packet), error => error.status === 409 && error.code === 'retry');
}));
test('accepted results remain recoverable after their thread is deleted and recovery never resurrects it', () => fixture(async context => {
  const first = await add(context); await context.send(context.viewer, { type: 'delete', threadId: first.result.threadId, messageId: first.result.messageId }); const before = context.snapshot();
  const recovered = await context.send(context.viewer, first.outgoing.command, context.peer(), first.outgoing, true); assert.deepEqual(recovered.result, first.result); assert.deepEqual(context.snapshot(), before); assert.deepEqual(read(context.peer().graph), []);
}));
test('current roles are returned and revocation during streamed body reading prevents mutation or recovery', () => fixture(async context => {
  const first = await add(context); context.relay.store.changeMember(documentId, context.owner.actor, context.editor.actor.id, 'viewer');
  const reply = await context.send(context.editor, { type: 'reply', threadId: first.result.threadId, body: 'Now viewer' }); assert.equal(reply.actor.role, 'viewer');
  const outgoing = request(context.peer(), { type: 'reply', threadId: first.result.threadId, body: 'Revoked mid-body' });
  const stream = Readable.from((async function* () { yield Buffer.from(JSON.stringify(outgoing)); context.relay.store.changeMember(documentId, context.owner.actor, context.viewer.actor.id, null); })());
  await context.refused(context.viewer, outgoing, 401, false, { stream }); await context.refused(context.viewer, first.outgoing, 401, true);
}));
test('malformed legacy member labels are preserved and cannot create an unreadable authenticated comment', () => fixture(async context => {
  const first = await add(context); context.relay.store.db.prepare('UPDATE members SET name=? WHERE id=?').run('\u0085', context.viewer.actor.id);
  await context.refused(context.viewer, request(context.peer(), { type: 'reply', threadId: first.result.threadId, body: 'Refused' }), 422); await context.refused(context.viewer, first.outgoing, 422, true);
  assert.equal(context.relay.store.db.prepare('SELECT name FROM members WHERE id=?').get(context.viewer.actor.id).name, '\u0085');
  context.relay.store.db.prepare('UPDATE members SET name=? WHERE id=?').run('🙂'.repeat(64), context.viewer.actor.id); const reply = await context.send(context.viewer, { type: 'reply', threadId: first.result.threadId, body: 'Valid emoji label' }); assert.equal(reply.actor.name.length, 128);
}));
test('receipt-write failure rolls back checkpoint/revision and exact retry can then complete once', () => fixture(async context => {
  const outgoing = request(context.peer(), { type: 'add', pageId: context.page, anchor: anchor(), body: 'Atomic' });
  context.relay.store.db.exec("CREATE TRIGGER fail_comment_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'fixture'); END;"); await context.refused(context.viewer, outgoing, 500); context.relay.store.db.exec('DROP TRIGGER fail_comment_receipt;');
  await context.refused(context.viewer, outgoing, 404, true); await context.send(context.viewer, outgoing.command, context.peer(), outgoing); assert.equal(read(context.peer().graph).length, 1);
}));
test('comment receipts survive artwork retention and its timestamp-independent pruning', () => fixture(async context => {
  const first = await add(context), db = context.relay.store.db;
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<4100) INSERT INTO receipts(room_id,member_id,client_id,request_id,digest,revision,created_at) SELECT '${documentId}','${context.owner.actor.id}','artwork_fixture_001','artwork_request_'||i,'fixture',1,9999999999999 FROM n;`);
  const peer = context.peer(); peer.edit('Artwork', graph => graph.updateNode(context.node, { x: 40 })); context.relay.store.exchange(context.owner.actor, { version: 1, type: 'update', documentId, clientId: 'artwork_fixture_001', requestId: randomUUID(), vector: engine.api.roomBinary(peer.stateVector(), true), update: engine.api.roomBinary(peer.update()) });
  assert.equal(db.prepare("SELECT count(*) AS n FROM receipts WHERE room_id=? AND digest NOT LIKE 'comment:%'").get(documentId).n, 4096); const recovered = await context.send(context.viewer, first.outgoing.command, context.peer(), first.outgoing, true); assert.equal(recovered.acceptedRevision, first.acceptedRevision);
}));
test('durable comment receipt capacity rejects new commands without deleting old idempotence evidence', () => fixture(async context => {
  const first = await add(context), db = context.relay.store.db, remaining = engine.api.COMMENT_RECEIPT_LIMIT - 1;
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${remaining}) INSERT INTO receipts(room_id,member_id,client_id,request_id,digest,revision,created_at) SELECT '${documentId}','${context.owner.actor.id}','capacity_fixture_01','capacity_request_'||i,'comment:fixture',1,0 FROM n;`);
  await context.refused(context.viewer, request(context.peer(), { type: 'reply', threadId: first.result.threadId, body: 'Full' }), 429);
  const recovered = await context.send(context.viewer, first.outgoing.command, context.peer(), first.outgoing, true); assert.equal(recovered.acceptedRevision, first.acceptedRevision); assert.equal(db.prepare("SELECT count(*) AS n FROM receipts WHERE digest LIKE 'comment:%'").get().n, engine.api.COMMENT_RECEIPT_LIMIT);
}));
test('closed handlers reject identity/time/artwork claims, unsafe methods, transfer overflow and foreign endpoints', () => fixture(async context => {
  const base = request(context.peer(), { type: 'add', pageId: context.page, anchor: anchor(), body: 'Safe' });
  for (const packet of [{ ...base, author: context.owner.actor }, { ...base, createdAt: 1 }, { ...base, update: 'AAA=' }, { ...base, command: { ...base.command, author: context.owner.actor } }, { ...base, command: { ...base.command, anchor: { ...anchor(), format: 'fig' } } }, { ...base, command: { ...base.command, body: '\ud800' } }]) await context.refused(context.viewer, packet, 422);
  await context.refused(context.viewer, base, 405, false, { method: 'GET' }); await context.refused(context.viewer, base, 413, false, { headers: { 'content-length': String(engine.api.COMMENT_REQUEST_LIMIT + 1) } });
  await context.refused(context.viewer, base, 413, false, { stream: Readable.from([Buffer.alloc(engine.api.COMMENT_REQUEST_LIMIT + 1)]) }); await context.refused(context.viewer, base, 422, false, { path: `/v1/rooms/${documentId}/comments?credential=unused` });
}));
test('independent database writers serialize authored replies without losing either actor', () => fixture(async context => {
  const first = await add(context), command = { type: 'reply', threadId: first.result.threadId, body: 'Concurrent' }, a = request(context.peer(), command), b = request(context.peer(), command, { clientId: 'second_comment_001' });
  const source = `const{parentPort,workerData}=require('node:worker_threads');(async()=>{const{roomEngine}=await import(workerData.engine);const{RoomStore}=await import(workerData.store);const engine=await roomEngine();const store=new RoomStore(workerData.database,engine.api,{grantSecret:workerData.grantSecret});try{parentPort.postMessage(store.comment(workerData.actor,workerData.packet));}finally{store.close();}})().catch(error=>{parentPort.postMessage({error:String(error)});});`;
  const run = (actor, packet) => new Promise((resolve, reject) => { const worker = new Worker(source, { eval: true, workerData: { engine: new URL('./xdesign-room-engine.mjs', import.meta.url).href, store: new URL('./xdesign-room-store.mjs', import.meta.url).href, database: context.database, grantSecret, actor, packet } }); let result; worker.on('message', value => { result = value; }); worker.on('error', reject); worker.on('exit', code => code === 0 && result && !result.error ? resolve(result) : reject(new Error(JSON.stringify(result ?? { code })))); });
  const settled = await Promise.allSettled([run(context.viewer.actor, a), run(context.editor.actor, b)]); settled.forEach(value => { assert.equal(value.status, 'fulfilled', String(value.reason)); assert.equal(value.value.type, 'comment'); }); const thread = read(context.peer().graph)[0]; assert.equal(thread.messages.length, 3); assert.deepEqual(new Set(thread.messages.slice(1).map(message => message.author.id)), new Set([context.viewer.actor.id, context.editor.actor.id]));
}));
test('missing messages, exhausted thread bounds and no-op resolution preserve artwork and accepted data', () => fixture(async context => {
  const first = await add(context), threadId = first.result.threadId;
  await context.refused(context.viewer, request(context.peer(), { type: 'edit', threadId, messageId: 'missing', body: 'No' }), 404); await context.refused(context.viewer, request(context.peer(), { type: 'reply', threadId: 'missing', body: 'No' }), 404);
  const before = context.snapshot(); const result = await context.send(context.viewer, { type: 'resolve', threadId, resolved: false }); assert.equal(result.revision, before.revision); assert.deepEqual(context.snapshot(), before);
  const source = context.peer(); source.edit('Fill thread', graph => { const page = graph.getNode(context.page), threads = JSON.parse(page.pluginData.find(entry => entry.pluginId === pluginId && entry.key === 'threads').value).threads; while (threads[0].messages.length < 100) threads[0].messages.push({ id: `legacy_${threads[0].messages.length}`, author: { id: context.owner.actor.id, name: context.owner.actor.name }, body: 'Legacy', createdAt: 1, reactions: [] }); graph.updateNode(page.id, { pluginData: [{ pluginId, key: 'threads', value: JSON.stringify({ version: 1, threads }) }] }); });
  context.relay.store.exchange(context.owner.actor, { version: 1, type: 'update', documentId, clientId: 'legacy_import_0001', requestId: randomUUID(), vector: engine.api.roomBinary(source.stateVector(), true), update: engine.api.roomBinary(source.update()) });
  await context.refused(context.viewer, request(context.peer(), { type: 'reply', threadId, body: 'Overflow' }), 422);
}));
