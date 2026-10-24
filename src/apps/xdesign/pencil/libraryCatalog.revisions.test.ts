import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { contentHash } from '@open-pencil/core/library';
import { OrionLibraryCatalog } from './libraryCatalog';
import { libraryFixture } from './roomLibraries.testSupport';
import { serializeGraph } from './graphDocument';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (value: string) => value }));
vi.mock('@/lib/db', () => ({ getAppState: vi.fn(async () => null), compareAndSetXDesignLibraries: vi.fn() }));
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

function storage() {
  let value: unknown = null, writes = 0;
  return {
    adapter: {
      read: async () => structuredClone(value),
      write: async (next: unknown, expected: unknown) => { if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Concurrent catalog change'); value = structuredClone(next); writes++; },
    },
    get value() { return value; },
    set value(next: unknown) { value = next; },
    get writes() { return writes; },
  };
}

async function stored(revisions: Awaited<ReturnType<typeof libraryFixture>>[]) {
  const entries = [];
  for (const revision of revisions) {
    const graph = serializeGraph(revision.graph);
    entries.push({ manifest: structuredClone(revision.manifest), graph, checksum: await contentHash({ graph }) });
  }
  return { formatVersion: 1, libraries: [{ libraryId: revisions[0]!.manifest.libraryId, sourceProjectId: null, latestRevisionId: revisions.at(-1)!.manifest.revisionId, revisions: entries }] };
}

it('lists fully validated device revision metadata in immutable publication order without writes', async () => {
  const first = await libraryFixture(), next = await libraryFixture(first, 180), saved = storage(); saved.value = await stored([first, next]);
  const catalog = new OrionLibraryCatalog(saved.adapter), before = JSON.stringify(saved.value), summaries = await catalog.listRevisions(first.manifest.libraryId);
  expect(summaries).toEqual([
    { revisionId: first.manifest.revisionId, previousRevisionId: null, name: first.manifest.name, description: first.manifest.description, publishedAt: first.manifest.publishedAt, assetCount: first.manifest.assets.length, step: 1 },
    { revisionId: next.manifest.revisionId, previousRevisionId: first.manifest.revisionId, name: next.manifest.name, description: next.manifest.description, publishedAt: next.manifest.publishedAt, assetCount: next.manifest.assets.length, step: 2 },
  ]);
  expect(Object.keys(summaries[0]!)).toEqual(['revisionId', 'previousRevisionId', 'name', 'description', 'publishedAt', 'assetCount', 'step']);
  expect(JSON.stringify(saved.value)).toBe(before); expect(saved.writes).toBe(0);
  await expect(catalog.listRevisions('missing-library')).rejects.toThrow('could not be found');
});

it('checks every stored revision checksum, including predecessors, before returning metadata', async () => {
  const first = await libraryFixture(), next = await libraryFixture(first, 180), saved = storage(); saved.value = await stored([first, next]);
  const corrupted = structuredClone(saved.value) as { libraries: { revisions: { checksum: string }[] }[] };
  corrupted.libraries[0]!.revisions[0]!.checksum = '0'.repeat(64); saved.value = corrupted;
  const before = JSON.stringify(saved.value), catalog = new OrionLibraryCatalog(saved.adapter);
  await expect(catalog.listRevisions(first.manifest.libraryId)).rejects.toThrow('integrity check');
  expect(JSON.stringify(saved.value)).toBe(before); expect(saved.writes).toBe(0);
});

it('refuses a valid but branched stored predecessor chain without writing', async () => {
  const first = await libraryFixture(), second = await libraryFixture(first, 180), branch = await libraryFixture(first, 220), saved = storage();
  saved.value = await stored([first, second, branch]);
  const before = JSON.stringify(saved.value), catalog = new OrionLibraryCatalog(saved.adapter);
  await expect(catalog.listRevisions(first.manifest.libraryId)).rejects.toThrow('broken predecessor chain');
  expect(JSON.stringify(saved.value)).toBe(before); expect(saved.writes).toBe(0);
});
