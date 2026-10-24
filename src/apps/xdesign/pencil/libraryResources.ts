import { contentHash, ensureLibraryAssetKeys, isValidLibraryAssetKey, type ComponentLibraryRevision } from "@open-pencil/core/library";
import { computeImageHash, type SceneGraph, type Variable, type VariableCollection } from "@open-pencil/scene-graph";
import { deserializeGraph, serializeGraph } from "./document";
import { readRoomImagePluginData, roomImageReferenceText, type RoomImageReference } from './roomImageReferences';
import { libraryNodeClosure } from "./libraryDependencies";

export type LibraryPhotoLoader = (photoId: string) => Promise<Uint8Array>;
export type LibraryRoomImageLoader = (reference: RoomImageReference) => Promise<Uint8Array>;

/** Stable, versioned token identities prevent a new revision overwriting old instances' tokens. */
export async function prepareLibrarySource(source: SceneGraph, libraryId: string, rootIds: string[], loadPhoto?: LibraryPhotoLoader, libraryName = "Library", loadRoomImage?: LibraryRoomImageLoader) {
  const graph = deserializeGraph(serializeGraph(source));
  const closure = libraryNodeClosure(graph, rootIds);
  const assignments = ensureLibraryAssetKeys(graph, rootIds);
  if (assignments.length !== rootIds.length) throw new Error("Choose local components or component sets to publish");
  const dependencyRoots=[...closure].map(id=>graph.getNode(id)!).filter(node=>["COMPONENT","COMPONENT_SET"].includes(node.type)&&(!node.parentId||!closure.has(node.parentId))&&!rootIds.includes(node.id));
  assignments.push(...ensureLibraryAssetKeys(graph,dependencyRoots.map(node=>node.id)));
  // Different libraries/revisions can each contain "button" or "icon". These
  // private copied definitions need distinct portable keys; live read-only
  // source definitions retain their original keys and identities.
  for(const id of closure){
    const node=graph.getNode(id)!,identity=node.librarySource?.identity;
    if(identity&&["COMPONENT","COMPONENT_SET"].includes(node.type))graph.updateNode(id,{componentKey:`dependency/${await contentHash(identity)}`});
  }
  // Nested instances can depend on a particular variant. Its dependency hash also needs a key.
  for (const id of closure) {
    const node = graph.getNode(id)!;
    if (node.type !== "COMPONENT" || node.componentKey && isValidLibraryAssetKey(node.componentKey)) continue;
    const parent = node.parentId ? graph.getNode(node.parentId) : null;
    const assetKey = `${(parent?.componentKey ?? "dependency").slice(0, 150)}/variant-${id.replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 64)}`;
    graph.updateNode(id, { componentKey: assetKey }); assignments.push({ nodeId: id, assetKey, existing: false });
  }
  const variables = new Map<string, Variable>(); const collections = new Map<string, VariableCollection>();
  const visitVariable = (id: string) => {
    if (variables.has(id)) return;
    const variable = graph.variables.get(id); if (!variable) throw new Error("A component variable is missing");
    const collection = graph.variableCollections.get(variable.collectionId); if (!collection) throw new Error("A component variable collection is missing");
    variables.set(id, structuredClone(variable)); collections.set(collection.id, structuredClone(collection));
    for (const value of Object.values(variable.valuesByMode)) if (value && typeof value === "object" && "aliasId" in value) visitVariable(value.aliasId);
  };
  const photos = new Map<string, Uint8Array>();
  for (const id of closure) {
    const node = graph.getNode(id)!;
    for (const variableId of Object.values(node.boundVariables)) visitVariable(variableId);
    const reference = readRoomImagePluginData(node.pluginData);
    const photoId = node.pluginData.find(p => p.pluginId === "orion.xdesign" && p.key === "photoDocumentId")?.value;
    if (reference || photoId) {
      if (reference ? !loadRoomImage : !loadPhoto) throw new Error('Resolve the linked image at full resolution before publishing');
      const key = reference ? 'shared:' + roomImageReferenceText(reference) : 'local:' + photoId;
      let bytes = photos.get(key);
      if (!bytes) {
        const loaded = reference ? await loadRoomImage!(reference) : await loadPhoto!(photoId!);
        if (!(loaded instanceof Uint8Array) || !loaded.length || loaded.byteLength > 48 * 1024 * 1024) throw new Error('A library image is empty or exceeds 48 MB');
        bytes = new Uint8Array(loaded); photos.set(key, bytes);
      }
      const hash = computeImageHash(bytes); graph.images.set(hash, bytes);
      graph.updateNode(id, { fills: node.fills.map(f => f.type === 'IMAGE' ? { ...f, imageHash: hash } : f), pluginData: node.pluginData.filter(p => !(p.pluginId === 'orion.xdesign' && ['photoDocumentId', 'roomImage'].includes(p.key))) });
    }
  }
  for (const collection of collections.values()) collection.variableIds = collection.variableIds.filter(id => variables.has(id));
  const activeMode = [...collections.keys()].flatMap(id => graph.activeMode.has(id) ? [[id, graph.activeMode.get(id)!]] as [string, string][] : []);
  const namespace = `orion.library:${libraryId}:${await contentHash({ variables: [...variables].sort(), collections: [...collections].sort(), activeMode: activeMode.sort() })}:`;
  const mapped = (id: string) => `${namespace}${id}`;
  graph.variables = new Map([...variables].map(([id, variable]) => [mapped(id), { ...variable, id: mapped(id), collectionId: mapped(variable.collectionId), valuesByMode: Object.fromEntries(Object.entries(variable.valuesByMode).map(([mode, value]) => [mapped(mode), value && typeof value === "object" && "aliasId" in value ? { aliasId: mapped(value.aliasId) } : value])) }]));
  graph.variableCollections = new Map([...collections].map(([id, collection]) => [mapped(id), { ...collection, id: mapped(id), name: `${libraryName} / ${collection.name}`, defaultModeId: mapped(collection.defaultModeId), variableIds: collection.variableIds.map(mapped), modes: collection.modes.map(mode => ({ ...mode, modeId: mapped(mode.modeId) })) }]));
  graph.activeMode = new Map(activeMode.map(([id, mode]) => [mapped(id), mapped(mode)]));
  for (const id of closure) {
    const node = graph.getNode(id)!;
    // Resolve inherited mode overrides before moving a component out of its source page.
    const modes: Record<string, string> = {};
    for (const collectionId of collections.keys()) modes[mapped(collectionId)] = mapped(source.getNodeVariableModeId(id, collectionId));
    graph.updateNode(id, { boundVariables: Object.fromEntries(Object.entries(node.boundVariables).map(([field, variableId]) => [field, mapped(variableId)])), variableModes: modes, pluginData: [...node.pluginData.filter(p => !(p.pluginId === "orion.xdesign" && ["librarySourceNodeId","librarySourceLocked"].includes(p.key))), { pluginId: "orion.xdesign", key: "librarySourceNodeId", value: id }, { pluginId: "orion.xdesign", key: "librarySourceLocked", value: String(source.getNode(id)!.locked) }] });
  }
  return { graph, assignments };
}

export function installLibraryResources(consumer: SceneGraph, revision: ComponentLibraryRevision) {
  for (const [id, bytes] of revision.graph.images) {
    const existing = consumer.images.get(id);
    if (!(bytes instanceof Uint8Array) || !bytes.length || existing && (existing.length !== bytes.length || existing.some((value, index) => value !== bytes[index]))) throw new Error("A component image conflicts with existing document resources; the original image was preserved");
  }
  // Upstream materialization omits stroke-geometry images. Install the complete portable resource set.
  for (const [id, bytes] of revision.graph.images) if (!consumer.images.has(id)) consumer.images.set(id, new Uint8Array(bytes));
  for (const [id, collection] of revision.graph.variableCollections) if (!consumer.variableCollections.has(id)) consumer.addCollection(structuredClone(collection));
  for (const [id, variable] of revision.graph.variables) if (!consumer.variables.has(id)) consumer.addVariable(structuredClone(variable));
  for (const [id, mode] of revision.graph.activeMode) if (!consumer.activeMode.has(id)) consumer.activeMode.set(id, mode);
}
