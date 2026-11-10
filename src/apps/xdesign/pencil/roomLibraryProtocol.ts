import { assertLibraryId, assertLibraryAssetKey, contentHash, validateLibraryRevision, type ComponentLibraryManifest, type ComponentLibraryRevision } from '@open-pencil/core/library';
import { deserializeGraph, serializeGraph } from './graphDocument';
import { readRoomCommentActor } from './roomCommentProtocol';
import { validateSharedDocumentId } from './sharedCheckpoint';
import type { RoomActor } from './sharedRoomProtocol';

export const ROOM_LIBRARY_TRANSFER_LIMIT = 52 * 1024 * 1024;
export const ROOM_LIBRARY_CATALOG_LIMIT = 256;
export type RoomLibraryManifest = Omit<ComponentLibraryManifest, 'assets'> & { assets: (Omit<ComponentLibraryManifest['assets'][number], 'thumbnail'> & { thumbnail?: string })[] };
export type RoomLibraryBundle = { version: 1; manifest: RoomLibraryManifest; graph: string; checksum: string };
export type RoomLibraryPublish = { version: 1; requestId: string; bundle: RoomLibraryBundle };
export type RoomLibrarySummary = { libraryId: string; revisionId: string; previousRevisionId: string | null; name: string; description: string; publishedAt: string; assetCount: number; ownerId: string; publisher: { id: string; name: string }; step: number; bundleDigest: string };
export type RoomLibraryPublication = { version: 1; documentId: string; actor: RoomActor; requestId: string; publication: RoomLibrarySummary; current: RoomLibrarySummary };
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))) throw new Error('Invalid room library fields.');
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number, empty = false): string {
  if (typeof value !== 'string' || value.length > limit || !empty && !value.trim() || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid room library text.');
  return value;
}
export function roomLibraryRevisionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid room library revision.');
}
function libraryId(value: unknown): string { const id = text(value, 128); assertLibraryId(id); return id; }
function thumbnail(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > 1_400_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid room library thumbnail.');
  const raw = atob(value); if (btoa(raw) !== value || raw.length > 1024 * 1024) throw new Error('Invalid room library thumbnail.');
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
export function readRoomLibraryBundle(value: unknown): RoomLibraryBundle {
  const item = object(value, ['version', 'manifest', 'graph', 'checksum']);
  if (item.version !== 1 || typeof item.graph !== 'string' || !item.graph || new TextEncoder().encode(JSON.stringify(value)).byteLength > ROOM_LIBRARY_TRANSFER_LIMIT) throw new Error('Invalid or oversized room library bundle.');
  roomLibraryRevisionId(item.checksum);
  const manifest = object(item.manifest, ['schemaVersion', 'libraryId', 'name', 'description', 'revisionId', 'previousRevisionId', 'publishedAt', 'assets']);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length > 10_000) throw new Error('Unsupported room library manifest.');
  const id = libraryId(manifest.libraryId); roomLibraryRevisionId(manifest.revisionId);
  if (manifest.previousRevisionId !== null) roomLibraryRevisionId(manifest.previousRevisionId);
  const publishedAt = text(manifest.publishedAt, 64);
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error('Invalid room library publication time.');
  const keys = new Set<string>();
  const assets = manifest.assets.map(value => {
    const asset = object(value, ['key', 'type', 'name', 'description', 'sourceNodeId', 'contentHash'], ['thumbnail']);
    const key = text(asset.key, 256); assertLibraryAssetKey(key); if (keys.has(key)) throw new Error('Duplicate room library asset.'); keys.add(key);
    if (asset.type !== 'COMPONENT' && asset.type !== 'COMPONENT_SET') throw new Error('Invalid room library asset type.');
    roomLibraryRevisionId(asset.contentHash);
    const sourceNodeId = text(asset.sourceNodeId, 128);
    const preview = Object.hasOwn(asset, 'thumbnail') ? { thumbnail: asset.thumbnail as string } : {};
    if ('thumbnail' in preview) thumbnail(preview.thumbnail);
    return { key, type: asset.type as 'COMPONENT' | 'COMPONENT_SET', name: text(asset.name, 200, true), description: text(asset.description, 4000, true), sourceNodeId, contentHash: asset.contentHash, ...preview };
  });
  return { version: 1, manifest: { schemaVersion: 1, libraryId: id, name: text(manifest.name, 200), description: text(manifest.description, 4000, true), revisionId: manifest.revisionId, previousRevisionId: manifest.previousRevisionId, publishedAt, assets }, graph: item.graph, checksum: item.checksum };
}
export async function validateRoomLibraryBundle(value: unknown): Promise<{ bundle: RoomLibraryBundle; revision: ComponentLibraryRevision; bundleDigest: string }> {
  const bundle = readRoomLibraryBundle(value);
  if (await contentHash({ graph: bundle.graph }) !== bundle.checksum) throw new Error('The room library graph failed its integrity check.');
  const graph = deserializeGraph(bundle.graph, true);
  for (const bytes of graph.images.values()) if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('The room library has invalid image resources.');
  for (const node of graph.nodes.values()) {
    if (node.pluginData.some(item => item.pluginId === 'orion.xdesign' && ['photoDocumentId','roomImage'].includes(item.key))) throw new Error('Prepare portable image resources before sharing this library.');
    for (const fill of [...node.fills, ...[...node.fillGeometry, ...node.strokeGeometry].flatMap(geometry => geometry.fills ?? [])]) if (fill.type === 'IMAGE' && fill.imageHash && !graph.images.has(fill.imageHash)) throw new Error('The room library has a missing image resource.');
  }
  const revision: ComponentLibraryRevision = { manifest: { ...bundle.manifest, assets: bundle.manifest.assets.map(({ thumbnail: preview, ...asset }) => ({ ...asset, ...(preview === undefined ? {} : { thumbnail: thumbnail(preview) }) })) }, graph };
  await validateLibraryRevision(revision);
  return { bundle, revision, bundleDigest: await contentHash(bundle) };
}
export async function prepareRoomLibraryBundle(revision: ComponentLibraryRevision): Promise<RoomLibraryBundle> {
  const graph = serializeGraph(revision.graph);
  const manifest: RoomLibraryManifest = { ...revision.manifest, assets: revision.manifest.assets.map(({ thumbnail: preview, ...asset }) => {
    if (!preview) return { ...asset };
    if (!(preview instanceof Uint8Array) || preview.byteLength > 1024 * 1024) throw new Error('Invalid room library thumbnail.');
    let raw = ''; for (const value of preview) raw += String.fromCharCode(value); return { ...asset, thumbnail: btoa(raw) };
  }) };
  return (await validateRoomLibraryBundle({ version: 1, manifest, graph, checksum: await contentHash({ graph }) })).bundle;
}
export function readRoomLibraryPublish(value: unknown): RoomLibraryPublish {
  const item = object(value, ['version', 'requestId', 'bundle']);
  if (item.version !== 1 || new TextEncoder().encode(JSON.stringify(value)).byteLength > ROOM_LIBRARY_TRANSFER_LIMIT) throw new Error('Invalid or oversized library publication.');
  validateSharedDocumentId(item.requestId); return { version: 1, requestId: item.requestId, bundle: readRoomLibraryBundle(item.bundle) };
}
export function readRoomLibraryRead(value: unknown): { version: 1; libraryId: string; revisionId: string | null } {
  const item = object(value, ['version', 'libraryId', 'revisionId']); if (item.version !== 1) throw new Error('Unsupported room library request.');
  if (item.revisionId !== null) roomLibraryRevisionId(item.revisionId);
  return { version: 1, libraryId: libraryId(item.libraryId), revisionId: item.revisionId };
}
export function readRoomLibrarySummary(value: unknown): RoomLibrarySummary {
  const item = object(value, ['libraryId', 'revisionId', 'previousRevisionId', 'name', 'description', 'publishedAt', 'assetCount', 'ownerId', 'publisher', 'step', 'bundleDigest']);
  const id = libraryId(item.libraryId); roomLibraryRevisionId(item.revisionId); roomLibraryRevisionId(item.bundleDigest);
  if (item.previousRevisionId !== null) roomLibraryRevisionId(item.previousRevisionId);
  validateSharedDocumentId(item.ownerId); const publisher = object(item.publisher, ['id', 'name']); validateSharedDocumentId(publisher.id);
  const member = readRoomCommentActor({ ...publisher, role: 'editor' });
  if (!Number.isSafeInteger(item.assetCount) || (item.assetCount as number) < 0 || (item.assetCount as number) > 10_000 || !Number.isSafeInteger(item.step) || (item.step as number) < 1) throw new Error('Invalid room library sequence or asset count.');
  const publishedAt = text(item.publishedAt, 64); if (!Number.isFinite(Date.parse(publishedAt))) throw new Error('Invalid room library publication time.');
  return { libraryId: id, revisionId: item.revisionId, previousRevisionId: item.previousRevisionId, name: text(item.name, 200), description: text(item.description, 4000, true), publishedAt, assetCount: item.assetCount as number, ownerId: item.ownerId, publisher: { id: member.id, name: member.name }, step: item.step as number, bundleDigest: item.bundleDigest };
}
function envelope(value: unknown, documentId: string, keys: string[]) {
  validateSharedDocumentId(documentId); const item = object(value, ['version', 'documentId', 'actor', ...keys]);
  if (item.version !== 1 || item.documentId !== documentId) throw new Error('The library response belongs to another room.');
  return { item, actor: readRoomCommentActor(item.actor) };
}
export function readRoomLibraryCatalog(value: unknown, documentId: string): { version: 1; documentId: string; actor: RoomActor; libraries: RoomLibrarySummary[] } {
  const { item, actor } = envelope(value, documentId, ['libraries']);
  if (!Array.isArray(item.libraries) || item.libraries.length > ROOM_LIBRARY_CATALOG_LIMIT) throw new Error('Invalid room library catalog.');
  const libraries = item.libraries.map(readRoomLibrarySummary); if (new Set(libraries.map(item => item.libraryId)).size !== libraries.length) throw new Error('Duplicate room libraries.');
  return { version: 1, documentId, actor, libraries };
}
export function readRoomLibraryPublication(value: unknown, documentId: string, requestId: string, expected?: { libraryId: string; revisionId: string; bundleDigest: string }): RoomLibraryPublication {
  validateSharedDocumentId(requestId); const { item, actor } = envelope(value, documentId, ['requestId', 'publication', 'current']);
  if (item.requestId !== requestId) throw new Error('The publication belongs to another request.');
  const publication = readRoomLibrarySummary(item.publication), current = readRoomLibrarySummary(item.current);
  if (current.libraryId !== publication.libraryId || current.ownerId !== publication.ownerId || current.step < publication.step || current.step === publication.step && JSON.stringify(current) !== JSON.stringify(publication)) throw new Error('Invalid current library publication.');
  if (expected && (publication.libraryId !== expected.libraryId || publication.revisionId !== expected.revisionId || publication.bundleDigest !== expected.bundleDigest)) throw new Error('The library receipt belongs to another immutable publication.');
  return { version: 1, documentId, requestId, actor, publication, current };
}
export async function readRoomLibraryRevision(value: unknown, documentId: string, library: string, revisionId: string | null): Promise<{ version: 1; documentId: string; actor: RoomActor; publication: RoomLibrarySummary; bundle: RoomLibraryBundle; revision: ComponentLibraryRevision }> {
  libraryId(library); if (revisionId !== null) roomLibraryRevisionId(revisionId);
  const { item, actor } = envelope(value, documentId, ['publication', 'bundle']); const publication = readRoomLibrarySummary(item.publication);
  const decoded = await validateRoomLibraryBundle(item.bundle), manifest = decoded.bundle.manifest;
  if (publication.libraryId !== library || manifest.libraryId !== library || publication.revisionId !== manifest.revisionId || revisionId !== null && manifest.revisionId !== revisionId || publication.bundleDigest !== decoded.bundleDigest || publication.name !== manifest.name || publication.description !== manifest.description || publication.previousRevisionId !== manifest.previousRevisionId || publication.publishedAt !== manifest.publishedAt || publication.assetCount !== manifest.assets.length) throw new Error('The library payload differs from its publication.');
  return { version: 1, documentId, actor, publication, bundle: decoded.bundle, revision: decoded.revision };
}
