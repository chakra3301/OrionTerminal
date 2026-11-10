import { canonicalJSONString, contentHash } from '@open-pencil/core/library';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { readRoomCommentActor } from './roomCommentProtocol';
import type { RoomActor } from './sharedRoomProtocol';

export const ROOM_IMAGE_CHUNK_BYTES = 1024 * 1024;
export const ROOM_IMAGE_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const ROOM_IMAGE_MESSAGE_BYTES = 1_500_000;
export const ROOM_IMAGE_METADATA_BYTES = 128 * 1024;
export type RoomImageManifest = { version: 1; kind: 'orion.xdesign.image'; imageId: string; revisionId: string; previousRevisionId: string | null; name: string; width: number; height: number; previewWidth: number; previewHeight: number; archiveBytes: number; archiveDigest: string; previewDigest: string; chunkDigests: string[] };
export type RoomImageBegin = { version: 1; requestId: string; manifest: RoomImageManifest };
export type RoomImageChunk = { version: 1; index: number; sha256: string; data: string };
export type RoomImageSummary = { manifest: RoomImageManifest; ownerId: string; publisher: { id: string; name: string }; step: number; publishedAt: string };
export type RoomImageUpload = { version: 1; documentId: string; actor: RoomActor; requestId: string; state: 'pending' | 'published' | 'dismissed'; manifest: RoomImageManifest; received: number[]; publication: RoomImageSummary | null; current: RoomImageSummary | null };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid shared image fields.');
  return value as Record<string, unknown>;
}
function hash(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid shared image digest.'); return value; }
function integer(value: unknown, min: number, max: number): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error('Invalid shared image dimensions or size.'); return value as number; }
function name(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f-\x9f\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid shared image name.'); return value; }
export function readRoomImageManifest(value: unknown): RoomImageManifest {
  const item = object(value, ['version', 'kind', 'imageId', 'revisionId', 'previousRevisionId', 'name', 'width', 'height', 'previewWidth', 'previewHeight', 'archiveBytes', 'archiveDigest', 'previewDigest', 'chunkDigests']);
  if (item.version !== 1 || item.kind !== 'orion.xdesign.image') throw new Error('Unsupported shared image format.');
  validateSharedDocumentId(item.imageId);
  const width = integer(item.width, 1, 268_435_456), height = integer(item.height, 1, 268_435_456);
  if (width * height > 268_435_456) throw new Error('The shared image exceeds its editing limit.');
  const previewWidth = integer(item.previewWidth, 1, Math.min(2048, width)), previewHeight = integer(item.previewHeight, 1, Math.min(2048, height));
  const archiveBytes = integer(item.archiveBytes, 1, ROOM_IMAGE_ARCHIVE_BYTES), count = Math.ceil(archiveBytes / ROOM_IMAGE_CHUNK_BYTES);
  if (!Array.isArray(item.chunkDigests) || item.chunkDigests.length !== count) throw new Error('Invalid shared image chunk inventory.');
  return { version: 1, kind: 'orion.xdesign.image', imageId: item.imageId, revisionId: hash(item.revisionId), previousRevisionId: item.previousRevisionId === null ? null : hash(item.previousRevisionId), name: name(item.name), width, height, previewWidth, previewHeight, archiveBytes, archiveDigest: hash(item.archiveDigest), previewDigest: hash(item.previewDigest), chunkDigests: item.chunkDigests.map(hash) };
}
export function roomImageManifestText(manifest: RoomImageManifest): string { const { revisionId: _revision, ...fields } = readRoomImageManifest(manifest); return canonicalJSONString(fields); }
export async function validateRoomImageManifest(value: unknown): Promise<RoomImageManifest> {
  const manifest = readRoomImageManifest(value), { revisionId, ...fields } = manifest;
  if (await contentHash(fields) !== revisionId) throw new Error('The shared image manifest failed its integrity check.');
  return manifest;
}
export async function createRoomImageManifest(input: Omit<RoomImageManifest, 'version' | 'kind' | 'revisionId'>): Promise<RoomImageManifest> {
  const { revisionId: _revision, version: _version, kind: _kind, ...data } = structuredClone(input) as RoomImageManifest;
  const fields = { version: 1 as const, kind: 'orion.xdesign.image' as const, ...data };
  return validateRoomImageManifest({ ...fields, revisionId: await contentHash(fields) });
}
export function readRoomImageBegin(value: unknown): RoomImageBegin {
  const item = object(value, ['version', 'requestId', 'manifest']);
  if (item.version !== 1) throw new Error('Unsupported shared image upload.'); validateSharedDocumentId(item.requestId);
  return { version: 1, requestId: item.requestId, manifest: readRoomImageManifest(item.manifest) };
}
export function readRoomImageCommit(value: unknown): { version: 1; requestId: string } { const item = object(value, ['version', 'requestId']); if (item.version !== 1) throw new Error('Unsupported shared image upload.'); validateSharedDocumentId(item.requestId); return { version: 1, requestId: item.requestId }; }
export function roomImageChunkSize(manifest: RoomImageManifest, index: number): number { integer(index, 0, manifest.chunkDigests.length - 1); return Math.min(ROOM_IMAGE_CHUNK_BYTES, manifest.archiveBytes - index * ROOM_IMAGE_CHUNK_BYTES); }
export function readRoomImageChunk(value: unknown): { chunk: RoomImageChunk; bytes: Uint8Array } {
  const item = object(value, ['version', 'index', 'sha256', 'data']);
  if (item.version !== 1) throw new Error('Unsupported shared image chunk.'); const index = integer(item.index, 0, Math.ceil(ROOM_IMAGE_ARCHIVE_BYTES / ROOM_IMAGE_CHUNK_BYTES) - 1), sha256 = hash(item.sha256);
  if (typeof item.data !== 'string' || !item.data || item.data.length > Math.ceil(ROOM_IMAGE_CHUNK_BYTES / 3) * 4 || item.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error('Invalid shared image chunk encoding.');
  const raw = atob(item.data); if (btoa(raw) !== item.data || raw.length > ROOM_IMAGE_CHUNK_BYTES) throw new Error('Invalid shared image chunk encoding.');
  return { chunk: { version: 1, index, sha256, data: item.data }, bytes: Uint8Array.from(raw, character => character.charCodeAt(0)) };
}
export async function roomImageBytesDigest(bytes: Uint8Array): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function validateRoomImageChunk(value: unknown, manifest: RoomImageManifest, expectedIndex?: number) {
  const read = readRoomImageChunk(value);
  if (expectedIndex !== undefined && read.chunk.index !== expectedIndex || roomImageChunkSize(manifest, read.chunk.index) !== read.bytes.length || read.chunk.sha256 !== manifest.chunkDigests[read.chunk.index] || await roomImageBytesDigest(read.bytes) !== read.chunk.sha256) throw new Error('The shared image chunk differs from its immutable manifest.');
  return read;
}
export function readRoomImageSummary(value: unknown): RoomImageSummary {
  const item = object(value, ['manifest', 'ownerId', 'publisher', 'step', 'publishedAt']), manifest = readRoomImageManifest(item.manifest);
  validateSharedDocumentId(item.ownerId); const member = object(item.publisher, ['id', 'name']), actor = readRoomCommentActor({ ...member, role: 'editor' });
  const step = integer(item.step, 1, Number.MAX_SAFE_INTEGER);
  if (typeof item.publishedAt !== 'string' || item.publishedAt.length > 64 || !Number.isFinite(Date.parse(item.publishedAt))) throw new Error('Invalid shared image publication time.');
  return { manifest, ownerId: item.ownerId, publisher: { id: actor.id, name: actor.name }, step, publishedAt: item.publishedAt };
}
function envelope(value: unknown, documentId: string, keys: string[]) { validateSharedDocumentId(documentId); const item = object(value, ['version', 'documentId', 'actor', ...keys]); if (item.version !== 1 || item.documentId !== documentId) throw new Error('The shared image reply belongs to another room.'); return { item, actor: readRoomCommentActor(item.actor) }; }
export function readRoomImageUpload(value: unknown, documentId: string, requestId: string, expected?: RoomImageManifest): RoomImageUpload {
  validateSharedDocumentId(requestId); const { item, actor } = envelope(value, documentId, ['requestId', 'state', 'manifest', 'received', 'publication', 'current']);
  const manifest = readRoomImageManifest(item.manifest), publication = item.publication === null ? null : readRoomImageSummary(item.publication), current = item.current === null ? null : readRoomImageSummary(item.current);
  if (item.requestId !== requestId || !['pending', 'published', 'dismissed'].includes(String(item.state)) || expected && JSON.stringify(manifest) !== JSON.stringify(readRoomImageManifest(expected))) throw new Error('The shared image reply belongs to another immutable upload.');
  if (!Array.isArray(item.received) || item.received.length > manifest.chunkDigests.length) throw new Error('Invalid shared image upload progress.');
  const received: number[] = item.received.map(value => integer(value, 0, manifest.chunkDigests.length - 1));
  if (received.some((value, index) => index > 0 && value <= received[index - 1]!) || (item.state === 'dismissed' && received.length) || (item.state === 'published' && received.length !== manifest.chunkDigests.length) || (item.state === 'published') !== !!publication || publication && JSON.stringify(publication.manifest) !== JSON.stringify(manifest) || current && current.manifest.imageId !== manifest.imageId || publication && (!current || current.ownerId !== publication.ownerId || current.step < publication.step || current.step === publication.step && JSON.stringify(current) !== JSON.stringify(publication))) throw new Error('Invalid shared image upload result.');
  return { version: 1, documentId, actor, requestId, state: item.state as RoomImageUpload['state'], manifest, received, publication, current };
}
export function readRoomImageRevisionRequest(value: unknown): { version: 1; imageId: string; revisionId: string | null } { const item = object(value, ['version', 'imageId', 'revisionId']); if (item.version !== 1) throw new Error('Unsupported shared image read.'); validateSharedDocumentId(item.imageId); return { version: 1, imageId: item.imageId, revisionId: item.revisionId === null ? null : hash(item.revisionId) }; }
export function readRoomImageCatalog(value: unknown, documentId: string) {
  const { item, actor } = envelope(value, documentId, ['images']);
  if (!Array.isArray(item.images) || item.images.length > 256) throw new Error('Invalid shared image catalog.'); const images = item.images.map(readRoomImageSummary);
  if (new Set(images.map(image => image.manifest.imageId)).size !== images.length) throw new Error('Duplicate shared image identity.');
  return { version: 1 as const, documentId, actor, images };
}
export function readRoomImageRevision(value: unknown, documentId: string, imageId: string, revisionId: string | null) {
  validateSharedDocumentId(imageId); if (revisionId !== null) hash(revisionId); const { item, actor } = envelope(value, documentId, ['publication']); const publication = readRoomImageSummary(item.publication);
  if (publication.manifest.imageId !== imageId || revisionId !== null && publication.manifest.revisionId !== revisionId) throw new Error('The shared image reply belongs to another revision.');
  return { version: 1 as const, documentId, actor, publication };
}
export async function readRoomImageChunkResponse(value: unknown, documentId: string, manifest: RoomImageManifest, index: number) {
  const { item, actor } = envelope(value, documentId, ['imageId', 'revisionId', 'chunk']);
  if (item.imageId !== manifest.imageId || item.revisionId !== manifest.revisionId) throw new Error('The shared image chunk belongs to another revision.');
  const { chunk, bytes } = await validateRoomImageChunk(item.chunk, manifest, index);
  return { version: 1 as const, documentId, actor, imageId: manifest.imageId, revisionId: manifest.revisionId, chunk, bytes };
}
