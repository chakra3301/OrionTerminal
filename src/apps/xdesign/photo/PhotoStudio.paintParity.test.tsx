import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePhotoWorkspace } from "./runtime";
import { PhotoStudio } from "./PhotoStudio";
import type { PhotoDocument, PhotoState } from "./types";
import { useViewAids } from "./viewGuides";
import { PAINT_TOOL_PREFERENCES_KEY } from "./paintToolPreferences";
import { IMAGE_TOOL_GROUPS } from "../editorTools";
const command=vi.hoisted(()=>vi.fn(async(_id:string,_params:Record<string,unknown>={}):Promise<unknown>=>undefined));
const native=vi.hoisted(()=>({enabled:false,invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>native.enabled,invoke:native.invoke,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:command,setPhotoColors:vi.fn(async()=>undefined)}));
vi.mock("./PhotoTiles",async original=>({...await original<typeof import("./PhotoTiles")>(),PhotoTiles:()=><div data-testid="detail-tiles"/>}));
let root:Root,container:HTMLDivElement;
const button=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(element=>element.getAttribute("aria-label")===label||element.textContent===label)!;
const click=async(label:string)=>{await act(async()=>button(label).click());};
const row=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>("[role=menu] > button")].find(element=>element.textContent===label)!;
const chooseTool=async(id:string)=>{const group=IMAGE_TOOL_GROUPS.find(entry=>entry.tools.some(tool=>tool.id===id))!,label=group.tools.find(tool=>tool.id===id)!.label;if(group.tools.length>1)await act(async()=>container.querySelector<HTMLButtonElement>(`[aria-label="Choose ${group.label.toLowerCase()}"]`)!.click());await act(async()=>(group.tools.length>1?[...container.querySelectorAll<HTMLButtonElement>("[role=menu] > button")].find(element=>element.textContent===label)!:container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!).click());};
const pick=async(label:string,value:string)=>{await act(async()=>{const element=container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;element.value=value;element.dispatchEvent(new Event("change",{bubbles:true}));});};
const setState=async(patch:Partial<PhotoState>)=>{await act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,...patch}})));};
export const brushState=(smoothing:Record<string,unknown>={amount:0,pulledString:false,catchUp:true,catchUpOnEnd:true,adjustForZoom:true}):PhotoState["brush"]=>({sampledTip:false,sampledTexture:false,revision:1,presets:[{name:"Soft Round",group:"General Brushes",builtin:true,size:30,hardness:0},{name:"Hard Round",group:"General Brushes",builtin:true,size:30,hardness:1},{name:"Chalk",group:"Dry Media",builtin:false,size:60,hardness:.5},{name:"Loose",group:"",builtin:false,size:12,hardness:.8}],settings:{size:30,opacity:1,hardness:0,flow:1,spacing:.1,smoothing}} as unknown as PhotoState["brush"]);
beforeEach(async()=>{
  useViewAids.setState(state=>({flags:{...state.flags,snap:false}}));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
  localStorage.removeItem(PAINT_TOOL_PREFERENCES_KEY);native.enabled=false;native.invoke.mockReset();command.mockReset();command.mockImplementation(async()=>undefined);useXDesign.getState().hydrate(null);
  const id=ulid(),version=ulid();
  const doc:PhotoDocument={id,version,name:"Portrait",width:800,height:600,previewWidth:800,previewHeight:600,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null};
  const placement=useXDesign.getState().applyPhotoDocument(doc);
  const state:PhotoState={name:"Portrait",width:800,height:600,mode:"RGB",depth:8,resolution:72,activeLayer:1,hasSelection:false,selectionBounds:null,layers:[{id:1,name:"Portrait layer",kind:"Raster",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false}],canUndo:true,canRedo:false,brush:brushState()};
  usePhotoWorkspace.setState({shapeId:placement,documentId:id,projectId:ulid(),source:"legacy",state,stateVersion:version,busy:false,error:null,warnings:[]});
  useXDProjects.setState({activeId:usePhotoWorkspace.getState().projectId,transitioning:false});
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(<PhotoStudio/>));
});
afterEach(()=>{act(()=>root.unmount());container.remove();usePhotoWorkspace.getState().close();vi.unstubAllGlobals();});

describe("Photoshop paint options bar parity",()=>{
  it("drops Opacity from the options bar in the Block eraser",async()=>{
    await chooseTool("erase");
    expect(container.querySelector('[aria-label="Brush opacity"]')).not.toBeNull();
    await pick("Tool Mode","block");
    expect(container.querySelector('[aria-label="Brush opacity"]')).toBeNull();
    expect(container.querySelector('[aria-label="Tool Flow (%)"]')).toBeNull();
    await pick("Tool Mode","pencil");
    expect(container.querySelector('[aria-label="Brush opacity"]')).not.toBeNull();
  });
  it.each(["paint.stroke","paint.pencil","erase","paint.mixerBrush"])("offers %s Smoothing options in the brush gear as one brush change each",async tool=>{
    await chooseTool(tool);
    await click("Brush options");
    expect(row("Native feedback")).toBeDefined();
    expect(row("Pulled String Mode").getAttribute("aria-checked")).toBe("false");
    expect(row("Adjust for Zoom").getAttribute("aria-checked")).toBe("true");
    await act(async()=>row("Pulled String Mode").click());
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenLastCalledWith("tools.setBrush",{smoothing:{pulledString:true}});
  });
  it("keeps the Smoothing options off tools without Smoothing and disabled while busy",async()=>{
    await chooseTool("paint.cloneStamp");
    await click("Brush options");
    expect(row("Pulled String Mode")).toBeUndefined();
    await chooseTool("paint.stroke");
    await act(async()=>usePhotoWorkspace.setState({busy:true}));
    await click("Brush options");
    expect(row("Stroke Catch-up").disabled).toBe(true);
  });
  it("starts the bar Smoothing at 10% over the engine's default and keeps a chosen engine amount",async()=>{
    await chooseTool("paint.stroke");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Tool Smoothing (%)"]')?.value??button("Tool Smoothing (%)")?.textContent).toContain("10");
    await setState({brush:brushState({amount:.4,pulledString:false,catchUp:true,catchUpOnEnd:true,adjustForZoom:true})});
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Tool Smoothing (%)"]')?.value??button("Tool Smoothing (%)")?.textContent).toContain("40");
  });
});

describe("Photoshop tool preset picker",()=>{
  const picker=()=>container.querySelector<HTMLElement>('[role=dialog][aria-label="Tool preset picker"]');
  const preset=(name:string)=>[...picker()!.querySelectorAll<HTMLButtonElement>("button")].find(element=>element.firstElementChild?.textContent===name);
  it("lists the current tool's presets on the bar, applies one in one command and remembers its options",async()=>{
    await setState({presets:{tools:[{name:"Big Soft",tool:"brush"},{name:"Square Eraser",tool:"eraser"}]}} as Partial<PhotoState>);
    command.mockImplementation(async(id:string)=>id==="tool.presets.select"?{tool:"eraser",options:{toolOptions:{paintOptions:{eraserMode:"block"}}}}:undefined);
    await chooseTool("paint.stroke");
    expect(container.querySelector('[aria-label="Current tool: Brush Tool"]')).not.toBeNull();
    await click("Tool preset picker");
    expect(preset("Big Soft")).toBeDefined();expect(preset("Square Eraser")).toBeUndefined();
    await act(async()=>picker()!.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    await act(async()=>preset("Square Eraser")!.click());
    expect(command.mock.calls).toEqual([["tool.presets.select",{preset:"Square Eraser"}]]);
    expect(picker()).toBeNull();
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Tool Mode"]')!.value).toBe("block");
    expect(JSON.parse(localStorage.getItem(PAINT_TOOL_PREFERENCES_KEY)!).options.erase).toMatchObject({eraserMode:"block"});
  });
  it("saves the current tool's options as a new tool preset from the bar",async()=>{
    await setState({presets:{tools:[]}} as unknown as Partial<PhotoState>);
    await chooseTool("paint.pencil");
    await click("Tool preset picker");
    await act(async()=>[...picker()!.querySelectorAll<HTMLButtonElement>("button")].find(element=>element.textContent==="Save tool preset")!.click());
    expect(command).toHaveBeenLastCalledWith("tool.presets.new",expect.objectContaining({name:"My tool preset",tool:"pencil",options:expect.objectContaining({toolOptions:expect.objectContaining({paintOptions:expect.objectContaining({smoothing:10})})})}));
  });
  it("keeps the picker shut without a document state and its presets inert while busy",async()=>{
    await setState({presets:{tools:[{name:"Big Soft",tool:"brush"}]}} as Partial<PhotoState>);
    await chooseTool("paint.stroke");
    await act(async()=>usePhotoWorkspace.setState({busy:true}));
    await click("Tool preset picker");
    expect(preset("Big Soft")!.disabled).toBe(true);
    await act(async()=>usePhotoWorkspace.setState({busy:false,state:null}));
    expect(button("Tool preset picker").disabled).toBe(true);
    expect(picker()).toBeNull();
  });
});

const gestureCanvas=()=>{
  const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!,stage=container.querySelector<HTMLDivElement>(".xd-photo-stage")!,image=container.querySelector<HTMLDivElement>(".xd-photo-image")!;
  const bounds={left:0,top:0,width:800,height:600} as DOMRect;vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;vi.spyOn(stage,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(image,"getBoundingClientRect").mockReturnValue(bounds);Object.defineProperties(stage,{clientWidth:{value:800},clientHeight:{value:600}});
  return canvas;
};
const drag=async(canvas:HTMLCanvasElement,points:[number,number][],keys:{shiftKey?:boolean;altKey?:boolean}={})=>{await act(async()=>{const [first,...rest]=points,last=points.at(-1)!;canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:first![0],clientY:first![1],...keys}));for(const [x,y] of rest)canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:x,clientY:y,...keys}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:last[0],clientY:last[1],...keys}));});};
const lasso=(mode:string,points:[number,number][])=>["select.lasso",{points,mode,feather:0,antiAlias:true}];

describe("Photoshop Patch draws its own selection",()=>{
  it("lassoes the area to repair when there is no selection, in one select.lasso command",async()=>{
    await chooseTool("paint.patch");
    expect(container.textContent).toContain("Drag to select the area to repair");
    const canvas=gestureCanvas(),shape:[number,number][]=[[20,25],[60,25],[60,70],[20,70]];await drag(canvas,shape);
    expect(command.mock.calls).toEqual([lasso("replace",shape)]);
  });
  it("adds with Shift, subtracts with Alt, intersects with Alt+Shift, patches from inside and selects anew outside",async()=>{
    await setState({hasSelection:true,selectionBounds:[100,120,220,180]});await chooseTool("paint.patch");
    const canvas=gestureCanvas(),shape:[number,number][]=[[150,150],[200,150],[200,200]],outside:[number,number][]=[[20,25],[60,25],[60,70]];
    await drag(canvas,shape,{shiftKey:true});await drag(canvas,shape,{altKey:true});await drag(canvas,shape,{shiftKey:true,altKey:true});await drag(canvas,[[150,150],[170,160]]);await drag(canvas,outside);
    expect(command.mock.calls).toEqual([lasso("add",shape),lasso("subtract",shape),lasso("intersect",shape),["selection.contains",{x:150,y:150}],["paint.patch",{offset:[20,10],mode:"source",layer:1,target:"pixels"}],lasso("replace",outside)]);
  });
  it("selects anew from a press inside the selection's bounds that the host finds outside the selection itself",async()=>{
    await setState({hasSelection:true,selectionBounds:[100,120,220,180]});await chooseTool("paint.patch");
    command.mockImplementation(async(id:string)=>id==="selection.contains"?{inside:false}:undefined);
    const canvas=gestureCanvas(),hole:[number,number][]=[[150,150],[200,150],[200,200]];
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:150,clientY:150}));});
    await act(async()=>{for(const [x,y] of hole.slice(1))canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:x,clientY:y}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:200,clientY:200}));});
    await drag(canvas,[[150,150],[170,160]]);
    expect(command.mock.calls).toEqual([["selection.contains",{x:150,y:150}],lasso("replace",hole),["selection.contains",{x:150,y:150}]]);
  });
  it("commits nothing for a click, a cancelled lasso or a press while busy",async()=>{
    await chooseTool("paint.patch");const canvas=gestureCanvas();
    await drag(canvas,[[20,25]]);
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:60,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:60,clientY:70}));canvas.dispatchEvent(new MouseEvent("pointercancel",{bubbles:true}));});
    await act(async()=>usePhotoWorkspace.setState({busy:true}));await drag(canvas,[[20,25],[60,25],[60,70]]);
    expect(command).not.toHaveBeenCalled();
  });
});

describe("Photoshop Live Gradient stops on the canvas",()=>{
  const gradientLayer={id:2,name:"Gradient Fill 1",kind:"Fill",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,gradientFill:{style:"linear",angle:0,scale:100,offset:[0,0] as [number,number],reverse:false,dither:false,align:true,from:[100,100] as [number,number],to:[300,100] as [number,number],stops:[[0,"#000000"],[1,"#ffffff"]] as [number,string][],transparency:[],midpoints:[]}};
  const stops=()=>container.querySelector('[aria-label="Gradient stops"]');
  const clickLine=async(x:number,y:number)=>{const line=container.querySelector('[aria-label="Gradient line"]')!;await act(async()=>{for(const type of ["pointerdown","pointerup"])line.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y}));});};
  beforeEach(()=>{vi.spyOn(SVGElement.prototype,"getBoundingClientRect").mockReturnValue({left:0,top:0,right:800,bottom:600,width:800,height:600,x:0,y:0,toJSON:()=>({})});});
  afterEach(()=>vi.restoreAllMocks());
  it("edits the gradient fill layer's colour stops on the canvas in one gradient.fill.stop each",async()=>{
    await setState({layers:[...usePhotoWorkspace.getState().state!.layers,gradientLayer],activeLayer:2});await chooseTool("paint.gradient");await click("100%");
    await clickLine(150,101);
    expect(command.mock.calls).toEqual([["gradient.fill.stop",{layer:2,kind:"color",action:"add",location:.25}]]);
  });
  it("shows no stops for Classic gradients, a Quick Mask target or a pixel layer, and takes no press while busy",async()=>{
    await chooseTool("paint.gradient");await click("100%");
    expect(stops()).toBeNull();
    await setState({layers:[...usePhotoWorkspace.getState().state!.layers,gradientLayer],activeLayer:2});
    expect(stops()).not.toBeNull();
    await pick("Gradient mode","classic");expect(stops()).toBeNull();
    await pick("Gradient mode","live");expect(stops()).not.toBeNull();
    await setState({quickMask:true});expect(stops()).toBeNull();
    await setState({quickMask:false});await act(async()=>usePhotoWorkspace.setState({busy:true}));
    await clickLine(150,101);
    expect(command).not.toHaveBeenCalled();
  });
});

describe("Photoshop retouch, mixer and fill options reach the image engine",()=>{
  const field=(label:string)=>container.querySelector<HTMLInputElement|HTMLSelectElement>(`[aria-label="${label}"]`);
  const type=async(label:string,value:string)=>{const input=container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});};
  const swatch=()=>container.querySelector<HTMLElement>('[aria-label="Current brush load"] .xd-ps-paint-swatch')!;
  const reservoir=(color:number[]|null)=>({color,amount:color?1:0,loaded:!!color,pickup:null});
  it("sends Patch Diffusion or Content-Aware with the patch, and the native patch on a Quick Mask",async()=>{
    await setState({hasSelection:true,selectionBounds:[100,120,220,180]});await chooseTool("paint.patch");const canvas=gestureCanvas();
    await type("Tool Diffusion","3");await drag(canvas,[[150,150],[170,160]]);
    await pick("Tool Patch","contentAware");await drag(canvas,[[150,150],[170,160]]);
    await setState({quickMask:true});
    expect(field("Tool Patch")!.disabled).toBe(true);expect(field("Tool Patch mode")!.disabled).toBe(false);
    await drag(canvas,[[150,150],[170,160]]);
    expect(command.mock.calls.filter(([id])=>id!=="selection.contains")).toEqual([
      ["paint.patch",{offset:[20,10],mode:"source",layer:1,target:"pixels",type:"normal",diffusion:3}],
      ["paint.patch",{offset:[20,10],mode:"source",layer:1,target:"pixels",type:"contentAware",structure:4,colorAdaptation:0,sampleAllLayers:false}],
      ["paint.patch",{offset:[20,10],mode:"source",target:"quickMask"}]]);
  });
  it("heals from the Healing Brush pattern without a clone source",async()=>{
    await chooseTool("paint.healingBrush");const canvas=gestureCanvas();
    await drag(canvas,[[20,20],[40,40]]);
    expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().error).toContain("choose a source point first");
    await act(async()=>usePhotoWorkspace.setState({error:null}));
    await pick("Tool Source","pattern");await drag(canvas,[[20,20],[40,40]]);
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenLastCalledWith("paint.healingBrush",expect.objectContaining({sourceType:"pattern",mode:"Normal",diffusion:5,ignoreAdjustmentLayers:false}));
    expect(usePhotoWorkspace.getState().error).toBeNull();
  });
  it("fills with the Paint Bucket Mode and All Layers, and in Normal on a Quick Mask",async()=>{
    await chooseTool("paint.bucket");const canvas=gestureCanvas();
    await pick("Tool Blend","Multiply");await act(async()=>(field("Tool All layers") as HTMLInputElement).click());
    await drag(canvas,[[30,40]]);
    expect(command).toHaveBeenLastCalledWith("paint.bucket",expect.objectContaining({mode:"Multiply",sampleAllLayers:true,x:30,y:40}));
    await setState({quickMask:true});
    expect(field("Tool Blend")!.disabled).toBe(true);expect(field("Tool All layers")!.disabled).toBe(true);expect(field("Tool Tolerance")!.disabled).toBe(false);
    await drag(canvas,[[30,40]]);
    expect(command).toHaveBeenLastCalledWith("paint.bucket",expect.objectContaining({mode:"Normal",sampleAllLayers:false}));
  });
  it("loads and cleans the Mixer Brush from the Current Brush Load menu and draws the load",async()=>{
    command.mockImplementation(async(id:string)=>id==="paint.mixerBrush.load"?reservoir([1,0,0,1]):id==="paint.mixerBrush.clean"?reservoir(null):undefined);
    await chooseTool("paint.mixerBrush");
    expect(swatch().classList.contains("is-none")).toBe(true);
    await click("Current brush load");
    expect(row("Load Solid Colors Only").disabled).toBe(true);expect(row("Load Solid Colors Only").getAttribute("aria-checked")).toBe("true");
    await act(async()=>row("Load Brush").click());
    expect(swatch().classList.contains("is-none")).toBe(false);expect(swatch().style.background).toMatch(/255, 0, 0|#ff0000/);
    await click("Current brush load");await act(async()=>row("Clean Brush").click());
    expect(swatch().classList.contains("is-none")).toBe(true);
    expect(command.mock.calls).toEqual([["paint.mixerBrush.load",{}],["paint.mixerBrush.clean",{}]]);
    await act(async()=>usePhotoWorkspace.setState({busy:true}));
    expect(button("Current brush load").disabled).toBe(true);
  });
  it("loads the Mixer Brush from the image on Alt-click instead of sampling the foreground, and shows a stroke's reload",async()=>{
    command.mockImplementation(async(id:string)=>id==="paint.mixerBrush.load"?reservoir([0,0,1,1]):undefined);
    await chooseTool("paint.mixerBrush");expect(container.textContent).toContain("Alt-click to load the brush from the image");
    const canvas=gestureCanvas();
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:30,clientY:40,altKey:true})));
    expect(command.mock.calls).toEqual([["paint.mixerBrush.load",{x:30,y:40,size:30,sampleAllLayers:false}]]);
    expect(swatch().style.background).toMatch(/0, 0, 255|#0000ff/);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:30,clientY:40,altKey:true})));
    await drag(canvas,[[20,20],[40,40]]);
    const sent=command.mock.calls.find(([id])=>id==="paint.mixerBrush")![1];
    expect(swatch().style.background).not.toMatch(/0, 0, 255|#0000ff/);expect(swatch().classList.contains("is-none")).toBe(sent?.loadAfterStroke===false);
  });
});

describe("Photoshop Brush and Pencil Behind and Clear",()=>{
  it.each(["paint.stroke","paint.pencil"])("sends %s Behind with the stroke alone, and paints Normal with Behind and Clear greyed on a locked Background or an alpha channel",async tool=>{
    await chooseTool(tool);await pick("Tool Blend","Behind");
    const canvas=gestureCanvas(),blend=()=>container.querySelector<HTMLSelectElement>('select[aria-label="Tool Blend"]')!,greyed=()=>[...blend().options].filter(option=>option.disabled).map(option=>option.value);
    expect(greyed()).toEqual([]);
    await drag(canvas,[[20,25],[60,70]]);
    expect(command.mock.calls.map(([id,params])=>[id,params?.mode])).toEqual([[tool,"Behind"]]);
    const layer=usePhotoWorkspace.getState().state!.layers[0]!;
    await setState({layers:[{...layer,name:"Background",locks:{transparency:true,pixels:false,position:false,all:false}}]});
    expect([blend().value,greyed()]).toEqual(["Normal",["Behind","Clear"]]);
    await drag(canvas,[[20,25],[60,70]]);
    expect(command).toHaveBeenLastCalledWith(tool,expect.objectContaining({mode:"Normal"}));
    await setState({layers:[layer],channels:{composite:"RGB",compositeVisible:true,colors:[],alpha:[{index:0,name:"Alpha 1",spot:null,visible:true}],target:{kind:"alpha",index:0}}});
    expect([blend().value,greyed()]).toEqual(["Normal",["Behind","Clear"]]);
    await setState({channels:undefined});
    expect([blend().value,greyed()]).toEqual(["Behind",[]]);
  });
});

describe("Photoshop Paint Symmetry presets",()=>{
  const menu=async()=>{await chooseTool("paint.stroke");await click("Painting symmetry");};
  const rows=()=>[...container.querySelectorAll<HTMLButtonElement>("[role=menu] > button")].map(element=>element.textContent);
  const dialog=()=>container.querySelector<HTMLFormElement>("[role=dialog]");
  const segments=()=>dialog()!.querySelector<HTMLInputElement>('input[aria-label="Segment count"]')!;
  const type=async(value:string)=>{await act(async()=>{const input=segments();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});};
  const ok=()=>[...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(element=>element.textContent==="OK")!;
  it("lists the ten presets after Off and sends each as one paint.symmetrySet",async()=>{
    await setState({paths:{saved:["Outline"],work:true}});
    await menu();
    expect(rows()).toEqual(["Off","Vertical","Horizontal","Dual Axis","Diagonal","Wavy","Circle","Spiral","Parallel Lines","Radial","Mandala","Work Path","Selected Shape Layer Path","Outline"]);
    await act(async()=>row("Parallel Lines").click());
    expect(command.mock.calls.filter(([id])=>id.startsWith("paint.symmetry"))).toEqual([["paint.symmetrySet",{type:"Parallel Lines"}]]);
  });
  it.each([["Radial",2,12],["Mandala",3,10]] as const)("asks for the %s segment count, %i to %i from 5, before sending it",async(name,min,max)=>{
    await menu();
    await act(async()=>row(name).click());
    expect(command).not.toHaveBeenCalled();
    expect(dialog()!.getAttribute("aria-label")).toBe(`${name} Symmetry`);
    expect(segments().value).toBe("5");
    await type(String(max+1));
    expect([ok().disabled,dialog()!.querySelector("[role=alert]")!.textContent]).toEqual([true,`Enter a whole number from ${min} to ${max}.`]);
    await type(String(min-1));
    expect(ok().disabled).toBe(true);
    await type("7");
    expect(ok().disabled).toBe(false);
    await act(async()=>ok().click());
    expect(command.mock.calls).toEqual([["paint.symmetrySet",{type:name,segments:7}]]);
    expect(dialog()).toBeNull();
  });
  it("sends nothing when the segment count is cancelled and holds OK while busy",async()=>{
    await menu();
    await act(async()=>row("Radial").click());
    await act(async()=>usePhotoWorkspace.setState({busy:true}));
    expect(ok().disabled).toBe(true);
    await act(async()=>usePhotoWorkspace.setState({busy:false}));
    await act(async()=>[...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(element=>element.textContent==="Cancel")!.click());
    expect([dialog(),command.mock.calls]).toEqual([null,[]]);
  });
  it("checks the symmetry the document reports, reopening Radial at its segments",async()=>{
    await setState({symmetry:{type:"Radial",segments:9,center:[400,300],angle:0},paths:{saved:["Outline"],work:true}});
    await menu();
    expect([row("Radial").getAttribute("aria-checked"),row("Off").getAttribute("aria-checked")]).toEqual(["true","false"]);
    await act(async()=>row("Radial").click());
    expect(segments().value).toBe("9");
    await act(async()=>[...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(element=>element.textContent==="Cancel")!.click());
    await setState({symmetry:{type:"Path",path:"Outline"}});
    await click("Painting symmetry");
    expect(row("Outline").getAttribute("aria-checked")).toBe("true");
    await click("Painting symmetry");
    await setState({symmetry:{type:"Path",path:"work"}});
    await click("Painting symmetry");
    expect(row("Work Path").getAttribute("aria-checked")).toBe("true");
  });
  it("sends Off as paint.symmetryDisable only while a symmetry is set",async()=>{
    await menu();
    await act(async()=>row("Off").click());
    expect(command).not.toHaveBeenCalled();
    await setState({symmetry:{type:"Vertical",center:[400,300],angle:0}});
    await click("Painting symmetry");
    await act(async()=>row("Off").click());
    expect(command.mock.calls).toEqual([["paint.symmetryDisable"]]);
  });
  it("keeps Paint Symmetry off the Mixer Brush bar, whose strokes ignore it",async()=>{
    await chooseTool("paint.mixerBrush");
    expect(button("Painting symmetry")).toBeUndefined();
    await chooseTool("paint.stroke");
    expect(button("Painting symmetry")).toBeDefined();
  });
});
