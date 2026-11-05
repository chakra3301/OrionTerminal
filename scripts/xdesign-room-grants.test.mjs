import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { SceneGraph } from '@open-pencil/scene-graph';
import { roomEngine } from './xdesign-room-engine.mjs';
import { createRoomRelay } from './xdesign-room-relay.mjs';
let engine;
const administrator = 'test-only-' + randomUUID(), documentId = 'room_document_000001', createId = 'create_request_00001', inviteId = 'invite_request_00001';
before(async () => { engine = await roomEngine(); });
after(async () => { if (process.env.XDESIGN_ROOM_GRANTS_EVIDENCE) await writeFile(process.env.XDESIGN_ROOM_GRANTS_EVIDENCE, JSON.stringify({ node: process.version, transport: 'in-process-node-stream-handler-no-sockets', bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, licenseAssets: engine.licenseAssets, warnings: engine.warnings }, null, 2) + '\n'); });
async function call(relay, path, credential, value, method = 'POST') {
  const request = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]); Object.assign(request, { method, url: path, headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, socket: { remoteAddress: 'grant-fixture' } });
  let status, data; const response = { destroyed: false, writeHead(code) { status = code; }, end(bytes) { data = JSON.parse(bytes); } }; await relay.handle(request, response); return { status, data };
}
const recoverPath = (kind, id, doc = documentId) => `/v1/rooms/${doc}/grants/${kind}/${id}`;
const membersPath = `/v1/rooms/${documentId}/members`;
async function fixture(work, durable = true) {
  const folder = await mkdtemp(join(tmpdir(), 'orion-grant-receipts-')), database = join(folder, 'rooms.sqlite'), graph = new SceneGraph(); graph.createNode('RECTANGLE', graph.getPages()[0].id, { name: 'Kept artwork' }); const replica = engine.api.SharedDesign.fromGraph(graph);
  const create = { version: 1, documentId, name: 'Room', ownerName: 'Owner', checkpoint: engine.api.roomBinary(replica.update()), ...(durable ? { requestId: createId } : {}) };
  let relay = await createRoomRelay({ database, adminSecret: administrator, engine });
  try {
    const first = await call(relay, '/v1/rooms', administrator, create); assert.equal(first.status, 201);
    const context = { database, replica, create, owner: first.data, get relay() { return relay; }, call: (...args) => call(relay, ...args), async restart(options = {}) { await relay.close(); relay = await createRoomRelay({ database, adminSecret: administrator, engine, ...options }); } }; await work(context);
  } finally { await relay.close(); replica.dispose(); await rm(folder, { recursive: true, force: true }); }
}
const invite = (context, fields = {}) => context.call(membersPath, context.owner.credential, { version: 1, name: 'Peer', role: 'viewer', requestId: inviteId, ...fields });
test('lost creation and invitation replies recover exact grants after restart without duplicate records', () => fixture(async context => {
  const first = await invite(context); assert.equal(first.status, 201); await context.restart();
  const created = await context.call('/v1/rooms', administrator, context.create); assert.equal(created.status, 201); assert.deepEqual(created.data, context.owner);
  const retried = await invite(context); assert.deepEqual(retried.data, first.data);
  const recovered = await context.call(recoverPath('invite', inviteId), context.owner.credential, undefined, 'GET'); assert.equal(recovered.status, 200); assert.deepEqual(recovered.data, first.data);
  assert.deepEqual((await context.call(recoverPath('create', createId), administrator, undefined, 'GET')).data, context.owner);
  assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM rooms').get().n, 1); assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM members').get().n, 2); assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM grant_receipts').get().n, 2);
}));
test('receipt identity binds immutable payloads and never retries a grant under changed fields', () => fixture(async context => {
  const first = await invite(context); assert.equal(first.status, 201);
  for (const fields of [{ name: 'Other' }, { role: 'editor' }]) assert.equal((await invite(context, fields)).status, 409);
  for (const fields of [{ name: 'Other room' }, { ownerName: 'Another owner' }, { requestId: 'another_create_0001' }]) assert.equal((await context.call('/v1/rooms', administrator, { ...context.create, ...fields })).status, 409);
  context.replica.edit('Changed source', graph => graph.createNode('ELLIPSE', graph.getPages()[0].id)); assert.equal((await context.call('/v1/rooms', administrator, { ...context.create, checkpoint: engine.api.roomBinary(context.replica.update()) })).status, 409);
  for (const requestId of [null, '', '../escape', 32]) assert.equal((await invite(context, { requestId })).status, 422);
  assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM members').get().n, 2);
}));
test('grant recovery reauthenticates authority and scopes room, kind and identity without creating records', () => fixture(async context => {
  const peer = (await invite(context)).data;
  assert.equal((await context.call(recoverPath('create', createId), context.owner.credential, undefined, 'GET')).status, 401);
  assert.equal((await context.call(recoverPath('invite', inviteId), peer.credential, undefined, 'GET')).status, 403);
  assert.equal((await context.call(recoverPath('invite', inviteId, 'another_document_001'), context.owner.credential, undefined, 'GET')).status, 401);
  assert.equal((await context.call(recoverPath('invite', 'missing_request_0001'), context.owner.credential, undefined, 'GET')).status, 404);
  assert.equal((await context.call(recoverPath('invite', inviteId), context.owner.credential, {})).status, 405);
  assert.equal((await context.call(recoverPath('invite', inviteId) + '?credential=bad', context.owner.credential, undefined, 'GET')).status, 422);
  assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM grant_receipts').get().n, 2);
}));
test('credentials are encrypted at rest and encryption binds every receipt scope field', () => fixture(async context => {
  const peer = (await invite(context)).data, db = context.relay.store.db, original = db.prepare("SELECT * FROM grant_receipts WHERE kind='invite'").get();
  assert.equal(original.nonce.byteLength, 12); assert.equal(original.tag.byteLength, 16); assert.ok(!Buffer.from(original.ciphertext).includes(Buffer.from(peer.credential)));
  for (const field of ['ciphertext', 'tag', 'nonce', 'digest']) {
    const altered = field === 'digest' ? 'changed' : Buffer.from(original[field]); if (field !== 'digest') altered[0] ^= 1; db.prepare(`UPDATE grant_receipts SET ${field}=? WHERE kind='invite'`).run(altered);
    assert.equal((await context.call(recoverPath('invite', inviteId), context.owner.credential, undefined, 'GET')).status, 500); assert.deepEqual(db.prepare(`SELECT ${field} FROM grant_receipts WHERE kind='invite'`).get()[field], field === 'digest' ? altered : new Uint8Array(altered)); db.prepare(`UPDATE grant_receipts SET ${field}=? WHERE kind='invite'`).run(original[field]);
  }
  assert.deepEqual((await context.call(recoverPath('invite', inviteId), context.owner.credential, undefined, 'GET')).data, peer);
  await context.relay.close(); const bytes = await readFile(context.database); for (const credential of [context.owner.credential, peer.credential]) { assert.ok(!bytes.includes(Buffer.from(credential))); assert.ok(!bytes.includes(Buffer.from(credential.split('.')[1]))); }
}));
test('changed and revoked grant recovery cannot silently restore old access', () => fixture(async context => {
  const peer = (await invite(context)).data, store = context.relay.store; store.changeMember(documentId, context.owner.actor, peer.actor.id, 'editor');
  assert.equal((await context.call(recoverPath('invite', inviteId), context.owner.credential, undefined, 'GET')).status, 409); assert.equal((await invite(context)).status, 409);
  store.changeMember(documentId, context.owner.actor, peer.actor.id, null); assert.equal((await context.call(recoverPath('invite', inviteId), context.owner.credential, undefined, 'GET')).status, 410); assert.equal((await invite(context)).status, 410); assert.equal(store.db.prepare('SELECT count(*) AS n FROM members').get().n, 2);
}));
test('failed receipt writes roll back membership and room creation in the same SQLite transaction', () => fixture(async context => {
  const db = context.relay.store.db; db.exec("CREATE TRIGGER reject_grant BEFORE INSERT ON grant_receipts BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;");
  assert.equal((await invite(context)).status, 500); assert.equal((await context.call('/v1/rooms', administrator, { ...context.create, documentId: 'another_document_001', requestId: 'another_create_0001' })).status, 500);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rooms').get().n, 1); assert.equal(db.prepare('SELECT count(*) AS n FROM members').get().n, 1); assert.equal(db.prepare('SELECT count(*) AS n FROM grant_receipts').get().n, 1);
  db.exec('DROP TRIGGER reject_grant'); assert.equal((await invite(context)).status, 201);
}));
test('mismatched encryption secrets refuse startup and preserve the original database', () => fixture(async context => {
  await invite(context); await context.relay.close(); const before = await readFile(context.database); await assert.rejects(context.restart({ grantSecret: 'different-stable-' + randomUUID() }), /does not match/); assert.ok(before.equals(await readFile(context.database)));
  await context.restart(); assert.equal((await context.call(recoverPath('create', createId), administrator, undefined, 'GET')).status, 200);
}));
test('known version-one databases append receipt storage while preserving exact old rows and rollback failed upgrades', () => fixture(async context => {
  const db = context.relay.store.db; db.exec("DROP TABLE room_images;DROP TABLE room_image_revisions;DROP TABLE room_image_chunks;DROP TABLE room_image_uploads;DROP TABLE room_library_receipts;DROP TABLE room_library_revisions;DROP TABLE room_libraries;DROP TABLE comment_author_receipts;DROP TABLE comment_authors;DROP TABLE comment_fields; DROP TABLE comment_history; DROP TABLE grant_receipts; UPDATE room_meta SET value='1' WHERE key='version'"); const rooms = db.prepare('SELECT * FROM rooms').all(), members = db.prepare('SELECT * FROM members').all();
  db.exec("CREATE TRIGGER reject_upgrade BEFORE UPDATE ON room_meta WHEN NEW.value='2' BEGIN SELECT RAISE(ABORT,'injected upgrade failure'); END;"); await context.relay.close(); const before = await readFile(context.database); await assert.rejects(context.restart(), /upgrade failure/); assert.ok(before.equals(await readFile(context.database)));
  const { DatabaseSync } = await import('node:sqlite'); const repair = new DatabaseSync(context.database); assert.equal(repair.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='grant_receipts'").get().n, 0); repair.exec('DROP TRIGGER reject_upgrade'); repair.close(); await context.restart();
  assert.deepEqual(context.relay.store.db.prepare('SELECT * FROM rooms').all(), rooms); assert.deepEqual(context.relay.store.db.prepare('SELECT * FROM members').all(), members); assert.equal(context.relay.store.db.prepare("SELECT value FROM room_meta WHERE key='version'").get().value, '6'); assert.equal((await invite(context)).status, 201);
}, false));
test('independent writers retry the same invite without producing a second capability', () => fixture(async context => {
  const workers = Array.from({ length: 2 }, () => new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const{roomEngine}=await import(workerData.engine);const{RoomStore}=await import(workerData.store);const engine=await roomEngine(),store=new RoomStore(workerData.database,engine.api,{grantSecret:workerData.secret});parentPort.postMessage({ready:true});parentPort.once('message',()=>{try{parentPort.postMessage({grant:store.invite(workerData.documentId,workerData.actor,'Peer','viewer',workerData.requestId)});}catch(error){parentPort.postMessage({error:error.message});}finally{store.close();parentPort.close();}});})().catch(error=>{parentPort.postMessage({error:error.message});parentPort.close();});`, { eval: true, workerData: { engine: new URL('./xdesign-room-engine.mjs', import.meta.url).href, store: new URL('./xdesign-room-store.mjs', import.meta.url).href, database: context.database, secret: administrator, documentId, actor: context.owner.actor, requestId: inviteId } }));
  try {
    await Promise.all(workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', value => value.ready ? resolve() : reject(new Error(value.error))); })));
    const replies = workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', value => value.grant ? resolve(value.grant) : reject(new Error(value.error))); })); workers.forEach(worker => worker.postMessage('go')); const [a, b] = await Promise.all(replies); assert.deepEqual(a, b); assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM members').get().n, 2);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}));
test('handler response loss retains a recoverable committed invitation', () => fixture(async context => {
  const request = Readable.from([Buffer.from(JSON.stringify({ version: 1, name: 'Peer', role: 'viewer', requestId: inviteId }))]); Object.assign(request, { method: 'POST', url: membersPath, headers: { authorization: `Bearer ${context.owner.credential}`, 'content-type': 'application/json' }, socket: { remoteAddress: 'lost-response-fixture' } });
  const response = { destroyed: false, writeHead() {}, end() { this.destroyed = true; throw new Error('Response lost'); } }; await context.relay.handle(request, response);
  const recovered = await context.call(recoverPath('invite', inviteId), context.owner.credential, undefined, 'GET'); assert.equal(recovered.status, 200); assert.equal(recovered.data.actor.role, 'viewer'); assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM members').get().n, 2);
}));
test('receipt retries and recovery remain available after membership capacity is reached', () => fixture(async context => {
  const peer = (await invite(context)).data, store = context.relay.store; for (let index = 0; index < 62; index++) store.invite(documentId, context.owner.actor, 'Peer ' + index, 'editor');
  assert.deepEqual((await invite(context)).data, peer); assert.equal((await invite(context, { requestId: 'extra_request_00001' })).status, 413); assert.deepEqual((await context.call(recoverPath('invite', inviteId), context.owner.credential, undefined, 'GET')).data, peer); assert.equal(store.db.prepare('SELECT count(*) AS n FROM grant_receipts').get().n, 2);
}));
