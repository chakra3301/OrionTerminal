import { SceneGraph, type SceneNode } from "@open-pencil/scene-graph";
import { MAX_GRAPH_BYTES, decodeBase64, decodeBlob, packGraph, restoreCompactNodes, unpackGraph } from "./graphPacking";
import { installSlotSupport } from "./slotGraph";

const MAX_BYTES = MAX_GRAPH_BYTES;
const fields = ["nodes","images","variables","variableCollections","activeMode","rootId","figKiwiVersion","figSchemaDeflated","documentColorSpace","enabledLibraries"] as const;
const typedArrays = {Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array};

// Preserve the authoritative upstream graph, including source metadata and typed
// binary fields. Converting .fig to Orion's older Shape union loses information.
export function serializeGraph(graph: SceneGraph, options: { referencedImagesOnly?: boolean } = {}): string {
  return packGraph(graph,fields,options.referencedImagesOnly?{images:referencedImages(graph)}:{});
}

// Replaced image fills keep their old bytes in memory for undo; saving them made
// every edit re-encode megabytes the design no longer uses. References can be fill
// hashes or hashes embedded in plugin JSON (video metadata), so match substrings too.
function referencedImages(graph: SceneGraph): Map<string, Uint8Array> {
  const pending=unreferencedImages(graph,graph.images.keys());
  return pending.size?new Map([...graph.images].filter(([key])=>!pending.has(key))):graph.images;
}

export function unreferencedImages(graph: SceneGraph, keys: Iterable<string>): Set<string> {
  const pending=new Set([...keys].filter(key=>JSON.stringify(key)===`"${key}"`)),shortest=Math.min(...[...pending].map(key=>key.length));
  const visit=(value:unknown):void=>{
    if(!pending.size)return;
    if(typeof value==="string"){if(pending.delete(value)||value.length<=shortest)return;for(const key of pending)if(value.includes(key))pending.delete(key);return;}
    if(!value||typeof value!=="object"||ArrayBuffer.isView(value))return;
    if(value instanceof Map){for(const [key,item] of value){visit(key);visit(item);}return;}
    for(const item of value instanceof Set||Array.isArray(value)?value:Object.values(value))visit(item);
  };
  for(const key of fields)if(key!=="images")visit(graph[key]);
  return pending;
}

export function deserializeGraph(json: string, allowInternalPages = false, transform?: (graph: SceneGraph) => void): SceneGraph {
  if(typeof json!=="string" || json.length>MAX_BYTES) throw new Error("Invalid or oversized design graph");
  const unpacked=unpackGraph(json),blobs=unpacked.blobs;
  const raw = JSON.parse(unpacked.json,(_key,value) => {
    if(!value || typeof value!=="object" || !("$xdesign" in value)) return value;
    if(value.$xdesign==="Uint8Array"&&typeof value.base64==="string")return decodeBase64(value.base64);
    if(value.$xdesign==="Uint8Array"&&Number.isSafeInteger(value.blob)&&value.blob>=0&&value.blob<blobs.length)return decodeBlob(blobs[value.blob]!);
    if(value.$xdesign==="NodeMap")return restoreCompactNodes(value.values,value.defaults,value.version);
    if(!Array.isArray(value.values)) throw new Error("Invalid binary graph data");
    if(value.$xdesign==="Map") return new Map(value.values);
    if(value.$xdesign==="Set") return new Set(value.values);
    const ctor=typedArrays[value.$xdesign as keyof typeof typedArrays];
    if(!ctor || !value.values.every((n:unknown)=>typeof n==="number" && Number.isFinite(n))) throw new Error("Unsupported graph field encoding");
    return new ctor(value.values);
  });
  for(const key of ["nodes","images","variables","variableCollections","activeMode","enabledLibraries"]) if(!(raw[key] instanceof Map)) throw new Error("Incomplete design graph");
  if(raw.nodes.size>100_000 || !raw.nodes.has(raw.rootId)) throw new Error("Invalid design graph root");
  const root=raw.nodes.get(raw.rootId);
  if(root.type!=="FRAME" || root.parentId!==null) throw new Error("Invalid design root");
  const visited=new Set<string>();const pending=[raw.rootId];
  while(pending.length){const id=pending.pop()!;const node=raw.nodes.get(id) as SceneNode|undefined;
    if(!node || visited.has(id) || node.id!==id || !Array.isArray(node.childIds) || ![node.x,node.y,node.width,node.height].every(Number.isFinite)) throw new Error("Invalid design hierarchy");
    visited.add(id);
    for(const child of node.childIds){if(raw.nodes.get(child)?.parentId!==id) throw new Error("Invalid design parent");pending.push(child);}
  }
  if(visited.size!==raw.nodes.size) throw new Error("Design contains orphaned layers");
  const graph=new SceneGraph();
  for(const key of fields) (graph as unknown as Record<string,unknown>)[key]=raw[key];
  transform?.(graph);
  graph.instanceIndex.clear();
  for(const node of graph.nodes.values()) if(node.type==="INSTANCE" && node.componentId){let set=graph.instanceIndex.get(node.componentId);if(!set){set=new Set();graph.instanceIndex.set(node.componentId,set);}set.add(node.id);}
  if(!graph.getPages(allowInternalPages).length) throw new Error("Design has no pages");
  installSlotSupport(graph);
  return graph;
}

