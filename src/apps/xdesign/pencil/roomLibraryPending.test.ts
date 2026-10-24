import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { libraryActor, libraryFixture, libraryPendingStorage, libraryProjectId, libraryRecord, libraryScope } from './roomLibraries.testSupport';
import type { PendingRoomLibrary } from './roomLibraryPending';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (value: string) => value }));
vi.mock('@/lib/db', () => ({ getAppState: vi.fn() }));
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
async function packet(): Promise<PendingRoomLibrary> { return { projectId: libraryProjectId, ...libraryScope, actorId: libraryActor.id, packet: { version: 1, requestId: 'publication_request_001', bundle: (await libraryRecord(await libraryFixture())).bundle } }; }
it('copies pending input before queueing, reopens exact original bytes and avoids rewriting identical recovery data', async () => {
  const saved = libraryPendingStorage(), pending = await packet(), original = structuredClone(pending), remembering = saved.pending.remember(pending); pending.packet.bundle.manifest.name = 'Caller mutation'; await remembering;
  expect(await saved.reopen().load(libraryProjectId)).toEqual(original); const loaded = (await saved.pending.load(libraryProjectId))!; loaded.packet.bundle.manifest.name = 'Read mutation'; expect(await saved.pending.load(libraryProjectId)).toEqual(original);
  await saved.pending.remember(original); expect(saved.writes).toBe(1);
});
it('keeps another request intact and cannot dismiss it using an older reviewed packet', async () => {
  const saved = libraryPendingStorage(), pending = await packet(); await saved.pending.remember(pending); const other = structuredClone(pending); other.packet.requestId = 'publication_request_002'; const raw = JSON.stringify(saved.value);
  await expect(saved.pending.remember(other)).rejects.toThrow('Recover or dismiss'); await expect(saved.pending.forget(other)).rejects.toThrow('changed'); expect(JSON.stringify(saved.value)).toBe(raw);
});
it('preserves corrupt, newer, foreign-project and secret-bearing saved states without replacing or dismissing them', async () => {
  const pending = await packet(); const saved = libraryPendingStorage();
  for (const value of [{ version: 2, pending }, { version: 1, pending: { ...pending, projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' } }, { version: 1, pending: { ...pending, token: 'secret' } }, { version: 1, pending: { ...pending, packet: { ...pending.packet, bundle: { ...pending.packet.bundle, checksum: '0'.repeat(64) } } } }]) {
    saved.value = value; const raw = JSON.stringify(saved.value); await expect(saved.pending.load(libraryProjectId)).rejects.toThrow(); await expect(saved.pending.remember(pending)).rejects.toThrow(); await expect(saved.pending.forget(pending)).rejects.toThrow(); expect(JSON.stringify(saved.value)).toBe(raw);
  }
});
it('recovers the queue after disk failure while preserving exact compare-and-set expectations', async () => {
  const pending = await packet(), saved = libraryPendingStorage(); saved.fail = true; await expect(saved.pending.remember(pending)).rejects.toThrow('save failure'); expect(saved.value).toBeNull(); saved.fail = false;
  await saved.pending.remember(pending); saved.fail = true; await expect(saved.pending.forget(pending)).rejects.toThrow('save failure'); expect(await saved.pending.load(libraryProjectId)).toEqual(pending); saved.fail = false; await saved.pending.forget(pending); expect(await saved.pending.load(libraryProjectId)).toBeNull();
});
