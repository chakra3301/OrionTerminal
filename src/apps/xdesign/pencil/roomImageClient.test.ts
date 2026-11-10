import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { imageClientFixture, imageActor, imageProject } from './roomImages.testSupport';
import { RoomRequestFailure } from './sharedRoomConnection';
vi.mock('@/lib/db', () => ({ getAppState: vi.fn() }));
beforeEach(() => vi.stubGlobal('crypto', webcrypto)); afterEach(() => vi.unstubAllGlobals());
async function prepared(c: Awaited<ReturnType<typeof imageClientFixture>>) {
  const value = await c.ready.prepareUpload(c.source, c.manifest.imageId, null); expect(value.kind).toBe('prepared'); if (value.kind !== 'prepared') throw new Error('Missing prepared image'); return value;
}
const clients: Awaited<ReturnType<typeof imageClientFixture>>[] = [];
async function fixture() { const c = await imageClientFixture(); clients.push(c); return c; }
afterEach(() => clients.splice(0).forEach(c => c.dispose()));
it('reads immutable placement metadata with fresh editor access without allocating, transferring or journaling images', async () => {
  const c = await fixture(), before = structuredClone(c.saved.value);
  expect(await c.ready.placementRevision(c.reference)).toEqual(c.manifest);
  expect(c.saved.value).toEqual(before); expect(c.allocations).toBe(0); expect(c.transport.imageChunk).not.toHaveBeenCalled(); expect(c.transport.prepareImageFile).not.toHaveBeenCalled(); expect(c.transport.beginImage).not.toHaveBeenCalled(); expect(c.transport.dispose).toHaveBeenCalledOnce();
  c.context = { ...c.context!, actor: { ...imageActor, role: 'viewer' } }; await expect(c.ready.placementRevision(c.reference)).rejects.toThrow('editor or owner'); expect(c.transport.imageRevision).toHaveBeenCalledOnce();
});
it('refuses fresh viewer replies and pending transfers before placement review can change artwork', async () => {
  const c = await fixture(), original = vi.mocked(c.transport.imageRevision).getMockImplementation()!;
  vi.mocked(c.transport.imageRevision).mockImplementationOnce(async (...args) => ({ ...await original(...args), actor: { ...imageActor, role: 'viewer' } }));
  await expect(c.ready.placementRevision(c.reference)).rejects.toThrow('editor or owner'); expect(c.ready.snapshot.actor?.role).toBe('viewer'); expect(c.saved.value).toBeNull();
  await prepared(c); const before = structuredClone(c.saved.value), reads = vi.mocked(c.transport.imageRevision).mock.calls.length;
  await expect(c.ready.placementRevision(c.reference)).rejects.toThrow('pending image transfer'); expect(c.saved.value).toEqual(before); expect(c.transport.imageRevision).toHaveBeenCalledTimes(reads);
});
it('cancels a late placement metadata reply after the original session epoch changes', async () => {
  const c = await fixture(), original = vi.mocked(c.transport.imageRevision).getMockImplementation()!; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(c.transport.imageRevision).mockImplementationOnce(async (...args) => { await wait; return original(...args); });
  const work = c.ready.placementRevision(c.reference); await vi.waitFor(() => expect(c.transport.imageRevision).toHaveBeenCalled()); c.context = { ...c.context!, epoch: 2 }; c.ready.refresh(); release();
  await expect(work).rejects.toMatchObject({ name: 'AbortError' }); expect(c.saved.value).toBeNull(); expect(c.allocations).toBe(0);
});
it('restores local pending metadata on opening without making any native or network request', async () => {
  const c = await fixture(); expect(c.ready.snapshot.phase).toBe('ready'); expect(c.open).not.toHaveBeenCalled();
  await c.saved.pending.remember(c.pending); const reopened = c.client(); await reopened.initialize(); expect(reopened.snapshot.pending?.transferId).toBe(c.pending.transferId); expect(c.open).not.toHaveBeenCalled();
});
it('saves the preparation scope before dispatch and retains the original when a preparation reply is lost', async () => {
  const c = await fixture(); c.saved.fail = true; await expect(prepared(c)).rejects.toThrow('save failure'); expect(c.open).not.toHaveBeenCalled(); c.saved.fail = false;
  vi.mocked(c.transport.prepareImageFile).mockRejectedValueOnce(new Error('lost native preparation')); await expect(prepared(c)).rejects.toThrow('lost native'); expect(c.ready.snapshot.pending?.revisionId).toBeNull();
  const reopened = c.client(); await reopened.initialize(); const result = await reopened.recover(); expect(result.kind).toBe('prepared'); expect(c.transport.beginImage).not.toHaveBeenCalled(); expect(c.transport.imageUpload).not.toHaveBeenCalled();
});
it('recovery of a prepared image preserves the explicit publication review and refuses stale approval', async () => {
  const c = await fixture(), review = await prepared(c); const reopened = c.client(); await reopened.initialize(); expect((await reopened.recover()).kind).toBe('prepared'); expect(c.transport.beginImage).not.toHaveBeenCalled();
  for (const [transfer, revision, epoch] of [[review.transferId, review.manifest.revisionId, 0], ['changed_transfer_001', review.manifest.revisionId, 1], [review.transferId, 'a'.repeat(64), 1]] as const) await expect(reopened.submitUpload(transfer, revision, epoch)).rejects.toThrow('after review');
  expect(c.ready.snapshot.pending?.approved).toBe(false); expect(c.transport.beginImage).not.toHaveBeenCalled();
});
it('uploads only missing native chunks after a lost reply and journals completion before reporting success', async () => {
  const c = await fixture(), review = await prepared(c);
  vi.mocked(c.transport.putImageChunk).mockImplementationOnce(async (request, chunk) => {
    const status = c.uploads.get(request)!; status.received.push(chunk.index); throw new Error('lost first chunk receipt');
  });
  await expect(c.ready.submitUpload(review.transferId, review.manifest.revisionId, 1)).rejects.toThrow('lost first'); const pending = await c.saved.pending.load(imageProject); expect(pending?.direction === 'upload' && pending.approved).toBe(true);
  const reopened = c.client(); await reopened.initialize(); const result = await reopened.recover(); expect(result.kind).toBe('published'); expect(c.ready.snapshot.pending?.transferId).toBe(review.transferId);
  expect(vi.mocked(c.transport.readImageFileChunk).mock.calls.map(call => call[2])).toEqual([0, 1]); const saved = await c.saved.pending.load(imageProject); expect(saved?.direction === 'upload' && saved.publication?.state).toBe('published'); expect(reopened.snapshot.phase).toBe('complete');
});
it('recovers an accepted publication after publisher downgrade without publishing or reading source chunks again', async () => {
  const c = await fixture(), review = await prepared(c); c.loseCommit = true; await expect(c.ready.submitUpload(review.transferId, review.manifest.revisionId, 1)).rejects.toThrow('lost image commit');
  c.context = { ...c.context!, actor: { ...imageActor, role: 'viewer' } }; const reopened = c.client(); await reopened.initialize(); const result = await reopened.recover(); expect(result.kind).toBe('published'); expect(c.transport.commitImage).toHaveBeenCalledTimes(1); expect(c.transport.beginImage).toHaveBeenCalledTimes(1); expect(c.transport.readImageFileChunk).toHaveBeenCalledTimes(2);
  expect(reopened.snapshot.actor?.role).toBe('viewer');
});
it('keeps a remote completion recoverable when its durable receipt cannot be saved', async () => {
  const c = await fixture(), review = await prepared(c);
  vi.mocked(c.transport.commitImage).mockImplementationOnce(async request => { const status = c.uploads.get(request)!; status.state = 'published'; status.publication = { manifest: status.manifest, ownerId: imageActor.id, publisher: { id: imageActor.id, name: imageActor.name }, step: 1, publishedAt: '2026-10-12T12:00:00.000Z' }; status.current = status.publication; c.saved.fail = true; return structuredClone(status); });
  await expect(c.ready.submitUpload(review.transferId, review.manifest.revisionId, 1)).rejects.toThrow('save failure'); c.saved.fail = false; const reopened = c.client(); await reopened.initialize(); expect((await reopened.recover()).kind).toBe('published'); expect(c.transport.commitImage).toHaveBeenCalledTimes(1);
});
it('retains the same native image identity after a lost import reply without redownloading accepted chunks', async () => {
  const c = await fixture(); c.loseImport = true; await expect(c.ready.download(c.reference)).rejects.toThrow('lost native image import'); const original = [...c.files.values()][0]!.photo;
  const reopened = c.client(); await reopened.initialize(); const result = await reopened.recover(); expect(result.kind).toBe('imported'); if (result.kind === 'imported') expect(result.photo).toEqual(original); expect(c.allocations).toBe(1); expect(c.transport.imageChunk).toHaveBeenCalledTimes(2); expect(reopened.snapshot.phase).toBe('complete');
});
it('retains imported originals and pending receipts until the project save and cleanup are acknowledged', async () => {
  const c = await fixture(), result = await c.ready.download(c.reference); expect(result.kind).toBe('imported'); const save = vi.fn(async (): Promise<void> => { throw new Error('project save failed'); });
  await expect(c.ready.acknowledge(save)).rejects.toThrow('project save failed'); expect(c.transport.discardImageFile).not.toHaveBeenCalled(); expect(c.ready.snapshot.pending?.complete).toBe(true);
  save.mockImplementation(async () => {}); await c.ready.acknowledge(save); expect(save).toHaveBeenLastCalledWith(result); expect(await c.saved.pending.load(imageProject)).toBeNull(); expect(c.files.size).toBe(0); expect(c.allocations).toBe(1);
});
it('retries a lost cache-dismissal reply from its saved acknowledgment without importing or applying the project twice', async () => {
  const c = await fixture(); await c.ready.download(c.reference); c.loseDiscard = true; const save = vi.fn(async () => {});
  await expect(c.ready.acknowledge(save)).rejects.toThrow('lost native image discard'); expect(c.ready.snapshot.pending?.acknowledged).toBe(true); expect(c.files.size).toBe(0);
  const reopened = c.client(); await reopened.initialize(); expect((await reopened.recover()).kind).toBe('imported'); await reopened.acknowledge(save); expect(save).toHaveBeenCalledTimes(1); expect(c.allocations).toBe(1); expect(c.transport.importImageFile).toHaveBeenCalledTimes(1); expect(await c.saved.pending.load(imageProject)).toBeNull();
});
it('does not clear a completed native receipt after pending removal fails', async () => {
  const c = await fixture(); await c.ready.download(c.reference);
  vi.mocked(c.transport.discardImageFile).mockImplementationOnce(async scope => { c.files.delete(scope.transferId); c.saved.fail = true; });
  const save = vi.fn(async () => {}); await expect(c.ready.acknowledge(save)).rejects.toThrow('save failure'); c.saved.fail = false; const reopened = c.client(); await reopened.initialize(); await reopened.acknowledge(save); expect(save).toHaveBeenCalledTimes(1); expect(await c.saved.pending.load(imageProject)).toBeNull();
});
it('rejects changed members, source epochs and late replies while retaining the original request', async () => {
  const c = await fixture(), review = await prepared(c); let release!: () => void; const deferred = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(c.transport.imageUpload).mockImplementationOnce(async () => { await deferred; throw new RoomRequestFailure('Original request missing', 404, 'http'); });
  const running = c.ready.submitUpload(review.transferId, review.manifest.revisionId, 1); await vi.waitFor(() => expect(c.transport.imageUpload).toHaveBeenCalled()); c.context = { ...c.context!, epoch: 2 }; c.ready.refresh(); release(); await expect(running).rejects.toMatchObject({ name: 'AbortError' }); expect(c.transport.beginImage).not.toHaveBeenCalled();
  c.context = { ...c.context!, actor: { ...imageActor, id: 'another_room_member_001' } }; const reopened = c.client(); await reopened.initialize(); await expect(reopened.recover()).rejects.toThrow('original room member'); expect(reopened.snapshot.pending?.transferId).toBe(review.transferId);
});
it('refuses foreign service members and missing native chunk acknowledgments without clearing pending originals', async () => {
  const c = await fixture(); vi.mocked(c.transport.putImageFileChunk).mockImplementationOnce(async scope => structuredClone(c.files.get(scope.transferId)!));
  await expect(c.ready.download(c.reference)).rejects.toThrow('acknowledge'); expect(c.ready.snapshot.pending?.complete).toBe(false); expect(c.transport.importImageFile).not.toHaveBeenCalled();
  const reopen = c.client(); await reopen.initialize(); vi.mocked(c.transport.imageRevision).mockResolvedValueOnce({ version: 1, documentId: c.pending.documentId, actor: { ...imageActor, id: 'foreign_room_member_001' }, publication: { manifest: c.manifest, ownerId: imageActor.id, publisher: { id: imageActor.id, name: imageActor.name }, step: 1, publishedAt: '2026-10-12T12:00:00.000Z' } });
  await expect(reopen.recover()).rejects.toThrow('another room member'); expect(await c.saved.pending.load(imageProject)).not.toBeNull();
});
it('requires current editor access for new publication but allows viewer native downloads', async () => {
  const c = await fixture(); c.context = { ...c.context!, actor: { ...imageActor, role: 'viewer' } }; await expect(prepared(c)).rejects.toThrow('editor or owner'); expect(c.open).not.toHaveBeenCalled(); expect((await c.ready.download(c.reference)).kind).toBe('imported');
});
it('prevents simultaneous transfers and preserves published requests when explicit dismissal is attempted', async () => {
  const c = await fixture(), review = await prepared(c); await expect(c.ready.download(c.reference)).rejects.toThrow('Recover or dismiss'); c.loseCommit = true; await expect(c.ready.submitUpload(review.transferId, review.manifest.revisionId, 1)).rejects.toThrow('lost image commit');
  await expect(c.ready.dismiss()).rejects.toThrow('already published'); expect(c.transport.discardImageFile).not.toHaveBeenCalled(); expect(await c.saved.pending.load(imageProject)).not.toBeNull();
});
it('dismisses an unapproved preparation and its cache without publishing or removing native artwork', async () => {
  const c = await fixture(); await prepared(c); await c.ready.dismiss(); expect(c.transport.beginImage).not.toHaveBeenCalled(); expect(c.transport.dismissImage).not.toHaveBeenCalled(); expect(c.transport.discardImageFile).toHaveBeenCalledTimes(1); expect(await c.saved.pending.load(imageProject)).toBeNull();
});
