import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createEditor } from '@open-pencil/core/editor';
import { SceneGraph, setInstanceOverride } from '@open-pencil/scene-graph';
import { getAppState } from '@/lib/db';
import { OrionLibraryCatalog } from './libraryCatalog';
import { PencilLibrarySession } from './librarySession';
import { RoomAwareLibraryCatalog } from './roomLibraryCatalog';
import { serializeGraph } from './graphDocument';
import { createPublicationRevision } from './libraryDependencies';
import { prepareLibrarySource } from './libraryResources';
import { libraryCacheStorage, libraryFixture, libraryProjectId, libraryRecord, libraryScope } from './roomLibraries.testSupport';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (value: string) => value }));
vi.mock('@/lib/db', () => ({ getAppState: vi.fn(async () => null) }));
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.mocked(getAppState).mockClear(); });
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const first = await libraryFixture(), second = await libraryFixture(first, 180), third = await libraryFixture(second, 220);
  const cache = libraryCacheStorage(); await cache.cache.store(libraryScope, [await libraryRecord(first), await libraryRecord(second, 2), await libraryRecord(third, 3)]);
  const local = new OrionLibraryCatalog({ read: async () => null, write: async () => undefined });
  const catalog = new RoomAwareLibraryCatalog(() => libraryScope, local, cache.cache);
  const editor = createEditor(), session = new PencilLibrarySession(editor, libraryProjectId, catalog);
  const libraryId = (await session.listLibraries())[0]!.libraryId;
  await session.setEnabled(libraryId, true);
  const revisions = await session.listRevisions(libraryId);
  editor.graph.enabledLibraries.set(libraryId, { libraryId, revisionId: revisions[0]!.revisionId, enabled: true });
  const placed = await session.insertComponent({ libraryId, assetKey: 'card', x: 12, y: 24 });
  const label = editor.graph.getChildren(placed.id).find(node => node.type === 'TEXT')!;
  editor.graph.updateNode(label.id, { text: 'Personal label' });
  setInstanceOverride(editor.graph.getNode(placed.id)!.instanceOverrides, placed.id, label.id, 'text', 'Personal label');
  return { first, second, third, cache, catalog, editor, session, libraryId, placed };
}

it('reviews and applies an exact cached target in either direction, preserving overrides and Undo', async () => {
  const state = await setup();
  try {
    const revisions = await state.session.listRevisions(state.libraryId);
    const cachedBefore = JSON.stringify(state.cache.value), originalGraph = serializeGraph(state.editor.graph);
    expect(revisions.map(item => item.step)).toEqual([1, 2, 3]);
    expect(revisions[0]?.previousRevisionId).toBeNull();
    expect(revisions[1]?.previousRevisionId).toBe(revisions[0]?.revisionId);
    expect(revisions[2]?.previousRevisionId).toBe(revisions[1]?.revisionId);
    const old = state.editor.graph.enabledLibraries.get(state.libraryId)!.revisionId;
    const review = await state.session.reviewUpdate(state.libraryId, revisions[1]!.revisionId);
    expect(review?.targetRevisionId).toBe(revisions[1]!.revisionId);
    expect(review?.currentRevisionId).toBe(old);
    expect(state.editor.graph.enabledLibraries.get(state.libraryId)!.revisionId).toBe(old);
    expect(serializeGraph(state.editor.graph)).toBe(originalGraph);
    state.session.applyUpdate(review!);
    expect(state.editor.graph.getNode(state.placed.id)?.width).toBe(180);
    expect(state.editor.graph.getChildren(state.placed.id).find(node => node.type === 'TEXT')?.text).toBe('Personal label');
    expect(JSON.stringify(state.cache.value)).toBe(cachedBefore);
    expect((await state.catalog.getRevision(state.libraryId)).manifest.revisionId).toBe(revisions[2]!.revisionId);
    const backward = await state.session.reviewUpdate(state.libraryId, revisions[0]!.revisionId);
    expect(backward?.targetRevisionId).toBe(revisions[0]!.revisionId);
    state.session.applyUpdate(backward!);
    expect(state.editor.graph.getNode(state.placed.id)?.width).toBe(100);
    state.editor.undoAction();
    expect(state.editor.graph.getNode(state.placed.id)?.width).toBe(180);
    expect(state.editor.graph.enabledLibraries.get(state.libraryId)?.revisionId).toBe(revisions[1]!.revisionId);
    expect(state.editor.graph.getChildren(state.placed.id).find(node => node.type === 'TEXT')?.text).toBe('Personal label');
  } finally { state.session.dispose(); state.editor.dispose(); }
});

it('returns no-op only after verifying the exact current target and rejects an unavailable target', async () => {
  const state = await setup();
  try {
    const current = state.editor.graph.enabledLibraries.get(state.libraryId)!.revisionId;
    await expect(state.session.reviewUpdate(state.libraryId, current)).resolves.toBeNull();
    await expect(state.session.reviewUpdate(state.libraryId, 'f'.repeat(64))).rejects.toThrow(/not been downloaded|could not be found/);
  } finally { state.session.dispose(); state.editor.dispose(); }
});

it('applies a targeted revision that removes an asset while retaining its existing instance definition', async () => {
  const libraryId = 'library:targeted-removal';
  const makeRevision = async (previous?: Awaited<ReturnType<typeof libraryFixture>>, includeBadge = true) => {
    const graph = new SceneGraph();
    const card = graph.createNode('COMPONENT', graph.getPages()[0]!.id, { name: 'Card', width: includeBadge ? 100 : 180, height: 40 });
    const badge = includeBadge ? graph.createNode('COMPONENT', graph.getPages()[0]!.id, { name: 'Badge', x: 140, width: 60, height: 30 }) : undefined;
    const roots = [card.id, ...(badge ? [badge.id] : [])];
    const prepared = await prepareLibrarySource(graph, libraryId, roots);
    return createPublicationRevision({ libraryId, name: 'Targeted removal', description: '', graph: prepared.graph, assetNodeIds: roots, previousRevisionId: previous?.manifest.revisionId ?? null, publishedAt: '2026-10-13T12:00:00.000Z' });
  };
  const first = await makeRevision(), second = await makeRevision(first, false), cache = libraryCacheStorage();
  await cache.cache.store(libraryScope, [await libraryRecord(first), await libraryRecord(second, 2)]);
  const local = new OrionLibraryCatalog({ read: async () => null, write: async () => undefined }), catalog = new RoomAwareLibraryCatalog(() => libraryScope, local, cache.cache);
  const editor = createEditor(), session = new PencilLibrarySession(editor, libraryProjectId, catalog);
  try {
    const scopedLibraryId = (await session.listLibraries())[0]!.libraryId;
    await session.setEnabled(scopedLibraryId, true);
    const revisions = await session.listRevisions(scopedLibraryId);
    editor.graph.enabledLibraries.set(scopedLibraryId, { libraryId: scopedLibraryId, revisionId: revisions[0]!.revisionId, enabled: true });
    const badgeKey = first.manifest.assets.find(asset => asset.name === 'Badge')!.key;
    const badge = await session.insertComponent({ libraryId: scopedLibraryId, assetKey: badgeKey });
    const review = await session.reviewUpdate(scopedLibraryId, revisions[1]!.revisionId);
    expect(review?.removedInstanceCount).toBe(1);
    expect(review?.affectedInstanceCount).toBe(0);
    session.applyUpdate(review!);
    expect(editor.graph.getNode(badge.id)).toBeTruthy();
    expect(editor.graph.getNode(badge.id)?.componentId).toBe(badge.componentId);
    expect(editor.graph.getNode(badge.componentId)).toBeTruthy();
    editor.undoAction();
    expect(editor.graph.enabledLibraries.get(scopedLibraryId)?.revisionId).toBe(revisions[0]!.revisionId);
    expect(editor.graph.getNode(badge.componentId)).toBeTruthy();
  } finally { session.dispose(); editor.dispose(); }
});

it('rejects forged, cross-session, mutated and disposed-session reviews without changing either graph', async () => {
  const state = await setup(), otherEditor = createEditor(), otherSession = new PencilLibrarySession(otherEditor, libraryProjectId, state.catalog);
  try {
    const revisions = await state.session.listRevisions(state.libraryId);
    const review = await state.session.reviewUpdate(state.libraryId, revisions[2]!.revisionId);
    const otherBefore = serializeGraph(otherEditor.graph), sourceBefore = serializeGraph(state.editor.graph);
    expect(() => otherSession.applyUpdate(review!)).toThrow(/invalid|another design session/);
    expect(() => state.session.applyUpdate({ ...review! })).toThrow(/invalid|another design session/);
    expect(serializeGraph(otherEditor.graph)).toBe(otherBefore);
    expect(serializeGraph(state.editor.graph)).toBe(sourceBefore);
    const originalName = review!.name; review!.name = 'Changed issued review';
    expect(() => state.session.applyUpdate(review!)).toThrow(/invalid|another design session/);
    expect(serializeGraph(state.editor.graph)).toBe(sourceBefore); review!.name = originalName;
    state.session.dispose();
    expect(() => state.session.applyUpdate(review!)).toThrow(/canvas has closed/);
  } finally { state.session.dispose(); otherSession.dispose(); state.editor.dispose(); otherEditor.dispose(); }
});

it('rejects a review after graph mutation or room-context change, including mutation during an awaited read', async () => {
  const state = await setup();
  try {
    const revisions = await state.session.listRevisions(state.libraryId);
    const review = await state.session.reviewUpdate(state.libraryId, revisions[2]!.revisionId);
    const prior = state.editor.graph.getNode(state.placed.id)!;
    state.editor.graph.updateNode(prior.id, { x: prior.x + 1 });
    expect(() => state.session.applyUpdate(review!)).toThrow(/design changed/);
  } finally { state.session.dispose(); state.editor.dispose(); }

  const state2 = await setup();
  let scope = libraryScope;
  let changeOnRead = false;
  const delayedCatalog = {
    listLibraries: (...args: Parameters<typeof state2.catalog.listLibraries>) => state2.catalog.listLibraries(...args),
    listRevisions: (...args: Parameters<typeof state2.catalog.listRevisions>) => state2.catalog.listRevisions(...args),
    captureReviewGuard: () => () => { if (scope !== libraryScope) throw new Error('The library room changed. Refresh before continuing.'); },
    getRevision: async (...args: Parameters<typeof state2.catalog.getRevision>) => {
      const result = await state2.catalog.getRevision(...args);
      if (changeOnRead) scope = { ...libraryScope, documentId: 'different_room_document' };
      return result;
    },
    publishRevision: (...args: Parameters<typeof state2.catalog.publishRevision>) => state2.catalog.publishRevision(...args),
  };
  const editor2 = createEditor(), session2 = new PencilLibrarySession(editor2, libraryProjectId, delayedCatalog);
  try {
    const id = (await session2.listLibraries())[0]!.libraryId;
    await session2.setEnabled(id, true);
    changeOnRead = true;
    const revisions = await session2.listRevisions(id);
    await expect(session2.reviewUpdate(id, revisions[0]!.revisionId)).rejects.toThrow(/room changed/);
  } finally { session2.dispose(); editor2.dispose(); state2.session.dispose(); state2.editor.dispose(); }
});

it('detects source graph changes during an exact-current read before returning a no-op', async () => {
  const state = await setup(), node = state.editor.graph.getNode(state.placed.id)!;
  state.session.dispose();
  let changeGraphOnRead = false;
  const delayedCatalog = {
    listLibraries: (...args: Parameters<typeof state.catalog.listLibraries>) => state.catalog.listLibraries(...args),
    listRevisions: (...args: Parameters<typeof state.catalog.listRevisions>) => state.catalog.listRevisions(...args),
    captureReviewGuard: () => () => undefined,
    getRevision: async (...args: Parameters<typeof state.catalog.getRevision>) => {
      const result = await state.catalog.getRevision(...args);
      if (changeGraphOnRead) state.editor.graph.updateNode(node.id, { x: node.x + 3 });
      return result;
    },
    publishRevision: (...args: Parameters<typeof state.catalog.publishRevision>) => state.catalog.publishRevision(...args),
  };
  const session = new PencilLibrarySession(state.editor, libraryProjectId, delayedCatalog);
  try {
    const revisions = await session.listRevisions(state.libraryId);
    changeGraphOnRead = true;
    await expect(session.reviewUpdate(state.libraryId, revisions[0]!.revisionId)).rejects.toThrow(/design changed/);
  } finally { session.dispose(); state.session.dispose(); state.editor.dispose(); }
});

it('rejects a room-context-stale issued review even when the source graph is byte-identical', async () => {
  const state = await setup(); let scope = libraryScope;
  const catalog = new RoomAwareLibraryCatalog(() => scope, new OrionLibraryCatalog({ read: async () => null, write: async () => undefined }), state.cache.cache);
  const editor = createEditor(), session = new PencilLibrarySession(editor, libraryProjectId, catalog);
  try {
    const id = (await session.listLibraries())[0]!.libraryId; await session.setEnabled(id, true);
    const revisions = await session.listRevisions(id);
    const review = await session.reviewUpdate(id, revisions[1]!.revisionId);
    const before = serializeGraph(editor.graph);
    scope = { ...libraryScope, documentId: 'different_room_document' };
    expect(serializeGraph(editor.graph)).toBe(before);
    expect(() => session.applyUpdate(review!)).toThrow(/room changed/);
    expect(serializeGraph(editor.graph)).toBe(before);
  } finally { session.dispose(); editor.dispose(); state.session.dispose(); state.editor.dispose(); }
});

it('rejects a catalog that substitutes the requested target or current manifest and preserves the graph', async () => {
  const state = await setup(); state.session.dispose();
  const revisions = await state.catalog.listRevisions(state.libraryId), targetId = revisions[2]!.revisionId, currentId = revisions[0]!.revisionId;
  for (const mismatch of ['target-id', 'target-library', 'current-id']) {
    const catalog = {
      listLibraries: () => state.catalog.listLibraries(), listRevisions: (id: string) => state.catalog.listRevisions(id), publishRevision: (...args: Parameters<typeof state.catalog.publishRevision>) => state.catalog.publishRevision(...args), captureReviewGuard: () => state.catalog.captureReviewGuard(),
      getRevision: async (id: string, revisionId?: string) => {
        const revision = await state.catalog.getRevision(id, revisionId);
        return { ...revision, manifest: { ...revision.manifest, ...(revisionId === targetId && mismatch === 'target-id' ? { revisionId: currentId } : revisionId === targetId && mismatch === 'target-library' ? { libraryId: 'foreign-library' } : revisionId === currentId && mismatch === 'current-id' ? { revisionId: targetId } : {}) } };
      },
    };
    const session = new PencilLibrarySession(state.editor, libraryProjectId, catalog), before = serializeGraph(state.editor.graph);
    try { await expect(session.reviewUpdate(state.libraryId, targetId)).rejects.toThrow('could not be verified'); expect(serializeGraph(state.editor.graph)).toBe(before); }
    finally { session.dispose(); }
  }
  state.editor.dispose();
});
