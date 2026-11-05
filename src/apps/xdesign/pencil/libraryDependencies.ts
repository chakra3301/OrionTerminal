import { canonicalLibraryNode, contentHash, createLibraryRevision, findLibraryDefinition, materializeLibraryAsset, type ComponentLibraryRevision, type PublishLibraryInput } from "@open-pencil/core/library";
import { resolveComponentPropertyValue, type SceneGraph, type SceneNode } from "@open-pencil/scene-graph";
import { deserializeGraph, serializeGraph } from "./document";
import { isSlotDefinition } from "./slots";
import { copyVideoResources } from './videoPaints';

const SWAP_PREFIX="orion-library-swap:";
function swapKey(value:string):string|null {
  if(!value.startsWith(SWAP_PREFIX))return null;
  try {const parsed:unknown=JSON.parse(value.slice(SWAP_PREFIX.length));return parsed&&typeof parsed==="object"&&"key" in parsed&&typeof parsed.key==="string"?parsed.key:null;}catch{return null;}
}
function resolveSwap(graph:SceneGraph,value:string) {
  const key=swapKey(value)??value;
  return resolveComponentPropertyValue(graph,key)??[...graph.nodes.values()].find(node=>node.type==="COMPONENT"&&node.pluginData.some(item=>item.pluginId==="orion.xdesign"&&item.key==="librarySourceNodeId"&&item.value===key))??null;
}
export function libraryNodeClosure(graph:SceneGraph,rootIds:readonly string[],strict=true):Set<string> {
  const closure=new Set<string>(),pending=[...rootIds];
  while(pending.length){
    const id=pending.pop()!;if(closure.has(id))continue;
    const node=graph.getNode(id);if(!node)throw new Error("A library component is missing");
    closure.add(id);pending.push(...node.childIds);
    const include=(component:SceneNode)=>{
      const parent=component.parentId?graph.getNode(component.parentId):null;
      pending.push(parent?.type==="COMPONENT_SET"?parent.id:component.id);
    };
    if(node.componentId){const component=graph.getNode(node.componentId);if(!component)throw new Error("A nested library component is missing");include(component);}
    for(const property of node.componentPropertyDefinitions)if(property.type==="INSTANCE_SWAP"||isSlotDefinition(property))for(const value of [...(property.type==="INSTANCE_SWAP"?[property.defaultValue]:[]),...property.preferredValues??[]]){
      const component=resolveSwap(graph,value);if(!component){if(!strict)continue;throw new Error(`Restore the component used by ${property.name} before publishing`);}include(component);
    }
  }
  return closure;
}
function definitionRoots(graph:SceneGraph,closure:Set<string>) {
  return [...closure].map(id=>graph.getNode(id)!).filter(node=>["COMPONENT","COMPONENT_SET"].includes(node.type)&&(!node.parentId||!closure.has(node.parentId)));
}

/** Upstream snapshots follow instances. Also carry exposed swap choices that
 * are unused in the current main component, without publishing them as assets.
 * Stable references include a dependency hash, so changes appear in review. */
export async function createPublicationRevision(input:PublishLibraryInput):Promise<ComponentLibraryRevision> {
  const graph=deserializeGraph(serializeGraph(input.graph));
  const rootIds=input.assetNodeIds??[],closure=libraryNodeClosure(graph,rootIds);
  const roots=definitionRoots(graph,closure);
  const fingerprints=new Map<string,Promise<string>>();
  const reference=async(value:string)=>{
    const target=resolveSwap(graph,value);if(!target?.componentKey)throw new Error("A property component has no portable library identity");
    if(!fingerprints.has(target.id)){
      const dependencies=definitionRoots(graph,libraryNodeClosure(graph,[target.id]));
      fingerprints.set(target.id,contentHash(dependencies.map(node=>({key:node.componentKey,content:canonicalLibraryNode(graph,node)})).sort((a,b)=>(a.key??"").localeCompare(b.key??""))));
    }
    return SWAP_PREFIX+JSON.stringify({key:target.componentKey,hash:await fingerprints.get(target.id)});
  };
  // Compute against the original definitions before rewriting any references.
  const definitions=new Map<string,SceneNode["componentPropertyDefinitions"]>();
  for(const id of closure){
    const node=graph.getNode(id)!;
    if(node.componentPropertyDefinitions.some(def=>def.type==="INSTANCE_SWAP"||isSlotDefinition(def)))definitions.set(id,await Promise.all(node.componentPropertyDefinitions.map(async def=>def.type==="INSTANCE_SWAP"||isSlotDefinition(def)?{...def,...(def.type==="INSTANCE_SWAP"?{defaultValue:await reference(def.defaultValue)}:{}),...(def.preferredValues?{preferredValues:await Promise.all(def.preferredValues.map(reference))}:{})}:def)));
  }
  for(const [id,properties] of definitions)graph.updateNode(id,{componentPropertyDefinitions:properties});
  const revision=await createLibraryRevision({...input,graph,assetNodeIds:roots.map(root=>root.id)});
  copyVideoResources(graph,revision.graph);
  const selected=new Set(rootIds.map(id=>graph.getNode(id)?.componentKey));
  revision.manifest.assets=revision.manifest.assets.filter(asset=>selected.has(asset.key));
  revision.manifest.revisionId=await contentHash({schemaVersion:revision.manifest.schemaVersion,libraryId:revision.manifest.libraryId,previousRevisionId:revision.manifest.previousRevisionId,assets:revision.manifest.assets.map(({thumbnail:_thumbnail,sourceNodeId:_id,...asset})=>asset)});
  return revision;
}

/** Resolve portable swap references to the exact materialized library revision,
 * avoiding ambiguity between components with the same key in other libraries. */
export function materializePublicationAsset(consumer:SceneGraph,revision:ComponentLibraryRevision,assetKey:string) {
  const asset=revision.manifest.assets.find(asset=>asset.key===assetKey);if(!asset)throw new Error(`Library asset not found: ${assetKey}`);
  const closure=libraryNodeClosure(revision.graph,[asset.sourceNodeId],false);
  copyVideoResources(revision.graph,consumer,[...closure].map(id=>revision.graph.getNode(id)!));
  const roots=definitionRoots(revision.graph,closure);
  const augmented={...revision,manifest:{...revision.manifest,assets:[...revision.manifest.assets,...roots.filter(root=>!revision.manifest.assets.some(asset=>asset.sourceNodeId===root.id)).map(root=>({key:root.componentKey!,type:root.type as "COMPONENT"|"COMPONENT_SET",name:root.name,description:root.symbolDescription,sourceNodeId:root.id,contentHash:""}))]}};
  for(const root of roots)if(root.id!==asset.sourceNodeId)materializeLibraryAsset(consumer,augmented,root.componentKey!);
  const result=materializeLibraryAsset(consumer,augmented,assetKey);
  for(const node of consumer.nodes.values())if(node.librarySource?.identity.libraryId===revision.manifest.libraryId&&node.librarySource.identity.revisionId===revision.manifest.revisionId&&!node.pluginData.some(item=>item.pluginId==="orion.xdesign"&&item.key==="libraryDisplayName"))consumer.updateNode(node.id,{pluginData:[...node.pluginData,{pluginId:"orion.xdesign",key:"libraryDisplayName",value:revision.manifest.name}]});
  const remap=(value:string)=>{
    const token=swapKey(value),legacy=token?null:resolveSwap(revision.graph,value);
    const key=token??legacy?.componentKey;if(!key)return value;
    const definition=findLibraryDefinition(consumer,revision.manifest.libraryId,key,revision.manifest.revisionId);
    if(!definition)throw new Error("A published property component could not be materialized");
    return definition.id;
  };
  for(const node of consumer.nodes.values())if(node.librarySource?.identity.libraryId===revision.manifest.libraryId&&node.librarySource.identity.revisionId===revision.manifest.revisionId&&node.componentPropertyDefinitions.some(def=>def.type==="INSTANCE_SWAP"||isSlotDefinition(def)))consumer.updateNode(node.id,{componentPropertyDefinitions:node.componentPropertyDefinitions.map(def=>def.type==="INSTANCE_SWAP"||isSlotDefinition(def)?{...def,...(def.type==="INSTANCE_SWAP"?{defaultValue:remap(def.defaultValue)}:{}),...(def.preferredValues?{preferredValues:def.preferredValues.map(remap)}:{})}:def)});
  return result;
}
