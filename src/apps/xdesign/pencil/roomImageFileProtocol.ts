import { validatePhotoDocuments, type PhotoDocument } from '../photo/types';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { readRoomImageManifest, readRoomImageChunk, validateRoomImageManifest, validateRoomImageChunk, ROOM_IMAGE_METADATA_BYTES, type RoomImageManifest, type RoomImageChunk } from './roomImageProtocol';

export type RoomImageFileScope = { projectId: string; memberId: string; transferId: string };
export type RoomImageFileInfo = Pick<RoomImageManifest, 'name' | 'width' | 'height' | 'previewWidth' | 'previewHeight' | 'archiveBytes' | 'archiveDigest' | 'previewDigest' | 'chunkDigests'>;
export type RoomImageFileExpected = { direction: 'upload'; source: PhotoDocument } | { direction: 'download'; manifest: RoomImageManifest };
export type RoomImageFileStatus = RoomImageFileScope & { version: 1; documentId: string; direction: 'upload' | 'download'; state: 'preparing' | 'ready' | 'receiving' | 'importing' | 'imported'; source: PhotoDocument | null; manifest: RoomImageManifest | null; info: RoomImageFileInfo | null; received: number[]; photo: PhotoDocument | null };
export type RoomImageFileOperation = RoomImageFileScope & { version: 1; action: { kind: 'prepare'; photo: PhotoDocument } | { kind: 'status' } | { kind: 'read'; index: number } | { kind: 'stage'; manifest: RoomImageManifest } | { kind: 'put'; index: number; chunk: RoomImageChunk } | { kind: 'import' } | { kind: 'discard' } };
const photoKeys = ['id', 'version', 'name', 'width', 'height', 'previewWidth', 'previewHeight', 'bundlePath', 'previewPath', 'originalPath'];
const infoKeys = ['name', 'width', 'height', 'previewWidth', 'previewHeight', 'archiveBytes', 'archiveDigest', 'previewDigest', 'chunkDigests'];
const scopeKeys = ['version', 'documentId', 'memberId', 'projectId', 'transferId'];
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid native image transfer fields.');
  return value as Record<string, unknown>;
}
function id(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value)) throw new Error('Invalid native image identity.'); }
function bounded(value: unknown): void { if (new TextEncoder().encode(JSON.stringify(value)).length > ROOM_IMAGE_METADATA_BYTES) throw new Error('Native image transfer metadata exceeds its limit.'); }
export function readRoomImageFileScope(value: unknown): RoomImageFileScope {
  const item = object(value, ['projectId', 'memberId', 'transferId']); id(item.projectId); validateSharedDocumentId(item.memberId); validateSharedDocumentId(item.transferId);
  return { projectId: item.projectId, memberId: item.memberId, transferId: item.transferId };
}
export function readRoomImageFilePhoto(value: unknown): PhotoDocument {
  const optional = !!value && typeof value === 'object' && Object.hasOwn(value, 'historyBrushSourceId');
  const item = object(value, [...photoKeys, ...(optional ? ['historyBrushSourceId'] : [])]); id(item.id); id(item.version); if (optional) id(item.historyBrushSourceId);
  const copy = Object.fromEntries([...photoKeys, ...(optional ? ['historyBrushSourceId'] : [])].map(key => [key, structuredClone(item[key])]));
  const registry: unknown = { [item.id]: copy }; validatePhotoDocuments(registry);
  readRoomImageFileInfo({ name: copy.name, width: copy.width, height: copy.height, previewWidth: copy.previewWidth, previewHeight: copy.previewHeight, archiveBytes: 1, archiveDigest: '0'.repeat(64), previewDigest: '0'.repeat(64), chunkDigests: ['0'.repeat(64)] });
  bounded(copy); return registry[item.id]!;
}
export function roomImageFileInfoManifest(value: RoomImageFileInfo): RoomImageManifest {
  return readRoomImageManifest({ version: 1, kind: 'orion.xdesign.image', imageId: 'native_image_info_001', revisionId: '0'.repeat(64), previousRevisionId: null, ...value });
}
export function readRoomImageFileInfo(value: unknown): RoomImageFileInfo {
  const item = object(value, infoKeys), manifest = roomImageFileInfoManifest(item as RoomImageFileInfo);
  return { name: manifest.name, width: manifest.width, height: manifest.height, previewWidth: manifest.previewWidth, previewHeight: manifest.previewHeight, archiveBytes: manifest.archiveBytes, archiveDigest: manifest.archiveDigest, previewDigest: manifest.previewDigest, chunkDigests: [...manifest.chunkDigests] };
}
export function roomImageManifestFileInfo(value: RoomImageManifest): RoomImageFileInfo {
  const manifest = readRoomImageManifest(value);
  return readRoomImageFileInfo(Object.fromEntries(infoKeys.map(key => [key, manifest[key as keyof RoomImageManifest]])));
}
export function readRoomImageFileExpected(value: RoomImageFileExpected): RoomImageFileExpected {
  if (value.direction === 'upload') { const item = object(value, ['direction', 'source']); return { direction: 'upload', source: readRoomImageFilePhoto(item.source) }; }
  const item = object(value, ['direction', 'manifest']); if (item.direction !== 'download') throw new Error('Invalid native image transfer direction.');
  return { direction: 'download', manifest: readRoomImageManifest(item.manifest) };
}
function envelope(value: unknown, documentId: string, scope: RoomImageFileScope, keys: string[]) {
  validateSharedDocumentId(documentId); const item = object(value, [...scopeKeys, ...keys]);
  if (item.version !== 1 || item.documentId !== documentId || item.projectId !== scope.projectId || item.memberId !== scope.memberId || item.transferId !== scope.transferId) throw new Error('The native image transfer belongs to another project, room, member or request.');
  return item;
}
export async function readRoomImageFileStatus(value: unknown, documentId: string, scope: RoomImageFileScope, expected: RoomImageFileExpected): Promise<RoomImageFileStatus> {
  const item = envelope(value, documentId, scope, ['direction', 'state', 'source', 'manifest', 'info', 'received', 'photo']); bounded(item);
  const source = item.source === null ? null : readRoomImageFilePhoto(item.source), manifest = item.manifest === null ? null : readRoomImageManifest(item.manifest), info = item.info === null ? null : readRoomImageFileInfo(item.info), photo = item.photo === null ? null : readRoomImageFilePhoto(item.photo);
  if (item.direction !== expected.direction || !Array.isArray(item.received) || item.received.length > (info?.chunkDigests.length ?? 0)) throw new Error('Invalid native image transfer progress.');
  const received = item.received.map(index => { if (!Number.isSafeInteger(index) || index < 0 || !info || index >= info.chunkDigests.length) throw new Error('Invalid native image transfer progress.'); return index as number; });
  if (received.some((index, offset) => offset > 0 && index <= received[offset - 1]!)) throw new Error('Invalid native image transfer progress.');
  if (expected.direction === 'upload') {
    if (!source || JSON.stringify(source) !== JSON.stringify(readRoomImageFilePhoto(expected.source)) || manifest || photo || received.length || !['preparing', 'ready'].includes(String(item.state)) || item.state === 'ready' && !info) throw new Error('The original native image preparation changed.');
    if (info && ['name', 'width', 'height', 'previewWidth', 'previewHeight'].some(key => source[key as keyof PhotoDocument] !== info[key as keyof RoomImageFileInfo])) throw new Error('The native image preparation differs from its source.');
  } else {
    if (source || !manifest || !info || !['receiving', 'importing', 'imported'].includes(String(item.state)) || JSON.stringify(manifest) !== JSON.stringify(readRoomImageManifest(expected.manifest)) || JSON.stringify(info) !== JSON.stringify(roomImageManifestFileInfo(manifest))) throw new Error('The original native image download changed.');
    if ((item.state === 'imported') !== !!photo || item.state === 'imported' && received.length !== info.chunkDigests.length) throw new Error('The native image import was not acknowledged.');
    if (photo) {
      const path = (value: string) => value.replaceAll('\\', '/');
      const base = `/${scope.projectId}/${photo.id}/${photo.version}`;
      if (photo.originalPath !== null || !path(photo.bundlePath).endsWith(`${base}.pcraft`) || !path(photo.previewPath).endsWith(`${base}.png`) || ['name', 'width', 'height', 'previewWidth', 'previewHeight'].some(key => photo[key as keyof PhotoDocument] !== info[key as keyof RoomImageFileInfo])) throw new Error('The native imported image belongs to another destination.');
    }
    await validateRoomImageManifest(manifest);
  }
  return { version: 1, documentId, ...scope, direction: expected.direction, state: item.state as RoomImageFileStatus['state'], source, manifest, info, received, photo };
}
export async function readRoomImageFileChunk(value: unknown, documentId: string, scope: RoomImageFileScope, info: RoomImageFileInfo, index: number) {
  const item = envelope(value, documentId, scope, ['chunk']); const { chunk } = readRoomImageChunk(item.chunk);
  return validateRoomImageChunk(chunk, roomImageFileInfoManifest(info), index);
}
export function readRoomImageFileDiscard(value: unknown, documentId: string, scope: RoomImageFileScope): void {
  const item = envelope(value, documentId, scope, ['discarded']); if (item.discarded !== true) throw new Error('The native image transfer dismissal was not acknowledged.');
}
