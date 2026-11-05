import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ulid } from 'ulid';
import type { PhotoDocument } from '../photo/types';
import { SceneGraph } from '@open-pencil/scene-graph';
import { addRoomImageBinding, findRoomImageBinding, readRoomImageBindings } from './roomImageBindings';
import { roomImageForNode, roomImageImportedBinding, roomImagePublicationPlan } from './roomImageCanvas';
import { imageFixture, imageActor, imageOrigin, imageDocument } from './roomImages.testSupport';
import { createRoomImageManifest, type RoomImageManifest, type RoomImageUpload } from './roomImageProtocol';
import { roomImagePluginData } from './roomImageReferences';
import { deserializeGraph, serializeGraph, validatePencilDocument } from './document';
import { emptyDoc, validateDesignDoc } from '../projectsStore';
const scope = { serverUrl: imageOrigin, documentId: imageDocument }, empty = () => readRoomImageBindings(undefined);
function nextVersion(photo: PhotoDocument): PhotoDocument {
  const version = ulid(); return { ...photo, version, bundlePath: photo.bundlePath.replace(`${photo.version}.pcraft`, `${version}.pcraft`), previewPath: photo.previewPath.replace(`${photo.version}.png`, `${version}.png`) };
}
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
function publication(manifest: RoomImageManifest): RoomImageUpload {
  const summary = { manifest, ownerId: imageActor.id, publisher: { id: imageActor.id, name: imageActor.name }, step: 1, publishedAt: '2026-10-12T12:00:00.000Z' };
  return { version: 1, documentId: imageDocument, actor: imageActor, requestId: 'original_transfer_identity_001', state: 'published', manifest, received: manifest.chunkDigests.map((_, index) => index), publication: summary, current: summary };
}
it('retains immutable local mappings across reopen, scoped origins, rooms and remote placement revisions', async () => {
  const f = await imageFixture(), binding = { ...scope, reference: f.reference, photo: f.source }, local = addRoomImageBinding(empty(), binding), graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0]!.id, { pluginData: [roomImagePluginData(f.reference)] });
  expect(roomImageForNode(graph, node.id, readRoomImageBindings(JSON.parse(JSON.stringify(local))), scope)).toEqual(binding);
  expect(findRoomImageBinding(local, 'https://other.example.test/', imageDocument, f.reference)).toBeNull();
  expect(findRoomImageBinding(local, imageOrigin, 'other_room_identity_001', f.reference)).toBeNull();
  graph.updateNode(node.id, { pluginData: [roomImagePluginData({ ...f.reference, revisionId: 'b'.repeat(64) })] });
  expect(roomImageForNode(graph, node.id, local, scope)).toBeNull();
  expect(addRoomImageBinding(local, binding)).toEqual(local);
  expect(() => addRoomImageBinding(local, { ...binding, photo: { ...f.source, id: ulid() } })).toThrow('preserved');
});
it('refuses malformed, duplicate, aliased and conflicting native mappings before replacing saved data', async () => {
  const f = await imageFixture(), binding = { ...scope, reference: f.reference, photo: f.source };
  for (const value of [null, { version: 2, bindings: [] }, { version: 1, bindings: [], extra: true }, { version: 1, bindings: [binding, binding] }, { version: 1, bindings: [{ ...binding, serverUrl: imageOrigin.slice(0, -1) }] }, { version: 1, bindings: [{ ...binding, photo: { ...f.source, pixels: [] } }] }]) expect(() => readRoomImageBindings(value)).toThrow();
  const local = addRoomImageBinding(empty(), binding);
  expect(() => addRoomImageBinding(local, { ...binding, reference: { ...f.reference, revisionId: 'b'.repeat(64) }, photo: { ...f.source, name: 'Different same version' } })).toThrow('Conflicting');
});
it('keeps mappings outside shared graph metadata and accepts local working versions without changing the saved revision', async () => {
  const f = await imageFixture(), graph = new SceneGraph(), pageId = graph.getPages()[0]!.id;
  graph.images.set(f.reference.previewHash, f.preview); graph.createNode('RECTANGLE', pageId, { pluginData: [roomImagePluginData(f.reference)] });
  const doc = { formatVersion: 1 as const, graph: serializeGraph(graph), pageId, panX: 0, panY: 0, zoom: 1, photoLinks: {}, roomImages: addRoomImageBinding(empty(), { ...scope, reference: f.reference, photo: f.source }) };
  validatePencilDocument(doc); expect(doc.graph).not.toContain(f.source.bundlePath); expect(serializeGraph(deserializeGraph(doc.graph))).toBe(doc.graph);
  validateDesignDoc({ ...emptyDoc(), pencilDocument: doc, photoDocuments: { [f.source.id]: nextVersion(f.source) } });
  expect(() => validateDesignDoc({ ...emptyDoc(), pencilDocument: doc, photoDocuments: {} })).toThrow('missing');
});
it('publishes every original local placement while preserving geometry, foreign metadata and independent images', async () => {
  const f = await imageFixture(), graph = new SceneGraph(), page = graph.getPages()[0]!.id;
  const fill = { type: 'IMAGE' as const, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: .5, visible: true, imageHash: 'old', imageScaleMode: 'FIT' as const };
  const node = graph.createNode('RECTANGLE', page, { x: 77, width: 231, fills: [fill], pluginData: [{ pluginId: 'foreign', key: 'metadata', value: 'keep' }, { pluginId: 'orion.xdesign', key: 'photoDocumentId', value: f.source.id }] });
  const copy = graph.createNode('RECTANGLE', page, { fills: [fill], pluginData: node.pluginData });
  const unrelated = graph.createNode('RECTANGLE', page, { fills: [fill], pluginData: [{ pluginId: 'orion.xdesign', key: 'photoDocumentId', value: ulid() }] });
  const before = serializeGraph(graph), plan = await roomImagePublicationPlan(graph, empty(), scope, { kind: 'published', source: f.source, publication: publication(f.manifest) }, f.preview);
  expect(serializeGraph(graph)).toBe(before); expect(plan.patches.map(patch => patch.nodeId)).toEqual([node.id, copy.id]);
  for (const { nodeId, before: _before, ...patch } of plan.patches) graph.updateNode(nodeId, patch);
  expect(graph.getNode(node.id)).toMatchObject({ x: 77, width: 231, fills: [{ ...fill, imageHash: f.reference.previewHash }] });
  expect(graph.getNode(node.id)!.pluginData).toEqual([{ pluginId: 'foreign', key: 'metadata', value: 'keep' }, roomImagePluginData(f.reference)]);
  expect(graph.getNode(unrelated.id)!.pluginData[0]!.value).not.toBe(f.source.id);
  expect((await roomImagePublicationPlan(graph, plan.bindings, scope, { kind: 'published', source: f.source, publication: publication(f.manifest) }, f.preview)).patches).toEqual([]);
});
it('updates only the exact previous pin and preserves other historic revisions, unplaced receipts and independent native edits', async () => {
  const f = await imageFixture(), graph = new SceneGraph(), page = graph.getPages()[0]!.id, local = addRoomImageBinding(empty(), { ...scope, reference: f.reference, photo: f.source });
  const original = graph.createNode('RECTANGLE', page, { pluginData: [roomImagePluginData(f.reference)] });
  const historic = graph.createNode('RECTANGLE', page, { pluginData: [roomImagePluginData({ ...f.reference, revisionId: 'b'.repeat(64) })] });
  const successor = await createRoomImageManifest({ ...f.manifest, previousRevisionId: f.manifest.revisionId, name: 'Edited image' });
  const source = { ...nextVersion(f.source), name: successor.name }, result = { kind: 'published' as const, source, publication: publication(successor) };
  const plan = await roomImagePublicationPlan(graph, local, scope, result, f.preview);
  expect(plan.patches.map(patch => patch.nodeId)).toEqual([original.id]); expect(plan.bindings.bindings).toHaveLength(2); expect(graph.getNode(historic.id)!.pluginData).toEqual([roomImagePluginData({ ...f.reference, revisionId: 'b'.repeat(64) })]);
  graph.deleteNode(original.id); expect((await roomImagePublicationPlan(graph, local, scope, result, f.preview)).patches).toHaveLength(0);
});
it('refuses unaccepted receipts, foreign rooms and preview/source mismatches without touching artwork', async () => {
  const f = await imageFixture(), graph = new SceneGraph(), before = serializeGraph(graph), accepted = publication(f.manifest);
  for (const result of [{ kind: 'published' as const, source: f.source, publication: { ...accepted, state: 'pending' as const, publication: null, current: null } }, { kind: 'published' as const, source: { ...f.source, width: 23 }, publication: accepted }, { kind: 'published' as const, source: f.source, publication: { ...accepted, documentId: 'foreign_room_identity_001' } }]) await expect(roomImagePublicationPlan(graph, empty(), scope, result, f.preview)).rejects.toThrow();
  await expect(roomImagePublicationPlan(graph, empty(), scope, { kind: 'published', source: f.source, publication: accepted }, new Uint8Array([1, 2, 3]))).rejects.toThrow('preview');
  expect(serializeGraph(graph)).toBe(before);
});
it('installs original imported native identities idempotently and refuses mismatched manifests', async () => {
  const f = await imageFixture(), result = { kind: 'imported' as const, reference: f.reference, manifest: f.manifest, photo: f.source }, plan = roomImageImportedBinding(empty(), scope, result);
  expect(roomImageImportedBinding(plan.bindings, scope, result)).toEqual(plan);
  expect(() => roomImageImportedBinding(empty(), scope, { ...result, reference: { ...f.reference, revisionId: 'b'.repeat(64) } })).toThrow('differs');
  expect(() => roomImageImportedBinding(empty(), scope, { ...result, photo: { ...f.source, name: 'Wrong original' } })).toThrow('differs');
});
