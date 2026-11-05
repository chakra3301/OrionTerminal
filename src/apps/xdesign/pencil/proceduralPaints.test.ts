// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import { SkiaRenderer } from "@open-pencil/core/canvas";
import { getCanvasKit } from "@open-pencil/core/canvaskit";
import { parseFigFile } from "@open-pencil/core/io";
import type { CanvasKit, Image } from "canvaskit-wasm";
import type { Fill } from "@open-pencil/scene-graph";
import { installProceduralPaints, renderDesignNodes } from "./proceduralPaints";
import { deserializeGraph, serializeGraph } from "./document";
import { exportFigImageCompatible, convertFigImageModes } from "./figPaintCompatibility";
import { bakeProceduralPaints } from "./proceduralExport";
let ck:CanvasKit,editor:Editor,renderer:SkiaRenderer;
beforeAll(async()=>{ck=await getCanvasKit();installProceduralPaints();});
beforeEach(()=>{editor=createEditor();renderer=new SkiaRenderer(ck,ck.MakeSurface(100,100)!);editor.setCanvasKit(ck,renderer);});afterEach(()=>{renderer.destroy();editor.dispose();});
const pixel=(image:Image,x:number,y:number)=>[...image.readPixels(x,y,{width:1,height:1,alphaType:ck.AlphaType.Unpremul,colorType:ck.ColorType.RGBA_8888,colorSpace:ck.ColorSpace.SRGB})!];
const fill:Fill={type:"CUSTOM",customEffectId:"orion.checker",color:{r:1,g:0,b:0,a:1},opacity:.5,visible:true};
function render(paint:Fill){const node=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{width:48,height:48,fills:[paint]});const bytes=renderDesignNodes(ck,renderer,editor.graph,editor.state.currentPageId,[node.id],{format:"PNG",scale:1})!;return {node,image:ck.MakeImageFromEncoded(bytes)!};}
it("renders transparent custom textures with fill opacity and preserves shader data through save and fig export",async()=>{
  const {node,image}=render(fill);try{expect(pixel(image,18,6)).toEqual([255,0,0,128]);expect(pixel(image,6,6)[3]).toBe(0);}finally{image.delete();}
  const graph=deserializeGraph(serializeGraph(editor.graph));expect(graph.getNode(node.id)!.fills[0]).toEqual(fill);
  const bytes=await exportFigImageCompatible(graph,ck,renderer,editor.state.currentPageId),reopened=await parseFigFile(new Uint8Array(bytes).buffer);convertFigImageModes(reopened,"import");const paint=[...reopened.nodes.values()].find(n=>n.name===node.name&&n.type==="RECTANGLE")!.fills[0]!;expect(paint.type).toBe("CUSTOM");expect(paint.customEffectId).toBe(fill.customEffectId);
});
it("renders deterministic colored noise and honors zero density",()=>{
  const noise:Fill={...fill,type:"NOISE",noiseType:"MULTITONE",noiseSize:{x:2,y:2},density:1,opacity:1};const a=render(noise),b=render(noise),empty=render({...noise,density:0});
  try{expect(pixel(a.image,7,9)).toEqual(pixel(b.image,7,9));expect(pixel(a.image,7,9)).not.toEqual(pixel(a.image,17,19));expect(pixel(empty.image,7,9)[3]).toBe(0);}finally{a.image.delete();b.image.delete();empty.image.delete();}
});
it("repeats procedural source paints inside patterns with transparent pixels",()=>{
  const source=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{width:24,height:24,fills:[{...fill,opacity:1}]});const result=render({...fill,type:"PATTERN",sourceNodeId:source.id,opacity:1});
  try{expect(pixel(result.image,18,6)).toEqual([255,0,0,255]);expect(pixel(result.image,42,6)).toEqual([255,0,0,255]);expect(pixel(result.image,30,6)[3]).toBe(0);}finally{result.image.delete();}
});
it("retains ordinary pattern dependencies in selection exports and bakes identical pattern pixels for vector formats",()=>{
  const source=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{width:24,height:24,fills:[{...fill,type:"SOLID",color:{r:0,g:0,b:1,a:1},opacity:1}]});
  const result=render({...fill,type:"PATTERN",sourceNodeId:source.id,opacity:1});
  try{
    expect(pixel(result.image,30,6)).toEqual([0,0,255,255]);
    const exported=deserializeGraph(serializeGraph(editor.graph));expect(bakeProceduralPaints(exported,ck,true)).toBe(1);expect(result.node.fills[0]!.type).toBe("PATTERN");
    renderer.invalidateAllPictures();const bytes=renderDesignNodes(ck,renderer,exported,editor.state.currentPageId,[result.node.id],{format:"PNG",scale:1})!,baked=ck.MakeImageFromEncoded(bytes)!;
    try{expect(pixel(baked,30,6)).toEqual(pixel(result.image,30,6));}finally{baked.delete();}
  }finally{result.image.delete();}
});
it("bakes a texture's resolved variable color while preserving its editable binding",()=>{
  const result=render(fill);result.image.delete();const collection=editor.graph.createCollection("Theme"),accent=editor.graph.createVariable("Accent","COLOR",collection.id,{r:0,g:1,b:0,a:1});editor.graph.bindVariable(result.node.id,"fills/0/color",accent.id);
  const exported=deserializeGraph(serializeGraph(editor.graph));bakeProceduralPaints(exported,ck);
  expect(exported.getNode(result.node.id)!.boundVariables["fills/0/color"]).toBe(accent.id);
  renderer.invalidateAllPictures();const bytes=renderDesignNodes(ck,renderer,exported,editor.state.currentPageId,[result.node.id],{format:"PNG",scale:1})!,image=ck.MakeImageFromEncoded(bytes)!;
  try{expect(pixel(image,18,6)).toEqual([0,255,0,128]);expect(pixel(image,6,6)[3]).toBe(0);}finally{image.delete();}
});
