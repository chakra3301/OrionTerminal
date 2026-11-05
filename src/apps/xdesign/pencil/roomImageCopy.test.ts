import { expect, it } from 'vitest';
import { SceneGraph, computeImageHash } from '@open-pencil/scene-graph';
import { ulid } from 'ulid';
import { independentRoomImageCopy } from './roomImageCopy';
import { deserializeGraph, serializeGraph, type PencilDocument } from './document';
import { emptyDoc } from '../projectsStore';
import { roomImagePluginData } from './roomImageReferences';
import { SharedDesign } from './sharedDesign';
import { encodeSharedCheckpoint, restoreSharedDesign } from './sharedCheckpoint';
import type { PhotoDocument } from '../photo/types';
const scope = { serverUrl: 'https://rooms.example.test/', documentId: 'image_room_identity_001' };
function fixture() {
  const graph = new SceneGraph(), preview = new Uint8Array([1, 2, 3]); graph.images.set(computeImageHash(preview), preview);
  const reference = { version: 1 as const, imageId: 'editable_image_identity_001', revisionId: 'a'.repeat(64), previewHash: computeImageHash(preview) };
  const photo: PhotoDocument = { id: ulid(), version: ulid(), name: 'Accepted original', width: 32, height: 24, previewWidth: 32, previewHeight: 24, bundlePath: '/accepted.pcraft', previewPath: '/accepted.png', originalPath: null };
  photo.bundlePath = `/accepted/${photo.id}/${photo.version}.pcraft`; photo.previewPath = `/accepted/${photo.id}/${photo.version}.png`;
  const a = graph.createNode('RECTANGLE', graph.getPages()[0]!.id, { x: 18, width: 150, pluginData: [{ pluginId: 'foreign', key: 'attribution', value: 'Original author' }, roomImagePluginData(reference)] });
  const b = graph.createNode('RECTANGLE', graph.getPages()[0]!.id, { pluginData: [roomImagePluginData(reference)] });
  const replica = SharedDesign.fromGraph(graph); const document = emptyDoc();
  const draftVersion = ulid(); document.photoDocuments = { [photo.id]: { ...photo, version: draftVersion, name: 'Unpublished draft', bundlePath: `/draft/${photo.id}/${draftVersion}.pcraft`, previewPath: `/draft/${photo.id}/${draftVersion}.png` } };
  document.pencilDocument = { formatVersion: 1, graph: serializeGraph(graph), pageId: graph.getPages()[0]!.id, panX: 0, panY: 0, zoom: 1, photoLinks: {}, shared: encodeSharedCheckpoint(scope.documentId, replica.update()), roomImages: { version: 1, bindings: [{ ...scope, reference, photo }] } }; replica.dispose();
  return { document, photo, reference, a, b };
}
it('detaches repeated accepted placements from the original room without replacing unpublished native drafts or source metadata', () => {
  const f = fixture(), before = structuredClone(f.document), result = independentRoomImageCopy(f.document, scope), pencil = result.document.pencilDocument!, graph = deserializeGraph(pencil.graph), id = pencil.photoLinks[f.a.id]!;
  expect(result.photoCopies).toEqual([{ sourceId: f.photo.id, sourceVersion: f.photo.version, targetId: id }]); expect(id).not.toBe(f.photo.id); expect(pencil.photoLinks[f.b.id]).toBe(id);
  expect(result.document.photoDocuments![id]).toMatchObject({ id, version: f.photo.version, originalPath: null }); expect(result.document.photoDocuments![f.photo.id]).toEqual(before.photoDocuments![f.photo.id]); expect(f.document).toEqual(before);
  expect(pencil.shared).toBeUndefined(); expect(pencil.roomImages).toBeUndefined(); expect(pencil.graph).not.toContain('roomImage'); expect(graph.getNode(f.a.id)).toMatchObject({ x: 18, width: 150, pluginData: expect.arrayContaining([{ pluginId: 'foreign', key: 'attribution', value: 'Original author' }]) });
  const replica = SharedDesign.fromGraph(graph), fresh: PencilDocument = { ...pencil, graph: serializeGraph(replica.graph), shared: encodeSharedCheckpoint('fresh_room_identity_001', replica.update()) };
  try { const restored = restoreSharedDesign(fresh); try { expect(serializeGraph(restored.graph)).not.toContain(f.reference.imageId); } finally { restored.dispose(); } } finally { replica.dispose(); }
});
it('preserves historic and unplaced accepted versions as independent native resources', () => {
  const f = fixture(), oldVersion = ulid(), old = { ...f.photo, version: oldVersion, bundlePath: `/accepted/${f.photo.id}/${oldVersion}.pcraft`, previewPath: `/accepted/${f.photo.id}/${oldVersion}.png` }; f.document.pencilDocument!.roomImages!.bindings.push({ ...scope, reference: { ...f.reference, revisionId: 'b'.repeat(64) }, photo: old });
  const result = independentRoomImageCopy(f.document, scope); expect(result.photoCopies).toHaveLength(2); expect(result.photoCopies.map(copy => copy.sourceVersion)).toEqual([f.photo.version, old.version]); expect(new Set(result.photoCopies.map(copy => copy.targetId)).size).toBe(2); expect(Object.keys(result.document.photoDocuments!)).toHaveLength(3);
});
it('refuses missing or foreign mappings and identity collisions without mutating the original', () => {
  const f = fixture(), before = structuredClone(f.document);
  expect(() => independentRoomImageCopy(f.document, null)).toThrow('Download'); expect(() => independentRoomImageCopy(f.document, { ...scope, documentId: 'another_room_identity_001' })).toThrow('Download'); expect(() => independentRoomImageCopy(f.document, scope, () => f.photo.id)).toThrow('conflicts'); expect(f.document).toEqual(before);
});
