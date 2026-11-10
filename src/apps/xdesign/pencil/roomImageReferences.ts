import type { SceneGraph } from '@open-pencil/scene-graph';
import { computeImageHash } from '@open-pencil/scene-graph/images';
import { validateSharedDocumentId } from './sharedCheckpoint';

export const ROOM_IMAGE_PLUGIN = 'orion.xdesign';
export const ROOM_IMAGE_KEY = 'roomImage';
export const ROOM_IMAGE_PREVIEW_BYTES = 24 * 1024 * 1024;
export type RoomImageReference = { version: 1; imageId: string; revisionId: string; previewHash: string };
export type RoomImagePlacement = { nodeId: string; reference: RoomImageReference };
function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function readRoomImageReference(value: unknown): RoomImageReference {
  const keys = ['version', 'imageId', 'revisionId', 'previewHash'];
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || value.version !== 1) throw new Error('Unsupported shared image reference.');
  validateSharedDocumentId(value.imageId);
  if (typeof value.revisionId !== 'string' || !/^[a-f0-9]{64}$/.test(value.revisionId) || typeof value.previewHash !== 'string' || !/^[a-f0-9]{40}$/.test(value.previewHash)) throw new Error('Invalid shared image revision or preview identity.');
  return { version: 1, imageId: value.imageId, revisionId: value.revisionId, previewHash: value.previewHash };
}
export function roomImageReferenceText(value: RoomImageReference): string { return JSON.stringify(readRoomImageReference(value)); }
export function readRoomImagePluginData(value: unknown): RoomImageReference | null {
  if (!Array.isArray(value)) throw new Error('Invalid shared image layer metadata.');
  const entries = value.filter(entry => plain(entry) && entry.pluginId === ROOM_IMAGE_PLUGIN && entry.key === ROOM_IMAGE_KEY);
  if (!entries.length) return null;
  if (entries.length !== 1 || value.some(entry => plain(entry) && entry.pluginId === ROOM_IMAGE_PLUGIN && entry.key === 'photoDocumentId')) throw new Error('A shared image layer has conflicting image identities.');
  const entry = entries[0] as Record<string, unknown>;
  if (Object.keys(entry).length !== 3 || !['pluginId', 'key', 'value'].every(key => Object.hasOwn(entry, key)) || typeof entry.value !== 'string' || entry.value.length > 1024) throw new Error('Invalid shared image reference metadata.');
  const reference = readRoomImageReference(JSON.parse(entry.value));
  if (entry.value !== roomImageReferenceText(reference)) throw new Error('The shared image reference must retain its canonical original metadata.');
  return reference;
}
export function roomImagePluginData(value: RoomImageReference) { return { pluginId: ROOM_IMAGE_PLUGIN, key: ROOM_IMAGE_KEY, value: roomImageReferenceText(value) }; }
export function roomImagePlacements(graph: SceneGraph): RoomImagePlacement[] {
  const placements: RoomImagePlacement[] = [], images = new Set<string>(), revisions = new Set<string>();
  for (const node of graph.nodes.values()) {
    const reference = readRoomImagePluginData(node.pluginData); if (!reference) continue;
    if (node.id === graph.rootId || node.type === 'CANVAS') throw new Error('A shared image reference must belong to an artwork layer.');
    images.add(reference.imageId); revisions.add(JSON.stringify([reference.imageId, reference.revisionId]));
    if (images.size > 256 || revisions.size > 500 || placements.length >= 100_000) throw new Error('Shared image references exceed their document limit.');
    placements.push({ nodeId: node.id, reference });
  }
  return placements;
}
export function assertRoomImageResources(graph: SceneGraph, check?: (reference: RoomImageReference, preview: Uint8Array) => void): void {
  const checked = new Set<string>(), resources = new Set<string>();
  for (const { reference } of roomImagePlacements(graph)) {
    const key = roomImageReferenceText(reference); if (checked.has(key)) continue; checked.add(key);
    const preview = graph.images.get(reference.previewHash);
    if (!(preview instanceof Uint8Array) || !preview.length || preview.length > ROOM_IMAGE_PREVIEW_BYTES) throw new Error('The shared image preview is missing or exceeds its limit.');
    if (!resources.has(reference.previewHash)) {
      if (computeImageHash(preview) !== reference.previewHash) throw new Error('The shared image preview differs from its original resource identity.');
      resources.add(reference.previewHash);
    }
    check?.(reference, preview);
  }
}
