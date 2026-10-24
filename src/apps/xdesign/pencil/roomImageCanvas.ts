import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { computeImageHash } from '@open-pencil/scene-graph/images';
import { canonicalJSONString } from '@open-pencil/core/library';
import { addRoomImageBinding, findRoomImageBinding, type RoomImageBindings, type RoomImageBinding } from './roomImageBindings';
import { readRoomImagePluginData, roomImagePluginData, roomImageReferenceText, ROOM_IMAGE_PREVIEW_BYTES, type RoomImageReference } from './roomImageReferences';
import { readRoomImageFilePhoto } from './roomImageFileProtocol';
import { readRoomImageUpload, roomImageBytesDigest, validateRoomImageManifest, type RoomImageManifest } from './roomImageProtocol';
import type { RoomImageResult } from './roomImageClient';

export type RoomImageCanvasScope = { serverUrl: string; documentId: string };
export type RoomImageCanvasPatch = { nodeId: string; before: string; fills: SceneNode['fills']; pluginData: SceneNode['pluginData'] };
export type RoomImagePlacementPlan = { binding: RoomImageBinding; bindings: RoomImageBindings; patches: RoomImageCanvasPatch[] };
export const roomImagePlacementState = (fills: SceneNode['fills'], pluginData: SceneNode['pluginData']) => canonicalJSONString([fills, pluginData]);
export async function roomImagePublicationPlan(graph: SceneGraph, local: RoomImageBindings, scope: RoomImageCanvasScope, result: Extract<RoomImageResult, { kind: 'published' }>, preview: Uint8Array): Promise<{ binding: RoomImageBinding; bindings: RoomImageBindings; patches: RoomImageCanvasPatch[] }> {
  const reply = readRoomImageUpload(result.publication, scope.documentId, result.publication.requestId);
  if (reply.state !== 'published' || !reply.publication) throw new Error('Save the original accepted image receipt before changing its placements.');
  return roomImageRevisionPlan(graph, local, scope, result.source, reply.manifest, preview);
}
export async function roomImageRevisionPlan(graph: SceneGraph, local: RoomImageBindings, scope: RoomImageCanvasScope, photo: RoomImageBinding['photo'], manifest: RoomImageManifest, preview: Uint8Array): Promise<RoomImagePlacementPlan> {
  const source = readRoomImageFilePhoto(photo); await validateRoomImageManifest(manifest);
  if (!preview.length || preview.length > ROOM_IMAGE_PREVIEW_BYTES || await roomImageBytesDigest(preview) !== manifest.previewDigest || ['name', 'width', 'height', 'previewWidth', 'previewHeight'].some(key => source[key as keyof typeof source] !== manifest[key as keyof typeof manifest])) throw new Error('The published image preview differs from the reviewed native version.');
  const reference: RoomImageReference = { version: 1, imageId: manifest.imageId, revisionId: manifest.revisionId, previewHash: computeImageHash(preview) };
  const binding: RoomImageBinding = { ...scope, reference, photo: source }, bindings = addRoomImageBinding(local, binding);
  const originals = local.bindings.filter(item => item.serverUrl === scope.serverUrl && item.documentId === scope.documentId && item.photo.id === source.id && item.reference.imageId === manifest.imageId && item.reference.revisionId === manifest.previousRevisionId);
  const keys = new Set(originals.map(item => roomImageReferenceText(item.reference))), patches: RoomImageCanvasPatch[] = [];
  for (const node of graph.nodes.values()) {
    const current = readRoomImagePluginData(node.pluginData);
    if (current ? !keys.has(roomImageReferenceText(current)) : manifest.previousRevisionId !== null || !node.pluginData.some(item => item.pluginId === 'orion.xdesign' && item.key === 'photoDocumentId' && item.value === source.id)) continue;
    const pluginData = [...node.pluginData.filter(item => !(item.pluginId === 'orion.xdesign' && ['photoDocumentId', 'roomImage'].includes(item.key))), roomImagePluginData(reference)];
    const fills = node.fills.map(fill => fill.type === 'IMAGE' ? { ...fill, imageHash: reference.previewHash } : fill);
    patches.push({ nodeId: node.id, before: roomImagePlacementState(node.fills, node.pluginData), fills, pluginData });
  }
  return { binding, bindings, patches };
}
export function roomImageImportedBinding(local: RoomImageBindings, scope: RoomImageCanvasScope, result: Extract<RoomImageResult, { kind: 'imported' }>): { binding: RoomImageBinding; bindings: RoomImageBindings } {
  const binding: RoomImageBinding = { ...scope, reference: result.reference, photo: readRoomImageFilePhoto(result.photo) };
  if (result.reference.imageId !== result.manifest.imageId || result.reference.revisionId !== result.manifest.revisionId || ['name', 'width', 'height', 'previewWidth', 'previewHeight'].some(key => binding.photo[key as keyof typeof binding.photo] !== result.manifest[key as keyof typeof result.manifest])) throw new Error('The imported image differs from its original shared revision.');
  return { binding, bindings: addRoomImageBinding(local, binding) };
}
export function roomImageForNode(graph: SceneGraph, nodeId: string, local: RoomImageBindings, scope: RoomImageCanvasScope): RoomImageBinding | null {
  const node = graph.getNode(nodeId), reference = node && readRoomImagePluginData(node.pluginData);
  return reference ? findRoomImageBinding(local, scope.serverUrl, scope.documentId, reference) : null;
}
