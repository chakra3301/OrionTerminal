import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useViewAids } from "./viewGuides";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePhotoWorkspace } from "./runtime";
import { PhotoStudio } from "./PhotoStudio";
import { IMAGE_SWATCHES_KEY } from "./PhotoSwatches";
import { PAINT_TOOL_PREFERENCES_KEY } from "./paintToolPreferences";
import { CROP_PRESETS_KEY } from "./CropPresets";
import { VECTOR_TOOL_PREFERENCES_KEY } from "./vectorToolPreferences";
import { alignSubpaths, deleteKnot, insertKnot, resizeMatrix, shapeGeometryPath } from "./vectorGeometry";
import { penKnots, smoothHandles, type XY } from "./penPath";
import type { PhotoDocument, PhotoLayer, PhotoState } from "./types";

const command=vi.hoisted(()=>vi.fn(async(_id:string,_params:Record<string,unknown>={}):Promise<unknown>=>undefined));
const native=vi.hoisted(()=>({enabled:false,invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>native.enabled,invoke:native.invoke,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:command,setPhotoColors:vi.fn(async()=>undefined)}));
vi.mock("@tauri-apps/plugin-dialog",()=>({save:vi.fn()}));
vi.mock("./PhotoTiles",async original=>({...await original<typeof import("./PhotoTiles")>(),PhotoTiles:()=><div data-testid="detail-tiles"/>}));
let root:Root,container:HTMLDivElement;
const editor=()=>container.querySelector<HTMLElement>('[aria-label="Image editor"]')!;
const canvas=()=>container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;
const field=<T extends HTMLElement=HTMLInputElement>(label:string)=>container.querySelector<T>(`[aria-label="${label}"]`)!;
const button=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(element=>element.getAttribute("aria-label")===label||element.textContent===label)!;
const click=async(label:string)=>{await act(async()=>button(label).click());};
const check=async(label:string)=>{await act(async()=>field(label).click());};
const choose=async(label:string,value:string)=>act(async()=>{const select=field<HTMLSelectElement>(label);select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));});
const typeIn=async(label:string,value:string)=>{
  await act(async()=>{const input=field(label);input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});
  await act(async()=>field(label).dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Enter"})));
};
const key=async(key:string,init:KeyboardEventInit={},target:Element=editor())=>{await act(async()=>target.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key,...init})));};
const pointer=async(type:string,init:MouseEventInit={})=>{await act(async()=>canvas().dispatchEvent(new MouseEvent(type,{bubbles:true,button:0,clientX:100,clientY:50,...init})));};
const tap=async(x:number,y:number)=>{await pointer("pointerdown",{clientX:x,clientY:y});await pointer("pointerup",{clientX:x,clientY:y});};
const drawShape=async(to:[number,number]=[200,150])=>{await pointer("pointerdown",{clientX:100,clientY:50});await pointer("pointermove",{clientX:to[0],clientY:to[1]});await pointer("pointerup",{clientX:to[0],clientY:to[1]});};
const menuRow=(label:string)=>[...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(row=>row.textContent?.includes(label))!;
const setState=async(patch:Partial<PhotoState>)=>{await act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,...patch}})));};
const mount=async()=>{
  root=createRoot(container);await act(async()=>root.render(<PhotoStudio/>));
  const bounds={left:0,top:0,width:800,height:600} as DOMRect;
  vi.spyOn(canvas(),"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(canvas(),"getContext").mockReturnValue(null);canvas().setPointerCapture=vi.fn();canvas().hasPointerCapture=()=>false;canvas().releasePointerCapture=vi.fn();
  vi.spyOn(container.querySelector<HTMLElement>(".xd-photo-stage")!,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(container.querySelector(".xd-photo-image")!,"getBoundingClientRect").mockReturnValue(bounds);
};
const remount=async()=>{act(()=>root.unmount());await mount();};
const corner=(x:number,y:number)=>({anchor:[x,y] as XY,in:[x,y] as XY,out:[x,y] as XY,smooth:false});
const box=(x:number,y:number,w:number,h:number)=>({closed:true,knots:[corner(x,y),corner(x+w,y),corner(x+w,y+h),corner(x,y+h)]});
const patternPresets={patterns:[{name:"Basics",presets:[{id:"p1",name:"Bubbles",width:8,height:8},{id:"p2",name:"Grid",width:8,height:8}]}]} as PhotoState["presets"];
const layer=(id:number,kind:string,name=`Layer ${id}`):PhotoLayer=>({id,name,kind,visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false} as PhotoLayer);
beforeEach(async()=>{
  useViewAids.setState(state=>({flags:{...state.flags,snap:false}}));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
  native.enabled=false;native.invoke.mockReset();command.mockReset().mockResolvedValue(undefined);useXDesign.getState().hydrate(null);
  for(const name of [IMAGE_SWATCHES_KEY,PAINT_TOOL_PREFERENCES_KEY,CROP_PRESETS_KEY,VECTOR_TOOL_PREFERENCES_KEY])localStorage.removeItem(name);
  const id=ulid(),version=ulid();
  const doc:PhotoDocument={id,version,name:"Portrait",width:800,height:600,previewWidth:800,previewHeight:600,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null};
  const placement=useXDesign.getState().applyPhotoDocument(doc);
  const state:PhotoState={name:"Portrait",width:800,height:600,mode:"RGB",depth:8,resolution:72,activeLayer:1,hasSelection:false,selectionBounds:null,layers:[layer(1,"Raster","Portrait layer")],canUndo:true,canRedo:true,viewKey:"view",historySources:[],historyRedo:[]};
  usePhotoWorkspace.setState({shapeId:placement,documentId:id,projectId:ulid(),source:"legacy",state,stateVersion:version,busy:false,error:null,warnings:[]});
  useXDProjects.setState({activeId:usePhotoWorkspace.getState().projectId,transitioning:false});
  container=document.createElement("div");document.body.append(container);await mount();
});
afterEach(()=>{act(()=>root.unmount());container.remove();usePhotoWorkspace.getState().close();vi.unstubAllGlobals();});

describe("shape and pen tool settings",()=>{
  it("keep across tool switches and relaunch, and fall back to defaults for what cannot be read",async()=>{
    await key("u");await choose("Pick tool mode","path");await key("p");await choose("Pen mode","shape");
    await key("u");expect(field<HTMLSelectElement>("Pick tool mode").value).toBe("path");
    await remount();await key("u");expect(field<HTMLSelectElement>("Pick tool mode").value).toBe("path");await key("p");expect(field<HTMLSelectElement>("Pen mode").value).toBe("shape");
    localStorage.setItem(VECTOR_TOOL_PREFERENCES_KEY,JSON.stringify({schemaVersion:1,options:{shapeMode:"bitmap",polygonSides:500}}));
    await remount();await key("u");expect(field<HTMLSelectElement>("Pick tool mode").value).toBe("shape");
    for(let i=0;i<3;i++)await key("U",{shiftKey:true});expect(field("Number of sides").value).toBe("100");
    localStorage.setItem(VECTOR_TOOL_PREFERENCES_KEY,"{");await remount();expect(container.textContent).toContain("Saved shape and path tool settings could not be read.");
  });
});

describe("shape tools",()=>{
  it("draw Work Path components in Path mode",async()=>{
    await key("u");await choose("Pick tool mode","path");
    expect(field("Shape fill type")).toBeNull();expect(button("Make selection from path")).toBeTruthy();
    await drawShape();expect(command).toHaveBeenLastCalledWith("path.set",{name:"work",path:shapeGeometryPath({kind:"rect",rect:[100,50,100,100]})});
    await choose("Path operation","subtract");await key("U",{shiftKey:true});await drawShape();
    expect(command).toHaveBeenLastCalledWith("path.set",{name:"work",path:shapeGeometryPath({kind:"ellipse",rect:[100,50,100,100]}),op:"subtract"});
    expect(command.mock.calls.some(([id])=>id==="shape.create")).toBe(false);
  });
  it("size the shape from the gear's Fixed Size and Square",async()=>{
    await key("u");await click("Shape options");await check("Fixed Size");await typeIn("Fixed width","40");await typeIn("Fixed height","30");
    await tap(100,50);expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"rect",rect:[100,50,40,30],fill:"#ff3ea5"});
    await click("Shape options");await check("Square");await drawShape([200,110]);expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"rect",rect:[100,50,100,100],fill:"#ff3ea5"});
    await key("U",{shiftKey:true});await click("Shape options");expect(field<HTMLInputElement>("Circle").checked).toBe(true);
  });
  it("round the rectangle's corners together, or each on its own when unlinked",async()=>{
    await key("u");await typeIn("Corner radius","5");await drawShape();
    expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"roundedRect",rect:[100,50,100,100],radii:5,fill:"#ff3ea5"});
    await click("Corner radii");await click("Link corner radius values");await typeIn("Top right corner radius","12");await drawShape();
    expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"roundedRect",rect:[100,50,100,100],radii:[5,12,5,5],fill:"#ff3ea5"});expect(field("Corner radius").value).toBe("");
    await typeIn("Corner radius","0");await drawShape();expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"rect",rect:[100,50,100,100],fill:"#ff3ea5"});
  });
  it("round the Triangle's and Polygon's corners from Radius and add the Line's arrowheads from its gear, keeping old payloads without them",async()=>{
    await key("u");await key("U",{shiftKey:true});await key("U",{shiftKey:true});
    await drawShape();expect(command).toHaveBeenLastCalledWith("shape.create",expect.objectContaining({kind:"polygon",sides:3}));expect(command.mock.lastCall![1]).not.toHaveProperty("cornerRadius");
    await typeIn("Polygon corner radius","8");await drawShape();expect(command).toHaveBeenLastCalledWith("shape.create",expect.objectContaining({kind:"polygon",sides:3,cornerRadius:8,fill:"#ff3ea5"}));
    await key("U",{shiftKey:true});expect(field("Polygon corner radius").value).toBe("8");
    await drawShape();expect(command).toHaveBeenLastCalledWith("shape.create",expect.objectContaining({kind:"polygon",sides:5,cornerRadius:8}));
    await key("U",{shiftKey:true});expect(field("Polygon corner radius")).toBeNull();
    await drawShape();expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"line",from:[100,50],to:[200,150],weight:4,fill:"#ff3ea5"});
    await click("Line options");await check("End arrowhead");await typeIn("Arrowhead width","300");await drawShape();
    expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"line",from:[100,50],to:[200,150],weight:4,arrowStart:false,arrowEnd:true,arrowWidth:300,arrowLength:1000,arrowConcavity:0,fill:"#ff3ea5"});
    localStorage.setItem(VECTOR_TOOL_PREFERENCES_KEY,JSON.stringify({schemaVersion:1,options:{polygonRadius:-5,arrowStart:"yes",arrowEnd:true,arrowWidth:1e9,arrowConcavity:99}}));
    await remount();await key("u");for(let i=0;i<4;i++)await key("U",{shiftKey:true});await click("Line options");
    expect(field<HTMLInputElement>("Start arrowhead").checked).toBe(false);expect(field<HTMLInputElement>("End arrowhead").checked).toBe(true);
    expect(field("Arrowhead width").value).toBe("1000");expect(field("Arrowhead concavity").value).toBe("50");
    await key("U",{shiftKey:true});await key("U",{shiftKey:true});await key("U",{shiftKey:true});expect(field("Polygon corner radius").value).toBe("0");
  });
  it("take rounded and arrowed outlines from the host's shape.path in Path mode, and draw plain ones locally",async()=>{
    const outline={subpaths:[box(100,50,100,100)]},sent=()=>command.mock.calls.map(([id])=>id).filter(id=>id==="shape.path"||id==="path.set");
    command.mockImplementation(async id=>id==="shape.path"?{path:outline}:undefined);
    await key("u");await choose("Pick tool mode","path");await key("U",{shiftKey:true});await key("U",{shiftKey:true});
    await drawShape();expect(sent()).toEqual(["path.set"]);
    await typeIn("Polygon corner radius","8");command.mockClear();await drawShape();
    expect(sent()).toEqual(["shape.path","path.set"]);expect(command.mock.calls.find(([id])=>id==="shape.path")![1]).toEqual(expect.objectContaining({kind:"polygon",sides:3,cornerRadius:8}));
    expect(command).toHaveBeenLastCalledWith("path.set",{name:"work",path:outline});
    command.mockClear();command.mockImplementation(async id=>{if(id==="shape.path")throw new Error("Shape: cornerRadius must be a number from 0 to 10000");});
    await drawShape();expect(sent()).toEqual(["shape.path"]);
  });
  it("fill each drawn outline with the foreground in Pixels mode, one Fill Path step each, with the bar's mode, opacity and anti-alias",async()=>{
    const outline={subpaths:[box(100,50,100,100)]};command.mockImplementation(async id=>id==="shape.path"?{path:outline}:undefined);
    await key("u");await choose("Pick tool mode","pixels");
    expect(field("Shape fill type")).toBeNull();expect(field("Path operation")).toBeNull();expect(button("Make selection from path")).toBeUndefined();
    await choose("Pixels blend mode","Multiply");await typeIn("Pixels opacity","50");await check("Anti-alias");
    command.mockClear();await drawShape();
    expect(command.mock.calls).toEqual([["path.fill",{path:shapeGeometryPath({kind:"rect",rect:[100,50,100,100]}),color:"#ff3ea5",mode:"Multiply",opacity:50,antiAlias:false}]]);
    await remount();await key("u");expect(field<HTMLSelectElement>("Pick tool mode").value).toBe("pixels");expect(field<HTMLSelectElement>("Pixels blend mode").value).toBe("Multiply");expect(field("Pixels opacity").value).toBe("50");expect(field<HTMLInputElement>("Anti-alias").checked).toBe(false);
    await key("U",{shiftKey:true});await key("U",{shiftKey:true});await typeIn("Polygon corner radius","8");command.mockClear();await drawShape();
    expect(command.mock.calls.map(([id])=>id)).toEqual(["shape.path","path.fill"]);expect(command).toHaveBeenLastCalledWith("path.fill",{path:outline,color:"#ff3ea5",mode:"Multiply",opacity:50,antiAlias:false});
  });
  it("fill Behind and Clear as Normal on a layer whose transparency is locked, greying them there",async()=>{
    localStorage.setItem(VECTOR_TOOL_PREFERENCES_KEY,JSON.stringify({schemaVersion:1,options:{shapeMode:"pixels",pixelMode:"Behind"}}));await remount();
    await setState({layers:[{...layer(1,"Raster","Portrait layer"),locks:{transparency:true,pixels:false,position:false,all:false}}]});
    await key("u");const behind=field<HTMLSelectElement>("Pixels blend mode").querySelector<HTMLOptionElement>('option[value="Behind"]')!;expect(behind.disabled).toBe(true);
    await drawShape();expect(command).toHaveBeenLastCalledWith("path.fill",expect.objectContaining({mode:"Normal"}));
    await setState({layers:[layer(1,"Raster","Portrait layer")]});expect(behind.disabled).toBe(false);await drawShape();expect(command).toHaveBeenLastCalledWith("path.fill",expect.objectContaining({mode:"Behind"}));
  });
  it("fill new shapes with the image's pattern presets, drawing a saved pattern that is gone with the first",async()=>{
    await setState({presets:patternPresets});localStorage.setItem(VECTOR_TOOL_PREFERENCES_KEY,JSON.stringify({schemaVersion:1,options:{shapeStyle:{fillKind:"pattern",fillPattern:{id:"gone",name:"Gone",scale:50,angle:0}}}}));await remount();
    await key("u");await drawShape();expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"rect",rect:[100,50,100,100],fill:{pattern:"p1",scale:50,angle:0}});
    await click("Shape fill type");await choose("Fill pattern","p2");await drawShape();expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"rect",rect:[100,50,100,100],fill:{pattern:"p2",scale:50,angle:0}});
  });
  it("resize the active shape layer from W and H as one edit",async()=>{
    const path={subpaths:[box(100,100,200,100)]};command.mockImplementation(async id=>id==="path.info"?{path}:undefined);
    await setState({layers:[layer(1,"Raster"),layer(2,"Shape")],activeLayer:2});await key("u");
    expect(field("Shape width").value).toBe("200");command.mockClear();
    await typeIn("Shape width","400");expect(command).toHaveBeenCalledTimes(1);expect(command).toHaveBeenLastCalledWith("shape.edit",{layer:2,transform:resizeMatrix({x:100,y:100,width:200,height:100},400,100)});
  });
});

describe("pen tools",()=>{
  it("add to the Work Path with the path operation and make a selection, mask or shape from it",async()=>{
    await key("p");await choose("Path operation","combine");await tap(100,100);await tap(200,100);await key("Enter");
    expect(command).toHaveBeenLastCalledWith("path.set",{name:"work",path:{subpaths:[{closed:false,knots:[[100,100],[200,100]]}]},op:"combine"});
    const path={subpaths:[box(100,100,200,100)]};command.mockImplementation(async id=>id==="path.info"?{path}:undefined);await setState({paths:{saved:[],work:true}});
    await click("Make selection from path");expect(command).toHaveBeenLastCalledWith("path.toSelection",{name:"work"});
    await click("Make vector mask from path");expect(command).toHaveBeenLastCalledWith("layer.vectorMask.fromPath",{name:"work"});
    await click("Make shape from path");expect(command).toHaveBeenLastCalledWith("shape.create",{kind:"path",path,fill:"#ff3ea5"});
  });
  it("preview the next segment only with Rubber Band on",async()=>{
    const curves=vi.fn(),context=new Proxy({bezierCurveTo:curves} as Record<string|symbol,unknown>,{get:(target,name)=>name in target?target[name]:()=>{},set:()=>true});
    vi.spyOn(canvas(),"getContext").mockReturnValue(context as never);
    await key("p");await tap(100,100);await pointer("pointermove",{clientX:200,clientY:150});expect(curves).not.toHaveBeenCalled();await key("Escape");
    await click("Pen options");await check("Rubber Band");await tap(100,100);await pointer("pointermove",{clientX:200,clientY:150});expect(curves).toHaveBeenCalled();
  });
  it("add and delete anchors on the target path with Auto Add/Delete, and start a new path with it off",async()=>{
    const path={subpaths:[{closed:true,knots:[corner(100,100),corner(400,100),corner(400,300)]}]};command.mockImplementation(async id=>id==="path.info"?{path}:undefined);
    await setState({paths:{saved:[],work:true}});await key("p");
    await tap(250,100);expect(command).toHaveBeenLastCalledWith("path.set",{name:"work",path:insertKnot(path,0,0,.5)});
    await tap(400,100);expect(command).toHaveBeenLastCalledWith("path.set",{name:"work",path:deleteKnot(path,0,1)});
    await check("Auto Add/Delete");command.mockClear();await tap(250,100);expect(command).not.toHaveBeenCalledWith("path.set",expect.anything());expect(container.textContent).toContain("1 anchor point");
  });
  it("fit Freeform paths to Curve Fit",async()=>{
    await key("1",{metaKey:true});await key("p");await key("P",{shiftKey:true});expect(button("Freeform Pen Tool").getAttribute("aria-pressed")).toBe("true");
    const drag=async()=>{await pointer("pointerdown",{clientX:60,clientY:60});for(const [x,y] of [[120,66],[180,60]])await pointer("pointermove",{clientX:x,clientY:y});await pointer("pointerup",{clientX:180,clientY:60});};
    const knots=()=>(command.mock.lastCall![1] as {path:{subpaths:{knots:unknown[]}[]}}).path.subpaths[0]!.knots.length;
    await drag();expect(knots()).toBe(3);await click("Freeform pen options");await typeIn("Curve Fit","10");await drag();expect(knots()).toBe(2);
  });
  it("trace the Freeform Pen magnetically with the gear's width and contrast",async()=>{
    native.enabled=true;native.invoke.mockImplementation(async(_id:string,{params}:{params:{guide:XY[]}})=>({points:params.guide,snapped:false,visited:params.guide.length}));
    await setState({features:{magneticLasso:true}});await key("1",{metaKey:true});await key("p");await key("P",{shiftKey:true});await check("Magnetic");
    await click("Freeform pen options");await typeIn("Magnetic width","20");await typeIn("Magnetic frequency","0");
    const svg=field<SVGSVGElement & HTMLElement>("Magnetic pen canvas");svg.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600}) as DOMRect;
    const at=async(type:string,x:number,y:number)=>act(async()=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperty(event,"pointerId",{value:7});svg.dispatchEvent(event);});
    await at("pointerdown",100,100);await at("pointermove",300,100);await at("pointerdown",300,100);await at("pointermove",300,300);await key("Enter",{},svg);
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_magnetic_trace",expect.objectContaining({params:expect.objectContaining({width:20,contrast:10})}));
    const anchors:XY[]=[[100,100],[300,100],[300,300]];
    expect(command).toHaveBeenLastCalledWith("path.set",{name:"work",path:{subpaths:[{closed:false,knots:penKnots(anchors,smoothHandles(anchors,false))}]}});
  });
});

describe("path selection tools",()=>{
  const two={subpaths:[box(100,100,200,100),{...box(400,150,100,100),op:"combine"}]};
  const shapeLayer=async()=>{
    command.mockImplementation(async id=>id==="path.info"?{path:two}:id==="shape.info"?{fill:"#00ff00",stroke:{width:2,color:"#000000",align:"center",cap:"butt",join:"miter",dashes:[]}}:undefined);
    await setState({layers:[layer(1,"Raster"),layer(2,"Shape")],activeLayer:2});await key("a");
  };
  it("edit the selected shape layer's fill, stroke, size and path operation, one edit each",async()=>{
    await shapeLayer();expect(command).toHaveBeenCalledWith("shape.info",{layer:2});
    expect(field("Stroke width").value).toBe("2");expect(field("Shape width").value).toBe("400");expect(field("Shape height").value).toBe("150");command.mockClear();
    await typeIn("Stroke width","5");expect(command).toHaveBeenLastCalledWith("shape.edit",{layer:2,stroke:{width:5,color:"#000000",align:"center",cap:"butt",join:"miter",dashes:[]}});
    await click("Shape fill type");await click("No Color");expect(command).toHaveBeenLastCalledWith("shape.edit",{layer:2,fill:null});
    await typeIn("Shape height","300");expect(command).toHaveBeenLastCalledWith("shape.edit",{layer:2,transform:resizeMatrix({x:100,y:100,width:400,height:150},400,300)});
    await choose("Path operation","subtract");expect(command).toHaveBeenLastCalledWith("shape.edit",{layer:2,op:"subtract"});
    await choose("Path operation","merge");expect(command).toHaveBeenLastCalledWith("layer.combineShapes.mergeShapeComponents",{});
    expect(command).toHaveBeenCalledTimes(5);
  });
  it("edit the selected shape layer's pattern fill as one edit, naming the image's own pattern",async()=>{
    command.mockImplementation(async id=>id==="path.info"?{path:two}:id==="shape.info"?{fill:{pattern:"doc1",name:"Imported",scale:100,angle:0},stroke:null}:undefined);
    await setState({layers:[layer(1,"Raster"),layer(2,"Shape")],activeLayer:2,presets:patternPresets});await key("a");
    await click("Shape fill type");expect(field<HTMLSelectElement>("Fill pattern").value).toBe("doc1");command.mockClear();
    await choose("Fill pattern","p2");expect(command).toHaveBeenLastCalledWith("shape.edit",{layer:2,fill:{pattern:"p2",scale:100,angle:0}});
    expect(command.mock.calls.filter(([id])=>id==="shape.edit")).toHaveLength(1);
  });
  it("align the path's components to each other or to the canvas",async()=>{
    await shapeLayer();
    await click("Path alignment");await act(async()=>menuRow("Align left edges").click());
    expect(command).toHaveBeenLastCalledWith("shape.edit",{layer:2,path:alignSubpaths(two,"left",{x:100,y:100,width:400,height:150}).path});
    await click("Path alignment");await act(async()=>menuRow("Align To Canvas").click());
    await click("Path alignment");await act(async()=>menuRow("Align bottom edges").click());
    expect(command).toHaveBeenLastCalledWith("shape.edit",{layer:2,path:alignSubpaths(two,"bottom",{x:0,y:0,width:800,height:600}).path});
  });
  it("move a lone component to the canvas edge without losing the live shape",async()=>{
    command.mockImplementation(async id=>id==="path.info"?{path:{subpaths:[box(100,100,200,100)]}}:undefined);
    await setState({layers:[layer(1,"Raster"),layer(2,"Shape")],activeLayer:2});await key("a");
    await click("Path alignment");expect(menuRow("Align left edges").hasAttribute("disabled")||menuRow("Align left edges").getAttribute("aria-disabled")==="true").toBe(true);
    await act(async()=>menuRow("Align To Canvas").click());await click("Path alignment");await act(async()=>menuRow("Align left edges").click());
    expect(command).toHaveBeenLastCalledWith("shape.edit",{layer:2,move:[-100,0]});
  });
  it("pick the topmost shape layer under the pointer with Select: All Layers",async()=>{
    command.mockImplementation(async id=>id==="layer.pickAt"?{layers:[{layer:1,name:"Layer 1"},{layer:3,name:"Layer 3"},{layer:2,name:"Layer 2"}]}:undefined);
    await setState({layers:[layer(1,"Raster"),layer(2,"Shape"),layer(3,"Shape")],activeLayer:1});await key("a");
    await tap(150,120);expect(command).not.toHaveBeenCalledWith("layer.pickAt",expect.anything());
    await choose("Select layers","all");await tap(150,120);
    expect(command).toHaveBeenCalledWith("layer.pickAt",{x:150,y:120,list:true});expect(command).toHaveBeenLastCalledWith("layer.select",{layer:3});
  });
});

describe("inert and grayscale targets",()=>{
  it("leaves the vector bars inert while busy and draws shapes on a mask target without throwing",async()=>{
    await key("u");await act(async()=>usePhotoWorkspace.setState({busy:true}));
    expect(container.querySelector(".xd-ps-options")!.hasAttribute("inert")).toBe(true);expect(container.querySelector('.xd-ps-options [aria-label="Shape options"]')).not.toBeNull();
    await act(async()=>usePhotoWorkspace.setState({busy:false}));await setState({mode:"Grayscale",quickMask:true});
    await drawShape();expect(command).toHaveBeenLastCalledWith("shape.create",expect.objectContaining({kind:"rect",rect:[100,50,100,100]}));
    await key("a");expect(field<HTMLButtonElement>("Shape fill type").disabled).toBe(true);
  });
  it("refuses a Pixels mode fill on a mask or channel target, with no command",async()=>{
    await key("u");await choose("Pick tool mode","pixels");await setState({quickMask:true});command.mockClear();
    await drawShape();expect(command.mock.calls.some(([id])=>id==="path.fill")).toBe(false);expect(usePhotoWorkspace.getState().error).toContain("layer pixels");
  });
});
