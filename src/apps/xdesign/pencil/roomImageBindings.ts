import { roomServerOrigin } from './roomOrigin';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { readRoomImageReference, roomImageReferenceText, type RoomImageReference } from './roomImageReferences';
import { readRoomImageFilePhoto } from './roomImageFileProtocol';
import type { PhotoDocument } from '../photo/types';

export type RoomImageBinding = { serverUrl: string; documentId: string; reference: RoomImageReference; photo: PhotoDocument };
export type RoomImageBindings = { version: 1; bindings: RoomImageBinding[] };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid local shared image mapping.');
  return value as Record<string, unknown>;
}
export function roomImageBindingKey(value: Pick<RoomImageBinding, 'serverUrl' | 'documentId' | 'reference'>): string {
  validateSharedDocumentId(value.documentId);
  return JSON.stringify([roomServerOrigin(value.serverUrl), value.documentId, roomImageReferenceText(value.reference)]);
}
export function readRoomImageBinding(value: unknown): RoomImageBinding {
  const item = object(value, ['serverUrl', 'documentId', 'reference', 'photo']);
  if (typeof item.serverUrl !== 'string' || roomServerOrigin(item.serverUrl) !== item.serverUrl) throw new Error('Invalid local shared image origin.');
  validateSharedDocumentId(item.documentId);
  return { serverUrl: item.serverUrl, documentId: item.documentId as string, reference: readRoomImageReference(item.reference), photo: readRoomImageFilePhoto(item.photo) };
}
export function readRoomImageBindings(value: unknown): RoomImageBindings {
  if (value === undefined) return { version: 1, bindings: [] };
  const item = object(value, ['version', 'bindings']);
  if (item.version !== 1 || !Array.isArray(item.bindings) || item.bindings.length > 500 || new TextEncoder().encode(JSON.stringify(value)).length > 8 * 1024 * 1024) throw new Error('Local shared images exceed their saved mapping limit.');
  const keys = new Set<string>(), photos = new Map<string, string>();
  const bindings = item.bindings.map(value => {
    const binding = readRoomImageBinding(value), key = roomImageBindingKey(binding), photoKey = JSON.stringify([binding.photo.id, binding.photo.version]), photo = JSON.stringify(binding.photo);
    if (keys.has(key) || photos.has(photoKey) && photos.get(photoKey) !== photo) throw new Error('Conflicting local shared image mappings.');
    keys.add(key); photos.set(photoKey, photo); return binding;
  });
  return { version: 1, bindings };
}
export function findRoomImageBinding(value: RoomImageBindings, serverUrl: string, documentId: string, reference: RoomImageReference): RoomImageBinding | null {
  const key = roomImageBindingKey({ serverUrl, documentId, reference });
  return value.bindings.find(binding => roomImageBindingKey(binding) === key) ?? null;
}
export function addRoomImageBinding(value: RoomImageBindings, incoming: RoomImageBinding): RoomImageBindings {
  const binding = readRoomImageBinding(incoming), previous = findRoomImageBinding(value, binding.serverUrl, binding.documentId, binding.reference);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(binding)) throw new Error('This shared revision already has another local editable image. The original mapping was preserved.');
    return readRoomImageBindings(value);
  }
  return readRoomImageBindings({ version: 1, bindings: [...value.bindings, binding] });
}
