import { assertLibraryId, contentHash, describeSnapshotAssets, validateLibraryRevision, type ComponentLibraryRevision } from '@open-pencil/core/library';
import type { SceneNode } from '@open-pencil/scene-graph';
import { deserializeGraph, serializeGraph } from './graphDocument';
import { roomServerOrigin } from './nativeRoomTransport';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { roomLibraryRevisionId } from './roomLibraryProtocol';

export type RoomLibraryScope = { serverUrl: string; documentId: string };
export const ROOM_LIBRARY_ID_PREFIX = 'orion-room-';
export function readRoomLibraryScope(value: unknown): RoomLibraryScope {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || Object.keys(value).some(key => !['serverUrl', 'documentId'].includes(key))) throw new Error('Invalid shared library source.');
  const scope = value as RoomLibraryScope;
  if (roomServerOrigin(scope.serverUrl) !== scope.serverUrl) throw new Error('Invalid shared library origin.');
  validateSharedDocumentId(scope.documentId); return { serverUrl: scope.serverUrl, documentId: scope.documentId };
}
export async function roomLibraryIdentity(scope: RoomLibraryScope, libraryId: string): Promise<string> {
  assertLibraryId(libraryId);
  return `${ROOM_LIBRARY_ID_PREFIX}${await contentHash({ ...readRoomLibraryScope(scope), libraryId })}`;
}
const entries = <T>(map: Map<string, T>) => [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
export async function scopeRoomLibraryRevision(scope: RoomLibraryScope, original: ComponentLibraryRevision, previousRevisionId: string | null, bundleDigest: string): Promise<ComponentLibraryRevision> {
  const source = readRoomLibraryScope(scope); roomLibraryRevisionId(bundleDigest); if (previousRevisionId !== null) roomLibraryRevisionId(previousRevisionId);
  const graph = deserializeGraph(serializeGraph(original.graph), true);
  const originalManifest = structuredClone(original.manifest);
  await validateLibraryRevision({ manifest: originalManifest, graph });
  const libraryId = await roomLibraryIdentity(source, originalManifest.libraryId);
  const imageKeys = new Map<string, string>();
  // FIG image references use 20-byte hexadecimal identities. Scope copied bytes without changing originals.
  for (const [id, bytes] of graph.images) imageKeys.set(id, (await contentHash({ libraryId, imageId: id, bytes })).slice(0, 40));
  graph.images = new Map([...graph.images].map(([id, bytes]) => [imageKeys.get(id)!, bytes]));
  const fills = (values: SceneNode['fills']) => values.map(fill => fill.type === 'IMAGE' && fill.imageHash ? { ...fill, imageHash: imageKeys.get(fill.imageHash) ?? fill.imageHash } : fill);
  const namespace = `orion.room:${libraryId}:${await contentHash({ variables: entries(graph.variables), collections: entries(graph.variableCollections), activeMode: entries(graph.activeMode) })}:`;
  const mapped = (id: string) => `${namespace}${id}`;
  for (const variable of graph.variables.values()) {
    const collection = graph.variableCollections.get(variable.collectionId);
    if (!collection || !collection.variableIds.includes(variable.id)) throw new Error('A shared component variable collection is missing.');
    for (const [mode, value] of Object.entries(variable.valuesByMode)) {
      if (!collection.modes.some(item => item.modeId === mode) || value && typeof value === 'object' && 'aliasId' in value && !graph.variables.has(value.aliasId)) throw new Error('A shared component variable dependency is missing.');
    }
  }
  for (const collection of graph.variableCollections.values()) {
    if (!collection.modes.some(mode => mode.modeId === collection.defaultModeId) || collection.variableIds.some(id => graph.variables.get(id)?.collectionId !== collection.id)) throw new Error('A shared component variable collection is incomplete.');
  }
  for (const [id, mode] of graph.activeMode) if (!graph.variableCollections.get(id)?.modes.some(item => item.modeId === mode)) throw new Error('A shared component active mode is missing.');
  const nodeModes = new Map<string, Record<string, string>>();
  for (const node of graph.nodes.values()) {
    if (Object.values(node.boundVariables).some(id => !graph.variables.has(id))) throw new Error('A shared component bound variable is missing.');
    for (const [id, mode] of Object.entries(node.variableModes)) if (!graph.variableCollections.get(id)?.modes.some(item => item.modeId === mode)) throw new Error('A shared component variable mode is missing.');
    nodeModes.set(node.id, Object.fromEntries([...graph.variableCollections.keys()].map(id => [mapped(id), mapped(graph.getNodeVariableModeId(node.id, id))])));
  }
  graph.variables = new Map(entries(graph.variables).map(([id, variable]) => [mapped(id), { ...variable, id: mapped(id), collectionId: mapped(variable.collectionId), valuesByMode: Object.fromEntries(Object.entries(variable.valuesByMode).map(([mode, value]) => [mapped(mode), value && typeof value === 'object' && 'aliasId' in value ? { aliasId: mapped(value.aliasId) } : value])) }]));
  graph.variableCollections = new Map(entries(graph.variableCollections).map(([id, collection]) => [mapped(id), { ...collection, id: mapped(id), defaultModeId: mapped(collection.defaultModeId), variableIds: collection.variableIds.map(mapped), modes: collection.modes.map(mode => ({ ...mode, modeId: mapped(mode.modeId) })) }]));
  graph.activeMode = new Map(entries(graph.activeMode).map(([id, mode]) => [mapped(id), mapped(mode)]));
  const provenance = JSON.stringify({ version: 1, ...source, libraryId: originalManifest.libraryId, revisionId: originalManifest.revisionId, bundleDigest });
  for (const node of graph.nodes.values()) graph.updateNode(node.id, {
    fills: fills(node.fills),
    fillGeometry: node.fillGeometry.map(geometry => ({ ...geometry, ...(geometry.fills ? { fills: fills(geometry.fills) } : {}) })),
    strokeGeometry: node.strokeGeometry.map(geometry => ({ ...geometry, ...(geometry.fills ? { fills: fills(geometry.fills) } : {}) })),
    boundVariables: Object.fromEntries(Object.entries(node.boundVariables).map(([field, id]) => [field, mapped(id)])), variableModes: nodeModes.get(node.id)!,
    ...(['COMPONENT', 'COMPONENT_SET'].includes(node.type) ? { pluginData: [...node.pluginData.filter(item => !(item.pluginId === 'orion.xdesign' && item.key === 'roomLibraryOrigin')), { pluginId: 'orion.xdesign', key: 'roomLibraryOrigin', value: provenance }] } : {}),
  });
  const described = await describeSnapshotAssets({ graph, assetRoots: originalManifest.assets.map(asset => graph.getNode(asset.sourceNodeId)!) });
  const hashes = new Map(described.map(asset => [asset.key, asset.contentHash]));
  const assets = originalManifest.assets.map(asset => ({ ...structuredClone(asset), contentHash: hashes.get(asset.key)! }));
  const manifest = { ...originalManifest, libraryId, previousRevisionId, assets,
    revisionId: await contentHash({ schemaVersion: originalManifest.schemaVersion, libraryId, previousRevisionId, assets: assets.map(({ thumbnail: _thumbnail, sourceNodeId: _source, ...asset }) => asset) }) };
  const revision = { manifest, graph }; await validateLibraryRevision(revision); return revision;
}
