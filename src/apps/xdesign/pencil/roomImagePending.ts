import { getAppState, compareAndSetXDesignRoomImagePending } from '@/lib/db';
import { roomServerOrigin } from './nativeRoomTransport';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { readRoomImageFilePhoto, readRoomImageFileScope } from './roomImageFileProtocol';
import { readRoomImageReference, type RoomImageReference } from './roomImageReferences';
import { readRoomImageManifest, readRoomImageUpload, validateRoomImageManifest, ROOM_IMAGE_METADATA_BYTES, type RoomImageManifest, type RoomImageUpload } from './roomImageProtocol';
import type { PhotoDocument } from '../photo/types';

type Base = { projectId: string; serverUrl: string; documentId: string; actorId: string; transferId: string; acknowledged: boolean };
export type PendingRoomImageUpload = Base & { direction: 'upload'; source: PhotoDocument; imageId: string; previousRevisionId: string | null; manifest: RoomImageManifest | null; approved: boolean; publication: RoomImageUpload | null };
export type PendingRoomImageDownload = Base & { direction: 'download'; manifest: RoomImageManifest; reference: RoomImageReference; photo: PhotoDocument | null };
export type PendingRoomImage = PendingRoomImageUpload | PendingRoomImageDownload;
export type PendingRoomImageSummary = Pick<Base, 'projectId' | 'serverUrl' | 'documentId' | 'actorId' | 'transferId' | 'acknowledged'> & { direction: 'upload' | 'download'; imageId: string; revisionId: string | null; name: string; approved: boolean; complete: boolean };
type State = { version: 1; pending: PendingRoomImage | null };
export type RoomImagePendingStorage = { read(projectId: string): Promise<unknown>; write(projectId: string, value: State, expected: unknown): Promise<void> };
const baseKeys = ['projectId', 'serverUrl', 'documentId', 'actorId', 'transferId', 'acknowledged', 'direction'];
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid pending image transfer. It was preserved.');
  return value as Record<string, unknown>;
}
export function roomImagePendingKey(projectId: string): `xdesign.roomImagePending.${string}` {
  readRoomImageFileScope({ projectId, memberId: 'image_scope_member_001', transferId: 'image_scope_transfer_001' });
  return `xdesign.roomImagePending.${projectId}`;
}
export function readPendingRoomImage(value: unknown, projectId: string): PendingRoomImage {
  roomImagePendingKey(projectId);
  const upload = !!value && typeof value === 'object' && 'direction' in value && value.direction === 'upload';
  const item = object(value, [...baseKeys, ...(upload ? ['source', 'imageId', 'previousRevisionId', 'manifest', 'approved', 'publication'] : ['manifest', 'reference', 'photo'])]);
  if (item.projectId !== projectId || typeof item.acknowledged !== 'boolean' || !['upload', 'download'].includes(String(item.direction)) || new TextEncoder().encode(JSON.stringify(value)).length > ROOM_IMAGE_METADATA_BYTES) throw new Error('Invalid or oversized pending image scope. It was preserved.');
  const scope = readRoomImageFileScope({ projectId, memberId: item.actorId, transferId: item.transferId }); validateSharedDocumentId(item.documentId);
  const serverUrl = roomServerOrigin(item.serverUrl as string);
  if (serverUrl !== item.serverUrl) throw new Error('The pending image origin changed. It was preserved.');
  const base = { projectId, serverUrl, documentId: item.documentId, actorId: scope.memberId, transferId: scope.transferId, acknowledged: item.acknowledged };
  if (upload) {
    const source = readRoomImageFilePhoto(item.source); validateSharedDocumentId(item.imageId);
    if (item.previousRevisionId !== null && (typeof item.previousRevisionId !== 'string' || !/^[a-f0-9]{64}$/.test(item.previousRevisionId)) || typeof item.approved !== 'boolean') throw new Error('Invalid pending image review. It was preserved.');
    const manifest = item.manifest === null ? null : readRoomImageManifest(item.manifest);
    if (manifest && (manifest.imageId !== item.imageId || manifest.previousRevisionId !== item.previousRevisionId || ['name', 'width', 'height', 'previewWidth', 'previewHeight'].some(key => manifest[key as keyof RoomImageManifest] !== source[key as keyof PhotoDocument])) || item.approved && !manifest) throw new Error('The pending image differs from its original source or review. It was preserved.');
    const publication = item.publication === null ? null : readRoomImageUpload(item.publication, base.documentId, base.transferId, manifest ?? undefined);
    if (publication && (!item.approved || publication.actor.id !== base.actorId || publication.state !== 'published') || item.acknowledged && !publication) throw new Error('Invalid pending image publication receipt. It was preserved.');
    return { ...base, direction: 'upload', source, imageId: item.imageId, previousRevisionId: item.previousRevisionId as string | null, manifest, approved: item.approved, publication };
  }
  const manifest = readRoomImageManifest(item.manifest), reference = readRoomImageReference(item.reference), photo = item.photo === null ? null : readRoomImageFilePhoto(item.photo);
  if (reference.imageId !== manifest.imageId || reference.revisionId !== manifest.revisionId || item.acknowledged && !photo) throw new Error('The pending image belongs to another revision. It was preserved.');
  if (photo) {
    const path = (value: string) => value.replaceAll('\\', '/'), destination = `/${projectId}/${photo.id}/${photo.version}`;
    if (photo.originalPath !== null || !path(photo.bundlePath).endsWith(destination + '.pcraft') || !path(photo.previewPath).endsWith(destination + '.png') || ['name', 'width', 'height', 'previewWidth', 'previewHeight'].some(key => photo[key as keyof PhotoDocument] !== manifest[key as keyof RoomImageManifest])) throw new Error('The pending imported image belongs to another destination. It was preserved.');
  }
  return { ...base, direction: 'download', manifest, reference, photo };
}
export function pendingRoomImageSummary(value: PendingRoomImage): PendingRoomImageSummary {
  const { projectId, serverUrl, documentId, actorId, transferId, acknowledged, direction } = value;
  return { projectId, serverUrl, documentId, actorId, transferId, acknowledged, direction, imageId: direction === 'upload' ? value.imageId : value.manifest.imageId, revisionId: value.manifest?.revisionId ?? null, name: direction === 'upload' ? value.source.name : value.manifest.name, approved: direction === 'download' || value.approved, complete: direction === 'upload' ? !!value.publication : !!value.photo };
}
export function samePendingRoomImage(a: PendingRoomImage, b: PendingRoomImage): boolean { return JSON.stringify(readPendingRoomImage(a, a.projectId)) === JSON.stringify(readPendingRoomImage(b, b.projectId)); }
async function validate(value: PendingRoomImage): Promise<void> { if (value.manifest) await validateRoomImageManifest(value.manifest); if (value.direction === 'upload' && value.publication?.current) await validateRoomImageManifest(value.publication.current.manifest); }
function decode(value: unknown, projectId: string): State {
  if (value === null) return { version: 1, pending: null };
  const item = object(value, ['version', 'pending']); if (item.version !== 1) throw new Error('This pending image transfer needs a newer application. It was preserved.');
  return { version: 1, pending: item.pending === null ? null : readPendingRoomImage(item.pending, projectId) };
}
function transition(before: PendingRoomImage, after: PendingRoomImage): void {
  const identity = (value: PendingRoomImage) => {
    const copy = structuredClone(value) as unknown as Record<string, unknown>; delete copy.acknowledged;
    if (value.direction === 'upload') { delete copy.manifest; delete copy.approved; delete copy.publication; } else delete copy.photo;
    return JSON.stringify(copy);
  };
  if (identity(before) !== identity(after) || before.acknowledged && !after.acknowledged) throw new Error('The original image transfer identity cannot be changed.');
  if (before.direction === 'upload' && after.direction === 'upload') {
    if (before.manifest && JSON.stringify(before.manifest) !== JSON.stringify(after.manifest) || before.approved && !after.approved || before.publication && JSON.stringify(before.publication) !== JSON.stringify(after.publication)) throw new Error('The original image review or receipt cannot be changed.');
  } else if (before.direction === 'download' && after.direction === 'download' && before.photo && JSON.stringify(before.photo) !== JSON.stringify(after.photo)) throw new Error('The original imported image identity cannot be changed.');
}
export class RoomImagePendingStore {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: RoomImagePendingStorage = { read: project => getAppState(roomImagePendingKey(project), true), write: (project, value, expected) => compareAndSetXDesignRoomImagePending(project, value, expected) }) {}
  async load(projectId: string): Promise<PendingRoomImage | null> { roomImagePendingKey(projectId); const value = decode(await this.storage.read(projectId), projectId).pending; if (value) await validate(value); return value; }
  remember(value: PendingRoomImage): Promise<void> {
    const next = readPendingRoomImage(value, value.projectId);
    return this.enqueue(async () => { const raw = await this.storage.read(next.projectId), old = decode(raw, next.projectId).pending; if (old) { await validate(old); if (!samePendingRoomImage(old, next)) throw new Error('Recover or dismiss the pending image transfer before starting another.'); } await validate(next); if (!old) await this.storage.write(next.projectId, { version: 1, pending: next }, raw); });
  }
  advance(before: PendingRoomImage, after: PendingRoomImage): Promise<void> {
    const expected = readPendingRoomImage(before, before.projectId), next = readPendingRoomImage(after, after.projectId); transition(expected, next);
    return this.enqueue(async () => { const raw = await this.storage.read(expected.projectId), old = decode(raw, expected.projectId).pending; if (!old || !samePendingRoomImage(old, expected)) throw new Error('The pending image transfer changed. Reopen the project before continuing.'); await validate(old); await validate(next); if (!samePendingRoomImage(old, next)) await this.storage.write(next.projectId, { version: 1, pending: next }, raw); });
  }
  forget(value: PendingRoomImage): Promise<void> {
    const expected = readPendingRoomImage(value, value.projectId);
    return this.enqueue(async () => { const raw = await this.storage.read(expected.projectId), old = decode(raw, expected.projectId).pending; if (!old) return; await validate(old); if (!samePendingRoomImage(old, expected)) throw new Error('The pending image transfer changed. Reopen the project before continuing.'); await this.storage.write(expected.projectId, { version: 1, pending: null }, raw); });
  }
  private enqueue(work: () => Promise<void>): Promise<void> { const result = this.mutation.catch(() => undefined).then(work); this.mutation = result; return result; }
}
export const roomImagePending = new RoomImagePendingStore();
