import { ulid } from 'ulid';
import type { XDDoc } from '../projectsStore';
import { deserializeGraph, serializeGraph, validatePencilDocument } from './document';
import { findRoomImageBinding, readRoomImageBindings } from './roomImageBindings';
import { readRoomImagePluginData } from './roomImageReferences';
import type { RoomImageCanvasScope } from './roomImageCanvas';

export type IndependentPhotoCopy = { sourceId: string; sourceVersion: string; targetId: string };
export function independentRoomImageCopy(source: XDDoc, scope: RoomImageCanvasScope | null, nextId = ulid): { document: XDDoc; photoCopies: IndependentPhotoCopy[] } {
  const document = structuredClone(source), pencil = document.pencilDocument;
  if (!pencil) throw new Error('Open a design canvas before copying shared images.');
  const graph = deserializeGraph(pencil.graph), bindings = readRoomImageBindings(pencil.roomImages);
  const photos = document.photoDocuments ?? {}, aliases = new Map<string, string>(), photoCopies: IndependentPhotoCopy[] = [];
  for (const binding of bindings.bindings) {
    const photo = binding.photo, key = JSON.stringify([photo.id, photo.version]);
    if (aliases.has(key)) continue;
    if (Object.keys(photos).length >= 1024) throw new Error('The independent copy exceeds its image document limit.');
    const targetId = nextId();
    if (photos[targetId] || bindings.bindings.some(item => item.photo.id === targetId)) throw new Error('The independent image identity conflicts with an original document.');
    photos[targetId] = { ...structuredClone(photo), id: targetId, originalPath: null };
    aliases.set(key, targetId); photoCopies.push({ sourceId: photo.id, sourceVersion: photo.version, targetId });
  }
  for (const node of graph.nodes.values()) {
    const reference = readRoomImagePluginData(node.pluginData);
    if (!reference) continue;
    const binding = scope && findRoomImageBinding(bindings, scope.serverUrl, scope.documentId, reference);
    if (!binding) throw new Error('Download the original shared image revision before making an independent copy.');
    const targetId = aliases.get(JSON.stringify([binding.photo.id, binding.photo.version]))!;
    graph.updateNode(node.id, { pluginData: [...node.pluginData.filter(item => !(item.pluginId === 'orion.xdesign' && ['roomImage', 'photoDocumentId'].includes(item.key))), { pluginId: 'orion.xdesign', key: 'photoDocumentId', value: targetId }] });
    pencil.photoLinks[node.id] = targetId;
  }
  document.photoDocuments = photos; pencil.graph = serializeGraph(graph);
  delete pencil.shared; delete pencil.roomImages; validatePencilDocument(pencil);
  return { document, photoCopies };
}
