import { ulid } from 'ulid';
import { assertLibraryId, contentHash, diffLibraryManifests, validateLibraryRevision, type ComponentLibraryRevision, type LibraryAssetChange } from '@open-pencil/core/library';
import { NativeRoomTransport } from './nativeRoomTransport';
import { RoomRequestFailure } from './sharedRoomConnection';
import { validateSharedDocumentId } from './sharedCheckpoint';
import type { RoomCommentContext } from './roomCommentClient';
import type { RoomActor } from './sharedRoomProtocol';
import { deserializeGraph, serializeGraph } from './graphDocument';
import { readRoomLibraryScope, type RoomLibraryScope } from './roomLibraryIdentity';
import { prepareRoomLibraryBundle, readRoomLibraryCatalog, readRoomLibraryPublication, readRoomLibraryPublish, readRoomLibraryRevision, validateRoomLibraryBundle, type RoomLibraryPublish, type RoomLibrarySummary, type RoomLibraryPublication } from './roomLibraryProtocol';
import { roomLibraryCache, ROOM_LIBRARY_CACHE_BYTES, ROOM_LIBRARY_CACHE_REVISIONS, type RoomLibraryCache, type CachedRoomRevision } from './roomLibraryCache';
import { roomLibraryPending, readPendingRoomLibrary, roomLibraryPendingKey, samePendingRoomLibrary, pendingRoomLibrarySummary, type PendingRoomLibrary, type PendingRoomLibrarySummary, type RoomLibraryPendingStore } from './roomLibraryPending';

export type RoomLibraryState = { phase: 'loading' | 'ready' | 'reading' | 'publishing' | 'pending' | 'error' | 'closed'; pending: PendingRoomLibrarySummary | null; libraries: RoomLibrarySummary[]; actor: RoomActor | null; error: string | null; cacheVersion: number };
export type RoomLibraryDraft = { scope: RoomLibraryScope; actorId: string; epoch: number; packet: RoomLibraryPublish; changes: LibraryAssetChange[] };
export type RoomLibraryTransport = {
  catalog(signal: AbortSignal): Promise<unknown>;
  revision(libraryId: string, revisionId: string, signal: AbortSignal): Promise<unknown>;
  publish(packet: RoomLibraryPublish, signal: AbortSignal): Promise<unknown>;
  recover(packet: RoomLibraryPublish, signal: AbortSignal): Promise<unknown>;
  dispose(): Promise<void>;
};
type Context = RoomCommentContext;
type Active = { context: Context; controller: AbortController };
type Options = {
  current(): boolean; context(): Context | null; onState(state: RoomLibraryState): void;
  cache?: Pick<RoomLibraryCache, 'history' | 'store'>;
  pending?: Pick<RoomLibraryPendingStore, 'load' | 'remember' | 'forget'>;
  open?: (serverUrl: string, documentId: string, signal: AbortSignal) => Promise<RoomLibraryTransport>;
};
export class RoomLibraryClient {
  private state: RoomLibraryState = { phase: 'loading', pending: null, libraries: [], actor: null, error: null, cacheVersion: 0 };
  private active: Active | null = null;
  private closed = false;
  private loaded = false;
  private pendingPublication: PendingRoomLibrary | null = null;
  private localBusy = false;
  private initializing: Promise<void> | null = null;
  private catalogScope: string | null = null;
  private readonly cache;
  private readonly pending;
  constructor(readonly documentId: string, readonly projectId: string, private readonly options: Options) {
    roomLibraryPendingKey(projectId); validateSharedDocumentId(documentId);
    this.cache = options.cache ?? roomLibraryCache; this.pending = options.pending ?? roomLibraryPending;
  }
  get snapshot(): RoomLibraryState { return structuredClone(this.state); }
  private update(patch: Partial<RoomLibraryState>): void {
    if (this.closed || !this.options.current()) return;
    this.state = { ...this.state, ...patch }; this.options.onState(this.snapshot);
  }
  initialize(): Promise<void> {
    if (this.loaded || this.closed) return Promise.resolve();
    if (this.initializing) return this.initializing;
    const work = (async () => {
      try { const pending = await this.pending.load(this.projectId); this.loaded = true; this.pendingPublication = pending; this.update({ pending: pending ? pendingRoomLibrarySummary(pending) : null, phase: pending ? 'pending' : 'ready', error: null }); }
      catch (error) { this.update({ phase: 'error', error: this.message(error) }); }
    })();
    this.initializing = work; void work.finally(() => { if (this.initializing === work) this.initializing = null; }); return work;
  }
  private key(context: Context): string { return JSON.stringify([context.serverUrl, this.documentId, context.actor.id, context.epoch]); }
  refresh(): void {
    const current = this.options.context(), active = this.active;
    if (active && (!this.options.current() || !current || this.key(current) !== this.key(active.context))) active.controller.abort();
    if (this.catalogScope && (!current || this.key(current) !== this.catalogScope)) { this.catalogScope = null; this.update({ libraries: [], actor: null }); }
  }
  private check(active: Active): Context {
    const current = this.options.context();
    if (this.closed || active.controller.signal.aborted || !this.options.current() || !current || this.key(current) !== this.key(active.context)) throw new DOMException('The room changed. The library request was retained.', 'AbortError');
    return current;
  }
  private actor(active: Active, actor: RoomActor): void {
    this.check(active);
    if (actor.id !== active.context.actor.id) throw new Error('The library reply belongs to another room member.');
    this.update({ actor });
  }
  private writeAccess(active: Active): void {
    const current = this.check(active);
    if (current.actor.role === 'viewer' || this.catalogScope === this.key(current) && this.state.actor?.role === 'viewer') throw new Error('Connect with editor or owner access before publishing a library.');
  }
  private async operation<T>(phase: 'reading' | 'publishing', work: (active: Active, open: () => Promise<RoomLibraryTransport>) => Promise<T>, write = false): Promise<T> {
    const context = this.options.context();
    if (this.closed || !this.options.current() || !context) throw new Error('Connect this room before using shared libraries.');
    if (!this.loaded) throw new Error('Restore the pending library publication data before continuing.');
    if (this.active || this.localBusy) throw new Error('Wait for the current library operation to finish.');
    const active: Active = { context: structuredClone(context), controller: new AbortController() };
    if (write) this.writeAccess(active);
    this.active = active; this.update({ phase, error: null }); let transport: RoomLibraryTransport | undefined;
    const open = async () => {
      this.check(active);
      if (!transport) {
        const factory = this.options.open ?? (async (server: string, document: string, signal: AbortSignal): Promise<RoomLibraryTransport> => {
          const native = await NativeRoomTransport.open(server, document, signal);
          return { catalog: cancel => native.libraryCatalog(cancel), revision: async (library, revision, cancel) => { const { revision: _graph, ...wire } = await native.libraryRevision(library, revision, cancel); return wire; }, publish: (packet, cancel) => native.publishLibrary(packet, cancel), recover: (packet, cancel) => native.recoverLibrary(packet, cancel), dispose: () => native.dispose() };
        });
        transport = await factory(context.serverUrl, this.documentId, active.controller.signal); this.check(active);
      }
      return transport;
    };
    try { const result = await work(active, open); this.check(active); this.update({ phase: this.state.pending ? 'pending' : 'ready', error: null }); return result; }
    catch (error) {
      try { this.pendingPublication = await this.pending.load(this.projectId); this.update({ pending: this.pendingPublication ? pendingRoomLibrarySummary(this.pendingPublication) : null }); }
      catch { this.loaded = false; }
      this.update({ phase: this.state.pending ? 'pending' : this.loaded ? 'ready' : 'error', error: this.message(error) }); throw error;
    } finally { await transport?.dispose().catch(() => {}); if (this.active === active) this.active = null; }
  }
  private async catalog(transport: RoomLibraryTransport, active: Active): Promise<RoomLibrarySummary[]> {
    const reply = readRoomLibraryCatalog(await transport.catalog(active.controller.signal), this.documentId); this.actor(active, reply.actor);
    if (this.catalogScope === this.key(active.context)) for (const previous of this.state.libraries) {
      const current = reply.libraries.find(item => item.libraryId === previous.libraryId);
      if (!current || current.ownerId !== previous.ownerId || current.step < previous.step || current.step === previous.step && JSON.stringify(current) !== JSON.stringify(previous)) throw new Error('The room library catalog is older than, or differs from, a confirmed head.');
    }
    this.catalogScope = this.key(active.context); this.update({ libraries: reply.libraries }); return reply.libraries;
  }
  refreshCatalog(): Promise<void> { return this.operation('reading', async (active, open) => { await this.catalog(await open(), active); }); }
  prepare(revision: ComponentLibraryRevision): Promise<RoomLibraryDraft> {
    const manifest = structuredClone(revision.manifest);
    for (const asset of manifest.assets) if (asset.thumbnail !== undefined) {
      if (!ArrayBuffer.isView(asset.thumbnail) || Object.prototype.toString.call(asset.thumbnail) !== '[object Uint8Array]') throw new Error('Invalid room library thumbnail.');
      asset.thumbnail = new Uint8Array(asset.thumbnail);
    }
    const original = { manifest, graph: deserializeGraph(serializeGraph(revision.graph), true) };
    return this.operation('reading', async (active, open) => {
      await validateLibraryRevision(original); this.writeAccess(active); const transport = await open();
      const head = (await this.catalog(transport, active)).find(item => item.libraryId === original.manifest.libraryId); this.writeAccess(active);
      const previous = head ? await readRoomLibraryRevision(await transport.revision(head.libraryId, head.revisionId, active.controller.signal), this.documentId, head.libraryId, head.revisionId) : null;
      if (previous) { this.actor(active, previous.actor); if (JSON.stringify(previous.publication) !== JSON.stringify(head)) throw new Error('The library changed during publication review. Refresh it again.'); }
      const manifest = original.manifest; manifest.previousRevisionId = head?.revisionId ?? null;
      manifest.revisionId = await contentHash({ schemaVersion: manifest.schemaVersion, libraryId: manifest.libraryId, previousRevisionId: manifest.previousRevisionId, assets: manifest.assets.map(({ thumbnail: _thumbnail, sourceNodeId: _source, ...asset }) => asset) });
      const bundle = await prepareRoomLibraryBundle(original); this.check(active);
      return { scope: { serverUrl: active.context.serverUrl, documentId: this.documentId }, actorId: active.context.actor.id, epoch: active.context.epoch, packet: { version: 1 as const, requestId: ulid(), bundle }, changes: previous ? diffLibraryManifests(previous.revision.manifest, manifest) : manifest.assets.map(asset => ({ kind: 'added' as const, asset })) };
    }, true);
  }
  submit(draft: RoomLibraryDraft): Promise<RoomLibraryPublication> {
    const scope = readRoomLibraryScope(draft.scope), packet = readRoomLibraryPublish(draft.packet);
    if (!Number.isSafeInteger(draft.epoch) || draft.epoch < 0) return Promise.reject(new Error('Invalid publication review context.'));
    const pending = readPendingRoomLibrary({ projectId: this.projectId, ...scope, actorId: draft.actorId, packet }, this.projectId);
    if (this.state.pending) return Promise.reject(new Error('Recover or dismiss the pending library publication before posting another.'));
    return this.operation('publishing', async (active, open) => {
      if (draft.epoch !== active.context.epoch || pending.serverUrl !== active.context.serverUrl || pending.documentId !== this.documentId || pending.actorId !== active.context.actor.id) throw new Error('The room changed after review. Review the library again.');
      await this.pending.remember(pending); this.pendingPublication = pending; this.update({ pending: pendingRoomLibrarySummary(pending) }); this.check(active);
      return this.deliver(pending, active, open);
    }, true);
  }
  recover(): Promise<RoomLibraryPublication> {
    const pending = this.pendingPublication; if (!pending) return Promise.reject(new Error('There is no pending library publication to recover.'));
    return this.operation('publishing', (active, open) => this.deliver(pending, active, open));
  }
  private async deliver(pending: PendingRoomLibrary, active: Active, open: () => Promise<RoomLibraryTransport>): Promise<RoomLibraryPublication> {
    if (pending.serverUrl !== active.context.serverUrl || pending.documentId !== this.documentId || pending.actorId !== active.context.actor.id) throw new Error('Reconnect as the original room member to recover this library publication.');
    const saved = await this.pending.load(this.projectId); this.check(active);
    if (!saved || !samePendingRoomLibrary(saved, pending)) throw new Error('The pending library publication changed. Reopen the project before recovering.');
    const bundle = await validateRoomLibraryBundle(pending.packet.bundle); this.check(active); const transport = await open(); let raw: unknown;
    try { raw = await transport.recover(pending.packet, active.controller.signal); }
    catch (error) {
      this.check(active);
      if (!(error instanceof RoomRequestFailure) || error.status !== 404 || error.code !== 'receipt') throw error;
      this.writeAccess(active); raw = await transport.publish(pending.packet, active.controller.signal);
    }
    const reply = readRoomLibraryPublication(raw, this.documentId, pending.packet.requestId, { libraryId: bundle.bundle.manifest.libraryId, revisionId: bundle.bundle.manifest.revisionId, bundleDigest: bundle.bundleDigest }); this.actor(active, reply.actor);
    const confirmed = this.state.libraries.find(item => item.libraryId === reply.current.libraryId);
    if (confirmed && (reply.current.ownerId !== confirmed.ownerId || reply.current.step < confirmed.step || reply.current.step === confirmed.step && JSON.stringify(reply.current) !== JSON.stringify(confirmed))) throw new Error('The library receipt has an older or changed current head. Recover it again.');
    await this.downloadChain(transport, active, reply.publication, reply.current);
    this.check(active); await this.pending.forget(pending); this.check(active);
    this.catalogScope = this.key(active.context);
    this.pendingPublication = null; this.update({ pending: null, libraries: [...this.state.libraries.filter(item => item.libraryId !== reply.current.libraryId), reply.current] }); return reply;
  }
  download(libraryId: string): Promise<void> {
    assertLibraryId(libraryId);
    return this.operation('reading', async (active, open) => {
      const transport = await open(), head = (await this.catalog(transport, active)).find(item => item.libraryId === libraryId);
      if (!head) throw new Error('The selected library is not in this room.');
      await this.downloadChain(transport, active, head);
    });
  }
  private async downloadChain(transport: RoomLibraryTransport, active: Active, head: RoomLibrarySummary, current = head): Promise<void> {
    if (head.step > ROOM_LIBRARY_CACHE_REVISIONS) throw new Error('The shared library history exceeds its cache bound.');
    const scope = { serverUrl: active.context.serverUrl, documentId: this.documentId }, known = await this.cache.history(scope, head.libraryId); this.check(active);
    if (known.length > current.step || known.length === current.step && JSON.stringify(known.at(-1)!.publication) !== JSON.stringify(current)) throw new Error('The room library is older than, or differs from, its confirmed cached head.');
    if (known.length >= head.step) {
      if (JSON.stringify(known[head.step - 1]!.publication) !== JSON.stringify(head)) throw new Error('The library differs from its confirmed cached history.');
      return;
    }
    const received: CachedRoomRevision[] = [], previous = known.at(-1)?.publication;
    let next: string | null = head.revisionId, step = head.step, bytes = new TextEncoder().encode(JSON.stringify(known)).byteLength;
    while (next && next !== previous?.revisionId) {
      const reply = await readRoomLibraryRevision(await transport.revision(head.libraryId, next, active.controller.signal), this.documentId, head.libraryId, next); this.actor(active, reply.actor);
      if (reply.publication.ownerId !== head.ownerId || reply.publication.step !== step || step === head.step && JSON.stringify(reply.publication) !== JSON.stringify(head)) throw new Error('The shared library history has a different source or sequence.');
      const saved = { publication: reply.publication, bundle: reply.bundle }; bytes += new TextEncoder().encode(JSON.stringify(saved)).byteLength;
      if (bytes > ROOM_LIBRARY_CACHE_BYTES || received.length + known.length >= ROOM_LIBRARY_CACHE_REVISIONS) throw new Error('The shared library history exceeds its cache storage bound.');
      received.push(saved); next = reply.publication.previousRevisionId; step--;
    }
    if (step !== known.length || (previous ? next !== previous.revisionId || previous.ownerId !== head.ownerId : next !== null)) throw new Error('The shared library history has a different predecessor.');
    this.check(active); await this.cache.store(scope, [...known, ...received.reverse()]); this.check(active); this.update({ cacheVersion: this.state.cacheVersion + 1 });
  }
  async dismiss(): Promise<void> {
    if (this.closed || !this.options.current() || !this.loaded || this.active || this.localBusy) throw new Error('Wait for the current library operation to finish.');
    const pending = this.pendingPublication; if (!pending) return;
    this.localBusy = true; this.update({ phase: 'publishing', error: null });
    try { await this.pending.forget(pending); this.pendingPublication = null; this.update({ pending: null, phase: 'ready', error: null }); }
    catch (error) { this.update({ phase: 'pending', error: this.message(error) }); throw error; }
    finally { this.localBusy = false; }
  }
  private message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
  dispose(): void { if (this.closed) return; this.closed = true; this.active?.controller.abort(); this.state = { ...this.state, phase: 'closed' }; }
}
