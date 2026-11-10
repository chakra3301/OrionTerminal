import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
import { SceneGraph } from '@open-pencil/scene-graph';
const host = vi.hoisted(() => ({ data: new Map<string, unknown>(), store: vi.fn() }));
vi.mock('@/lib/db', () => ({ getAppState: async (key: string) => structuredClone(host.data.get(key) ?? null), setAppState: async (key: string, value: unknown) => { await host.store(key); host.data.set(key, structuredClone(value)); } }));
import { RoomCommentClient, type RoomCommentContext, type RoomCommentState } from './roomCommentClient';
import { SharedDesign } from './sharedDesign';
import { RoomRequestFailure } from './sharedRoomConnection';
import { applyRoomCommentCommand } from './roomCommentCommands';
import { createCommentAnchor, allComments } from './comments';
import { roomBinary } from './sharedRoomProtocol';
import { loadPendingRoomComment, roomCommentKey } from './roomCommentPending';
import type { RoomCommentRequest } from './roomCommentProtocol';
let local: SharedDesign, peer: SharedDesign, client: RoomCommentClient, state: RoomCommentState, context: RoomCommentContext | null, projectId: string, current: boolean, revision: number, receipts: Map<string, { threadId: string; messageId?: string }>, nodeId: string;
const documentId = 'comment_document_001', actor = { id: 'comment_member_001', name: 'Reviewer', role: 'viewer' as const };
const save = vi.fn(), comment = vi.fn(), close = vi.fn(), accepted = vi.fn(), receive = vi.fn(), prepared = vi.fn(), applied = vi.fn(), restored = vi.fn();
function build() {
  return new RoomCommentClient(documentId, projectId, { replica: local, flush() {}, receive: async (bytes, options) => { receive(bytes); if (options?.signal?.aborted || options?.isCurrent && !options.isCurrent()) throw new Error('Late'); return local.receive(bytes, options?.admit); } }, {
    current: () => current, context: () => context, save, onState: next => { state = next; }, prepared, applied, restored, accepted: (actor, rev) => { accepted(actor, rev); context!.revision = rev; }, open: async () => ({ comment, dispose: close }),
  });
}
function add() { return { type: 'add' as const, pageId: local.graph.getPages()[0]!.id, anchor: createCommentAnchor(local.graph, local.graph.getPages()[0]!.id, [{ x: 10, y: 20 }]), body: 'A review' }; }
function response(packet: RoomCommentRequest, result: { threadId: string; messageId?: string }) { return { version: 1, type: 'comment', documentId, clientId: packet.clientId, requestId: packet.requestId, revision, acceptedRevision: 2, actor, vector: roomBinary(peer.stateVector(), true), update: roomBinary(peer.update()), result }; }
beforeEach(async () => {
  host.data.clear(); host.store.mockReset(); save.mockReset(); close.mockReset(); comment.mockReset(); accepted.mockReset(); receive.mockReset(); prepared.mockReset(); applied.mockReset(); restored.mockReset(); receipts = new Map(); current = true; revision = 2; projectId = ulid();
  const graph = new SceneGraph(), page = graph.getPages()[0]!.id; nodeId = graph.createNode('RECTANGLE', page, { x: 10, width: 100, height: 100 }).id; peer = SharedDesign.fromGraph(graph); local = SharedDesign.fromUpdate(peer.update()); context = { serverUrl: 'https://design.example/', actor, revision: 1, epoch: 0 };
  comment.mockImplementation(async (packet: RoomCommentRequest, _signal: AbortSignal, recoverOnly: boolean) => {
    const old = receipts.get(packet.requestId); if (old) return response(packet, old);
    if (recoverOnly) throw new RoomRequestFailure('No receipt', 404, 'receipt');
    expect((await loadPendingRoomComment(projectId))!.packet).toEqual(packet);
    const result = { threadId: `thread_${packet.requestId}`, messageId: `message_${packet.requestId}` };
    peer.edit('Server comment', graph => applyRoomCommentCommand(graph, packet.command, actor, result, 1000)); receipts.set(packet.requestId, result); return response(packet, result);
  });
  client = build(); await client.initialize();
});
afterEach(() => { client.dispose(); local.dispose(); peer.dispose(); });
it('applies server-authored viewer comments after durable dispatch without artwork upload or local history', async () => {
  local.edit('Unsent artwork', graph => graph.updateNode(nodeId, { x: 999 })); const result = await client.submit(add());
  expect(allComments(local.graph)[0]!.id).toBe(result.threadId); expect(allComments(local.graph)[0]!.messages[0]!.createdAt).toBe(1000); expect(allComments(local.graph)[0]!.messages[0]!.author.id).toBe(actor.id);
  expect(peer.graph.getNode(nodeId)!.x).toBe(10); expect(local.graph.getNode(nodeId)!.x).toBe(999); expect(local.canUndo).toBe(true);
  local.undoOne(); expect(local.graph.getNode(nodeId)!.x).toBe(10); expect(allComments(local.graph)).toHaveLength(1);
  expect(comment.mock.calls.map(call => call[2])).toEqual([true, false]); expect(save).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(await loadPendingRoomComment(projectId)).toBeNull(); expect(state.phase).toBe('ready');
});
it('recovers a lost accepted reply on a reopened controller without executing the command again', async () => {
  const normal = comment.getMockImplementation()!; comment.mockImplementation(async (...args) => { const result = await normal(...args); if (!args[2]) throw new RoomRequestFailure('Unknown outcome', 504, 'timeout'); return result; });
  await expect(client.submit(add())).rejects.toThrow('Unknown outcome'); const pending = await loadPendingRoomComment(projectId); expect(pending).not.toBeNull(); expect(allComments(local.graph)).toEqual([]);
  client.dispose(); client = build(); await client.initialize(); expect(state.pending).toEqual(pending); expect(restored).toHaveBeenCalledWith(pending); const result = await client.recover(); expect(result.threadId).toBe(receipts.get(pending!.packet.requestId)!.threadId);
  expect(comment.mock.calls.filter(call => !call[2])).toHaveLength(1); expect(allComments(local.graph)).toHaveLength(1); expect(await loadPendingRoomComment(projectId)).toBeNull();
});
it('keeps accepted receipts through checkpoint, pending-removal and publication failures', async () => {
  save.mockRejectedValueOnce(new Error('Checkpoint disk full')); await expect(client.submit(add())).rejects.toThrow('Checkpoint disk full'); expect(allComments(local.graph)).toHaveLength(1); expect(state.phase).toBe('pending');
  host.store.mockRejectedValueOnce(new Error('Pending disk full')); await expect(client.recover()).rejects.toThrow('Pending disk full'); expect(await loadPendingRoomComment(projectId)).not.toBeNull();
  await client.recover(); expect(comment.mock.calls.filter(call => !call[2])).toHaveLength(1); expect(save).toHaveBeenCalledTimes(3); expect(state.pending).toBeNull();
});
it('refuses dispatch on storage failure, unknown 404, mismatched actor, revision and incomplete applied vector', async () => {
  host.store.mockRejectedValueOnce(new Error('Disk full')); await expect(client.submit(add())).rejects.toThrow('Disk full'); expect(comment).not.toHaveBeenCalled();
  comment.mockRejectedValue(new RoomRequestFailure('Older service', 404, 'http')); await expect(client.submit(add())).rejects.toThrow('Older service'); expect(comment.mock.calls.map(call => call[2])).toEqual([true]); expect(state.pending).not.toBeNull();
  const pending = state.pending!;
  for (const change of [{ actor: { ...actor, id: 'another_member_001' } }, { revision: 1, acceptedRevision: 1 }, { update: roomBinary(new Uint8Array([0, 0])) }]) {
    context!.revision = 2; peer.edit('Other peer', graph => graph.updateNode(nodeId, { y: 42 })); comment.mockResolvedValue({ ...response(pending.packet, { threadId: 'accepted_thread', messageId: 'accepted_message' }), ...change }); await expect(client.recover()).rejects.toThrow(); expect(state.pending).not.toBeNull();
  }
  expect(allComments(local.graph)).toEqual([]); expect(accepted).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
it('aborts a project or membership change and retains immutable pending bytes for the original member', async () => {
  let release!: (value: unknown) => void; comment.mockImplementation(() => new Promise(resolve => { release = resolve; })); const work = client.submit(add()); await vi.waitFor(() => expect(release).toBeDefined());
  const pending = state.pending!; context = { ...context!, actor: { ...actor, id: 'other_member_001' } }; client.refresh(); release(response(pending.packet, { threadId: 'accepted_thread', messageId: 'accepted_message' })); await expect(work).rejects.toThrow('room changed'); expect(receive).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  await expect(client.recover()).rejects.toThrow('original room member'); expect(await loadPendingRoomComment(projectId)).toEqual(pending);
});
it('serializes rapid requests and keeps recovery usable after a scoped disconnect/reconnect', async () => {
  let release!: () => void; save.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })); const work = client.submit(add()); await vi.waitFor(() => expect(release).toBeDefined());
  await expect(client.submit(add())).rejects.toThrow('pending'); context = null; client.refresh(); release(); await expect(work).rejects.toThrow('room changed');
  context = { serverUrl: 'https://design.example/', actor, revision, epoch: 1 }; await client.recover(); expect(comment.mock.calls.filter(call => !call[2])).toHaveLength(1);
});
it('preserves corrupt data and never dispatches until it can be loaded', async () => {
  client.dispose(); const corrupt = { version: 2, pending: { secret: 'preserved' } }; host.data.set(roomCommentKey(projectId), corrupt); client = build(); await client.initialize(); expect(state.phase).toBe('error'); await expect(client.submit(add())).rejects.toThrow('restoring'); expect(comment).not.toHaveBeenCalled(); expect(host.data.get(roomCommentKey(projectId))).toEqual(corrupt);
});
it('explicit discard only removes the local outbox and preserves an accepted server comment', async () => {
  save.mockRejectedValueOnce(new Error('Disk full')); await expect(client.submit(add())).rejects.toThrow(); expect(state.error).toBe('Disk full'); await client.discard(); expect(state.error).toBeNull(); expect(await loadPendingRoomComment(projectId)).toBeNull(); expect(allComments(peer.graph)).toHaveLength(1); expect(allComments(local.graph)).toHaveLength(1); expect(comment).toHaveBeenCalledTimes(2);
});
it('reserves the action before durable dispatch and reports admitted receipts before saving or clearing pending state', async () => {
  prepared.mockImplementation(() => { expect(comment).not.toHaveBeenCalled(); expect(host.data.has(roomCommentKey(projectId))).toBe(false); });
  applied.mockImplementation((pending, receipt) => { expect(allComments(local.graph)[0]!.id).toBe(receipt.result.threadId); expect(state.pending).toEqual(pending); expect(accepted).toHaveBeenCalled(); });
  save.mockImplementationOnce(async () => { expect(applied).toHaveBeenCalledOnce(); throw new Error('Checkpoint full'); });
  await expect(client.submit(add())).rejects.toThrow('Checkpoint full'); await client.recover();
  expect(prepared).toHaveBeenCalledOnce(); expect(applied).toHaveBeenCalledTimes(2); expect(applied.mock.calls[1]![0]).toEqual(applied.mock.calls[0]![0]); expect(state.pending).toBeNull();
});
