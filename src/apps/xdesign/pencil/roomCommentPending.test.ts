import { beforeEach, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
const host = vi.hoisted(() => ({ data: new Map<string, unknown>(), save: vi.fn() }));
vi.mock('@/lib/db', () => ({ getAppState: async (key: string) => structuredClone(host.data.get(key) ?? null), setAppState: async (key: string, value: unknown) => { await host.save(); host.data.set(key, structuredClone(value)); } }));
import { forgetPendingRoomComment, loadPendingRoomComment, readPendingRoomComment, rememberPendingRoomComment, roomCommentKey, type PendingRoomComment } from './roomCommentPending';
let projectId: string, pending: PendingRoomComment;
beforeEach(() => { host.data.clear(); host.save.mockReset(); projectId = ulid(); pending = { projectId, serverUrl: 'https://design.example/', actorId: 'membership_identity_001', packet: { version: 1, type: 'comment', documentId: 'document_identity_001', clientId: ulid(), requestId: ulid(), vector: 'AA==', command: { type: 'reply', threadId: 'thread_001', body: 'Review 🙂' } } }; });
it('round trips one immutable scoped command without a credential or checkpoint upload', async () => {
  expect(await loadPendingRoomComment(projectId)).toBeNull(); await rememberPendingRoomComment(pending);
  const saved = await loadPendingRoomComment(projectId); expect(saved).toEqual(pending); expect(Object.keys(saved!)).toEqual(['projectId', 'serverUrl', 'actorId', 'packet']);
  saved!.packet.command = { type: 'react', threadId: 'other', messageId: 'other', emoji: '👍' }; expect(await loadPendingRoomComment(projectId)).toEqual(pending);
  await rememberPendingRoomComment(pending); await forgetPendingRoomComment(pending); expect(await loadPendingRoomComment(projectId)).toBeNull();
});
it('serializes competing writes and refuses replacement or removal of a different command', async () => {
  const other = { ...pending, packet: { ...pending.packet, requestId: ulid() } };
  const results = await Promise.allSettled([rememberPendingRoomComment(pending), rememberPendingRoomComment(other)]); expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  await expect(forgetPendingRoomComment(other)).rejects.toThrow('changed'); expect(await loadPendingRoomComment(projectId)).toEqual(pending);
});
it('preserves unknown, corrupt, extra-field and foreign data and blocks writing over it', async () => {
  for (const value of [{ version: 2, pending }, { version: 1, pending, credential: 'forbidden' }, { version: 1, pending: { ...pending, projectId: ulid() } }, { version: 1, pending: { ...pending, packet: { ...pending.packet, author: pending.actorId } } }, { version: 1, pending: { ...pending, packet: { ...pending.packet, vector: 'AAA=' } } }]) {
    host.data.set(roomCommentKey(projectId), value); await expect(loadPendingRoomComment(projectId)).rejects.toThrow(); await expect(rememberPendingRoomComment(pending)).rejects.toThrow(); expect(host.data.get(roomCommentKey(projectId))).toEqual(value);
  }
});
it('pins origin and actor and preserves pending bytes when storage fails', async () => {
  for (const value of [{ ...pending, serverUrl: 'https://design.example/path' }, { ...pending, actorId: 'bad' }, { ...pending, credential: 'secret' }]) expect(() => readPendingRoomComment(value, projectId)).toThrow();
  await rememberPendingRoomComment(pending); host.save.mockRejectedValueOnce(new Error('Disk full')); await expect(forgetPendingRoomComment(pending)).rejects.toThrow('Disk full'); expect(await loadPendingRoomComment(projectId)).toEqual(pending);
});
