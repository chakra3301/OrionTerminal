import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { SceneGraph } from '@open-pencil/scene-graph';
import { SharedDesign } from './sharedDesign';
import { SharedEditorBinding, type SharedEditorOptions } from './sharedEditor';
import { RoomRequestFailure, SharedRoomConnection, type RoomConnectionOptions } from './sharedRoomConnection';
import { readRoomRequest, roomBinary, type RoomActor, type RoomRequest } from './sharedRoomProtocol';
import { serializeGraph } from './graphDocument';

const replicas: SharedDesign[] = [], editors: Editor[] = [], connections: SharedRoomConnection[] = [];
const own = (replica: SharedDesign) => { replicas.push(replica); return replica; };
const documentId = 'room_document_000001';
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const step = async (ms = 0) => { await tick(); await vi.advanceTimersByTimeAsync(ms); await tick(); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { connections.splice(0).forEach(room => room.dispose()); editors.splice(0).forEach(editor => editor.dispose()); replicas.splice(0).forEach(replica => replica.dispose()); vi.useRealTimers(); });
function setup(bindingOptions: SharedEditorOptions = {}, connectionOptions: Partial<RoomConnectionOptions> = {}) {
  const graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0]!.id, { x: 10, y: 20, width: 100, height: 80 });
  const replica = own(SharedDesign.fromGraph(graph)), server = own(SharedDesign.fromUpdate(replica.update()));
  const editor = createEditor({ graph }); editors.push(editor); const binding = new SharedEditorBinding(editor, replica, bindingOptions);
  let actor: RoomActor = { id: 'member_identity_001', name: 'Designer', role: 'editor' }, revision = 1;
  const calls: Readonly<RoomRequest>[] = [], receipts = new Map<string, number>();
  const respond = (packet: Readonly<RoomRequest>) => {
    const parsed = readRoomRequest(packet);
    if (packet.type === 'update' && !receipts.has(packet.requestId)) {
      if (actor.role === 'viewer') throw new RoomRequestFailure('View-only membership.', 403, 'readonly');
      const before = roomBinary(server.update()); server.receive(parsed.update!); if (roomBinary(server.update()) !== before) revision++;
      receipts.set(packet.requestId, revision);
    }
    return { ...packet, type: packet.type === 'update' ? 'ack' : 'sync', revision, actor: { ...actor }, vector: roomBinary(server.stateVector(), true), update: roomBinary(server.update(parsed.vector)), ...(packet.type === 'update' ? { acceptedRevision: receipts.get(packet.requestId) } : {}) };
  };
  const request = vi.fn(async (packet: Readonly<RoomRequest>, signal: AbortSignal): Promise<unknown> => { calls.push(packet); return connectionOptions.request ? connectionOptions.request(packet, signal) : respond(packet); });
  const room = new SharedRoomConnection(documentId, binding, { ...connectionOptions, request, pollMilliseconds: 250 }); connections.push(room);
  return { node, graph, replica, server, editor, binding, room, calls, request, respond, setActor: (value: Partial<RoomActor>) => { actor = { ...actor, ...value }; }, peer: (work: (graph: SceneGraph) => void) => { server.edit('Peer', work); revision++; } };
}
describe('shared room provider with actual editor history', () => {
  it('does not let an older in-flight artwork reply undo a newer comment revision or viewer downgrade', async () => {
    const context = setup(); context.room.connect(); await step(); let release!: (value: unknown) => void;
    context.request.mockImplementationOnce(packet => { context.calls.push(packet); return new Promise(resolve => { release = resolve; }); });
    context.room.syncNow(); await step(); const old = context.respond(context.calls.at(-1)!);
    context.peer(graph => graph.updateNode(context.node.id, { width: 200 })); context.setActor({ role: 'viewer' });
    context.room.observeCommentReceipt({ id: 'member_identity_001', name: 'Reviewer', role: 'viewer' }, 2);
    expect(context.room.state).toMatchObject({ phase: 'readonly', revision: 2, actor: { role: 'viewer' } });
    release(old); await step(5); expect(context.room.state).toMatchObject({ phase: 'readonly', revision: 2, actor: { role: 'viewer' } }); expect(context.node.width).toBe(200); expect(context.room.state.error).toBeNull();
  });
  it('does not promote artwork access from a comment receipt and preserves a lost artwork upload', async () => {
    const context = setup(); context.room.connect(); await step(); let release!: (value: unknown) => void;
    context.request.mockImplementationOnce(packet => { context.calls.push(packet); return new Promise(resolve => { release = resolve; }); });
    context.editor.updateNodeWithUndo(context.node.id, { x: 70 }); await step(); const outgoing = context.calls.at(-1)!, old = context.respond(outgoing);
    context.peer(graph => graph.updateNode(context.node.id, { width: 300 })); context.room.observeCommentReceipt({ id: 'member_identity_001', name: 'Designer', role: 'editor' }, 3);
    release(old); await step(5); expect(context.calls.filter(packet => packet.type === 'update').at(-1)).toBe(outgoing); expect(context.room.state).toMatchObject({ phase: 'online', unsent: false, revision: 3 }); context.editor.undoAction(); expect(context.node).toMatchObject({ x: 10, width: 300 });
    context.setActor({ role: 'viewer' }); await step(250); context.room.observeCommentReceipt({ id: 'member_identity_001', name: 'Designer', role: 'owner' }, 3); expect(context.room.state.actor!.role).toBe('viewer');
    expect(() => context.room.observeCommentReceipt({ id: 'other_member_001', name: 'Foreign', role: 'viewer' }, 3)).toThrow(); expect(() => context.room.observeCommentReceipt(context.room.state.actor!, 2)).toThrow();
  });
  it('confirms a clean checkpoint without uploading, polls peer artwork and preserves view', async () => {
    const context = setup(); context.editor.state.panX = 350; context.room.connect(); await step();
    expect(context.room.state).toMatchObject({ phase: 'online', unsent: false, revision: 1 }); expect(context.calls.every(packet => packet.type === 'sync')).toBe(true);
    context.peer(graph => graph.updateNode(context.node.id, { width: 250 })); await step(250);
    expect(context.node.width).toBe(250); expect(context.editor.state.panX).toBe(350); expect(context.editor.undo.canUndo).toBe(false);
  });
  it('avoids repeated canvas publication for identical admitted polls and applies deletion-only peer changes', async () => {
    const publish = vi.fn(), context = setup({ publish }), receive = vi.spyOn(context.binding, 'receive');
    context.peer(graph => graph.images.set('peer-image', new Uint8Array([1, 2, 3]))); context.room.connect(); await step(); await step(250); const count = publish.mock.calls.length;
    await step(750); expect(publish).toHaveBeenCalledTimes(count); expect(receive).toHaveBeenCalledTimes(2);
    const vector = context.server.stateVector(); context.peer(graph => graph.images.delete('peer-image')); expect(context.server.stateVector()).toEqual(vector); await step(250);
    expect(context.replica.graph.images.has('peer-image')).toBe(false); expect(publish).toHaveBeenCalledTimes(count + 1); expect(context.room.state.phase).toBe('online');
  });
  it('uploads offline edits and selective undo retains concurrent peer properties', async () => {
    const context = setup(); context.editor.updateNodeWithUndo(context.node.id, { x: 240 }); await tick(); context.peer(graph => graph.updateNode(context.node.id, { width: 310 }));
    context.room.connect(); await step(); expect(context.server.graph.getNode(context.node.id)).toMatchObject({ x: 240, width: 310 }); expect(context.room.state.unsent).toBe(false);
    context.editor.undoAction(); await step(); expect(context.server.graph.getNode(context.node.id)).toMatchObject({ x: 10, width: 310 }); context.editor.redoAction(); await step(); expect(context.server.graph.getNode(context.node.id)!.x).toBe(240);
  });
  it('retries an immutable lost acknowledgement and retains newer edits for a separate upload', async () => {
    const context = setup(); let lose = true;
    context.request.mockImplementation(async packet => { context.calls.push(packet); const reply = context.respond(packet); if (packet.type === 'update' && lose) { lose = false; throw new Error('Response lost'); } return reply; });
    context.room.connect(); await step(); context.editor.updateNodeWithUndo(context.node.id, { x: 60 }); await step();
    const first = context.calls.find(packet => packet.type === 'update')!; expect(Object.isFrozen(first)).toBe(true); expect(context.room.state).toMatchObject({ phase: 'retrying', unsent: true, attempt: 1 });
    context.editor.updateNodeWithUndo(context.node.id, { y: 90 }); await step(499); expect(context.calls.filter(packet => packet.type === 'update')).toHaveLength(1);
    await step(1); await step(5); const uploads = context.calls.filter(packet => packet.type === 'update'); expect(uploads).toHaveLength(3); expect(uploads[1]).toBe(first); expect(uploads[2]!.requestId).not.toBe(first.requestId);
    expect(context.room.state.unsent).toBe(false); expect(context.server.graph.getNode(context.node.id)).toMatchObject({ x: 60, y: 90 }); context.editor.undoAction(); await step(); expect(context.node.y).toBe(20);
  });
  it('waits for an uncancelable old request before reconnecting and ignores its late response', async () => {
    const context = setup(); let release!: (value: unknown) => void, active = 0, maximum = 0, oldSignal: AbortSignal | undefined;
    context.request.mockImplementationOnce((packet, signal) => { context.calls.push(packet); oldSignal = signal; active++; maximum = Math.max(maximum, active); return new Promise(resolve => { release = value => { active--; resolve(value); }; }); });
    context.room.connect(); await tick(); context.peer(graph => graph.updateNode(context.node.id, { width: 260 })); const late = context.respond(context.calls[0]!);
    context.room.disconnect(); expect(oldSignal!.aborted).toBe(true); context.editor.updateNodeWithUndo(context.node.id, { x: 85 }); await tick(); context.room.connect(); await step(); expect(context.calls).toHaveLength(1); expect(context.node.width).toBe(100);
    release(late); await step(5); expect(maximum).toBe(1); expect(context.node).toMatchObject({ x: 85, width: 260 }); expect(context.room.state.unsent).toBe(false);
  });
  it('cancels a queued peer update while a local batch is active and retains its local undo', async () => {
    const context = setup(); context.room.connect(); await step(); context.editor.undo.beginBatch('Local batch'); context.editor.updateNodeWithUndo(context.node.id, { x: 75 });
    context.peer(graph => graph.updateNode(context.node.id, { width: 270 })); context.room.syncNow(); await step(); expect(context.node.width).toBe(100);
    context.room.disconnect(); await tick(); context.editor.undo.commitBatch(); await step(); expect(context.node).toMatchObject({ x: 75, width: 100 }); context.editor.undoAction(); expect(context.node.x).toBe(10);
    context.room.connect(); await step(); expect(context.node.width).toBe(270); expect(context.room.state.unsent).toBe(false);
  });
  it('ignores a valid response when its source project is no longer current', async () => {
    let current = true; const context = setup({}, { isCurrent: () => current }); let release!: (value: unknown) => void;
    context.request.mockImplementationOnce(packet => { context.calls.push(packet); return new Promise(resolve => { release = resolve; }); }); context.room.connect(); await tick();
    context.peer(graph => graph.updateNode(context.node.id, { x: 450 })); current = false; release(context.respond(context.calls[0]!)); await step();
    expect(context.node.x).toBe(10); expect(context.room.state.phase).toBe('disconnected'); expect(() => context.room.connect()).toThrow('no longer active');
  });
  it.each(['documentId', 'clientId', 'requestId'])('refuses a response for another %s before applying artwork', async field => {
    const context = setup(); context.request.mockImplementation(async packet => { context.calls.push(packet); return { ...context.respond(packet), [field]: 'other_identity_00001' }; });
    context.peer(graph => graph.updateNode(context.node.id, { x: 450 })); context.room.connect(); await step(10_000);
    expect(context.room.state.phase).toBe('error'); expect(context.calls).toHaveLength(1); expect(context.node.x).toBe(10);
  });
  it('refuses a backward room revision or changed membership without replacing the local graph', async () => {
    const context = setup(); context.room.connect(); await step(); context.setActor({ id: 'another_member_0001' }); context.room.syncNow(); await step(); expect(context.room.state.error).toContain('different membership');
    const second = setup({}, { minimumRevision: 20 }); second.room.connect(); await step(); expect(second.room.state.error).toContain('moved backwards'); expect(second.node.x).toBe(10);
  });
  it('rejects an acknowledgement that does not cover the upload and keeps local state unsent', async () => {
    const context = setup(); context.room.connect(); await step(); context.request.mockImplementation(async packet => { context.calls.push(packet); return { ...context.respond(packet), vector: 'AA==' }; });
    context.editor.updateNodeWithUndo(context.node.id, { x: 99 }); await step(); expect(context.room.state).toMatchObject({ phase: 'error', unsent: true }); expect(context.node.x).toBe(99); context.editor.undoAction(); expect(context.node.x).toBe(10);
  });
  it('refuses a falsely advertised missing remote clock before publication', async () => {
    const context = setup(), other = own(SharedDesign.fromUpdate(context.server.update())); other.edit('Missing', graph => graph.updateNode(context.node.id, { width: 500 }));
    context.request.mockImplementation(async packet => { context.calls.push(packet); return { ...context.respond(packet), vector: roomBinary(other.stateVector(), true) }; });
    const before = serializeGraph(context.replica.graph); context.room.connect(); await step(); expect(context.room.state.phase).toBe('error'); expect(serializeGraph(context.replica.graph)).toBe(before); expect(context.node.width).toBe(100);
  });
  it('retains the exact upload after failed local publication and recovers its durable acknowledgement', async () => {
    let fail = false; const context = setup({ publish: () => { if (fail) throw new Error('Local save failed'); } }); context.room.connect(); await step();
    context.request.mockImplementation(async packet => { context.calls.push(packet); const reply = context.respond(packet); if (packet.type === 'update') fail = true; return reply; });
    context.editor.updateNodeWithUndo(context.node.id, { x: 63 }); await step(); expect(context.room.state).toMatchObject({ phase: 'error', unsent: true }); const upload = context.calls.find(packet => packet.type === 'update')!;
    fail = false; context.request.mockImplementation(async packet => { context.calls.push(packet); return context.respond(packet); }); context.room.connect(); await step();
    expect(context.calls.filter(packet => packet.type === 'update').at(-1)).toBe(upload); expect(context.room.state.unsent).toBe(false); context.editor.undoAction(); expect(context.node.x).toBe(10);
  });
  it('does not upload local artwork with a viewer grant and recovers a later editor grant', async () => {
    const context = setup(); context.setActor({ role: 'viewer' }); context.editor.updateNodeWithUndo(context.node.id, { x: 82 }); await tick(); context.room.connect(); await step(1000);
    expect(context.room.state).toMatchObject({ phase: 'readonly', unsent: true }); expect(context.calls.every(packet => packet.type === 'sync')).toBe(true); expect(context.node.x).toBe(82); expect(context.server.graph.getNode(context.node.id)!.x).toBe(10);
    context.setActor({ role: 'editor' }); await step(250); await step(5); expect(context.server.graph.getNode(context.node.id)!.x).toBe(82); expect(context.room.state.unsent).toBe(false);
  });
  it('stops new uploads after a role downgrade without discarding the pending packet', async () => {
    const context = setup(); context.room.connect(); await step(); context.setActor({ role: 'viewer' }); context.editor.updateNodeWithUndo(context.node.id, { x: 83 }); await step(1000);
    const upload = context.calls.find(packet => packet.type === 'update')!; expect(context.calls.filter(packet => packet.type === 'update')).toHaveLength(1); expect(context.room.state).toMatchObject({ phase: 'readonly', unsent: true });
    context.setActor({ role: 'editor' }); await step(250); expect(context.calls.filter(packet => packet.type === 'update').at(-1)).toBe(upload); expect(context.room.state.unsent).toBe(false);
  });
  it('stops authorization failures until explicit retry, preserving offline local edits', async () => {
    const context = setup(); context.room.connect(); await step(); context.request.mockImplementation(async packet => { context.calls.push(packet); throw new RoomRequestFailure('Membership unavailable.', 401, 'unauthorized'); });
    context.editor.updateNodeWithUndo(context.node.id, { x: 91 }); await step(20_000); const count = context.calls.length; expect(context.room.state).toMatchObject({ phase: 'error', unsent: true }); context.editor.updateNodeWithUndo(context.node.id, { y: 95 }); await step(20_000); expect(context.calls).toHaveLength(count);
    context.request.mockImplementation(async packet => { context.calls.push(packet); return context.respond(packet); }); context.room.connect(); await step(5); expect(context.server.graph.getNode(context.node.id)).toMatchObject({ x: 91, y: 95 });
  });
  it('resynchronizes dependency conflicts with a new full checkpoint request and bounds repeated conflicts', async () => {
    const context = setup(); context.room.connect(); await step(); let once = true;
    context.request.mockImplementation(async packet => { context.calls.push(packet); if (packet.type === 'update' && once) { once = false; throw new RoomRequestFailure('Resynchronize.', 409, 'dependencies'); } return context.respond(packet); });
    context.editor.updateNodeWithUndo(context.node.id, { x: 74 }); await step(5); const uploads = context.calls.filter(packet => packet.type === 'update'); expect(uploads).toHaveLength(2); expect(uploads[1]!.requestId).not.toBe(uploads[0]!.requestId);
    const complete = own(SharedDesign.fromUpdate(readRoomRequest(uploads[1]).update!)); expect(complete.graph.getNode(context.node.id)!.x).toBe(74); expect(context.room.state.unsent).toBe(false);
    const second = setup(); second.room.connect(); await step(); second.request.mockImplementation(async packet => { second.calls.push(packet); if (packet.type === 'update') throw new RoomRequestFailure('Resynchronize.', 409, 'dependencies'); return second.respond(packet); }); second.editor.updateNodeWithUndo(second.node.id, { x: 76 }); await step(10_000);
    expect(second.room.state.phase).toBe('error'); expect(second.calls.filter(packet => packet.type === 'update')).toHaveLength(3);
  });
  it('propagates deletion-only changes and keeps independent observers from changing internal state', async () => {
    const context = setup({}, { onState: state => { if (state.actor) state.actor.role = 'viewer'; throw new Error('Observer'); } }); context.room.connect(); await step();
    context.editor.graph.images.set('image-resource', new Uint8Array([1, 2, 3])); context.binding.flush(); await step(); const vector = context.replica.stateVector();
    context.editor.graph.images.delete('image-resource'); context.binding.flush(); await step(); expect(context.replica.stateVector()).toEqual(vector); expect(context.server.graph.images.has('image-resource')).toBe(false); expect(context.room.state).toMatchObject({ phase: 'online', unsent: false, actor: { role: 'editor' } });
  });
  it('honors a new refresh requested during an earlier request and releases every timer/subscription on close', async () => {
    const context = setup(); let release!: (value: unknown) => void;
    context.request.mockImplementationOnce(packet => { context.calls.push(packet); return new Promise(resolve => { release = resolve; }); }); context.room.connect(); await tick(); context.room.syncNow(); release(context.respond(context.calls[0]!)); await step();
    expect(context.calls.filter(packet => packet.vector === 'AA==')).toHaveLength(2); context.room.dispose(); await step(10_000); expect(context.room.state.phase).toBe('closed'); const count = context.calls.length; context.editor.updateNodeWithUndo(context.node.id, { x: 120 }); await step(10_000); expect(context.calls).toHaveLength(count); expect(vi.getTimerCount()).toBe(0); expect(() => context.room.connect()).toThrow('closed');
  });
  it('keeps disconnect and close idempotent when observers close the connection reentrantly', async () => {
    const context = setup(), phases: string[] = []; context.room.connect(); await step();
    context.room.subscribe(state => { phases.push(state.phase); if (state.phase === 'disconnected' || state.phase === 'closed') context.room.dispose(); });
    context.room.disconnect(); context.room.disconnect(); context.room.dispose(); await step(1000);
    expect(phases).toEqual(['disconnected', 'closed']); expect(context.room.state.phase).toBe('closed'); expect(vi.getTimerCount()).toBe(0);
  });
});
