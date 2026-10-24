import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { contentHash, type ComponentLibraryRevision } from '@open-pencil/core/library';
import { createEditor } from '@open-pencil/core/editor';
import { SceneGraph, setInstanceOverride } from '@open-pencil/scene-graph';
import { getAppState } from '@/lib/db';
import { OrionLibraryCatalog } from './libraryCatalog';
import { RoomAwareLibraryCatalog, bindRoomLibraryScope, roomAwareLibraryCatalog } from './roomLibraryCatalog';
import { PencilLibrarySession } from './librarySession';
import { roomLibraryIdentity } from './roomLibraryIdentity';
import { libraryCacheStorage, libraryFixture, libraryProjectId, libraryRecord, libraryScope } from './roomLibraries.testSupport';
import { serializeGraph } from './graphDocument';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (value: string) => value }));
vi.mock('@/lib/db', () => ({ getAppState: vi.fn(async () => null) }));
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.mocked(getAppState).mockClear(); });
afterEach(() => vi.unstubAllGlobals());
async function deviceCatalog(revision?: ComponentLibraryRevision) {
  const graph = revision ? serializeGraph(revision.graph) : '';
  let value: unknown = revision ? { formatVersion: 1, libraries: [{ libraryId: revision.manifest.libraryId, sourceProjectId: libraryProjectId, latestRevisionId: revision.manifest.revisionId, revisions: [{ manifest: revision.manifest, graph, checksum: await contentHash({ graph }) }] }] } : null;
  return new OrionLibraryCatalog({ read: async () => structuredClone(value), write: async (next, expected) => { if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Device catalog changed'); value = structuredClone(next); } });
}
it('keeps matching raw device and room identities separate and uses downloaded copies without networking', async () => {
  const revision = await libraryFixture(), cache = libraryCacheStorage(), local = await deviceCatalog(revision); await cache.cache.store(libraryScope, [await libraryRecord(revision)]);
  const catalog = new RoomAwareLibraryCatalog(() => libraryScope, local, cache.cache), summaries = await catalog.listLibraries(); expect(summaries.map(item => item.origin)).toEqual(['device', 'room']); expect(new Set(summaries.map(item => item.libraryId)).size).toBe(2);
  expect(JSON.stringify((await catalog.getRevision(revision.manifest.libraryId)).manifest)).toBe(JSON.stringify(revision.manifest)); expect((await catalog.getRevision(summaries[1]!.libraryId)).manifest.libraryId).toBe(await roomLibraryIdentity(libraryScope, revision.manifest.libraryId));
  expect(await catalog.listRevisions(summaries[1]!.libraryId)).toMatchObject([{ previousRevisionId: null, name: revision.manifest.name, description: revision.manifest.description, publishedAt: revision.manifest.publishedAt, assetCount: revision.manifest.assets.length, step: 1 }]);
  await expect(catalog.listRevisions(await roomLibraryIdentity({ ...libraryScope, documentId: 'library_document_002' }, revision.manifest.libraryId))).rejects.toThrow('not been downloaded');
});
it('inserts room-scoped SDK definitions, reviews successor geometry with personal overrides and retains the previous pinned revision', async () => {
  const first = await libraryFixture(), next = await libraryFixture(first, 180), cache = libraryCacheStorage(), local = await deviceCatalog(); await cache.cache.store(libraryScope, [await libraryRecord(first)]);
  const editor = createEditor(), catalog = new RoomAwareLibraryCatalog(() => libraryScope, local, cache.cache), session = new PencilLibrarySession(editor, libraryProjectId, catalog);
  try {
    const id = (await session.listLibraries())[0]!.libraryId; await session.setEnabled(id, true); const placed = await session.insertComponent({ libraryId: id, assetKey: 'card', x: 12, y: 24 });
    const instance = editor.graph.getNode(placed.id)!, label = editor.graph.getChildren(instance.id).find(node => node.type === 'TEXT')!; editor.graph.updateNode(label.id, { text: 'Personal label' }); setInstanceOverride(instance.instanceOverrides, instance.id, label.id, 'text', 'Personal label');
    const old = editor.graph.enabledLibraries.get(id)!.revisionId; await cache.cache.store(libraryScope, [await libraryRecord(first), await libraryRecord(next, 2)]);
    const before = serializeGraph(editor.graph), review = await session.reviewUpdate(id); expect(review?.affectedInstanceCount).toBe(1); expect(serializeGraph(editor.graph)).toBe(before); expect(editor.graph.enabledLibraries.get(id)!.revisionId).toBe(old);
    session.applyUpdate(review!); expect(editor.graph.getNode(placed.id)!.width).toBe(180); expect(editor.graph.getChildren(placed.id).find(node => node.type === 'TEXT')!.text).toBe('Personal label'); expect((await catalog.getRevision(id, old)).manifest.revisionId).toBe(old); editor.undoAction(); expect(editor.graph.getNode(placed.id)!.width).toBe(100); expect(editor.graph.getChildren(placed.id).find(node => node.type === 'TEXT')!.text).toBe('Personal label');
  } finally { session.dispose(); editor.dispose(); }
});
it('guards a room change during reads and never resolves a remote identity from another room', async () => {
  const revision = await libraryFixture(), cache = libraryCacheStorage(), local = await deviceCatalog(); await cache.cache.store(libraryScope, [await libraryRecord(revision)]);
  let scope = libraryScope; const read = vi.fn(async () => { scope = { ...libraryScope, documentId: 'other_document_001' }; return cache.cache.list(libraryScope); });
  const catalog = new RoomAwareLibraryCatalog(() => scope, local, { list: read, contains: (...args) => cache.cache.contains(...args), revision: (...args) => cache.cache.revision(...args), listRevisions: (...args) => cache.cache.listRevisions(...args) });
  await expect(catalog.listLibraries()).rejects.toThrow('room changed'); await expect(catalog.getRevision(await roomLibraryIdentity(libraryScope, revision.manifest.libraryId))).rejects.toThrow('not downloaded');
});
it('refuses a reserved device/room identity collision and preserves both catalogs', async () => {
  const cache = libraryCacheStorage(), original = await libraryFixture(); await cache.cache.store(libraryScope, [await libraryRecord(original)]);
  const collision = await libraryFixture(undefined, 120, await roomLibraryIdentity(libraryScope, original.manifest.libraryId)), local = await deviceCatalog(collision), before = JSON.stringify(cache.value), catalog = new RoomAwareLibraryCatalog(() => libraryScope, local, cache.cache);
  await expect(catalog.listLibraries()).rejects.toThrow('conflicts'); await expect(catalog.getRevision(collision.manifest.libraryId)).rejects.toThrow('conflicts'); await expect(catalog.listRevisions(collision.manifest.libraryId)).rejects.toThrow('conflicts'); expect(JSON.stringify(cache.value)).toBe(before); expect(JSON.stringify((await local.getRevision(collision.manifest.libraryId)).manifest)).toBe(JSON.stringify(collision.manifest));
});
it('delegates new publication only to the device catalog and handles legitimate reserved local names offline', async () => {
  const local = await deviceCatalog(), remote = { list: vi.fn(), contains: vi.fn(), revision: vi.fn(), listRevisions: vi.fn() }, catalog = new RoomAwareLibraryCatalog(() => null, local, remote), graph = new SceneGraph(), component = graph.createNode('COMPONENT', graph.getPages()[0]!.id, { name: 'Local', componentKey: 'local', width: 100, height: 40 });
  const revision = await catalog.publishRevision({ libraryId: 'orion-room-device-library', name: 'Local', graph, assetNodeIds: [component.id] }, libraryProjectId); expect((await catalog.listLibraries())[0]?.origin).toBe('device'); expect((await catalog.getRevision(revision.manifest.libraryId)).manifest).toEqual(revision.manifest); expect(await catalog.listRevisions(revision.manifest.libraryId)).toMatchObject([{ previousRevisionId: null, step: 1 }]); expect(remote.list).not.toHaveBeenCalled(); expect(remote.revision).not.toHaveBeenCalled(); expect(remote.listRevisions).not.toHaveBeenCalled();
});
it('retains the replacement canvas scope when an older session unbinds', async () => {
  const editor = createEditor(); const older = bindRoomLibraryScope(editor, () => libraryScope), newer = bindRoomLibraryScope(editor, () => ({ ...libraryScope, documentId: 'other_document_001' })); older();
  expect(await roomAwareLibraryCatalog(editor).listLibraries()).toEqual([]); expect(vi.mocked(getAppState).mock.calls.filter(call => call[0] === 'xdesign.roomLibraries')).toHaveLength(1); newer(); expect(await roomAwareLibraryCatalog(editor).listLibraries()).toEqual([]); expect(vi.mocked(getAppState).mock.calls.filter(call => call[0] === 'xdesign.roomLibraries')).toHaveLength(1); editor.dispose();
});
it('invalidates a prepared review guard on scope or room-provider rebinding, even with the same scope value', async () => {
  let scope: typeof libraryScope | null = libraryScope, provider = 0;
  const local = await deviceCatalog();
  const catalog = new RoomAwareLibraryCatalog(() => scope, local, libraryCacheStorage().cache, () => provider);
  const scopeGuard = catalog.captureReviewGuard(); scope = { ...libraryScope, documentId: 'library_document_002' };
  expect(scopeGuard).toThrow('room changed'); scope = libraryScope;
  const providerGuard = catalog.captureReviewGuard(); provider++;
  expect(providerGuard).toThrow('room changed');
});
it('invalidates reserved room revision listing when its provider is rebound during an await', async () => {
  let provider: object = {}, begin!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; }), pending = new Promise<void>(resolve => { finish = resolve; });
  const originalId = 'library:original', scopedId = await roomLibraryIdentity(libraryScope, originalId), local = await deviceCatalog();
  const remote = {
    list: vi.fn(async () => []), contains: vi.fn(async () => true), revision: vi.fn(),
    listRevisions: vi.fn(async () => { begin(); await pending; return []; }),
  };
  const catalog = new RoomAwareLibraryCatalog(() => libraryScope, local, remote, () => provider);
  const listing = catalog.listRevisions(scopedId); await started; provider = {};
  finish(); await expect(listing).rejects.toThrow('room changed');
  expect(remote.listRevisions).toHaveBeenCalledTimes(1);
});
it('captures the bound room-scope provider identity in the editor catalog factory', () => {
  const editor = createEditor(), first = bindRoomLibraryScope(editor, () => libraryScope), catalog = roomAwareLibraryCatalog(editor), guard = catalog.captureReviewGuard!();
  first(); const second = bindRoomLibraryScope(editor, () => libraryScope);
  expect(guard).toThrow('room changed'); second(); editor.dispose();
});
