import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import * as Y from 'yjs';
import { SceneGraph, computeImageHash } from '@open-pencil/scene-graph';
import { roomEngine } from './xdesign-room-engine.mjs';
import { createRoomRelay } from './xdesign-room-relay.mjs';

let engine;
const documentId = 'image_reference_room_001', sha = value => createHash('sha256').update(value).digest('hex');
before(async () => { engine = await roomEngine(); });
after(async () => {
  if (engine && process.env.XDESIGN_IMAGE_REFS_EVIDENCE) await writeFile(process.env.XDESIGN_IMAGE_REFS_EVIDENCE, JSON.stringify({ node: process.version, bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, licenseAssets: engine.licenseAssets, warnings: engine.warnings, transport: 'actual-sdk-node-streams-temporary-sqlite-no-sockets', yjs: 'external fixture and bundled service exchange bytes only', assets: 'generated opaque archive and preview bytes; no native decoding or authored original acceptance' }, null, 2) + '\n');
});
async function fixture(work) {
  const folder = await mkdtemp(join(tmpdir(), 'xdesign-image-references-')), database = join(folder, 'rooms.sqlite'), peers = [], docs = [];
  let relay = await createRoomRelay({ database, adminSecret: 'image-reference-administrator-'.repeat(3), engine });
  const keep = peer => { peers.push(peer); return peer; }, graph = new SceneGraph(), page = graph.getPages()[0].id;
  const legacy = { pluginId: 'orion.xdesign', key: 'photoDocumentId', value: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }, node = graph.createNode('RECTANGLE', page, { x: 12, width: 80, height: 40, pluginData: [legacy] }).id;
  const seed = keep(engine.api.SharedDesign.fromGraph(graph)), owner = relay.store.create(documentId, 'Image references', 'Owner', seed.update()), editor = relay.store.invite(documentId, owner.actor, 'Editor', 'editor'), viewer = relay.store.invite(documentId, owner.actor, 'Viewer', 'viewer');
  const checkpoint = () => new Uint8Array(relay.store.db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint);
  const peer = () => keep(engine.api.SharedDesign.fromUpdate(checkpoint()));
  const state = () => Object.fromEntries(relay.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, relay.store.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
  const outgoing = (update, type = 'update') => ({ version: 1, type, documentId, clientId: 'image_reference_client_001', requestId: randomUUID(), vector: 'AA==', ...(type === 'update' ? { update: engine.api.roomBinary(update) } : {}) });
  const send = (update, actor = editor.actor, packet = outgoing(update)) => relay.store.exchange(actor, packet);
  const refuse = (operation, status, code) => { const before = state(); assert.throws(operation, error => error.status === status && (!code || error.code === code)); assert.deepEqual(state(), before); };
  const dispatch = async (grant, value) => {
    const request = Readable.from([Buffer.from(JSON.stringify(value))]); Object.assign(request, { method: 'POST', url: '/v1/rooms/' + documentId + '/sync', headers: { authorization: 'Bearer ' + grant.credential, 'content-type': 'application/json' }, socket: { remoteAddress: randomUUID() } });
    let status, data; await relay.handle(request, { destroyed: false, writeHead(code) { status = code; }, end(bytes) { data = JSON.parse(bytes); } }); return { status, data };
  };
  const prepare = async ({ room = documentId, imageId = 'editable_shared_image_001', preview = Buffer.from('Original preview 🙂'), previousRevisionId = null, actor = editor.actor } = {}) => {
    const bytes = Buffer.from('Opaque native archive ' + randomUUID()), manifest = await engine.api.createRoomImageManifest({ imageId, previousRevisionId, name: 'Original native image', width: 80, height: 40, previewWidth: 80, previewHeight: 40, archiveBytes: bytes.length, archiveDigest: sha(bytes), previewDigest: sha(preview), chunkDigests: [sha(bytes)] });
    const packet = { version: 1, requestId: randomUUID(), manifest }, chunk = { version: 1, index: 0, sha256: sha(bytes), data: bytes.toString('base64') }, reference = { version: 1, imageId, revisionId: manifest.revisionId, previewHash: computeImageHash(preview) };
    return { room, actor, bytes, preview, packet, chunk, reference };
  };
  const publish = p => { relay.store.beginImage(p.room, p.actor, p.packet); relay.store.putImageChunk(p.room, p.actor, p.packet.requestId, 0, p.chunk); return relay.store.commitImage(p.room, p.actor, { version: 1, requestId: p.packet.requestId }); };
  const link = (p, target = peer(), ref = p.reference, bytes = p.preview) => {
    target.edit('Link shared image', draft => { draft.images.set(ref.previewHash, new Uint8Array(bytes)); draft.updateNode(node, { x: 123, pluginData: [{ pluginId: 'original.plugin', key: 'retained', value: 'Original 🙂' }, engine.api.roomImagePluginData(ref)] }); }); return target;
  };
  const raw = () => {
    const doc = new Y.Doc({ gc: false }); docs.push(doc); Y.applyUpdate(doc, checkpoint()); const vector = Y.encodeStateVector(doc);
    return { doc, record: doc.getMap('nodes').get(node), update: () => Y.encodeStateAsUpdate(doc, vector) };
  };
  try { await work({ get store() { return relay.store; }, owner, editor, viewer, page, node, legacy, keep, checkpoint, peer, state, outgoing, send, refuse, dispatch, prepare, publish, link, raw, async restart() { await relay.close(); relay = await createRoomRelay({ database, adminSecret: 'image-reference-administrator-'.repeat(3), engine }); } }); }
  finally { peers.forEach(peer => peer.dispose()); docs.forEach(doc => doc.destroy()); await relay.close(); await rm(folder, { recursive: true, force: true }); }
}
test('published references reopen through a viewer Node-stream sync with exact preview and pinned original archive chunks', () => fixture(async c => {
  const p = await c.prepare(); c.publish(p); const peer = c.link(p), packet = c.outgoing(peer.update()), accepted = await c.dispatch(c.editor, packet); assert.equal(accepted.status, 200, JSON.stringify(accepted));
  const response = await c.dispatch(c.viewer, c.outgoing(undefined, 'sync')); assert.equal(response.status, 200, JSON.stringify(response));
  const restored = c.keep(engine.api.SharedDesign.fromUpdate(new Uint8Array(Buffer.from(response.data.update, 'base64'))));
  assert.deepEqual(engine.api.roomImagePlacements(restored.graph), [{ nodeId: c.node, reference: p.reference }]); assert.deepEqual(Buffer.from(restored.graph.images.get(p.reference.previewHash)), p.preview); assert.equal(restored.graph.getNode(c.node).x, 123); assert.equal(restored.graph.getNode(c.node).pluginData[0].value, 'Original 🙂');
  const chunk = c.store.imageChunk(documentId, c.viewer.actor, p.reference.imageId, p.reference.revisionId, 0), read = await engine.api.readRoomImageChunkResponse(chunk, documentId, p.packet.manifest, 0); assert.deepEqual(Buffer.from(read.bytes), p.bytes);
  const original = c.state(); await c.restart(); assert.deepEqual(c.state(), original); assert.equal((await c.dispatch(c.viewer, c.outgoing(undefined, 'sync'))).status, 200);
}));
test('unpublished and partially uploaded references leave artwork, history and every receipt unchanged', () => fixture(async c => {
  const p = await c.prepare(); c.refuse(() => c.send(c.link(p).update()), 409, 'image');
  c.store.beginImage(documentId, c.editor.actor, p.packet); c.store.putImageChunk(documentId, c.editor.actor, p.packet.requestId, 0, p.chunk);
  c.refuse(() => c.send(c.link(p).update()), 409, 'image'); c.store.commitImage(documentId, c.editor.actor, { version: 1, requestId: p.packet.requestId }); assert.equal(c.send(c.link(p).update()).type, 'ack');
}));
test('same image identities published in another room cannot be linked into this room', () => fixture(async c => {
  const otherRoom = 'image_reference_room_002', seed = c.keep(engine.api.SharedDesign.fromGraph(new SceneGraph())), foreign = c.store.create(otherRoom, 'Foreign room', 'Owner', seed.update());
  const p = await c.prepare({ room: otherRoom, actor: foreign.actor }); c.publish(p); c.refuse(() => c.send(c.link(p).update()), 409, 'image');
  const own = await c.prepare({ preview: p.preview }); c.publish(own); c.refuse(() => c.send(c.link(p).update()), 409, 'image'); assert.equal(c.send(c.link(own).update()).type, 'ack');
}));
test('a preview with its own valid SDK address must also match the published SHA256 digest', () => fixture(async c => {
  const p = await c.prepare(); c.publish(p); const bytes = Buffer.from('Altered preview with a valid SDK address'), reference = { ...p.reference, previewHash: computeImageHash(bytes) };
  c.refuse(() => c.send(c.link(p, c.peer(), reference, bytes).update()), 422, 'integrity');
  const missing = c.link(p); missing.edit('Remove preview', graph => graph.images.delete(p.reference.previewHash)); c.refuse(() => c.send(missing.update()), 422, 'invalid');
}));
test('duplicate, conflicting, noncanonical and unknown reserved metadata refuse the entire mixed artwork update', () => fixture(async c => {
  const p = await c.prepare(); c.publish(p); const marker = engine.api.roomImagePluginData(p.reference);
  for (const pluginData of [[marker, marker], [marker, c.legacy], [{ ...marker, token: 'secret' }], [{ ...marker, value: ' ' + marker.value }], [{ ...marker, value: marker.value.replace('"version":1', '"version":2,"version":1') }], [engine.api.roomImagePluginData({ ...p.reference }), { pluginId: 'original.plugin', key: 'value', value: 'retained' }]]) {
    const peer = c.link(p); if (pluginData.length === 2 && pluginData[1].pluginId === 'original.plugin') pluginData[0].value = JSON.stringify({ ...p.reference, unknown: true });
    peer.edit('Malformed reference and artwork', graph => graph.updateNode(c.node, { x: 999, pluginData })); c.refuse(() => c.send(peer.update()), 422, 'invalid');
  }
}));
test('every hidden overwritten image reference is admitted before any visible restoration or accompanying artwork', () => fixture(async c => {
  const p = await c.prepare(), raw = c.raw(); raw.record.set('pluginData', engine.api.encodeSharedValue([engine.api.roomImagePluginData(p.reference)])); raw.record.set('pluginData', engine.api.encodeSharedValue([c.legacy])); raw.record.set('x', engine.api.encodeSharedValue(999));
  c.refuse(() => c.send(raw.update()), 409, 'image'); assert.equal(c.peer().graph.getNode(c.node).x, 12);
}));
test('merged hidden atoms and metadata on a tombstoned layer cannot carry unpublished references', () => fixture(async c => {
  const p = await c.prepare();
  const merged = c.raw(); merged.record.set('pluginData', engine.api.encodeSharedValue([engine.api.roomImagePluginData(p.reference)])); merged.record.set('pluginData', engine.api.encodeSharedValue([engine.api.roomImagePluginData({ ...p.reference, revisionId: 'a'.repeat(64) })])); merged.record.set('pluginData', engine.api.encodeSharedValue([c.legacy]));
  assert.ok(Y.decodeUpdate(merged.update()).structs.some(item => item instanceof Y.Item && item.content instanceof Y.ContentAny && item.length > 1)); c.refuse(() => c.send(merged.update()), 409, 'image');
  const removed = c.raw(); removed.record.set('pluginData', engine.api.encodeSharedValue([engine.api.roomImagePluginData(p.reference)])); removed.doc.getMap('nodes').delete(c.node); c.refuse(() => c.send(removed.update()), 409, 'image');
}));
test('a losing concurrent image reference is checked even when the current published layer wins', () => fixture(async c => {
  const valid = await c.prepare(); c.publish(valid); const losing = c.raw(); losing.doc.clientID = 1;
  const missing = await c.prepare({ imageId: 'unpublished_image_001' }); losing.record.set('pluginData', engine.api.encodeSharedValue([engine.api.roomImagePluginData(missing.reference)]));
  const winning = c.raw(); winning.doc.clientID = 4_000_000_000; winning.record.set('pluginData', engine.api.encodeSharedValue([engine.api.roomImagePluginData(valid.reference)])); winning.doc.getMap('images').set(valid.reference.previewHash, new Uint8Array(valid.preview)); c.send(winning.update());
  c.refuse(() => c.send(losing.update()), 409, 'image'); assert.deepEqual(engine.api.roomImagePlacements(c.peer().graph)[0].reference, valid.reference);
}));
test('historic revisions, selective undo and original accepted receipts survive owner successors and publisher downgrade', () => fixture(async c => {
  const first = await c.prepare(); c.publish(first); const peer = c.link(first), packet = c.outgoing(peer.update()), receipt = c.send(peer.update(), c.editor.actor, packet);
  const next = await c.prepare({ previousRevisionId: first.reference.revisionId, preview: Buffer.from('Successor preview'), actor: c.owner.actor }); c.publish(next); c.link(next, peer); c.send(peer.update()); peer.undo(); c.send(peer.update()); assert.deepEqual(engine.api.roomImagePlacements(c.peer().graph)[0].reference, first.reference);
  c.store.changeMember(documentId, c.owner.actor, c.editor.actor.id, 'viewer'); const before = c.state(), recovered = c.send(new Uint8Array(), c.editor.actor, packet); assert.equal(recovered.acceptedRevision, receipt.acceptedRevision); assert.equal(recovered.actor.role, 'viewer'); assert.deepEqual(c.state(), before);
  peer.redo(); c.refuse(() => c.send(peer.update()), 403, 'readonly');
}));
test('creation refuses visible or hidden references from an existing room before writing any grant or room', () => fixture(async c => {
  const p = await c.prepare(); c.publish(p); c.send(c.link(p).update());
  c.refuse(() => c.store.create('new_reference_room_001', 'New room', 'Owner', c.checkpoint(), randomUUID()), 409, 'image');
  const hidden = c.peer(); hidden.edit('Keep local legacy layer', graph => graph.updateNode(c.node, { pluginData: [c.legacy] }));
  assert.equal(engine.api.roomImagePlacements(hidden.graph).length, 0); assert.equal(engine.api.roomImageHistoryReferences(hidden.update()).length, 1);
  c.refuse(() => c.store.create('new_reference_room_002', 'New room', 'Owner', hidden.update(), randomUUID()), 409, 'image');
}));
test('receipt insertion failure rolls back image-linked artwork and retries the exact original request once', () => fixture(async c => {
  const p = await c.prepare(); c.publish(p); const packet = c.outgoing(c.link(p).update());
  c.store.db.exec("CREATE TRIGGER fail_reference_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;"); const before = c.state(); assert.equal((await c.dispatch(c.editor, packet)).status, 500); assert.deepEqual(c.state(), before); c.store.db.exec('DROP TRIGGER fail_reference_receipt');
  const accepted = await c.dispatch(c.editor, packet); assert.equal(accepted.status, 200); const done = c.state(); assert.equal((await c.dispatch(c.editor, packet)).data.acceptedRevision, accepted.data.acceptedRevision); assert.deepEqual(c.state(), done);
}));
test('corrupt published reference metadata prevents reads, updates and comments while preserving original files and receipts', () => fixture(async c => {
  const p = await c.prepare(); c.publish(p); const packet = c.outgoing(c.link(p).update()); c.send(undefined, c.editor.actor, packet);
  c.store.db.prepare('UPDATE room_image_revisions SET summary_digest=? WHERE room_id=?').run('0'.repeat(64), documentId);
  c.refuse(() => c.store.exchange(c.viewer.actor, c.outgoing(undefined, 'sync')), 500, 'storage'); c.refuse(() => c.send(undefined, c.editor.actor, packet), 500, 'storage');
  const comment = { version: 1, type: 'comment', documentId, clientId: 'image_comment_client_001', requestId: randomUUID(), vector: 'AA==', command: { type: 'add', pageId: c.page, anchor: { format: 'local', points: [{ x: 1, y: 2 }], fallback: [{ x: 1, y: 2 }] }, body: 'Retain original artwork' } };
  c.refuse(() => c.store.comment(c.editor.actor, comment), 500, 'storage');
}));
test('a corrupt stored preview fails closed even when the checkpoint digest is recomputed', () => fixture(async c => {
  const p = await c.prepare(); c.publish(p); c.send(c.link(p).update()); const peer = c.peer(); peer.edit('Corrupt saved resource', graph => graph.images.set(p.reference.previewHash, new Uint8Array([1, 2, 3]))); const bytes = peer.update();
  c.store.db.prepare('UPDATE rooms SET checkpoint=?,digest=? WHERE id=?').run(bytes, sha(bytes), documentId);
  c.refuse(() => c.store.exchange(c.viewer.actor, c.outgoing(undefined, 'sync')), 500, 'storage');
}));
