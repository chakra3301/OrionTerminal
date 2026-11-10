import { vi } from 'vitest';
import { ulid } from 'ulid';
import { computeImageHash } from '@open-pencil/scene-graph';
import type { PhotoDocument } from '../photo/types';
import type { RoomCommentContext } from './roomCommentClient';
import { RoomRequestFailure } from './sharedRoomConnection';
import { RoomImageClient, type RoomImageTransport } from './roomImageClient';
import { RoomImagePendingStore, type RoomImagePendingStorage, type PendingRoomImageUpload } from './roomImagePending';
import { createRoomImageManifest, roomImageBytesDigest, readRoomImageChunkResponse, ROOM_IMAGE_CHUNK_BYTES, type RoomImageChunk, type RoomImageManifest, type RoomImageUpload } from './roomImageProtocol';
import { roomImageManifestFileInfo, type RoomImageFileStatus, type RoomImageFileScope } from './roomImageFileProtocol';

export const imageProject = '01ARZ3NDEKTSV4RRFFQ69G5FAV', imageDocument = 'room_image_document_001', imageActor = { id: 'room_image_member_001', name: 'Image designer', role: 'editor' as const }, imageOrigin = 'https://rooms.example.test/';
export function imagePendingStorage() {
  let value: unknown = null, fail = false, writes = 0;
  const storage: RoomImagePendingStorage = { read: async () => structuredClone(value), write: async (_project, next, expected) => { if (fail) throw new Error('image pending save failure'); if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('image pending conflict'); writes++; value = structuredClone(next); } };
  return { pending: new RoomImagePendingStore(storage), reopen: () => new RoomImagePendingStore(storage), get value() { return value; }, set value(next: unknown) { value = structuredClone(next); }, get writes() { return writes; }, get fail() { return fail; }, set fail(next: boolean) { fail = next; } };
}
export async function imageFixture() {
  const bytes = new Uint8Array(ROOM_IMAGE_CHUNK_BYTES + 11).fill(139), preview = new Uint8Array([137, 80, 78, 71, 0, 255]), chunks: RoomImageChunk[] = [];
  for (let index = 0; index * ROOM_IMAGE_CHUNK_BYTES < bytes.length; index++) { const part = bytes.slice(index * ROOM_IMAGE_CHUNK_BYTES, (index + 1) * ROOM_IMAGE_CHUNK_BYTES); chunks.push({ version: 1, index, sha256: await roomImageBytesDigest(part), data: btoa(Array.from(part, byte => String.fromCharCode(byte)).join('')) }); }
  const id = ulid(), version = ulid(), source: PhotoDocument = { id, version, name: 'Original Image 🙂', width: 24, height: 24, previewWidth: 24, previewHeight: 24, bundlePath: `/assets/xdesign/${imageProject}/${id}/${version}.pcraft`, previewPath: `/assets/xdesign/${imageProject}/${id}/${version}.png`, originalPath: '/original/authored.psd' };
  const manifest = await createRoomImageManifest({ imageId: 'editable_image_identity_001', previousRevisionId: null, name: source.name, width: 24, height: 24, previewWidth: 24, previewHeight: 24, archiveBytes: bytes.length, archiveDigest: await roomImageBytesDigest(bytes), previewDigest: await roomImageBytesDigest(preview), chunkDigests: chunks.map(chunk => chunk.sha256) });
  const reference = { version: 1 as const, imageId: manifest.imageId, revisionId: manifest.revisionId, previewHash: computeImageHash(preview) }, pending: PendingRoomImageUpload = { projectId: imageProject, serverUrl: imageOrigin, documentId: imageDocument, actorId: imageActor.id, transferId: 'image_original_transfer_001', acknowledged: false, direction: 'upload', source, imageId: manifest.imageId, previousRevisionId: null, manifest: null, approved: false, publication: null };
  return { bytes, preview, chunks, source, manifest, reference, pending, info: roomImageManifestFileInfo(manifest) };
}
export async function imageClientFixture() {
  const f = await imageFixture(), saved = imagePendingStorage(), files = new Map<string, RoomImageFileStatus>(), uploads = new Map<string, RoomImageUpload>();
  let context: RoomCommentContext | null = { serverUrl: imageOrigin, actor: { ...imageActor }, epoch: 1, revision: 1 }, current = true, allocations = 0, loseCommit = false, loseImport = false, loseDiscard = false;
  const actor = () => structuredClone(context?.actor ?? imageActor), scopeStatus = (scope: RoomImageFileScope) => ({ version: 1 as const, documentId: imageDocument, ...scope });
  const publication = (manifest: RoomImageManifest) => ({ manifest, ownerId: imageActor.id, publisher: { id: imageActor.id, name: imageActor.name }, step: 1, publishedAt: '2026-10-12T12:00:00.000Z' });
  const readUpload = (request: string) => { const found = uploads.get(request); if (!found) throw new RoomRequestFailure('No original image request', 404, 'http'); return { ...structuredClone(found), actor: actor() }; };
  const transport: RoomImageTransport = {
    prepareImageFile: vi.fn(async (scope, source) => { let status = files.get(scope.transferId); if (!status) { status = { ...scopeStatus(scope), direction: 'upload', state: 'ready', source, manifest: null, info: f.info, received: [], photo: null }; files.set(scope.transferId, status); } return structuredClone(status); }),
    readImageFileChunk: vi.fn(async (_scope, _info, index) => ({ chunk: structuredClone(f.chunks[index]!), bytes: f.bytes.slice(index * ROOM_IMAGE_CHUNK_BYTES, (index + 1) * ROOM_IMAGE_CHUNK_BYTES) })),
    imageUpload: vi.fn(async request => readUpload(request)),
    beginImage: vi.fn(async packet => { if (!uploads.has(packet.requestId)) uploads.set(packet.requestId, { version: 1, documentId: imageDocument, actor: actor(), requestId: packet.requestId, state: 'pending', manifest: structuredClone(packet.manifest), received: [], publication: null, current: null }); return readUpload(packet.requestId); }),
    putImageChunk: vi.fn(async (request, chunk) => { const status = uploads.get(request)!; status.received = [...new Set([...status.received, chunk.index])].sort(); return readUpload(request); }),
    commitImage: vi.fn(async request => { const status = uploads.get(request)!; status.state = 'published'; status.publication = publication(status.manifest); status.current = status.publication; if (loseCommit) { loseCommit = false; throw new Error('lost image commit reply'); } return readUpload(request); }),
    dismissImage: vi.fn(async request => { const status = uploads.get(request)!; status.state = 'dismissed'; status.received = []; return readUpload(request); }),
    imageRevision: vi.fn(async () => ({ version: 1 as const, documentId: imageDocument, actor: actor(), publication: publication(f.manifest) })),
    imageChunk: vi.fn(async (manifest, index) => readRoomImageChunkResponse({ version: 1, documentId: imageDocument, actor: actor(), imageId: manifest.imageId, revisionId: manifest.revisionId, chunk: f.chunks[index] }, imageDocument, manifest, index)),
    stageImageFile: vi.fn(async (scope, manifest) => { let status = files.get(scope.transferId); if (!status) { status = { ...scopeStatus(scope), direction: 'download', state: 'receiving', source: null, manifest, info: roomImageManifestFileInfo(manifest), received: [], photo: null }; files.set(scope.transferId, status); } return structuredClone(status); }),
    putImageFileChunk: vi.fn(async (scope, chunk) => { const status = files.get(scope.transferId)!; status.received = [...new Set([...status.received, chunk.index])].sort(); return structuredClone(status); }),
    importImageFile: vi.fn(async scope => { const status = files.get(scope.transferId)!; if (!status.photo) { allocations++; const id = ulid(); status.photo = { ...f.source, id, bundlePath: `/assets/xdesign/${imageProject}/${id}/${f.source.version}.pcraft`, previewPath: `/assets/xdesign/${imageProject}/${id}/${f.source.version}.png`, originalPath: null }; status.state = 'imported'; } if (loseImport) { loseImport = false; throw new Error('lost native image import reply'); } return structuredClone(status); }),
    discardImageFile: vi.fn(async scope => { files.delete(scope.transferId); if (loseDiscard) { loseDiscard = false; throw new Error('lost native image discard reply'); } }),
    dispose: vi.fn(async () => {}),
  };
  const open = vi.fn(async () => transport), states: unknown[] = [], clients: RoomImageClient[] = [];
  const client = () => { const next = new RoomImageClient(imageDocument, imageProject, { current: () => current, context: () => context, onState: state => states.push(state), pending: saved.reopen(), open }); clients.push(next); return next; };
  const ready = client(); await ready.initialize();
  return { ...f, saved, files, uploads, transport, open, ready, client, states, get context() { return context; }, set context(value: RoomCommentContext | null) { context = value; }, get current() { return current; }, set current(value: boolean) { current = value; }, get allocations() { return allocations; }, get loseCommit() { return loseCommit; }, set loseCommit(value: boolean) { loseCommit = value; }, get loseImport() { return loseImport; }, set loseImport(value: boolean) { loseImport = value; }, get loseDiscard() { return loseDiscard; }, set loseDiscard(value: boolean) { loseDiscard = value; }, dispose() { clients.forEach(client => client.dispose()); } };
}
