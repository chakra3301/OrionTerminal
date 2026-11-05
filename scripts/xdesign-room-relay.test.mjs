import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { SceneGraph } from '@open-pencil/scene-graph';
import { roomEngine } from './xdesign-room-engine.mjs';
import { RoomStore } from './xdesign-room-store.mjs';
import { createRoomRelay } from './xdesign-room-relay.mjs';

let engine;
const administrator = 'test-only-' + randomUUID(), documentId = 'room_document_000001';
const liveHTTP = process.env.XDESIGN_ROOM_HTTP_ACCEPTANCE === '1';
before(async () => { engine = await roomEngine(); });
after(async () => {
  if (engine && process.env.XDESIGN_ROOM_EVIDENCE) await writeFile(process.env.XDESIGN_ROOM_EVIDENCE, JSON.stringify({ node: process.version, transport: liveHTTP ? 'live-loopback-http' : 'in-process-node-stream-handler', bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, licenseAssets: engine.licenseAssets, warnings: engine.warnings }, null, 2) + '\n');
});
function seed() {
  const graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0].id, { name: 'Original', x: 10, y: 20, width: 100, height: 80 });
  return { replica: engine.api.SharedDesign.fromGraph(graph), node: node.id };
}
function packet(replica, type = 'sync', fields = {}) {
  return { version: 1, documentId, clientId: 'client_identity_0001', requestId: randomUUID(), type, vector: engine.api.roomBinary(replica.stateVector(), true), ...(type === 'update' ? { update: engine.api.roomBinary(replica.update()) } : {}), ...fields };
}
async function dispatch(relay, path, headers, stream, method = 'POST') {
  Object.assign(stream, { method, url: path, headers, socket: { remoteAddress: 'unit-fixture' } });
  let status, capturedHeaders, value;
  const response = { destroyed: false, writeHead(code, fields) { status = code; capturedHeaders = new Headers(fields); }, end(bytes) { value = JSON.parse(bytes); } };
  await relay.handle(stream, response); return { status, value, headers: capturedHeaders };
}
async function call(url, path, credential, value, method = 'POST', extraHeaders = {}) {
  const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json', ...extraHeaders };
  if (typeof url !== 'string') return dispatch(url, path, headers, Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]), method);
  const result = await fetch(url + path, { method, headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(10_000) });
  return { status: result.status, value: await result.json(), headers: result.headers };
}
const syncPath = `/v1/rooms/${documentId}/sync`, membersPath = `/v1/rooms/${documentId}/members`;
async function fixture(work) {
  const folder = await mkdtemp(join(tmpdir(), 'orion-xdesign-room-')), database = join(folder, 'rooms.sqlite'), peers = [];
  let relay;
  const own = replica => { peers.push(replica); return replica; };
  try {
    relay = await createRoomRelay({ database, adminSecret: administrator, engine });
    let url = liveHTTP ? await relay.listen() : relay;
    const data = seed(), source = own(data.replica);
    const create = await call(url, '/v1/rooms', administrator, { version: 1, documentId, name: 'Team design', ownerName: 'Owner', checkpoint: engine.api.roomBinary(source.update()) });
    assert.equal(create.status, 201);
    const owner = create.value;
    await work({ relay, url, database, folder, source, node: data.node, owner, own, async restart() {
      await relay.close(); relay = await createRoomRelay({ database, adminSecret: administrator, engine }); url = liveHTTP ? await relay.listen() : relay; return { relay, url };
    } });
  } finally {
    peers.forEach(peer => peer.dispose()); await relay?.close(); await rm(folder, { recursive: true, force: true });
  }
}
async function invite(context, role = 'editor', name = 'Peer') {
  const result = await call(context.url, membersPath, context.owner.credential, { version: 1, role, name });
  assert.equal(result.status, 201); return result.value;
}
async function deliver(context, peer, credential, outgoing = packet(peer)) {
  const result = await call(context.url, syncPath, credential, outgoing); assert.equal(result.status, 200);
  const parsed = engine.api.readRoomResponse(result.value, outgoing); peer.receive(parsed.update); return parsed.packet;
}

test('actual engine bundle excludes desktop persistence and editor action surfaces', () => {
  assert.ok(Object.keys(engine.inputs).length > 100);
  assert.ok(!Object.keys(engine.inputs).some(path => /pencil\/(runtime|sharedEditor|toolExecution)\.ts|xdesign\/store\.ts/.test(path)));
  assert.equal(typeof engine.api.readRoomRequest, 'function'); assert.equal(typeof engine.api.validateSharedDocumentId, 'function');
  assert.ok(engine.notices.every(notice => notice.files.length)); assert.deepEqual(engine.api.roomNotices, engine.notices);
  assert.ok(engine.notices.some(notice => notice.name === 'yjs')); assert.ok(engine.notices.some(notice => notice.name === 'ulid'));
});
test('administrator creation, capability hashing and room-scoped principals are enforced', () => fixture(async context => {
  const { url, relay, owner, source } = context;
  const denied = await call(url, '/v1/rooms', 'invalid', { version: 1 }); assert.equal(denied.status, 401);
  assert.equal(relay.store.db.prepare('SELECT count(*) AS n FROM rooms').get().n, 1);
  const duplicate = await call(url, '/v1/rooms', administrator, { version: 1, documentId, name: 'Another', ownerName: 'Other', checkpoint: engine.api.roomBinary(source.update()) }); assert.equal(duplicate.status, 409);
  const stored = relay.store.db.prepare('SELECT secret_hash FROM members WHERE id=?').get(owner.actor.id);
  assert.equal((await stat(context.database)).mode & 0o777, 0o600);
  assert.ok(Buffer.from(stored.secret_hash).equals(createHash('sha256').update(owner.credential.split('.')[1]).digest()));
  const wrongRoom = await call(url, '/v1/rooms/other_document_0001/sync', owner.credential, packet(source, 'sync', { documentId: 'other_document_0001' })); assert.equal(wrongRoom.status, 401);
  const wrongBody = await call(url, syncPath, owner.credential, packet(source, 'sync', { documentId: 'other_document_0001' })); assert.equal(wrongBody.status, 409);
  const viewer = await invite(context, 'viewer');
  const reply = await deliver(context, source, viewer.credential); assert.equal(reply.actor.role, 'viewer'); assert.equal(reply.actor.name, 'Peer');
  const members = await call(url, membersPath, owner.credential, undefined, 'GET'); assert.equal(members.status, 200);
  assert.ok(members.value.members.every(actor => !('credential' in actor) && !('secret_hash' in actor)));
  assert.equal((await call(url, membersPath, viewer.credential, undefined, 'GET')).status, 403);
}));
test('offline peer changes converge through the room handler and selective undo retains the peer edit', () => fixture(async context => {
  const a = context.source, b = context.own(engine.api.SharedDesign.fromUpdate(a.update())), editor = await invite(context);
  a.edit('Horizontal move', graph => graph.updateNode(context.node, { x: 240 }));
  b.edit('Resize peer', graph => graph.updateNode(context.node, { width: 320 }));
  await deliver(context, a, context.owner.credential, packet(a, 'update'));
  await deliver(context, b, editor.credential, packet(b, 'update', { clientId: 'second_client_00001' }));
  await deliver(context, a, context.owner.credential);
  assert.equal(a.graph.getNode(context.node).x, 240); assert.equal(a.graph.getNode(context.node).width, 320);
  assert.deepEqual(a.graph.getNode(context.node), b.graph.getNode(context.node));
  a.undo(); await deliver(context, a, context.owner.credential, packet(a, 'update')); await deliver(context, b, editor.credential);
  assert.equal(b.graph.getNode(context.node).x, 10); assert.equal(b.graph.getNode(context.node).width, 320);
}));
test('lost acknowledgements retry durably across restart without duplicating the revision', () => fixture(async context => {
  context.source.edit('Move', graph => graph.updateNode(context.node, { x: 400 })); const outgoing = packet(context.source, 'update');
  const first = await call(context.url, syncPath, context.owner.credential, outgoing); assert.equal(first.status, 200);
  const restarted = await context.restart();
  const retried = await call(restarted.url, syncPath, context.owner.credential, outgoing); assert.equal(retried.status, 200);
  assert.equal(retried.value.acceptedRevision, first.value.acceptedRevision); assert.equal(retried.value.revision, first.value.revision);
  assert.equal(restarted.relay.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 1);
  const changed = await call(restarted.url, syncPath, context.owner.credential, { ...outgoing, vector: 'AA==' }); assert.equal(changed.status, 409);
  const reader = context.own(engine.api.SharedDesign.fromUpdate(context.source.update()));
  reader.edit('Offline branch', graph => graph.updateNode(context.node, { y: 70 }));
  await deliver({ ...context, ...restarted }, reader, context.owner.credential, packet(reader, 'update')); assert.equal(reader.graph.getNode(context.node).x, 400);
}));
test('the most recent retry receipt survives retention when older timestamps lie ahead of the clock', () => fixture(async context => {
  const store = context.relay.store, insert = store.db.prepare('INSERT INTO receipts(room_id,member_id,client_id,request_id,digest,revision,created_at) VALUES(?,?,?,?,?,1,?)');
  store.transaction(() => { for (let i = 0; i < 4096; i++) insert.run(documentId, context.owner.actor.id, 'earlier_client_0001', 'earlier_request_' + String(i).padStart(6, '0'), 'old', Date.now() + 1000000); });
  context.source.edit('Latest', graph => graph.updateNode(context.node, { x: 56 })); const outgoing = packet(context.source, 'update');
  await deliver(context, context.source, context.owner.credential, outgoing);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 4096);
  assert.equal((await call(context.url, syncPath, context.owner.credential, { ...outgoing, vector: 'AA==' })).status, 409);
}));
test('viewer denial, role changes and revocation preserve already accepted retry receipts', () => fixture(async context => {
  const editor = await invite(context), a = context.source;
  a.edit('Move', graph => graph.updateNode(context.node, { x: 25 })); const outgoing = packet(a, 'update');
  const accepted = await deliver(context, a, editor.credential, outgoing);
  assert.equal((await call(context.url, membersPath + '/' + editor.actor.id, context.owner.credential, { version: 1, role: 'viewer' }, 'PATCH')).status, 200);
  const retry = await deliver(context, a, editor.credential, outgoing); assert.equal(retry.acceptedRevision, accepted.acceptedRevision); assert.equal(retry.actor.role, 'viewer');
  a.edit('Denied edit', graph => graph.updateNode(context.node, { x: 900 }));
  assert.equal((await call(context.url, syncPath, editor.credential, packet(a, 'update'))).status, 403);
  assert.equal((await call(context.url, membersPath + '/' + context.owner.actor.id, context.owner.credential, undefined, 'DELETE')).status, 403);
  assert.equal((await call(context.url, membersPath + '/' + editor.actor.id, context.owner.credential, undefined, 'DELETE')).status, 200);
  assert.equal((await call(context.url, syncPath, editor.credential, outgoing)).status, 401);
  const saved = engine.api.SharedDesign.fromUpdate(context.relay.store.db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint);
  try { assert.equal(saved.graph.getNode(context.node).x, 25); } finally { saved.dispose(); }
}));
test('invalid or spoofed packets cannot leave a checkpoint or receipt behind', () => fixture(async context => {
  const before = context.relay.store.db.prepare('SELECT checkpoint,revision FROM rooms WHERE id=?').get(documentId);
  context.source.edit('Not accepted', graph => graph.updateNode(context.node, { x: 88 })); const outgoing = packet(context.source, 'update');
  for (const fields of [{ version: 2 }, { actor: context.owner.actor }, { vector: 'AAA=' }, { vector: 'AQ==' }, { update: 'AQE=' }, { update: 'AAB=' }]) {
    assert.equal((await call(context.url, syncPath, context.owner.credential, { ...outgoing, ...fields })).status, 422);
  }
  const current = context.relay.store.db.prepare('SELECT checkpoint,revision FROM rooms WHERE id=?').get(documentId);
  assert.deepEqual(current, before); assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
}));
test('storage failure rolls back checkpoint and receipt together, then permits the exact retry', () => fixture(async context => {
  const db = context.relay.store.db, before = db.prepare('SELECT checkpoint,revision FROM rooms WHERE id=?').get(documentId);
  context.source.edit('Move', graph => graph.updateNode(context.node, { y: 640 })); const outgoing = packet(context.source, 'update');
  db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'injected storage failure'); END;");
  const failed = await call(context.url, syncPath, context.owner.credential, outgoing); assert.equal(failed.status, 500); assert.equal(failed.value.error, 'storage');
  assert.deepEqual(db.prepare('SELECT checkpoint,revision FROM rooms WHERE id=?').get(documentId), before); assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
  db.exec('DROP TRIGGER reject_receipt');
  const retry = await deliver(context, context.source, context.owner.credential, outgoing); assert.equal(retry.revision, before.revision + 1);
}));
test('failed initial owner creation leaves no partial room and can be retried', () => fixture(async context => {
  const db = context.relay.store.db, value = { version: 1, documentId: 'another_room_0000001', name: 'New room', ownerName: 'New owner', checkpoint: engine.api.roomBinary(context.source.update()) };
  db.exec("CREATE TRIGGER reject_owner BEFORE INSERT ON members BEGIN SELECT RAISE(ABORT,'injected owner failure'); END;");
  assert.equal((await call(context.url, '/v1/rooms', administrator, value)).status, 500);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rooms').get().n, 1); assert.equal(db.prepare('SELECT count(*) AS n FROM members').get().n, 1);
  db.exec('DROP TRIGGER reject_owner'); assert.equal((await call(context.url, '/v1/rooms', administrator, value)).status, 201);
}));
test('incomplete causal updates cannot receive a durable acknowledgement before missing edits arrive', () => fixture(async context => {
  let created;
  context.source.edit('First', graph => { created = graph.createNode('RECTANGLE', graph.getPages()[0].id, { x: 42 }).id; });
  const second = context.source.edit('Second', graph => graph.updateNode(created, { x: 84 }));
  const outgoing = packet(context.source, 'update', { update: engine.api.roomBinary(second.update) });
  const denied = await call(context.url, syncPath, context.owner.credential, outgoing); assert.equal(denied.status, 409); assert.equal(denied.value.error, 'dependencies');
  assert.equal(context.relay.store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(documentId).revision, 1);
  assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
  await deliver(context, context.source, context.owner.credential, packet(context.source, 'update'));
  const accepted = await deliver(context, context.source, context.owner.credential, outgoing); assert.equal(accepted.revision, 2);
  assert.equal(context.source.graph.getNode(created).x, 84);
}));
test('deleted layers survive durable reopening and an older peer resynchronizes without resurrection', () => fixture(async context => {
  const older = context.own(engine.api.SharedDesign.fromUpdate(context.source.update()));
  context.source.edit('Delete', graph => graph.deleteNode(context.node)); await deliver(context, context.source, context.owner.credential, packet(context.source, 'update'));
  const restarted = await context.restart(); await deliver({ ...context, ...restarted }, older, context.owner.credential);
  assert.equal(older.graph.getNode(context.node), undefined);
  await deliver({ ...context, ...restarted }, older, context.owner.credential, packet(older, 'update'));
  assert.equal(restarted.relay.store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(documentId).revision, 2);
}));
test('deletion-only updates persist and resynchronize even when the state vector is unchanged', () => fixture(async context => {
  context.source.edit('Add image', graph => graph.images.set('shared-image', new Uint8Array([1, 2, 3, 4])));
  await deliver(context, context.source, context.owner.credential, packet(context.source, 'update'));
  const older = context.own(engine.api.SharedDesign.fromUpdate(context.source.update())), vector = context.source.stateVector();
  context.source.edit('Delete image', graph => graph.images.delete('shared-image'));
  assert.deepEqual(context.source.stateVector(), vector);
  const ack = await deliver(context, context.source, context.owner.credential, packet(context.source, 'update')); assert.equal(ack.revision, 3);
  const restarted = await context.restart(); await deliver({ ...context, ...restarted }, older, context.owner.credential);
  assert.equal(older.graph.images.has('shared-image'), false); assert.deepEqual(older.stateVector(), vector);
}));
test('membership revoked while the body arrives is rechecked before any mutation', () => fixture(async context => {
  const editor = await invite(context); context.source.edit('Late update', graph => graph.updateNode(context.node, { x: 500 }));
  const bytes = JSON.stringify(packet(context.source, 'update'));
  if (!liveHTTP) {
    const stream = new Readable({ read() {} }); stream.push(Buffer.from(bytes.slice(0, 10)));
    const handling = dispatch(context.relay, syncPath, { authorization: `Bearer ${editor.credential}`, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bytes)) }, stream);
    context.relay.store.changeMember(documentId, context.owner.actor, editor.actor.id, null); stream.push(Buffer.from(bytes.slice(10))); stream.push(null);
    assert.equal((await handling).status, 401); assert.equal(context.relay.store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(documentId).revision, 1); return;
  }
  let started; const beginning = new Promise(resolve => { started = resolve; }); context.relay.server.once('request', started);
  let send;
  const result = new Promise((resolve, reject) => {
    send = httpRequest(context.url + syncPath, { method: 'POST', headers: { Authorization: `Bearer ${editor.credential}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }); send.on('error', reject); send.write(bytes.slice(0, 10));
  });
  await beginning; context.relay.store.changeMember(documentId, context.owner.actor, editor.actor.id, null); send.end(bytes.slice(10));
  assert.equal(await result, 401); assert.equal(context.relay.store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(documentId).revision, 1);
}));
test('unsupported databases and damaged checkpoints are refused without replacing their data', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'orion-room-refusal-'));
  try {
    const path = join(folder, 'foreign.sqlite'), db = new DatabaseSync(path); db.exec("CREATE TABLE owner_data(value TEXT); INSERT INTO owner_data VALUES('keep');"); db.close();
    const before = await readFile(path); assert.throws(() => new RoomStore(path, engine.api), /preserved/); assert.ok(before.equals(await readFile(path)));
    const future = join(folder, 'future.sqlite'), store = new RoomStore(future, engine.api); store.db.exec("UPDATE room_meta SET value='7' WHERE key='version'"); store.close();
    const futureBytes = await readFile(future); assert.throws(() => new RoomStore(future, engine.api), /preserved/); assert.ok(futureBytes.equals(await readFile(future)));
  } finally { await rm(folder, { recursive: true, force: true }); }
  await fixture(async context => {
    const db = context.relay.store.db; db.prepare('UPDATE rooms SET checkpoint=? WHERE id=?').run(new Uint8Array([1, 2]), documentId);
    const damaged = db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint;
    assert.equal((await call(context.url, syncPath, context.owner.credential, packet(context.source))).status, 500);
    assert.deepEqual(db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint, damaged);
    db.prepare('UPDATE rooms SET digest=? WHERE id=?').run(createHash('sha256').update(damaged).digest('hex'), documentId);
    assert.equal((await call(context.url, syncPath, context.owner.credential, packet(context.source))).status, 500);
    assert.deepEqual(db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint, damaged);
  });
});
test('HTTP transfer and service boundaries refuse query credentials, compression and extra fields', () => fixture(async context => {
  const { url, source, owner } = context;
  assert.equal((await call(url, syncPath + '?credential=not-a-secret', owner.credential, packet(source))).status, 422);
  assert.equal((await call(url, membersPath, owner.credential, { version: 1, name: 'Person', role: 'editor', admin: true })).status, 422);
  const result = await call(url, syncPath, owner.credential, {}, 'POST', { 'content-encoding': 'gzip' }); assert.equal(result.status, 415);
  if (!liveHTTP) {
    const oversized = await dispatch(context.relay, syncPath, { authorization: `Bearer ${owner.credential}`, 'content-type': 'application/json', 'content-length': String(46 * 1024 * 1024 + 1) }, Readable.from([])); assert.equal(oversized.status, 413);
  }
  assert.throws(() => context.relay.listen(0, '0.0.0.0'), /loopback/);
  const good = await call(url, syncPath, owner.credential, packet(source)); assert.equal(good.headers.get('cache-control'), 'no-store');
}));
test('room and member admission limits reject new records without disturbing accepted data', () => fixture(async context => {
  const store = context.relay.store, checkpoint = context.source.update();
  for (let i = 0; i < 63; i++) store.invite(documentId, context.owner.actor, 'Peer ' + i, 'editor');
  assert.throws(() => store.invite(documentId, context.owner.actor, 'Extra peer', 'editor'), error => error.status === 413);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM members WHERE room_id=?').get(documentId).n, 64);
  for (let i = 1; i < 128; i++) store.create('capacity_room_' + String(i).padStart(6, '0'), 'Room ' + i, 'Owner', checkpoint);
  assert.throws(() => store.create('capacity_room_extra', 'Extra', 'Owner', checkpoint), error => error.status === 413);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM rooms').get().n, 128);
  assert.equal(store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(documentId).revision, 1);
}));

test('independent SQLite writers serialize concurrent offline changes instead of overwriting either peer', () => fixture(async context => {
  const other = context.own(engine.api.SharedDesign.fromUpdate(context.source.update()));
  context.source.edit('X', graph => graph.updateNode(context.node, { x: 88 })); other.edit('Y', graph => graph.updateNode(context.node, { y: 99 }));
  const workers = [packet(context.source, 'update'), packet(other, 'update', { clientId: 'second_client_00001' })].map(outgoing => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { roomEngine } = await import(workerData.engine);
      const { RoomStore } = await import(workerData.store);
      const engine = await roomEngine(), store = new RoomStore(workerData.database, engine.api);
      parentPort.postMessage({ ready: true });
      parentPort.once('message', () => {
        try { const actor = store.authorize(workerData.packet.documentId, workerData.credential); const result = store.exchange(actor, workerData.packet); parentPort.postMessage({ revision: result.revision }); }
        catch (error) { parentPort.postMessage({ error: error.code ?? error.name }); }
        finally { store.close(); parentPort.close(); }
      });
    })().catch(error => { parentPort.postMessage({ error: error.code ?? error.name }); parentPort.close(); });
  `, { eval: true, workerData: { engine: new URL('./xdesign-room-engine.mjs', import.meta.url).href, store: new URL('./xdesign-room-store.mjs', import.meta.url).href, database: context.database, packet: outgoing, credential: context.owner.credential } }));
  try {
    await Promise.all(workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', value => value.ready ? resolve() : reject(new Error(value.error))); })));
    const replies = workers.map(worker => new Promise((resolve, reject) => { worker.once('message', value => value.error ? reject(new Error(value.error)) : resolve(value)); worker.once('error', reject); }));
    workers.forEach(worker => worker.postMessage('go')); await Promise.all(replies);
    const reader = context.own(engine.api.SharedDesign.fromUpdate(context.source.update())); await deliver(context, reader, context.owner.credential);
    assert.equal(reader.graph.getNode(context.node).x, 88); assert.equal(reader.graph.getNode(context.node).y, 99);
    assert.equal(context.relay.store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(documentId).revision, 3);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}));
