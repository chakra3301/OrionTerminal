import { beforeEach, expect, it, vi } from 'vitest';
import { loadRoomPreferences, rememberRoom } from './roomPreferences';
const db = vi.hoisted(() => ({ value: null as unknown, write: vi.fn() }));
vi.mock('@/lib/db', () => ({ getAppState: async () => structuredClone(db.value), setAppState: async (_key: string, value: unknown) => { await db.write(); db.value = structuredClone(value); } }));
const room = (revision = 1, role: 'owner' | 'editor' | 'viewer' = 'editor') => ({ documentId: 'document_identity_001', serverUrl: 'https://rooms.example.test/', revision, role });
beforeEach(() => { db.value = null; db.write.mockReset(); });
it('serializes concurrent additions and retains the newer role and revision', async () => {
  await Promise.all([rememberRoom(room(8, 'viewer')), rememberRoom(room(2, 'editor')), rememberRoom({ ...room(), documentId: 'document_identity_002' })]);
  expect(await loadRoomPreferences()).toEqual([room(8, 'viewer'), { ...room(), documentId: 'document_identity_002' }]);
  await rememberRoom(room(8, 'editor')); expect((await loadRoomPreferences())[0]!.role).toBe('editor');
});
it('keeps corrupt, newer and credential-bearing records untouched', async () => {
  for (const value of [{ version: 2, rooms: [] }, { version: 1, rooms: [room(), room()] }, { version: 1, rooms: [{ ...room(), secret: 'private' }] }, { version: 1, rooms: [{ ...room(), serverUrl: 'https://rooms.example.test/path' }] }]) {
    db.value = value; await expect(rememberRoom(room())).rejects.toThrow(); expect(db.value).toEqual(value);
  }
  expect(db.write).not.toHaveBeenCalled();
});
it('does not poison later saves when storage fails', async () => {
  db.write.mockRejectedValueOnce(new Error('Disk unavailable')); await expect(rememberRoom(room())).rejects.toThrow('Disk'); expect(db.value).toBeNull();
  await rememberRoom(room(3)); expect(await loadRoomPreferences()).toEqual([room(3)]);
});
it('bounds configuration without replacing existing entries', async () => {
  db.value = { version: 1, rooms: Array.from({ length: 128 }, (_, index) => ({ ...room(), documentId: `document_identity_${String(index).padStart(3, '0')}` })) };
  await expect(rememberRoom({ ...room(), documentId: 'document_identity_999' })).rejects.toThrow('limit'); expect(db.write).not.toHaveBeenCalled();
});
it('permits an explicit server replacement and rejects invalid revisions', async () => {
  await rememberRoom(room(9)); await rememberRoom({ ...room(), serverUrl: 'http://127.0.0.1:4787/' }); expect((await loadRoomPreferences())[0]!.revision).toBe(1);
  for (const revision of [0, -1, NaN, 1.5]) expect(() => rememberRoom(room(revision))).toThrow();
});
