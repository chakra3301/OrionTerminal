import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ulid } from 'ulid';
import { SceneGraph, computeImageHash, setInstanceOverride } from '@open-pencil/scene-graph';
import { contentHash, validateLibraryRevision } from '@open-pencil/core/library';
import { RoomLibraryCache, ROOM_LIBRARY_CACHE_REVISIONS, type CachedRoomRevision, type RoomLibraryCacheStorage } from './roomLibraryCache';
import { roomLibraryIdentity, scopeRoomLibraryRevision, type RoomLibraryScope } from './roomLibraryIdentity';
import { prepareRoomLibraryBundle, validateRoomLibraryBundle } from './roomLibraryProtocol';
import { serializeGraph, deserializeGraph } from './graphDocument';
import { prepareLibrarySource, installLibraryResources } from './libraryResources';
import { createPublicationRevision, materializePublicationAsset } from './libraryDependencies';
import { normalizeLibraryNestedInstances, swapLibraryInstance } from './libraryOverrides';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (value: string) => value }));
vi.mock('@/lib/db', () => ({ getAppState: vi.fn(), compareAndSetXDesignRoomLibraries: vi.fn() }));
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const scope: RoomLibraryScope = { serverUrl: 'https://rooms.example.test/', documentId: 'library_document_001' };
const other: RoomLibraryScope = { ...scope, documentId: 'library_document_002' };
function storage() {
  let value: unknown = null, fail = false, writes = 0;
  const adapter: RoomLibraryCacheStorage = { read: async () => structuredClone(value), write: async (next, expected) => {
    if (fail) throw new Error('Injected cache failure');
    if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Cache changed in another window');
    value = structuredClone(next); writes++;
  } };
  return { cache: new RoomLibraryCache(adapter), reopen: () => new RoomLibraryCache(adapter), get value() { return value; }, set value(next: unknown) { value = next; }, set fail(next: boolean) { fail = next; }, get writes() { return writes; } };
}
async function fixture(previous: CachedRoomRevision | null = null, width = 100, geometryImages = false): Promise<CachedRoomRevision> {
  const graph = new SceneGraph(), page = graph.getPages()[0]!.id, libraryId = 'library:original';
  const component = graph.createNode('COMPONENT', page, { name: 'Card', width, height: 40 });
  graph.createNode('TEXT', component.id, { name: 'Label', text: 'Original 🙂', width: 80, height: 20 });
  const icon = graph.createNode('COMPONENT', page, { name: 'Icon', width: 16, height: 16 }), alternate = graph.createNode('COMPONENT', page, { name: 'Alternate' });
  graph.createNode('ELLIPSE', icon.id, { width: 16, height: 16 }); graph.createNode('RECTANGLE', alternate.id, { width: 16, height: 16 }); graph.createInstance(icon.id, component.id);
  graph.updateNode(component.id, { componentPropertyDefinitions: [{ id: 'icon-property', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: icon.id, preferredValues: [icon.id, alternate.id] }] });
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), imageHash = computeImageHash(bytes); graph.images.set(imageHash, bytes);
  graph.updateNode(component.id, { fills: [{ type: 'IMAGE', imageHash, color: { r: .2, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }] });
  if (geometryImages) {
    const geometryBytes = new Uint8Array([1, 2, 3, 4]), geometryHash = computeImageHash(geometryBytes); graph.images.set(geometryHash, geometryBytes);
    const geometry = { windingRule: 'NONZERO' as const, commandsBlob: new Uint8Array(), fills: [{ type: 'IMAGE' as const, imageHash: geometryHash, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }] };
    graph.updateNode(component.id, { fillGeometry: [geometry], strokeGeometry: [geometry] });
  }
  const collection = graph.createCollection('Theme'), dark = ulid(); graph.addMode(collection.id, dark, 'Dark');
  const base = graph.createVariable('Color', 'COLOR', collection.id, { r: .2, g: 0, b: 0, a: 1 }), alias = graph.createVariable('Alias', 'COLOR', collection.id, { aliasId: base.id });
  base.valuesByMode[dark] = { r: .8, g: 0, b: 0, a: 1 }; alias.valuesByMode[dark] = { aliasId: base.id };
  graph.bindVariable(component.id, 'fills/0/color', alias.id); graph.updateNode(page, { variableModes: { [collection.id]: dark } });
  const prepared = await prepareLibrarySource(graph, libraryId, [component.id]);
  const revision = await createPublicationRevision({ libraryId, name: 'Original library 🙂', graph: prepared.graph, assetNodeIds: [component.id], previousRevisionId: previous?.publication.revisionId ?? null, publishedAt: '2026-10-11T12:00:00.000Z' });
  revision.graph.variables = prepared.graph.variables; revision.graph.variableCollections = prepared.graph.variableCollections; revision.graph.activeMode = prepared.graph.activeMode;
  for (const [hash, image] of prepared.graph.images) revision.graph.images.set(hash, new Uint8Array(image));
  revision.manifest.assets[0]!.thumbnail = new Uint8Array([0, 1, 2, 255]);
  const bundle = await prepareRoomLibraryBundle(revision), manifest = bundle.manifest;
  return { bundle, publication: { libraryId, revisionId: manifest.revisionId, previousRevisionId: manifest.previousRevisionId, name: manifest.name, description: manifest.description, publishedAt: manifest.publishedAt, assetCount: manifest.assets.length,
    ownerId: 'owner_identity_0001', publisher: { id: 'owner_identity_0001', name: 'Designer 🙂' }, step: (previous?.publication.step ?? 0) + 1, bundleDigest: await contentHash(bundle) } };
}
it('keeps exact original revisions and deterministic SDK-valid scoped identities across cache reopening', async () => {
  const f = await fixture(), saved = storage(), originalBytes = JSON.stringify(f); await saved.cache.store(scope, [f]);
  const raw = JSON.stringify(saved.value), reopened = saved.reopen(), list = await reopened.list(scope), revision = await reopened.revision(scope, list[0]!.libraryId);
  await validateLibraryRevision(revision); expect(revision.manifest.libraryId).toBe(await roomLibraryIdentity(scope, f.publication.libraryId)); expect(revision.manifest.libraryId).not.toBe(f.publication.libraryId);
  expect((await reopened.original(scope, f.publication.libraryId)).revision.manifest.assets[0]!.thumbnail).toEqual(new Uint8Array([0, 1, 2, 255]));
  expect(JSON.stringify(f)).toBe(originalBytes); expect(JSON.stringify(saved.value)).toBe(raw); expect((await reopened.revision(scope, list[0]!.libraryId)).manifest.revisionId).toBe(revision.manifest.revisionId);
  const root = revision.graph.getNode(revision.manifest.assets[0]!.sourceNodeId)!;
  expect(JSON.parse(root.pluginData.find(item => item.key === 'roomLibraryOrigin')!.value)).toEqual({ version: 1, ...scope, libraryId: f.publication.libraryId, revisionId: f.publication.revisionId, bundleDigest: f.publication.bundleDigest });
});
it('lists validated scoped revision metadata without writing and refuses unknown or cross-room identities', async () => {
  const first = await fixture(), next = await fixture(first, 180), saved = storage(); await saved.cache.store(scope, [first, next]);
  const libraryId = (await saved.cache.list(scope))[0]!.libraryId, before = JSON.stringify(saved.value), writes = saved.writes;
  const revisions = await saved.cache.listRevisions(scope, libraryId);
  expect(revisions.map(({ revisionId, previousRevisionId, name, description, publishedAt, assetCount, step }) => ({ revisionId, previousRevisionId, name, description, publishedAt, assetCount, step }))).toEqual([
    { revisionId: revisions[0]!.revisionId, previousRevisionId: null, name: first.bundle.manifest.name, description: first.bundle.manifest.description, publishedAt: first.bundle.manifest.publishedAt, assetCount: first.bundle.manifest.assets.length, step: 1 },
    { revisionId: revisions[1]!.revisionId, previousRevisionId: revisions[0]!.revisionId, name: next.bundle.manifest.name, description: next.bundle.manifest.description, publishedAt: next.bundle.manifest.publishedAt, assetCount: next.bundle.manifest.assets.length, step: 2 },
  ]);
  expect(revisions[0]!.revisionId).not.toBe(first.bundle.manifest.revisionId); expect(Object.keys(revisions[0]!)).toEqual(['revisionId', 'previousRevisionId', 'name', 'description', 'publishedAt', 'assetCount', 'step']);
  await expect(saved.cache.listRevisions(other, libraryId)).rejects.toThrow('not been downloaded');
  await expect(saved.cache.listRevisions(scope, 'missing-shared-library')).rejects.toThrow();
  expect(JSON.stringify(saved.value)).toBe(before); expect(saved.writes).toBe(writes);
});
it('separates equal raw component and variable identities from different rooms without changing their originals', async () => {
  const f = await fixture(), different = structuredClone(f), decoded = await validateRoomLibraryBundle(different.bundle);
  const base = [...decoded.revision.graph.variables.values()].find(variable => variable.name === 'Color')!;
  for (const mode of Object.keys(base.valuesByMode)) base.valuesByMode[mode] = { r: .4, g: 0, b: 0, a: 1 };
  different.bundle = await prepareRoomLibraryBundle(decoded.revision); different.publication.bundleDigest = await contentHash(different.bundle);
  expect(different.publication.revisionId).toBe(f.publication.revisionId);
  const saved = storage(); await saved.cache.store(scope, [f]); await saved.cache.store(other, [different]);
  const first = (await saved.cache.list(scope))[0]!, second = (await saved.cache.list(other))[0]!; expect(first.libraryId).not.toBe(second.libraryId);
  const consumer = new SceneGraph(), placed = [];
  for (const [source, summary] of [[scope, first], [other, second]] as const) {
    const revision = await saved.cache.revision(source, summary.libraryId); installLibraryResources(consumer, revision);
    const materialized = materializePublicationAsset(consumer, revision, 'card'), instance = consumer.createInstance(materialized.componentId, consumer.getPages()[0]!.id)!; placed.push(instance);
  }
  expect(placed[0]!.componentId).not.toBe(placed[1]!.componentId);
  expect(placed.map(node => consumer.resolveColorVariableForNode(node.id, node.boundVariables['fills/0/color']!)?.r)).toEqual([.8, .4]);
  expect(consumer.variables.size).toBe(4); expect((await saved.cache.original(scope, f.publication.libraryId)).publication.bundleDigest).toBe(f.publication.bundleDigest);
});
it('preserves nested defaults, unused preferred definitions, image bytes and personal text through a scoped revision update', async () => {
  const first = await fixture(), next = await fixture(first, 180), saved = storage(); await saved.cache.store(scope, [first]);
  const summary = (await saved.cache.list(scope))[0]!, previous = await saved.cache.revision(scope, summary.libraryId), consumer = new SceneGraph(); installLibraryResources(consumer, previous);
  const old = materializePublicationAsset(consumer, previous, 'card'), instance = consumer.createInstance(old.componentId, consumer.getPages()[0]!.id)!; normalizeLibraryNestedInstances(consumer, instance.id);
  const label = consumer.getChildren(instance.id).find(node => node.type === 'TEXT')!; consumer.updateNode(label.id, { text: 'Personal text' }); setInstanceOverride(instance.instanceOverrides, instance.id, label.id, 'text', 'Personal text');
  await saved.cache.store(scope, [first, next]); const latest = await saved.cache.revision(scope, summary.libraryId); expect(latest.manifest.previousRevisionId).toBe(previous.manifest.revisionId);
  installLibraryResources(consumer, latest); const materialized = materializePublicationAsset(consumer, latest, 'card'); swapLibraryInstance(consumer, instance.id, materialized.componentId);
  expect(consumer.getNode(instance.id)!.width).toBe(180); expect(consumer.getChildren(instance.id).find(node => node.type === 'TEXT')!.text).toBe('Personal text');
  const definition = consumer.getNode(materialized.componentId)!.componentPropertyDefinitions[0]!; expect(definition.preferredValues?.map(id => consumer.getNode(id)?.name)).toEqual(['Icon', 'Alternate']);
  expect(consumer.images.get(consumer.getNode(instance.id)!.fills[0]!.imageHash!)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  expect((await saved.cache.revision(scope, summary.libraryId, previous.manifest.revisionId)).manifest.revisionId).toBe(previous.manifest.revisionId);
});
it('rejects rollback, changed accepted bytes and incomplete history while preserving cached originals', async () => {
  const first = await fixture(), next = await fixture(first, 180), saved = storage(); await saved.cache.store(scope, [first, next]); const original = JSON.stringify(saved.value);
  await expect(saved.cache.store(scope, [first])).rejects.toThrow('older');
  const changed = structuredClone(first); changed.bundle.manifest.name = 'Changed metadata'; changed.publication.name = 'Changed metadata'; changed.publication.bundleDigest = await contentHash(changed.bundle);
  await expect(saved.cache.store(scope, [changed, next])).rejects.toThrow('differs');
  expect(() => saved.cache.store(scope, [next])).toThrow('predecessor'); expect(JSON.stringify(saved.value)).toBe(original);
  const writes = saved.writes; await saved.cache.store(scope, [first, next]); expect(saved.writes).toBe(writes);
});
it('preserves corrupt or newer cache bytes and refuses rewriting unrelated damaged revisions', async () => {
  const first = await fixture(), saved = storage(); await saved.cache.store(scope, [first]);
  const damaged = structuredClone(saved.value) as { version: number; libraries: { revisions: CachedRoomRevision[] }[] }; damaged.libraries[0]!.revisions[0]!.bundle.checksum = '0'.repeat(64); saved.value = damaged; const raw = JSON.stringify(saved.value);
  await expect(saved.cache.store(other, [first])).rejects.toThrow('integrity'); expect(JSON.stringify(saved.value)).toBe(raw);
  damaged.version = 2; saved.value = damaged; const newer = JSON.stringify(saved.value); await expect(saved.cache.list(scope)).rejects.toThrow('newer'); await expect(saved.cache.store(other, [first])).rejects.toThrow('newer'); expect(JSON.stringify(saved.value)).toBe(newer);
});
it('does not advance cache state after storage failure and can retry the exact original history', async () => {
  const first = await fixture(), next = await fixture(first, 180), saved = storage(); await saved.cache.store(scope, [first]); const raw = JSON.stringify(saved.value); saved.fail = true;
  await expect(saved.cache.store(scope, [first, next])).rejects.toThrow('Injected'); expect(JSON.stringify(saved.value)).toBe(raw); saved.fail = false; await saved.cache.store(scope, [first, next]); expect((await saved.cache.original(scope, first.publication.libraryId)).publication.step).toBe(2);
});
it('copies queued incoming metadata and separates origin/document scope from raw library identity', async () => {
  const first = await fixture(), saved = storage(), incoming = structuredClone(first), work = saved.cache.store(scope, [incoming]); incoming.bundle.manifest.name = 'Mutated after admission'; await work;
  expect((await saved.cache.original(scope, first.publication.libraryId)).revision.manifest.name).toBe(first.publication.name);
  expect(await saved.cache.list(other)).toEqual([]); await expect(saved.cache.original(other, first.publication.libraryId)).rejects.toThrow('not been downloaded');
  expect(await roomLibraryIdentity(scope, first.publication.libraryId)).not.toBe(await roomLibraryIdentity({ ...scope, serverUrl: 'https://other.example.test/' }, first.publication.libraryId));
  await expect(saved.cache.list({ ...scope, serverUrl: 'https://user:secret@rooms.example.test/' })).rejects.toThrow();
});
it('refuses missing variable dependencies and preserves the original graph during scoping', async () => {
  const first = await fixture(), decoded = await validateRoomLibraryBundle(first.bundle), graph = decoded.revision.graph, before = serializeGraph(graph);
  await scopeRoomLibraryRevision(scope, decoded.revision, null, first.publication.bundleDigest); expect(serializeGraph(graph)).toBe(before);
  const alias = [...graph.variables.values()].find(variable => variable.name === 'Alias')!; for (const mode of Object.keys(alias.valuesByMode)) alias.valuesByMode[mode] = { aliasId: 'missing' };
  const damaged = serializeGraph(graph); await expect(scopeRoomLibraryRevision(scope, decoded.revision, null, first.publication.bundleDigest)).rejects.toThrow('dependency'); expect(serializeGraph(graph)).toBe(damaged);
});
it('keeps original and scoped revision reads detached from storage and each other', async () => {
  const first = await fixture(), saved = storage(); await saved.cache.store(scope, [first]); const raw = JSON.stringify(saved.value), summary = (await saved.cache.list(scope))[0]!;
  const original = await saved.cache.original(scope, first.publication.libraryId); original.revision.graph.updateNode(original.revision.manifest.assets[0]!.sourceNodeId, { width: 900 });
  const scoped = await saved.cache.revision(scope, summary.libraryId); scoped.graph.updateNode(scoped.manifest.assets[0]!.sourceNodeId, { width: 800 }); expect(JSON.stringify(saved.value)).toBe(raw);
  const reopened = await saved.reopen().revision(scope, summary.libraryId); expect(reopened.graph.getNode(reopened.manifest.assets[0]!.sourceNodeId)!.width).toBe(100);
  expect(deserializeGraph(serializeGraph(reopened.graph), true).variables.size).toBe(2);
});
it('refuses excessive histories before copying and full catalogs before deriving SDK graphs', async () => {
  const saved = storage(), untouched = vi.fn(() => { throw new Error('Should not read an excessive record'); }), record = Object.defineProperty({}, 'publication', { get: untouched });
  await expect(saved.cache.store(scope, Array(ROOM_LIBRARY_CACHE_REVISIONS + 1).fill(record))).rejects.toThrow('cache bound'); expect(untouched).not.toHaveBeenCalled(); expect(saved.writes).toBe(0);
  const first = await fixture(); saved.value = { version: 1, libraries: Array.from({ length: 256 }, (_, index) => ({ ...scope, documentId: `library_document_${String(index).padStart(4, '0')}`, libraryId: first.publication.libraryId, revisions: [first] })) };
  const raw = JSON.stringify(saved.value); await expect(saved.cache.store({ ...scope, documentId: 'library_document_new_001' }, [first])).rejects.toThrow('storage bounds'); expect(JSON.stringify(saved.value)).toBe(raw); expect(saved.writes).toBe(0);
});
it('retains unchanged scoped variable identities through a real component successor', async () => {
  const first = await fixture(), decoded = await validateRoomLibraryBundle(first.bundle), source = decoded.revision.graph, root = first.bundle.manifest.assets[0]!.sourceNodeId;
  const page = source.addPage('Source page');
  for (const node of source.nodes.values()) if (['COMPONENT', 'COMPONENT_SET'].includes(node.type) && node.parentId && source.getNode(node.parentId)?.type === 'CANVAS') source.reparentNode(node.id, page.id);
  source.updateNode(root, { width: 200 });
  const next = await createPublicationRevision({ libraryId: first.publication.libraryId, name: first.publication.name, graph: source, assetNodeIds: [root], previousRevisionId: first.publication.revisionId, publishedAt: first.publication.publishedAt });
  next.graph.variables = source.variables; next.graph.variableCollections = source.variableCollections; next.graph.activeMode = source.activeMode;
  const bundle = await prepareRoomLibraryBundle(next), successor: CachedRoomRevision = { bundle, publication: { ...first.publication, step: 2, revisionId: bundle.manifest.revisionId, previousRevisionId: first.publication.revisionId, bundleDigest: await contentHash(bundle) } };
  const saved = storage(); await saved.cache.store(scope, [first]); const summary = (await saved.cache.list(scope))[0]!, previous = await saved.cache.revision(scope, summary.libraryId);
  await saved.cache.store(scope, [first, successor]); const latest = await saved.cache.revision(scope, summary.libraryId);
  expect([...latest.graph.variables]).toEqual([...previous.graph.variables]); expect([...latest.graph.variableCollections]).toEqual([...previous.graph.variableCollections]); expect([...latest.graph.activeMode]).toEqual([...previous.graph.activeMode]);
  const consumer = new SceneGraph(); installLibraryResources(consumer, previous); installLibraryResources(consumer, latest); expect(consumer.variables.size).toBe(2); expect(latest.manifest.revisionId).not.toBe(previous.manifest.revisionId); expect(latest.manifest.previousRevisionId).toBe(previous.manifest.revisionId);
});
it('isolates equal original image IDs with different bytes across rooms and existing local artwork', async () => {
  const first = await fixture(), changed = structuredClone(first), decoded = await validateRoomLibraryBundle(changed.bundle), originalHash = [...decoded.revision.graph.images.keys()][0]!, newBytes = new Uint8Array([1, 2, 3, 4, 5]);
  decoded.revision.graph.images.set(originalHash, newBytes); changed.bundle = await prepareRoomLibraryBundle(decoded.revision); changed.publication.bundleDigest = await contentHash(changed.bundle);
  const saved = storage(); await saved.cache.store(scope, [first]); await saved.cache.store(other, [changed]);
  const consumer = new SceneGraph(), localBytes = new Uint8Array([9]), hashes = []; consumer.images.set(originalHash, localBytes);
  for (const source of [scope, other]) {
    const summary = (await saved.cache.list(source))[0]!, revision = await saved.cache.revision(source, summary.libraryId); installLibraryResources(consumer, revision);
    const definition = materializePublicationAsset(consumer, revision, 'card'), hash = consumer.getNode(definition.componentId)!.fills[0]!.imageHash!; hashes.push(hash); expect(hash).toMatch(/^[a-f0-9]{40}$/); expect(hash).not.toBe(originalHash);
  }
  expect(hashes[0]).not.toBe(hashes[1]); expect(consumer.images.get(hashes[0]!)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])); expect(consumer.images.get(hashes[1]!)).toEqual(newBytes); expect(consumer.images.get(originalHash)).toBe(localBytes);
  expect((await saved.cache.original(other, first.publication.libraryId)).revision.graph.images.get(originalHash)).toEqual(newBytes);
});
it('installs detached geometry image bytes and refuses collisions before changing any consumer resources', async () => {
  const first = await fixture(null, 100, true), saved = storage(); await saved.cache.store(scope, [first]); const summary = (await saved.cache.list(scope))[0]!, revision = await saved.cache.revision(scope, summary.libraryId), consumer = new SceneGraph();
  installLibraryResources(consumer, revision); const definition = materializePublicationAsset(consumer, revision, 'card'), node = consumer.getNode(definition.componentId)!;
  for (const field of ['fillGeometry', 'strokeGeometry'] as const) {
    const hash = node[field][0]!.fills![0]!.imageHash!; expect(consumer.images.get(hash)).toEqual(new Uint8Array([1, 2, 3, 4])); expect(consumer.images.get(hash)).not.toBe(revision.graph.images.get(hash));
  }
  const conflicting = new SceneGraph(), hash = [...revision.graph.images.keys()][0]!, original = new Uint8Array([9]); conflicting.images.set(hash, original);
  const before = serializeGraph(conflicting); expect(() => installLibraryResources(conflicting, revision)).toThrow('conflicts'); expect(serializeGraph(conflicting)).toBe(before); expect(conflicting.images.get(hash)).toBe(original); expect(conflicting.variables.size).toBe(0);
});
