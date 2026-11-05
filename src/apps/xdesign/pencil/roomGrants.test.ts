import { beforeEach, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
import { forgetRoomGrant, loadRoomGrants, rememberRoomGrant, roomGrantKey, roomGrantState, type PendingRoomInvitation, type PendingRoomAuthorGrant } from './roomGrants';
const db = vi.hoisted(() => ({ data: new Map<string, unknown>(), write: vi.fn() }));
vi.mock('@/lib/db', () => ({ getAppState: async (key: string) => structuredClone(db.data.get(key) ?? null), setAppState: async (key: string, value: unknown) => { await db.write(); db.data.set(key, structuredClone(value)); } }));
const projectId = ulid(), scope = { projectId, documentId: ulid(), serverUrl: 'https://rooms.example.test/', ownerId: ulid() };
const invitation = (name = 'Designer'): PendingRoomInvitation => ({ ...scope, requestId: ulid(), kind: 'invite', name, role: 'editor' });
beforeEach(() => { db.data.clear(); db.write.mockReset(); });
it('persists concurrent nonsecret handoffs and removes only the acknowledged request', async () => {
  const first = invitation(), second = invitation('Reviewer'); await Promise.all([rememberRoomGrant(first), rememberRoomGrant(second)]);
  expect(await loadRoomGrants(projectId)).toEqual([first, second]); await forgetRoomGrant(first); expect(await loadRoomGrants(projectId)).toEqual([second]);
});
it('refuses changed immutable requests and leaves failed storage writes recoverable', async () => {
  const pending = invitation(); await rememberRoomGrant(pending);
  await expect(rememberRoomGrant({ ...pending, role: 'viewer' })).rejects.toThrow('different payload');
  await expect(forgetRoomGrant({ ...pending, name: 'Changed' })).rejects.toThrow('changed');
  db.write.mockRejectedValueOnce(new Error('Disk full')); await expect(forgetRoomGrant(pending)).rejects.toThrow('Disk full'); expect(await loadRoomGrants(projectId)).toEqual([pending]);
  await forgetRoomGrant(pending); expect(await loadRoomGrants(projectId)).toEqual([]);
});
it('preserves newer, foreign, secret-bearing, malformed and duplicate metadata without writing', async () => {
  const pending = invitation(), key = roomGrantKey(projectId);
  for (const value of [{ version: 2, grants: [] }, { version: 1, grants: [{ ...pending, credential: 'private' }] }, { version: 1, grants: [{ ...pending, projectId: ulid() }] }, { version: 1, grants: [{ ...pending, serverUrl: `${scope.serverUrl}path` }] }, { version: 1, grants: [pending, pending] }, { version: 1, grants: [{ ...pending, role: 'owner' }] }]) {
    db.data.set(key, value); await expect(rememberRoomGrant(invitation())).rejects.toThrow(); expect(db.data.get(key)).toEqual(value);
  }
  expect(db.write).not.toHaveBeenCalled();
});
it('bounds pending work per project and handles changed JSON field order without changing identity', async () => {
  const grants = Array.from({ length: 65 }, () => invitation()); db.data.set(roomGrantKey(projectId), roomGrantState(projectId, grants));
  await expect(rememberRoomGrant(invitation())).rejects.toThrow('pending invitation'); expect(db.write).not.toHaveBeenCalled();
  const reordered = Object.fromEntries(Object.entries(grants[0]!).reverse()) as PendingRoomInvitation; await forgetRoomGrant(reordered); expect(await loadRoomGrants(projectId)).toHaveLength(64);
});

it('retains scoped original-author requests without credentials and refuses changed/removal/newer corrupt data', async () => {
  const pending: PendingRoomAuthorGrant = { ...scope, kind: 'author', requestId: ulid(), name: 'Original', authorId: 'local:author', memberId: null, step: 2 };
  await rememberRoomGrant(pending); expect(await loadRoomGrants(projectId)).toEqual([pending]);
  await expect(rememberRoomGrant({ ...pending, memberId: ulid() })).rejects.toThrow('different payload'); await expect(forgetRoomGrant({ ...pending, step: 3 })).rejects.toThrow('changed');
  db.write.mockRejectedValueOnce(new Error('Disk full')); await expect(forgetRoomGrant(pending)).rejects.toThrow('Disk full'); expect(await loadRoomGrants(projectId)).toEqual([pending]);
  for (const patch of [{ memberId: undefined }, { authorId: '?' }, { step: -1 }, { ownerId: 'short' }, { secret: 'unsafe' }]) {
    const value = { version: 1, grants: [{ ...pending, ...patch }] }; db.data.set(roomGrantKey(projectId), value); await expect(loadRoomGrants(projectId)).rejects.toThrow(); expect(db.data.get(roomGrantKey(projectId))).toEqual(value);
  }
});
