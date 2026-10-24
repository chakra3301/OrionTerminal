import { expect, it } from 'vitest';
import { SceneGraph, computeImageHash } from '@open-pencil/scene-graph';
import { serializeGraph, validatePencilDocument, type PencilDocument } from './document';
import { SharedDesign } from './sharedDesign';
import { encodeSharedCheckpoint, restoreSharedDesign } from './sharedCheckpoint';
import { prepareLibrarySource } from './libraryResources';
import { assertRoomImageResources, readRoomImageReference, readRoomImagePluginData, roomImagePluginData, roomImagePlacements, type RoomImageReference } from './roomImageReferences';

function fixture() {
  const graph = new SceneGraph(), page = graph.getPages()[0]!.id, bytes = new Uint8Array([137, 80, 78, 71, 0, 255, 128]);
  const reference: RoomImageReference = { version: 1, imageId: 'shared_image_0001', revisionId: 'a'.repeat(64), previewHash: computeImageHash(bytes) };
  graph.images.set(reference.previewHash, bytes);
  const node = graph.createNode('RECTANGLE', page, { width: 80, height: 40, pluginData: [roomImagePluginData(reference)] });
  return { graph, page, node, bytes, reference };
}
it('preserves room references, preview bytes, foreign metadata and geometry through actual shared document reopening', () => {
  const f = fixture(), foreign = { pluginId: 'retained.plugin', key: 'original', value: 'Original 🙂' };
  f.graph.updateNode(f.node.id, { x: 123, pluginData: [foreign, roomImagePluginData(f.reference)] });
  const original = serializeGraph(f.graph), replica = SharedDesign.fromGraph(f.graph);
  try {
    const doc: PencilDocument = { formatVersion: 1, graph: serializeGraph(replica.graph), pageId: f.page, panX: 4, panY: 8, zoom: 1.25, photoLinks: {}, shared: encodeSharedCheckpoint('shared_document_001', replica.update()) };
    validatePencilDocument(doc); const restored = restoreSharedDesign(JSON.parse(JSON.stringify(doc)));
    try {
      expect(roomImagePlacements(restored.graph)).toEqual([{ nodeId: f.node.id, reference: f.reference }]);
      expect(restored.graph.images.get(f.reference.previewHash)).toEqual(f.bytes);
      expect(restored.graph.getNode(f.node.id)!.pluginData).toEqual([foreign, roomImagePluginData(f.reference)]);
      expect(restored.graph.getNode(f.node.id)!.x).toBe(123);
    } finally { restored.dispose(); }
    expect(serializeGraph(f.graph)).toBe(original);
  } finally { replica.dispose(); }
});
it('checks each immutable reference once while retaining repeated placements and historic revisions', () => {
  const f = fixture(), prior = { ...f.reference, revisionId: 'b'.repeat(64) };
  f.graph.createNode('RECTANGLE', f.page, { pluginData: [roomImagePluginData(f.reference)] });
  f.graph.createNode('RECTANGLE', f.page, { pluginData: [roomImagePluginData(prior)] });
  const checked: RoomImageReference[] = []; assertRoomImageResources(f.graph, (reference, bytes) => { checked.push(reference); expect(bytes).toEqual(f.bytes); });
  expect(roomImagePlacements(f.graph)).toHaveLength(3); expect(checked).toEqual([f.reference, prior]);
});
it('refuses unknown fields, versions, unsafe identities and noncanonical digest formats without changing inputs', () => {
  const { reference } = fixture();
  for (const patch of [{ token: 'private' }, { version: 2 }, { imageId: '../foreign' }, { imageId: 'too-short' }, { imageId: 'x'.repeat(129) }, { revisionId: 'A'.repeat(64) }, { previewHash: 'F'.repeat(40) }, { previewHash: 'a'.repeat(64) }]) {
    const value = { ...reference, ...patch }, original = JSON.stringify(value);
    expect(() => readRoomImageReference(value)).toThrow(); expect(JSON.stringify(value)).toBe(original);
  }
  expect(() => readRoomImageReference(null)).toThrow();
});
it('rejects duplicate, conflicting and aliased reserved plugin metadata while preserving legacy local markers', () => {
  const { reference } = fixture(), entry = roomImagePluginData(reference), legacy = { pluginId: 'orion.xdesign', key: 'photoDocumentId', value: '01ARZ3NDEKTSV4RRFFQ69G5FAV' };
  expect(readRoomImagePluginData([legacy])).toBeNull();
  for (const entries of [[entry, entry], [entry, legacy], [{ ...entry, token: 'private' }], [{ ...entry, value: ' ' + entry.value }], [{ ...entry, value: JSON.stringify({ imageId: reference.imageId, version: 1, revisionId: reference.revisionId, previewHash: reference.previewHash }) }], [{ ...entry, value: entry.value.replace('"version":1', '"version":2,"version":1') }]]) {
    const original = JSON.stringify(entries); expect(() => readRoomImagePluginData(entries)).toThrow(); expect(JSON.stringify(entries)).toBe(original);
  }
});
it('rejects missing, empty or altered preview resources before document admission', () => {
  const f = fixture();
  for (const bytes of [undefined, new Uint8Array(), new Uint8Array([9, 8, 7])]) {
    if (bytes) f.graph.images.set(f.reference.previewHash, bytes); else f.graph.images.delete(f.reference.previewHash);
    const doc: PencilDocument = { formatVersion: 1, graph: serializeGraph(f.graph), pageId: f.page, panX: 0, panY: 0, zoom: 1, photoLinks: {} }, original = JSON.stringify(doc);
    expect(() => validatePencilDocument(doc)).toThrow('preview'); expect(JSON.stringify(doc)).toBe(original);
  }
});
it('refuses references attached to the root or a page', () => {
  for (const kind of ['root', 'page']) {
    const f = fixture(); f.graph.updateNode(kind === 'root' ? f.graph.rootId : f.page, { pluginData: [roomImagePluginData(f.reference)] });
    expect(() => roomImagePlacements(f.graph)).toThrow('artwork layer');
  }
});
it('caps distinct image identities while accepting repeated placements', () => {
  const f = fixture();
  for (let i = 1; i < 256; i++) f.graph.createNode('RECTANGLE', f.page, { pluginData: [roomImagePluginData({ ...f.reference, imageId: 'shared_image_' + String(i).padStart(4, '0') + '_extra' })] });
  expect(roomImagePlacements(f.graph)).toHaveLength(256);
  f.graph.createNode('RECTANGLE', f.page, { pluginData: [roomImagePluginData(f.reference)] }); expect(roomImagePlacements(f.graph)).toHaveLength(257);
  f.graph.createNode('RECTANGLE', f.page, { pluginData: [roomImagePluginData({ ...f.reference, imageId: 'shared_image_over_limit' })] });
  expect(() => roomImagePlacements(f.graph)).toThrow('limit');
});
it('caps distinct historical revisions without limiting a repeated revision', () => {
  const f = fixture();
  for (let i = 0; i < 499; i++) f.graph.createNode('RECTANGLE', f.page, { pluginData: [roomImagePluginData({ ...f.reference, revisionId: i.toString(16).padStart(64, '0') })] });
  expect(roomImagePlacements(f.graph)).toHaveLength(500);
  f.graph.createNode('RECTANGLE', f.page, { pluginData: [roomImagePluginData(f.reference)] }); expect(roomImagePlacements(f.graph)).toHaveLength(501);
  f.graph.createNode('RECTANGLE', f.page, { pluginData: [roomImagePluginData({ ...f.reference, revisionId: 'f'.repeat(64) })] });
  expect(() => roomImagePlacements(f.graph)).toThrow('limit');
});
it('keeps a shared native image intact when full-resolution library resolution is unavailable', async () => {
  const f = fixture(), component = f.graph.createNode('COMPONENT', f.page, { name: 'Original component', componentKey: 'card' });
  f.graph.reparentNode(f.node.id, component.id); const original = serializeGraph(f.graph);
  await expect(prepareLibrarySource(f.graph, 'room-library', [component.id])).rejects.toThrow('full resolution');
  expect(serializeGraph(f.graph)).toBe(original);
});
