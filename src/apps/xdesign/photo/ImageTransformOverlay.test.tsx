import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageTransformOverlay } from "./ImageTransformOverlay";
import { FreeTransformBar } from "./FreeTransformBar";
import { TRANSFORM_REFERENCE_KEY, beginFreeTransform, cancelFreeTransform, loadShowReference, setShowReference, useFreeTransform } from "./freeTransform";
import { usePhotoWorkspace } from "./runtime";
import { xdesignActivityReason } from "../runtimeActivity";
import type { PhotoDocument, PhotoLayer } from "./types";
const native=vi.hoisted(()=>({run:vi.fn()}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:native.run}));
vi.mock("./commandPreview",()=>({usePhotoCommandPreview:()=>({url:"blob:preview"})}));
const image:PhotoDocument={id:"photo",version:"v1",name:"Image",width:300,height:200,previewWidth:300,previewHeight:200,bundlePath:"",previewPath:"",originalPath:null};
const layer:PhotoLayer={id:1,name:"Layer",kind:"Raster",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,bounds:[20,30,100,60]};
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);native.run.mockReset().mockResolvedValue({});usePhotoWorkspace.setState({busy:false,quiet:false,projectId:"project",state:null});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>{cancelFreeTransform();root.unmount();});useFreeTransform.setState({held:null});setShowReference(false);localStorage.removeItem(TRANSFORM_REFERENCE_KEY);container.remove();vi.unstubAllGlobals();});
const shown=(work:Promise<unknown>)=>work.then(()=>{},()=>{});
const warp=vi.fn();
const render=(doc=image)=>act(async()=>root.render(<><FreeTransformBar untilShown={shown} warp={warp}/><ImageTransformOverlay document={doc} layer={layer} zoom={1} untilShown={shown}/></>));
const pointer=(type:string,x:number,y:number,init:MouseEventInit={})=>Object.assign(new MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0,...init}),{pointerId:1,isPrimary:true});
function stage(){const svg=container.querySelector("svg.xd-photo-main-transform")!;svg.getBoundingClientRect=()=>({left:0,top:0,width:300,height:200} as DOMRect);svg.setPointerCapture=vi.fn();svg.hasPointerCapture=()=>true;svg.releasePointerCapture=vi.fn();return svg;}
const el=(label:string)=>container.querySelector(`[aria-label="${label}"]`)!;
const drag=async(label:string,from:[number,number],to:[number,number],init:MouseEventInit={})=>{const svg=stage();await act(async()=>el(label).dispatchEvent(pointer("pointerdown",...from,init)));await act(async()=>svg.dispatchEvent(pointer("pointermove",...to,init)));await act(async()=>svg.dispatchEvent(pointer("pointerup",...to,init)));};
const keydown=(key:string,target:EventTarget=window)=>act(async()=>{target.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true}));});
const type=(label:string,value:string)=>act(async()=>{const input=el(label) as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});
const round=(matrix:number[])=>matrix.map(value=>Math.round(value*1000)/1000+0);
const session=()=>useFreeTransform.getState().session;

it("moves the layer right away when the Move tool's box is dragged and releases its project guard",async()=>{
  await render();expect(session()).toBeNull();
  await drag("Move selected image layer",[70,60],[90,80]);
  expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith("edit.transform",{layer:1,matrix:[1,0,-0,1,20,20],interpolation:"bicubic"});
  expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();expect(session()).toBeNull();
});
it("keeps the preview up after a commit and clears the session",async()=>{
  let finish!:()=>void;await render();const held=new Promise<void>(resolve=>{finish=resolve;});
  await act(async()=>root.render(<ImageTransformOverlay document={image} layer={layer} zoom={1} untilShown={()=>held}/>));
  await drag("Move selected image layer",[70,60],[90,80]);expect(session()).toBeNull();expect(container.querySelector("img.xd-photo-main-transform-preview")).not.toBeNull();
  await act(async()=>{finish();await held;});expect(container.querySelector("img.xd-photo-main-transform-preview")).toBeNull();
});
it("keeps the box where it was dropped until the committed image is shown",async()=>{
  let finish!:()=>void;const held=new Promise<void>(resolve=>{finish=resolve;});
  await act(async()=>root.render(<ImageTransformOverlay document={image} layer={layer} zoom={1} untilShown={()=>held}/>));
  const points=()=>el("Move selected image layer").getAttribute("points");
  await drag("Move selected image layer",[70,60],[90,80]);expect(points()).toBe("40,50 140,50 140,110 40,110");
  await act(async()=>{finish();await held;});expect(points()).toBe("20,30 120,30 120,90 20,90");
});
it("accumulates a handle drag as a pending transform and commits once on Enter",async()=>{
  await render();await drag("Resize image layer bottom right",[120,90],[220,150]);
  expect(native.run).not.toHaveBeenCalled();expect(session()).not.toBeNull();expect(usePhotoWorkspace.getState().busy).toBe(true);expect(el("Commit transform")).toBeTruthy();
  await drag("Move selected image layer",[100,80],[110,90]);expect(native.run).not.toHaveBeenCalled();
  await keydown("Enter");
  expect(native.run).toHaveBeenCalledOnce();expect(native.run.mock.calls[0]![0]).toBe("edit.transform");
  expect(round(native.run.mock.calls[0]![1].matrix)).toEqual([2,0,0,2,-10,-20]);
  expect(session()).toBeNull();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
});
it("Shift toggles proportions and Alt scales from the centre",async()=>{
  await render();await drag("Resize image layer bottom right",[120,90],[220,90],{shiftKey:true});
  expect(session()!.settings.width).toBeCloseTo(200);expect(session()!.settings.height).toBeCloseTo(100);
  await act(async()=>cancelFreeTransform());await drag("Resize image layer bottom right",[120,90],[170,90],{altKey:true});
  expect(session()!.settings.width).toBeCloseTo(200);expect(session()!.settings.height).toBeCloseTo(200);expect(session()!.settings.x).toBeCloseTo(70);
});
it("rotates from just outside a corner, snapping to 15 degrees with Shift",async()=>{
  await render();await drag("Rotate image layer bottom right",[130,100],[70,160],{shiftKey:true});
  expect(session()!.settings.angle).toBe(60);expect(native.run).not.toHaveBeenCalled();
});
it("cancels on Escape, a stale version and a cancelled pointer without creating image edits",async()=>{
  await render();await drag("Resize image layer bottom right",[120,90],[220,150]);await keydown("Escape");
  expect(session()).toBeNull();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(native.run).not.toHaveBeenCalled();
  const svg=stage();await act(async()=>el("Resize image layer bottom right").dispatchEvent(pointer("pointerdown",120,90)));await act(async()=>svg.dispatchEvent(pointer("pointercancel",120,90)));
  expect(session()).toBeNull();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
});
it("enters from the menu with a centre reference point, commits on double-click and ignores an unchanged box",async()=>{
  await render();await act(async()=>{beginFreeTransform(image,layer,undefined);});
  expect(container.querySelector("circle[data-pivot]")).toBeNull();await act(async()=>(el("Toggle reference point") as HTMLInputElement).click());
  expect(["cx","cy"].map(name=>container.querySelector("circle[data-pivot]")!.getAttribute(name))).toEqual(["70","60"]);await act(async()=>(el("Toggle reference point") as HTMLInputElement).click());await keydown("Enter");expect(native.run).not.toHaveBeenCalled();expect(session()).toBeNull();expect(usePhotoWorkspace.getState().busy).toBe(false);
  await act(async()=>{beginFreeTransform(image,layer,undefined);});await drag("Move selected image layer",[70,60],[80,60]);expect(native.run).not.toHaveBeenCalled();
  await act(async()=>el("Move selected image layer").dispatchEvent(new MouseEvent("dblclick",{bubbles:true})));
  expect(native.run).toHaveBeenCalledOnce();expect(round(native.run.mock.calls[0]![1].matrix)).toEqual([1,0,0,1,10,0]);
});
it("distorts one corner and skews a side with Command-drag, committed together",async()=>{
  await render();
  await drag("Resize image layer top right",[120,30],[130,20],{metaKey:true});expect(native.run).not.toHaveBeenCalled();
  await drag("Resize image layer bottom",[70,90],[80,90],{metaKey:true});expect(native.run).not.toHaveBeenCalled();
  await keydown("Enter");
  expect(native.run).toHaveBeenCalledOnce();
  expect(native.run).toHaveBeenCalledWith("edit.transform",{layer:1,rect:[20,30,120,90],quad:[[20,30],[130,20],[130,90],[30,90]],interpolation:"bicubic"});
  expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
});
it("nudges by keyboard: a command on the Move tool's box, pending changes inside Free Transform",async()=>{
  await render();stage();
  const key=async(label:string,key:string,shiftKey=false)=>act(async()=>el(label).dispatchEvent(new KeyboardEvent("keydown",{key,shiftKey,bubbles:true})));
  await key("Move selected image layer","ArrowRight");expect(native.run).toHaveBeenLastCalledWith("edit.transform",expect.objectContaining({matrix:[1,0,0,1,1,0]}));
  await act(async()=>{beginFreeTransform(image,layer,undefined);});native.run.mockClear();
  await key("Move selected image layer","ArrowRight",true);await key("Resize image layer bottom right","ArrowRight");
  expect(native.run).not.toHaveBeenCalled();expect(session()!.settings.x).toBeGreaterThan(79);
});
it("ignores secondary buttons and drags while another operation holds the lock",async()=>{
  await render();const svg=stage();
  await act(async()=>el("Move selected image layer").dispatchEvent(pointer("pointerdown",70,60,{button:2})));expect(session()).toBeNull();
  await act(async()=>usePhotoWorkspace.setState({busy:true,quiet:false}));await act(async()=>el("Move selected image layer").dispatchEvent(pointer("pointerdown",70,60)));
  await act(async()=>svg.dispatchEvent(pointer("pointerup",70,60)));expect(session()).toBeNull();expect(native.run).not.toHaveBeenCalled();
});
it("edits the options-bar fields, keeping proportions linked until unlinked",async()=>{
  await render();await act(async()=>{beginFreeTransform(image,layer,undefined);});
  await type("Transform width (%)","150");expect(session()!.settings).toMatchObject({width:150,height:150});
  await act(async()=>(el("Transform keep proportions") as HTMLButtonElement).click());await type("Transform height (%)","120");expect(session()!.settings).toMatchObject({width:150,height:120});
  await type("Transform X (px)","80");await type("Transform Y (px)","50");await type("Transform angle (°)","30");await type("Transform horizontal skew (°)","10");await type("Transform vertical skew (°)","5");
  expect(session()!.settings).toMatchObject({x:80,y:50,angle:30,skewX:10,skewY:5});
  await type("Transform width (%)","0");expect(session()!.settings.width).toBe(150);
  await act(async()=>{const select=el("Transform interpolation") as HTMLSelectElement;select.value="nearest";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(native.run).not.toHaveBeenCalled();
  await act(async()=>(el("Commit transform") as HTMLButtonElement).click());
  expect(native.run).toHaveBeenCalledOnce();expect(native.run.mock.calls[0]![1]).toMatchObject({layer:1,interpolation:"nearest"});expect(native.run.mock.calls[0]![1].matrix).toHaveLength(6);
  expect(container.querySelector('[aria-label="Commit transform"]')).toBeNull();
});
it("Cancel restores without any edit and the Commit button stays usable during a quiet hold",async()=>{
  await render();await act(async()=>{beginFreeTransform(image,layer,undefined);});await type("Transform angle (°)","20");
  expect((el("Commit transform") as HTMLButtonElement).disabled).toBe(false);
  await act(async()=>(el("Cancel transform") as HTMLButtonElement).click());
  expect(session()).toBeNull();expect(native.run).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);
});
const mode=async(next:Parameters<typeof beginFreeTransform>[3])=>act(async()=>{beginFreeTransform(image,layer,undefined,next);});
it("Scale mode ignores Command and the rotate zones; Rotate mode rotates from a handle", async()=>{
  await render();await mode("scale");expect(container.querySelector(".xd-photo-rotate-zone")).toBeNull();
  await drag("Resize image layer bottom right",[120,90],[220,150],{metaKey:true});expect(session()!.quad).toBeNull();expect(session()!.settings.width).toBeGreaterThan(100);
  await act(async()=>cancelFreeTransform());await mode("rotate");expect(container.querySelector(".xd-photo-rotate-zone")).not.toBeNull();
  await drag("Resize image layer bottom right",[120,90],[70,140],{shiftKey:true});
  expect(session()!.quad).toBeNull();expect(session()!.settings).toMatchObject({width:100,height:100});expect(session()!.settings.angle%15).toBe(0);expect(session()!.settings.angle).not.toBe(0);
});
it("Skew mode slides a side along its axis and a corner along an adjacent side", async()=>{
  await render();await mode("skew");
  await drag("Resize image layer top",[70,30],[90,50]);expect(session()!.quad!.map(p=>p.map(Math.round))).toEqual([[40,30],[140,30],[120,90],[20,90]]);
  await act(async()=>cancelFreeTransform());await mode("skew");
  await drag("Resize image layer right",[120,60],[130,80]);expect(session()!.quad).toEqual([[20,30],[120,50],[120,110],[20,90]]);
  await drag("Resize image layer bottom left",[20,90],[30,92]);expect(session()!.quad![3]!.map(Math.round)).toEqual([30,92]);
});
it("Distort moves one corner freely; Perspective mirrors the neighbouring corner", async()=>{
  await render();await mode("distort");await drag("Resize image layer top right",[120,30],[130,20]);
  expect(session()!.quad).toEqual([[20,30],[130,20],[120,90],[20,90]]);await act(async()=>cancelFreeTransform());
  await mode("perspective");await drag("Resize image layer top right",[120,30],[110,32]);
  expect(session()!.quad!.map(p=>p.map(Math.round))).toEqual([[30,30],[110,30],[120,90],[20,90]]);
  await keydown("Enter");expect(native.run).toHaveBeenCalledWith("edit.transform",{layer:1,rect:[20,30,120,90],quad:expect.any(Array),interpolation:"bicubic"});
});
it("switching Transform entries mid-session keeps the pending shape, and an unmoved quad click leaves nothing behind", async()=>{
  await render();await mode("distort");await drag("Resize image layer top right",[120,30],[130,20]);await mode("scale");
  expect(session()!.mode).toBe("scale");expect(session()!.quad).not.toBeNull();
  await drag("Resize image layer bottom right",[120,90],[220,150]);expect(session()!.quad![2]![0]).toBeGreaterThan(130);
  await act(async()=>cancelFreeTransform());await mode("skew");await drag("Resize image layer top",[70,30],[70,30]);expect(session()!.quad).toBeNull();
  await mode("free");expect(session()!.mode).toBe("free");
});
it("lets the click through the Move tool's box when Auto-Select is on, but not during a transform", async()=>{
  const draw=(autoSelect:boolean)=>act(async()=>root.render(<ImageTransformOverlay document={image} layer={layer} zoom={1} autoSelect={autoSelect} untilShown={shown}/>));
  const polygon=()=>el("Move selected image layer") as unknown as SVGElement;
  await draw(false);expect(polygon().style.pointerEvents).toBe("");
  await draw(true);expect(polygon().style.pointerEvents).toBe("none");
  await act(async()=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:"Meta",metaKey:true}));});expect(polygon().style.pointerEvents).toBe("");
  await act(async()=>{window.dispatchEvent(new KeyboardEvent("keyup",{key:"Meta"}));});
  await act(async()=>{beginFreeTransform(image,layer,undefined);});expect(polygon().style.pointerEvents).toBe("");
});
const pressed=(label:string)=>el(label).getAttribute("aria-pressed");
const corner=(label:string)=>["cx","cy"].map(name=>Math.round(Number(el(label).getAttribute(name))*1000)/1000);
it("hides the reference point locator behind its checkbox, which is kept across relaunches and read as off when stale",async()=>{
  expect(loadShowReference()).toBe(false);
  await render();await act(async()=>{beginFreeTransform(image,layer,undefined);});
  const toggle=el("Toggle reference point") as HTMLInputElement,spot=(name:string)=>el(`Reference point ${name}`) as HTMLButtonElement;
  expect(toggle.checked).toBe(false);expect(el("Reference point location").querySelectorAll("button")).toHaveLength(9);expect(spot("top left").disabled).toBe(true);
  await act(async()=>toggle.click());expect(toggle.checked).toBe(true);expect(loadShowReference()).toBe(true);expect(spot("top left").disabled).toBe(false);expect(pressed("Reference point center")).toBe("true");
  await act(async()=>spot("bottom right").click());expect(pressed("Reference point bottom right")).toBe("true");expect(pressed("Reference point center")).toBe("false");
  await act(async()=>cancelFreeTransform());await act(async()=>{beginFreeTransform(image,layer,undefined);});expect(pressed("Reference point center")).toBe("true");
  for(const stale of ["yes","{bad","0"]){localStorage.setItem(TRANSFORM_REFERENCE_KEY,stale);expect(loadShowReference()).toBe(false);}
  await act(async()=>usePhotoWorkspace.setState({busy:true,quiet:false}));expect((el("Toggle reference point") as HTMLInputElement).disabled).toBe(true);expect(spot("top left").disabled).toBe(true);
});
it("reads X and Y at the reference point and scales, rotates and skews about it, typed or dragged",async()=>{
  await render();await act(async()=>{beginFreeTransform(image,layer,undefined);});
  await act(async()=>(el("Toggle reference point") as HTMLInputElement).click());await act(async()=>(el("Reference point top left") as HTMLButtonElement).click());
  expect(["cx","cy"].map(name=>container.querySelector("circle[data-pivot]")!.getAttribute(name))).toEqual(["20","30"]);
  expect([(el("Transform X (px)") as HTMLInputElement).value,(el("Transform Y (px)") as HTMLInputElement).value]).toEqual(["20","30"]);
  await type("Transform width (%)","200");expect(session()!.settings).toMatchObject({width:200,height:200,x:120,y:90});expect(corner("Resize image layer top left")).toEqual([20,30]);
  await type("Transform X (px)","50");expect(session()!.settings.x).toBe(150);expect(corner("Resize image layer top left")).toEqual([50,30]);
  await type("Transform angle (°)","30");expect(corner("Resize image layer top left")).toEqual([50,30]);
  await type("Transform horizontal skew (°)","10");expect(corner("Resize image layer top left")).toEqual([50,30]);
  await drag("Rotate image layer bottom right",[262,227],[200,260]);expect(session()!.settings.angle).not.toBe(30);expect(corner("Resize image layer top left")).toEqual([50,30]);
  await act(async()=>(el("Toggle reference point") as HTMLInputElement).click());expect(container.querySelector("circle[data-pivot]")).toBeNull();
  expect((el("Transform Y (px)") as HTMLInputElement).value).toBe(String(Math.round(session()!.settings.y*100)/100));
});
it("switches to Warp from the bar: an untouched box just opens it, a changed one is committed first, and a failed commit stays out of Warp",async()=>{
  warp.mockReset();await render();await act(async()=>{beginFreeTransform(image,layer,undefined);});
  const button=()=>el("Switch between free transform and warp modes") as HTMLButtonElement;
  await act(async()=>button().click());expect(warp).toHaveBeenCalledOnce();expect(native.run).not.toHaveBeenCalled();expect(session()).toBeNull();expect(usePhotoWorkspace.getState().busy).toBe(false);
  await act(async()=>{beginFreeTransform(image,layer,undefined);});await type("Transform angle (°)","20");
  await act(async()=>button().click());expect(native.run).toHaveBeenCalledOnce();expect(native.run.mock.calls[0]![0]).toBe("edit.transform");expect(warp).toHaveBeenCalledTimes(2);expect(session()).toBeNull();
  native.run.mockRejectedValueOnce(new Error("engine said no"));await act(async()=>{beginFreeTransform(image,layer,undefined);});await type("Transform angle (°)","20");
  await act(async()=>button().click());expect(native.run).toHaveBeenCalledTimes(2);expect(warp).toHaveBeenCalledTimes(2);
  await act(async()=>{beginFreeTransform(image,layer,undefined);});await act(async()=>usePhotoWorkspace.setState({busy:true,quiet:false}));expect(button().disabled).toBe(true);
});
it("hands Warp the step before a committed box, and folds or undoes a session that came back from Warp as one step",async()=>{
  warp.mockReset();await render();await act(async()=>usePhotoWorkspace.setState({state:{historySources:[{id:"h3",index:3,current:true}]} as never}));
  const toggle=()=>el("Switch between free transform and warp modes") as HTMLButtonElement;
  await act(async()=>{beginFreeTransform(image,layer,undefined);});await type("Transform angle (°)","20");
  await act(async()=>toggle().click());expect(warp).toHaveBeenLastCalledWith({fromId:"h3",label:"Free Transform"});
  await act(async()=>{beginFreeTransform(image,layer,undefined);});await act(async()=>toggle().click());expect(warp).toHaveBeenLastCalledWith(undefined);
  const fold={fromId:"h2",label:"Warp"};native.run.mockClear();
  await act(async()=>{beginFreeTransform(image,layer,undefined,"free",fold);});await act(async()=>toggle().click());expect(warp).toHaveBeenLastCalledWith(fold);expect(native.run).not.toHaveBeenCalled();
  await act(async()=>{beginFreeTransform(image,layer,undefined,"free",fold);});await type("Transform angle (°)","20");
  await act(async()=>(el("Commit transform") as HTMLButtonElement).click());
  expect(native.run.mock.calls.map(call=>call[0])).toEqual(["edit.transform","history.fold"]);expect(native.run).toHaveBeenLastCalledWith("history.fold",fold);
  native.run.mockClear();await act(async()=>{beginFreeTransform(image,layer,undefined,"free",fold);});await act(async()=>(el("Cancel transform") as HTMLButtonElement).click());
  expect(session()).toBeNull();expect(native.run.mock.calls).toEqual([["history.select",{id:"h2",discardRedo:true}]]);
  native.run.mockClear();await act(async()=>{beginFreeTransform(image,layer,undefined,"free",fold);});await keydown("Escape");
  expect(session()).toBeNull();expect(native.run.mock.calls).toEqual([["history.select",{id:"h2",discardRedo:true}]]);
  native.run.mockClear();await act(async()=>{beginFreeTransform(image,layer,undefined);});await keydown("Escape");expect(native.run).not.toHaveBeenCalled();
});
