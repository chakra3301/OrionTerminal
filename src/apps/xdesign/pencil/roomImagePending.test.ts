import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ulid } from 'ulid';
import { imageFixture, imagePendingStorage, imageProject } from './roomImages.testSupport';
import { readPendingRoomImage } from './roomImagePending';
vi.mock('@/lib/db', () => ({ getAppState: vi.fn() }));
beforeEach(() => vi.stubGlobal('crypto', webcrypto)); afterEach(() => vi.unstubAllGlobals());
it('detaches pending metadata before asynchronous saves and reopens without rewriting identical originals', async () => {
  const f = await imageFixture(), saved = imagePendingStorage(), original = structuredClone(f.pending), work = saved.pending.remember(f.pending); f.pending.source.name = 'Caller mutation'; await work;
  expect(await saved.reopen().load(imageProject)).toEqual(original); const read = (await saved.pending.load(imageProject))!; if (read.direction === 'upload') read.source.name = 'Read mutation'; expect(await saved.pending.load(imageProject)).toEqual(original);
  await saved.pending.remember(original); expect(saved.writes).toBe(1);
});
it('separately journals preparation and publication approval while preserving the immutable source and manifest', async () => {
  const f = await imageFixture(), saved = imagePendingStorage(); await saved.pending.remember(f.pending); const prepared = { ...f.pending, manifest: f.manifest };
  await saved.pending.advance(f.pending, prepared); const approved = { ...prepared, approved: true }; await saved.pending.advance(prepared, approved); expect(await saved.reopen().load(imageProject)).toEqual(approved);
  for (const next of [{ ...approved, approved: false }, { ...approved, manifest: { ...f.manifest, archiveDigest: 'a'.repeat(64) } }, { ...approved, source: { ...approved.source, version: ulid() } }, { ...approved, transferId: 'another_transfer_001' }]) expect(() => saved.pending.advance(approved, next)).toThrow();
  expect(await saved.pending.load(imageProject)).toEqual(approved);
});
it('refuses competing requests, stale transitions and stale dismissal without replacing the saved packet', async () => {
  const f = await imageFixture(), saved = imagePendingStorage(); await saved.pending.remember(f.pending);
  const other = { ...f.pending, transferId: 'another_transfer_001' }; await expect(saved.pending.remember(other)).rejects.toThrow('Recover or dismiss'); await expect(saved.pending.forget(other)).rejects.toThrow('changed');
  const prepared = { ...f.pending, manifest: f.manifest }; await saved.reopen().advance(f.pending, prepared); await expect(saved.pending.advance(f.pending, prepared)).rejects.toThrow('changed'); expect(await saved.pending.load(imageProject)).toEqual(prepared);
});
it('preserves newer, unknown, foreign, secret-bearing and checksum-damaged saved data', async () => {
  const f = await imageFixture(), saved = imagePendingStorage();
  for (const value of [{ version: 2, pending: f.pending }, { version: 1, pending: { ...f.pending, token: 'secret' } }, { version: 1, pending: { ...f.pending, projectId: ulid() } }, { version: 1, pending: { ...f.pending, serverUrl: 'https://rooms.example.test' } }, { version: 1, pending: { ...f.pending, approved: true } }, { version: 1, pending: { ...f.pending, manifest: { ...f.manifest, archiveDigest: 'a'.repeat(64) } } }]) {
    saved.value = value; const original = JSON.stringify(saved.value); await expect(saved.pending.load(imageProject)).rejects.toThrow(); await expect(saved.pending.remember(f.pending)).rejects.toThrow(); await expect(saved.pending.forget(f.pending)).rejects.toThrow(); expect(JSON.stringify(saved.value)).toBe(original);
  }
});
it('validates imported identity and destination before acknowledging or clearing a receipt', async () => {
  const f = await imageFixture(), id = ulid(), photo = { ...f.source, id, bundlePath: `/assets/xdesign/${imageProject}/${id}/${f.source.version}.pcraft`, previewPath: `/assets/xdesign/${imageProject}/${id}/${f.source.version}.png`, originalPath: null };
  const pending = { projectId: imageProject, serverUrl: f.pending.serverUrl, documentId: f.pending.documentId, actorId: f.pending.actorId, transferId: f.pending.transferId, acknowledged: false, direction: 'download', manifest: f.manifest, reference: f.reference, photo };
  expect(readPendingRoomImage(pending, imageProject)).toEqual(pending);
  for (const patch of [{ originalPath: '/another/original.psd' }, { bundlePath: '/foreign/' + id + '.pcraft' }, { previewPath: photo.previewPath.replace(imageProject, ulid()) }, { width: 25 }]) expect(() => readPendingRoomImage({ ...pending, photo: { ...photo, ...patch } }, imageProject)).toThrow();
  expect(() => readPendingRoomImage({ ...pending, reference: { ...f.reference, revisionId: '0'.repeat(64) } }, imageProject)).toThrow();
});
it('recovers its serial queue after a failed save without admitting unapproved receipts or deleting another outcome', async () => {
  const f = await imageFixture(), saved = imagePendingStorage(); saved.fail = true; await expect(saved.pending.remember(f.pending)).rejects.toThrow('save failure'); expect(saved.value).toBeNull(); saved.fail = false; await saved.pending.remember(f.pending);
  saved.fail = true; await expect(saved.pending.advance(f.pending, { ...f.pending, manifest: f.manifest })).rejects.toThrow('save failure'); expect(await saved.pending.load(imageProject)).toEqual(f.pending); saved.fail = false;
  expect(() => saved.pending.advance(f.pending, { ...f.pending, acknowledged: true })).toThrow('receipt'); await saved.pending.forget(f.pending); expect(await saved.pending.load(imageProject)).toBeNull();
});
