import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { SceneGraph } from '@open-pencil/scene-graph';
import { roomEngine } from './xdesign-room-engine.mjs';
import { RoomPresence } from './xdesign-room-presence.mjs';
import { createRoomRelay } from './xdesign-room-relay.mjs';
let engine;
const documentId = 'presence_document_001', administrator = `fixture-${randomUUID()}`;
before(async () => { engine = await roomEngine(); });
after(async () => { if (process.env.XDESIGN_PRESENCE_EVIDENCE) await writeFile(process.env.XDESIGN_PRESENCE_EVIDENCE, JSON.stringify({ node: process.version, bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, licenseAssets: engine.licenseAssets, warnings: engine.warnings, transport: 'in-process-node-stream-handler-no-sockets' }, null, 2) + '\n'); });
const client = (number = 1) => `presence_client_${String(number).padStart(3, '0')}`;
const packet = (number = 1, sequence = 1, patch = {}) => ({ version: 1, documentId, clientId: client(number), sequence, state: { pageId: '1:0', cursor: [12, 24], selection: ['2:0'], view: { center: [30, 40], zoom: .001, width: 800, height: 600 }, following: null }, ...patch });
async function fixture(work) {
  const folder = await mkdtemp(join(tmpdir(), 'xdesign-presence-')), database = join(folder, 'rooms.sqlite'); let relay;
  const graph = new SceneGraph(), replica = engine.api.SharedDesign.fromGraph(graph);
  try {
    relay = await createRoomRelay({ database, adminSecret: administrator, engine });
    const owner = relay.store.create(documentId, 'Design', 'Owner', replica.update()); let time = 0;
    const presence = new RoomPresence(relay.store, engine.api, { now: () => time }); relay.presence.now = () => time;
    await work({ relay, owner, presence, replica, database, now: value => { time = value; }, member: (role = 'editor', name = 'Peer') => relay.store.invite(documentId, owner.actor, name, role), restart: async () => { await relay.close(); relay = await createRoomRelay({ database, adminSecret: administrator, engine }); return relay; } });
  } finally { replica.dispose(); await relay?.close(); await rm(folder, { recursive: true, force: true }); }
}
async function call(relay, credential, value, method = 'POST', path = `/v1/rooms/${documentId}/presence`, stream) {
  const input = stream ?? Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]); Object.assign(input, { method, url: path, headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, socket: { remoteAddress: randomUUID() } });
  let status, result, headers; const response = { destroyed: false, writeHead(code, value) { status = code; headers = value; }, end(bytes) { result = JSON.parse(bytes); } };
  await relay.handle(input, response); return { status, result, headers };
}
const refused = (work, status) => assert.throws(work, error => error.status === status);

test('owner/editor/viewer presence uses server identities without changing artwork, revisions, receipts or persisted metadata', async () => fixture(async context => {
  const { relay, owner, presence } = context, editor = context.member(), viewer = context.member('viewer', 'Reader');
  const before = relay.store.db.prepare('SELECT hex(checkpoint) AS bytes,revision,digest FROM rooms').all();
  for (const [index, member] of [owner, editor, viewer].entries()) {
    const outgoing = packet(index + 1), incoming = presence.exchange(member.actor, outgoing), parsed = engine.api.readPresenceResponse(incoming, outgoing); assert.deepEqual(parsed.actor, member.actor);
  }
  const result = presence.exchange(owner.actor, packet(1, 2)); assert.deepEqual(new Set(result.peers.map(peer => peer.actor.role)), new Set(['owner','editor','viewer']));
  assert.deepEqual(relay.store.db.prepare('SELECT hex(checkpoint) AS bytes,revision,digest FROM rooms').all(), before); assert.equal(relay.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0); assert.equal(relay.store.db.prepare('SELECT count(*) AS n FROM grant_receipts').get().n, 0);
  assert.ok(!JSON.stringify([...presence.rooms.values()].flatMap(room => [...room.values()])).includes(owner.credential));
  const dbTables = relay.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all(); assert.equal(dbTables.length, 16);
}));

test('immutable monotonic sequences, leave tombstones and peer identity collisions cannot overwrite another member', async () => fixture(async context => {
  const { presence, owner } = context, other = context.member();
  const original = packet(); presence.exchange(owner.actor, original); context.now(5000); presence.exchange(owner.actor, original); context.now(15_000);
  assert.equal(presence.exchange(other.actor, packet(2)).peers.some(peer => peer.clientId === client()), false);
  refused(() => presence.exchange(owner.actor, { ...packet(), state: { ...packet().state, cursor: [88, 99] } }), 409);
  refused(() => presence.exchange(other.actor, packet()), 409); assert.equal(presence.rooms.get(documentId).get(`${owner.actor.id}/${client()}`).actorId, owner.actor.id);
  presence.exchange(owner.actor, packet(1, 2)); presence.exchange(owner.actor, packet(1, 3, { state: null })); refused(() => presence.exchange(owner.actor, packet(1, 2)), 409);
  assert.equal(presence.exchange(other.actor, packet(2, 2)).peers.some(peer => peer.actor.id === owner.actor.id), false);
}));

test('fresh membership lookup changes displayed roles and removes revoked peers and their authority', async () => fixture(async context => {
  const { relay, presence, owner } = context, member = context.member(); presence.exchange(member.actor, packet());
  relay.store.changeMember(documentId, owner.actor, member.actor.id, 'viewer'); const result = presence.exchange(owner.actor, packet(2)); assert.equal(result.peers.find(peer => peer.actor.id === member.actor.id).actor.role, 'viewer');
  assert.equal(presence.exchange({ ...member.actor, role: 'owner', name: 'Forged' }, packet(1, 2)).actor.role, 'viewer');
  relay.store.changeMember(documentId, owner.actor, member.actor.id, null); refused(() => presence.exchange(member.actor, packet(1, 3)), 401);
  assert.deepEqual(presence.exchange(owner.actor, packet(2, 2)).peers.map(peer => peer.actor.id), [owner.actor.id]);
}));

test('inactive presence expires on a monotonic lease while document data survives and restart clears presence only', async () => fixture(async context => {
  const { presence, owner, relay, replica } = context; presence.exchange(owner.actor, packet()); context.now(15_000);
  assert.equal(presence.exchange(owner.actor, packet()).peers.length, 0); context.now(90_000); presence.sweep(90_000); assert.equal(presence.rooms.size, 0);
  const restarted = await context.restart(); assert.equal(restarted.presence.rooms.size, 0); assert.deepEqual(restarted.store.authorize(documentId, owner.credential), owner.actor);
  const bytes = new Uint8Array(restarted.store.db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint), recovered = engine.api.SharedDesign.fromUpdate(bytes); try { assert.deepEqual(recovered.graph.getPages().map(page => page.id), replica.graph.getPages().map(page => page.id)); } finally { recovered.dispose(); }
}));

test('presence stays room scoped even when clients use the same scene/client identities', async () => fixture(async context => {
  const { presence, owner, relay, replica } = context, secondId = 'presence_document_002', other = relay.store.create(secondId, 'Other', 'Other owner', replica.update());
  presence.exchange(owner.actor, packet()); const outgoing = packet(1, 1, { documentId: secondId }), result = presence.exchange(other.actor, outgoing); assert.deepEqual(result.peers.map(peer => peer.actor.id), [other.actor.id]);
  refused(() => presence.exchange(owner.actor, outgoing), 401);
}));

test('bounded active sessions permit expiry/leave recovery and prevent expired session resurrection beyond the member limit', async () => fixture(async context => {
  const { presence, owner } = context;
  for (let index = 1; index <= 4; index++) presence.exchange(owner.actor, packet(index)); refused(() => presence.exchange(owner.actor, packet(5)), 429);
  presence.exchange(owner.actor, packet(1, 2, { state: null })); presence.exchange(owner.actor, packet(5)); refused(() => presence.exchange(owner.actor, packet(1, 3)), 429);
  context.now(15_001); presence.exchange(owner.actor, packet(6)); assert.equal(presence.exchange(owner.actor, packet(6, 2)).peers.length, 1);
}));

test('the room cap preserves admitted peers and refuses extra sessions without evicting their sequence protection', async () => fixture(async context => {
  const { presence, owner } = context; let number = 1;
  for (let member = 0; member < 32; member++) { const actor = member === 0 ? owner.actor : context.member('editor', `Peer ${member}`).actor; for (let slot = 0; slot < 4; slot++) presence.exchange(actor, packet(number++)); }
  assert.equal(presence.rooms.get(documentId).size, 128); const extra = context.member(); refused(() => presence.exchange(extra.actor, packet(number)), 429); assert.equal(presence.rooms.get(documentId).size, 128);
  const incoming = presence.exchange(owner.actor, packet(1, 2)); assert.equal(engine.api.readPresenceResponse(incoming, packet(1, 2)).peers.length, 128);
}));

test('actual Node stream handlers scope and reauthenticate presence after body reading, with strict transfer limits', async () => fixture(async context => {
  const { relay, owner } = context, viewer = context.member('viewer', 'Reader'), outgoing = packet();
  const accepted = await call(relay, viewer.credential, outgoing); assert.equal(accepted.status, 200); assert.equal(accepted.result.actor.role, 'viewer'); assert.equal(accepted.headers['Cache-Control'], 'no-store'); engine.api.readPresenceResponse(accepted.result, outgoing);
  for (const [value, status] of [[{ ...packet(2), actor: owner.actor }, 422], [{ ...packet(2), documentId: 'presence_document_002' }, 409], [{ ...packet(2), state: { ...packet(2).state, selection: Array.from({ length: 65 }, (_, index) => `${index}:0`) } }, 422]]) assert.equal((await call(relay, owner.credential, value)).status, status);
  assert.equal((await call(relay, owner.credential, undefined, 'GET')).status, 405); assert.equal((await call(relay, 'unknown', outgoing)).status, 401);
  assert.equal((await call(relay, owner.credential, { ...packet(2), padding: 'x'.repeat(65 * 1024) })).status, 413);
  const stream = Readable.from((async function* () { yield Buffer.from(JSON.stringify(packet(2))); relay.store.changeMember(documentId, owner.actor, viewer.actor.id, null); })());
  assert.equal((await call(relay, viewer.credential, undefined, 'POST', undefined, stream)).status, 401);
  assert.equal((await call(relay, owner.credential, packet(2, 2))).result.peers.some(peer => peer.actor.id === viewer.actor.id), false);
}));

test('well-formed Unicode remains valid and malformed member/scene strings cannot poison the native presence reply', async () => fixture(async context => {
  const { presence, owner } = context, member = context.member('viewer', 'Reader 😀');
  const outgoing = packet(1, 1, { state: { ...packet().state, pageId: 'Page 🛰️', selection: ['Layer 😀'] } }); assert.equal(engine.api.readPresenceResponse(presence.exchange(member.actor, outgoing), outgoing).actor.name, 'Reader 😀');
  for (const name of ['bad\ud800', 'bad\udc00', 'bad\u0080']) refused(() => context.member('editor', name), 422);
  for (const pageId of ['bad\ud800', 'bad\udc00']) refused(() => presence.exchange(owner.actor, packet(2, 1, { state: { ...packet().state, pageId } })), 422);
  assert.equal(presence.rooms.get(documentId).size, 1);
}));

test('invalid legacy member labels are preserved and isolated without making another member’s roster unreadable', async () => fixture(async context => {
  const { relay, presence, owner } = context, peer = context.member();
  presence.exchange(owner.actor, packet()); presence.exchange(peer.actor, packet(2));
  const changeName = relay.store.db.prepare('UPDATE members SET name=? WHERE id=?'); changeName.run('Old\u0080label', peer.actor.id);
  const outgoing = packet(1, 2), roster = engine.api.readPresenceResponse(presence.exchange(owner.actor, outgoing), outgoing);
  assert.deepEqual(roster.peers.map(item => item.actor.id), [owner.actor.id]);
  refused(() => presence.exchange(peer.actor, packet(2, 2)), 409);
  assert.equal(relay.store.db.prepare('SELECT name FROM members WHERE id=?').get(peer.actor.id).name, 'Old\u0080label');
  assert.equal(presence.rooms.get(documentId).get(`${peer.actor.id}/${client(2)}`).sequence, 1);
  changeName.run('Restored', peer.actor.id); const restored = packet(2, 2);
  assert.equal(engine.api.readPresenceResponse(presence.exchange(peer.actor, restored), restored).actor.name, 'Restored');
  changeName.run('', owner.actor.id); refused(() => presence.exchange(owner.actor, packet(1, 3)), 409);
  const healthy = packet(2, 3); assert.deepEqual(engine.api.readPresenceResponse(presence.exchange(peer.actor, healthy), healthy).peers.map(item => item.actor.id), [peer.actor.id]);
  assert.equal(relay.store.db.prepare('SELECT name FROM members WHERE id=?').get(owner.actor.id).name, '');
}));
