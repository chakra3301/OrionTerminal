import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PhotoTiles } from "./PhotoTiles";
import { TileSurface } from "./strokeCanvas";
import type { PhotoDocument } from "./types";
import type { DisplayTile } from "./tiles";
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>true,invoke:native.invoke}));
const doc:PhotoDocument={id:"photo",version:"version",name:"Image",width:4096,height:4096,previewWidth:2048,previewHeight:2048,bundlePath:"",previewPath:"",originalPath:null};
let root:Root,container:HTMLDivElement,frames:FrameRequestCallback[],create:ReturnType<typeof vi.fn<()=>string>>,revoke:ReturnType<typeof vi.fn<(url:string)=>void>>;
const stage=createRef<HTMLDivElement>(),image=createRef<HTMLDivElement>(),status=vi.fn();
const flush=async()=>act(async()=>{while(frames.length){frames.shift()!(0);for(let i=0;i<60;i++)await Promise.resolve();}});
const render=async(zoom:number,hasSelection:boolean,selectionDisplay:"outline"|"overlay"|"both"="both",document=doc,edges=true)=>{
  image.current!.getBoundingClientRect=()=>({left:0,top:0,width:document.width*zoom,height:document.height*zoom}) as DOMRect;
  await act(async()=>root.render(<PhotoTiles document={document} projectId="project" zoom={zoom} hasSelection={hasSelection} selectionDisplay={selectionDisplay} edges={edges} viewKey="view" stage={stage} image={image} status={status}/>));await flush();
};
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});frames=[];
  vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});vi.stubGlobal("cancelAnimationFrame",vi.fn());
  vi.stubGlobal("devicePixelRatio",2);create=vi.fn(()=>`blob:${create.mock.calls.length}`);revoke=vi.fn();vi.spyOn(URL,"createObjectURL").mockImplementation(create);vi.spyOn(URL,"revokeObjectURL").mockImplementation(revoke);
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(null);
  stage.current=document.createElement("div");image.current=document.createElement("div");
  Object.defineProperties(stage.current,{clientWidth:{value:500},clientHeight:{value:500}});stage.current.getBoundingClientRect=()=>({left:0,top:0,width:500,height:500}) as DOMRect;
  native.invoke.mockReset().mockImplementation(async(_command,rect)=>({...rect,png:rect.selectionOnly?"":"AA==",pixelWidth:Math.ceil(rect.width/rect.scale),pixelHeight:Math.ceil(rect.height/rect.scale),selectionPath:"M0 0H10",selectionTruncated:false,...(rect.selectionOverlay?{selectionPng:"AA=="}:{})}));
  container=document.createElement("div");document.body.append(container);root=createRoot(container);status.mockClear();
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("keeps fit pixels and requests native soft selection coverage below 50% zoom",async()=>{
  await render(.25,true);
  expect(native.invoke.mock.calls.length).toBe(4);
  expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_tile",expect.objectContaining({scale:2,selectionOnly:true,selectionOverlay:true,viewKey:"view"}));
  expect(container.querySelectorAll("img")).toHaveLength(4);expect(container.querySelectorAll("svg")).toHaveLength(4);
  expect(container.querySelector(".has-color")).toBeNull();
  await render(.25,true,"overlay");expect(container.querySelector("svg")).toBeNull();
  await render(.25,false);expect(container.querySelector("img")).toBeNull();
});
it("hides the marching ants, and the overlay standing in for a truncated outline, when selection edges are hidden",async()=>{
  await render(.25,true,"both",doc,false);expect(container.querySelector("svg")).toBeNull();expect(container.querySelectorAll("img")).toHaveLength(4);
  native.invoke.mockImplementation(async(_command,rect)=>({...rect,png:"",pixelWidth:Math.ceil(rect.width/rect.scale),pixelHeight:Math.ceil(rect.height/rect.scale),selectionPath:"",selectionTruncated:true,selectionPng:"AA=="}));
  await render(.25,true,"outline",{...doc,version:"truncated"});expect(container.querySelectorAll("img")).toHaveLength(4);
  await render(.25,true,"outline",{...doc,version:"truncated"},false);expect(container.querySelector("img")).toBeNull();
});
it("requests full-resolution pixels at actual size and releases color and selection URLs on close",async()=>{
  await render(1,true);expect(native.invoke.mock.calls.every(([,rect])=>rect.scale===1&&!rect.selectionOnly)).toBe(true);
  expect(container.querySelectorAll("canvas")).toHaveLength(1);expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(container.querySelector(".has-color")).toBeTruthy();
  act(()=>root.unmount());expect(revoke).toHaveBeenCalledTimes(2);
  root=createRoot(container);
});
it("rejects late tiles after an image version changes",async()=>{
  const pending:((value:unknown)=>void)[]=[];native.invoke.mockImplementation((_command,rect)=>new Promise(resolve=>pending.push(value=>resolve({...rect,...value as object}))));
  await render(1,false);await render(1,false,"both",{...doc,version:"new-version"});
  await act(async()=>pending[0]!({png:"AA==",selectionPath:"",selectionTruncated:false}));expect(create).not.toHaveBeenCalled();
  await act(async()=>pending[1]!({png:"AA==",selectionPath:"",selectionTruncated:false}));expect(create).toHaveBeenCalledTimes(1);
});
it("keeps the previous version's tiles in place until the new version's visible set has decoded",async()=>{
  const ready=vi.fn(),show=async(document:PhotoDocument)=>{await act(async()=>root.render(<PhotoTiles document={document} projectId="project" zoom={1} hasSelection={false} viewKey="view" stage={stage} image={image} status={status} ready={ready}/>));await flush();};
  image.current!.getBoundingClientRect=()=>({left:0,top:0,width:doc.width,height:doc.height}) as DOMRect;
  const drawn=vi.spyOn(TileSurface.prototype,"show"),drawnUrl=()=>(drawn.mock.lastCall![1] as DisplayTile).url;
  await show(doc);const shown=container.querySelector("canvas")!,before=drawnUrl();expect(drawn.mock.lastCall![0]).toBe(shown);expect(ready).toHaveBeenLastCalledWith(1,"version");
  const pending:(()=>void)[]=[];native.invoke.mockImplementation((_command,rect)=>new Promise(resolve=>pending.push(()=>resolve({...rect,png:"AA==",pixelWidth:rect.width,pixelHeight:rect.height,selectionPath:"",selectionTruncated:false}))));
  await show({...doc,version:"new-version"});
  expect(container.querySelector("canvas")).toBe(shown);expect(drawnUrl()).toBe(before);expect(revoke).not.toHaveBeenCalled();expect(ready).toHaveBeenCalledOnce();
  await act(async()=>pending[0]!());await flush();
  expect(container.querySelector("canvas")).toBe(shown);expect(drawn.mock.lastCall![0]).toBe(shown);expect(drawnUrl()).not.toBe(before);expect(revoke).toHaveBeenCalledWith(before);expect(ready).toHaveBeenLastCalledWith(1,"new-version");
});
