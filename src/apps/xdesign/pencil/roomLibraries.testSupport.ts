import { SceneGraph, computeImageHash } from '@open-pencil/scene-graph';
import { contentHash, type ComponentLibraryRevision } from '@open-pencil/core/library';
import { createPublicationRevision } from './libraryDependencies';
import { prepareLibrarySource } from './libraryResources';
import { prepareRoomLibraryBundle } from './roomLibraryProtocol';
import { RoomLibraryCache, type CachedRoomRevision, type RoomLibraryCacheStorage } from './roomLibraryCache';
import { RoomLibraryPendingStore, type RoomLibraryPendingStorage } from './roomLibraryPending';

export const libraryScope = { serverUrl: 'https://rooms.example.test/', documentId: 'library_document_001' };
export const libraryProjectId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
export const libraryActor = { id: 'library_owner_0001', name: 'Designer 🙂', role: 'owner' as const };
export async function libraryFixture(previous?: ComponentLibraryRevision, width = 100, libraryId = 'library:controls') {
  const graph = new SceneGraph();
  const component = graph.createNode('COMPONENT', graph.getPages()[0]!.id, { name: 'Card', width, height: 40 });
    graph.createNode('TEXT', component.id, { name: 'Label', text: 'Original text', width: 80, height: 20 });
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), imageHash = computeImageHash(bytes);
    graph.images.set(imageHash, bytes); graph.updateNode(component.id, { fills: [{ type: 'IMAGE', imageHash, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }] });
  const prepared = await prepareLibrarySource(graph, libraryId, [component.id]);
  const revision = await createPublicationRevision({ libraryId, name: 'Controls 🙂', description: 'Shared controls', graph: prepared.graph, assetNodeIds: [component.id], previousRevisionId: previous?.manifest.revisionId ?? null, publishedAt: '2026-10-12T12:00:00.000Z' });
  for (const [hash, bytes] of prepared.graph.images) revision.graph.images.set(hash, new Uint8Array(bytes));
  revision.manifest.assets[0]!.thumbnail = new Uint8Array([0, 255]);
  return revision;
}
export async function libraryRecord(revision: ComponentLibraryRevision, step = 1): Promise<CachedRoomRevision> {
  const bundle = await prepareRoomLibraryBundle(revision), manifest = bundle.manifest;
  return { bundle, publication: { libraryId: manifest.libraryId, revisionId: manifest.revisionId, previousRevisionId: manifest.previousRevisionId, name: manifest.name, description: manifest.description, publishedAt: manifest.publishedAt, assetCount: manifest.assets.length, ownerId: libraryActor.id, publisher: { id: libraryActor.id, name: libraryActor.name }, step, bundleDigest: await contentHash(bundle) } };
}
export function libraryCacheStorage() {
  let value: unknown = null, fail = false, writes = 0;
  const adapter: RoomLibraryCacheStorage = { read: async () => structuredClone(value), write: async (next, expected) => {
    if (fail) throw new Error('Injected cache save failure');
    if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Cache changed in another window');
    value = structuredClone(next); writes++;
  } };
  return { cache: new RoomLibraryCache(adapter), reopen: () => new RoomLibraryCache(adapter), get value() { return value; }, set value(next: unknown) { value = next; }, get writes() { return writes; }, set fail(next: boolean) { fail = next; } };
}
export function libraryPendingStorage() {
  let value: unknown = null, fail = false, writes = 0;
  const adapter: RoomLibraryPendingStorage = { read: async () => structuredClone(value), write: async (_project, next, expected) => {
    if (fail) throw new Error('Injected pending save failure');
    if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Pending request changed in another window');
    value = structuredClone(next); writes++;
  } };
  return { pending: new RoomLibraryPendingStore(adapter), reopen: () => new RoomLibraryPendingStore(adapter), get value() { return value; }, set value(next: unknown) { value = next; }, get writes() { return writes; }, set fail(next: boolean) { fail = next; } };
}
