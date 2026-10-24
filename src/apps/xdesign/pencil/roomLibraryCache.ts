import { assertLibraryId, type ComponentLibraryRevision, type LibrarySummary } from '@open-pencil/core/library';
import { getAppState, compareAndSetXDesignRoomLibraries } from '@/lib/db';
import { readRoomLibraryBundle, readRoomLibrarySummary, validateRoomLibraryBundle, type RoomLibraryBundle, type RoomLibrarySummary } from './roomLibraryProtocol';
import { readRoomLibraryScope, roomLibraryIdentity, scopeRoomLibraryRevision, type RoomLibraryScope } from './roomLibraryIdentity';
import type { LibraryRevisionSummary } from './libraryCatalog';

export type CachedRoomRevision = { publication: RoomLibrarySummary; bundle: RoomLibraryBundle };
type CachedLibrary = RoomLibraryScope & { libraryId: string; revisions: CachedRoomRevision[] };
type CacheState = { version: 1; libraries: CachedLibrary[] };
export type RoomLibraryCacheStorage = { read(): Promise<unknown>; write(value: CacheState, expected: unknown): Promise<void> };
export const ROOM_LIBRARY_CACHE_BYTES = 96 * 1024 * 1024;
export const ROOM_LIBRARY_CACHE_REVISIONS = 500;
const sameScope = (a: RoomLibraryScope, b: RoomLibraryScope) => a.serverUrl === b.serverUrl && a.documentId === b.documentId;
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid saved shared libraries. They were preserved.');
  return value as Record<string, unknown>;
}
function record(value: unknown): CachedRoomRevision {
  const item = object(value, ['publication', 'bundle']); return { publication: readRoomLibrarySummary(item.publication), bundle: readRoomLibraryBundle(item.bundle) };
}
function chain(records: CachedRoomRevision[], libraryId: string): void {
  if (!records.length) throw new Error('The shared library history is incomplete.');
  const ids = new Set<string>(), owner = records[0]!.publication.ownerId; let previous: string | null = null;
  records.forEach(({ publication, bundle }, index) => {
    if (publication.libraryId !== libraryId || bundle.manifest.libraryId !== libraryId || publication.ownerId !== owner || publication.step !== index + 1 || publication.previousRevisionId !== previous || bundle.manifest.previousRevisionId !== previous || publication.revisionId !== bundle.manifest.revisionId || ids.has(publication.revisionId)) throw new Error('The shared library history has a different source or predecessor.');
    ids.add(publication.revisionId); previous = publication.revisionId;
  });
}
function decode(value: unknown): CacheState {
  if (value === null) return { version: 1, libraries: [] };
  const state = object(value, ['version', 'libraries']);
  if (state.version !== 1) throw new Error('Saved shared libraries need a newer application. They were preserved.');
  if (!Array.isArray(state.libraries) || state.libraries.length > 256 || new TextEncoder().encode(JSON.stringify(value)).byteLength > ROOM_LIBRARY_CACHE_BYTES) throw new Error('Saved shared libraries exceed their storage bounds. They were preserved.');
  const identities = new Set<string>(); let count = 0;
  const libraries = state.libraries.map(value => {
    const item = object(value, ['serverUrl', 'documentId', 'libraryId', 'revisions']), scope = readRoomLibraryScope({ serverUrl: item.serverUrl, documentId: item.documentId });
    if (typeof item.libraryId !== 'string' || !Array.isArray(item.revisions)) throw new Error('Invalid saved shared library. It was preserved.');
    assertLibraryId(item.libraryId); const identity = JSON.stringify([scope.serverUrl, scope.documentId, item.libraryId]);
    if (identities.has(identity)) throw new Error('Duplicate shared library sources. They were preserved.'); identities.add(identity);
    count += item.revisions.length;
    if (count > ROOM_LIBRARY_CACHE_REVISIONS) throw new Error('Saved shared library history exceeds its bound. It was preserved.');
    const revisions = item.revisions.map(record); chain(revisions, item.libraryId);
    return { ...scope, libraryId: item.libraryId, revisions };
  });
  return { version: 1, libraries };
}
async function validate(record: CachedRoomRevision): Promise<ComponentLibraryRevision> {
  const decoded = await validateRoomLibraryBundle(record.bundle), manifest = decoded.bundle.manifest, publication = record.publication;
  if (publication.bundleDigest !== decoded.bundleDigest || publication.libraryId !== manifest.libraryId || publication.revisionId !== manifest.revisionId || publication.previousRevisionId !== manifest.previousRevisionId || publication.name !== manifest.name || publication.description !== manifest.description || publication.publishedAt !== manifest.publishedAt || publication.assetCount !== manifest.assets.length) throw new Error('The saved shared library differs from its original publication. It was preserved.');
  return decoded.revision;
}
export class RoomLibraryCache {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: RoomLibraryCacheStorage = { read: () => getAppState('xdesign.roomLibraries', true), write: (value, expected) => compareAndSetXDesignRoomLibraries(value, expected) }) {}
  async list(scope: RoomLibraryScope): Promise<LibrarySummary[]> {
    const source = readRoomLibraryScope(scope), state = decode(await this.storage.read());
    const result: LibrarySummary[] = [];
    for (const library of state.libraries.filter(library => sameScope(library, source))) {
      const head = library.revisions.at(-1)!.publication;
      const revision = await this.scoped(library, head.revisionId);
      result.push({ libraryId: revision.manifest.libraryId, name: head.name, latestRevisionId: revision.manifest.revisionId, publishedAt: head.publishedAt, assetCount: head.assetCount });
    }
    return result;
  }
  async listRevisions(scope: RoomLibraryScope, scopedLibraryId: string): Promise<LibraryRevisionSummary[]> {
    const source = readRoomLibraryScope(scope); assertLibraryId(scopedLibraryId);
    const candidates = decode(await this.storage.read()).libraries.filter(item => sameScope(item, source)); let library: CachedLibrary | undefined;
    for (const candidate of candidates) if (await roomLibraryIdentity(source, candidate.libraryId) === scopedLibraryId) { library = candidate; break; }
    if (!library) throw new Error('This shared library revision has not been downloaded.');
    const result: LibraryRevisionSummary[] = []; let previous: string | null = null;
    for (const saved of library.revisions) {
      const revision = await scopeRoomLibraryRevision(source, await validate(saved), previous, saved.publication.bundleDigest), manifest = revision.manifest;
      result.push({ revisionId: manifest.revisionId, previousRevisionId: manifest.previousRevisionId, name: manifest.name, description: manifest.description, publishedAt: manifest.publishedAt, assetCount: manifest.assets.length, step: saved.publication.step });
      previous = manifest.revisionId;
    }
    return result;
  }
  async original(scope: RoomLibraryScope, libraryId: string, revisionId?: string): Promise<{ publication: RoomLibrarySummary; revision: ComponentLibraryRevision }> {
    const source = readRoomLibraryScope(scope); assertLibraryId(libraryId);
    const library = decode(await this.storage.read()).libraries.find(item => sameScope(item, source) && item.libraryId === libraryId);
    const saved = revisionId === undefined ? library?.revisions.at(-1) : library?.revisions.find(item => item.publication.revisionId === revisionId);
    if (!saved) throw new Error('This shared library revision has not been downloaded.');
    return { publication: structuredClone(saved.publication), revision: await validate(saved) };
  }
  async history(scope: RoomLibraryScope, libraryId: string): Promise<CachedRoomRevision[]> {
    const source = readRoomLibraryScope(scope); assertLibraryId(libraryId);
    const library = decode(await this.storage.read()).libraries.find(item => sameScope(item, source) && item.libraryId === libraryId);
    if (!library) return [];
    for (const saved of library.revisions) await validate(saved);
    return library.revisions.map(record);
  }
  async contains(scope: RoomLibraryScope, scopedLibraryId: string): Promise<boolean> {
    const source = readRoomLibraryScope(scope); assertLibraryId(scopedLibraryId);
    for (const library of decode(await this.storage.read()).libraries.filter(item => sameScope(item, source))) if (await roomLibraryIdentity(source, library.libraryId) === scopedLibraryId) return true;
    return false;
  }
  private async scoped(library: CachedLibrary, originalRevisionId: string): Promise<ComponentLibraryRevision> {
    let previous: string | null = null;
    for (const saved of library.revisions) {
      const revision = await scopeRoomLibraryRevision({ serverUrl: library.serverUrl, documentId: library.documentId }, await validate(saved), previous, saved.publication.bundleDigest);
      if (saved.publication.revisionId === originalRevisionId) return revision;
      previous = revision.manifest.revisionId;
    }
    throw new Error('This shared library revision has not been downloaded.');
  }
  async revision(scope: RoomLibraryScope, scopedLibraryId: string, scopedRevisionId?: string): Promise<ComponentLibraryRevision> {
    const source = readRoomLibraryScope(scope); assertLibraryId(scopedLibraryId);
    const state = decode(await this.storage.read());
    for (const library of state.libraries.filter(item => sameScope(item, source))) {
      if (await roomLibraryIdentity(source, library.libraryId) !== scopedLibraryId) continue;
      let previous: string | null = null;
      for (let index = 0; index < library.revisions.length; index++) {
        const saved = library.revisions[index]!, revision = await scopeRoomLibraryRevision(source, await validate(saved), previous, saved.publication.bundleDigest);
        if (scopedRevisionId === revision.manifest.revisionId || scopedRevisionId === undefined && index === library.revisions.length - 1) return revision;
        previous = revision.manifest.revisionId;
      }
    }
    throw new Error('This shared library revision has not been downloaded.');
  }
  store(scope: RoomLibraryScope, values: readonly CachedRoomRevision[]): Promise<void> {
    const source = readRoomLibraryScope(scope);
    if (!Array.isArray(values) || !values.length || values.length > ROOM_LIBRARY_CACHE_REVISIONS) return Promise.reject(new Error('The shared library history exceeds its cache bound.'));
    let bytes = 0;
    const incoming = values.map(value => {
      const copied = record(value); bytes += new TextEncoder().encode(JSON.stringify(copied)).byteLength;
      if (bytes > ROOM_LIBRARY_CACHE_BYTES) throw new Error('The shared library history exceeds its cache storage bound.');
      return copied;
    });
    const libraryId = incoming[0]!.publication.libraryId; chain(incoming, libraryId);
    const work = this.mutation.catch(() => undefined).then(async () => {
      const raw = await this.storage.read(), state = decode(raw);
      const index = state.libraries.findIndex(item => sameScope(item, source) && item.libraryId === libraryId), existing = state.libraries[index];
      if (existing && (incoming.length < existing.revisions.length || existing.revisions.some((saved, position) => JSON.stringify(saved) !== JSON.stringify(incoming[position])))) throw new Error('The shared library is older than, or differs from, a confirmed cached revision. Original revisions were preserved.');
      const next = { ...source, libraryId, revisions: incoming }, nextState = { ...state, libraries: [...state.libraries] };
      if (index < 0) nextState.libraries.push(next); else nextState.libraries[index] = next;
      decode(nextState);
      for (const library of state.libraries) for (const saved of library.revisions) await validate(saved);
      let previous: string | null = null;
      for (const saved of incoming) {
        const revision = await scopeRoomLibraryRevision(source, await validate(saved), previous, saved.publication.bundleDigest); previous = revision.manifest.revisionId;
      }
      if (existing && incoming.length === existing.revisions.length) return;
      await this.storage.write(nextState, raw);
    });
    this.mutation = work; return work;
  }
}
export const roomLibraryCache = new RoomLibraryCache();
