import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ulid } from 'ulid';
import { SceneGraph, computeImageHash, type Fill } from '@open-pencil/scene-graph';
import { createLibraryRevision, contentHash } from '@open-pencil/core/library';
import { prepareRoomLibraryBundle, validateRoomLibraryBundle, readRoomLibraryPublish, readRoomLibraryRead, readRoomLibraryCatalog, readRoomLibraryPublication, readRoomLibraryRevision, type RoomLibrarySummary } from './roomLibraryProtocol';
import { roomImagePluginData } from './roomImageReferences';

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

async function fixture() {
  const graph = new SceneGraph(), page = graph.getPages()[0]!.id;
  const component = graph.createNode('COMPONENT', page, { name: 'Button 🙂', componentKey: 'button:main', width: 100, height: 40 });
  graph.createNode('TEXT', component.id, { text: 'Original 🙂', name: 'Label', width: 80, height: 20 });
  const revision = await createLibraryRevision({ libraryId: 'library:original', name: 'Original library 🙂', graph, assetNodeIds: [component.id], publishedAt: '2026-10-11T12:00:00.000Z' });
  revision.manifest.assets[0]!.thumbnail = new Uint8Array([0, 1, 2, 255]);
  const bundle = await prepareRoomLibraryBundle(revision), digest = await contentHash(bundle);
  const actor = { id: ulid(), name: 'Designer', role: 'editor' as const }, documentId = ulid(), requestId = ulid();
  const publication: RoomLibrarySummary = { libraryId: bundle.manifest.libraryId, revisionId: bundle.manifest.revisionId, previousRevisionId: null, name: bundle.manifest.name, description: bundle.manifest.description, publishedAt: bundle.manifest.publishedAt, assetCount: 1, ownerId: actor.id, publisher: { id: actor.id, name: actor.name }, step: 1, bundleDigest: digest };
  return { bundle, revision, actor, documentId, requestId, publication, expected: { libraryId: publication.libraryId, revisionId: publication.revisionId, bundleDigest: digest } };
}
it('refuses room image references in a portable library without flattening or removing the original marker', async () => {
  const f = await fixture(), root = f.revision.graph.getNode(f.revision.manifest.assets[0]!.sourceNodeId)!;
  const marker = roomImagePluginData({ version: 1, imageId: 'shared_image_0001', revisionId: 'a'.repeat(64), previewHash: 'b'.repeat(40) });
  f.revision.graph.updateNode(root.id, { pluginData: [marker] });
  await expect(prepareRoomLibraryBundle(f.revision)).rejects.toThrow('portable');
  expect(f.revision.graph.getNode(root.id)!.pluginData).toEqual([marker]);
});
it('carries an actual immutable library graph and thumbnail without changing original metadata', async () => {
  const f = await fixture(), decoded = await validateRoomLibraryBundle(f.bundle);
  expect(decoded.revision.manifest).toEqual(f.revision.manifest); expect(decoded.revision.graph.getNode(f.revision.manifest.assets[0]!.sourceNodeId)!.name).toBe('Button 🙂');
  expect(decoded.bundleDigest).toBe(f.expected.bundleDigest); expect(readRoomLibraryPublish({ version: 1, requestId: f.requestId, bundle: f.bundle }).bundle).toEqual(f.bundle);
  expect(readRoomLibraryRead({ version: 1, libraryId: 'library:original', revisionId: null })).toEqual({ version: 1, libraryId: 'library:original', revisionId: null });
});
it('rejects altered graph bytes, asset content, missing resource dependencies and unknown fields', async () => {
  const f = await fixture(); await expect(validateRoomLibraryBundle({ ...f.bundle, checksum: '0'.repeat(64) })).rejects.toThrow('integrity');
  const changed = structuredClone(f.bundle); changed.manifest.assets[0]!.contentHash = '0'.repeat(64); await expect(validateRoomLibraryBundle(changed)).rejects.toThrow('hash');
  await expect(validateRoomLibraryBundle({ ...f.bundle, credentials: 'foreign' })).rejects.toThrow('fields');
  expect(() => readRoomLibraryPublish({ version: 2, requestId: f.requestId, bundle: f.bundle })).toThrow(); expect(() => readRoomLibraryRead({ version: 1, libraryId: '../foreign', revisionId: null })).toThrow();
  const duplicate = structuredClone(f.bundle); duplicate.manifest.assets.push(duplicate.manifest.assets[0]!); await expect(validateRoomLibraryBundle(duplicate)).rejects.toThrow('Duplicate');
  const original = f.revision.graph.getNode(f.revision.manifest.assets[0]!.sourceNodeId)!; f.revision.graph.updateNode(original.id, { pluginData: [{ pluginId: 'orion.xdesign', key: 'photoDocumentId', value: ulid() }] }); await expect(prepareRoomLibraryBundle(f.revision)).rejects.toThrow('portable');
});
it('checks document/request/revision scope and immutable publication digests without replaying a superseded head', async () => {
  const f = await fixture(), response = { version: 1, documentId: f.documentId, actor: f.actor, requestId: f.requestId, publication: f.publication, current: { ...f.publication, revisionId: 'f'.repeat(64), previousRevisionId: f.publication.revisionId, step: 2 } };
  const receipt = readRoomLibraryPublication(response, f.documentId, f.requestId, f.expected); expect(receipt.current.step).toBe(2); expect(receipt.publication.step).toBe(1);
  for (const change of [{ documentId: ulid() }, { requestId: ulid() }, { publication: { ...f.publication, bundleDigest: '0'.repeat(64) } }, { current: { ...f.publication, ownerId: ulid() } }, { current: { ...f.publication, step: 1, name: 'Changed' } }]) expect(() => readRoomLibraryPublication({ ...response, ...change }, f.documentId, f.requestId, f.expected)).toThrow();
  const packet = { version: 1, documentId: f.documentId, actor: f.actor, publication: f.publication, bundle: f.bundle };
  expect((await readRoomLibraryRevision(packet, f.documentId, f.publication.libraryId, f.publication.revisionId)).revision.manifest.name).toBe('Original library 🙂');
  await expect(readRoomLibraryRevision(packet, f.documentId, f.publication.libraryId, '0'.repeat(64))).rejects.toThrow(); await expect(readRoomLibraryRevision({ ...packet, publication: { ...f.publication, name: 'Foreign' } }, f.documentId, f.publication.libraryId, null)).rejects.toThrow('differs');
});
it('keeps member-visible catalogs strict and scoped without exposing duplicate identities or secret fields', async () => {
  const f = await fixture(), response = { version: 1, documentId: f.documentId, actor: { ...f.actor, role: 'viewer' }, libraries: [f.publication] };
  expect(readRoomLibraryCatalog(response, f.documentId).actor.role).toBe('viewer'); expect(() => readRoomLibraryCatalog({ ...response, libraries: [f.publication, f.publication] }, f.documentId)).toThrow('Duplicate');
  expect(() => readRoomLibraryCatalog({ ...response, libraries: [{ ...f.publication, secret: 'foreign' }] }, f.documentId)).toThrow(); expect(() => readRoomLibraryCatalog(response, ulid())).toThrow('another room');
});
it('preserves image bytes, nested component references and aliased variable modes through the wire graph', async () => {
  const graph = new SceneGraph(), page = graph.getPages()[0]!.id;
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), imageHash = computeImageHash(bytes);
  graph.images.set(imageHash, bytes);
  const paint: Fill = { type: 'IMAGE', imageHash, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true };
  const component = graph.createNode('COMPONENT', page, { name: 'Card', componentKey: 'card', fills: [paint] });
  const icon = graph.createNode('COMPONENT', page, { name: 'Icon', componentKey: 'icon' });
  graph.createNode('ELLIPSE', icon.id, { width: 16, height: 16 }); graph.createInstance(icon.id, component.id);
  const collection = graph.createCollection('Theme'), dark = ulid(); graph.addMode(collection.id, dark, 'Dark');
  const color = graph.createVariable('Color', 'COLOR', collection.id, { r: .2, g: 0, b: 0, a: 1 });
  const alias = graph.createVariable('Alias', 'COLOR', collection.id, { aliasId: color.id });
  color.valuesByMode[dark] = { r: .8, g: 0, b: 0, a: 1 }; alias.valuesByMode[dark] = { aliasId: color.id };
  graph.bindVariable(component.id, 'fills/0/color', alias.id); graph.updateNode(component.id, { variableModes: { [collection.id]: dark } });
  const revision = await createLibraryRevision({ libraryId: 'resources', name: 'Resources', graph, assetNodeIds: [component.id] });
  revision.graph.variables = structuredClone(graph.variables); revision.graph.variableCollections = structuredClone(graph.variableCollections); revision.graph.activeMode = structuredClone(graph.activeMode);
  const decoded = await validateRoomLibraryBundle(await prepareRoomLibraryBundle(revision)), root = decoded.revision.graph.getNode(decoded.revision.manifest.assets[0]!.sourceNodeId)!;
  expect(decoded.revision.graph.images.get(imageHash)).toEqual(bytes);
  expect(decoded.revision.graph.resolveColorVariableForNode(root.id, alias.id)?.r).toBe(.8);
  const instance = decoded.revision.graph.getChildren(root.id).find(node => node.type === 'INSTANCE')!;
  expect(decoded.revision.graph.getNode(instance.componentId!)?.name).toBe('Icon');
  revision.graph.images.delete(imageHash); await expect(prepareRoomLibraryBundle(revision)).rejects.toThrow('missing image');
});
it('refuses unresolved geometry images without changing the original library', async () => {
  const f = await fixture(), root = f.revision.graph.getNode(f.revision.manifest.assets[0]!.sourceNodeId)!;
  const geometry = { windingRule: 'NONZERO' as const, commandsBlob: new Uint8Array(), fills: [{ type: 'IMAGE' as const, imageHash: 'missing', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }] };
  for (const field of ['fillGeometry', 'strokeGeometry'] as const) {
    f.revision.graph.updateNode(root.id, { [field]: [geometry] });
    await expect(prepareRoomLibraryBundle(f.revision)).rejects.toThrow('missing image');
    expect(f.revision.graph.getNode(root.id)![field]).toEqual([geometry]); f.revision.graph.updateNode(root.id, { [field]: [] });
  }
});
