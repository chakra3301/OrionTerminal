// @vitest-environment node
import { afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { createEditor,type Editor } from '@open-pencil/core/editor';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { renderNodesToImage } from '@open-pencil/core/io';
import type { CanvasKit,Image } from 'canvaskit-wasm';
import { canvasPreviewPosition,hidePreviewSource } from './canvasPreview';
import { serializeGraph } from './document';
let ck:CanvasKit,editor:Editor,renderer:SkiaRenderer,restore=()=>{};
beforeAll(async()=>{ck=await getCanvasKit();});
beforeEach(()=>{editor=createEditor();renderer=new SkiaRenderer(ck,ck.MakeSurface(160,160)!);editor.setCanvasKit(ck,renderer);editor.state.panX=0;editor.state.panY=0;editor.state.zoom=1;});
afterEach(()=>{restore();renderer.destroy();editor.dispose();});
const pixel=(image:Image)=>[...image.readPixels(55,55,{width:1,height:1,alphaType:ck.AlphaType.Unpremul,colorType:ck.ColorType.RGBA_8888,colorSpace:ck.ColorSpace.SRGB})!];
const viewport=()=>{renderer.renderFromEditorState(editor.state,editor.graph,editor.textEditor,160,160,false);const image=renderer.surface.makeImageSnapshot();try{return pixel(image);}finally{image.delete();}};
describe('on-canvas interactive preview presentation',()=>{
  it('removes old control pixels from warmed ancestor pictures, retains export pixels and restores on close',async()=>{
    const graph=editor.graph,page=editor.state.currentPageId;
    const main=graph.createNode('COMPONENT',page,{x:500,width:20,height:20,fills:[{type:'SOLID',color:{r:1,g:0,b:0,a:1},opacity:1,visible:true}]});
    const frame=graph.createNode('FRAME',page,{x:40,y:40,width:80,height:80,fills:[{type:'SOLID',color:{r:0,g:1,b:0,a:1},opacity:1,visible:true}]});
    const instance=graph.createInstance(main.id,frame.id,{x:10,y:10})!,before=serializeGraph(graph);
    expect(viewport()).toEqual([255,0,0,255]);expect(viewport()).toEqual([255,0,0,255]);
    restore=hidePreviewSource(editor,instance.id);expect(viewport()).toEqual([0,255,0,255]);expect(serializeGraph(graph)).toBe(before);
    const bytes=await renderNodesToImage(ck,renderer,graph,page,[instance.id],{format:'PNG',scale:1});const image=ck.MakeImageFromEncoded(bytes!)!;
    try{expect([...image.readPixels(5,5,{width:1,height:1,alphaType:ck.AlphaType.Unpremul,colorType:ck.ColorType.RGBA_8888,colorSpace:ck.ColorSpace.SRGB})!]).toEqual([255,0,0,255]);}finally{image.delete();}
    expect(viewport()).toEqual([0,255,0,255]);restore();expect(viewport()).toEqual([255,0,0,255]);expect(serializeGraph(graph)).toBe(before);
  });
  it('maps private native bounds to the original canvas at its actual pan and zoom',()=>{
    expect(canvasPreviewPosition({x:80,y:60},{x:0,y:0},{minX:-4,minY:-3},{panX:10,panY:20,zoom:2})).toEqual({left:162,top:134,transform:'scale(2)',transformOrigin:'0 0'});
  });
});
