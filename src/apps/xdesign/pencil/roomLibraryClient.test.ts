import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { contentHash } from '@open-pencil/core/library';
import { RoomLibraryClient, type RoomLibraryTransport } from './roomLibraryClient';
import { RoomRequestFailure } from './sharedRoomConnection';
import { validateRoomLibraryBundle, type RoomLibraryPublish, type RoomLibraryPublication } from './roomLibraryProtocol';
import type { CachedRoomRevision } from './roomLibraryCache';
import type { RoomCommentContext } from './roomCommentClient';
import { serializeGraph } from './graphDocument';
import { libraryActor, libraryCacheStorage, libraryFixture, libraryPendingStorage, libraryProjectId, libraryRecord, libraryScope } from './roomLibraries.testSupport';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (value: string) => value }));
vi.mock('@/lib/db', () => ({ getAppState: vi.fn() }));
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(next => { resolve = next; }); return { promise, resolve }; }
function setup(records: CachedRoomRevision[] = []) {
  const cache = libraryCacheStorage(), pending = libraryPendingStorage(), receipts = new Map<string, RoomLibraryPublication>();
  let context: RoomCommentContext | null = { ...libraryScope, actor: libraryActor, revision: 1, epoch: 1 }, current = true;
  const actor = () => context!.actor, envelope = () => ({ version: 1 as const, documentId: libraryScope.documentId, actor: actor() });
  const calls: string[] = [];
  const catalog = vi.fn(async () => { calls.push('catalog'); return { ...envelope(), libraries: records.length ? [records.at(-1)!.publication] : [] }; });
  const revision = vi.fn(async (_library: string, id: string) => { calls.push(`revision:${id}`); const record = records.find(item => item.publication.revisionId === id); if (!record) throw new RoomRequestFailure('Missing revision', 404, 'revision'); return { ...envelope(), ...structuredClone(record) }; });
  const recover = vi.fn(async (packet: RoomLibraryPublish) => { calls.push('recover'); const result = receipts.get(packet.requestId); if (!result) throw new RoomRequestFailure('Missing receipt', 404, 'receipt'); return { ...structuredClone(result), actor: actor(), current: records.at(-1)!.publication }; });
  const publish = vi.fn(async (packet: RoomLibraryPublish) => {
    calls.push('publish'); expect((await pending.pending.load(libraryProjectId))?.packet).toEqual(packet);
    const parsed = await validateRoomLibraryBundle(packet.bundle), manifest = parsed.bundle.manifest;
    expect(manifest.previousRevisionId).toBe(records.at(-1)?.publication.revisionId ?? null);
    const record: CachedRoomRevision = { bundle: parsed.bundle, publication: { libraryId: manifest.libraryId, revisionId: manifest.revisionId, previousRevisionId: manifest.previousRevisionId, name: manifest.name, description: manifest.description, publishedAt: manifest.publishedAt, assetCount: manifest.assets.length, ownerId: libraryActor.id, publisher: { id: actor().id, name: actor().name }, step: records.length + 1, bundleDigest: parsed.bundleDigest } };
    records.push(record); const result = { ...envelope(), requestId: packet.requestId, publication: record.publication, current: record.publication }; receipts.set(packet.requestId, structuredClone(result)); return result;
  });
  const dispose = vi.fn(async () => { calls.push('dispose'); });
  const transport: RoomLibraryTransport = { catalog, revision, recover, publish, dispose };
  const open = vi.fn(async () => transport), onState = vi.fn();
  const make = () => new RoomLibraryClient(libraryScope.documentId, libraryProjectId, { current: () => current, context: () => context, onState, cache: cache.cache, pending: pending.reopen(), open });
  const client = make();
  return { client, make, cache, pending, receipts, records, transport, catalog, revision, recover, publish, dispose, open, onState, calls, get context() { return context; }, set context(value) { context = value; }, set current(value: boolean) { current = value; } };
}
it('opens without network or automatic publication and exposes only detached pending summaries', async () => {
  const f = setup(), revision = await libraryFixture(), record = await libraryRecord(revision);
  await f.pending.pending.remember({ projectId: libraryProjectId, ...libraryScope, actorId: libraryActor.id, packet: { version: 1, requestId: 'publication_request_001', bundle: record.bundle } });
  await Promise.all([f.client.initialize(), f.client.initialize()]); expect(f.open).not.toHaveBeenCalled(); expect(f.pending.writes).toBe(1);
  const state = f.client.snapshot; expect(state.phase).toBe('pending'); expect(state.pending).toEqual(expect.objectContaining({ name: revision.manifest.name, requestId: 'publication_request_001' })); expect(state.pending).not.toHaveProperty('packet'); expect(JSON.stringify(state)).not.toContain(record.bundle.graph);
  state.pending!.name = 'Caller edit'; expect(f.client.snapshot.pending!.name).toBe(revision.manifest.name);
});
it('reviews against the current room predecessor without changing device graph, manifest or pending data', async () => {
  const original = await libraryFixture(), head = await libraryRecord(original), f = setup([head]); await f.client.initialize();
  const next = await libraryFixture(undefined, 180), before = JSON.stringify(next.manifest), graph = serializeGraph(next.graph);
  const draft = await f.client.prepare(next); expect(draft.packet.bundle.manifest.previousRevisionId).toBe(head.publication.revisionId); expect(draft.changes.map(item => item.kind)).toEqual(['modified']);
  await validateRoomLibraryBundle(draft.packet.bundle); expect(JSON.stringify(next.manifest)).toBe(before); expect(serializeGraph(next.graph)).toBe(graph); expect(f.pending.value).toBeNull(); expect(f.publish).not.toHaveBeenCalled();
});
it('persists before receipt lookup, dispatches only on missing receipt, caches acceptance before clearing and keeps the local revision intact', async () => {
  const f = setup(), revision = await libraryFixture(), original = JSON.stringify(revision.manifest); await f.client.initialize(); const draft = await f.client.prepare(revision); f.calls.length = 0;
  const accepted = await f.client.submit(draft); expect(f.calls.slice(0, 3)).toEqual(['recover', 'publish', `revision:${accepted.publication.revisionId}`]); expect(f.pending.writes).toBe(2); expect(await f.pending.pending.load(libraryProjectId)).toBeNull();
  expect((await f.cache.cache.history(libraryScope, revision.manifest.libraryId)).at(-1)!.publication).toEqual(accepted.publication); expect(f.client.snapshot.cacheVersion).toBe(1); expect(f.client.snapshot.phase).toBe('ready'); expect(JSON.stringify(revision.manifest)).toBe(original);
});
it('recovers an accepted but lost response after reopening using the exact original packet and no second publication', async () => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture());
  const send = f.publish.getMockImplementation()!; f.publish.mockImplementationOnce(async packet => { await send(packet); throw new Error('Lost accepted reply'); });
  await expect(f.client.submit(draft)).rejects.toThrow('Lost accepted'); const saved = JSON.stringify(f.pending.value); f.client.dispose();
  const reopened = f.make(); await reopened.initialize(); expect(JSON.stringify(f.pending.value)).toBe(saved); await reopened.recover(); expect(f.publish).toHaveBeenCalledOnce(); expect(f.recover).toHaveBeenLastCalledWith(draft.packet, expect.any(AbortSignal)); expect(f.pending.writes).toBe(2);
});
it('keeps an accepted request pending until failed cache or pending-clear saves can be retried', async () => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture()); f.cache.fail = true;
  await expect(f.client.submit(draft)).rejects.toThrow('cache save'); expect(f.client.snapshot.pending?.requestId).toBe(draft.packet.requestId); expect(f.cache.writes).toBe(0); f.cache.fail = false; f.pending.fail = true;
  await expect(f.client.recover()).rejects.toThrow('pending save'); expect(f.cache.writes).toBe(1); expect(f.client.snapshot.phase).toBe('pending'); f.pending.fail = false; await f.client.recover(); expect(f.publish).toHaveBeenCalledOnce(); expect(f.cache.writes).toBe(1); expect(f.client.snapshot.pending).toBeNull();
});
it('does not open a native handle when the durable publication packet cannot save', async () => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture()), opened = f.open.mock.calls.length; f.pending.fail = true;
  await expect(f.client.submit(draft)).rejects.toThrow('pending save'); expect(f.open).toHaveBeenCalledTimes(opened); expect(f.recover).not.toHaveBeenCalled(); expect(f.publish).not.toHaveBeenCalled();
});
it.each([new RoomRequestFailure('Missing room', 404, 'room'), new RoomRequestFailure('Denied', 403, 'readonly'), new Error('Unknown outcome')])('never issues a publication after unrecognized recovery failure: %s', async failure => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture()); f.recover.mockRejectedValue(failure);
  await expect(f.client.submit(draft)).rejects.toThrow(failure.message); expect(f.publish).not.toHaveBeenCalled(); expect(f.client.snapshot.pending?.requestId).toBe(draft.packet.requestId);
});
it('allows viewers to read and download, but prevents preparation and a missing-receipt replay after downgrade', async () => {
  const first = await libraryFixture(), record = await libraryRecord(first), f = setup([record]); await f.client.initialize(); f.context = { ...f.context!, actor: { ...libraryActor, role: 'viewer' } };
  await f.client.download(first.manifest.libraryId); expect(f.cache.writes).toBe(1); await expect(f.client.prepare(first)).rejects.toThrow('editor or owner');
  const pending = { projectId: libraryProjectId, ...libraryScope, actorId: libraryActor.id, packet: { version: 1 as const, requestId: 'pending_request_001', bundle: record.bundle } }; await f.pending.pending.remember(pending);
  const reopened = f.make(); await reopened.initialize(); await expect(reopened.recover()).rejects.toThrow('editor or owner'); expect(f.publish).not.toHaveBeenCalled(); expect(await f.pending.pending.load(libraryProjectId)).toEqual(pending);
});
it('allows accepted receipt recovery after downgrade without changing artwork access or republishing', async () => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture()); f.cache.fail = true; await expect(f.client.submit(draft)).rejects.toThrow('cache save'); f.cache.fail = false; f.context = { ...f.context!, actor: { ...libraryActor, role: 'viewer' } };
  await f.client.recover(); expect(f.publish).toHaveBeenCalledOnce(); expect(f.context.actor.role).toBe('viewer'); expect(f.client.snapshot.actor?.role).toBe('viewer');
});
it('pins complete history, downloads only successors to a cached prefix and never stores a partial chain', async () => {
  const first = await libraryFixture(), second = await libraryFixture(first, 180), third = await libraryFixture(second, 240), records = await Promise.all([libraryRecord(first), libraryRecord(second, 2), libraryRecord(third, 3)]), f = setup(records);
  await f.cache.cache.store(libraryScope, records.slice(0, 1)); await f.client.initialize(); const read = f.revision.getMockImplementation()!;
  f.revision.mockImplementation(async (lib, id) => { if (id === records[1]!.publication.revisionId) throw new Error('Interrupted middle revision'); return read(lib, id); });
  await expect(f.client.download(first.manifest.libraryId)).rejects.toThrow('Interrupted middle'); expect(f.cache.writes).toBe(1); f.revision.mockImplementation(read); f.revision.mockClear(); await f.client.download(first.manifest.libraryId);
  expect(f.revision.mock.calls.map(call => call[1])).toEqual([records[2]!.publication.revisionId, records[1]!.publication.revisionId]); expect(await f.cache.cache.history(libraryScope, first.manifest.libraryId)).toEqual(records); expect(f.cache.writes).toBe(2);
});
it('keeps a newer cached head when recovering an older accepted publication and refuses server rollback', async () => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture()); f.cache.fail = true; await expect(f.client.submit(draft)).rejects.toThrow('cache save'); f.cache.fail = false;
  const first = (await validateRoomLibraryBundle(draft.packet.bundle)).revision, next = await libraryRecord(await libraryFixture(first, 180), 2); f.records.push(next); await f.cache.cache.store(libraryScope, f.records); const writes = f.cache.writes;
  await f.client.recover(); expect(f.cache.writes).toBe(writes); expect(f.client.snapshot.libraries[0]?.step).toBe(2); f.records.pop(); await expect(f.client.download(first.manifest.libraryId)).rejects.toThrow('older'); expect(f.cache.writes).toBe(writes);
});
it.each(['foreign member', 'foreign room', 'bad graph', 'changed owner', 'gap'])('refuses a %s response without caching a partial history', async reason => {
  const revision = await libraryFixture(), record = await libraryRecord(revision), f = setup([record]); await f.client.initialize(); const read = f.revision.getMockImplementation()!;
  f.revision.mockImplementation(async (lib, id) => { const reply = await read(lib, id); if (reason === 'foreign member') reply.actor = { ...libraryActor, id: 'foreign_member_001' }; if (reason === 'foreign room') reply.documentId = 'foreign_document_001'; if (reason === 'bad graph') reply.bundle.checksum = '0'.repeat(64); if (reason === 'changed owner') reply.publication.ownerId = 'foreign_owner_001'; if (reason === 'gap') reply.publication.step = 2; return reply; });
  await expect(f.client.download(revision.manifest.libraryId)).rejects.toThrow(); expect(f.cache.writes).toBe(0); expect(f.pending.value).toBeNull();
});
it.each(['origin', 'epoch', 'actor'])('refuses a stale %s review before saving a packet or dispatching', async changed => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture());
  f.context = { ...f.context!, ...(changed === 'origin' ? { serverUrl: 'https://other.example.test/' } : changed === 'epoch' ? { epoch: 2 } : { actor: { ...libraryActor, id: 'other_member_001' } }) };
  await expect(f.client.submit(draft)).rejects.toThrow('changed after review'); expect(f.pending.writes).toBe(0); expect(f.publish).not.toHaveBeenCalled();
});
it('rejects duplicate operations and closes a late native handle after a project change', async () => {
  const f = setup(); await f.client.initialize(); const wait = deferred<RoomLibraryTransport>(); f.open.mockImplementationOnce(() => wait.promise); const operation = f.client.refreshCatalog();
  await expect(f.client.refreshCatalog()).rejects.toThrow('Wait'); f.current = false; f.client.refresh(); wait.resolve(f.transport); await expect(operation).rejects.toThrow('room changed'); expect(f.dispose).toHaveBeenCalledOnce(); expect(f.catalog).not.toHaveBeenCalled(); expect(f.cache.writes).toBe(0);
});
it('aborts a downloaded revision on origin change and preserves its isolated cache', async () => {
  const revision = await libraryFixture(), record = await libraryRecord(revision), f = setup([record]); await f.client.initialize(); const wait = deferred<Awaited<ReturnType<typeof f.revision>>>(); f.revision.mockImplementationOnce(() => wait.promise);
  const operation = f.client.download(revision.manifest.libraryId); await vi.waitFor(() => expect(f.revision).toHaveBeenCalled()); f.context = { ...f.context!, serverUrl: 'https://other.example.test/', epoch: 2 }; f.client.refresh(); wait.resolve({ version: 1, documentId: libraryScope.documentId, actor: libraryActor, ...record });
  await expect(operation).rejects.toThrow('room changed'); expect(f.cache.writes).toBe(0); expect(f.client.snapshot.libraries).toEqual([]);
});
it('copies reviewed packets before asynchronous persistence and permits only local offline dismissal', async () => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture()), original = structuredClone(draft.packet); f.recover.mockRejectedValue(new Error('Unknown outcome'));
  const submitting = f.client.submit(draft); draft.packet.bundle.manifest.name = 'Caller mutation'; await expect(submitting).rejects.toThrow('Unknown outcome'); expect((await f.pending.pending.load(libraryProjectId))!.packet).toEqual(original);
  const sent = f.recover.mock.calls.length; f.context = null; await f.client.dismiss(); expect(f.recover).toHaveBeenCalledTimes(sent); expect(f.publish).not.toHaveBeenCalled(); expect(f.client.snapshot.pending).toBeNull(); expect(f.client.snapshot.phase).toBe('ready');
});
it('preserves newer pending bytes and blocks requests until valid pending data is restored', async () => {
  const f = setup(); f.pending.value = { version: 2, pending: null }; const original = JSON.stringify(f.pending.value); await f.client.initialize(); expect(f.client.snapshot.phase).toBe('error');
  await expect(f.client.refreshCatalog()).rejects.toThrow('Restore'); expect(f.open).not.toHaveBeenCalled(); expect(JSON.stringify(f.pending.value)).toBe(original); f.pending.value = null; await f.client.initialize(); await f.client.refreshCatalog(); expect(f.client.snapshot.phase).toBe('ready');
});
it('refuses a receipt for altered immutable bytes while retaining its original request', async () => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture()), record = await libraryRecord((await validateRoomLibraryBundle(draft.packet.bundle)).revision);
  f.recover.mockResolvedValue({ version: 1, documentId: libraryScope.documentId, actor: libraryActor, requestId: draft.packet.requestId, publication: { ...record.publication, bundleDigest: await contentHash({ wrong: true }) }, current: { ...record.publication, bundleDigest: await contentHash({ wrong: true }) } });
  await expect(f.client.submit(draft)).rejects.toThrow('another immutable'); expect(f.publish).not.toHaveBeenCalled(); expect(f.cache.writes).toBe(0); expect(f.client.snapshot.pending?.requestId).toBe(draft.packet.requestId);
});
it('retains the durable original packet when an accepted reply arrives after the project closes', async () => {
  const f = setup(); await f.client.initialize(); const draft = await f.client.prepare(await libraryFixture()), wait = deferred<RoomLibraryPublication>(), send = f.publish.getMockImplementation()!;
  f.publish.mockImplementationOnce(async packet => { await send(packet); return wait.promise; }); const operation = f.client.submit(draft); await vi.waitFor(() => expect(f.receipts.size).toBe(1)); f.current = false; f.client.dispose(); wait.resolve(f.receipts.get(draft.packet.requestId)!);
  await expect(operation).rejects.toThrow('room changed'); expect(f.cache.writes).toBe(0); expect((await f.pending.pending.load(libraryProjectId))?.packet).toEqual(draft.packet); expect(f.dispose).toHaveBeenCalledTimes(2);
});
it('uses the fresh library member role to refuse publication review even if artwork still reports editor access', async () => {
  const f = setup(); await f.client.initialize(); f.catalog.mockResolvedValue({ version: 1, documentId: libraryScope.documentId, actor: { ...libraryActor, role: 'viewer' }, libraries: [] });
  await expect(f.client.prepare(await libraryFixture())).rejects.toThrow('editor or owner'); expect(f.context!.actor.role).toBe('owner'); expect(f.client.snapshot.actor?.role).toBe('viewer'); expect(f.pending.writes).toBe(0); expect(f.publish).not.toHaveBeenCalled();
});
