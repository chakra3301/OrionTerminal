import { Deflate, Inflate } from "fflate";
import { createDefaultNode } from "@open-pencil/scene-graph/node-defaults";
import type { SceneGraph, SceneNode } from "@open-pencil/scene-graph";

export const MAX_GRAPH_BYTES=48*1024*1024;
const MAX_EXPANDED_BYTES=256*1024*1024;
const encoder=new TextEncoder();
// WebKit's native codec is ~35x faster than the btoa/atob string round trip on multi-MB images.
const nativeBase64=Uint8Array as unknown as {prototype:{toBase64?:()=>string};fromBase64?:(text:string)=>Uint8Array};
function base64(bytes:Uint8Array){if(nativeBase64.prototype.toBase64)return (bytes as unknown as {toBase64():string}).toBase64();let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
export function decodeBase64(text:string):Uint8Array {return nativeBase64.fromBase64?nativeBase64.fromBase64(text):Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
// Photo previews are already-compressed PNGs: deflating them again on every save cost
// hundreds of milliseconds per edit for no size gain, so large images sit beside the
// compressed graph and keep their encoding for as long as the bytes are alive.
const BLOB_BYTES=64*1024;
const encodedBlobs=new WeakMap<Uint8Array,string>();
function encodeBlob(bytes:Uint8Array){let text=encodedBlobs.get(bytes);if(text===undefined)encodedBlobs.set(bytes,text=base64(bytes));return text;}
export function decodeBlob(text:string):Uint8Array {const bytes=decodeBase64(text);encodedBlobs.set(bytes,text);return bytes;}
const defaults=new Map<string,Map<string,string|undefined>>();
function compact(node:SceneNode):Record<string,unknown> {
  let baseline=defaults.get(node.type);if(!baseline){baseline=new Map(Object.entries(createDefaultNode(()=>"",node.type)).map(([key,value])=>[key,JSON.stringify(value,replace)]));defaults.set(node.type,baseline);}
  return Object.fromEntries(Object.entries(node).filter(([key,value])=>["id","type","source","parentId","childIds"].includes(key)||!baseline!.has(key)||JSON.stringify(value,replace)!==baseline!.get(key)));
}
function replace(_key:string,value:unknown):unknown {
  if(value instanceof Uint8Array)return {$xdesign:"Uint8Array",base64:base64(value)};
  if(value instanceof Map)return {$xdesign:"Map",values:[...value]};
  if(value instanceof Set)return {$xdesign:"Set",values:[...value]};
  if(ArrayBuffer.isView(value)&&!(value instanceof DataView))return {$xdesign:value.constructor.name,values:Array.from(value as unknown as ArrayLike<number>)};
  return value;
}
/** Stream node records into compression without forming a giant graph string.
 * Source payloads and binary data remain exact; only engine defaults are omitted. */
export function packGraph(graph:SceneGraph,fields:readonly (keyof SceneGraph)[],overrides:Partial<Record<keyof SceneGraph,unknown>>={}):string {
  if(graph.nodes.size>100_000)throw new Error("This design exceeds the 100,000-layer project limit. Export a .fig backup before closing it.");
  const chunks:Uint8Array[]=[];let total=0,compressed=0;
  const deflate=new Deflate({level:1},chunk=>{compressed+=chunk.length;if(compressed>MAX_GRAPH_BYTES*3/4)throw new Error("This design exceeds the 48MB packed project limit. Export a .fig backup before closing it.");chunks.push(chunk);});
  const small:string[]=[];
  const push=(text:string)=>{const bytes=encoder.encode(text);total+=bytes.length;if(total>MAX_EXPANDED_BYTES)throw new Error("This design exceeds the 256MB expanded graph limit. Export a .fig backup before closing it.");if(total<=1024*1024)small.push(text);else small.length=0;deflate.push(bytes,false);};
  const templates=Object.fromEntries([...new Set([...graph.nodes.values()].map(node=>node.type))].map(type=>[type,createDefaultNode(()=>"",type)]));
  push('{"nodes":{"$xdesign":"NodeMap","version":1,"defaults":'+JSON.stringify(templates,replace)+',"values":[');let separator="";
  for(const [id,node] of graph.nodes){push(separator+JSON.stringify([id,compact(node)],replace));separator=",";}
  push("]}");
  const blobs:string[]=[];
  for(const key of fields.filter(key=>key!=="nodes")) {
    let field=Object.hasOwn(overrides,key)?overrides[key]:graph[key];
    if(key==="images")field=new Map([...field as Map<string,Uint8Array>].map(([hash,bytes])=>[hash,bytes.length<BLOB_BYTES?bytes:{$xdesign:"Uint8Array",blob:blobs.push(encodeBlob(bytes))-1}]));
    const value=JSON.stringify(field,replace);if(value!==undefined)push(`,${JSON.stringify(key)}:${value}`);
  }
  push("}");deflate.push(new Uint8Array(),true);
  if(total<=1024*1024&&!blobs.length)return small.join("");
  const bytes=new Uint8Array(compressed);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const packed=JSON.stringify({$xdesign:"PackedGraph",formatVersion:blobs.length?2:1,expandedBytes:total,base64:base64(bytes),...(blobs.length?{blobs}:{})});if(packed.length>MAX_GRAPH_BYTES)throw new Error("This design exceeds the 48MB packed project limit");return packed;
}
export function unpackGraph(json:string):{json:string;blobs:string[]} {
  // Ordinary and legacy graph JSON need no extra parse or copying pass.
  if(!json.startsWith('{"$xdesign":"PackedGraph"'))return {json,blobs:[]};
  const envelope=JSON.parse(json),blobs=envelope.formatVersion===2?envelope.blobs:[];
  if(![1,2].includes(envelope.formatVersion)||!Array.isArray(blobs)||!blobs.every(blob=>typeof blob==="string")||!Number.isSafeInteger(envelope.expandedBytes)||envelope.expandedBytes<1||envelope.expandedBytes>MAX_EXPANDED_BYTES||typeof envelope.base64!=="string")throw new Error("Invalid packed design graph");
  const bytes=decodeBase64(envelope.base64),chunks:string[]=[],decoder=new TextDecoder("utf-8",{fatal:true});let total=0;
  const inflate=new Inflate((chunk,final)=>{total+=chunk.length;if(total>envelope.expandedBytes||total>MAX_EXPANDED_BYTES)throw new Error("Packed design graph exceeds its declared size");chunks.push(decoder.decode(chunk,{stream:!final}));});
  // Small input blocks bound each temporary decompression allocation.
  for(let offset=0;offset<bytes.length;offset+=4096)inflate.push(bytes.subarray(offset,offset+4096),offset+4096>=bytes.length);
  if(total!==envelope.expandedBytes)throw new Error("Packed design graph is incomplete");return {json:chunks.join(""),blobs};
}
export function restoreCompactNodes(entries:unknown,templates:unknown,version:unknown):Map<string,SceneNode> {
  if(version!==1||!templates||typeof templates!=="object"||Object.hasOwn(templates,"__proto__")||!Array.isArray(entries)||entries.length>100_000)throw new Error("Invalid compact design nodes");
  const nodes=new Map<string,SceneNode>();
  for(const entry of entries){if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=="string"||!entry[1]||typeof entry[1]!=="object"||typeof entry[1].type!=="string"||nodes.has(entry[0])||entry[1].id!==entry[0]||Object.hasOwn(entry[1],"__proto__"))throw new Error("Invalid compact design node");const template=(templates as Record<string,SceneNode>)[entry[1].type];if(!template||template.type!==entry[1].type)throw new Error("Invalid compact node defaults");nodes.set(entry[0],createDefaultNode(()=>entry[0],entry[1].type,{...structuredClone(template),...entry[1]}));}
  return nodes;
}
