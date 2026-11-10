import type { Editor } from '@open-pencil/core/editor';
import type { LibrarySummary } from '@open-pencil/core/library';
import { orionLibraryCatalog, type LibraryRevisionSummary, type OrionLibraryCatalog } from './libraryCatalog';
import { roomLibraryCache, type RoomLibraryCache } from './roomLibraryCache';
import { readRoomLibraryScope, ROOM_LIBRARY_ID_PREFIX, type RoomLibraryScope } from './roomLibraryIdentity';

export type PencilLibrarySummary = LibrarySummary & { origin?: 'device' | 'room' };
export type PencilLibraryCatalog = Pick<OrionLibraryCatalog, 'getRevision' | 'publishRevision' | 'listRevisions'> & { listLibraries(): Promise<PencilLibrarySummary[]>; captureReviewGuard?(): () => void };
const scopes = new WeakMap<Editor, () => RoomLibraryScope | null>();
export function bindRoomLibraryScope(editor: Editor, read: () => RoomLibraryScope | null): () => void {
  scopes.set(editor, read); return () => { if (scopes.get(editor) === read) scopes.delete(editor); };
}
export class RoomAwareLibraryCatalog implements PencilLibraryCatalog {
  constructor(private readonly scope: () => RoomLibraryScope | null, private readonly local: PencilLibraryCatalog = orionLibraryCatalog, private readonly remote: Pick<RoomLibraryCache, 'list' | 'contains' | 'revision' | 'listRevisions'> = roomLibraryCache, private readonly providerIdentity?: () => unknown) {}
  private capture(): RoomLibraryScope | null { const scope = this.scope(); return scope ? readRoomLibraryScope(scope) : null; }
  private check(scope: RoomLibraryScope | null): void { if (JSON.stringify(this.capture()) !== JSON.stringify(scope)) throw new Error('The library room changed. Refresh before continuing.'); }
  captureReviewGuard(): () => void {
    const scope = this.capture(), provider = this.providerIdentity?.();
    return () => { this.check(scope); if (this.providerIdentity && this.providerIdentity() !== provider) throw new Error('The library room changed. Refresh before continuing.'); };
  }
  async listLibraries(): Promise<PencilLibrarySummary[]> {
    const scope = this.capture(), local = await this.local.listLibraries(); this.check(scope);
    const remote = scope ? await this.remote.list(scope) : []; this.check(scope);
    if (remote.some(item => local.some(saved => saved.libraryId === item.libraryId))) throw new Error('A device library conflicts with a shared library identity. Original libraries were preserved.');
    return [...local.map(item => ({ ...item, origin: 'device' as const })), ...remote.map(item => ({ ...item, origin: 'room' as const }))];
  }
  async getRevision(libraryId: string, revisionId?: string) {
    if (!libraryId.startsWith(ROOM_LIBRARY_ID_PREFIX)) return this.local.getRevision(libraryId, revisionId);
    const scope = this.capture(), local = (await this.local.listLibraries()).find(item => item.libraryId === libraryId); this.check(scope);
    const remote = scope ? await this.remote.contains(scope, libraryId) : false; this.check(scope);
    if (local && remote) throw new Error('A device library conflicts with a shared library identity. Original libraries were preserved.');
    if (local) return this.local.getRevision(libraryId, revisionId);
    if (!scope || !remote) throw new Error('This shared library is not downloaded for the current room.');
    const revision = await this.remote.revision(scope, libraryId, revisionId); this.check(scope); return revision;
  }
  async listRevisions(libraryId: string): Promise<LibraryRevisionSummary[]> {
    if (!libraryId.startsWith(ROOM_LIBRARY_ID_PREFIX)) return this.local.listRevisions(libraryId);
    const guard = this.captureReviewGuard(), scope = this.capture(), local = (await this.local.listLibraries()).find(item => item.libraryId === libraryId); guard();
    const remote = scope ? await this.remote.contains(scope, libraryId) : false; guard();
    if (local && remote) throw new Error('A device library conflicts with a shared library identity. Original libraries were preserved.');
    if (local) { const revisions = await this.local.listRevisions(libraryId); guard(); return revisions; }
    if (!scope || !remote) throw new Error('This shared library revision has not been downloaded for the current room.');
    const revisions = await this.remote.listRevisions(scope, libraryId); guard(); return revisions;
  }
  publishRevision(...args: Parameters<OrionLibraryCatalog['publishRevision']>) { return this.local.publishRevision(...args); }
}
export function roomAwareLibraryCatalog(editor: Editor): PencilLibraryCatalog { return new RoomAwareLibraryCatalog(() => scopes.get(editor)?.() ?? null, orionLibraryCatalog, roomLibraryCache, () => scopes.get(editor)); }
