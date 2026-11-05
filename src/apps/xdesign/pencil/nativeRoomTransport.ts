import { invoke, isTauri } from '@tauri-apps/api/core';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { RoomRequestFailure } from './sharedRoomConnection';
import { readRoomRequest, roomBinary, type RoomActor, type RoomRequest } from './sharedRoomProtocol';
import { readPresenceRequest, readPresenceResponse, type PresenceRequest, type PresenceResponse } from './roomPresenceProtocol';
import { readRoomCommentRequest, readRoomCommentResponse, readRoomCommentHistoryPage, type RoomCommentRequest } from './roomCommentProtocol';

import { readAuthorCatalog, readAuthorGrantRequest, readAuthorGrantResponse, readCommentOwnership, type AuthorGrantRequest } from './roomAuthorProtocol';
import { readRoomLibraryCatalog, readRoomLibraryRead, readRoomLibraryPublish, validateRoomLibraryBundle, readRoomLibraryPublication, readRoomLibraryRevision, type RoomLibraryPublish } from './roomLibraryProtocol';
import { readRoomImageBegin, readRoomImageManifest, readRoomImageChunk, readRoomImageCatalog, readRoomImageRevisionRequest, readRoomImageRevision, readRoomImageUpload, readRoomImageChunkResponse, validateRoomImageManifest, validateRoomImageChunk, roomImageChunkSize, type RoomImageBegin, type RoomImageManifest, type RoomImageChunk } from './roomImageProtocol';
import { readRoomImageFileScope, readRoomImageFilePhoto, readRoomImageFileInfo, readRoomImageFileExpected, readRoomImageFileStatus, readRoomImageFileChunk, readRoomImageFileDiscard, roomImageFileInfoManifest, type RoomImageFileScope, type RoomImageFileInfo, type RoomImageFileExpected, type RoomImageFileOperation } from './roomImageFileProtocol';
import type { PhotoDocument } from '../photo/types';

type Role = 'editor' | 'viewer';
export type RoomMember = RoomActor & { revoked: boolean };
export type RoomGrant = { actor: RoomActor; credential: string; requestId?: string };
type Operation = { kind: 'sync'; message: RoomRequest } | { kind: 'create'; name: string; ownerName: string; checkpoint: string; requestId?: string }
  | { kind: 'members' } | { kind: 'invite'; name: string; role: Role; requestId?: string } | { kind: 'change'; memberId: string; role: Role } | { kind: 'revoke'; memberId: string }
  | { kind: 'recover'; requestId: string; grantKind: 'create' | 'invite' } | { kind: 'presence'; message: PresenceRequest }
  | { kind: 'comment'; message: RoomCommentRequest; recoverOnly: boolean } | { kind: 'commentHistory'; before?: number } | { kind: 'commentAuthors' } | { kind: 'commentOwnership' }
  | { kind: 'assignCommentAuthor'; message: AuthorGrantRequest } | { kind: 'recoverCommentAuthor'; requestId: string }
  | { kind: 'libraryCatalog' } | { kind: 'libraryRevision'; message: ReturnType<typeof readRoomLibraryRead> }
  | { kind: 'publishLibrary'; message: RoomLibraryPublish } | { kind: 'recoverLibrary'; requestId: string }
  | { kind: 'imageCatalog' } | { kind: 'imageRevision'; message: ReturnType<typeof readRoomImageRevisionRequest> }
  | { kind: 'beginImage'; message: RoomImageBegin } | { kind: 'imageUpload' | 'commitImage' | 'dismissImage'; requestId: string }
  | { kind: 'putImageChunk'; requestId: string; index: number; message: RoomImageChunk }
  | { kind: 'imageChunk'; imageId: string; revisionId: string; index: number };
const abortError = () => new DOMException('The room operation was cancelled.', 'AbortError');
function desktop(): void { if (!isTauri()) throw new Error('Open XDesign in Orion Terminal desktop to connect a shared room.'); }
export { roomServerOrigin } from './roomOrigin';
import { roomServerOrigin } from './roomOrigin';

function name(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\x00-\x1f\x7f-\x9f]/.test(value)) throw new Error('Enter a room or member name up to 128 characters.');
  return value.trim();
}
function role(value: Role): Role { if (value !== 'editor' && value !== 'viewer') throw new Error('Choose editor or viewer access.'); return value; }
function credential(value: unknown, actorId?: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{43}$/.test(value) || actorId && !value.startsWith(`${actorId}.`)) throw new Error('Invalid room membership credential.');
}
function nativeFailure(value: unknown): Error {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.code === 'cancelled') return abortError();
    if (Number.isSafeInteger(record.status) && (record.status as number) >= 400 && (record.status as number) <= 599 && typeof record.code === 'string' && /^[a-z]{1,64}$/.test(record.code)) {
      const message = record.code === 'credential' ? 'Configure the room credential for this server and document.'
        : record.code === 'timeout' ? 'The room request timed out. Its server outcome is unknown.'
        : record.code === 'busy' ? 'Wait for the current room operation to finish.'
        : record.code === 'network' ? 'The room service could not connect. Local changes were retained.'
        : record.code === 'file' ? 'The native image transfer is incomplete or changed. Original files were retained.'
        : 'The room service refused the operation.';
      return new RoomRequestFailure(message, record.status as number, record.code);
    }
  }
  return new RoomRequestFailure('The desktop room bridge is unavailable. Reopen Orion Terminal with the updated application.', 422, 'bridge');
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid room management response.');
  return value as Record<string, unknown>;
}
function actor(value: unknown, revoked = false): RoomActor | RoomMember {
  const record = object(value, ['id', 'name', 'role', ...(revoked ? ['revoked'] : [])]); validateSharedDocumentId(record.id);
  if (typeof record.name !== 'string' || name(record.name) !== record.name || !['owner', 'editor', 'viewer'].includes(record.role as string) || revoked && typeof record.revoked !== 'boolean') throw new Error('Invalid room membership.');
  return { id: record.id, name: record.name, role: record.role as RoomActor['role'], ...(revoked ? { revoked: record.revoked as boolean } : {}) };
}
async function keyCommand<T>(command: string, serverUrl: string, documentId: string | null, secret?: string): Promise<T> {
  desktop(); const server = roomServerOrigin(serverUrl); if (documentId !== null) validateSharedDocumentId(documentId);
  if (secret !== undefined) {
    if (documentId !== null) credential(secret);
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256 || !/^[\x21-\x7e]+$/.test(secret)) throw new Error('Enter a valid room credential.');
  }
  try { return await invoke<T>(command, { serverUrl: server, documentId, ...(secret !== undefined ? { secret } : {}) }); }
  catch (error) { throw nativeFailure(error); }
}
export const setRoomCredential = (serverUrl: string, documentId: string | null, secret: string): Promise<void> => keyCommand('xdesign_room_key_set', serverUrl, documentId, secret);
export const clearRoomCredential = (serverUrl: string, documentId: string | null): Promise<void> => keyCommand('xdesign_room_key_clear', serverUrl, documentId);
export async function hasRoomCredential(serverUrl: string, documentId: string | null): Promise<boolean> {
  const result = await keyCommand<unknown>('xdesign_room_key_status', serverUrl, documentId);
  if (typeof result !== 'boolean') throw new Error('Invalid room credential status.'); return result;
}

export class NativeRoomTransport {
  private sequence = 0;
  private busy = false;
  private closed = false;
  private closing?: Promise<void>;
  private constructor(private readonly scope: Readonly<{ serverUrl: string; documentId: string; handle: string }>) {}
  get serverUrl(): string { return this.scope.serverUrl; }
  get documentId(): string { return this.scope.documentId; }
  get inFlight(): boolean { return this.busy; }
  static async open(serverUrl: string, documentId: string, signal?: AbortSignal): Promise<NativeRoomTransport> {
    desktop(); const server = roomServerOrigin(serverUrl); validateSharedDocumentId(documentId); if (signal?.aborted) throw abortError();
    let handle: string;
    try { handle = await invoke<string>('xdesign_room_open', { serverUrl: server, documentId }); } catch (error) { throw nativeFailure(error); }
    validateSharedDocumentId(handle);
    const transport = new NativeRoomTransport(Object.freeze({ serverUrl: server, documentId, handle }));
    if (signal?.aborted) { await transport.dispose(); throw abortError(); } return transport;
  }
  readonly request = (packet: Readonly<RoomRequest>, signal: AbortSignal): Promise<unknown> => {
    const validated = readRoomRequest(packet).packet;
    if (validated.documentId !== this.documentId) return Promise.reject(new Error('The shared request belongs to another document.'));
    return this.execute({ kind: 'sync', message: { ...validated } }, signal);
  };
  async presence(packet: PresenceRequest, signal: AbortSignal): Promise<PresenceResponse> {
    const message = readPresenceRequest(packet); if (message.documentId !== this.documentId) throw new Error('The presence request belongs to another room.');
    return readPresenceResponse(await this.execute({ kind: 'presence', message }, signal), message);
  }
  async comment(packet: RoomCommentRequest, signal: AbortSignal, recoverOnly = false): Promise<ReturnType<typeof readRoomCommentResponse>> {
    if (typeof recoverOnly !== 'boolean') throw new Error('Invalid comment recovery mode.');
    const message = readRoomCommentRequest(packet).packet; if (message.documentId !== this.documentId) throw new Error('The comment request belongs to another room.');
    return readRoomCommentResponse(await this.execute({ kind: 'comment', message, recoverOnly }, signal), message);
  }
  async commentHistory(signal: AbortSignal, before?: number): Promise<ReturnType<typeof readRoomCommentHistoryPage>> {
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new Error('Invalid comment history cursor.');
    return readRoomCommentHistoryPage(await this.execute({ kind: 'commentHistory', ...(before === undefined ? {} : { before }) }, signal),this.documentId,before);
  }
  async commentAuthors(signal?: AbortSignal): Promise<ReturnType<typeof readAuthorCatalog>> {
    return readAuthorCatalog(await this.execute({ kind: 'commentAuthors' }, signal), this.documentId);
  }
  async commentOwnership(signal: AbortSignal): Promise<ReturnType<typeof readCommentOwnership>> {
    return readCommentOwnership(await this.execute({ kind: 'commentOwnership' }, signal), this.documentId);
  }
  async assignCommentAuthor(value: AuthorGrantRequest, signal: AbortSignal): Promise<ReturnType<typeof readAuthorGrantResponse>> {
    const message = readAuthorGrantRequest(value);
    return readAuthorGrantResponse(await this.execute({ kind: 'assignCommentAuthor', message }, signal), this.documentId, message.requestId, message);
  }
  async recoverCommentAuthor(value: AuthorGrantRequest, signal: AbortSignal): Promise<ReturnType<typeof readAuthorGrantResponse>> {
    const message = readAuthorGrantRequest(value);
    return readAuthorGrantResponse(await this.execute({ kind: 'recoverCommentAuthor', requestId: message.requestId }, signal), this.documentId, message.requestId, message);
  }
  async libraryCatalog(signal: AbortSignal): Promise<ReturnType<typeof readRoomLibraryCatalog>> {
    return this.execute({ kind: 'libraryCatalog' }, signal, value => readRoomLibraryCatalog(value, this.documentId));
  }
  async libraryRevision(libraryId: string, revisionId: string | null, signal: AbortSignal): Promise<Awaited<ReturnType<typeof readRoomLibraryRevision>>> {
    const message = readRoomLibraryRead({ version: 1, libraryId, revisionId });
    return this.execute({ kind: 'libraryRevision', message }, signal, value => readRoomLibraryRevision(value, this.documentId, message.libraryId, message.revisionId));
  }
  async publishLibrary(packet: RoomLibraryPublish, signal: AbortSignal): Promise<ReturnType<typeof readRoomLibraryPublication>> {
    return this.libraryPublication(packet, signal, false);
  }
  async recoverLibrary(packet: RoomLibraryPublish, signal: AbortSignal): Promise<ReturnType<typeof readRoomLibraryPublication>> {
    return this.libraryPublication(packet, signal, true);
  }
  private libraryPublication(packet: RoomLibraryPublish, signal: AbortSignal, recoverOnly: boolean): Promise<ReturnType<typeof readRoomLibraryPublication>> {
    const message = readRoomLibraryPublish(packet);
    const expected = { libraryId: message.bundle.manifest.libraryId, revisionId: message.bundle.manifest.revisionId, bundleDigest: '' };
    return this.execute(async () => {
      expected.bundleDigest = (await validateRoomLibraryBundle(message.bundle)).bundleDigest;
      return recoverOnly ? { kind: 'recoverLibrary', requestId: message.requestId } : { kind: 'publishLibrary', message };
    }, signal, value => readRoomLibraryPublication(value, this.documentId, message.requestId, expected));
  }
  async imageCatalog(signal: AbortSignal): Promise<ReturnType<typeof readRoomImageCatalog>> {
    return this.execute({ kind: 'imageCatalog' }, signal, async value => {
      const result = readRoomImageCatalog(value, this.documentId);
      for (const image of result.images) await validateRoomImageManifest(image.manifest); return result;
    });
  }
  async imageRevision(imageId: string, revisionId: string | null, signal: AbortSignal): Promise<ReturnType<typeof readRoomImageRevision>> {
    const message = readRoomImageRevisionRequest({ version: 1, imageId, revisionId });
    return this.execute({ kind: 'imageRevision', message }, signal, async value => {
      const result = readRoomImageRevision(value, this.documentId, message.imageId, message.revisionId);
      await validateRoomImageManifest(result.publication.manifest); return result;
    });
  }
  async beginImage(packet: RoomImageBegin, signal: AbortSignal): Promise<ReturnType<typeof readRoomImageUpload>> {
    const message = readRoomImageBegin(packet);
    return this.execute(async () => { await validateRoomImageManifest(message.manifest); return { kind: 'beginImage', message }; }, signal,
      value => this.imageResult(value, message.requestId, message.manifest));
  }
  async imageUpload(requestId: string, manifest: RoomImageManifest, signal: AbortSignal): Promise<ReturnType<typeof readRoomImageUpload>> {
    return this.imageStatus('imageUpload', requestId, manifest, signal);
  }
  async commitImage(requestId: string, manifest: RoomImageManifest, signal: AbortSignal): Promise<ReturnType<typeof readRoomImageUpload>> {
    return this.imageStatus('commitImage', requestId, manifest, signal);
  }
  async dismissImage(requestId: string, manifest: RoomImageManifest, signal: AbortSignal): Promise<ReturnType<typeof readRoomImageUpload>> {
    return this.imageStatus('dismissImage', requestId, manifest, signal);
  }
  private imageStatus(kind: 'imageUpload' | 'commitImage' | 'dismissImage', requestId: string, manifest: RoomImageManifest, signal: AbortSignal): Promise<ReturnType<typeof readRoomImageUpload>> {
    validateSharedDocumentId(requestId); const expected = readRoomImageManifest(manifest);
    return this.execute(async () => { await validateRoomImageManifest(expected); return { kind, requestId }; }, signal, async value => {
      const result = await this.imageResult(value, requestId, expected);
      if (kind === 'commitImage' && result.state !== 'published' || kind === 'dismissImage' && result.state !== 'dismissed') throw new Error('The room service did not acknowledge the requested image action.');
      return result;
    });
  }
  async putImageChunk(requestId: string, packet: RoomImageChunk, manifest: RoomImageManifest, signal: AbortSignal): Promise<ReturnType<typeof readRoomImageUpload>> {
    validateSharedDocumentId(requestId); const expected = readRoomImageManifest(manifest), { chunk } = readRoomImageChunk(packet);
    return this.execute(async () => {
      await validateRoomImageManifest(expected); await validateRoomImageChunk(chunk, expected);
      return { kind: 'putImageChunk', requestId, index: chunk.index, message: chunk };
    }, signal, async value => {
      const result = await this.imageResult(value, requestId, expected);
      if (!result.received.includes(chunk.index)) throw new Error('The room service did not acknowledge the original image chunk.');
      return result;
    });
  }
  async imageChunk(manifest: RoomImageManifest, index: number, signal: AbortSignal): Promise<Awaited<ReturnType<typeof readRoomImageChunkResponse>>> {
    const expected = readRoomImageManifest(manifest); roomImageChunkSize(expected, index);
    return this.execute(async () => {
      await validateRoomImageManifest(expected); return { kind: 'imageChunk', imageId: expected.imageId, revisionId: expected.revisionId, index };
    }, signal, value => readRoomImageChunkResponse(value, this.documentId, expected, index));
  }
  private async imageResult(value: unknown, requestId: string, expected: RoomImageManifest): Promise<ReturnType<typeof readRoomImageUpload>> {
    const result = readRoomImageUpload(value, this.documentId, requestId, expected);
    await validateRoomImageManifest(result.manifest);
    if (result.publication) await validateRoomImageManifest(result.publication.manifest);
    if (result.current) await validateRoomImageManifest(result.current.manifest); return result;
  }
  async prepareImageFile(value: RoomImageFileScope, photo: PhotoDocument, signal: AbortSignal) {
    const scope = readRoomImageFileScope(value), source = readRoomImageFilePhoto(photo);
    return this.execute({ version: 1, ...scope, action: { kind: 'prepare', photo: source } }, signal, async reply => {
      const result = await readRoomImageFileStatus(reply, this.documentId, scope, { direction: 'upload', source });
      if (result.state !== 'ready') throw new Error('The native image preparation was not acknowledged.'); return result;
    }, 'xdesign_room_image_file_request');
  }
  async imageFileStatus(value: RoomImageFileScope, expectation: RoomImageFileExpected, signal: AbortSignal) {
    const scope = readRoomImageFileScope(value), expected = readRoomImageFileExpected(expectation);
    return this.execute(async () => { if (expected.direction === 'download') await validateRoomImageManifest(expected.manifest); return { version: 1, ...scope, action: { kind: 'status' } }; }, signal,
      reply => readRoomImageFileStatus(reply, this.documentId, scope, expected), 'xdesign_room_image_file_request');
  }
  async readImageFileChunk(value: RoomImageFileScope, prepared: RoomImageFileInfo, index: number, signal: AbortSignal) {
    const scope = readRoomImageFileScope(value), info = readRoomImageFileInfo(prepared); roomImageChunkSize(roomImageFileInfoManifest(info), index);
    return this.execute({ version: 1, ...scope, action: { kind: 'read', index } }, signal,
      reply => readRoomImageFileChunk(reply, this.documentId, scope, info, index), 'xdesign_room_image_file_request');
  }
  async stageImageFile(value: RoomImageFileScope, packet: RoomImageManifest, signal: AbortSignal) {
    const scope = readRoomImageFileScope(value), manifest = readRoomImageManifest(packet);
    return this.execute(async () => { await validateRoomImageManifest(manifest); return { version: 1, ...scope, action: { kind: 'stage', manifest } }; }, signal,
      reply => readRoomImageFileStatus(reply, this.documentId, scope, { direction: 'download', manifest }), 'xdesign_room_image_file_request');
  }
  async putImageFileChunk(value: RoomImageFileScope, packet: RoomImageChunk, original: RoomImageManifest, signal: AbortSignal) {
    const scope = readRoomImageFileScope(value), manifest = readRoomImageManifest(original), { chunk } = readRoomImageChunk(packet);
    return this.execute(async () => { await validateRoomImageManifest(manifest); await validateRoomImageChunk(chunk, manifest); return { version: 1, ...scope, action: { kind: 'put', index: chunk.index, chunk } }; }, signal, async reply => {
      const result = await readRoomImageFileStatus(reply, this.documentId, scope, { direction: 'download', manifest });
      if (!result.received.includes(chunk.index)) throw new Error('The native image file did not acknowledge the original chunk.'); return result;
    }, 'xdesign_room_image_file_request');
  }
  async importImageFile(value: RoomImageFileScope, packet: RoomImageManifest, signal: AbortSignal) {
    const scope = readRoomImageFileScope(value), manifest = readRoomImageManifest(packet);
    return this.execute(async () => { await validateRoomImageManifest(manifest); return { version: 1, ...scope, action: { kind: 'import' } }; }, signal, async reply => {
      const result = await readRoomImageFileStatus(reply, this.documentId, scope, { direction: 'download', manifest });
      if (result.state !== 'imported') throw new Error('The native image import was not acknowledged.'); return result;
    }, 'xdesign_room_image_file_request');
  }
  async discardImageFile(value: RoomImageFileScope, signal: AbortSignal): Promise<void> {
    const scope = readRoomImageFileScope(value);
    return this.execute({ version: 1, ...scope, action: { kind: 'discard' } }, signal,
      reply => readRoomImageFileDiscard(reply, this.documentId, scope), 'xdesign_room_image_file_request');
  }
  private async execute<T = unknown>(operation: Operation | RoomImageFileOperation | (() => Promise<Operation | RoomImageFileOperation>), signal?: AbortSignal, decode?: (value: unknown) => T | Promise<T>, command: 'xdesign_room_request' | 'xdesign_room_image_file_request' = 'xdesign_room_request'): Promise<T> {
    if (this.closed || signal?.aborted) throw abortError();
    if (this.busy) throw new RoomRequestFailure('Wait for the current room operation to finish.', 503, 'busy');
    if (!Number.isSafeInteger(this.sequence + 1)) throw new Error('Reopen the room connection before continuing.');
    const sequence = ++this.sequence; this.busy = true; let dispatched = false, received = false;
    const cancel = () => { if (dispatched) void (async () => { try { await invoke('xdesign_room_cancel', { handle: this.scope.handle, sequence }); } catch {} })(); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const prepared = typeof operation === 'function' ? await operation() : operation;
      if (this.closed || signal?.aborted) throw abortError(); dispatched = true;
      const result = await invoke<unknown>(command, { handle: this.scope.handle, sequence, operation: prepared }); received = true;
      if (this.closed || signal?.aborted) throw abortError();
      const decoded = decode ? await decode(result) : result as T;
      if (this.closed || signal?.aborted) throw abortError(); return decoded;
    } catch (error) {
      if (this.closed || signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw abortError();
      if (!dispatched || received) throw error;
      throw nativeFailure(error);
    } finally { this.busy = false; signal?.removeEventListener('abort', cancel); }
  }
  async create(roomName: string, ownerName: string, checkpoint: Uint8Array, signal?: AbortSignal, requestId?: string): Promise<RoomGrant> {
    if (requestId !== undefined) validateSharedDocumentId(requestId);
    const result = await this.execute({ kind: 'create', name: name(roomName), ownerName: name(ownerName), checkpoint: roomBinary(checkpoint), ...(requestId === undefined ? {} : { requestId }) }, signal);
    return this.grant(result, 'owner', true, requestId);
  }
  async invite(memberName: string, access: Role, signal?: AbortSignal, requestId?: string): Promise<RoomGrant> {
    if (requestId !== undefined) validateSharedDocumentId(requestId);
    const result = await this.execute({ kind: 'invite', name: name(memberName), role: role(access), ...(requestId === undefined ? {} : { requestId }) }, signal); return this.grant(result, access, false, requestId);
  }
  async recoverGrant(requestId: string, kind: 'create' | 'invite', access: RoomActor['role'], signal?: AbortSignal): Promise<RoomGrant> {
    validateSharedDocumentId(requestId); if (!['create', 'invite'].includes(kind) || kind === 'create' && access !== 'owner' || kind === 'invite' && !['editor', 'viewer'].includes(access)) throw new Error('Invalid room grant recovery.');
    return this.grant(await this.execute({ kind: 'recover', requestId, grantKind: kind }, signal), access, kind === 'create', requestId);
  }
  private grant(value: unknown, expected: RoomActor['role'], created = false, requestId?: string): RoomGrant {
    const record = object(value, ['version', 'documentId', 'actor', 'credential', ...(created ? ['revision'] : []), ...(requestId === undefined ? [] : ['requestId'])]);
    if (record.version !== 1 || record.documentId !== this.documentId || created && record.revision !== 1) throw new Error('The grant belongs to another room or protocol version.');
    const membership = actor(record.actor); if (membership.role !== expected) throw new Error('The grant has a different access level.'); credential(record.credential, membership.id);
    if (requestId !== undefined && record.requestId !== requestId) throw new Error('The grant belongs to another request.');
    return { actor: membership, credential: record.credential, ...(requestId === undefined ? {} : { requestId }) };
  }
  async members(signal?: AbortSignal): Promise<RoomMember[]> {
    const record = object(await this.execute({ kind: 'members' }, signal), ['version', 'documentId', 'members']);
    if (record.version !== 1 || record.documentId !== this.documentId || !Array.isArray(record.members) || record.members.length < 1 || record.members.length > 64) throw new Error('Invalid room membership list.');
    const members = record.members.map(value => actor(value, true) as RoomMember);
    if (new Set(members.map(member => member.id)).size !== members.length || members.filter(member => member.role === 'owner').length !== 1 || members.some(member => member.role === 'owner' && member.revoked)) throw new Error('Invalid room ownership.');
    return members;
  }
  async changeMember(memberId: string, access: Role, signal?: AbortSignal): Promise<void> {
    validateSharedDocumentId(memberId); this.acknowledged(await this.execute({ kind: 'change', memberId, role: role(access) }, signal));
  }
  async revokeMember(memberId: string, signal?: AbortSignal): Promise<void> {
    validateSharedDocumentId(memberId); this.acknowledged(await this.execute({ kind: 'revoke', memberId }, signal));
  }
  private acknowledged(value: unknown): void {
    const record = object(value, ['version', 'documentId']); if (record.version !== 1 || record.documentId !== this.documentId) throw new Error('The member acknowledgment belongs to another room.');
  }
  dispose(): Promise<void> {
    if (!this.closing) { this.closed = true; this.closing = (async () => { try { await invoke<void>('xdesign_room_close', { handle: this.scope.handle }); } catch (error) { throw nativeFailure(error); } })(); }
    return this.closing;
  }
}
