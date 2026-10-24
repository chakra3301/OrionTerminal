// @vitest-environment node
import { expect, it } from "vitest";
import { deflateSync } from "fflate";
import { SceneGraph } from "@open-pencil/scene-graph";
import { deserializeGraph, serializeGraph } from "./document";
import { decodeBase64, unpackGraph } from "./graphPacking";
it("compacts default fields, preserves opaque/binary/override data and reads legacy graphs",()=>{
  const graph=new SceneGraph(),node=graph.createNode("RECTANGLE",graph.getPages()[0]!.id,{name:"Metadata"});node.instanceOverrides.self.set("visible",false);node.instanceOverrides.descendants.set("child",new Map([["text","Override"]]));graph.images.set("image",new Uint8Array([0,128,255]));
  const compact=serializeGraph(graph),reopened=deserializeGraph(compact);expect(compact).toContain('"NodeMap"');expect(reopened.getNode(node.id)?.instanceOverrides).toEqual(node.instanceOverrides);expect(reopened.images.get("image")).toEqual(graph.images.get("image"));expect(serializeGraph(reopened)).toBe(compact);
  const legacy=JSON.parse(compact);legacy.nodes={$xdesign:"Map",values:[...reopened.nodes]};const old=JSON.stringify(legacy,(_key,value)=>value instanceof Map?{$xdesign:"Map",values:[...value]}:value);expect(deserializeGraph(old).getNode(node.id)?.name).toBe("Metadata");
});
it("streams large repeated source payloads into a deterministic packed graph and validates decompression bounds",()=>{
  const graph=new SceneGraph(),page=graph.getPages()[0]!;for(let i=0;i<180;i++){const node=graph.createNode("RECTANGLE",page.id,{name:`Layer ${i}`});(node.source as unknown as Record<string,unknown>).opaque="original metadata ".repeat(600);}
  const packed=serializeGraph(graph);expect(packed).toContain('"PackedGraph"');expect(packed.length).toBeLessThan(50_000);expect(serializeGraph(deserializeGraph(packed))).toBe(packed);
  const envelope=JSON.parse(packed);envelope.expandedBytes=10;expect(()=>deserializeGraph(JSON.stringify(envelope))).toThrow("declared size");
  const truncated={...JSON.parse(packed),base64:btoa(String.fromCharCode(...deflateSync(new TextEncoder().encode("{}"))))};expect(()=>unpackGraph(JSON.stringify(truncated))).toThrow("incomplete");
});
it("omits only unreferenced images from persisted graphs and leaves the live graph intact",()=>{
  const graph=new SceneGraph(),page=graph.getPages()[0]!,fill=(imageHash:string)=>({type:"IMAGE" as const,color:{r:0,g:0,b:0,a:1},opacity:1,visible:true,imageHash,imageScaleMode:"FILL" as const});
  const [painted,video,orphan,escaped]=["a".repeat(40),"b".repeat(40),"c".repeat(40),'quoted"key'];
  for(const [index,key] of [painted,video,orphan,escaped].entries())graph.images.set(key,new Uint8Array([index,1,2]));
  graph.createNode("RECTANGLE",page.id,{fills:[fill(painted)],pluginData:[{pluginId:"orion.xdesign",key:"video",value:JSON.stringify([{videoHash:video}])}]});
  const persisted=deserializeGraph(serializeGraph(graph,{referencedImagesOnly:true}));
  expect([...persisted.images.keys()].sort()).toEqual([escaped,painted,video].sort());expect(persisted.images.get(video)).toEqual(new Uint8Array([1,1,2]));
  expect(graph.images.size).toBe(4);expect(deserializeGraph(serializeGraph(graph)).images.size).toBe(4);
});
it("stores large images beside the compressed graph instead of deflating them on every save",()=>{
  const graph=new SceneGraph(),photo=new Uint8Array(256*1024).map((_,i)=>i*7),icon=new Uint8Array([1,2,3]);graph.images.set("photo",photo);graph.images.set("icon",icon);
  const packed=serializeGraph(graph),envelope=JSON.parse(packed);
  expect(envelope).toMatchObject({$xdesign:"PackedGraph",formatVersion:2});expect(envelope.blobs).toHaveLength(1);expect(decodeBase64(envelope.blobs[0])).toEqual(photo);
  expect(unpackGraph(packed).json.length).toBeLessThan(10_000);
  const reopened=deserializeGraph(packed);expect(reopened.images.get("photo")).toEqual(photo);expect(reopened.images.get("icon")).toEqual(icon);expect(serializeGraph(reopened)).toBe(packed);
  expect(()=>deserializeGraph(JSON.stringify({...envelope,blobs:[]}))).toThrow("Invalid binary graph data");
  expect(()=>deserializeGraph(JSON.stringify({...envelope,blobs:[7]}))).toThrow("Invalid packed design graph");
});
