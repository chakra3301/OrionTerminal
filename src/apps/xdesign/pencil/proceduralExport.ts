import { SkiaRenderer } from "@open-pencil/core/canvas";
import { computeImageHash, type Fill, type SceneGraph } from "@open-pencil/scene-graph";
import type { CanvasKit } from "canvaskit-wasm";
import { installProceduralPaints, proceduralPaint, renderDesignNodes } from "./proceduralPaints";

const PLUGIN="orion.xdesign",KEY="proceduralPaints";
/** Raster fallback travels to other applications; Orion also retains editable
 * trusted paint settings. Only an unchanged exported image may restore them. */
export function restoreProceduralPaints(graph:SceneGraph):void {
  for(const node of graph.nodes.values()){
    const entry=node.pluginData.find(entry=>entry.pluginId===PLUGIN&&entry.key===KEY);if(!entry||entry.value.length>64*1024)continue;
    try{
      const records:unknown=JSON.parse(entry.value);if(!Array.isArray(records)||records.length>128)continue;
      const fills=[...node.fills];let changed=false;
      for(const record of records){
        if(!record||!Number.isInteger(record.index)||record.index<0||record.index>=fills.length||typeof record.hash!=="string"||!record.paint||!proceduralPaint(record.paint)||!record.paint.color||![record.paint.color.r,record.paint.color.g,record.paint.color.b,record.paint.color.a,record.paint.opacity].every(Number.isFinite))continue;
        const current=fills[record.index]!;if(current.type!=="IMAGE"||current.imageHash!==record.hash)continue;
        fills[record.index]={...record.paint,opacity:current.opacity,visible:current.visible,blendMode:current.blendMode};changed=true;
      }
      if(changed)graph.updateNode(node.id,{fills,pluginData:node.pluginData.filter(entry=>!(entry.pluginId===PLUGIN&&entry.key===KEY))});
    }catch{/* Keep the visual fallback when metadata is invalid. */}
  }
}
/** Caller owns an isolated export graph. Keep vector shapes/text editable and
 * flatten only the paint texture, capped to 2048 pixels per edge. */
export function bakeProceduralPaints(graph:SceneGraph,ck:CanvasKit,includePatterns=false):number {
  installProceduralPaints();let count=0;const renderer=new SkiaRenderer(ck,ck.MakeSurface(64,64)!);
  const supported=(paint:Fill)=>proceduralPaint(paint)||includePatterns&&paint.type==="PATTERN";
  try{
    for(const node of [...graph.nodes.values()]){
      if(!node.fills.some(supported))continue;
      if(node.width<=0||node.height<=0)continue;
      const records:{index:number;hash:string;paint:Fill}[]=[];
      const fills=node.fills.map((paint,index)=>{
        if(!supported(paint))return paint;
        const temporary=graph.createNode("RECTANGLE",graph.getPages()[0]!.id,{width:node.width,height:node.height,fills:[{...paint,color:renderer.resolveFillColor(paint,index,node,graph),opacity:1,blendMode:"NORMAL"}]});
        let bytes:Uint8Array|null;
        try{renderer.invalidateAllPictures();bytes=renderDesignNodes(ck,renderer,graph,graph.getPages()[0]!.id,[temporary.id],{format:"PNG",scale:Math.min(1,2048/Math.max(node.width,node.height))});}finally{graph.deleteNode(temporary.id);}
        if(!bytes)throw new Error("A texture paint could not be rendered for export");
        const hash=computeImageHash(bytes);graph.images.set(hash,bytes);records.push({index,hash,paint:structuredClone(paint)});count++;
        return {type:"IMAGE",imageHash:hash,imageScaleMode:"FILL",color:paint.color,opacity:paint.opacity,visible:paint.visible,blendMode:paint.blendMode} as Fill;
      });
      graph.updateNode(node.id,{fills,pluginData:[...node.pluginData.filter(entry=>!(entry.pluginId===PLUGIN&&entry.key===KEY)),{pluginId:PLUGIN,key:KEY,value:JSON.stringify(records)}]});
    }
    return count;
  }finally{renderer.destroy();}
}
