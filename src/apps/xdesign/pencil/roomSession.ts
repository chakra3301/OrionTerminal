import { ulid } from 'ulid';
import { invoke } from '@tauri-apps/api/core';
import type { Editor } from '@open-pencil/core/editor';
import { useXDProjects, emptyDoc, snapshotActiveDoc, loadDoc, flushActive, validateDesignDoc, type XDDoc } from '../projectsStore';
import { usePencilWorkspace, withPencilTask, bindPencilRoomImages, pencilPhotoDocumentId, pencilRoomImageBinding, pencilRoomImageReference, savePencilRoomImageResult, preparePencilRoomImagePlacement, applyPencilRoomImagePlacement, assertPencilEditable, type PreparedRoomImagePlacement } from './runtime';
import { useXDesign } from '../store';
import { trackXDesignActivity } from '../runtimeActivity';
import { SharedRoomConnection, type RoomConnectionState } from './sharedRoomConnection';
import type { SharedEditorBinding } from './sharedEditor';
import { SharedDesign } from './sharedDesign';
import { deserializeGraph, serializeGraph, validatePencilDocument, type PencilDocument } from './document';
import { decodeSharedCheckpoint, encodeSharedCheckpoint, validateSharedDocumentId } from './sharedCheckpoint';
import { readRoomResponse, roomBinary, roomCheckpointCovers, type RoomRequest } from './sharedRoomProtocol';
import { NativeRoomTransport, hasRoomCredential, setRoomCredential, roomServerOrigin, type RoomMember, type RoomGrant } from './nativeRoomTransport';
import { loadRoomPreferences, rememberRoom, type RoomPreference } from './roomPreferences';
import { checkpointDigest, forgetRoomGrant, loadRoomGrants, rememberRoomGrant, roomGrantName, roomGrantState, sameRoomGrant, type PendingRoomCreation, type PendingRoomInvitation, type PendingRoomAuthorGrant } from './roomGrants';
import { RoomRequestFailure } from './sharedRoomConnection';
import { CanvasPresence, type CanvasPresenceSnapshot } from './canvasPresence';
import type { PresenceIdentity } from './roomPresenceClient';
import { RoomCommentClient, type RoomCommentState, type RoomCommentContext } from './roomCommentClient';
import { RoomCommentHistoryClient, type RoomCommentHistoryState } from './roomCommentHistoryClient';
import type { RoomCommentCommand, RoomCommentResult } from './roomCommentProtocol';

import { RoomCommentOwnershipClient, type CommentOwnershipState } from './roomCommentOwnershipClient';
import { readAuthorGrantResponse, type ImportedCommentAuthor, type AuthorGrantRequest, type AuthorGrantResponse } from './roomAuthorProtocol';
import { allComments } from './comments';
import { CanvasHistory, type CanvasHistoryState } from './canvasHistory';
import { RoomLibraryClient, type RoomLibraryDraft, type RoomLibraryState } from './roomLibraryClient';
import { RoomImageClient, type RoomImageState, type RoomImageResult } from './roomImageClient';
import { readRoomImagePluginData, roomImageReferenceText, type RoomImageReference } from './roomImageReferences';
import type { RoomImageManifest } from './roomImageProtocol';
import { assertCanvasResourceRead, withCanvasResourceRead, type CanvasResourceRead } from './resourceRead';
import type { PhotoDocument } from '../photo/types';
import { independentRoomImageCopy, type IndependentPhotoCopy } from './roomImageCopy';
import { bindRoomLibraryScope } from './roomLibraryCatalog';
import type { ComponentLibraryRevision } from '@open-pencil/core/library';
import type { ProjectAssetImport } from '../projectAssetImport';

export type RoomImageDraft = { transferId: string; manifest: RoomImageManifest; epoch: number };
export type RoomImagePlacementDraft = { name: string; width: number; height: number; placements: number; revisionId: string };
const canvasRooms = new WeakMap<Editor, CanvasRoomSession>();
export function canvasRoomSession(editor: Editor): CanvasRoomSession | null { return canvasRooms.get(editor) ?? null; }
const joinIntents = new Set<string>();
const creationIntents = new Set<string>();
export function consumeRoomJoinIntent(projectId: string): boolean { const present = joinIntents.has(projectId); joinIntents.delete(projectId); return present; }
export function consumeRoomCreationIntent(projectId: string): boolean { const present = creationIntents.has(projectId); creationIntents.delete(projectId); return present; }
const aborted = () => new DOMException('The room operation was cancelled.', 'AbortError');
async function cloneDesignAssets(sourceId: string, projectId: string, name: string, document: XDDoc, current: () => void, assets: ProjectAssetImport, photoCopies: IndependentPhotoCopy[] = []): Promise<XDDoc> {
  if (!Object.keys(document.photoDocuments ?? {}).length && !document.photoDrafts?.length && !document.pages.some(page => page.shapes.some(shape => shape.kind === 'image' && shape.filePath || 'fillImage' in shape && shape.fillImage))) return document;
  const copied = await assets.run(operationId => invoke<{ name: string; document: XDDoc }>('xdesign_project_clone', { sourceProjectId: sourceId, projectId, name, document, operationId, ...(photoCopies.length ? { photoCopies } : {}) })); current(); validateDesignDoc(copied.document); return copied.document;
}
async function prepareIndependentCopy(source: Editor, current: () => void, editable: boolean) {
  current(); const room = canvasRoomSession(source); room?.binding.flush();
  const originalGraph = serializeGraph(source.graph), references = new Map<string, RoomImageReference>();
  for (const node of source.graph.nodes.values()) { const reference = readRoomImagePluginData(node.pluginData); if (reference) references.set(roomImageReferenceText(reference), reference); }
  const check = () => {
    current();
    if (serializeGraph(source.graph) !== originalGraph) throw new Error('The source artwork changed while preparing its independent images.');
    if (editable && usePencilWorkspace.getState().readOnly) throw new Error('The shared source is now read-only. Its downloaded originals were preserved.');
  };
  if (references.size) {
    if (!room) throw new Error('Reconnect the original room before copying its shared images.');
    await withPencilTask(() => trackXDesignActivity('room-image', 'Wait for the independent image copy before switching projects.', () => withCanvasResourceRead(source, check, async read => {
      for (const reference of references.values()) {
        check(); if (pencilRoomImageReference(reference)) continue;
        await room.resolveImageResource(reference, read); check();
      }
    })));
  }
  check();
  const preference = room?.snapshot.preference;
  return { ...independentRoomImageCopy(snapshotActiveDoc(), preference ? { serverUrl: preference.serverUrl, documentId: room!.documentId } : null), check };
}
export async function prepareSharedRoom(serverUrl: string, roomName: string, ownerName: string, signal: AbortSignal): Promise<string> {
  const origin = roomServerOrigin(serverUrl), name = roomGrantName(roomName), owner = roomGrantName(ownerName);
  const source = usePencilWorkspace.getState().editor, sourceId = useXDProjects.getState().activeId;
  if (!source || !sourceId || usePencilWorkspace.getState().busy || usePencilWorkspace.getState().readOnly || source.state.editingTextId) throw new Error('Finish the current edit before creating a shared copy.');
  const current = () => { if (signal.aborted) throw aborted(); if (usePencilWorkspace.getState().editor !== source || useXDProjects.getState().activeId !== sourceId) throw new Error('The source design is no longer active.'); };
  current(); await loadRoomPreferences(); current(); const independent = await prepareIndependentCopy(source, current, true); let importedId: string | undefined;
  try {
    return await useXDProjects.getState().importDesignProject(async (projectId, assets) => {
      current(); independent.check(); importedId = projectId; let original = independent.document; if (!original.pencilDocument) throw new Error('Open a design canvas before creating a room.');
      original = await cloneDesignAssets(sourceId, projectId, name, original, () => { current(); independent.check(); }, assets, independent.photoCopies);
      if (!original.pencilDocument) throw new Error('The shared copy has no design canvas. The original project was preserved.');
      const replica = SharedDesign.fromGraph(deserializeGraph(original.pencilDocument.graph));
      try {
        const documentId = ulid(), bytes = replica.update(), checkpointSha256 = await checkpointDigest(bytes); current();
        const creation: PendingRoomCreation = { kind: 'create', projectId, documentId, serverUrl: origin, requestId: ulid(), name, ownerName: owner, checkpointSha256 };
        const pencilDocument: PencilDocument = { ...original.pencilDocument, graph: serializeGraph(replica.graph), shared: encodeSharedCheckpoint(documentId, bytes) }; validatePencilDocument(pencilDocument);
        creationIntents.add(projectId); return { name, document: { ...original, formatVersion: 2 as const, pencilDocument }, roomGrantState: roomGrantState(projectId, [creation]) };
      } finally { replica.dispose(); }
    });
  } catch (error) { if (importedId) creationIntents.delete(importedId); throw error; }
}

async function recoverOrIssue(transport: NativeRoomTransport, requestId: string, kind: 'create' | 'invite', access: 'owner' | 'editor' | 'viewer', signal: AbortSignal, issue: () => Promise<RoomGrant>): Promise<RoomGrant> {
  try { return await transport.recoverGrant(requestId, kind, access, signal); }
  catch (error) { if (!(error instanceof RoomRequestFailure) || error.status !== 404 || error.code !== 'receipt') throw error; return issue(); }
}
type JoinAdmission = { current?: () => boolean; minimumRevision?: number; memberId?: string };
export async function joinSharedRoom(serverUrl: string, documentId: string, projectName: string, secret: string, signal: AbortSignal, admission: JoinAdmission = {}): Promise<string> {
  const origin = roomServerOrigin(serverUrl); validateSharedDocumentId(documentId);
  if (!projectName.trim() || projectName.length > 128 || /[\x00-\x1f\x7f]/.test(projectName)) throw new Error('Enter a project name up to 128 characters.');
  if (admission.memberId !== undefined) validateSharedDocumentId(admission.memberId);
  if (!Number.isSafeInteger(admission.minimumRevision ?? 0) || (admission.minimumRevision ?? 0) < 0) throw new Error('Invalid minimum room revision.');
  const current = () => { if (signal.aborted) throw aborted(); if (admission.current && !admission.current()) throw new Error('The source design is no longer active.'); };
  current(); const known = (await loadRoomPreferences()).find(room => room.documentId === documentId && room.serverUrl === origin); current();
  let importedId: string | null = null;
  try {
    return await useXDProjects.getState().importDesignProject(async id => {
      current(); importedId = id;
      if (secret) await setRoomCredential(origin, documentId, secret); else if (!await hasRoomCredential(origin, documentId)) throw new Error('Enter the membership credential supplied by the room owner.');
      current();
      const transport = await NativeRoomTransport.open(origin, documentId, signal); let replica: SharedDesign | undefined;
      let imported: { name: string; document: XDDoc };
      try {
        current();
        const packet: RoomRequest = { version: 1, type: 'sync', documentId, clientId: ulid(), requestId: ulid(), vector: roomBinary(new Uint8Array([0]), true) };
        const reply = readRoomResponse(await transport.request(packet, signal), packet); current();
        if (reply.packet.revision < Math.max(known?.revision ?? 0, admission.minimumRevision ?? 0)) throw new Error('The room server returned an older revision. The current project was preserved.');
        if (admission.memberId && reply.packet.actor.id !== admission.memberId) throw new Error('The room response belongs to a different membership. The current project was preserved.');
        replica = SharedDesign.fromUpdate(reply.update);
        if (!roomCheckpointCovers(replica.update(), reply.vector)) throw new Error('The room checkpoint is incomplete. The current project was preserved.');
        const page = replica.graph.getPages().find(page => !page.internalOnly); if (!page) throw new Error('The room has no available design page.');
        const document: PencilDocument = { formatVersion: 1, graph: serializeGraph(replica.graph), pageId: page.id, panX: 0, panY: 0, zoom: 1, photoLinks: {}, shared: encodeSharedCheckpoint(documentId, replica.update()) }; validatePencilDocument(document);
        await rememberRoom({ documentId, serverUrl: origin, role: reply.packet.actor.role, revision: reply.packet.revision }); current();
        imported = { name: projectName.trim(), document: { ...emptyDoc(), formatVersion: 2 as const, photoDocuments: {}, pencilDocument: document } };
      } finally { replica?.dispose(); await transport.dispose(); }
      current(); joinIntents.add(id); return imported;
    });
  } catch (error) { if (importedId) joinIntents.delete(importedId); throw error; }
}

export type RoomUiState = { connection: RoomConnectionState | null; preference: RoomPreference | null; opening: boolean; error: string | null; creation: PendingRoomCreation | null; presence: CanvasPresenceSnapshot | null; comments?: RoomCommentState; commentHistory?: RoomCommentHistoryState; recovery?: 'local' | 'latest' | null; commentOwnership?: CommentOwnershipState; history?: CanvasHistoryState & { canUndo: boolean; canRedo: boolean }; libraries?: RoomLibraryState; images?: RoomImageState };
export class CanvasRoomSession {
  private network: NativeRoomTransport | null = null;
  private room: SharedRoomConnection | null = null;
  private opening: AbortController | null = null;
  private generation = 0;
  private closed = false;
  private readonly listeners = new Set<(state: RoomUiState) => void>();
  private readonly management = new Set<AbortController>();
  private state: RoomUiState;
  private presence: CanvasPresence | null = null;
  private presenceIdentity: { actorId: string; value: PresenceIdentity } | null = null;
  private readonly comments: RoomCommentClient;
  private readonly commentHistory: RoomCommentHistoryClient;
  private readonly ownership: RoomCommentOwnershipClient;
  private readonly libraries: RoomLibraryClient;
  private readonly images: RoomImageClient;
  private readonly imagePlacementDrafts = new WeakMap<RoomImagePlacementDraft, { epoch: number; manifest: RoomImageManifest; scope: { serverUrl: string; documentId: string }; prepared: PreparedRoomImagePlacement }>();
  private imageResourceRead: CanvasResourceRead | null = null;
  private copyPreparation = false;
  private readonly unbindLibraryScope: () => void;
  private readonly unbindImageScope: () => void;
  private authorManagement = false;
  private readonly history: CanvasHistory;
  private replayingComment = false;
  private readonly originalHistoryActions;
  private readonly historyActions;
  constructor(readonly editor: Editor, readonly binding: SharedEditorBinding, readonly documentId: string, readonly projectId: string, saved: RoomPreference | null, creation: PendingRoomCreation | null = null, private readonly canvas?: HTMLElement) {
    validateSharedDocumentId(documentId); if (saved && saved.documentId !== documentId) throw new Error('The saved connection belongs to another document.');
    if (creation && (creation.projectId !== projectId || creation.documentId !== documentId)) throw new Error('The pending room creation belongs to another design.');
    this.state = { connection: null, preference: saved ? { ...saved } : null, opening: false, error: null, creation, presence: null }; this.access(!!creation || saved?.role === 'viewer');
    this.originalHistoryActions = { undoAction: editor.undoAction, redoAction: editor.redoAction };
    this.historyActions = { undoAction: () => { void this.replayHistory('undo').catch(error => { if (this.current()) usePencilWorkspace.setState({ error: String(error) }); }); }, redoAction: () => { void this.replayHistory('redo').catch(error => { if (this.current()) usePencilWorkspace.setState({ error: String(error) }); }); } };
    this.history = new CanvasHistory(binding, {
      scope: () => this.state.preference && this.state.connection?.actor ? { serverUrl: this.state.preference.serverUrl, actorId: this.state.connection.actor.id } : null,
      change: history => this.update({ history: { ...history, canUndo: this.historyAvailable('undo'), canRedo: this.historyAvailable('redo') } }),
      artwork: direction => this.originalHistoryActions[direction === 'undo' ? 'undoAction' : 'redoAction'].call(editor),
      comment: command => this.submitComment(command),
    });
    this.commentHistory = new RoomCommentHistoryClient(documentId, { current: () => this.current(), context: () => this.commentContext(), onState: commentHistory => { this.update({ commentHistory }); if (commentHistory.phase === 'ready') this.history.reconcile(commentHistory.entries); } });
    this.state.commentHistory = this.commentHistory.snapshot;
    this.ownership = new RoomCommentOwnershipClient(documentId, { current: () => this.current(), context: () => this.commentContext(), onState: commentOwnership => this.update({ commentOwnership }) });
    this.state.commentOwnership = this.ownership.snapshot;
    this.comments = new RoomCommentClient(documentId, projectId, binding, {
      current: () => this.current(),
      context: () => this.commentContext(),
      onState: comments => { if (comments.phase === 'sending') this.commentHistory.invalidate(); this.update({ comments }); this.history.refresh(); }, save: flushActive,
      accepted: (actor, revision) => { this.assertCurrent(); if (!this.room) throw new Error('The comment connection closed. Recover it again.'); this.commentHistory.invalidate(); this.room.observeCommentReceipt(actor, revision); },
      prepared: pending => this.history.prepare(pending), restored: pending => this.history.restore(pending), applied: (pending, receipt) => this.history.applied(pending, receipt),
    });
    this.state.comments = this.comments.snapshot; this.history.refresh(); Object.assign(editor, this.historyActions); void this.comments.initialize();
    this.libraries = new RoomLibraryClient(documentId, projectId, { current: () => this.current(), context: () => this.commentContext(), onState: libraries => this.update({ libraries }) });
    this.state.libraries = this.libraries.snapshot;
    this.unbindLibraryScope = bindRoomLibraryScope(editor, () => this.current() && this.state.preference ? { serverUrl: this.state.preference.serverUrl, documentId: this.documentId } : null);
    void this.libraries.initialize();
    this.images = new RoomImageClient(documentId, projectId, { current: () => this.current(), context: () => this.imageContext(), onState: images => this.update({ images }) });
    this.state.images = this.images.snapshot; void this.images.initialize();
    this.unbindImageScope = bindPencilRoomImages(editor, () => this.current() && this.state.preference ? { serverUrl: this.state.preference.serverUrl, documentId: this.documentId } : null);
    canvasRooms.set(editor, this);
  }
  get snapshot(): RoomUiState { return this.state; }
  subscribe(listener: (state: RoomUiState) => void): () => void { if (this.closed) throw new Error('The room session is closed.'); this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  private current(): boolean { return !this.closed && this.editor === usePencilWorkspace.getState().editor && this.projectId === useXDProjects.getState().activeId && !useXDProjects.getState().transitioning; }
  private assertCurrent(): void { if (!this.current()) throw new Error('The room canvas is no longer active.'); }
  private commentContext(): RoomCommentContext | null {
    const { connection, preference, opening, creation } = this.state;
    return !opening && !creation && connection?.actor && preference && ['online', 'readonly', 'syncing'].includes(connection.phase) ? { serverUrl: preference.serverUrl, actor: connection.actor, revision: Math.max(connection.revision, preference.revision), epoch: this.generation } : null;
  }
  private update(patch: Partial<RoomUiState>): void { if (!this.current()) return; this.state = { ...this.state, ...patch }; for (const listener of [...this.listeners]) try { listener(this.state); } catch {} if (!('history' in patch)) this.history?.refresh(); }
  private imageContext(): RoomCommentContext | null {
    const connected = this.commentContext(); if (connected) return connected;
    const { connection, preference, opening, creation } = this.state;
    if (!this.imageResourceRead || opening || creation || !connection?.actor || !preference) return null;
    try { assertCanvasResourceRead(this.imageResourceRead, this.editor); } catch { return null; }
    return { serverUrl: preference.serverUrl, actor: connection.actor, revision: Math.max(connection.revision, preference.revision), epoch: this.generation };
  }
  private guardComments(): void { this.assertCurrent(); if (this.binding.busy || usePencilWorkspace.getState().busy || this.editor.isInteractiveEditing()) throw new Error('Finish the current edit before sending a comment.'); }
  private historyAvailable(direction: 'undo' | 'redo'): boolean {
    const kind = this.history?.kind(direction);
    if (!kind || !this.current() || this.history.snapshot.busy || this.binding.busy || usePencilWorkspace.getState().busy || this.editor.isInteractiveEditing() || this.state.opening || this.state.creation || this.state.comments?.phase !== 'ready' || this.state.comments.pending) return false;
    return kind === 'artwork' ? !usePencilWorkspace.getState().readOnly : !!this.commentContext();
  }
  async replayHistory(direction: 'undo' | 'redo'): Promise<void> {
    this.assertCurrent(); this.binding.flush();
    if (!this.history.kind(direction)) return;
    if (!this.historyAvailable(direction)) throw new Error('Finish or recover the pending action and reconnect before undo or redo.');
    const comment = this.history.kind(direction) === 'comment';
    if (comment) { this.replayingComment = true; this.access(true); }
    try { await this.history.replay(direction); }
    finally {
      if (comment) { this.replayingComment = false; this.access(!!this.state.creation || !!this.state.opening || (this.state.connection?.actor?.role ?? this.state.preference?.role ?? 'viewer') === 'viewer'); }
      this.history.refresh();
    }
  }
  async submitComment(command: RoomCommentCommand): Promise<RoomCommentResult> {
    this.guardComments();
    if (['edit','delete','move'].includes(command.type)) {
      const thread = allComments(this.editor.graph).find(thread => 'threadId' in command && thread.id === command.threadId), authorId = command.type === 'move' ? thread?.messages[0]?.author.id : 'messageId' in command ? thread?.messages.find(message => message.id === command.messageId)?.author.id : undefined;
      if (authorId && authorId !== this.commentContext()?.actor.id) {
        await this.loadCommentOwnership(); this.guardComments();
        if (!this.ownership.snapshot.authorIds.includes(authorId)) throw new Error('Your current comment access does not permit editing this original author.');
      }
    }
    return this.comments.submit(command);
  }
  loadCommentOwnership(): Promise<void> { this.guardComments(); return this.ownership.load(); }
  recoverComment(): Promise<RoomCommentResult> { this.guardComments(); return this.comments.recover(); }
  discardComment(): Promise<void> { this.assertCurrent(); return this.comments.discard(); }
  loadCommentHistory(before?: number): Promise<void> { this.guardComments(); if (this.comments.snapshot.phase === 'sending') throw new Error('Wait for the comment to finish before loading history.'); return this.commentHistory.load(before); }
  refreshLibraries(): Promise<void> { this.assertCurrent(); return this.libraries.refreshCatalog(); }
  downloadLibrary(libraryId: string): Promise<void> { this.assertCurrent(); return this.libraries.download(libraryId); }
  prepareLibraryPublication(revision: ComponentLibraryRevision): Promise<RoomLibraryDraft> { this.assertCurrent(); return this.libraries.prepare(revision); }
  publishLibrary(draft: RoomLibraryDraft) { this.assertCurrent(); return this.libraries.submit(draft); }
  recoverLibraryPublication() { this.assertCurrent(); return this.libraries.recover(); }
  dismissLibraryPublication(): Promise<void> { this.assertCurrent(); return this.libraries.dismiss(); }
  prepareImageUpload(source: PhotoDocument, imageId: string, previousRevisionId: string | null) { this.assertCurrent(); return this.images.prepareUpload(source, imageId, previousRevisionId); }
  publishImageUpload(transferId: string, revisionId: string, epoch: number) { this.assertCurrent(); return this.images.submitUpload(transferId, revisionId, epoch); }
  downloadRoomImage(reference: RoomImageReference) { this.assertCurrent(); return this.images.download(reference); }
  recoverImageTransfer() { this.assertCurrent(); return this.images.recover(); }
  acknowledgeImageTransfer(save: (result: Exclude<RoomImageResult, { kind: 'prepared' }>) => Promise<void>): Promise<void> { this.assertCurrent(); return this.images.acknowledge(save); }
  dismissImageTransfer(): Promise<void> { this.assertCurrent(); return this.images.dismiss(); }
  private imageAction<T>(work: () => Promise<T>): Promise<T> {
    this.assertCurrent();
    if (this.binding.busy || this.editor.isInteractiveEditing()) throw new Error('Finish the current edit before transferring an image.');
    return withPencilTask(() => trackXDesignActivity('room-image', 'Wait for the shared image transfer before switching projects.', work));
  }
  private async saveImageReceipt(): Promise<void> {
    const preference = this.state.preference;
    if (!preference) throw new Error('Reconnect the original image room before saving its result.');
    if (this.images.snapshot.actor?.role === 'viewer' || this.commentContext()?.actor.role === 'viewer') this.access(true);
    await this.images.acknowledge(result => savePencilRoomImageResult({ serverUrl: preference.serverUrl, documentId: this.documentId }, result));
  }
  async hydrateRoomImage(nodeId: string): Promise<PhotoDocument> {
    this.assertCurrent();
    const node = this.editor.graph.getNode(nodeId), reference = node && readRoomImagePluginData(node.pluginData);
    if (!reference) throw new Error('Select a shared image to download its editable contents.');
    const cached = pencilRoomImageBinding(nodeId);
    if (cached) return structuredClone(cached.photo);
    return this.imageAction(async () => {
      const result = await this.images.download(reference);
      if (result.kind !== 'imported') throw new Error('The editable image was not imported.');
      await this.saveImageReceipt(); this.assertCurrent(); return result.photo;
    });
  }
  async resolveImageResource(reference: RoomImageReference, read: CanvasResourceRead): Promise<PhotoDocument> {
    assertCanvasResourceRead(read, this.editor); this.assertCurrent();
    if (this.binding.busy || this.editor.isInteractiveEditing()) throw new Error('Finish the current edit before loading shared images.');
    if (this.imageResourceRead) throw new Error('Wait for the current shared image resource to finish.');
    this.imageResourceRead = read;
    try {
    await this.images.initialize(); assertCanvasResourceRead(read, this.editor);
    const pending = this.images.snapshot.pending;
    if (pending && (pending.direction !== 'download' || pending.imageId !== reference.imageId || pending.revisionId !== reference.revisionId)) throw new Error('Finish or dismiss the pending image transfer before loading another shared revision.');
    if (!pending) {
      const cached = pencilRoomImageReference(reference);
      if (cached) return structuredClone(cached.photo);
    }
    const result = pending ? await this.images.recover() : await this.images.download(reference);
    if (result.kind !== 'imported' || roomImageReferenceText(result.reference) !== roomImageReferenceText(reference)) throw new Error('The recovered image belongs to another original reference. Its transfer was retained.');
    await this.saveImageReceipt(); assertCanvasResourceRead(read, this.editor); this.assertCurrent();
    const binding = pencilRoomImageReference(reference);
    if (!binding) throw new Error('The original image mapping was not saved. Recover its transfer before continuing.');
    return structuredClone(binding.photo);
    } finally { this.imageResourceRead = null; }
  }
  reviewCanvasImage(nodeId: string): Promise<RoomImageDraft> {
    return this.imageAction(async () => {
      const node = this.editor.graph.getNode(nodeId), context = this.commentContext();
      const reference = node && readRoomImagePluginData(node.pluginData), photoId = pencilPhotoDocumentId(nodeId), source = photoId && useXDesign.getState().photoDocuments[photoId];
      if (!node || !context || !source) throw new Error('Open this image’s editable contents and connect its room before reviewing publication.');
      const result = await this.images.prepareUpload(source, reference?.imageId ?? ulid(), reference?.revisionId ?? null);
      if (result.kind !== 'prepared') throw new Error('The image review was not prepared.');
      return { transferId: result.transferId, manifest: result.manifest, epoch: context.epoch };
    });
  }
  private async placementManifest(reference: RoomImageReference): Promise<RoomImageManifest> {
    try { return await this.images.placementRevision(reference); }
    finally { if (this.images.snapshot.actor?.role === 'viewer') this.access(true); }
  }
  reviewImagePlacement(nodeId: string, reference: RoomImageReference): Promise<RoomImagePlacementDraft> {
    return this.imageAction(async () => {
      assertPencilEditable();
      const context = this.commentContext();
      if (!context) throw new Error('Reconnect this room before reviewing image placements.');
      const scope = { serverUrl: context.serverUrl, documentId: this.documentId };
      const manifest = await this.placementManifest(reference); this.assertCurrent();
      const prepared = await preparePencilRoomImagePlacement(scope, nodeId, reference, manifest); this.assertCurrent();
      const draft = Object.freeze({ name: manifest.name, width: manifest.width, height: manifest.height, placements: prepared.plan.patches.length, revisionId: manifest.revisionId });
      this.imagePlacementDrafts.set(draft, { epoch: context.epoch, manifest, scope, prepared });
      return draft;
    });
  }
  applyImagePlacement(draft: RoomImagePlacementDraft): Promise<void> {
    return this.imageAction(async () => {
      assertPencilEditable();
      const reviewed = this.imagePlacementDrafts.get(draft), context = this.commentContext();
      if (!reviewed || !context || context.epoch !== reviewed.epoch || context.serverUrl !== reviewed.scope.serverUrl) throw new Error('Review this room’s image placements again before applying the revision.');
      const manifest = await this.placementManifest(reviewed.prepared.plan.binding.reference); this.assertCurrent();
      if (JSON.stringify(manifest) !== JSON.stringify(reviewed.manifest)) throw new Error('The published image changed after review. Its placements were preserved.');
      await applyPencilRoomImagePlacement(reviewed.scope, reviewed.prepared);
      this.imagePlacementDrafts.delete(draft);
    });
  }
  publishCanvasImage(draft: RoomImageDraft): Promise<void> {
    return this.imageAction(async () => {
      await this.images.submitUpload(draft.transferId, draft.manifest.revisionId, draft.epoch);
      await this.saveImageReceipt();
    });
  }
  recoverCanvasImage(): Promise<RoomImageDraft | null> {
    return this.imageAction(async () => {
      const context = this.commentContext();
      if (!context) throw new Error('Reconnect the original room before recovering its image transfer.');
      const result = await this.images.recover();
      if (result.kind === 'prepared') return { transferId: result.transferId, manifest: result.manifest, epoch: context.epoch };
      await this.saveImageReceipt(); return null;
    });
  }
  dismissCanvasImage(): Promise<void> { return this.imageAction(() => this.images.dismiss()); }
  private access(readOnly: boolean): void { if (!this.current()) return; readOnly ||= this.replayingComment; this.binding.setReadOnly(readOnly); usePencilWorkspace.setState({ readOnly }); this.editor.requestRender(); this.history?.refresh(); }
  private received(state: RoomConnectionState): void {
    if (!this.current()) return;
    if (state.actor) this.access(state.actor.role === 'viewer');
    this.update({ connection: state });
    this.comments.refresh();
    this.commentHistory.refresh(); this.ownership.refresh(); this.libraries.refresh(); this.images.refresh();
    this.history.refresh();
    if (this.presence && state.actor?.id !== this.presence.actorId) this.stopPresence();
    if (!state.actor || !['online', 'readonly', 'syncing'].includes(state.phase)) this.stopPresence(); else this.startPresence();
    const saved = this.state.preference;
    if (state.actor && saved && (saved.role !== state.actor.role || saved.revision < state.revision)) {
      const next = { ...saved, role: state.actor.role, revision: state.revision }; this.update({ preference: next });
      void rememberRoom(next).catch(error => { if (this.current()) this.update({ error: String(error) }); });
    }
  }
  private stopPresence(): void { const presence = this.presence; this.presence = null; presence?.dispose(); if (this.state.presence) this.update({ presence: null }); }
  private startPresence(): void {
    const actor = this.state.connection?.actor, preference = this.state.preference;
    if (!this.canvas || this.presence || !actor || !preference || !this.current()) return;
    if (this.presenceIdentity?.actorId !== actor.id) this.presenceIdentity = { actorId: actor.id, value: { clientId: ulid(), sequence: 0 } };
    const presence: CanvasPresence = new CanvasPresence(this.editor, this.canvas, this.documentId, actor.id, this.presenceIdentity.value, preference.serverUrl, {
      current: (): boolean => { const connection = this.state.connection; return this.current() && this.presence === presence && connection?.actor?.id === actor.id && ['online', 'readonly', 'syncing'].includes(connection.phase); },
      navigable: () => !this.binding.busy && !usePencilWorkspace.getState().busy && !this.editor.state.editingTextId,
      onState: state => { if (this.presence === presence) this.update({ presence: state }); },
    });
    this.presence = presence; presence.start();
  }
  retryPresence(): void { this.assertCurrent(); if (!this.state.connection?.actor || !['online', 'readonly', 'syncing'].includes(this.state.connection.phase)) throw new Error('Connect the room before retrying presence.'); this.stopPresence(); this.startPresence(); }
  followPeer(clientId: string): void { this.assertCurrent(); if (!this.presence) throw new Error('Connect room presence before following.'); this.presence.follow(clientId); }
  stopFollowing(): void { this.presence?.stopFollowing(); }
  async connect(serverUrl: string, secret = ''): Promise<void> {
    this.assertCurrent(); if (this.opening) throw new Error('Wait for the room connection to finish.');
    if (this.state.creation) throw new Error('Finish creating this room before connecting.');
    if (this.binding.busy || usePencilWorkspace.getState().busy || this.editor.state.editingTextId) throw new Error('Finish the current edit before connecting.');
    this.binding.flush(); const origin = roomServerOrigin(serverUrl), generation = ++this.generation, controller = new AbortController(); this.opening = controller;
    this.stopPresence(); this.room?.dispose(); this.room = null; const old = this.network; this.network = null; this.access(true); this.update({ opening: true, error: null, connection: null }); this.comments.refresh(); this.commentHistory.refresh(); this.ownership.refresh(); this.libraries.refresh(); this.images.refresh();
    try {
      await old?.dispose(); if (secret) await setRoomCredential(origin, this.documentId, secret); else if (!await hasRoomCredential(origin, this.documentId)) throw new Error('Enter a room membership credential.');
      if (!this.current() || controller.signal.aborted || generation !== this.generation) throw aborted();
      const network = await NativeRoomTransport.open(origin, this.documentId, controller.signal);
      if (!this.current() || controller.signal.aborted || generation !== this.generation) { await network.dispose(); throw aborted(); }
      this.network = network;
      const saved = this.state.preference?.serverUrl === origin ? this.state.preference : null;
      this.update({ preference: saved ?? { serverUrl: origin, documentId: this.documentId, revision: 0, role: 'viewer' } });
      this.room = new SharedRoomConnection(this.documentId, this.binding, { request: network.request, minimumRevision: saved?.revision ?? 0, isCurrent: () => this.current() && generation === this.generation, onState: state => this.received(state) }); this.room.connect();
    } catch (error) {
      if (generation === this.generation) { this.room?.dispose(); this.room = null; const failed = this.network; this.network = null; await failed?.dispose().catch(() => {}); }
      if (this.current() && generation === this.generation) {
        const role = this.state.preference?.role; this.access(role === 'viewer' || !role);
        if (!controller.signal.aborted) this.update({ error: error instanceof Error ? error.message : 'Room connection failed.' });
      }
      throw error;
    }
    finally { if (this.opening === controller) this.opening = null; if (generation === this.generation) this.update({ opening: false }); }
  }
  retry(): void { this.assertCurrent(); if (this.opening) throw new Error('Wait for the room operation to finish.'); if (!this.room) throw new Error('Connect a room first.'); this.room.connect(); }
  async recoverProject(kind: 'local' | 'latest', signal: AbortSignal): Promise<string> {
    this.assertCurrent(); const { connection, preference, creation } = this.state;
    if (!['local','latest'].includes(kind) || !connection?.unsent || !['error','readonly','disconnected'].includes(connection.phase) || creation) throw new Error('Local artwork does not need recovery.');
    if (this.opening || this.copyPreparation || this.management.size || this.comments.snapshot.phase === 'sending') throw new Error('Wait for the room operation to finish.');
    if (this.binding.busy || usePencilWorkspace.getState().busy || this.editor.isInteractiveEditing() || this.editor.state.editingTextId) throw new Error('Finish the current edit before recovering the design.');
    if (kind === 'latest' && !preference) throw new Error('Connect the saved room before opening its shared version.');
    if (signal.aborted) throw aborted(); this.binding.flush();
    const generation = this.generation, controller = new AbortController();
    const cancel = () => controller.abort(); signal.addEventListener('abort',cancel,{once:true}); if(signal.aborted)cancel();
    const current = () => !this.closed && this.generation === generation && this.projectId === useXDProjects.getState().activeId && this.editor === usePencilWorkspace.getState().editor;
    const check = () => { if(controller.signal.aborted)throw aborted();if(!current())throw new Error('The source design is no longer active.'); };
    const sourceName = useXDProjects.getState().registry.find(project=>project.id===this.projectId)?.name ?? 'Recovered design';
    const name = Array.from(sourceName).slice(0,50).join('') + (kind === 'local' ? ' local copy' : ' shared version');
    let previousReadOnly = usePencilWorkspace.getState().readOnly; this.copyPreparation = true;
    try {
      const independent = kind === 'local' ? await prepareIndependentCopy(this.editor, check, false) : null;
      previousReadOnly = usePencilWorkspace.getState().readOnly;
      this.room?.disconnect(); this.stopPresence(); this.opening=controller;this.access(true);this.update({opening:true,recovery:kind,error:null});this.comments.refresh();this.commentHistory.refresh();this.ownership.refresh();this.libraries.refresh(); this.images.refresh();
      check();
      if(kind === 'latest') return await joinSharedRoom(preference!.serverUrl,this.documentId,name,'',controller.signal,{current,minimumRevision:Math.max(preference!.revision,connection.revision),...(connection.actor?{memberId:connection.actor.id}:{})});
      return await useXDProjects.getState().importDesignProject(async (id, assets)=>{
        check(); independent!.check(); let document=independent!.document;if(!document.pencilDocument)throw new Error('The source design canvas could not be saved.');
        document=await cloneDesignAssets(this.projectId,id,name,document,()=>{check();independent!.check();},assets,independent!.photoCopies);check();
        if(!document.pencilDocument)throw new Error('The local copy has no design canvas. The original project was preserved.');
        const pencilDocument={...document.pencilDocument};delete pencilDocument.shared;validatePencilDocument(pencilDocument);
        return {name,document:{...document,formatVersion:2 as const,pencilDocument}};
      });
    } finally {
      signal.removeEventListener('abort',cancel);this.copyPreparation=false;if(this.opening===controller)this.opening=null;
      if(current() && this.state.recovery === kind){this.access(previousReadOnly);this.update({opening:false,recovery:null});}
    }
  }
  disconnect(): void {
    this.assertCurrent(); this.opening?.abort(); this.room?.disconnect(); const role = this.room?.state.actor?.role ?? this.state.preference?.role; this.access(!!this.state.creation || role === 'viewer' || !role);
  }
  async publishCreation(secret: string, signal: AbortSignal): Promise<void> {
    this.assertCurrent(); const creation = this.state.creation; if (!creation || this.opening) throw new Error('No room creation is ready to publish.');
    const generation = this.generation, controller = new AbortController(); this.management.add(controller); const cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
    const check = () => { this.assertCurrent(); if (generation !== this.generation || controller.signal.aborted) throw aborted(); };
    let transport: NativeRoomTransport | undefined; this.opening = controller; this.update({ opening: true, error: null });
    try {
      check(); const saved = (await loadRoomGrants(this.projectId)).find(value => value.requestId === creation.requestId); check();
      if (!saved || !sameRoomGrant(saved, creation)) throw new Error('The pending creation changed. Reopen this project before publishing.');
      if (secret) await setRoomCredential(creation.serverUrl, null, secret); else if (!await hasRoomCredential(creation.serverUrl, null)) throw new Error('Enter the room service administrator credential.');
      check(); transport = await NativeRoomTransport.open(creation.serverUrl, this.documentId, controller.signal); check();
      const network = transport;
      const grant = await recoverOrIssue(network, creation.requestId, 'create', 'owner', controller.signal, async () => {
        check(); const document = await loadDoc(this.projectId); check(); const checkpoint = document?.pencilDocument?.shared;
        if (!checkpoint || checkpoint.documentId !== this.documentId) throw new Error('The saved shared copy is missing. It was preserved.');
        const bytes = decodeSharedCheckpoint(checkpoint); if (await checkpointDigest(bytes) !== creation.checkpointSha256) throw new Error('The saved shared copy changed. Recover the accepted grant before editing.');
        check(); return network.create(creation.name, creation.ownerName, bytes, controller.signal, creation.requestId);
      }); check();
      await setRoomCredential(creation.serverUrl, this.documentId, grant.credential); check();
      const preference = await rememberRoom({ documentId: this.documentId, serverUrl: creation.serverUrl, role: 'owner', revision: 1 }); check();
      await forgetRoomGrant(creation); check(); this.update({ creation: null, preference }); this.access(preference.role === 'viewer');
    } finally {
      signal.removeEventListener('abort', cancel); this.management.delete(controller); if (this.opening === controller) this.opening = null; if (generation === this.generation) this.update({ opening: false }); await transport?.dispose();
    }
  }
  private async manage<T>(work: (transport: NativeRoomTransport, signal: AbortSignal, check: () => void) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertCurrent(); if (this.room?.state.actor?.role !== 'owner' || !this.state.preference) throw new Error('Connect as the room owner to manage members.');
    const config = this.state.preference, controller = new AbortController(), generation = this.generation; this.management.add(controller); let transport: NativeRoomTransport | undefined;
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    try {
      transport = await NativeRoomTransport.open(config.serverUrl, this.documentId, controller.signal);
      this.assertCurrent(); if (generation !== this.generation || controller.signal.aborted) throw aborted();
      const check = () => { this.assertCurrent(); if (generation !== this.generation || controller.signal.aborted) throw aborted(); };
      const result = await work(transport, controller.signal, check); check(); return result;
    } finally { signal?.removeEventListener('abort', cancel); this.management.delete(controller); await transport?.dispose(); }
  }
  invite(name: string, role: 'editor' | 'viewer', signal?: AbortSignal): Promise<{ pending: PendingRoomInvitation; grant: RoomGrant }> {
    name = roomGrantName(name); if (!['editor', 'viewer'].includes(role)) return Promise.reject(new Error('Choose editor or viewer access.'));
    return this.manage(async (transport, signal, check) => {
      const ownerId = this.room!.state.actor!.id, pending: PendingRoomInvitation = { kind: 'invite', projectId: this.projectId, documentId: this.documentId, serverUrl: transport.serverUrl, requestId: ulid(), name, role, ownerId };
      const existing = await loadRoomGrants(this.projectId); check();
      if (existing.some(value => value.kind === 'invite' && value.documentId === this.documentId && value.serverUrl === transport.serverUrl && value.ownerId === ownerId && value.name === name && value.role === role)) throw new Error('Recover or dismiss the pending invitation for this member first.');
      await rememberRoomGrant(pending); check(); const grant = await transport.invite(name, role, signal, pending.requestId); return { pending, grant };
    }, signal);
  }
  recoverInvitation(pending: PendingRoomInvitation, signal?: AbortSignal): Promise<RoomGrant> {
    return this.manage(async (transport, signal, check) => {
      if (pending.projectId !== this.projectId || pending.documentId !== this.documentId || pending.serverUrl !== transport.serverUrl || pending.ownerId !== this.room!.state.actor!.id) throw new Error('This invitation belongs to another room owner or project.');
      const saved = (await loadRoomGrants(this.projectId)).find(value => value.requestId === pending.requestId); check();
      if (!saved || !sameRoomGrant(saved, pending)) throw new Error('The pending invitation changed. Refresh before recovering it.');
      return recoverOrIssue(transport, pending.requestId, 'invite', pending.role, signal, () => { check(); return transport.invite(pending.name, pending.role, signal, pending.requestId); });
    }, signal);
  }
  commentAuthors(signal?: AbortSignal): Promise<{ authors: ImportedCommentAuthor[]; members: RoomMember[] }> {
    return this.manage(async (transport, signal, check) => {
      const catalog = await transport.commentAuthors(signal); check();
      if (catalog.actor.id !== this.room!.state.actor!.id) throw new Error('The original author catalog belongs to another room owner.');
      const members = await transport.members(signal); check(); return { authors: catalog.authors, members };
    }, signal);
  }
  private async authorWork<T>(work: () => Promise<T>): Promise<T> {
    if (this.authorManagement) throw new Error('Wait for the original author assignment to finish.');
    this.authorManagement = true; try { return await work(); } finally { this.authorManagement = false; }
  }
  assignCommentAuthor(author: ImportedCommentAuthor, memberId: string | null, signal?: AbortSignal): Promise<AuthorGrantResponse> {
    return this.authorWork(() => this.manage(async (transport, signal, check) => {
      const pending: PendingRoomAuthorGrant = { kind: 'author', projectId: this.projectId, documentId: this.documentId, serverUrl: transport.serverUrl, requestId: ulid(), name: author.name.trim(), authorId: author.authorId, memberId, step: author.step, ownerId: this.room!.state.actor!.id };
      const saved = await loadRoomGrants(this.projectId); check();
      if (saved.some(value => value.kind === 'author' && value.documentId === this.documentId && value.serverUrl === transport.serverUrl && value.authorId === author.authorId)) throw new Error('Recover or dismiss the pending assignment for this original author first.');
      await rememberRoomGrant(pending); check();
      return this.performAuthorGrant(transport, signal, check, pending);
    }, signal));
  }
  recoverCommentAuthor(pending: PendingRoomAuthorGrant, signal?: AbortSignal): Promise<AuthorGrantResponse> {
    return this.authorWork(() => this.manage(async (transport, signal, check) => {
      if (pending.projectId !== this.projectId || pending.documentId !== this.documentId || pending.serverUrl !== transport.serverUrl || pending.ownerId !== this.room!.state.actor!.id) throw new Error('This author assignment belongs to another room owner or project.');
      const saved = (await loadRoomGrants(this.projectId)).find(value => value.requestId === pending.requestId); check();
      if (!saved || !sameRoomGrant(saved, pending)) throw new Error('The pending author assignment changed. Refresh before recovering it.');
      return this.performAuthorGrant(transport, signal, check, pending);
    }, signal));
  }
  private async performAuthorGrant(transport: NativeRoomTransport, signal: AbortSignal, check: () => void, pending: PendingRoomAuthorGrant): Promise<AuthorGrantResponse> {
    const request: AuthorGrantRequest = { version: 1, authorId: pending.authorId, memberId: pending.memberId, step: pending.step, requestId: pending.requestId };
    let reply: AuthorGrantResponse;
    try { reply = await transport.recoverCommentAuthor(request, signal); }
    catch (error) { if (!(error instanceof RoomRequestFailure && error.status === 404 && error.code === 'receipt')) throw error; check(); reply = await transport.assignCommentAuthor(request, signal); }
    check(); reply = readAuthorGrantResponse(reply, this.documentId, pending.requestId, request);
    if (this.room?.state.actor?.id !== pending.ownerId || this.room.state.actor.role !== 'owner') throw new Error('The current room owner changed. Recover this saved assignment after reconnecting.');
    if (reply.actor.id !== pending.ownerId) throw new Error('The author assignment reply belongs to another room owner.');
    await forgetRoomGrant(pending); check(); this.ownership.invalidate(); void this.ownership.load().catch(() => {}); return reply;
  }
  members(): Promise<RoomMember[]> { return this.manage((transport, signal) => transport.members(signal)); }
  changeMember(id: string, role: 'editor' | 'viewer'): Promise<RoomMember[]> { return this.manage(async (transport, signal) => { await transport.changeMember(id, role, signal); return transport.members(signal); }); }
  revokeMember(id: string): Promise<RoomMember[]> { return this.manage(async (transport, signal) => { await transport.revokeMember(id, signal); return transport.members(signal); }); }
  dispose(): void {
    if (this.closed) return; this.stopPresence(); this.comments.dispose(); this.commentHistory.dispose(); this.ownership.dispose(); this.history.dispose(); this.libraries.dispose(); this.images.dispose(); this.unbindLibraryScope(); this.unbindImageScope();
    if (canvasRooms.get(this.editor) === this) canvasRooms.delete(this.editor);
    for (const key of ['undoAction', 'redoAction'] as const) if (this.editor[key] === this.historyActions[key]) this.editor[key] = this.originalHistoryActions[key];
    this.closed = true; this.generation++; this.opening?.abort(); this.room?.dispose(); for (const controller of this.management) controller.abort(); this.listeners.clear();
    void this.network?.dispose().catch(() => {}); this.network = null;
  }
}
