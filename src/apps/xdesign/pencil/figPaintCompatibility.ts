import type { SceneGraph } from "@open-pencil/scene-graph";
import type { CanvasKit } from "canvaskit-wasm";
import type { SkiaRenderer } from "@open-pencil/core/canvas";
import { bakeProceduralPaints, restoreProceduralPaints } from "./proceduralExport";
import { prepareFigSlots, recoverFigSlotDefinitions } from "./figSlots";
import { prepareFigPrototype } from './figPrototype';
import { prepareFigComments } from './figComments';
import { isFigMeta } from './figImportData';

/** The installed .fig schema calls a transformed image STRETCH; its renderer
 * calls the same paint CROP. Adapt explicit paints, including rich-text/vector
 * region paints, while leaving original source metadata and image bytes intact.
 * Export callers must pass their cloned graph, never the live editor graph. */
function visitImagePaints(graph: SceneGraph, visit: (paint: Record<string, unknown>) => void): void {
  const pending: unknown[] = [...graph.nodes.values()], visited = new WeakSet<object>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || visited.has(value)) continue;
    visited.add(value);
    if (value instanceof Map || value instanceof Set) { for(const child of value.values())pending.push(child); continue; }
    const object = value as Record<string, unknown>;
    if (object.type === "IMAGE")visit(object);
    for (const [key, child] of Object.entries(object)) if (key !== "source" && key !== "pluginData") pending.push(child);
  }
}

export function convertFigImageModes(graph: SceneGraph, direction: "import" | "export"): number {
  if(direction==="import"){restoreProceduralPaints(graph);recoverFigSlotDefinitions(graph);}
  let changed=0;
  visitImagePaints(graph,object=>{
    if(direction==="export"&&object.imageScaleMode==="CROP") {
      object.imageScaleMode=object.imageTransform?"STRETCH":"FILL";changed++;
    }else if(direction==="import"&&object.imageScaleMode==="STRETCH") {
      changed++;object.imageScaleMode="CROP";
      // An omitted transform in a native stretch paint samples the full image.
      object.imageTransform??={m00:1,m01:0,m02:0,m10:0,m11:1,m12:0};
    }
  });
  return changed;
}

/** Receives the caller's export graph. Render its thumbnail before converting
 * to the schema vocabulary, so the installed renderer still honors the crop. */
function exportedFigMeta(graph: SceneGraph): string|null {
  const root=graph.getNode(graph.rootId),stored=root?.pluginData.find(isFigMeta)?.value;
  if(root)root.pluginData=root.pluginData.filter(entry=>!isFigMeta(entry));
  try{const meta:unknown=stored?JSON.parse(stored):null;return meta&&typeof meta==="object"&&!Array.isArray(meta)?JSON.stringify({...meta,exported_at:new Date().toISOString()}):null;}catch{return null;}
}

export async function exportFigImageCompatible(graph: SceneGraph, ck?: CanvasKit, renderer?: SkiaRenderer, pageId?: string): Promise<Uint8Array> {
  const io=await import("@open-pencil/core/io"),meta=exportedFigMeta(graph);
  if(ck)bakeProceduralPaints(graph,ck);
  let cropped=false;visitImagePaints(graph,paint=>{if(paint.imageScaleMode==="CROP")cropped=true;});
  const hasSlots=[...graph.nodes.values()].some(node=>node.componentPropertyDefinitions.some(def=>String(def.type)==="SLOT")||node.pluginData.some(entry=>entry.pluginId==='open-pencil'&&entry.key==='behaviour'));
  const thumbnail=(cropped||hasSlots)&&ck&&renderer&&pageId?io.renderThumbnail(ck,renderer,graph,pageId,512,512):null;
  const finalizeSlots=prepareFigSlots(graph);
  const finalizePrototype=prepareFigPrototype(graph);
  const finalizeComments=prepareFigComments(graph);
  const changed=convertFigImageModes(graph,"export");
  const exported=await io.exportFigFile(graph,ck,changed||finalizeSlots?undefined:renderer,pageId);
  const slots=finalizeSlots?finalizeSlots(exported):exported;
  const prototypes=finalizePrototype?finalizePrototype(slots):slots;
  const bytes=finalizeComments?finalizeComments(prototypes):prototypes;
  const replaceThumbnail=!!(changed||finalizeSlots)&&!!thumbnail;
  if(!replaceThumbnail&&!meta)return bytes;
  const {default:JSZip}=await import("jszip");
  const zip=await JSZip.loadAsync(bytes);
  if(replaceThumbnail){
    if(!zip.file("thumbnail.png"))throw new Error("The exported design has no thumbnail entry");
    zip.file("thumbnail.png",thumbnail);
  }
  if(meta)zip.file("meta.json",meta);
  return zip.generateAsync({type:"uint8array",compression:"DEFLATE",compressionOptions:{level:6}});
}
