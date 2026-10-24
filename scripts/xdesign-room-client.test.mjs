import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { SceneGraph } from '@open-pencil/scene-graph';
import { roomEngine } from './xdesign-room-engine.mjs';
import { createRoomRelay } from './xdesign-room-relay.mjs';

let engine;
before(async () => { engine = await roomEngine({ includeClient: true }); });
after(async () => {
  if (engine && process.env.XDESIGN_ROOM_CLIENT_EVIDENCE) await writeFile(process.env.XDESIGN_ROOM_CLIENT_EVIDENCE, JSON.stringify({ node: process.version, transport: 'actual Node stream handler; no socket; replica adapter, no canvas', bundleBytes: engine.bytes, bundleSha256: engine.sourceSha256, inputs: engine.inputs, notices: engine.notices, warnings: engine.warnings }, null, 2) + '\n');
});
async function until(check) { const stop = Date.now() + 5000; while (!check()) { if (Date.now() > stop) throw new Error('Room fixture did not reach its expected state.'); await new Promise(resolve => setTimeout(resolve, 5)); } }
const documentId = 'room_document_000001';
async function fixture(work) {
  const folder = await mkdtemp(join(tmpdir(), 'orion-room-client-')), database = join(folder, 'rooms.sqlite'), administrator = randomUUID(), replicas = [], rooms = [];
  let relay, active = 0;
  const own = value => { replicas.push(value); return value; };
  try {
    const graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0].id, { x: 10, y: 20, width: 100 });
    const replica = own(engine.api.SharedDesign.fromGraph(graph)); relay = await createRoomRelay({ database, adminSecret: administrator, engine });
    const owner = relay.store.create(documentId, 'Design', 'Owner', replica.update()), listeners = new Set(), packets = [];
    const binding = {
      replica, flush() {}, subscribeUpdates(callback) { listeners.add(callback); return () => listeners.delete(callback); },
      async receive(bytes, options) { if (options.signal?.aborted || !options.isCurrent()) throw new Error('Canceled fixture admission.'); return replica.receive(bytes, options.admit); },
      edit(label, update) { const change = replica.edit(label, update); for (const callback of listeners) callback(change); },
    };
    let credential = owner.credential, loseResponse = false;
    const request = async (packet, signal) => {
      packets.push(packet); active++;
      try {
        const stream = Readable.from([Buffer.from(JSON.stringify(packet))]); Object.assign(stream, { method: 'POST', url: `/v1/rooms/${documentId}/sync`, headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, socket: { remoteAddress: 'unit-fixture' } });
        let status, value; await relay.handle(stream, { destroyed: false, writeHead(code) { status = code; }, end(bytes) { value = JSON.parse(bytes); } });
        if (status !== 200) throw new engine.api.RoomRequestFailure(value.message, status, value.error);
        if (packet.type === 'update' && loseResponse) { loseResponse = false; throw new Error('Lost fixture response.'); }
        if (signal.aborted) throw new Error('Canceled fixture response.'); return value;
      } finally { active--; }
    };
    const room = new engine.api.SharedRoomConnection(documentId, binding, { request, pollMilliseconds: 250 }); rooms.push(room);
    await work({ binding, room, node: node.id, owner, packets, own, get relay() { return relay; }, setCredential(value) { credential = value; }, loseNextUpload() { loseResponse = true; }, async restart() { await until(() => active === 0); await relay.close(); relay = await createRoomRelay({ database, adminSecret: administrator, engine }); } });
  } finally { rooms.forEach(room => room.dispose()); await until(() => active === 0); await relay?.close(); replicas.forEach(replica => replica.dispose()); await rm(folder, { recursive: true, force: true }); }
}
test('actual bundled client resumes an immutable lost receipt across real SQLite restart and sends newer edits separately', () => fixture(async context => {
  context.room.connect(); await until(() => context.room.state.phase === 'online');
  context.loseNextUpload(); context.binding.edit('X', graph => graph.updateNode(context.node, { x: 135 })); await until(() => context.room.state.phase === 'retrying');
  const initial = context.packets.find(packet => packet.type === 'update'); await context.restart(); context.binding.edit('Y', graph => graph.updateNode(context.node, { y: 96 })); context.room.connect();
  await until(() => context.room.state.phase === 'online' && !context.room.state.unsent);
  const uploads = context.packets.filter(packet => packet.type === 'update'); assert.equal(uploads.length, 3); assert.ok(uploads[1] === initial); assert.notEqual(uploads[2].requestId, initial.requestId);
  const saved = context.relay.store.db.prepare('SELECT checkpoint,revision FROM rooms WHERE id=?').get(documentId), check = context.own(engine.api.SharedDesign.fromUpdate(saved.checkpoint));
  assert.equal(saved.revision, 3); assert.equal(check.graph.getNode(context.node).x, 135); assert.equal(check.graph.getNode(context.node).y, 96);
  assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 2);
}));
test('actual room roles block provider uploads, then reauthorization synchronizes retained local state', () => fixture(async context => {
  const viewer = context.relay.store.invite(documentId, context.owner.actor, 'Viewer', 'viewer'); context.setCredential(viewer.credential); context.room.connect(); await until(() => context.room.state.phase === 'readonly');
  context.binding.edit('Local retained', graph => graph.updateNode(context.node, { x: 224 })); await new Promise(resolve => setTimeout(resolve, 280)); assert.ok(context.room.state.unsent); assert.ok(context.packets.every(packet => packet.type === 'sync'));
  context.relay.store.changeMember(documentId, context.owner.actor, viewer.actor.id, 'editor'); context.room.syncNow(); await until(() => context.room.state.phase === 'online' && !context.room.state.unsent);
  const saved = context.own(engine.api.SharedDesign.fromUpdate(context.relay.store.db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint)); assert.equal(saved.graph.getNode(context.node).x, 224); assert.equal(context.room.state.actor.id, viewer.actor.id);
}));
test('an older restored server checkpoint cannot silently roll back a previously confirmed client', () => fixture(async context => {
  const original = context.binding.replica.update(); context.room.connect(); await until(() => context.room.state.phase === 'online'); context.binding.edit('Confirmed', graph => graph.updateNode(context.node, { x: 345 })); await until(() => !context.room.state.unsent && context.room.state.revision === 2);
  context.relay.store.db.prepare('UPDATE rooms SET checkpoint=?,digest=?,revision=1 WHERE id=?').run(original, createHash('sha256').update(original).digest('hex'), documentId);
  context.room.syncNow(); await until(() => context.room.state.phase === 'error'); assert.match(context.room.state.error, /moved backwards/); assert.equal(context.binding.replica.graph.getNode(context.node).x, 345);
  assert.equal(context.relay.store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(documentId).revision, 1);
}));
test('a rejected hidden comment upload retains local artwork while a separate authenticated sync opens clean server state',()=>fixture(async context=>{
  const reviewer=context.relay.store.invite(documentId,context.owner.actor,'Reviewer','editor'),page=context.binding.replica.graph.getPages()[0].id;
  context.relay.store.comment(reviewer.actor,{version:1,type:'comment',documentId,clientId:'reviewer_client_001',requestId:randomUUID(),vector:'AA==',command:{type:'add',pageId:page,anchor:{format:'local',points:[{x:10,y:20}],fallback:[{x:10,y:20}]},body:'Original feedback'}});
  context.room.connect();await until(()=>context.room.state.phase==='online');
  const thread=engine.api.allComments(context.binding.replica.graph)[0];
  const write=(graph,body,x)=>{const node=graph.getNode(thread.ownerPageId),data=JSON.parse(node.pluginData.find(entry=>entry.pluginId==='orion.xdesign.comments'&&entry.key==='threads').value);data.threads[0].messages[0].body=body;graph.updateNode(node.id,{pluginData:[{pluginId:'orion.xdesign.comments',key:'threads',value:JSON.stringify(data)}]});if(x!==undefined)graph.updateNode(context.node,{x});};
  context.binding.edit('Foreign intermediate',graph=>write(graph,'Hidden unauthorized feedback'));context.binding.edit('Restored feedback and local artwork',graph=>write(graph,'Original feedback',777));await until(()=>context.room.state.phase==='error');
  assert.ok(context.room.state.unsent);const local=context.binding.replica.update();assert.equal(context.binding.replica.graph.getNode(context.node).x,777);
  const saved=context.relay.store.db.prepare('SELECT checkpoint,revision FROM rooms WHERE id=?').get(documentId),receipts=context.relay.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n;
  assert.equal(saved.revision,2);assert.equal(receipts,1);context.room.disconnect();
  const outgoing={version:1,type:'sync',documentId,clientId:'recovery_client_001',requestId:randomUUID(),vector:'AA=='},reply=context.relay.store.exchange(context.owner.actor,outgoing),parsed=engine.api.readRoomResponse(reply,outgoing),clean=context.own(engine.api.SharedDesign.fromUpdate(parsed.update));
  assert.equal(clean.graph.getNode(context.node).x,10);assert.equal(engine.api.allComments(clean.graph)[0].messages[0].body,'Original feedback');assert.deepEqual(context.binding.replica.update(),local);assert.equal(context.room.state.unsent,true);
  const copy=context.own(engine.api.SharedDesign.fromUpdate(local));assert.equal(copy.graph.getNode(context.node).x,777);assert.equal(engine.api.allComments(copy.graph)[0].messages[0].body,'Original feedback');assert.equal(context.relay.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n,receipts);
}));
