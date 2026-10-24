import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { SceneGraph } from '@open-pencil/scene-graph';
import { createLibraryRevision } from '@open-pencil/core/library';
import { roomEngine } from './xdesign-room-engine.mjs';
import { createRoomRelay } from './xdesign-room-relay.mjs';

let engine;
const documentId = 'library_document_001', administrator = 'library-administrator-'.repeat(3), base = `/v1/rooms/${documentId}/libraries`;
before(async () => { engine = await roomEngine(); });
after(async () => { if (engine && process.env.XDESIGN_LIBRARY_EVIDENCE) await writeFile(process.env.XDESIGN_LIBRARY_EVIDENCE, JSON.stringify({ node: process.version, bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, licenseAssets: engine.licenseAssets, warnings: engine.warnings, transport: 'actual-compiled-engine-node-streams-temporary-sqlite-no-sockets' }, null, 2) + '\n'); });
async function fixture(work) {
  const folder = await mkdtemp(join(tmpdir(), 'xdesign-team-library-')), database = join(folder, 'rooms.sqlite');
  let relay = await createRoomRelay({ database, adminSecret: administrator, engine });
  const graph = new SceneGraph(), seed = engine.api.SharedDesign.fromGraph(graph);
  const owner = relay.store.create(documentId, 'Design', 'Owner', seed.update()), editor = relay.store.invite(documentId, owner.actor, 'Creator', 'editor'), other = relay.store.invite(documentId, owner.actor, 'Peer', 'editor'), viewer = relay.store.invite(documentId, owner.actor, 'Viewer', 'viewer');
  const source = new SceneGraph(), component = source.createNode('COMPONENT', source.getPages()[0].id, { name: 'Component 🙂', componentKey: 'asset:main', width: 100, height: 40 });
  source.createNode('TEXT', component.id, { text: 'Original 🙂', width: 80, height: 20 }); let width = 100;
  const bundle = async (previousRevisionId = null, libraryId = 'library:original') => { source.updateNode(component.id, { width: ++width }); const revision = await createLibraryRevision({ libraryId, name: 'Team library 🙂', description: 'Original description', graph: source, assetNodeIds: [component.id], previousRevisionId, publishedAt: '2026-10-11T12:00:00.000Z' }); return engine.api.prepareRoomLibraryBundle(revision); };
  const request = async (...args) => ({ version: 1, requestId: randomUUID(), bundle: await bundle(...args) });
  const call = async (grant = editor, value, path = base, method = value === undefined ? 'GET' : 'POST', headers = {}) => {
    const stream = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]); Object.assign(stream, { method, url: path, headers: { authorization: `Bearer ${grant.credential}`, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: randomUUID() } }); let status, data;
    await relay.handle(stream, { destroyed: false, writeHead(code) { status = code; }, end(bytes) { data = JSON.parse(bytes); } }); return { status, data };
  };
  const state = () => Object.fromEntries(['rooms', 'members', 'receipts', 'grant_receipts', 'comment_history', 'comment_fields', 'comment_authors', 'comment_author_receipts', 'room_libraries', 'room_library_revisions', 'room_library_receipts'].map(table => [table, relay.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const refused = async (work, status) => { const original = state(), result = await work(); assert.equal(result.status, status, JSON.stringify(result)); assert.deepEqual(state(), original); return result; };
  const publish = async (packet = undefined, grant = editor) => { packet ??= await request(); const result = await call(grant, packet); assert.equal(result.status, 200, JSON.stringify(result)); return { packet, response: result.data }; };
  const revision = (grant, libraryId = 'library:original', revisionId = null) => call(grant, { version: 1, libraryId, revisionId }, base + '/revision');
  try { await work({ get relay() { return relay; }, database, owner, editor, other, viewer, source, component, request, call, state, refused, publish, revision, async restart() { await relay.close(); relay = await createRoomRelay({ database, adminSecret: administrator, engine }); } }); }
  finally { seed.dispose(); await relay.close(); await rm(folder, { recursive: true, force: true }); }
}
test('creator publication is member-readable and carries immutable graph resources without modifying room artwork', () => fixture(async c => {
  const original = c.state(), { packet, response } = await c.publish(); const decoded = engine.api.readRoomLibraryPublication(response, documentId, packet.requestId);
  assert.equal(decoded.publication.ownerId, c.editor.actor.id); assert.deepEqual(decoded.publication.publisher, { id: c.editor.actor.id, name: 'Creator' }); assert.deepEqual(c.state().rooms, original.rooms); assert.deepEqual(c.state().receipts, original.receipts);
  for (const grant of [c.owner, c.editor, c.other, c.viewer]) {
    const catalog = await c.call(grant); assert.equal(catalog.status, 200); assert.equal(engine.api.readRoomLibraryCatalog(catalog.data, documentId).libraries[0].revisionId, packet.bundle.manifest.revisionId);
    const read = await c.revision(grant), revision = await engine.api.readRoomLibraryRevision(read.data, documentId, 'library:original', null); assert.equal(read.status, 200); assert.deepEqual(revision.bundle, packet.bundle); assert.equal(revision.revision.graph.getNode(packet.bundle.manifest.assets[0].sourceNodeId).name, 'Component 🙂');
  }
}));
test('viewers cannot publish and peer editors cannot replace another creator, while owners can publish reviewed successors', () => fixture(async c => {
  const first = await c.publish(), next = await c.request(first.packet.bundle.manifest.revisionId);
  await c.refused(() => c.call(c.viewer, next), 403); await c.refused(() => c.call(c.other, next), 403);
  const second = await c.publish(next, c.owner); assert.equal(second.response.publication.ownerId, c.editor.actor.id); assert.equal(second.response.publication.publisher.id, c.owner.actor.id); assert.equal(second.response.publication.step, 2);
  const historic = await c.revision(c.viewer, 'library:original', first.packet.bundle.manifest.revisionId); assert.equal(historic.status, 200); assert.deepEqual(historic.data.bundle, first.packet.bundle);
}));
test('accepted retry and restart recovery retain the original publication and a later head after publisher downgrade', () => fixture(async c => {
  const first = await c.publish(), second = await c.publish(await c.request(first.packet.bundle.manifest.revisionId), c.owner);
  c.relay.store.changeMember(documentId, c.owner.actor, c.editor.actor.id, 'viewer'); await c.restart(); const original = c.state();
  for (const result of [await c.call(c.editor, first.packet), await c.call(c.editor, undefined, `${base}/receipts/${first.packet.requestId}`)]) {
    assert.equal(result.status, 200); assert.equal(result.data.publication.revisionId, first.packet.bundle.manifest.revisionId); assert.equal(result.data.current.revisionId, second.packet.bundle.manifest.revisionId); assert.equal(result.data.actor.role, 'viewer');
  }
  assert.deepEqual(c.state(), original); await c.refused(() => c.call(c.editor, { ...first.packet, bundle: second.packet.bundle }), 409);
  await c.refused(() => c.call(c.viewer, undefined, `${base}/receipts/${first.packet.requestId}`), 404); await c.refused(() => c.call(c.editor, undefined, `${base}/receipts/${randomUUID()}`), 404);
}));
test('fresh authorization wins over stale actor claims after body reads and asynchronous publication validation', () => fixture(async c => {
  const packet = await c.request(), stream = new PassThrough(); Object.assign(stream, { method: 'POST', url: base, headers: { authorization: `Bearer ${c.editor.credential}`, 'content-type': 'application/json' }, socket: { remoteAddress: randomUUID() } }); let status;
  const outcome = c.relay.handle(stream, { destroyed: false, writeHead(code) { status = code; }, end() {} }); const bytes = Buffer.from(JSON.stringify(packet)); stream.write(bytes.subarray(0, 5)); await new Promise(resolve => setImmediate(resolve)); c.relay.store.changeMember(documentId, c.owner.actor, c.editor.actor.id, 'viewer'); const original = c.state(); stream.end(bytes.subarray(5)); await outcome; assert.equal(status, 403); assert.deepEqual(c.state(), original);
  c.relay.store.changeMember(documentId, c.owner.actor, c.editor.actor.id, 'editor'); const work = c.relay.store.publishLibrary(documentId, { ...c.editor.actor, role: 'owner', name: 'Forged' }, packet); c.relay.store.changeMember(documentId, c.owner.actor, c.editor.actor.id, null); const revoked = c.state(); await assert.rejects(work, error => error.status === 401); assert.deepEqual(c.state(), revoked);
}));
test('latest reads reauthorize after validation and do not return a superseded latest head', () => fixture(async c => {
  const first = await c.publish(); const read = c.relay.store.libraryRevision(documentId, c.viewer.actor, { version: 1, libraryId: 'library:original', revisionId: null }); c.relay.store.changeMember(documentId, c.owner.actor, c.viewer.actor.id, null); const original = c.state(); await assert.rejects(read, error => error.status === 401); assert.deepEqual(c.state(), original);
  const second = await c.request(first.packet.bundle.manifest.revisionId); let release; const normal = c.relay.store.engine.validateRoomLibraryBundle; c.relay.store.engine = { ...c.relay.store.engine, validateRoomLibraryBundle: async value => { const result = await normal(value); await new Promise(resolve => { release = resolve; }); return result; } };
  const pending = c.relay.store.libraryRevision(documentId, c.other.actor, { version: 1, libraryId: 'library:original', revisionId: null }); while (!release) await new Promise(resolve => setImmediate(resolve)); c.relay.store.engine = { ...c.relay.store.engine, validateRoomLibraryBundle: normal }; await c.publish(second, c.owner); release(); await assert.rejects(pending, error => error.status === 409);
}));
test('revision and receipt writes are atomic and immutable retries cannot rewrite a payload', () => fixture(async c => {
  const first = await c.publish(), next = await c.request(first.packet.bundle.manifest.revisionId);
  c.relay.store.db.exec("CREATE TRIGGER fail_library_receipt BEFORE INSERT ON room_library_receipts BEGIN SELECT RAISE(ABORT,'library receipt failure'); END;"); await c.refused(() => c.call(c.editor, next), 500); c.relay.store.db.exec('DROP TRIGGER fail_library_receipt'); await c.publish(next); const original = c.state(); assert.equal((await c.call(c.editor, next)).status, 200); assert.deepEqual(c.state(), original);
  await c.refused(() => c.call(c.editor, { ...next, bundle: first.packet.bundle }), 409); await c.refused(() => c.call(c.editor, { ...next, requestId: randomUUID() }), 409);
}));
test('portable integrity, transfer methods and exact DTO fields are enforced before persistent writes', () => fixture(async c => {
  const packet = await c.request();
  for (const patch of [{ version: 2 }, { requestId: 'small' }, { secret: 'foreign' }, { bundle: { ...packet.bundle, checksum: '0'.repeat(64) } }, { bundle: { ...packet.bundle, manifest: { ...packet.bundle.manifest, ownerId: c.owner.actor.id } } }]) await c.refused(() => c.call(c.editor, { ...packet, ...patch }), 422);
  await c.refused(() => c.call(c.editor, packet, base, 'DELETE'), 405); await c.refused(() => c.call(c.editor, undefined, base + '/revision'), 405);
  await c.refused(() => c.call(c.editor, packet, base, 'POST', { 'content-encoding': 'gzip' }), 415); await c.refused(() => c.call(c.editor, packet, base, 'POST', { 'content-length': String(engine.api.ROOM_LIBRARY_TRANSFER_LIMIT + 1) }), 413);
  await c.refused(() => c.call(c.editor, undefined, base + '?secret=foreign'), 422);
}));
test('damaged payloads, summaries and receipts fail closed without overwriting valid artwork or library data', () => fixture(async c => {
  const first = await c.publish(), db = c.relay.store.db, saved = c.state();
  db.prepare('UPDATE room_library_revisions SET payload=?').run('{}'); await c.refused(() => c.revision(c.viewer), 500); await c.refused(() => c.call(c.editor, undefined, `${base}/receipts/${first.packet.requestId}`), 500); db.prepare('UPDATE room_library_revisions SET payload=?').run(saved.room_library_revisions[0].payload);
  db.prepare('UPDATE room_libraries SET summary=?').run('{}'); await c.refused(() => c.call(c.viewer), 500); db.prepare('UPDATE room_libraries SET summary=?').run(saved.room_libraries[0].summary);
  db.prepare('UPDATE room_library_receipts SET result=?').run('{}'); await c.refused(() => c.call(c.editor, undefined, `${base}/receipts/${first.packet.requestId}`), 500); assert.deepEqual(c.state().rooms, saved.rooms);
}));
test('format-four append is atomic and preserves every accepted legacy row', () => fixture(async c => {
  const db = c.relay.store.db, original = c.state(); db.exec("DROP TABLE room_images;DROP TABLE room_image_revisions;DROP TABLE room_image_chunks;DROP TABLE room_image_uploads;DROP TABLE room_library_receipts;DROP TABLE room_library_revisions;DROP TABLE room_libraries;UPDATE room_meta SET value='4' WHERE key='version';CREATE TRIGGER fail_library_upgrade BEFORE UPDATE ON room_meta WHEN NEW.value='5' BEGIN SELECT RAISE(ABORT,'library upgrade failure'); END;"); await c.relay.close(); const bytes = await readFile(c.database); await assert.rejects(c.restart(), /library upgrade failure/); assert.ok(bytes.equals(await readFile(c.database)));
  const repair = new DatabaseSync(c.database); assert.equal(repair.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'room_librar%'").get().n, 0); repair.exec('DROP TRIGGER fail_library_upgrade'); repair.close(); await c.restart();
  for (const [table, rows] of Object.entries(original)) assert.deepEqual(c.state()[table], rows); assert.equal(c.relay.store.db.prepare("SELECT value FROM room_meta WHERE key='version'").get().value, '6');
}));
test('equal library and request identities remain isolated by room and current membership', () => fixture(async c => {
  const first = await c.publish(), otherDocumentId = 'library_document_002', seed = engine.api.SharedDesign.fromGraph(new SceneGraph());
  try {
    const other = c.relay.store.create(otherDocumentId, 'Other room', 'Other owner', seed.update());
    const result = await c.relay.store.publishLibrary(otherDocumentId, other.actor, first.packet);
    assert.equal(result.publication.ownerId, other.actor.id); assert.notEqual(result.publication.ownerId, first.response.publication.ownerId);
    assert.equal(c.relay.store.libraryCatalog(documentId, c.viewer.actor).libraries[0].ownerId, c.editor.actor.id);
    assert.equal(c.relay.store.libraryCatalog(otherDocumentId, other.actor).libraries[0].ownerId, other.actor.id);
    const original = c.state();
    await assert.rejects(c.relay.store.libraryRevision(otherDocumentId, c.viewer.actor, { version: 1, libraryId: 'library:original', revisionId: null }), error => error.status === 401);
    assert.throws(() => c.relay.store.recoverLibrary(otherDocumentId, c.editor.actor, first.packet.requestId), error => error.status === 401);
    assert.deepEqual(c.state(), original);
  } finally { seed.dispose(); }
}));
test('library payload corruption during asynchronous validation is detected again before returning it', () => fixture(async c => {
  await c.publish(); let release;
  const normal = c.relay.store.engine.validateRoomLibraryBundle;
  c.relay.store.engine = { ...c.relay.store.engine, validateRoomLibraryBundle: async value => { const result = await normal(value); await new Promise(resolve => { release = resolve; }); return result; } };
  const pending = c.relay.store.libraryRevision(documentId, c.viewer.actor, { version: 1, libraryId: 'library:original', revisionId: null });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  c.relay.store.db.prepare('UPDATE room_library_revisions SET payload=?').run('{}'); const original = c.state(); release();
  await assert.rejects(pending, error => error.status === 500); assert.deepEqual(c.state(), original);
}));
test('maximum valid Unicode descriptions stay readable and recoverable after publication and restart', () => fixture(async c => {
  const packet = await c.request(); packet.bundle.manifest.name = '图'.repeat(200); packet.bundle.manifest.description = '图'.repeat(4000);
  const first = await c.publish(packet); assert.ok(Buffer.byteLength(JSON.stringify(first.response.publication)) > 8192);
  await c.restart(); const original = c.state();
  assert.equal((await c.call(c.viewer)).data.libraries[0].description, packet.bundle.manifest.description);
  const read = await c.revision(c.viewer); assert.equal(read.status, 200); assert.equal((await engine.api.readRoomLibraryRevision(read.data, documentId, 'library:original', null)).revision.manifest.name, packet.bundle.manifest.name);
  const recovery = await c.call(c.editor, undefined, `${base}/receipts/${packet.requestId}`); assert.equal(recovery.status, 200); assert.deepEqual(recovery.data.publication, first.response.publication); assert.deepEqual(c.state(), original);
}));
test('independent SQLite writers share one immutable publication receipt', () => fixture(async c => {
  const packet = await c.request(); const workers = Array.from({ length: 2 }, () => new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const{roomEngine}=await import(workerData.engine);const{RoomStore}=await import(workerData.store);const engine=await roomEngine(),store=new RoomStore(workerData.database,engine.api,{grantSecret:workerData.secret});parentPort.postMessage({ready:true});parentPort.once('message',async()=>{try{parentPort.postMessage({reply:await store.publishLibrary(workerData.documentId,workerData.actor,workerData.packet)});}catch(error){parentPort.postMessage({error:error.message,status:error.status});}finally{store.close();parentPort.close();}});})().catch(error=>{parentPort.postMessage({error:error.message});parentPort.close();});`, { eval: true, workerData: { engine: new URL('./xdesign-room-engine.mjs', import.meta.url).href, store: new URL('./xdesign-room-store.mjs', import.meta.url).href, database: c.database, secret: administrator, documentId, actor: c.editor.actor, packet } }));
  try {
    await Promise.all(workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', value => value.ready ? resolve() : reject(new Error(value.error))); })));
    const replies = workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', value => value.reply ? resolve(value.reply) : reject(new Error(value.error))); })); workers.forEach(worker => worker.postMessage('go')); const [a, b] = await Promise.all(replies); assert.deepEqual(a, b); assert.equal(c.state().room_library_revisions.length, 1); assert.equal(c.state().room_library_receipts.length, 1);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}));
test('revision capacity refuses new publications while retaining original revision and receipt recovery', () => fixture(async c => {
  const first = await c.publish(), row = c.state().room_library_revisions[0], db = c.relay.store.db;
  for (let index = 0; index < 499; index++) db.prepare('INSERT INTO room_library_revisions(room_id,library_id,revision_id,payload,payload_digest,summary,summary_digest,created_at) VALUES(?,?,?,?,?,?,?,?)').run(documentId, 'library:original', index.toString(16).padStart(64, '0'), row.payload, row.payload_digest, row.summary, row.summary_digest, 1);
  const next = await c.request(first.packet.bundle.manifest.revisionId); await c.refused(() => c.call(c.editor, next), 413); assert.equal((await c.call(c.editor, undefined, `${base}/receipts/${first.packet.requestId}`)).status, 200); assert.equal((await c.revision(c.viewer, 'library:original', first.packet.bundle.manifest.revisionId)).status, 200);
}));
