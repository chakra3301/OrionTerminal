import { describe, it, expect } from "vitest";
import { SceneGraph, getSharedStyles } from "@open-pencil/scene-graph";
import { deserializeGraph, serializeGraph } from "./document";
import { createEditor } from "@open-pencil/core/editor";
import { FigmaAPI } from "@open-pencil/core/figma-api";
import { ALL_TOOLS } from "@open-pencil/core/tools";
import { executePencilTool } from "./toolExecution";
import { exportFigFile, parseFigFile } from "@open-pencil/core/io";
import { convertFigImageModes } from "./figPaintCompatibility";

describe("authoritative design graph persistence",()=>{
  it("normalizes schema stretch paints in saved projects while retaining original source records",()=>{
    const graph=new SceneGraph(),node=graph.createNode("RECTANGLE",graph.getPages()[0]!.id,{fills:[{type:"IMAGE",color:{r:0,g:0,b:0,a:1},visible:true,opacity:1,imageHash:"source",imageScaleMode:"CROP"}]});
    (node.fills[0] as unknown as Record<string,unknown>).imageScaleMode="STRETCH";
    const source=node.source as unknown as Record<string,unknown>;source.preservedPaint={type:"IMAGE",imageScaleMode:"STRETCH"};
    const restored=deserializeGraph(serializeGraph(graph)),paint=restored.getNode(node.id)!.fills[0]!;
    expect(paint.imageScaleMode).toBe("CROP");expect(paint.imageTransform).toEqual({m00:1,m01:0,m02:0,m10:0,m11:1,m12:0});
    expect((restored.getNode(node.id)!.source as unknown as Record<string,unknown>).preservedPaint).toEqual(source.preservedPaint);
    convertFigImageModes(restored,"export");expect(paint.imageScaleMode).toBe("STRETCH");
    delete paint.imageTransform;paint.imageScaleMode="CROP";convertFigImageModes(restored,"export");expect(paint.imageScaleMode).toBe("FILL");
    expect((node.fills[0] as unknown as Record<string,unknown>).imageScaleMode).toBe("STRETCH");
  });
  it("retains variables, components, binary geometry, image bytes and source metadata",()=>{
    const graph=new SceneGraph();const page=graph.getPages()[0]!;
    const component=graph.createNode("COMPONENT",page.id,{name:"Button",width:120,height:40});
    graph.createNode("TEXT",component.id,{text:"Hello",fontWeight:600});
    graph.createInstance(component.id,page.id);
    const collection=graph.createCollection("Brand");graph.createVariable("Accent","COLOR",collection.id,{r:1,g:0,b:0,a:1});
    graph.images.set("image",new Uint8Array([137,80,78,71]));graph.figSchemaDeflated=new Uint8Array([1,2,3]);
    const restored=deserializeGraph(serializeGraph(graph));
    expect(serializeGraph(restored)).toBe(serializeGraph(graph));
    expect(restored.getInstances(component.id)).toHaveLength(1);
    restored.syncInstances(component.id);
    expect(restored.getNode(component.id)?.childIds).toHaveLength(1);
  });
  it("rejects orphaned layers and cycles before replacing a live project",()=>{
    const graph=new SceneGraph();graph.getPages()[0]!.childIds.push(graph.rootId);
    expect(()=>deserializeGraph(serializeGraph(graph))).toThrow();
  });
  it("runs an upstream mutation as an undoable atomic tool",()=>{
    const editor=createEditor();const figma=new FigmaAPI(editor.graph);
    const create=ALL_TOOLS.find(t=>t.name==="create_shape")!;
    executePencilTool(editor,figma,create,{type:"RECTANGLE",x:20,y:30,width:80,height:50,name:"Created"});
    const children=editor.graph.getChildren(editor.state.currentPageId);expect(children).toHaveLength(1);
    editor.undoAction();expect(editor.graph.getChildren(editor.state.currentPageId)).toHaveLength(0);
    editor.redoAction();expect(editor.graph.getChildren(editor.state.currentPageId)).toHaveLength(1);editor.dispose();
  });
  it("exports and reimports a real .fig document",async()=>{
    const graph=new SceneGraph();const page=graph.getPages()[0]!;graph.createNode("RECTANGLE",page.id,{name:"Roundtrip",x:12,y:24,width:120,height:80,cornerRadius:8});
    const bytes=await exportFigFile(graph);const restored=await parseFigFile(new Uint8Array(bytes).buffer,{populate:"all"});
    const node=[...restored.nodes.values()].find(n=>n.name==="Roundtrip");expect(node).toMatchObject({x:12,y:24,width:120,height:80,cornerRadius:8});
  });
  it("retains shared paint style definitions and linked stroke references in .fig files",async()=>{
    const graph=new SceneGraph(),page=graph.getPages()[0]!;
    const internal=graph.addPage("XDesign styles");graph.updateNode(internal.id,{internalOnly:true});
    const template=graph.createNode("RECTANGLE",internal.id,{name:"Brand / Accent",sharedStyleType:"FILL",internalOnly:true,fills:[{type:"SOLID",color:{r:1,g:.2,b:.1,a:1},opacity:.8,visible:true}]});
    graph.updateNode(template.id,{source:{...template.source,id:"1:100"}});
    graph.createNode("RECTANGLE",page.id,{name:"Styled outline",strokeStyleId:"1:100",strokes:[{color:{r:1,g:.2,b:.1,a:1},opacity:.8,visible:true,weight:7,align:"OUTSIDE"}]});
    const restored=await parseFigFile(new Uint8Array(await exportFigFile(graph)).buffer,{populate:"all"});
    const styles=getSharedStyles(restored,"stroke"),node=[...restored.nodes.values()].find(node=>node.name==="Styled outline")!;
    expect(styles).toHaveLength(1);expect(node.strokeStyleId).toBe(styles[0]!.id);expect(node.strokes[0]).toMatchObject({weight:7,align:"OUTSIDE",opacity:expect.closeTo(.8,6)});
    expect(styles[0]?.name).toBe("Brand / Accent");
  });

});
