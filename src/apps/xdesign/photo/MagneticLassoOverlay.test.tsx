import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MagneticLassoOverlay } from "./MagneticLassoOverlay";
import { usePhotoWorkspace } from "./runtime";
import { xdesignActivityReason } from "../runtimeActivity";
import type { PhotoDocument, PhotoState } from "./types";
import type { MagneticRequest } from "./magneticLasso";
const native = vi.hoisted(() => ({enabled:true,invoke:vi.fn(),run:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>native.enabled,invoke:native.invoke,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:native.run}));
const doc: PhotoDocument={id:"magnetic",version:"v1",name:"Edges",width:100,height:80,previewWidth:100,previewHeight:80,bundlePath:"",previewPath:"",originalPath:null};
let root: Root, container: HTMLDivElement; const changeWidth=vi.fn();
const render=async(version="v1",mode="replace",pressure=false)=>act(async()=>root.render(<section className="xd-photo"><MagneticLassoOverlay key={version} document={{...doc,version}} projectId="project" viewKey="view" options={{width:10,contrast:10,frequency:0,stylusPressure:pressure,feather:2,antiAlias:false}} mode={mode} zoom={1} ready changeWidth={changeWidth}/><button>Another canvas control</button></section>));
const surface=()=>container.querySelector<SVGSVGElement>("svg")!;
const pointer=async(type:string,x:number,y:number,extra:MouseEventInit={},pen=false)=>act(async()=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y,...extra});Object.defineProperties(event,{pointerId:{value:7},pointerType:{value:pen?"pen":"mouse"},pressure:{value:pen ? .5 : 0}});surface().dispatchEvent(event);});
const key=async(value:string)=>act(async()=>surface().dispatchEvent(new KeyboardEvent("keydown",{key:value,bubbles:true,cancelable:true})));
beforeEach(async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); native.enabled=true; native.invoke.mockReset().mockImplementation(async(_id:string,{params}:{params:MagneticRequest})=>({points:params.guide,snapped:false,visited:params.guide.length}));native.run.mockReset().mockResolvedValue({});changeWidth.mockReset();
  usePhotoWorkspace.setState({projectId:"project",documentId:doc.id,stateVersion:doc.version,busy:false,state:{features:{magneticLasso:true},viewKey:"view"} as PhotoState});
  container=document.createElement("div");document.body.append(container);root=createRoot(container);await render();
  surface().getBoundingClientRect=()=>({left:0,top:0,width:100,height:80} as DOMRect);surface().setPointerCapture=vi.fn();surface().hasPointerCapture=()=>false;
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe("magnetic canvas integration",()=>{
  it("closes Command-click from the cursor without retracing the closing chord",async()=>{
    await pointer("pointerdown",10,10);await pointer("pointerdown",30,10,{altKey:true});await pointer("pointerup",30,10,{altKey:true});
    await pointer("pointermove",40,30);await pointer("pointerdown",40,30,{metaKey:true});
    expect(native.invoke.mock.lastCall![1].params.guide.at(-1)).toEqual([40,30]);expect(native.run.mock.lastCall![1].points).toEqual([[10,10],[30,10],[40,30]]);expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it("routes active outline shortcuts across the editor while preserving text input and IME",async()=>{
    await pointer("pointerdown",10,10);await pointer("pointerdown",30,10,{altKey:true});await pointer("pointerup",30,10,{altKey:true});
    const control=container.querySelector('section > button')!;
    const activation=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});await act(async()=>control.dispatchEvent(activation));expect(activation.defaultPrevented).toBe(false);expect(native.run).not.toHaveBeenCalled();
    await act(async()=>control.dispatchEvent(new KeyboardEvent("keydown",{key:"Delete",bubbles:true})));expect(container.querySelectorAll('.xd-photo-magnetic-anchor').length).toBe(1);
    await act(async()=>control.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",isComposing:true,bubbles:true})));expect(xdesignActivityReason()).toContain("magnetic selection");
    const input=document.createElement("input");container.querySelector("section")!.append(input);await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(xdesignActivityReason()).toContain("magnetic selection");
    await act(async()=>control.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();expect(native.run).not.toHaveBeenCalled();
  });
  it("starts with modified selection mode, traces natively and closes one edit",async()=>{
    await pointer("pointerdown",10,10,{shiftKey:true,altKey:true});expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toContain("magnetic selection");
    await pointer("pointermove",30,10);await pointer("pointerdown",30,10);await pointer("pointermove",30,30);await key("Enter");
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_magnetic_trace",expect.objectContaining({photoId:"magnetic",version:"v1",viewKey:"view",params:expect.objectContaining({width:10,contrast:10})}));
    expect(native.run).toHaveBeenCalledOnce();expect(native.run.mock.lastCall).toEqual(["select.xdesignMagneticLasso",{points:[[10,10],[30,10],[30,30]],mode:"intersect",feather:2,antiAlias:false}]);expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
  });
  it("supports straight Alt-click and freehand Alt-drag without tracing those segments",async()=>{
    await pointer("pointerdown",10,10);await pointer("pointerdown",30,10,{altKey:true});await pointer("pointerup",30,10,{altKey:true});
    await pointer("pointerdown",30,30,{altKey:true});await pointer("pointermove",40,30,{altKey:true,buttons:1});await pointer("pointerup",40,40,{altKey:true});await key("Enter");
    expect(native.invoke).not.toHaveBeenCalled();expect(native.run.mock.lastCall![1].points).toEqual([[10,10],[30,10],[30,30],[40,30],[40,40]]);
  });
  it("cancels and discards late feedback and releases its project lease on remount",async()=>{
    let resolve!:(value:unknown)=>void;native.invoke.mockImplementationOnce(()=>new Promise(done=>resolve=done));await pointer("pointerdown",10,10);await pointer("pointermove",30,20);await act(async()=>{await new Promise(done=>setTimeout(done,50));});
    await key("Escape");expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();await act(async()=>resolve({points:[[10,10],[30,20]],snapped:true,visited:10}));expect(container.textContent).toContain("Click to start");expect(native.run).not.toHaveBeenCalled();
    await pointer("pointerdown",10,10);await render("v2");expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
  });
  it("guards unsupported native engines and busy images, and exposes width/pressure controls",async()=>{
    await act(async()=>usePhotoWorkspace.setState({state:{features:{},viewKey:"view"} as PhotoState}));await pointer("pointerdown",10,10);expect(container.textContent).toContain("requires an updated native engine");expect(xdesignActivityReason()).toBeNull();
    await act(async()=>usePhotoWorkspace.setState({state:{features:{magneticLasso:true},viewKey:"view"} as PhotoState,busy:true}));await pointer("pointerdown",10,10);expect(xdesignActivityReason()).toBeNull();await act(async()=>usePhotoWorkspace.setState({busy:false}));await key("]");expect(changeWidth).toHaveBeenCalledWith(11);
    await render("v1","replace",true);await pointer("pointerdown",10,10,{},true);await pointer("pointermove",30,20,{},true);await pointer("pointerdown",30,20,{},true);expect(native.invoke.mock.lastCall![1].params.width).toBe(6);await key("Escape");
  });
  it("keeps a failed close retryable and prevents duplicate publication",async()=>{
    await pointer("pointerdown",10,10);await pointer("pointerdown",30,10,{altKey:true});await pointer("pointerup",30,10,{altKey:true});await pointer("pointerdown",30,30,{altKey:true});await pointer("pointerup",30,30,{altKey:true});
    native.run.mockRejectedValueOnce(new Error("selection too large"));await key("Enter");expect(container.textContent).toContain("selection too large");expect(xdesignActivityReason()).toContain("magnetic selection");
    let finish!:()=>void;native.run.mockImplementationOnce(()=>new Promise<void>(resolve=>finish=resolve));await key("Enter");await key("Enter");expect(native.run).toHaveBeenCalledTimes(2);await act(async()=>finish());expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
  });
});
