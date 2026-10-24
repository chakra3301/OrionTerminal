import { ulid } from 'ulid';
import { NativeRoomTransport } from './nativeRoomTransport';
import { RoomRequestFailure } from './sharedRoomConnection';
import type { RoomCommentContext } from './roomCommentClient';
import type { RoomActor } from './sharedRoomProtocol';
import type { PhotoDocument } from '../photo/types';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { readRoomImageFilePhoto, readRoomImageFileStatus, readRoomImageFileInfo, roomImageManifestFileInfo, type RoomImageFileScope } from './roomImageFileProtocol';
import { createRoomImageManifest, readRoomImageUpload, readRoomImageRevision, readRoomImageChunkResponse, validateRoomImageChunk, validateRoomImageManifest, type RoomImageManifest, type RoomImageUpload } from './roomImageProtocol';
import { readRoomImageReference, type RoomImageReference } from './roomImageReferences';
import { roomImagePending, roomImagePendingKey, readPendingRoomImage, samePendingRoomImage, pendingRoomImageSummary, type RoomImagePendingStore, type PendingRoomImage, type PendingRoomImageUpload, type PendingRoomImageDownload, type PendingRoomImageSummary } from './roomImagePending';

export type RoomImageResult = { kind: 'prepared'; transferId: string; manifest: RoomImageManifest } | { kind: 'published'; source: PhotoDocument; publication: RoomImageUpload } | { kind: 'imported'; reference: RoomImageReference; manifest: RoomImageManifest; photo: PhotoDocument };
export type RoomImageState = { phase: 'loading' | 'ready' | 'preparing' | 'transferring' | 'pending' | 'complete' | 'error' | 'closed'; pending: PendingRoomImageSummary | null; actor: RoomActor | null; error: string | null; completedChunks: number; totalChunks: number };
export type RoomImageTransport = Pick<NativeRoomTransport, 'imageRevision' | 'beginImage' | 'imageUpload' | 'putImageChunk' | 'commitImage' | 'dismissImage' | 'imageChunk' | 'prepareImageFile' | 'readImageFileChunk' | 'stageImageFile' | 'putImageFileChunk' | 'importImageFile' | 'discardImageFile' | 'dispose'>;
// Chunk payloads stay on the file-backed bridge; only original metadata enters pending state.
export type RoomImageClientOptions = { current(): boolean; context(): RoomCommentContext | null; onState(state: RoomImageState): void; pending?: Pick<RoomImagePendingStore, 'load' | 'remember' | 'advance' | 'forget'>; open?: (serverUrl: string, documentId: string, signal: AbortSignal) => Promise<RoomImageTransport> };
type Transport = RoomImageTransport;
type Active = { context: RoomCommentContext; controller: AbortController };
export class RoomImageClient {
  private state: RoomImageState = { phase: 'loading', pending: null, actor: null, error: null, completedChunks: 0, totalChunks: 0 };
  private value: PendingRoomImage | null = null;
  private active: Active | null = null;
  private loaded = false;
  private closed = false;
  private initializing: Promise<void> | null = null;
  private readonly pending;
  constructor(readonly documentId: string, readonly projectId: string, private readonly options: RoomImageClientOptions) { validateSharedDocumentId(documentId); roomImagePendingKey(projectId); this.pending = options.pending ?? roomImagePending; }
  get snapshot(): RoomImageState { return structuredClone(this.state); }
  private update(patch: Partial<RoomImageState>): void { if (this.closed || !this.options.current()) return; this.state = { ...this.state, ...patch }; this.options.onState(this.snapshot); }
  private restored(value: PendingRoomImage | null): void { this.value = value; const summary = value ? pendingRoomImageSummary(value) : null; this.update({ pending: summary, phase: summary?.complete ? 'complete' : summary ? 'pending' : 'ready', error: null }); }
  initialize(): Promise<void> {
    if (this.loaded || this.closed) return Promise.resolve(); if (this.initializing) return this.initializing;
    const work = (async () => { try { const value = await this.pending.load(this.projectId); this.loaded = true; this.restored(value); } catch (error) { this.update({ phase: 'error', error: this.message(error) }); } })();
    this.initializing = work; void work.finally(() => { if (this.initializing === work) this.initializing = null; }); return work;
  }
  private key(context: RoomCommentContext): string { return JSON.stringify([context.serverUrl, this.documentId, context.actor.id, context.epoch]); }
  refresh(): void { const context = this.options.context(); if (this.active && (!context || !this.options.current() || this.key(context) !== this.key(this.active.context))) this.active.controller.abort(); }
  private check(active: Active): RoomCommentContext { const current = this.options.context(); if (this.closed || !this.options.current() || active.controller.signal.aborted || !current || this.key(current) !== this.key(active.context)) throw new DOMException('The room changed. The original image transfer was retained.', 'AbortError'); return current; }
  private actor(active: Active, actor: RoomActor): void { this.check(active); if (actor.id !== active.context.actor.id) throw new Error('The image reply belongs to another room member.'); this.update({ actor }); }
  private writeAccess(active: Active): void { const context = this.check(active); if (context.actor.role === 'viewer' || this.state.actor?.id === context.actor.id && this.state.actor.role === 'viewer') throw new Error('Connect with editor or owner access before publishing an image.'); }
  private scope(value: PendingRoomImage): RoomImageFileScope { return { projectId: this.projectId, memberId: value.actorId, transferId: value.transferId }; }
  private async operation<T>(phase: 'preparing' | 'transferring', work: (active: Active, transport: () => Promise<Transport>) => Promise<T>): Promise<T> {
    const current = this.options.context(); if (this.closed || !this.options.current() || !current) throw new Error('Connect this room before using shared images.'); if (!this.loaded) throw new Error('Restore pending image data before continuing.'); if (this.active) throw new Error('Wait for the current image transfer to finish.');
    const active: Active = { context: structuredClone(current), controller: new AbortController() }; this.active = active; this.update({ phase, error: null, actor: null }); let native: Transport | undefined;
    const open = async () => { this.check(active); if (!native) { native = await (this.options.open ?? NativeRoomTransport.open)(current.serverUrl, this.documentId, active.controller.signal); this.check(active); } return native; };
    try { const result = await work(active, open); this.check(active); this.restored(this.value); return structuredClone(result); }
    catch (error) { try { this.restored(await this.pending.load(this.projectId)); } catch { this.loaded = false; this.update({ phase: 'error' }); } this.update({ error: this.message(error) }); throw error; }
    finally { await native?.dispose().catch(() => {}); if (this.active === active) this.active = null; }
  }
  private async original(active: Active): Promise<PendingRoomImage> {
    const value = this.value; if (!value) throw new Error('There is no pending image transfer.');
    if (value.serverUrl !== active.context.serverUrl || value.documentId !== this.documentId || value.actorId !== active.context.actor.id) throw new Error('Reconnect as the original room member to recover this image transfer.');
    const saved = await this.pending.load(this.projectId); this.check(active); if (!saved || !samePendingRoomImage(saved, value)) throw new Error('The pending image transfer changed. Reopen the project before continuing.'); return value;
  }
  private async advance(before: PendingRoomImage, after: PendingRoomImage, active: Active): Promise<void> { this.check(active); await this.pending.advance(before, after); this.value = after; this.check(active); this.update({ pending: pendingRoomImageSummary(after) }); }
  prepareUpload(source: PhotoDocument, imageId: string, previousRevisionId: string | null): Promise<RoomImageResult> {
    const original = readRoomImageFilePhoto(source); validateSharedDocumentId(imageId);
    return this.operation('preparing', async (active, open) => {
      this.writeAccess(active); if (this.value) throw new Error('Recover or dismiss the pending image transfer before starting another.');
      const value = readPendingRoomImage({ projectId: this.projectId, serverUrl: active.context.serverUrl, documentId: this.documentId, actorId: active.context.actor.id, transferId: ulid(), acknowledged: false, direction: 'upload', source: original, imageId, previousRevisionId, manifest: null, approved: false, publication: null }, this.projectId) as PendingRoomImageUpload;
      await this.pending.remember(value); this.value = value; this.check(active); this.update({ pending: pendingRoomImageSummary(value) }); return this.prepare(value, active, await open());
    });
  }
  private async prepare(value: PendingRoomImageUpload, active: Active, native: Transport): Promise<RoomImageResult> {
    const status = await readRoomImageFileStatus(await native.prepareImageFile(this.scope(value), value.source, active.controller.signal), this.documentId, this.scope(value), { direction: 'upload', source: value.source }); this.check(active);
    if (status.state !== 'ready' || !status.info) throw new Error('The original native image preparation is not ready.'); const info = readRoomImageFileInfo(status.info);
    const manifest = await createRoomImageManifest({ imageId: value.imageId, previousRevisionId: value.previousRevisionId, ...info }); this.check(active);
    if (value.manifest && JSON.stringify(value.manifest) !== JSON.stringify(manifest)) throw new Error('The original prepared image changed. It was retained.');
    if (!value.manifest) await this.advance(value, { ...value, manifest }, active);
    return { kind: 'prepared', transferId: value.transferId, manifest };
  }
  submitUpload(transferId: string, revisionId: string, epoch: number): Promise<RoomImageResult> {
    return this.operation('transferring', async (active, open) => {
      this.writeAccess(active); const value = await this.original(active);
      if (value.direction !== 'upload' || !value.manifest || value.transferId !== transferId || value.manifest.revisionId !== revisionId || epoch !== active.context.epoch) throw new Error('The image or room changed after review. Review the original image again.');
      const approved = { ...value, approved: true }; await this.advance(value, approved, active); return this.upload(approved, active, await open());
    });
  }
  private async upload(value: PendingRoomImageUpload, active: Active, native: Transport): Promise<RoomImageResult> {
    if (!value.manifest || !value.approved) return this.prepare(value, active, native);
    const manifest = value.manifest; let reply: RoomImageUpload;
    try { reply = readRoomImageUpload(await native.imageUpload(value.transferId, manifest, active.controller.signal), this.documentId, value.transferId, manifest); }
    catch (error) { this.check(active); if (!(error instanceof RoomRequestFailure) || error.status !== 404) throw error; this.writeAccess(active); reply = readRoomImageUpload(await native.beginImage({ version: 1, requestId: value.transferId, manifest }, active.controller.signal), this.documentId, value.transferId, manifest); }
    this.actor(active, reply.actor); if (reply.state === 'dismissed') throw new Error('The original image upload was dismissed. Its request was retained.');
    if (reply.state !== 'published') {
      this.writeAccess(active); await this.prepare(value, active, native); this.update({ completedChunks: reply.received.length, totalChunks: manifest.chunkDigests.length });
      for (let index = 0; index < manifest.chunkDigests.length; index++) {
        if (reply.received.includes(index)) continue; this.check(active); this.writeAccess(active);
        const raw = await native.readImageFileChunk(this.scope(value), roomImageManifestFileInfo(manifest), index, active.controller.signal), { chunk } = await validateRoomImageChunk(raw.chunk, manifest, index); this.check(active);
        reply = readRoomImageUpload(await native.putImageChunk(value.transferId, chunk, manifest, active.controller.signal), this.documentId, value.transferId, manifest); this.actor(active, reply.actor);
        if (!reply.received.includes(index)) throw new Error('The room did not acknowledge the original image chunk.'); this.update({ completedChunks: reply.received.length });
      }
      this.writeAccess(active); reply = readRoomImageUpload(await native.commitImage(value.transferId, manifest, active.controller.signal), this.documentId, value.transferId, manifest); this.actor(active, reply.actor);
    }
    if (reply.state !== 'published') throw new Error('The original image publication was not acknowledged.');
    if (!value.publication) { value = { ...value, publication: reply }; await this.advance(this.value!, value, active); }
    return { kind: 'published', source: value.source, publication: value.publication! };
  }
  placementRevision(reference: RoomImageReference): Promise<RoomImageManifest> {
    const original = readRoomImageReference(reference);
    return this.operation('preparing', async (active, open) => {
      if (this.value) throw new Error('Finish the pending image transfer before reviewing placements.');
      this.writeAccess(active);
      const reply = readRoomImageRevision(await (await open()).imageRevision(original.imageId, original.revisionId, active.controller.signal), this.documentId, original.imageId, original.revisionId);
      this.actor(active, reply.actor); this.writeAccess(active);
      await validateRoomImageManifest(reply.publication.manifest); this.check(active);
      return reply.publication.manifest;
    });
  }
  download(reference: RoomImageReference): Promise<RoomImageResult> {
    const original = readRoomImageReference(reference);
    return this.operation('transferring', async (active, open) => {
      if (this.value) throw new Error('Recover or dismiss the pending image transfer before starting another.'); const native = await open();
      const reply = readRoomImageRevision(await native.imageRevision(original.imageId, original.revisionId, active.controller.signal), this.documentId, original.imageId, original.revisionId); this.actor(active, reply.actor); await validateRoomImageManifest(reply.publication.manifest); this.check(active);
      const value = readPendingRoomImage({ projectId: this.projectId, serverUrl: active.context.serverUrl, documentId: this.documentId, actorId: active.context.actor.id, transferId: ulid(), acknowledged: false, direction: 'download', manifest: reply.publication.manifest, reference: original, photo: null }, this.projectId) as PendingRoomImageDownload;
      await this.pending.remember(value); this.value = value; this.check(active); this.update({ pending: pendingRoomImageSummary(value) }); return this.receive(value, active, native);
    });
  }
  private async receive(value: PendingRoomImageDownload, active: Active, native: Transport): Promise<RoomImageResult> {
    const { manifest } = value, reply = readRoomImageRevision(await native.imageRevision(manifest.imageId, manifest.revisionId, active.controller.signal), this.documentId, manifest.imageId, manifest.revisionId); this.actor(active, reply.actor);
    if (JSON.stringify(reply.publication.manifest) !== JSON.stringify(manifest)) throw new Error('The original image revision changed.');
    let status = await readRoomImageFileStatus(await native.stageImageFile(this.scope(value), manifest, active.controller.signal), this.documentId, this.scope(value), { direction: 'download', manifest }); this.check(active); this.update({ completedChunks: status.received.length, totalChunks: manifest.chunkDigests.length });
    for (let index = 0; index < manifest.chunkDigests.length; index++) {
      if (status.received.includes(index)) continue; this.check(active);
      const { bytes: _decoded, ...wire } = await native.imageChunk(manifest, index, active.controller.signal);
      const chunk = await readRoomImageChunkResponse(wire, this.documentId, manifest, index); this.actor(active, chunk.actor);
      status = await readRoomImageFileStatus(await native.putImageFileChunk(this.scope(value), chunk.chunk, manifest, active.controller.signal), this.documentId, this.scope(value), { direction: 'download', manifest }); this.check(active); if (!status.received.includes(index)) throw new Error('The native image did not acknowledge the original chunk.'); this.update({ completedChunks: status.received.length });
    }
    status = await readRoomImageFileStatus(await native.importImageFile(this.scope(value), manifest, active.controller.signal), this.documentId, this.scope(value), { direction: 'download', manifest }); this.check(active);
    if (!status.photo || status.state !== 'imported') throw new Error('The original native image import was not acknowledged.');
    if (value.photo && JSON.stringify(value.photo) !== JSON.stringify(status.photo)) throw new Error('The original imported image identity changed.');
    if (!value.photo) { value = { ...value, photo: status.photo }; await this.advance(this.value!, value, active); }
    return { kind: 'imported', reference: value.reference, manifest, photo: value.photo! };
  }
  recover(): Promise<RoomImageResult> { return this.operation('transferring', async (active, open) => { const value = await this.original(active); if (value.acknowledged) return this.result(value); const native = await open(); return value.direction === 'upload' ? this.upload(value, active, native) : this.receive(value, active, native); }); }
  private result(value: PendingRoomImage): Exclude<RoomImageResult, { kind: 'prepared' }> {
    if (value.direction === 'upload' && value.publication) return { kind: 'published', source: value.source, publication: value.publication };
    if (value.direction === 'download' && value.photo) return { kind: 'imported', reference: value.reference, manifest: value.manifest, photo: value.photo };
    throw new Error('The original image transfer has no completion receipt.');
  }
  acknowledge(save: (result: Exclude<RoomImageResult, { kind: 'prepared' }>) => Promise<void>): Promise<void> {
    return this.operation('transferring', async (active, open) => {
      let value = await this.original(active); const result = this.result(value);
      if (!value.acknowledged) { this.check(active); await save(structuredClone(result)); this.check(active); const after = { ...value, acknowledged: true }; await this.advance(value, after, active); value = after; }
      await (await open()).discardImageFile(this.scope(value), active.controller.signal); this.check(active); await this.pending.forget(value); this.value = null; this.check(active); this.update({ pending: null, completedChunks: 0, totalChunks: 0 });
    });
  }
  dismiss(): Promise<void> {
    return this.operation('transferring', async (active, open) => {
      const value = await this.original(active), native = await open();
      if (value.direction === 'upload' && value.manifest && value.approved && !value.acknowledged) {
        let status: RoomImageUpload | null = null;
        try { status = readRoomImageUpload(await native.imageUpload(value.transferId, value.manifest, active.controller.signal), this.documentId, value.transferId, value.manifest); this.actor(active, status.actor); }
        catch (error) { this.check(active); if (!(error instanceof RoomRequestFailure) || error.status !== 404) throw error; }
        if (status?.state === 'published') throw new Error('This image was already published. Recover its original receipt before clearing it.');
        if (status?.state === 'pending') { status = readRoomImageUpload(await native.dismissImage(value.transferId, value.manifest, active.controller.signal), this.documentId, value.transferId, value.manifest); this.actor(active, status.actor); if (status.state !== 'dismissed') throw new Error('The original image upload dismissal was not acknowledged.'); }
      }
      await native.discardImageFile(this.scope(value), active.controller.signal); this.check(active); await this.pending.forget(value); this.value = null; this.check(active); this.update({ pending: null, completedChunks: 0, totalChunks: 0 });
    });
  }
  private message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
  dispose(): void { if (this.closed) return; this.closed = true; this.active?.controller.abort(); this.state = { ...this.state, phase: 'closed' }; }
}
