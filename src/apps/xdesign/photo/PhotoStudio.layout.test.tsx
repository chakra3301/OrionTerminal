import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePhotoWorkspace } from "./runtime";
import { useFreeTransform } from "./freeTransform";
import { xdesignActivityReason } from "../runtimeActivity";
import { PhotoStudio } from "./PhotoStudio";
import type { PhotoCloneSources, PhotoDocument, PhotoLayer, PhotoPanels, PhotoState } from "./types";
import { useViewAids } from "./viewGuides";
import { PAINT_TOOL_PREFERENCES_KEY } from "./paintToolPreferences";
import { IMAGE_TOOL_GROUPS } from "../editorTools";
import { unbaked } from "./gradientMethod";
import { useColorSamplers } from "./colorSamplers";
import { recordActionStep, useActions } from "./actions";
import { lastTextCaret } from "./CanvasTextEditor";
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, usePreferences } from "./preferences";

const command = vi.hoisted(() => vi.fn(async (_id:string,_params:Record<string,unknown>={}) => undefined));
const colors=vi.hoisted(()=>vi.fn(async(_colors:Record<string,string>)=>undefined));
const native=vi.hoisted(()=>({enabled:false,invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled, invoke: native.invoke, convertFileSrc: (path: string) => path }));
const fromClipboard = vi.hoisted(() => vi.fn(async () => undefined));
const placeBlob = vi.hoisted(() => vi.fn(async (_image:Blob) => undefined));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: command, setPhotoColors:colors, placeImageBlob: placeBlob, createImageFromClipboard: fromClipboard }));
const tileSurface=vi.hoisted(()=>({current:null as import("./strokeCanvas").TileSurface|null}));
vi.mock("./PhotoTiles", async original => ({ ...await original<typeof import("./PhotoTiles")>(), PhotoTiles: ({surface,edges}:{surface?:import("./strokeCanvas").TileSurface;edges?:boolean}) => {tileSurface.current=surface??null;return <div data-testid="detail-tiles" data-edges={String(edges)}/>;} }));
let root: Root, container: HTMLDivElement;
const emptyCloneSources=():PhotoCloneSources=>({active:0,sources:Array.from({length:5},(_,index)=>({index,source:null,anchor:null,offset:null,layer:null,width:100,height:100,rotation:0,flipH:false,flipV:false})),overlay:{show:true,opacity:100,clipped:true,auto_hide:true,invert:false,blend:"normal"}});
const installCloneSources=(cloneSource:PhotoCloneSources)=>usePhotoWorkspace.setState(current=>({state:{...current.state!,presets:{gradient:{name:"Default",stops:[[0,"foreground"],[1,"background"]],transparency:[]},gradients:[],styles:[],...current.state!.presets,cloneSource}}}));
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.getAttribute("aria-label") === label || element.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const menu=async(...path:string[])=>{for(const [index,label] of path.entries())await act(async()=>[...container.querySelectorAll<HTMLButtonElement>(index?"[role=menu] > button":"[role=menubar] > button")].find(element=>element.textContent===label)!.click());};
const row=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>("[role=menu] > button")].find(element=>element.textContent===label)!;
const framed=async()=>{await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,transformBounds:[10,20,300,200]}))}})));return container.querySelector<HTMLInputElement>('[aria-label="Width"]')!;};
const choose=async(path:string[],label:string)=>{await menu(...path);await act(async()=>row(label).click());};
const showDocument=()=>act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,activeLayer:null}})));
const pickColor=async(label:string,hex:string)=>{await click(label);await act(async()=>{const field=container.querySelector<HTMLInputElement>('[role="dialog"] [aria-label="Hex color"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,hex);field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Enter"}));});await click("OK");};
const chooseTool=async(id:string)=>{const group=IMAGE_TOOL_GROUPS.find(entry=>entry.tools.some(tool=>tool.id===id))!,label=group.tools.find(tool=>tool.id===id)!.label;if(group.tools.length>1)await act(async()=>container.querySelector<HTMLButtonElement>(`[aria-label="Choose ${group.label.toLowerCase()}"]`)!.click());await act(async()=>(group.tools.length>1?[...container.querySelectorAll<HTMLButtonElement>("[role=menu] > button")].find(element=>element.textContent===label)!:container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!).click());};
const pick = async (label: string, value: string) => { await act(async () => { const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); }); };
const inputNumber = async (label:string,value:number) => {await act(async()=>{const element=container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(element,String(value));element.dispatchEvent(new Event("input",{bubbles:true}));});};
const setBrushSize=async(value:number)=>{if(!container.querySelector('[aria-label="Brush size"]'))await click("Brush preset picker");await inputNumber("Brush size",value);};
const brushSize=()=>container.querySelector('[aria-label="Brush preset picker"]')?.textContent;
const offsetDraft=async(axis:"X"|"Y",value:string)=>{const element=container.querySelector<HTMLInputElement>(`[aria-label="Clone source offset ${axis}"]`)!;await act(async()=>{element.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});return element;};
const sourceDraft=async(label:string,value:string)=>{const element=container.querySelector<HTMLInputElement>(`[aria-label="Saved source ${label}"]`)!;await act(async()=>{element.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});return element;};
const gestureCanvas = () => {
  const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!,stage=container.querySelector<HTMLDivElement>(".xd-photo-stage")!,image=container.querySelector<HTMLDivElement>(".xd-photo-image")!;
  const bounds={left:0,top:0,width:800,height:600} as DOMRect;vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;vi.spyOn(stage,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(image,"getBoundingClientRect").mockReturnValue(bounds);Object.defineProperties(stage,{clientWidth:{value:800},clientHeight:{value:600}});
  return canvas;
};
// WebKit delivers ⌘V to the focused paste catcher; jsdom needs the event dispatched by hand.
const paste = (files:File[]=[]) => act(async()=>{const field=document.querySelector(".xd-paste-catcher")!;const event=new Event("paste",{bubbles:true,cancelable:true});Object.defineProperty(event,"clipboardData",{value:{files,getData:()=>""}});field.dispatchEvent(event);});
const drag = (canvas:HTMLCanvasElement) => act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:45}));});
beforeEach(async () => {
  useViewAids.setState(state=>({flags:{...state.flags,snap:false}}));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  localStorage.removeItem(PAINT_TOOL_PREFERENCES_KEY);
  native.enabled=false;native.invoke.mockReset();command.mockReset();command.mockImplementation(async(id,params={})=>{
    if(["cloneSource.set","cloneSource.select","cloneSource.resetTransform"].includes(id)){
      const state=structuredClone(usePhotoWorkspace.getState().state?.presets?.cloneSource??emptyCloneSources()),index=Number(params.index??state.active),slot=state.sources[index]!;
      if(id==="cloneSource.set"){
        if(params.source){slot.source=params.source as [number,number];slot.anchor=null;slot.offset=null;}
        if(params.offset){const anchor=slot.anchor??slot.source;if(!anchor)throw new Error("set a source before an offset");const offset=params.offset as [number,number];slot.anchor=[...anchor];slot.source=[anchor[0]+offset[0],anchor[1]+offset[1]];slot.offset=[...offset];}
        for(const key of ["width","height","rotation"] as const)if(typeof params[key]==="number")slot[key]=Number(params[key]);
        slot.rotation=((slot.rotation+180)%360+360)%360-180;
        for(const key of ["flipH","flipV"] as const)if(typeof params[key]==="boolean")slot[key]=Boolean(params[key]);
      }
      if(id==="cloneSource.resetTransform")Object.assign(slot,{width:100,height:100,rotation:0,flipH:false,flipV:false});else state.active=index;
      installCloneSources(state);
    }
    return undefined;
  });colors.mockClear(); useXDesign.getState().hydrate(null);
  const id = ulid(), version = ulid();
  const doc: PhotoDocument = { id, version, name: "Portrait", width: 800, height: 600, previewWidth: 800, previewHeight: 600, bundlePath: `/assets/${version}.pcraft`, previewPath: `/assets/${version}.png`, originalPath: null };
  const placement = useXDesign.getState().applyPhotoDocument(doc);
  const state: PhotoState = { name: "Portrait", width: 800, height: 600, mode: "RGB", depth: 8, resolution: 72, activeLayer: 1, hasSelection: false, selectionBounds: null, layers: [{ id: 1, name: "Portrait layer", kind: "Raster", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false }], canUndo: true, canRedo: false, historySources:[{id:ulid(),index:0,label:"Open",current:false,available:true},{id:ulid(),index:1,label:"Brush Tool",current:true,available:true}] };
  usePhotoWorkspace.setState({ shapeId: placement, documentId: id, projectId: ulid(), source: "legacy", state, stateVersion: version, busy: false, error: null, warnings: [] });
  useXDProjects.setState({activeId:usePhotoWorkspace.getState().projectId,transitioning:false});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<PhotoStudio/>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); usePhotoWorkspace.getState().close(); vi.unstubAllGlobals(); });

describe("Image workspace layout", () => {
  it("fades the last step from Edit with an opacity and blend mode", async () => {
    await menu("Edit"); expect(row("Fade…").disabled).toBe(true);
    await act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,canFade:true}})));
    await act(async()=>row("Fade Brush Tool…").click());
    expect(container.querySelector('[role="dialog"][aria-label="Fade"]')).not.toBeNull();
    await inputNumber("Opacity",40); await pick("Mode","Multiply"); await click("OK");
    expect(command).toHaveBeenLastCalledWith("edit.fade",{opacity:40,mode:"Multiply"});
  });
  it("opens Photoshop's Layer Style dialog from Layer > Layer Style, the fx button and a layer row", async () => {
    const dialog=()=>container.querySelector('[role="dialog"][aria-label="Layer Style"]');
    await menu("Layer","Layer Style");
    expect([...container.querySelectorAll("[role=menu]")].at(-1)!.textContent).toContain("Blending Options…Bevel & Emboss…Stroke…Inner Shadow…Inner Glow…Satin…Color Overlay…Gradient Overlay…Pattern Overlay…Outer Glow…Drop Shadow…Copy Layer Style");
    await act(async()=>row("Drop Shadow…").click());
    expect(dialog()).not.toBeNull();expect(command).toHaveBeenCalledWith("layer.layerStyle.dropShadow",{layer:1,add:true});
    await act(async()=>[...dialog()!.querySelectorAll("button")].find(element=>element.textContent==="Cancel")!.click());expect(dialog()).toBeNull();
    await click("Add a layer style");await act(async()=>row("Stroke…").click());
    expect(dialog()).not.toBeNull();expect(command).toHaveBeenCalledWith("layer.layerStyle.stroke",{layer:1,add:true});
    await act(async()=>[...dialog()!.querySelectorAll("button")].find(element=>element.textContent==="Cancel")!.click());
    command.mockClear();
    await act(async()=>container.querySelector('.xd-photo-layer-list [data-layer="1"]')!.dispatchEvent(new MouseEvent("dblclick",{bubbles:true})));
    expect(dialog()).not.toBeNull();expect(command).not.toHaveBeenCalledWith(expect.stringMatching(/^layer\.layerStyle\./),expect.anything());
  });
  it("shows a group as Photoshop does: a disclosure chevron and folder, children indented after the eye column, folded in the document", async () => {
    const layer=(id:number,name:string,extra:Partial<PhotoLayer>={}):PhotoLayer=>({id,name,kind:"Raster",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,...extra});
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:[layer(3,"Group 1",{kind:"Group",children:[layer(5,"Curves 1",{kind:"Adjustment",adjustmentKind:"curves",hasMask:true}),layer(6,"Inner",{kind:"Group",expanded:false,children:[layer(7,"Deep")]})]}),layer(8,"Group 2",{kind:"Group",children:[layer(9,"Other")]}),layer(1,"Background")]}})));
    const rowOf=(name:string)=>[...container.querySelectorAll<HTMLElement>(".xd-photo-layer-list [data-layer]")].find(row=>row.querySelector(".xd-photo-layer-name span")?.textContent===name);
    const group=rowOf("Group 1")!,curves=rowOf("Curves 1")!;
    expect(group.classList.contains("group")).toBe(true);
    expect(group.querySelector(".xd-photo-layer-thumb-button .lucide-folder")).not.toBeNull();expect(group.querySelector("img")).toBeNull();
    expect(curves.querySelector(".xd-photo-layer-thumb-button .lucide-chart-spline")).not.toBeNull();
    expect(group.style.paddingLeft).toBe(curves.style.paddingLeft);
    expect(curves.querySelector<HTMLElement>("button")!.style.marginRight).toBe("18px");
    expect(rowOf("Inner")).toBeDefined();expect(rowOf("Deep")).toBeUndefined();
    const folded=(layers:PhotoLayer[],ids:number[],open:boolean):PhotoLayer[]=>layers.map(layer=>({...layer,...ids.includes(layer.id)?{expanded:open}:{},...layer.children?{children:folded(layer.children,ids,open)}:{}}));
    command.mockImplementation(async(id,params={})=>{if(id==="layer.setGroupsExpanded")usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:folded(s.state!.layers,params.layers as number[],params.expanded as boolean)}}));});
    const modified=async(label:string,keys:MouseEventInit)=>{await act(async()=>button(label).dispatchEvent(new MouseEvent("click",{bubbles:true,...keys})));};
    await click("Collapse Group 1");
    expect(command).toHaveBeenLastCalledWith("layer.setGroupsExpanded",{layers:[3],expanded:false});
    expect(rowOf("Curves 1")).toBeUndefined();expect(button("Expand Group 1").getAttribute("aria-expanded")).toBe("false");
    await modified("Expand Group 1",{altKey:true});
    expect(command).toHaveBeenLastCalledWith("layer.setGroupsExpanded",{layers:[3,6],expanded:true});
    expect(rowOf("Curves 1")).toBeDefined();expect(rowOf("Deep")!.querySelector<HTMLElement>("button")!.style.marginRight).toBe("36px");
    await modified("Collapse Group 1",{metaKey:true});
    expect(command).toHaveBeenLastCalledWith("layer.setGroupsExpanded",{layers:[3,8],expanded:false});
    expect(rowOf("Other")).toBeUndefined();
    await click("Expand Group 1");
    expect(rowOf("Deep")).toBeDefined();
    let fail!:(error:Error)=>void;
    command.mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;}));
    await click("Collapse Inner");
    expect(rowOf("Deep")).toBeUndefined();
    await act(async()=>fail(new Error("The image changed")));
    expect(rowOf("Deep")).toBeDefined();
  });
  it("collapses every group from the Layers panel menu or a layer's menu, and scrolls a layer that becomes active into the list", async () => {
    const layer=(id:number,name:string,extra:Partial<PhotoLayer>={}):PhotoLayer=>({id,name,kind:"Raster",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,...extra});
    const shut=(layers:PhotoLayer[]):PhotoLayer[]=>layers.map(layer=>layer.children?{...layer,expanded:false,children:shut(layer.children)}:layer);
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,activeLayer:3,layers:[layer(3,"Group 1",{kind:"Group",children:[layer(6,"Inner",{kind:"Group",children:[layer(7,"Deep")]})]}),layer(1,"Background")]}})));
    command.mockImplementation(async id=>{if(id==="layer.setExpanded")usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:shut(s.state!.layers)}}));});
    const names=()=>[...container.querySelectorAll(".xd-photo-layer-list .xd-photo-layer-name span")].map(span=>span.textContent);
    const items=()=>[...container.querySelectorAll<HTMLButtonElement>("[role=menu] > button")];
    const collapseAll=()=>items().findIndex(item=>item.textContent==="Collapse All Groups");
    await click("Layers panel options");
    expect(items()[collapseAll()-1]!.textContent).toMatch(/^New Group from Layers/);
    await act(async()=>items()[collapseAll()]!.click());
    expect(command).toHaveBeenLastCalledWith("layer.setExpanded",{all:true,expanded:false});
    expect(names()).toEqual(["Group 1","Background"]);
    await act(async()=>container.querySelector('.xd-photo-layer-list [data-layer="1"]')!.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true})));
    expect(items()[collapseAll()-1]!.textContent).toBe("Group from Layers…");
    await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));

    const list=container.querySelector<HTMLElement>(".xd-photo-layer-list")!;let scrolled=0;
    Object.defineProperty(list,"scrollTop",{configurable:true,get:()=>scrolled,set:value=>{scrolled=value;}});
    const at:Record<string,[number,number]>={1:[140,160],3:[-30,-10]};
    const boxes=vi.spyOn(Element.prototype,"getBoundingClientRect").mockImplementation(function(this:Element){const [top,bottom]=this===list?[0,100]:at[(this as HTMLElement).dataset.layer??""]??[0,0];return {top,bottom,left:0,right:200,width:200,height:bottom-top,x:0,y:top} as DOMRect;});
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,activeLayer:1}})));
    expect(scrolled).toBe(60);
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,activeLayer:3}})));
    expect(scrolled).toBe(30);
    boxes.mockRestore();

    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,activeLayer:1,layers:[layer(1,"Background")]}})));
    await click("Layers panel options");
    expect(items()[collapseAll()]!.disabled).toBe(true);
  });

  it("offers Pass Through atop the blend modes only for a group, and shows it as the group's mode", async () => {
    const layer=(id:number,name:string,extra:Partial<PhotoLayer>={}):PhotoLayer=>({id,name,kind:"Raster",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,...extra});
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,activeLayer:3,layers:[layer(3,"Group 1",{kind:"Group",blend:"Pass Through",children:[layer(2,"Inside")]}),layer(1,"Background")]}})));
    const blend=()=>container.querySelector<HTMLSelectElement>('[aria-label="Layer blend mode"]')!;
    expect(blend().value).toBe("Pass Through");expect(blend().options[0]!.value).toBe("Pass Through");expect([...blend().querySelectorAll("hr")].map(hr=>hr.nextElementSibling!.textContent)).toEqual(["Darken","Lighten","Overlay","Difference","Hue"]);
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,activeLayer:1}})));
    expect(blend().value).toBe("Normal");expect([...blend().options].map(option=>option.value)).not.toContain("Pass Through");
  });
  it("shows selections as marching ants only by default, like Photoshop", async () => {
    await showDocument();
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Selection display"]')!.value).toBe("outline");
  });
  it("hides selection edges from View > Show > Selection Edges and with Extras (Mod+H), like Photoshop", async () => {
    const edges=()=>container.querySelector('[data-testid="detail-tiles"]')!.getAttribute("data-edges");
    expect(edges()).toBe("true");
    await menu("View","Show");expect(row("Selection Edges").getAttribute("aria-checked")).toBe("true");
    await act(async()=>row("Selection Edges").click());expect(edges()).toBe("false");
    await choose(["View","Show"],"Selection Edges");expect(edges()).toBe("true");
    const editor=container.querySelector('[aria-label="Image editor"]')!,hide=()=>act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"h",metaKey:true})));
    await hide();expect(edges()).toBe("false");await hide();expect(edges()).toBe("true");
  });
  it("lists Target Path under View > Show after Selection Edges, like Photoshop", async () => {
    await menu("View","Show");
    expect([...document.querySelectorAll('[role="menu"]')].at(-1)!.querySelectorAll('[role^="menuitem"]')[2]!.textContent).toContain("Target Path");
    expect(row("Target Path").getAttribute("aria-checked")).toBe("true");
    await act(async()=>row("Target Path").click());expect(useViewAids.getState().flags.targetPath).toBe(false);
    await choose(["View","Show"],"Target Path");expect(useViewAids.getState().flags.targetPath).toBe(true);
  });
  it("turns, flips and fits the view and shows layer edges, Smart Guides and the pixel grid from View, like Photoshop", async () => {
    await menu("View","Show");
    expect([...[...document.querySelectorAll('[role="menu"]')].at(-1)!.querySelectorAll('[role^="menuitem"]')].map(element=>element.textContent)).toEqual(["Layer Edges","Selection Edges","Target Path","Grid","Guides","Smart Guides","Pixel Grid"]);
    await act(async()=>row("Layer Edges").click());expect(useViewAids.getState().flags.layerEdges).toBe(true);
    expect(container.querySelector(".xd-photo-layer-edges rect")).toBeNull();
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,bounds:[100,50,200,100] as [number,number,number,number]}))}})));
    expect(container.querySelector(".xd-photo-layer-edges rect")!.getAttribute("x")).toBe("100");
    await menu("View","Snap To");expect(row("Layers").getAttribute("aria-checked")).toBe("true");
    await act(async()=>row("None").click());expect(useViewAids.getState().flags.snapTo.layers).toBe(false);
    await menu("View");expect(row("Fit Layer(s) on Screen").disabled).toBe(false);expect(row("Print Size").disabled).toBe(false);
    await act(async()=>row("Flip Horizontal").click());
    const image=container.querySelector<HTMLElement>(".xd-photo-image")!;
    expect(image.dataset.viewFlip).toBe("");expect(image.style.transform).toContain("scaleX(-1)");
    await chooseTool("rotateView");const angle=container.querySelector<HTMLInputElement>('[aria-label="Rotation Angle"]')!;
    await act(async()=>angle.focus());await inputNumber("Rotation Angle",45);await act(async()=>angle.blur());
    expect(image.dataset.viewAngle).toBe("45");expect(image.style.transform).toContain("rotate(45deg)");
    await click("Reset View");expect(image.dataset.viewAngle).toBeUndefined();
    await choose(["View"],"Flip Horizontal");expect(image.style.transform).toBe("");
  });
  it("colours layers from the Layers context menu, tints their visibility column and filters by colour, like Photoshop", async () => {
    const layerRow=()=>container.querySelector<HTMLElement>('.xd-photo-layer-list [data-layer="1"]');
    await act(async()=>layerRow()!.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true})));
    expect([...container.querySelectorAll("[role=menu] > button")].slice(-8).map(element=>element.textContent)).toEqual(["No Color","Red","Orange","Yellow","Green","Blue","Violet","Gray"]);
    expect(row("Violet").querySelector(".xd-photo-label-swatch")!.getAttribute("data-color")).toBe("violet");
    await act(async()=>row("Violet").click());expect(command).toHaveBeenLastCalledWith("layer.setColor",{color:"violet"});
    expect(layerRow()!.dataset.color).toBeUndefined();
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,color:"violet" as const}))}})));
    expect(layerRow()!.dataset.color).toBe("violet");expect(layerRow()!.querySelector(":scope > .xd-photo-layer-eye")).not.toBeNull();
    await pick("Select filter type","color");await pick("Filter by layer color","red");expect(layerRow()).toBeNull();
    await pick("Filter by layer color","violet");expect(layerRow()).not.toBeNull();
  });
  it("drags layers above, below and into groups with pointer events, never below the Background", async () => {
    const layer=(id:number,name:string,extra:Partial<PhotoLayer>={}):PhotoLayer=>({id,name,kind:"Raster",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,...extra});
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:[layer(4,"Top"),layer(3,"Folder",{kind:"Group",children:[layer(5,"Inside")]}),layer(2,"Middle"),layer(1,"Background",{locks:{transparency:true,pixels:false,position:true,all:false}})]}})));
    const rowOf=(name:string)=>[...container.querySelectorAll<HTMLElement>(".xd-photo-layer-list [data-layer]")].find(row=>row.querySelector(".xd-photo-layer-name span")?.textContent===name)!;
    let hovered:HTMLElement|null=null;
    Object.defineProperty(document,"elementFromPoint",{configurable:true,value:()=>hovered});
    const drag=async(from:string,to:string,fraction:number,finish:"drop"|"escape"="drop")=>{
      hovered=rowOf(to);vi.spyOn(hovered,"getBoundingClientRect").mockReturnValue({left:0,top:100,width:200,height:20,right:200,bottom:120,x:0,y:100} as DOMRect);
      await act(async()=>{rowOf(from).querySelector(".xd-photo-layer-name")!.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:10,clientY:0}));window.dispatchEvent(new MouseEvent("pointermove",{clientX:10,clientY:100+20*fraction}));});
      const shown=hovered.dataset.drop;
      await act(async()=>{if(finish==="escape")window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}));window.dispatchEvent(new MouseEvent("pointerup",{clientX:10,clientY:100+20*fraction}));rowOf(from).querySelector<HTMLButtonElement>(".xd-photo-layer-name")!.click();});
      expect(hovered.dataset.drop).toBeUndefined();expect(container.ownerDocument.querySelector(".xd-photo-row-ghost")).toBeNull();
      return shown;
    };
    command.mockClear();
    expect(await drag("Top","Middle",.8)).toBe("below");expect(command).toHaveBeenLastCalledWith("layer.moveTo",{layer:4,target:2,position:"below"});
    expect(await drag("Middle","Folder",.5)).toBe("into");expect(command).toHaveBeenLastCalledWith("layer.moveTo",{layer:2,target:3,position:"into"});
    expect(await drag("Middle","Folder",.9)).toBe("into");
    expect(await drag("Inside","Top",.1)).toBe("above");expect(command).toHaveBeenLastCalledWith("layer.moveTo",{layer:5,target:4,position:"above"});
    expect(await drag("Top","Background",.9)).toBe("above");expect(command).toHaveBeenLastCalledWith("layer.moveTo",{layer:4,target:1,position:"above"});
    command.mockClear();
    expect(await drag("Folder","Inside",.5)).toBeUndefined();
    expect(await drag("Top","Folder",.1)).toBeUndefined();
    expect(await drag("Middle","Top",.2,"escape")).toBe("above");
    expect(await drag("Background","Top",.2)).toBeUndefined();
    expect(command).not.toHaveBeenCalledWith("layer.moveTo",expect.anything());
    expect(command.mock.calls.filter(([name])=>name==="layer.select").map(([,params])=>params)).toEqual([{layer:1,target:"pixels",mode:"replace"}]);
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,selectedLayers:[4,2,1]}})));
    expect(await drag("Top","Folder",.5)).toBe("into");expect(command).toHaveBeenLastCalledWith("layer.moveLayersTo",{layers:[4,2],target:3,position:"into"});
    expect(await drag("Top","Middle",.2)).toBeUndefined();
    expect(await drag("Inside","Top",.1)).toBe("above");expect(command).toHaveBeenLastCalledWith("layer.moveTo",{layer:5,target:4,position:"above"});
    Reflect.deleteProperty(document,"elementFromPoint");
  });
  it("rotates the canvas by an arbitrary angle from Image Rotation", async () => {
    await choose(["Image","Image Rotation"],"Arbitrary…");
    expect(container.querySelector('[role="dialog"][aria-label="Rotate Canvas"]')).not.toBeNull();
    await inputNumber("Angle",12.5); await act(async()=>container.querySelector<HTMLInputElement>('[role="dialog"] input[type="radio"][value="ccw"]')!.click()); await click("OK");
    expect(command).toHaveBeenLastCalledWith("image.rotation.arbitrary",{angle:12.5,direction:"ccw"});
  });
  it("opens native placement options from File only with affirmative capability", async () => {
    await menu("File"); expect(button("Place Embedded…").disabled).toBe(true); expect(button("Place Linked…").disabled).toBe(true);
    await act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,features:{placeImages:true}}})));
    await click("Place Linked…"); expect(container.querySelector('[role="dialog"][aria-label="Place Linked"]')).not.toBeNull();
    await click("Cancel"); await menu("File","Place Embedded…"); expect(container.querySelector('[role="dialog"][aria-label="Place Embedded"]')).not.toBeNull();
  });
  it("mounts magnetic lasso over the retained image and persists its independent tool options", async () => {
    await chooseTool("magneticLasso");
    expect(container.querySelector('.xd-photo-image [aria-label="Magnetic lasso canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="detail-tiles"]')).not.toBeNull();
    expect(container.textContent).toContain("Magnetic lasso requires an updated native engine");
    await inputNumber("Tool Edge width (px)",24);await inputNumber("Tool Edge contrast (%)",35);await inputNumber("Tool Fastening frequency",80);
    await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(<PhotoStudio/>));await chooseTool("magneticLasso");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Edge width (px)"]')!.value).toBe("24");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Edge contrast (%)"]')!.value).toBe("35");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Fastening frequency"]')!.value).toBe("80");
    await drag(gestureCanvas());expect(command).not.toHaveBeenCalled();
  });

  it("makes Perspective Crop a Crop-group tool whose dragged box opens on the existing canvas without an active layer", async () => {
    expect(IMAGE_TOOL_GROUPS.find(group=>group.label==="Crop tools")!.tools.map(tool=>tool.label)).toEqual(["Crop Tool","Perspective Crop Tool","Slice Tool","Slice Select Tool","Straighten Tool"]);
    const dialog=()=>container.querySelector('[role="dialog"][aria-label="Perspective Crop"]'),value=(label:string)=>container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.valueAsNumber;
    await chooseTool("crop"); expect(button("Perspective Crop…")).toBeUndefined();
    await chooseTool("perspectiveCrop"); expect(container.textContent).toContain("Perspective crop requires an updated native engine");
    await drag(gestureCanvas()); expect(dialog()).toBeNull();
    await act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,activeLayer:null,layers:[],features:{perspectiveCrop:true}}})));
    expect(container.textContent).toContain("Drag a box around a photographed page or screen");
    const zoomed=gestureCanvas();vi.spyOn(zoomed,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:600,height:450} as DOMRect);
    await drag(zoomed); expect(dialog()).not.toBeNull();
    expect([value("Top left X"),value("Top left Y"),value("Bottom right X"),value("Bottom right Y")]).toEqual([27,33,53,60]);
    const surface=container.querySelector<SVGSVGElement>('svg[aria-label="Perspective crop canvas"]')!;vi.spyOn(surface,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:600,height:450} as DOMRect);
    await act(async()=>{container.querySelector('[aria-label="Top left crop corner"]')!.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:200,clientY:250}));surface.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:191.3,clientY:247.9}));surface.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,clientX:191.3,clientY:247.9}));});
    expect([value("Top left X"),value("Top left Y")]).toEqual([Math.round(value("Top left X")),Math.round(value("Top left Y"))]);expect(value("Top left X")).not.toBe(27);
    expect(container.querySelector('.xd-photo-image > svg[aria-label="Perspective crop canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="detail-tiles"]')).not.toBeNull(); expect(container.querySelector('[aria-label="Image layers"]')!.hasAttribute("inert")).toBe(true);
    await click("Cancel"); expect(container.querySelector('[aria-label="Perspective crop canvas"]')).toBeNull(); expect(container.querySelector('[aria-label="Image layers"]')!.hasAttribute("inert")).toBe(false);
    expect(container.querySelector('[aria-label="Current tool: Perspective Crop Tool"]')).not.toBeNull(); expect(command).not.toHaveBeenCalled();
  });
  const openPerspectiveCrop=async()=>{await chooseTool("perspectiveCrop");await act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,features:{perspectiveCrop:true}}})));const canvas=gestureCanvas();vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:600,height:450} as DOMRect);await drag(canvas);};
  const typeLength=async(label:string,value:string)=>{const element=container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;await act(async()=>{element.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>element.blur());};
  const sizeFields=()=>["Crop width","Crop height","Crop resolution"].map(label=>container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.value);
  it("keeps the perspective crop bar live while the crop box is open, as Photoshop does", async () => {
    await openPerspectiveCrop(); expect(container.querySelector(".xd-photo-perspective-grid")).not.toBeNull();
    expect(container.querySelector(".xd-ps-options")!.hasAttribute("inert")).toBe(false);
    expect(container.querySelector(".xd-ps-menubar")!.hasAttribute("inert")).toBe(true);
  });
  it("perspective crop bar edits share the dialog size", async () => {
    await openPerspectiveCrop(); expect(container.querySelector(".xd-photo-perspective-grid")).not.toBeNull();
    await typeLength("Crop width","400"); await typeLength("Crop height","300"); expect(container.textContent).toContain("400 × 300 px");
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Show grid"]')!.click()); expect(container.querySelector(".xd-photo-perspective-grid")).toBeNull();
    command.mockClear(); await click("Apply"); await act(async()=>{});
    expect(command.mock.calls).toEqual([["image.xdesignPerspectiveCrop",expect.objectContaining({width:400,height:300})]]);
  });
  it("perspective crop bar Front Image fills the bar from the document and its resolution folds into one step", async () => {
    await openPerspectiveCrop(); await click("Front Image"); expect(sizeFields()).toEqual(["800 px","600 px","72"]);
    await inputNumber("Crop resolution",300); command.mockClear(); await click("Apply"); await act(async()=>{});
    expect(command.mock.calls).toEqual([["image.xdesignPerspectiveCrop",expect.objectContaining({width:800,height:600})],["image.imageSize",{resolution:300,resample:"none"}],["history.fold",{from:1,label:"Perspective Crop"}]]);
  });
  it("perspective crop bar Clear empties W/H/Resolution and restores the automatic size", async () => {
    await openPerspectiveCrop(); await click("Front Image"); expect(container.textContent).toContain("800 × 600 px");
    await click("Clear crop size"); expect(sizeFields()).toEqual(["","",""]); expect(container.textContent).toContain("26 × 27 px");
  });
  it("straightens from a reference line with image/layer scope retained after remount", async () => {
    await chooseTool("straighten");
    expect(container.textContent).toContain("Draw along a horizon or vertical edge");
    await drag(gestureCanvas());
    expect(command).toHaveBeenLastCalledWith("image.analysis.straightenLayer", { start: [20,25], end: [40,45], crop: true });
    await pick("Tool Straighten target", "layers"); await drag(gestureCanvas());
    expect(command).toHaveBeenLastCalledWith("image.analysis.straightenLayer", { start: [20,25], end: [40,45], crop: false });
    expect(usePhotoWorkspace.getState().busy).toBe(false);
    await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(<PhotoStudio/>));
    await chooseTool("straighten");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Tool Straighten target"]')!.value).toBe("layers");
  });
  it("patches the existing selection once with a rounded image-space drag offset",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,hasSelection:true,selectionBounds:[100,120,220,180]}})));
    await chooseTool("paint.patch");await pick("Tool Patch mode","destination");
    expect(container.textContent).toContain("Copy selected texture to the place you drag toward; that destination is repaired.");
    const canvas=gestureCanvas();await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:33.2,clientY:40.7}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:38.6,clientY:45.2}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:38.6,clientY:45.2}));});
    expect(command).toHaveBeenCalledTimes(1);expect(command).toHaveBeenLastCalledWith("paint.patch",{offset:[19,20],mode:"destination",layer:1,target:"pixels"});expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it("converts a zoomed canvas drag into image-pixel offset",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,hasSelection:true,selectionBounds:[100,120,220,180]}})));await chooseTool("paint.patch");const canvas=gestureCanvas();vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:400,height:300} as DOMRect);
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:10,clientY:10}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:25,clientY:20}));});expect(command).toHaveBeenLastCalledWith("paint.patch",{offset:[30,20],mode:"source",layer:1,target:"pixels"});
  });
  it("rejects Patch without a selection and cancels without committing",async()=>{
    await chooseTool("paint.patch");const canvas=gestureCanvas();
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));expect(command).not.toHaveBeenCalled();expect(container.textContent).toContain("Make a bounded selection before using the Patch tool.");
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,hasSelection:true,selectionBounds:[100,120,220,180]}})));
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointercancel",{bubbles:true}));});
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("lostpointercapture",{bubbles:true}));});expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it("rejects a Patch drag that translates the selected bounds off canvas",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,hasSelection:true,selectionBounds:[790,590,10,10]}})));await chooseTool("paint.patch");const canvas=gestureCanvas();
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:35,clientY:40}));});expect(command).not.toHaveBeenCalled();expect(container.textContent).toContain("The translated selection must stay inside the image.");
  });
  it("runs Magic Eraser once at the original click coordinate and keeps complete tool options",async()=>{
    await chooseTool("paint.magicEraser");
    const canvas=gestureCanvas();await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:120,clientY:125}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:200,clientY:200}));});
    expect(command).toHaveBeenCalledTimes(1);expect(command).toHaveBeenLastCalledWith("paint.magicEraser",expect.objectContaining({x:20,y:25,tolerance:32,opacity:100,antiAlias:true,contiguous:true,sampleAllLayers:false}));
  });
  it("runs Background Eraser with the full pointer sample sequence and rejects mask targets",async()=>{
    await chooseTool("paint.backgroundEraser");const canvas=gestureCanvas();
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:32,clientY:40}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:32,clientY:40}));});
    expect(command).toHaveBeenCalledTimes(1);expect(command).toHaveBeenLastCalledWith("paint.backgroundEraser",expect.objectContaining({size:24,sampling:"continuous",limits:"contiguous",tolerance:50,protectForegroundColor:false,points:expect.arrayContaining([[20,25,1,0,0,0,expect.any(Number)],[32,40,1,0,0,0,expect.any(Number)]])}));
    command.mockClear();await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,hasMask:true}))}})));await click("Edit mask of Portrait layer");command.mockClear();await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));
    expect(command).not.toHaveBeenCalled();expect(container.textContent).toContain("Switch to the composite pixel layer first.");
  });
  it("keeps and commits the full Background Eraser stroke when bounded preview feedback is exceeded",async()=>{
    await chooseTool("paint.backgroundEraser");const canvas=gestureCanvas();
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,viewKey:"composite"}})));native.enabled=true;native.invoke.mockResolvedValue([]);
    const ctx={clearRect:vi.fn(),beginPath:vi.fn(),arc:vi.fn(),stroke:vi.fn(),setLineDash:vi.fn(),lineTo:vi.fn()};vi.mocked(canvas.getContext).mockReturnValue(ctx as never);
    const samples=(start:number,count:number)=>Array.from({length:count},(_,offset)=>{const index=start+offset;return {clientX:30+index%700,clientY:30+Math.floor(index/700),pressure:.7,pointerType:"pen",tiltX:12,tiltY:-8,twist:3,timeStamp:index+1};});
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));await act(async()=>new Promise(resolve=>setTimeout(resolve,120)));
    const version=usePhotoWorkspace.getState().stateVersion;for(const [start,count] of [[0,2000],[2000,2000],[4000,1000],[5000,1000]] as const)await act(async()=>{const points=samples(start,count),last=points.at(-1)!;const move=new MouseEvent("pointermove",{bubbles:true,clientX:last.clientX,clientY:last.clientY});Object.defineProperty(move,"getCoalescedEvents",{value:()=>points});canvas.dispatchEvent(move);});expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().stateVersion).toBe(version);const previewsAtCap=native.invoke.mock.calls.filter(call=>call[0]==="xdesign_photo_stroke_preview_pixels").length;expect(previewsAtCap).toBeGreaterThanOrEqual(1);for(const call of native.invoke.mock.calls.filter(call=>call[0]==="xdesign_photo_stroke_preview_pixels"))expect(((call[1] as {params:{points:unknown[]}}).params.points).length).toBeLessThanOrEqual(4096);expect(ctx.arc).toHaveBeenCalled();expect(ctx.lineTo).not.toHaveBeenCalled();
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:429,clientY:38})));
    expect(native.invoke.mock.calls.filter(call=>call[0]==="xdesign_photo_stroke_preview_pixels")).toHaveLength(previewsAtCap);expect(command).toHaveBeenCalledTimes(1);const points=command.mock.calls[0]![1]!.points as number[][];expect(points).toHaveLength(6001);expect(points[1]).toEqual([30,30,.7,12,-8,3,expect.any(Number)]);expect(points.at(-1)?.slice(0,2)).toEqual([429,38]);expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it("refuses a Background Eraser stroke that exceeds the native 131,072-sample commit cap",async()=>{
    await chooseTool("paint.backgroundEraser");const canvas=gestureCanvas();const samples=Array.from({length:131072},()=>({clientX:30,clientY:30,pressure:.5,pointerType:"pen",timeStamp:1}));
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));const move=new MouseEvent("pointermove",{bubbles:true,clientX:30,clientY:30});Object.defineProperty(move,"getCoalescedEvents",{value:()=>samples});canvas.dispatchEvent(move);canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:40}));});
    expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(container.textContent).toContain("exceeded the native 131,072-sample limit");
  });
  it("cancels an eraser gesture on pointer loss and rejects a stale project before commit",async()=>{
    await chooseTool("paint.magicEraser");const canvas=gestureCanvas();
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointercancel",{bubbles:true}));});expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));await act(async()=>useXDProjects.setState({activeId:ulid(),transitioning:false}));
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:20,clientY:25})));expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(container.textContent).toContain("image or editing target changed");
  });
  it("cancels a Patch drag when the project context changes",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,hasSelection:true,selectionBounds:[100,120,220,180]}})));await chooseTool("paint.patch");const canvas=gestureCanvas();
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));await act(async()=>usePhotoWorkspace.setState({projectId:ulid()}));
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:35,clientY:40})));expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it("refuses to start Patch outside the active project",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,hasSelection:true,selectionBounds:[100,120,220,180]}})));await chooseTool("paint.patch");const canvas=gestureCanvas();
    await act(async()=>useXDProjects.setState({activeId:ulid()}));
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));
    expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(container.textContent).toContain("Open this image from the current project before using Patch.");
  });
  it("cancels or rejects a short straighten gesture without dispatching pixels or a ruler", async () => {
    await chooseTool("straighten"); const canvas=gestureCanvas();
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:20,clientY:25}));});
    expect(command).not.toHaveBeenCalled();expect(container.textContent).toContain("at least one image pixel");
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointercancel",{bubbles:true})));
    expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));container.querySelector<HTMLElement>('[aria-label="Image editor"]')!.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape"}));});
    expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it("keeps only the latest endpoint of the straighten guide when pointer moves precede release", async () => {
    await chooseTool("straighten");const canvas=gestureCanvas();
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:90,clientY:10}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:45}));});
    expect(command).toHaveBeenLastCalledWith("image.analysis.straightenLayer", { start: [20,25], end: [40,45], crop: true });
  });
  it("connects saved proof toggles and Photoshop view shortcuts with busy and typing guards", async () => {
    await act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,colorView:{profile:"coated-cmyk",description:"CMYK",kind:"profile",intent:"relative",bpc:true,simulatePaper:false,on:false,gamutWarning:false,threshold:2,hdr:{highlightCompression:false,exposure:0,gamma:1},active:false},activeLayer:null}})));
    await choose(["View"],"Proof Colors"); expect(command).toHaveBeenLastCalledWith("view.proofColors",{on:true});
    await choose(["View"],"Gamut Warning"); expect(command).toHaveBeenLastCalledWith("view.gamutWarning",{on:true});
    const editor=container.querySelector('[aria-label="Image editor"]')!;command.mockClear();
    await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"y",metaKey:true})));expect(command).toHaveBeenLastCalledWith("view.proofColors",{on:true});
    await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"y",ctrlKey:true,shiftKey:true})));expect(command).toHaveBeenLastCalledWith("view.gamutWarning",{on:true});
    command.mockClear();await act(async()=>container.querySelector('input,textarea,select')?.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"y",metaKey:true})));
    await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"y",metaKey:true,isComposing:true})));await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"y",metaKey:true,repeat:true})));expect(command).not.toHaveBeenCalled();
    await act(async()=>usePhotoWorkspace.setState({busy:true}));await menu("View");expect(row("Proof Colors").disabled).toBe(true);await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"y",metaKey:true})));expect(command).not.toHaveBeenCalled();
  });
  it("opens proof and 32-bit workspaces while retaining the canvas", async () => {
    await showDocument();await menu("View");expect(row("32-bit Preview Options…").disabled).toBe(true);await act(async()=>row("Proof Setup").click());await act(async()=>row("Custom…").click());expect(container.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe("Proof Setup");expect(container.querySelector('[data-testid="detail-tiles"]')).not.toBeNull();await click("Cancel");
    await act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,depth:32}})));await choose(["View"],"32-bit Preview Options…");expect(container.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe("32-bit Preview Options");expect(container.querySelector('[data-testid="detail-tiles"]')).not.toBeNull();
  });
  it("opens profile workflows while preserving the mounted image canvas",async()=>{
    const canvas=container.querySelector('[aria-label="Paint and select image"]');await showDocument();
    for(const [name,title] of [["Assign Profile…","Assign Profile"],["Convert to Profile…","Convert to Profile"]] as const) {
      await choose(["Edit"],name);expect(container.querySelector(`[role="dialog"][aria-label="${title}"]`)).toBeTruthy();await click("Cancel");
    }
    for(const [name,title] of [["Profile information…","Color Profile Information"]] as const) {
      await click(name);expect(container.querySelector(`[role="dialog"][aria-label="${title}"]`)).toBeTruthy();await click("OK");expect(container.querySelector(`[role="dialog"][aria-label="${title}"]`)).toBeNull();
    }
    expect(container.querySelector('[aria-label="Paint and select image"]')).toBe(canvas);
    await act(async()=>usePhotoWorkspace.setState({state:null,stateVersion:null}));
    expect(button("Profile information…").disabled).toBe(true);await menu("Edit");for(const name of ["Assign Profile…","Convert to Profile…"])expect(row(name).disabled).toBe(true);
  });
  it("opens dedicated selection workflows from the inspector without replacing the canvas",async()=>{
    const canvas=container.querySelector('[aria-label="Paint and select image"]');await showDocument();await menu("Select");expect(row("Select and Mask…").disabled).toBe(true);await act(async()=>row("Focus Area…").click());expect(container.querySelector('[role="dialog"][aria-label="Focus Area"]')).toBeTruthy();await click("Cancel");await choose(["Select"],"Color Range…");expect(container.querySelector('[role="dialog"][aria-label="Color Range"]')).toBeTruthy();await click("Cancel");await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,hasSelection:true}})));await choose(["Select"],"Select and Mask…");expect(container.querySelector('[role="dialog"][aria-label="Select and Mask"]')).toBeTruthy();await click("Cancel");expect(container.querySelector('[aria-label="Paint and select image"]')).toBe(canvas);
  });
  it("selects a full-width row or full-height column where the pointer is released, with Feather but no Anti-alias",async()=>{
    expect(IMAGE_TOOL_GROUPS.find(entry=>entry.label==="Marquee tools")!.tools.map(tool=>[tool.label,tool.shortcut])).toEqual([["Rectangular Marquee Tool","M"],["Elliptical Marquee Tool","M"],["Single Row Marquee Tool",undefined],["Single Column Marquee Tool",undefined]]);
    await chooseTool("singleRowSelection");await inputNumber("Tool Feather (px)",1);
    expect(["Tool Anti-alias","Tool Style"].map(label=>container.querySelector(`[aria-label="${label}"]`))).toEqual([null,null]);
    const canvas=gestureCanvas(),ctx={clearRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),rect:vi.fn(),ellipse:vi.fn(),stroke:vi.fn()};vi.mocked(canvas.getContext).mockReturnValue(ctx as never);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:300,clientY:70})));
    expect(ctx.rect).toHaveBeenLastCalledWith(0,70,800,1);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:300,clientY:70})));
    expect(command).toHaveBeenLastCalledWith("select.rect",{x:0,y:70,width:800,height:1,ellipse:false,feather:1,antiAlias:false,mode:"replace"});
    await chooseTool("singleColumnSelection");
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:120,clientY:25,shiftKey:true})));
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:120,clientY:25,shiftKey:true})));
    expect(command).toHaveBeenLastCalledWith("select.rect",{x:120,y:0,width:1,height:600,ellipse:false,feather:0,antiAlias:false,mode:"add"});
  });
  it("corrects red eye at a click or inside a dragged box, with Pupil Size and Darken Amount",async()=>{
    expect(IMAGE_TOOL_GROUPS.find(entry=>entry.label==="Healing tools")!.tools.map(tool=>[tool.label,tool.shortcut])).toEqual([["Spot Healing Brush Tool","J"],["Healing Brush Tool","J"],["Patch Tool","J"],["Red Eye Tool","J"]]);
    await chooseTool("paint.redEye");
    expect(["Tool Pupil Size (%)","Tool Darken Amount (%)"].map(label=>container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value)).toEqual(["50","50"]);
    expect(container.querySelector('[aria-label="Tool Size"]')).toBeNull();
    await inputNumber("Tool Darken Amount (%)",80);
    const canvas=gestureCanvas(),ctx={clearRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),rect:vi.fn(),ellipse:vi.fn(),stroke:vi.fn()};vi.mocked(canvas.getContext).mockReturnValue(ctx as never);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:120,clientY:90})));
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:121,clientY:90})));
    expect(command).toHaveBeenLastCalledWith("paint.redEye",{x:120,y:90,pupilSize:50,darken:80});
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:300,clientY:200})));
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:200,clientY:150})));
    expect(ctx.rect).toHaveBeenLastCalledWith(300,200,-100,-50);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:200,clientY:150})));
    expect(command).toHaveBeenLastCalledWith("paint.redEye",{x:200,y:150,width:100,height:50,pupilSize:50,darken:80});
  });
  it("offers the Color Sampler Tool after the Eyedropper with Sample Size and Clear All, and shows its samplers over the image",async()=>{
    expect(IMAGE_TOOL_GROUPS.find(entry=>entry.label==="Eyedropper tools")!.tools.map(tool=>[tool.label,tool.shortcut])).toEqual([["Eyedropper Tool","I"],["Color Sampler Tool","I"],["Ruler Tool","I"],["Note Tool","I"],["Count Tool","I"]]);
    const id=usePhotoWorkspace.getState().documentId!;useColorSamplers.setState({documents:{}});
    await chooseTool("colorSampler");
    expect(container.querySelector('[aria-label="Sample size"]')).not.toBeNull();
    expect(button("Clear all color samplers").disabled).toBe(true);
    await act(async()=>{useColorSamplers.getState().add(id,{x:4,y:5});});
    expect(container.querySelector('[aria-label="Color sampler 1"]')).not.toBeNull();
    await click("Clear all color samplers");
    expect([useColorSamplers.getState().documents[id],container.querySelector('[aria-label="Color sampler 1"]')]).toEqual([[],null]);
  });
  it("previews and commits the same centered ellipse with edge options and no paint target",async()=>{
    await chooseTool("ellipseSelection");await inputNumber("Tool Feather (px)",2.5);await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Anti-alias"]')!.click());
    expect(container.querySelector('[aria-label="Tool Width (px)"]')).toBeNull();expect(container.querySelector('[aria-label="Tool Width"]')).toBeNull();
    const canvas=gestureCanvas(),ctx={clearRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),rect:vi.fn(),ellipse:vi.fn(),stroke:vi.fn()};vi.mocked(canvas.getContext).mockReturnValue(ctx as never);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:40,clientY:30,shiftKey:true,altKey:true})));
    expect(ctx.ellipse).toHaveBeenLastCalledWith(20,25,20,20,0,0,Math.PI*2);expect(ctx.moveTo).not.toHaveBeenCalled();
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:30,shiftKey:true,altKey:true})));
    expect(command).toHaveBeenLastCalledWith("select.rect",{x:0,y:5,width:40,height:40,ellipse:true,feather:2.5,antiAlias:false,mode:"replace"});expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it.each([[true,false,"add"],[false,true,"subtract"],[true,true,"intersect"]])("uses initial selection modifiers %s/%s for %s without setting a clone source",async(shiftKey,altKey,mode)=>{
    await chooseTool("select.rect");const canvas=gestureCanvas();
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25,shiftKey:shiftKey as boolean,altKey:altKey as boolean}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:35,shiftKey:shiftKey as boolean,altKey:altKey as boolean}));});
    expect(command).toHaveBeenLastCalledWith("select.rect",{x:20,y:25,width:20,height:10,ellipse:false,feather:0,antiAlias:true,mode});
    await chooseTool("paint.cloneStamp");command.mockClear();await drag(canvas);expect(command).not.toHaveBeenCalled();expect(container.textContent).toContain("choose a source point first");
  });
  it("places fixed-size selections on click, retains ratio controls and restores preferences on reopening",async()=>{
    await chooseTool("ellipseSelection");await pick("Tool Style","fixedRatio");await inputNumber("Tool Width",3);await inputNumber("Tool Height",2);await pick("Tool Style","fixedSize");await inputNumber("Tool Width (px)",24);await inputNumber("Tool Height (px)",16);await inputNumber("Tool Feather (px)",4);
    const canvas=gestureCanvas();await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:20,clientY:25}));});expect(command).toHaveBeenLastCalledWith("select.rect",{x:20,y:25,width:24,height:16,ellipse:true,feather:4,antiAlias:true,mode:"replace"});
    await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(<PhotoStudio/>));await chooseTool("ellipseSelection");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Width (px)"]')!.value).toBe("24");expect(container.querySelector('[aria-label="Tool Width"]')).toBeNull();await pick("Tool Style","fixedRatio");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Width"]')!.value).toBe("3");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Height"]')!.value).toBe("2");
  });
  it("exposes actual Quick Selection sampling/edge/brush settings without leaking paint settings",async()=>{
    await chooseTool("select.rect");await click("Intersect with selection");await chooseTool("select.quick");expect(button("New selection").getAttribute("aria-pressed")).toBe("true");expect([...container.querySelectorAll('[aria-label="Selection mode"] button')].map(element=>element.getAttribute("aria-label"))).toEqual(["New selection","Add to selection","Subtract from selection"]);
    await inputNumber("Tool Selection brush size (px)",18);await act(async()=>{container.querySelector<HTMLInputElement>('[aria-label="Tool Sample all layers"]')!.click();container.querySelector<HTMLInputElement>('[aria-label="Tool Enhance edge"]')!.click();});const canvas=gestureCanvas();await drag(canvas);
    expect(command).toHaveBeenLastCalledWith("select.quick",{points:[[20,25],[40,45]],size:18,mode:"replace",sampleAllLayers:true,enhanceEdge:true});expect(native.invoke).not.toHaveBeenCalled();expect(container.querySelector('[aria-label="Brush opacity"]')).toBeNull();
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25,altKey:true}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:20,clientY:25,altKey:true}));});expect(command).toHaveBeenLastCalledWith("select.quick",{points:[[20,25]],size:18,mode:"subtract",sampleAllLayers:true,enhanceEdge:true});
  });
  it("captures and restores named selection presets including host tool aliases and edge/geometry choices",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,presets:{gradient:{name:"Default",stops:[[0,"foreground"],[1,"background"]],transparency:[]},gradients:[],styles:[],tools:[{name:"Soft ellipse",tool:"ellipseSelection"}]}}})));
    await chooseTool("ellipseSelection");await click("Subtract from selection");await pick("Tool Style","fixedRatio");await inputNumber("Tool Width",3);await inputNumber("Tool Height",2);await inputNumber("Tool Feather (px)",2.5);await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Anti-alias"]')!.click());await click("Tool Presets");await click("Save tool preset");const captured=command.mock.lastCall![1]!.options as Record<string,unknown>;expect(command).toHaveBeenLastCalledWith("tool.presets.new",expect.objectContaining({tool:"ellipseSelection",options:expect.objectContaining({toolOptions:expect.objectContaining({selectionMode:"subtract",paintOptions:expect.objectContaining({style:"fixedRatio",ratioWidth:3,ratioHeight:2,feather:2.5,antiAlias:false})})})}));
    command.mockImplementationOnce(async()=>({tool:"ellipseSelection",options:captured}) as never);await click("Soft ellipseellipseSelection");await click("Properties");expect(button("Subtract from selection").getAttribute("aria-pressed")).toBe("true");const canvas=gestureCanvas();await drag(canvas);expect(command).toHaveBeenLastCalledWith("select.rect",{x:20,y:25,width:30,height:20,mode:"subtract",ellipse:true,feather:2.5,antiAlias:false});
  });
  it("sends Object Selection rectangles and freehand lasso edge options to their native commands",async()=>{
    await chooseTool("select.object");await pick("Tool Style","fixedRatio");await inputNumber("Tool Width",2);await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Sample all layers"]')!.click());const canvas=gestureCanvas();await drag(canvas);expect(command).toHaveBeenLastCalledWith("select.object",{rect:[20,25,40,20],mode:"replace",sampleAllLayers:true});
    await chooseTool("select.lasso");await inputNumber("Tool Feather (px)",3);await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:40,clientY:25}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:45}));});expect(command).toHaveBeenLastCalledWith("select.lasso",{points:[[20,25],[40,25],[40,45]],mode:"replace",feather:3,antiAlias:true});
  });
  it("uses explicit crop deletion choices and the crop ratio dropdown",async()=>{
    await click("Crop Tool");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Delete Cropped Pixels"]')!.checked).toBe(false);const canvas=gestureCanvas();await drag(canvas);expect(command).not.toHaveBeenCalled();await click("Apply crop");expect(command).toHaveBeenLastCalledWith("image.crop",{x:20,y:25,width:20,height:20,deleteCroppedPixels:false});await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Delete Cropped Pixels"]')!.click());await pick("Crop ratio","1 : 1 (Square)");await click("Apply crop");const squared=command.mock.calls.at(-1)![1] as {width:number;height:number;deleteCroppedPixels:boolean};expect(squared.width).toBe(squared.height);expect(squared.deleteCroppedPixels).toBe(true);
  });
  it("holds polygon drafts across clicks, removes vertices, finishes once and keeps layer delete separate",async()=>{
    await chooseTool("polygonLasso");await inputNumber("Tool Feather (px)",2);const canvas=gestureCanvas();const tap=async(x:number,y:number,shiftKey=false)=>act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:x,clientY:y,shiftKey}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:x,clientY:y,shiftKey}));});
    await tap(20,25);await tap(40,25);expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toContain("polygon selection");expect(command).not.toHaveBeenCalled();await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Enter"})));expect(container.textContent).toContain("at least three vertices");
    await tap(45,50);await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Backspace"})));expect(container.textContent).toContain("2 polygon vertices");await tap(40,45);await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Enter"})));expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("select.lasso",{points:[[20,25],[40,25],[40,45]],feather:2,antiAlias:true,mode:"replace"});expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it.each(["first vertex","double click","button"])("closes polygon on %s and preserves initial modifiers",async finish=>{
    await chooseTool("polygonLasso");const canvas=gestureCanvas();for(const [x,y] of [[20,25],[40,25],[40,45]])await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:x,clientY:y,altKey:true}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:x,clientY:y,altKey:true}));});
    if(finish==="first vertex")await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:21,clientY:25})));else if(finish==="button")await click("Finish polygon selection");else await act(async()=>canvas.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,clientX:40,clientY:45})));
    expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("select.lasso",{points:[[20,25],[40,25],[40,45]],feather:0,antiAlias:true,mode:"subtract"});expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it.each(["Escape","pointercancel","version","unmount","button"])("cancels polygon drafts on %s without editing or retaining busy",async cancel=>{
    await chooseTool("polygonLasso");const canvas=gestureCanvas();await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toContain("polygon selection");
    if(cancel==="Escape")await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape"})));else if(cancel==="pointercancel")await act(async()=>canvas.dispatchEvent(new MouseEvent("pointercancel",{bubbles:true})));else if(cancel==="version"){const id=usePhotoWorkspace.getState().documentId!;await act(async()=>useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[id]:{...s.photoDocuments[id]!,version:ulid()}}})));}else if(cancel==="button")await click("Cancel polygon selection");else{await act(async()=>root.unmount());root=createRoot(container);}
    expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
  });
  it("resizes Quick Selection with brackets without changing the paint brush or typing values",async()=>{
    await chooseTool("select.quick");const editor=container.querySelector('[aria-label="Image editor"]')!;await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"]"})));expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Selection brush size (px)"]')!.value).toBe("40");await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Selection brush size (px)"]')!.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"]"})));expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Selection brush size (px)"]')!.value).toBe("40");await chooseTool("paint.stroke");expect(brushSize()).toBe("24");expect(command).not.toHaveBeenCalled();
  });
  it("previews the same snapped polygon vertex sent to native selection",async()=>{
    await chooseTool("polygonLasso");const canvas=gestureCanvas(),ctx={clearRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn()};vi.mocked(canvas.getContext).mockReturnValue(ctx as never);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:40,clientY:29,shiftKey:true})));const snapped=20+Math.hypot(20,4);expect(ctx.lineTo).toHaveBeenLastCalledWith(snapped,25);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:40,clientY:45})));await click("Finish polygon selection");expect(command).toHaveBeenLastCalledWith("select.lasso",{points:[[20,25],[snapped,25],[40,45]],mode:"replace",feather:0,antiAlias:true});
  });
  it("shows native color swatches and shares exact RGBA with feedback, painting, gradients and presets",async()=>{
    const foreground:[number,number,number,number]=[.123456,1.2,-.1,.75],background:[number,number,number,number]=[.2,.3,.4,.5];native.enabled=true;await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,viewKey:"composite",tools:{foreground,background},presets:{gradient:{name:"Dynamic",stops:[[0,"foreground"],[1,"background"]],transparency:[]},gradients:[],styles:[],tools:[]}}})));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Paint color"]')!.value).toBe("#1fff00");expect(container.querySelector<HTMLInputElement>('[aria-label="Paint background color"]')!.value).toBe("#334d66");const canvas=gestureCanvas();native.invoke.mockResolvedValue([]);vi.useFakeTimers();
    try{await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));await act(async()=>vi.advanceTimersByTimeAsync(100));const preview=native.invoke.mock.calls.find(([name])=>name==="xdesign_photo_stroke_preview_pixels")![1];expect(preview.params.color).toEqual(foreground);await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:45})));expect(command).toHaveBeenLastCalledWith("paint.stroke",expect.objectContaining({color:foreground}));}finally{vi.useRealTimers();}
    await click("Tool Presets");await click("Save tool preset");expect(command).toHaveBeenLastCalledWith("tool.presets.new",expect.objectContaining({options:expect.objectContaining({foreground,background})}));await click("Properties");await chooseTool("paint.gradient");await pick("Gradient mode","classic");await drag(canvas);expect(command).toHaveBeenLastCalledWith("paint.gradient",expect.objectContaining({stops:[[0,foreground],[1,background]]}));
    await click("Gradients");await click("New gradient fill");expect(command).toHaveBeenLastCalledWith("gradient.presets.apply",expect.objectContaining({stops:[[0,foreground],[1,background]]}));
  });
  it("sends color picks to native state and exposes swap/default buttons and guarded shortcuts",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,tools:{foreground:[1,0,0,1],background:[0,1,1,1]}}})));
    await pickColor("Paint color","112233");expect(colors).toHaveBeenLastCalledWith({foreground:"#112233"});
    await pickColor("Paint background color","445566");expect(colors).toHaveBeenLastCalledWith({background:"#445566"});
    await click("Swap paint colors");expect(command).toHaveBeenLastCalledWith("tools.swapColors");await click("Default paint colors");expect(command).toHaveBeenLastCalledWith("tools.defaultColors");
    command.mockClear();const editor=container.querySelector('[aria-label="Image editor"]')!;await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"x",cancelable:true})));await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"d",cancelable:true})));expect(command.mock.calls.map(call=>call[0])).toEqual(["tools.swapColors","tools.defaultColors"]);
    const field=await framed();command.mockClear();await act(async()=>field.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"x"})));await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"x",metaKey:true})));await act(async()=>usePhotoWorkspace.setState({busy:true}));await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"d"})));expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("edit.cut",{});
  });
  it("keeps mask black/white shortcuts separate from image colors",async()=>{
    const foreground:[number,number,number,number]=[1,0,0,1],background:[number,number,number,number]=[0,1,1,1];await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,tools:{foreground,background},layers:s.state!.layers.map(layer=>({...layer,hasMask:true}))}})));await click("Edit mask of Portrait layer");expect(container.querySelector('[aria-label="Paint background color"]')).toBeNull();command.mockClear();const editor=container.querySelector('[aria-label="Image editor"]')!;
    await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"x"})));expect(container.querySelector<HTMLInputElement>('[aria-label="Paint color"]')!.value).toBe("#ffffff");await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"d"})));expect(container.querySelector<HTMLInputElement>('[aria-label="Paint color"]')!.value).toBe("#000000");expect(command).not.toHaveBeenCalled();expect(colors).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().state!.tools).toEqual({foreground,background});await click("Portrait layer");expect(container.querySelector<HTMLInputElement>('[aria-label="Paint color"]')!.value).toBe("#ff0000");
  });
  it("restores the native swatch and shows an error when a color change fails",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,tools:{foreground:[1,0,0,1],background:[0,1,1,1]}}})));colors.mockRejectedValueOnce(new Error("Palette write failed"));await pickColor("Paint color","112233");expect(container.querySelector<HTMLInputElement>('[aria-label="Paint color"]')!.value).toBe("#ff0000");expect(container.textContent).toContain("Palette write failed");
  });
  it("rebases brush options changed through other command routes while keeping color-only updates independent",async()=>{
    const initial={sampledTip:false,sampledTexture:false,presets:[],settings:{flow:.8,spacing:.15,mode:"Normal"}};await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,brush:initial}})));await inputNumber("Tool Flow (%)",35);await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,tools:{foreground:[0,1,0,1],background:[1,1,1,1]}}})));expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Flow (%)"]')!.value).toBe("35");await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,brush:{...initial,settings:{...initial.settings,flow:.7}}}})));expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Flow (%)"]')!.value).toBe("70");
  });
  it("retains restored tool options when a preset changes both native brush settings and its color pair",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,brush:{sampledTip:false,sampledTexture:false,presets:[],settings:{flow:.8,mode:"Normal"}},presets:{gradient:{name:"Default",stops:[[0,"foreground"],[1,"background"]],transparency:[]},gradients:[],styles:[],tools:[{name:"Color pencil",tool:"pencil"}]}}})));
    await chooseTool("paint.pencil");await inputNumber("Tool Flow (%)",35);await click("Tool Presets");const foreground:[number,number,number,number]=[.123456,.4,.6,.75],background:[number,number,number,number]=[.2,.3,.4,.5];command.mockImplementationOnce(async()=>{usePhotoWorkspace.setState(s=>({state:{...s.state!,tools:{foreground,background},brush:{...s.state!.brush!,settings:{flow:.2,mode:"Screen"}}}}));return {tool:"pencil",options:{foreground,background,toolOptions:{paintOptions:{flow:45,mode:"Multiply",autoErase:true}}}} as never;});await click("Color pencilpencil");await click("Properties");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Flow (%)"]')!.value).toBe("45");expect(container.querySelector<HTMLSelectElement>('[aria-label="Tool Blend"]')!.value).toBe("Multiply");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Auto erase"]')!.checked).toBe(true);expect(container.querySelector<HTMLInputElement>('[aria-label="Paint background color"]')!.value).toBe("#334d66");
  });
  it.each(["paint.stroke","paint.pencil","erase","paint.mixerBrush","paint.colorReplacement"])("passes edited %s flow/spacing/smoothing through feedback and the final gesture",async tool=>{
    native.enabled=true;await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,viewKey:"composite"}})));if(tool==="erase")await click("Eraser Tool");else await chooseTool(tool);
    await inputNumber("Tool Flow (%)",37.5);await inputNumber("Tool Spacing (%)",12.5);await inputNumber("Tool Smoothing (%)",20);
    if(tool==="paint.stroke"||tool==="paint.pencil")await pick("Tool Blend","Linear Dodge (Add)");if(tool==="paint.pencil")await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Auto erase"]')!.click());
    const canvas=gestureCanvas();native.invoke.mockResolvedValue([]);vi.useFakeTimers();
    try {
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));await act(async()=>vi.advanceTimersByTimeAsync(100));
      const preview=native.invoke.mock.calls.find(([name])=>name==="xdesign_photo_stroke_preview_pixels")![1];const expected={flow:tool==="paint.mixerBrush"?37.5:.375,spacing:.125,smoothing:.2,...(tool==="paint.stroke"||tool==="paint.pencil"?{mode:"Linear Dodge (Add)"}:{}),...(tool==="paint.pencil"?{autoErase:true}:{}),...(tool==="erase"?{erase:true}:{})};expect(preview.params).toMatchObject(expected);
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:45})));expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith(tool==="erase"?"paint.stroke":tool,expect.objectContaining({...expected,seed:preview.params.seed}));
    }finally{vi.useRealTimers();}
  });
  it.each(["paint.cloneStamp","paint.healingBrush"].flatMap(tool=>[true,false].map(transformSource=>({tool,transformSource}))))("forwards $tool source transforms opt-in=$transformSource identically to native feedback and commit",async ({tool,transformSource})=>{
    native.enabled=true;await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,viewKey:"composite"}})));await chooseTool(tool);
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Transform source"]')!.click());
    await inputNumber("Tool Source width (%)",80);await inputNumber("Tool Source height (%)",135);await inputNumber("Tool Source rotation (°)",-27.5);
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Flip source horizontally"]')!.click());
    if(!transformSource)await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Transform source"]')!.click());
    const canvas=gestureCanvas();await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,altKey:true,clientX:5,clientY:7})));
    native.invoke.mockResolvedValue([]);command.mockClear();vi.useFakeTimers();
    try{
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));await act(async()=>vi.advanceTimersByTimeAsync(100));
      const preview=native.invoke.mock.calls.find(([name])=>name==="xdesign_photo_stroke_preview_pixels")![1];const expected={...(transformSource?{scale:[80,135],rotation:-27.5,flipH:true,flipV:false}:{}),aligned:true};
      expect(preview.params).toMatchObject(expected);expect(preview.params).not.toHaveProperty("transformSource");expect(preview.params).not.toHaveProperty("sourceWidth");expect(preview.params).not.toHaveProperty("sourceHeight");
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:45})));
      expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith(tool,expect.objectContaining({...expected,seed:preview.params.seed}));
      if(!transformSource)for(const key of ["scale","rotation","flipH","flipV"]){expect(preview.params).not.toHaveProperty(key);expect(command.mock.calls[0]![1]).not.toHaveProperty(key);}
      expect(command.mock.calls[0]![1]).not.toHaveProperty("transformSource");expect(command.mock.calls[0]![1]).not.toHaveProperty("sourceWidth");expect(command.mock.calls[0]![1]).not.toHaveProperty("sourceHeight");
      for(const params of [preview.params,command.mock.calls[0]![1]])for(const key of ["source","offset","anchor"])expect(params).not.toHaveProperty(key);
    }finally{vi.useRealTimers();}
  });
  it("restores tool controls after closing Image and rebases them when a different native brush is selected",async()=>{
    await inputNumber("Tool Flow (%)",35);await pick("Tool Blend","Multiply");await chooseTool("paint.pencil");await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Auto erase"]')!.click());
    await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(<PhotoStudio/>));expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Flow (%)"]')!.value).toBe("35");expect(container.querySelector<HTMLSelectElement>('[aria-label="Tool Blend"]')!.value).toBe("Multiply");
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,brush:{sampledTip:false,sampledTexture:false,presets:[{name:"Airy",group:"Basic",builtin:true,size:48,hardness:.2}],settings:{size:48,opacity:1,hardness:.2,flow:.8,spacing:.15,smoothing:{amount:.1},mode:"Screen"}}}})));
    await click("Brushes");await click("Save preset");await click("Properties");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Flow (%)"]')!.value).toBe("35");await click("Brushes");await click("Use brush Airy");await click("Properties");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Flow (%)"]')!.value).toBe("80");expect(container.querySelector<HTMLSelectElement>('[aria-label="Tool Blend"]')!.value).toBe("Screen");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Spacing (%)"]')!.value).toBe("15");
    await chooseTool("paint.pencil");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Auto erase"]')!.checked).toBe(true);
  });
  it("uses the current native pattern for bucket fills and exposes layer sampling for Magic Wand",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,presets:{gradient:{name:"Default",stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[]},gradients:[],styles:[],pattern:"dots",patterns:[{name:"Basic",presets:[{id:"dots",name:"Dots",width:8,height:8},{id:"lines",name:"Lines",width:8,height:8}]}]}}})));
    await chooseTool("paint.bucket");expect(container.querySelector('[aria-label="Bucket pattern"]')).toBeNull();await pick("Tool Fill","pattern");await pick("Bucket pattern","lines");expect(command).toHaveBeenLastCalledWith("pattern.presets.select",{pattern:"lines"});await inputNumber("Tool Pattern scale (%)",150);await inputNumber("Tool Pattern angle",45);
    command.mockClear();const canvas=gestureCanvas();await drag(canvas);expect(command).toHaveBeenLastCalledWith("paint.bucket",expect.objectContaining({contents:"pattern",scale:150,angle:45}));expect(command.mock.lastCall![1]).not.toHaveProperty("pattern");
    await chooseTool("select.magicWand");await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Sample all layers"]')!.click());await drag(canvas);expect(command).toHaveBeenLastCalledWith("select.magicWand",expect.objectContaining({sampleAllLayers:true,mode:"replace"}));
  });
  it("offers the Pattern Stamp Tool beside Clone Stamp and paints the chosen pattern with its Mode, Flow and Aligned options",async()=>{
    expect(IMAGE_TOOL_GROUPS.find(entry=>entry.label==="Stamp tools")!.tools.map(tool=>[tool.label,tool.shortcut])).toEqual([["Clone Stamp Tool","S"],["Pattern Stamp Tool","S"]]);
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,presets:{gradient:{name:"Default",stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[]},gradients:[],styles:[],pattern:"dots",patterns:[{name:"Basic",presets:[{id:"dots",name:"Dots",width:8,height:8},{id:"lines",name:"Lines",width:8,height:8}]}]}}})));
    await chooseTool("paint.patternStamp");await pick("Tool Pattern","lines");expect(command).toHaveBeenLastCalledWith("pattern.presets.select",{pattern:"lines"});await pick("Tool Blend","Multiply");await inputNumber("Tool Flow (%)",40);await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Aligned"]')!.click());
    command.mockClear();await drag(gestureCanvas());expect(command).toHaveBeenLastCalledWith("paint.patternStamp",expect.objectContaining({mode:"Multiply",flow:40,aligned:false,points:expect.any(Array)}));expect(command.mock.lastCall![1]).not.toHaveProperty("pattern");
  });
  it("applies classic gradient blend/dither options without sending them to live layers",async()=>{
    await chooseTool("paint.gradient");expect(container.querySelector('[aria-label="Tool Blend"]')).toBeNull();await pick("Gradient mode","classic");await pick("Tool Blend","Multiply");await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Dither"]')!.click());const canvas=gestureCanvas();await drag(canvas);expect(command).toHaveBeenLastCalledWith("paint.gradient",expect.objectContaining({mode:"Multiply",dither:false}));
    await pick("Gradient mode","live");command.mockClear();await drag(canvas);expect(command.mock.lastCall![0]).toBe("gradient.fill.create");expect(command.mock.lastCall![1]).not.toHaveProperty("mode");expect(command.mock.lastCall![1]).toHaveProperty("dither");
  });
  it("uses saved native image undo and redo through toolbar and keyboard while leaving design history available",async()=>{
    expect(button("Undo").disabled).toBe(false);await click("Undo");expect(command).toHaveBeenLastCalledWith("edit.undo");
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,canUndo:false,canRedo:true}})));expect(button("Undo").disabled).toBe(true);expect(button("Redo").disabled).toBe(false);await click("Redo");expect(command).toHaveBeenLastCalledWith("edit.redo");
    command.mockClear();const editor=container.querySelector('[aria-label="Image editor"]')!;await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"z",metaKey:true,shiftKey:true,cancelable:true})));expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("edit.redo");
    command.mockClear();await act(async()=>usePhotoWorkspace.setState({busy:true}));await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"z",ctrlKey:true,shiftKey:true,cancelable:true})));expect(command).not.toHaveBeenCalled();
  });
  it("opens channel workflows from both inspectors while retaining the image canvas",async()=>{
    const canvas=container.querySelector('[aria-label="Paint and select image"]');
    await showDocument();await choose(["Image"],"Calculations…");expect(container.querySelector('[role="dialog"][aria-label="Calculations"]')).toBeTruthy();await click("OK");expect(command).toHaveBeenCalledWith("image.calculations",expect.objectContaining({result:"newChannel"}));
    expect(container.querySelector('[aria-label="Paint and select image"]')).toBe(canvas);
    await click("Channels");await choose(["Select"],"Load Selection…");expect(container.querySelector('[role="dialog"][aria-label="Load Selection"]')).toBeTruthy();await click("Cancel");
    await choose(["Image"],"Apply Image…");expect(container.querySelector('[role="dialog"][aria-label="Apply Image"]')).toBeTruthy();await click("Cancel");expect(container.querySelector('[aria-label="Paint and select image"]')).toBe(canvas);
  });
  it("enters on-canvas free transform with Cmd/Ctrl+T and preserves typing and busy guards",async()=>{
    const editor=container.querySelector('[aria-label="Image editor"]')!;
    await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"t",metaKey:true,cancelable:true})));
    expect(container.querySelector('[role="dialog"]')).toBeNull();expect(container.querySelector('[aria-label="Layer transform handles"]')).toBeTruthy();await inputNumber("Transform width (%)",150);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Transform height (%)"]')!.value).toBe("150");expect(command).not.toHaveBeenCalled();await click("Cancel transform");
    expect(container.querySelector('[aria-label="Commit transform"]')).toBeNull();expect(usePhotoWorkspace.getState().busy).toBe(false);
    const field=await framed();
    await act(async()=>field.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"t",ctrlKey:true,cancelable:true})));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async()=>usePhotoWorkspace.setState({busy:true}));
    await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"t",ctrlKey:true,cancelable:true})));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it("opens the imported Color Lookup editor without replacing its embedded table",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,kind:"Adjustment",adjustmentKind:"colorLookup",adjustmentParams:{interpolation:"tetrahedral",dither:true},adjustment:{ColorLookup:{name:"Film LUT"}}}))}})));
    await click("Adjustments");await act(async()=>container.querySelector(".xd-photo-layer-thumb-button")!.dispatchEvent(new MouseEvent("dblclick",{bubbles:true})));expect(button("Properties").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Current embedded look · Film LUT");expect(button("Edit adjustment")).toBeUndefined();expect(container.querySelector('[aria-label="Transform width (%)"]')).toBeNull();
    await act(async()=>container.querySelector<HTMLInputElement>('input[aria-label="Adjustment Dither"]')!.click());await act(async()=>new Promise(resolve=>setTimeout(resolve,300)));
    expect(command).toHaveBeenCalledWith("layer.setAdjustment",{layer:1,interpolation:"tetrahedral",dither:false});
  });
  it("restores retouch controls from a named tool preset and saves the same controls for reopening",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,presets:{gradient:{name:"Default",stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[]},gradients:[],styles:[],tools:[{name:"Gentle shadow lift",tool:"dodge"}]}}})));
    await chooseTool("paint.dodge");await click("Tool Presets");
    command.mockResolvedValueOnce({tool:"dodge",options:{toolOptions:{paintOptions:{range:"shadows",exposure:25,protectTones:false}}}} as never);
    await click("Gentle shadow liftdodge");await click("Properties");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Tool Range"]')!.value).toBe("shadows");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Exposure (%)"]')!.value).toBe("25");expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Protect tones"]')!.checked).toBe(false);
    await click("Tool Presets");await click("Save tool preset");expect(command).toHaveBeenLastCalledWith("tool.presets.new",expect.objectContaining({tool:"dodge",options:expect.objectContaining({toolOptions:expect.objectContaining({paintOptions:{range:"shadows",exposure:25,protectTones:false,flow:100,spacing:25}})})}));
  });
  it("shares retouch settings, percent units and the gesture seed between native feedback and one final edit",async()=>{
    native.enabled=true;await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,viewKey:"composite"}})));await click("100%");await chooseTool("paint.dodge");
    await pick("Tool Range","highlights");
    const exposure=container.querySelector<HTMLInputElement>('[aria-label="Tool Exposure (%)"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(exposure,"75");exposure.dispatchEvent(new Event("input",{bubbles:true}));});
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!,stage=container.querySelector<HTMLDivElement>(".xd-photo-stage")!,image=container.querySelector<HTMLDivElement>(".xd-photo-image")!;
    const bounds={left:0,top:0,width:800,height:600} as DOMRect;vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;vi.spyOn(stage,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(image,"getBoundingClientRect").mockReturnValue(bounds);Object.defineProperties(stage,{clientWidth:{value:800},clientHeight:{value:600}});
    native.invoke.mockResolvedValue([]);vi.useFakeTimers();
    try {
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:30,clientY:40})));await act(async()=>vi.advanceTimersByTimeAsync(100));
      const request=native.invoke.mock.calls.find(([name])=>name==="xdesign_photo_stroke_preview_pixels")![1];expect(request).toMatchObject({command:"paint.dodge",params:{opacity:100,hardness:80,range:"highlights",exposure:75,protectTones:true}});
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:60,clientY:70})));expect(command).toHaveBeenCalledWith("paint.dodge",expect.objectContaining({seed:request.params.seed,range:"highlights",exposure:75,opacity:100,hardness:80}));
    }finally{vi.useRealTimers();}
  });
  it.each(["paint.cloneStamp","paint.healingBrush","paint.spotHealing","paint.dodge","paint.burn","paint.sponge","paint.blur","paint.sharpen","paint.mixerBrush","paint.colorReplacement","paint.smudge","paint.historyBrush"])("streams %s feedback while committing the complete gesture once",async(tool)=>{
    native.enabled=true;await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,viewKey:"composite"}})));await click("100%");await chooseTool(tool);
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!,stage=container.querySelector<HTMLDivElement>(".xd-photo-stage")!,image=container.querySelector<HTMLDivElement>(".xd-photo-image")!;
    const bounds={left:0,top:0,width:800,height:600} as DOMRect;vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;vi.spyOn(stage,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(image,"getBoundingClientRect").mockReturnValue(bounds);Object.defineProperties(stage,{clientWidth:{value:800},clientHeight:{value:600}});
    native.invoke.mockResolvedValue([]);if(["paint.cloneStamp","paint.healingBrush"].includes(tool))await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:10,clientY:10,altKey:true})));command.mockClear();vi.useFakeTimers();
    try {
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));await act(async()=>vi.advanceTimersByTimeAsync(100));
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,buttons:1,clientX:30,clientY:35})));await act(async()=>vi.advanceTimersByTimeAsync(100));
      const previews=native.invoke.mock.calls.filter(([name])=>name==="xdesign_photo_stroke_preview_pixels").map(([,request])=>request);expect(previews).toHaveLength(2);expect(previews.map(request=>request.params._orionOffset)).toEqual([0,1]);expect(previews[1].params.points).toHaveLength(1);if(tool==="paint.historyBrush")for(const preview of previews)expect(preview.params).toMatchObject({historySource:usePhotoWorkspace.getState().state!.historySources![0]!.id,mode:"Normal",flow:100,opacity:100,hardness:80});
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:45})));expect(command).toHaveBeenCalledOnce();expect(command.mock.lastCall?.[0]).toBe(tool);expect(command.mock.lastCall?.[1]).toMatchObject({seed:previews[0].params.seed});expect(command.mock.lastCall?.[1]?.points).toHaveLength(3);expect(command.mock.lastCall?.[1]).not.toHaveProperty("_orionOffset");if(tool==="paint.historyBrush")expect(command.mock.lastCall?.[1]).toMatchObject({historySource:previews[0].params.historySource,mode:"Normal",flow:100,opacity:100,hardness:80});
    }finally{vi.useRealTimers();}
  });
  it("pins History Brush source identity, refuses eviction and excludes it from presets",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,presets:{gradient:{name:"Default",stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[]},gradients:[],styles:[],tools:[]}}})));
    await chooseTool("paint.historyBrush");expect(container.querySelector('select[aria-label="History Brush source"]')).toBeNull();const sources=usePhotoWorkspace.getState().state!.historySources!;
    const source=async(index:number)=>{if(button("History").getAttribute("aria-pressed")!=="true")await click("History");await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('[aria-label="Sets the source for the history brush"]')].at(index)!.click());};
    await source(-1);await pick("Tool Blend","Multiply");
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800,height:600} as DOMRect);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;
    const drag=async()=>{await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:25})));await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:30,clientY:35})));};
    await drag();expect(command).toHaveBeenLastCalledWith("paint.historyBrush",expect.objectContaining({historySource:sources[1]!.id,mode:"Multiply",flow:100,opacity:100,hardness:80}));await click("Tool Presets");await click("Save tool preset");const saved=command.mock.lastCall![1] as {options:{toolOptions:{paintOptions:Record<string,unknown>}}};expect(saved.options.toolOptions.paintOptions).toEqual({mode:"Multiply",flow:100,spacing:25});await click("Properties");
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,historySources:[{...sources[1]!,index:0,current:false}]}})));command.mockClear();await drag();expect(command).toHaveBeenCalledOnce();expect(command.mock.lastCall![1]).toMatchObject({historySource:sources[1]!.id});
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,historySources:[sources[0]!]}})));command.mockClear();await drag();expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(container.textContent).toContain("no longer retained");await source(0);await drag();expect(command).toHaveBeenCalledOnce();expect(command.mock.lastCall![1]).toMatchObject({historySource:sources[0]!.id});
  });
  it("sets the active native source with Alt-click and leaves aligned pairing to the native slot",async()=>{
    await chooseTool("paint.cloneStamp");
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800,height:600} as DOMRect);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;
    const alt=(x:number,y:number)=>act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:x,clientY:y,altKey:true})));
    const drag=(x:number,y:number)=>act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:x,clientY:y}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:x+10,clientY:y+10}));});
    await alt(10,20);expect(command).toHaveBeenLastCalledWith("cloneSource.set",{source:[10,20]});await drag(30,40);expect(command).toHaveBeenLastCalledWith("paint.cloneStamp",expect.objectContaining({aligned:true,sampleLayer:"current"}));
    await drag(50,60);for(const params of command.mock.calls.filter(([id])=>id==="paint.cloneStamp").map(([,params])=>params))for(const key of ["source","offset","anchor"])expect(params).not.toHaveProperty(key);
    await alt(100,110);expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:0,source:[expect.closeTo(100,12),expect.closeTo(110,12)]});await drag(120,130);expect(command.mock.lastCall![1]).not.toHaveProperty("source");expect(command.mock.lastCall![1]).not.toHaveProperty("offset");expect(container.textContent).toContain("Source: 100, 110");
  });
  it.each(["paint.cloneStamp","paint.healingBrush"])("uses configured native slots for %s without redundant Alt-click or local offset overrides",async(tool)=>{
    const slots=emptyCloneSources();slots.active=2;slots.sources[2]!.source=[10,20];slots.sources[2]!.anchor=[30,40];slots.sources[2]!.offset=[-20,-20];slots.sources[2]!.layer=734;slots.sources[3]!.source=[100,110];
    await act(async()=>installCloneSources(slots));await chooseTool(tool);const canvas=gestureCanvas();await drag(canvas);await drag(canvas);expect(command.mock.calls.filter(([id])=>id===tool)).toHaveLength(2);expect(container.textContent).toContain("Source: 10, 20");
    await pick("Clone source slot","3");expect(command).toHaveBeenLastCalledWith("cloneSource.select",{index:3});await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Aligned"]')!.click());await drag(canvas);expect(command.mock.lastCall![1]).toMatchObject({aligned:false});expect(container.textContent).toContain("Source: 100, 110");
    for(const params of command.mock.calls.filter(([id])=>id===tool).map(([,params])=>params))for(const key of ["source","offset","anchor","layer","document"])expect(params).not.toHaveProperty(key);
    await pick("Clone source slot","4");command.mockClear();await drag(canvas);expect(command).not.toHaveBeenCalled();expect(container.textContent).toContain("choose a source point first");expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it("uses the activated image's native source state and refuses a source switch during a gesture",async()=>{
    const slots=emptyCloneSources();slots.sources[0]!.source=[10,20];await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");let canvas=gestureCanvas();
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:30,clientY:40})));const changed=structuredClone(slots);changed.sources[0]!.source=[50,60];await act(async()=>installCloneSources(changed));command.mockClear();await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:50})));expect(command).not.toHaveBeenCalled();expect(container.textContent).toContain("Clone Source changed");
    const previous=useXDesign.getState().photoDocuments[usePhotoWorkspace.getState().documentId!]!,next={...previous,id:ulid(),version:ulid(),name:"Second image"};
    await act(async()=>{const placement=useXDesign.getState().applyPhotoDocument(next);usePhotoWorkspace.setState(current=>({shapeId:placement,documentId:next.id,stateVersion:next.version,state:{...current.state!,name:next.name,activeLayer:91,layers:[{...current.state!.layers[0]!,id:91}],presets:{...current.state!.presets!,cloneSource:emptyCloneSources()}}}));});canvas=gestureCanvas();command.mockClear();await drag(canvas);expect(command).not.toHaveBeenCalled();
    const activated=emptyCloneSources();activated.active=1;activated.sources[1]!.source=[70,80];activated.sources[1]!.anchor=[90,100];activated.sources[1]!.layer=91;await act(async()=>installCloneSources(activated));await drag(canvas);expect(command).toHaveBeenLastCalledWith("paint.cloneStamp",expect.objectContaining({aligned:true}));for(const key of ["source","offset","anchor","layer","document"])expect(command.mock.lastCall![1]).not.toHaveProperty(key);expect(container.textContent).toContain("Source: 70, 80");
  });
  it("keeps saved-slot offset drafts editable and commits fractional paired coordinates once",async()=>{
    const slots=emptyCloneSources();slots.active=2;slots.sources[2]!.source=[10,20];slots.sources[1]!.source=[70,80];await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");const before=structuredClone(usePhotoWorkspace.getState().state!);
    const untouched=container.querySelector<HTMLInputElement>('[aria-label="Clone source offset X"]')!;expect(untouched.value).toBe("0");await act(async()=>{untouched.focus();untouched.blur();});expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().state!.presets!.cloneSource!.sources[2]!.anchor).toBeNull();
    let input=await offsetDraft("X","");expect(input.value).toBe("");input=await offsetDraft("X","1");expect(input.value).toBe("1");input=await offsetDraft("X","12.5");expect(input.value).toBe("12.5");expect(command).not.toHaveBeenCalled();
    await act(async()=>input.blur());expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:2,offset:[12.5,0]});let updated=usePhotoWorkspace.getState().state!.presets!.cloneSource!;expect(updated.sources[2]).toMatchObject({source:[22.5,20],anchor:[10,20],offset:[12.5,0]});expect(updated.sources[1]).toEqual(slots.sources[1]);
    command.mockClear();input=await offsetDraft("Y","-3.25");const enter=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});await act(async()=>input.dispatchEvent(enter));expect(enter.defaultPrevented).toBe(true);expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:2,offset:[12.5,-3.25]});updated=usePhotoWorkspace.getState().state!.presets!.cloneSource!;expect(updated.sources[2]).toMatchObject({source:[22.5,16.75],anchor:[10,20],offset:[12.5,-3.25]});
    const after=usePhotoWorkspace.getState().state!;expect({...after,presets:before.presets}).toEqual(before);command.mockClear();input=await offsetDraft("X","");await act(async()=>input.blur());expect(input.value).toBe("12.5");input=await offsetDraft("Y","Infinity");await act(async()=>input.blur());expect(input.value).toBe("-3.25");expect(command).not.toHaveBeenCalled();
  });
  it.each(["slot","source","document","view","busy"])("discards a saved-slot offset draft after a %s change",async(change)=>{
    const slots=emptyCloneSources();slots.sources[0]!.source=[10,20];slots.sources[1]!.source=[70,80];await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");const input=await offsetDraft("X","-8.5");
    await act(async()=>{if(change==="busy")usePhotoWorkspace.setState({busy:true});else if(change==="view")usePhotoWorkspace.setState(current=>({state:{...current.state!,viewKey:"composite"}}));else if(change==="document"){const previous=useXDesign.getState().photoDocuments[usePhotoWorkspace.getState().documentId!]!,next={...previous,id:ulid(),version:ulid()};const placement=useXDesign.getState().applyPhotoDocument(next);usePhotoWorkspace.setState({shapeId:placement,documentId:next.id,stateVersion:next.version});}else{const next=structuredClone(slots);if(change==="slot")next.active=1;else next.sources[0]!.source=[30,40];installCloneSources(next);}});
    const before=JSON.stringify(usePhotoWorkspace.getState().state);await act(async()=>input.blur());expect(command).not.toHaveBeenCalled();expect(JSON.stringify(usePhotoWorkspace.getState().state)).toBe(before);expect(container.querySelector<HTMLInputElement>('[aria-label="Clone source offset X"]')!.value).toBe("0");if(change==="busy")expect(input.disabled).toBe(true);
  });
  it("edits native saved-slot transform drafts within signed scale and rotation ranges once",async()=>{
    const slots=emptyCloneSources();Object.assign(slots.sources[0]!,{source:[22.5,16.75],anchor:[10,20],offset:[12.5,-3.25],layer:91});slots.sources[1]!.source=[70,80];await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");const before=structuredClone(usePhotoWorkspace.getState().state!);
    let input=await sourceDraft("width (%)","");expect(input.value).toBe("");input=await sourceDraft("width (%)","2");expect(input.value).toBe("2");input=await sourceDraft("width (%)","250.5");expect(command).not.toHaveBeenCalled();await act(async()=>input.blur());expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:0,width:250.5});
    command.mockClear();input=await sourceDraft("height (%)","-50.25");const enter=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});await act(async()=>input.dispatchEvent(enter));expect(enter.defaultPrevented).toBe(true);expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:0,height:-50.25});
    input=await sourceDraft("rotation (°)","180");await act(async()=>input.blur());expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:0,rotation:180});expect(input.value).toBe("-180");await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Saved source flip H"]')!.click());await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Saved source flip V"]')!.click());
    const expected=structuredClone(slots);Object.assign(expected.sources[0]!,{width:250.5,height:-50.25,rotation:-180,flipH:true,flipV:true});expect(usePhotoWorkspace.getState().state!.presets!.cloneSource).toEqual(expected);expect({...usePhotoWorkspace.getState().state!,presets:before.presets}).toEqual(before);
    command.mockClear();for(const [label,value,restored]of [["width (%)","0","250.5"],["height (%)","1001","-50.25"],["rotation (°)","181","-180"],["width (%)","Infinity","250.5"],["height (%)","","-50.25"]]){input=await sourceDraft(label!,value!);await act(async()=>input.blur());expect(input.value).toBe(restored);}expect(command).not.toHaveBeenCalled();
  });
  it("combines a focused saved-source draft and one flip click into one native update",async()=>{
    const slots=emptyCloneSources();Object.assign(slots.sources[0]!,{source:[22.5,16.75],anchor:[10,20],offset:[12.5,-3.25]});await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");
    const width=await sourceDraft("width (%)","175.5"),horizontal=container.querySelector<HTMLInputElement>('[aria-label="Saved source flip H"]')!,down=new MouseEvent("mousedown",{bubbles:true,cancelable:true});await act(async()=>horizontal.parentElement!.dispatchEvent(down));expect(down.defaultPrevented).toBe(true);expect(document.activeElement).toBe(width);await act(async()=>horizontal.click());expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:0,width:175.5,flipH:true});await act(async()=>width.blur());expect(command).toHaveBeenCalledOnce();
    command.mockClear();const offset=await offsetDraft("X","-12.5"),vertical=container.querySelector<HTMLInputElement>('[aria-label="Saved source flip V"]')!;await act(async()=>{vertical.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));vertical.click();});expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:0,offset:[-12.5,-3.25],flipV:true});await act(async()=>offset.blur());expect(command).toHaveBeenCalledOnce();expect(usePhotoWorkspace.getState().state!.presets!.cloneSource!.sources[0]).toMatchObject({source:[-2.5,16.75],anchor:[10,20],offset:[-12.5,-3.25],width:175.5,flipH:true,flipV:true});
  });
  it.each(["source","document","busy"])("discards native saved-slot transform drafts after a %s change",async(change)=>{
    const slots=emptyCloneSources();slots.sources[0]!.source=[10,20];await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");const input=await sourceDraft("rotation (°)","75.5");await act(async()=>{if(change==="busy")usePhotoWorkspace.setState({busy:true});else if(change==="document"){const previous=useXDesign.getState().photoDocuments[usePhotoWorkspace.getState().documentId!]!,next={...previous,id:ulid(),version:ulid()};const placement=useXDesign.getState().applyPhotoDocument(next);usePhotoWorkspace.setState({shapeId:placement,documentId:next.id,stateVersion:next.version});}else{const next=structuredClone(slots);next.sources[0]!.source=[30,40];installCloneSources(next);}});const before=JSON.stringify(usePhotoWorkspace.getState().state);await act(async()=>input.blur());expect(input.value).toBe("0");expect(command).not.toHaveBeenCalled();expect(JSON.stringify(usePhotoWorkspace.getState().state)).toBe(before);if(change==="busy"){expect(input.disabled).toBe(true);expect(container.querySelector<HTMLInputElement>('[aria-label="Saved source flip H"]')!.disabled).toBe(true);}
  });
  it("resets only the native saved-slot transform while retaining offsets and per-stroke overrides",async()=>{
    const slots=emptyCloneSources();Object.assign(slots.sources[0]!,{source:[22.5,16.75],anchor:[10,20],offset:[12.5,-3.25],layer:91});slots.sources[1]!.source=[70,80];await act(async()=>installCloneSources(slots));await chooseTool("paint.healingBrush");
    for(const [label,value]of [["width (%)","200"],["height (%)","50"],["rotation (°)","90"]]){const input=await sourceDraft(label!,value!);await act(async()=>input.blur());}await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Saved source flip H"]')!.click());await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Saved source flip V"]')!.click());expect(command).toHaveBeenCalledTimes(5);expect(usePhotoWorkspace.getState().state!.presets!.cloneSource!.sources[0]).toMatchObject({width:200,height:50,rotation:90,flipH:true,flipV:true});command.mockClear();
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Transform source"]')!.click());await inputNumber("Tool Source width (%)",125);await inputNumber("Tool Source height (%)",75);await inputNumber("Tool Source rotation (°)",30);await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Flip source vertically"]')!.click());const before=structuredClone(usePhotoWorkspace.getState().state!);
    await click("Reset saved-slot transform");expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenLastCalledWith("cloneSource.resetTransform",{index:0});const expected=structuredClone(slots);Object.assign(expected.sources[0]!,{width:100,height:100,rotation:0,flipH:false,flipV:false});expect(usePhotoWorkspace.getState().state!.presets!.cloneSource).toEqual(expected);expect({...usePhotoWorkspace.getState().state!,presets:before.presets}).toEqual(before);
    command.mockClear();await drag(gestureCanvas());expect(command).toHaveBeenLastCalledWith("paint.healingBrush",expect.objectContaining({scale:[125,75],rotation:30,flipH:false,flipV:true}));for(const key of ["source","offset","anchor"])expect(command.mock.lastCall![1]).not.toHaveProperty(key);
  });
  it("disables empty saved-slot offset/reset controls and preserves source state on native refusal",async()=>{
    await act(async()=>installCloneSources(emptyCloneSources()));await chooseTool("paint.cloneStamp");expect(container.querySelector<HTMLInputElement>('[aria-label="Clone source offset X"]')!.disabled).toBe(true);expect(button("Reset saved-slot transform").disabled).toBe(true);await click("Reset saved-slot transform");expect(command).not.toHaveBeenCalled();
    const slots=emptyCloneSources();slots.sources[0]!.source=[10,20];await act(async()=>installCloneSources(slots));const before=JSON.stringify(usePhotoWorkspace.getState().state);command.mockRejectedValueOnce(new Error("source changed"));const input=await offsetDraft("Y","-4.5");await act(async()=>input.blur());expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:0,offset:[0,-4.5]});expect(JSON.stringify(usePhotoWorkspace.getState().state)).toBe(before);expect(usePhotoWorkspace.getState().busy).toBe(false);
    command.mockRejectedValueOnce(new Error("native transform refused"));const width=await sourceDraft("width (%)","200");await act(async()=>width.blur());expect(command).toHaveBeenLastCalledWith("cloneSource.set",{index:0,width:200});expect(JSON.stringify(usePhotoWorkspace.getState().state)).toBe(before);expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it.each([1,.8])("draws the native transformed source crosshair at zoom %s without editing the source",async(zoom)=>{
    const slots=emptyCloneSources();Object.assign(slots.sources[0]!,{source:[10,20],anchor:[40,30],width:200,height:50,rotation:90,flipH:true});await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");await click("100%");if(zoom===.8)await act(async()=>container.querySelector<HTMLButtonElement>('[title="Zoom out"]')!.click());const canvas=gestureCanvas();vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800*zoom,height:600*zoom} as DOMRect);const before=JSON.stringify(usePhotoWorkspace.getState().state);
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:44*zoom,clientY:36*zoom})));const marker=container.querySelector<SVGSVGElement>('[aria-label="Clone source marker"]')!;expect(marker.style.display).toBe("");expect(Number(marker.dataset.sourceX)).toBeCloseTo(13,12);expect(Number(marker.dataset.sourceY)).toBeCloseTo(28,12);expect(marker.style.pointerEvents).toBe("none");expect(marker.getAttribute("viewBox")).toBe("0 0 800 600");
    const paths=marker.querySelectorAll("path");expect(paths).toHaveLength(2);const coordinates=paths[0]!.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);expect(coordinates[0]!*zoom).toBeCloseTo(13*zoom-7,12);expect(coordinates[2]!*zoom).toBeCloseTo(13*zoom+7,12);expect(paths[0]!.getAttribute("stroke-width")).toBe("3");expect(paths[1]!.getAttribute("stroke-width")).toBe("1");for(const path of paths)expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");expect(command).not.toHaveBeenCalled();expect(JSON.stringify(usePhotoWorkspace.getState().state)).toBe(before);
  });
  it("maps first and subsequent Clone/Healing strokes with aligned anchors and actual opt-in tool transforms",async()=>{
    const slots=emptyCloneSources();Object.assign(slots.sources[0]!,{source:[10,20],anchor:null,width:200,height:50,rotation:90,flipH:true});await act(async()=>installCloneSources(slots));await chooseTool("paint.healingBrush");await click("100%");const canvas=gestureCanvas(),marker=container.querySelector<SVGSVGElement>('[aria-label="Clone source marker"]')!;
    const pointer=(type:string,x:number,y:number)=>act(async()=>{canvas.dispatchEvent(new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y}));}),at=(x:number,y:number)=>{expect(marker.style.display).toBe("");expect(Number(marker.dataset.sourceX)).toBeCloseTo(x,12);expect(Number(marker.dataset.sourceY)).toBeCloseTo(y,12);};
    await pointer("pointermove",44,36);at(10,20);await pointer("pointerdown",40,30);await pointer("pointermove",44,36);at(13,28);await pointer("pointercancel",44,36);expect(marker.style.display).toBe("none");expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().busy).toBe(false);
    const retained=structuredClone(slots);Object.assign(retained.sources[0]!,{anchor:[30,25],width:100,height:100,rotation:0,flipH:false});await act(async()=>installCloneSources(retained));await pointer("pointermove",50,40);at(30,35);await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Aligned"]')!.click());await pointer("pointermove",50,40);at(10,20);await pointer("pointerdown",40,30);await pointer("pointermove",50,40);at(20,30);await pointer("pointercancel",50,40);
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Transform source"]')!.click());await inputNumber("Tool Source width (%)",100);await inputNumber("Tool Source height (%)",200);await inputNumber("Tool Source rotation (°)",0);await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Flip source vertically"]')!.click());await pointer("pointerdown",40,30);await pointer("pointermove",44,36);at(14,17);await pointer("pointerup",44,36);expect(command).toHaveBeenLastCalledWith("paint.healingBrush",expect.objectContaining({aligned:false,scale:[100,200],rotation:0,flipH:false,flipV:true}));expect(command.mock.lastCall![1]).not.toHaveProperty("source");expect(command.mock.lastCall![1]).not.toHaveProperty("anchor");expect(marker.style.display).toBe("none");expect(usePhotoWorkspace.getState().state!.presets!.cloneSource).toEqual(retained);
  });
  it("hides source crosshairs when the Develop dialog opens and refuses late canvas hover",async()=>{
    const slots=emptyCloneSources();slots.sources[0]!.source=[10,20];await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");await click("100%");const canvas=gestureCanvas(),marker=container.querySelector<SVGSVGElement>('[aria-label="Clone source marker"]')!,before=JSON.stringify(usePhotoWorkspace.getState().state),hover=()=>act(async()=>{canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:44,clientY:36}));});
    await hover();expect(marker.style.display).toBe("");
    await menu("Filter","Camera Raw Filter…");expect(container.querySelector('[role="dialog"][aria-label="Develop image"]')).not.toBeNull();
    expect(marker.style.display).toBe("none");await hover();expect(marker.style.display).toBe("none");expect(command).not.toHaveBeenCalled();expect(JSON.stringify(usePhotoWorkspace.getState().state)).toBe(before);expect(usePhotoWorkspace.getState().busy).toBe(false);
    await click("Cancel");await hover();expect(marker.style.display).toBe("");
  });
  it("hides an existing source crosshair when keyboard activation opens a Smart Filter-owned Develop modal",async()=>{
    const slots=emptyCloneSources();slots.sources[0]!.source=[10,20];await act(async()=>{installCloneSources(slots);usePhotoWorkspace.setState(current=>({state:{...current.state!,layers:current.state!.layers.map(layer=>({...layer,kind:"Smart",smartObject:{source:"embedded" as const,name:"image.psd",hasFilterMask:false},smartFilters:[{command:"filter.cameraRaw",params:{exposure:.5},visible:true,opacity:1,blend:"Normal"}]}))}}));});await chooseTool("paint.cloneStamp");await click("100%");const canvas=gestureCanvas(),marker=container.querySelector<SVGSVGElement>('[aria-label="Clone source marker"]')!,edit=container.querySelector<HTMLButtonElement>('[aria-label="Edit Camera Raw filter 1"]')!;edit.closest("details")!.open=true;
    await act(async()=>edit.focus());const hover=()=>act(async()=>{canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:44,clientY:36}));});await hover();expect(marker.style.display).toBe("");const before=JSON.stringify(usePhotoWorkspace.getState().state);await act(async()=>edit.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:0})));expect(container.querySelector('[role="dialog"][aria-label="Edit Camera Raw Filter"]')).not.toBeNull();expect(container.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);expect(marker.style.display).toBe("none");await hover();expect(marker.style.display).toBe("none");expect(command).not.toHaveBeenCalled();expect(JSON.stringify(usePhotoWorkspace.getState().state)).toBe(before);await click("Cancel");await hover();expect(marker.style.display).toBe("");
  });
  it("sets the Clone Source overlay options and lays the source over the brush like Photoshop's overlay",async()=>{
    const slots=emptyCloneSources();Object.assign(slots.sources[0]!,{source:[10,20],anchor:[40,30]});await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");await click("100%");const canvas=gestureCanvas();vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800,height:600} as DOMRect);
    const overlay=container.querySelector<SVGSVGElement>('[aria-label="Clone source overlay"]')!,marker=container.querySelector<SVGSVGElement>('[aria-label="Clone source marker"]')!,pointer=(type:string,x:number,y:number)=>act(async()=>{canvas.dispatchEvent(new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y}));});
    expect(overlay.style.display).toBe("none");await pointer("pointermove",44,36);expect(overlay.style.display).toBe("");expect(overlay.style.pointerEvents).toBe("none");expect(overlay.getAttribute("viewBox")).toBe("0 0 800 600");
    expect(overlay.querySelector("image")!.getAttribute("transform")).toBe("matrix(1 0 0 1 30 10)");const circle=overlay.querySelector("circle")!;expect([circle.getAttribute("cx"),circle.getAttribute("cy")]).toEqual(["44","36"]);expect(overlay.querySelector("g")!.getAttribute("clip-path")).toMatch(/^url\(#/);
    const check=(label:string)=>act(async()=>container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.click());
    await check("Show Overlay");expect(command).toHaveBeenLastCalledWith("cloneSource.overlay",{show:false});
    await check("Auto Hide");expect(command).toHaveBeenLastCalledWith("cloneSource.overlay",{autoHide:false});
    await check("Clipped");expect(command).toHaveBeenLastCalledWith("cloneSource.overlay",{clipped:false});
    await check("Invert overlay");expect(command).toHaveBeenLastCalledWith("cloneSource.overlay",{invert:true});
    await act(async()=>{const select=container.querySelector<HTMLSelectElement>('[aria-label="Overlay blend mode"]')!;select.value="difference";select.dispatchEvent(new Event("change",{bubbles:true}));});expect(command).toHaveBeenLastCalledWith("cloneSource.overlay",{blend:"difference"});
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Overlay opacity"]')!.focus());await inputNumber("Overlay opacity",50);await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Overlay opacity"]')!.blur());expect(command).toHaveBeenLastCalledWith("cloneSource.overlay",{opacity:50});
    const shown={...slots,overlay:{...slots.overlay,opacity:40,clipped:false,invert:true,blend:"difference"}};await act(async()=>installCloneSources(shown));await pointer("pointermove",44,36);
    expect(overlay.style.opacity).toBe("0.4");expect(overlay.style.mixBlendMode).toBe("difference");expect(overlay.querySelector("image")!.style.filter).toBe("invert(1)");expect(overlay.querySelector("g")!.hasAttribute("clip-path")).toBe(false);
    await pointer("pointerdown",44,36);await pointer("pointermove",50,40);expect(marker.style.display).toBe("");expect(overlay.style.display).toBe("none");await pointer("pointercancel",50,40);
    await act(async()=>installCloneSources({...shown,overlay:{...shown.overlay,auto_hide:false}}));await pointer("pointerdown",44,36);await pointer("pointermove",50,40);expect(overlay.style.display).toBe("");await pointer("pointercancel",50,40);expect(overlay.style.display).toBe("none");
    await act(async()=>installCloneSources({...shown,overlay:{...shown.overlay,show:false}}));await pointer("pointermove",44,36);expect(marker.style.display).toBe("");expect(overlay.style.display).toBe("none");
  });
  it("docks Layer Comps, Measurement Log and the type style panels, and records measurements from Image › Analysis",async()=>{
    const panels:PhotoPanels={layerComps:{comps:[{id:1,name:"Hero",comment:"",visibility:true,position:true,appearance:true,missingLayers:0}],lastApplied:null,hasLastDocumentState:false},
      measurementLog:{rows:[],columns:[],dataPoints:{selection:["label"],ruler:["label"],count:["label"]},available:{selection:[{key:"label",name:"Label"}],ruler:[{key:"label",name:"Label"}],count:[{key:"label",name:"Label"}]}},
      textStyles:{character:[{id:0,name:"None",attrs:{},resolved:{}}],paragraph:[{id:0,name:"Basic Paragraph",paragraphAttrs:{},characterAttrs:{},resolved:{paragraph:{},character:{}}}],current:null}};
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,panels}})));
    expect([...container.querySelectorAll('[aria-label="Collapsed panels"] button')].map(item=>item.getAttribute("aria-label"))).toEqual(expect.arrayContaining(["Layer Comps","Measurement Log","Character Styles","Paragraph Styles"]));
    await click("Layer Comps");expect(container.querySelector('[role="group"][aria-label="Layer Comps"]')).not.toBeNull();
    await click("Layer Comps panel options");await act(async()=>row("New Layer Comp…").click());expect(container.querySelector('[role="dialog"][aria-label="New Layer Comp"]')).not.toBeNull();await click("Cancel");
    for(const name of ["Measurement Log","Character Styles","Paragraph Styles"]){await click(name);expect(container.querySelector(`[role="group"][aria-label="${name}"]`)).not.toBeNull();}
    await menu("Image","Analysis");expect(row("Record Measurements").getAttribute("aria-keyshortcuts")).toBe("Shift+Meta+M");await act(async()=>row("Record Measurements").click());expect(command).toHaveBeenLastCalledWith("image.analysis.recordMeasurements",{source:"auto"});
    await menu("Image","Analysis","Select Data Points");await act(async()=>row("Custom…").click());expect(container.querySelector('[role="dialog"][aria-label="Select Data Points"]')).not.toBeNull();await click("Cancel");
    await menu("Image","Analysis");await act(async()=>row("Count Tool").click());expect(container.textContent).toContain("Click to add a count");
    await menu("Image","Analysis");await act(async()=>row("Ruler Tool").click());expect(container.textContent).toContain("Drag to measure");
    await menu("Window");expect(row("Layer Comps")).toBeTruthy();expect(row("Measurement Log")).toBeTruthy();
  });
  it("records an action in the Actions panel and plays its steps back through the same commands, like Photoshop",async()=>{
    useActions.setState({sets:[{id:"default",name:"Default Actions",actions:[]}],selected:null,recording:null,playing:false,failed:null,dialog:null,allowTools:false});
    await menu("Window");expect(row("Actions").getAttribute("aria-keyshortcuts")).toBe("Alt+F9");await act(async()=>row("Actions").click());
    expect(container.querySelector('[role="group"][aria-label="Actions"]')).not.toBeNull();expect(button("Begin Recording").disabled).toBe(true);
    await click("Create New Action");
    expect(container.querySelector<HTMLInputElement>('[role="dialog"][aria-label="New Action"] [aria-label="Action name"]')!.value).toBe("Action 1");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Action set"]')!.value).toBe("default");
    await click("Record");
    expect(container.querySelector('[aria-label="Recording Action 1"]')).not.toBeNull();expect(button("Begin Recording").getAttribute("aria-pressed")).toBe("true");
    const before=usePhotoWorkspace.getState().state!;
    act(()=>recordActionStep("edit.fill",{contents:"black"},before,{...before,historySources:[{id:"fill",index:1,label:"Fill",current:true,available:true}]}));
    await click("Stop Playing/Recording");expect(container.querySelector('[aria-label="Recording Action 1"]')).toBeNull();
    await click("Expand Action 1");await click("Expand Fill");expect(container.querySelector(".xd-photo-actions dl")!.textContent).toBe('contents: "black"');
    command.mockClear();await click("Play Selection");
    expect(command.mock.calls).toEqual([["edit.fill",{contents:"black"}]]);
    await click("Include Fill");command.mockClear();await click("Play Selection");expect(command).not.toHaveBeenCalled();
    await click("Actions panel options");expect(row("Allow Tool Recording").getAttribute("aria-checked")).toBe("false");await act(async()=>row("Allow Tool Recording").click());
    expect(useActions.getState().allowTools).toBe(true);
    await click("Actions panel options");await act(async()=>row("Action Options…").click());
    const name=container.querySelector<HTMLInputElement>('[aria-label="Action Options name"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(name,"Darken");name.dispatchEvent(new Event("input",{bubbles:true}));});
    await click("OK");expect(button("Darken")).toBeTruthy();
    await click("Delete");expect(useActions.getState().sets[0]!.actions).toEqual([]);
  });
  it("clears source crosshairs on leave, scroll, zoom, tool, slot, source, document and view changes",async()=>{
    const slots=emptyCloneSources();slots.sources[0]!.source=[10,20];slots.sources[1]!.source=[70,80];await act(async()=>installCloneSources(slots));await chooseTool("paint.cloneStamp");await click("100%");let canvas=gestureCanvas();const marker=container.querySelector<SVGSVGElement>('[aria-label="Clone source marker"]')!,hover=()=>act(async()=>{canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:44,clientY:36}));}),hidden=()=>expect(marker.style.display).toBe("none");
    await hover();expect(marker.style.display).toBe("");await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerout",{bubbles:true,relatedTarget:container})));hidden();await hover();await act(async()=>container.querySelector('.xd-photo-stage')!.dispatchEvent(new Event("scroll")));hidden();await hover();await act(async()=>container.querySelector<HTMLButtonElement>('[title="Zoom out"]')!.click());hidden();await hover();await chooseTool("paint.stroke");hidden();await chooseTool("paint.cloneStamp");await hover();await pick("Clone source slot","1");hidden();await hover();const changed=structuredClone(slots);changed.active=1;changed.sources[1]!.source=[90,100];await act(async()=>installCloneSources(changed));hidden();await hover();await act(async()=>usePhotoWorkspace.setState(current=>({state:{...current.state!,viewKey:"composite"}})));hidden();
    await hover();const previous=useXDesign.getState().photoDocuments[usePhotoWorkspace.getState().documentId!]!,next={...previous,id:ulid(),version:ulid()};await act(async()=>{const placement=useXDesign.getState().applyPhotoDocument(next);usePhotoWorkspace.setState({shapeId:placement,documentId:next.id,stateVersion:next.version});});hidden();canvas=gestureCanvas();await hover();const missing=structuredClone(changed);missing.sources[1]!.source=null;await act(async()=>installCloneSources(missing));hidden();await hover();hidden();expect(command.mock.calls.filter(([id])=>id.startsWith("paint."))).toHaveLength(0);expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it.each(["source","slot","document","missing"])("releases native clone feedback once after a %s change without committing",async(change)=>{
    native.enabled=true;native.invoke.mockResolvedValue([]);const slots=emptyCloneSources();slots.sources[0]!.source=[10,20];slots.sources[1]!.source=[70,80];await act(async()=>{installCloneSources(slots);usePhotoWorkspace.setState(current=>({state:{...current.state!,viewKey:"composite"}}));});await chooseTool("paint.cloneStamp");const canvas=gestureCanvas();vi.useFakeTimers();
    try{
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:30,clientY:40})));await act(async()=>vi.advanceTimersByTimeAsync(100));expect(native.invoke.mock.calls.filter(([name])=>name==="xdesign_photo_stroke_preview_pixels")).toHaveLength(1);
      await act(async()=>{if(change==="document"){const previous=useXDesign.getState().photoDocuments[usePhotoWorkspace.getState().documentId!]!,next={...previous,id:ulid(),version:ulid()};const placement=useXDesign.getState().applyPhotoDocument(next);usePhotoWorkspace.setState({shapeId:placement,documentId:next.id,stateVersion:next.version});}else{const changed=structuredClone(slots);if(change==="slot")changed.active=1;else changed.sources[0]!.source=change==="missing"?null:[50,60];installCloneSources(changed);}});
      command.mockClear();await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:40,clientY:50})));await act(async()=>vi.advanceTimersByTimeAsync(100));expect(command).not.toHaveBeenCalled();expect(native.invoke.mock.calls.filter(([name])=>name==="xdesign_photo_stroke_end")).toHaveLength(1);expect(usePhotoWorkspace.getState().busy).toBe(false);
    }finally{vi.useRealTimers();}
  });
  it("prevents color replacement from silently editing pixels while a channel or mask is selected",async()=>{
    await chooseTool("paint.colorReplacement");await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,channels:{alpha:[],target:{kind:"color",index:0}}}})));
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:10,clientY:10})));expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().error).toContain("Color replacement edits layer pixels");expect(usePhotoWorkspace.getState().busy).toBe(false);
  });
  it("patches pressure-aware native feedback into the detail tiles and commits the exact same gesture seed once",async()=>{
    // Twice the preview's density, so detail tiles show and the stroke is patched into them.
    vi.stubGlobal("devicePixelRatio",2);
    native.enabled=true;
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,viewKey:"composite"}})));
    await click("100%");
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!,stage=container.querySelector<HTMLDivElement>(".xd-photo-stage")!,image=container.querySelector<HTMLDivElement>(".xd-photo-image")!;
    const bounds={left:0,top:0,width:800,height:600} as DOMRect;
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;
    vi.spyOn(stage,"getBoundingClientRect").mockReturnValue(bounds);vi.spyOn(image,"getBoundingClientRect").mockReturnValue(bounds);Object.defineProperties(stage,{clientWidth:{value:800},clientHeight:{value:600}});
    const pixels=new ArrayBuffer(4+24+4*4*4),header=new DataView(pixels);header.setUint32(0,1,true);[0,0,4,4,4,4].forEach((value,index)=>header.setUint32(4+index*4,value,true));
    native.invoke.mockImplementation(async(name:string)=>name==="xdesign_photo_stroke_pixels"?pixels:[]);
    const tile=document.createElement("canvas"),put=vi.fn(),drawImage=vi.fn(),contexts=vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockImplementation(function(this:HTMLCanvasElement){return this===tile?{putImageData:put,drawImage,clearRect:vi.fn()} as never:null;});
    vi.stubGlobal("ImageData",class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
    const loaded=Object.defineProperties(new Image(),{naturalWidth:{value:512},naturalHeight:{value:512}}),showTile=()=>tileSurface.current!.show(tile,{x:0,y:0,width:512,height:512,scale:1,image:loaded});
    showTile();expect(drawImage).toHaveBeenCalledTimes(1);
    const pen=(type:string,x:number,y:number,pressure:number)=>{const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});Object.defineProperties(event,{pointerType:{value:"pen"},pressure:{value:pressure},tiltX:{value:12},tiltY:{value:-6},twist:{value:30}});return event;};
    vi.useFakeTimers();
    try {
      await act(async()=>canvas.dispatchEvent(pen("pointerdown",20,20,.4)));await act(async()=>vi.advanceTimersByTimeAsync(100));
      expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_stroke_pixels",expect.objectContaining({viewKey:"composite",command:"paint.stroke",scale:1,params:expect.objectContaining({seed:expect.any(Number)})}));
      const preview=native.invoke.mock.calls.find(([name])=>name==="xdesign_photo_stroke_pixels")![1];expect(preview.params.points[0].slice(0,6)).toEqual([20,20,.4,12,-6,30]);
      expect(native.invoke.mock.calls.some(([name])=>name==="xdesign_photo_stroke_preview_pixels")).toBe(false);
      expect(put).toHaveBeenCalledWith(expect.objectContaining({width:4,height:4}),0,0);expect(container.querySelector(".xd-photo-stroke")).toBeNull();
      const id=usePhotoWorkspace.getState().documentId!,next=ulid();command.mockImplementationOnce(async()=>{useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[id]:{...s.photoDocuments[id]!,version:next}}}));usePhotoWorkspace.setState({stateVersion:next});});
      await act(async()=>canvas.dispatchEvent(pen("pointerup",90,60,0)));await act(async()=>vi.advanceTimersByTimeAsync(100));
      const commits=command.mock.calls.filter(([id])=>id==="paint.stroke");expect(commits).toHaveLength(1);expect(commits[0]![1]!.seed).toBe(preview.params.seed);expect(usePhotoWorkspace.getState().busy).toBe(false);
      // The patched tile already shows the commit, so it is not redrawn, and newer tiles (undo) do not get the stroke back.
      expect(drawImage).toHaveBeenCalledTimes(1);const painted=put.mock.calls.length;showTile();expect(drawImage).toHaveBeenCalledTimes(2);expect(put).toHaveBeenCalledTimes(painted);
      await act(async()=>canvas.dispatchEvent(pen("pointerdown",20,20,.4)));await act(async()=>vi.advanceTimersByTimeAsync(100));expect(put.mock.calls.length).toBeGreaterThan(painted);
      command.mockRejectedValueOnce(new Error("stroke refused"));
      await act(async()=>canvas.dispatchEvent(pen("pointerup",90,60,0)));await act(async()=>vi.advanceTimersByTimeAsync(100));
      expect(drawImage).toHaveBeenCalledTimes(3);
    }finally{vi.useRealTimers();contexts.mockRestore();}
  });
  it("keeps the shown image, its detail tiles and controls while a commit publishes its state before its image",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,viewKey:"composite"}})));
    const tiles=container.querySelector('[data-testid="detail-tiles"]'),id=usePhotoWorkspace.getState().documentId!,next=ulid();
    expect(tiles).not.toBeNull();expect(button("Undo").disabled).toBe(false);
    // A Pencil commit's order: the reply's state, then its image once the placement has loaded the new preview.
    await act(async()=>usePhotoWorkspace.setState(s=>({busy:true,quiet:true,state:{...s.state!},stateVersion:next})));
    expect(container.querySelector('[data-testid="detail-tiles"]')).toBe(tiles);expect(button("Undo").disabled).toBe(false);
    await act(async()=>useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[id]:{...s.photoDocuments[id]!,version:next}}})));
    await act(async()=>usePhotoWorkspace.setState({busy:false,quiet:false}));
    expect(container.querySelector('[data-testid="detail-tiles"]')).toBe(tiles);expect(button("Undo").disabled).toBe(false);
  });
  it("paints strokes into the shown preview while it covers the screen and keeps them through the commit",async()=>{
    native.enabled=true;
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,viewKey:"composite"}})));
    await click("100%");
    const canvas=gestureCanvas(),source=container.querySelector<HTMLImageElement>(".xd-photo-image > img.xd-photo-preview-source")!,surface=container.querySelector<HTMLCanvasElement>(".xd-photo-image > canvas.xd-photo-preview")!;
    expect(surface.getAttribute("aria-label")).toBe("Portrait");
    const put=vi.fn(),drawImage=vi.fn(),contexts=vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockImplementation(function(this:HTMLCanvasElement){return this===surface?{putImageData:put,drawImage,clearRect:vi.fn()} as never:null;});
    vi.stubGlobal("ImageData",class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
    Object.defineProperty(HTMLImageElement.prototype,"decode",{configurable:true,value:async()=>{}});Object.defineProperties(source,{naturalWidth:{value:800},naturalHeight:{value:600}});
    const pixels=new ArrayBuffer(4+24+4*4*4),header=new DataView(pixels);header.setUint32(0,1,true);[8,6,4,4,4,4].forEach((value,index)=>header.setUint32(4+index*4,value,true));
    native.invoke.mockImplementation(async(name:string)=>name==="xdesign_photo_stroke_preview_pixels"?pixels:[]);
    vi.useFakeTimers();
    try {
      await act(async()=>source.dispatchEvent(new Event("load")));expect([surface.width,surface.height]).toEqual([800,600]);expect(drawImage).toHaveBeenCalledTimes(1);
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:20})));await act(async()=>vi.advanceTimersByTimeAsync(100));
      const call=native.invoke.mock.calls.find(([name])=>name==="xdesign_photo_stroke_preview_pixels")![1];
      expect(call).toMatchObject({viewKey:"composite",command:"paint.stroke"});expect(call).not.toHaveProperty("scale");
      expect(put).toHaveBeenCalledWith(expect.objectContaining({width:4,height:4}),8,6);expect(container.querySelector(".xd-photo-stroke")).toBeNull();
      expect(native.invoke.mock.calls.some(([name])=>name==="xdesign_photo_stroke_pixels"||name==="xdesign_photo_stroke_preview")).toBe(false);
      const id=usePhotoWorkspace.getState().documentId!,next=ulid();command.mockImplementationOnce(async()=>{useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[id]:{...s.photoDocuments[id]!,version:next}}}));usePhotoWorkspace.setState({stateVersion:next});});
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:90,clientY:60})));await act(async()=>vi.advanceTimersByTimeAsync(100));
      // The painted stroke is the committed preview, so nothing redraws until that preview loads.
      expect(command.mock.calls.filter(([name])=>name==="paint.stroke")).toHaveLength(1);expect(drawImage).toHaveBeenCalledTimes(1);
      // A settled stroke is not reapplied over later previews, such as the one undo loads.
      const painted=put.mock.calls.length;
      await act(async()=>source.dispatchEvent(new Event("load")));expect(drawImage).toHaveBeenCalledTimes(2);expect(put).toHaveBeenCalledTimes(painted);
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:20})));await act(async()=>vi.advanceTimersByTimeAsync(100));expect(put.mock.calls.length).toBeGreaterThan(painted);
      command.mockRejectedValueOnce(new Error("stroke refused"));
      await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:90,clientY:60})));await act(async()=>vi.advanceTimersByTimeAsync(100));
      expect(drawImage).toHaveBeenCalledTimes(3);
    }finally{vi.useRealTimers();contexts.mockRestore();delete (HTMLImageElement.prototype as {decode?:unknown}).decode;}
  });
  it("locks the workspace during a gesture, cancels with Escape and includes the release coordinate in one seeded brush edit",async()=>{
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800,height:600} as DOMRect);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:20})));
    // The gesture holds the lock without dimming the workspace for it.
    expect(usePhotoWorkspace.getState()).toMatchObject({busy:true,quiet:true});expect(button("Back to design").disabled).toBe(false);expect(button("Undo").disabled).toBe(false);
    await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape"})));
    expect(usePhotoWorkspace.getState().busy).toBe(false);expect(command).not.toHaveBeenCalled();
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:20}));const otherPointer=new MouseEvent("pointermove",{bubbles:true,clientX:400,clientY:400});Object.defineProperty(otherPointer,"pointerId",{value:77});canvas.dispatchEvent(otherPointer);canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:90,clientY:60}));});
    const brush=command.mock.calls.find(([id])=>id==="paint.stroke")!;expect(brush[1]!.points).toEqual([expect.arrayContaining([20,20,1]),expect.arrayContaining([90,60,1])]);expect(Number.isSafeInteger(brush[1]!.seed)).toBe(true);expect(brush).toHaveLength(2);expect(usePhotoWorkspace.getState()).toMatchObject({busy:false,quiet:false});
  });
  it("shows the active tool's controls and preserves brush settings when changing tool groups", async () => {
    await setBrushSize(48);
    await chooseTool("select.lasso");
    expect(container.querySelector('[aria-label="Brush preset picker"]')).toBeNull();
    expect(container.querySelector('[aria-label="Selection mode"]')).toBeTruthy();
    await click("Brush Tool");
    expect(brushSize()).toBe("48");
    expect(container.querySelector('[aria-label="Selection mode"]')).toBeNull();
    await chooseTool("paint.gradient");
    expect(container.querySelector('[aria-label="Brush opacity"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Brush preset picker"]')).toBeNull();
  });
  it("outlines the brush tip at its image size under the pointer in place of the system cursor",async()=>{
    const canvas=gestureCanvas(),tip=()=>container.querySelector<HTMLDivElement>(".xd-photo-brush-tip");
    await act(async()=>container.querySelector('[aria-label="Image editor"]')!.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"1",metaKey:true})));
    await click("Eraser Tool");await setBrushSize(48);expect(tip()!.style.display).toBe("");
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:120,clientY:80})));
    expect(tip()!.style.display).toBe("block");expect(tip()!.style.width).toBe("48px");expect(tip()!.style.transform).toBe("translate(120px, 80px) translate(-50%, -50%)");expect(canvas.classList.contains("xd-photo-brush")).toBe(true);
    await setBrushSize(96);expect(tip()!.style.width).toBe("96px");expect(tip()!.style.display).toBe("block");
    await act(async()=>canvas.dispatchEvent(new MouseEvent("pointerout",{bubbles:true,relatedTarget:container})));expect(tip()!.style.display).toBe("");
    // Too small to aim with, so the crosshair stays.
    await setBrushSize(1);expect(canvas.classList.contains("xd-photo-brush")).toBe(false);
    await chooseTool("select.lasso");expect(tip()).toBeNull();expect(canvas.classList.contains("xd-photo-brush")).toBe(false);
  });
  it("keeps the image surface and detail tiles mounted when panels and inspector tabs change", async () => {
    const surface = container.querySelector("canvas"), tiles = container.querySelector('[data-testid="detail-tiles"]');
    await click("Hide layers panel"); await click("Show layers panel"); await click("Adjustments"); await click("Swatches"); await click("Properties");
    expect(container.querySelector("canvas")).toBe(surface); expect(container.querySelector('[data-testid="detail-tiles"]')).toBe(tiles);
    expect(container.querySelector('[aria-label="Image layers"]')!.compareDocumentPosition(surface!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
  it("keeps layer edits connected to the native command adapter in the new inspector", async () => {
    expect(container.querySelector('[aria-label="Lock"]')).toBeNull();
    await act(async () => button("Portrait layer").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const name = container.querySelector<HTMLInputElement>('[aria-label="Rename Portrait layer"]')!;
    await act(async () => { name.value = "Retouched portrait"; name.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })); });
    expect(command).toHaveBeenCalledWith("layer.setProps", { layer: 1, name: "Retouched portrait" }); expect(container.querySelector('[aria-label="Rename Portrait layer"]')).toBeNull();
    await act(async () => button("Portrait layer").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))); command.mockClear();
    await act(async () => { const field = container.querySelector<HTMLInputElement>('[aria-label="Rename Portrait layer"]')!; field.value = "Discarded"; field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })); });
    expect(command).not.toHaveBeenCalledWith("layer.setProps", expect.anything());
    await click("Forward"); expect(command).toHaveBeenCalledWith("layer.arrange.bringForward", {});
  });
  it("transforms and aligns the layer from Photoshop's Properties clusters", async () => {
    expect(container.querySelector('[aria-label="Width"]')).toBeNull();
    const edit = async (label: string, value: string, key = "Enter") => { await act(async () => { const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; field.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key })); }); };
    await framed(); command.mockClear();
    await edit("Width", "150"); expect(command).toHaveBeenLastCalledWith("edit.transform", { layer: 1, rect: [10, 20, 310, 220], quad: [[10, 20], [160, 20], [160, 120], [10, 120]] });
    await click("Link width and height"); await edit("Height", "100"); expect(command).toHaveBeenLastCalledWith("edit.transform", { layer: 1, rect: [10, 20, 310, 220], quad: [[10, 20], [310, 20], [310, 120], [10, 120]] });
    await edit("X position", "40"); expect(command).toHaveBeenLastCalledWith("layer.translate", { layer: 1, dx: 30, dy: 0 });
    command.mockClear(); await edit("Y position", "99", "Escape"); expect(command).not.toHaveBeenCalled(); expect(container.querySelector<HTMLInputElement>('[aria-label="Y position"]')!.value).toBe("20");
    await edit("Angle", "90"); const [, rotated] = command.mock.lastCall! as [string, { quad: number[][] }]; expect(rotated.quad.map(point => point.map(Math.round))).toEqual([[260, -30], [260, 270], [60, 270], [60, -30]]);
    await click("Flip horizontal"); expect(command).toHaveBeenLastCalledWith("edit.transform", { layer: 1, rect: [10, 20, 310, 220], quad: [[310, 20], [10, 20], [10, 220], [310, 220]] });
    await click("Align left edges"); expect(command).toHaveBeenLastCalledWith("layer.align.leftEdges", { to: "canvas" });
    expect(button("Distribute top edges").disabled).toBe(true);
    await act(async () => usePhotoWorkspace.setState(s => ({ state: { ...s.state!, selectedLayers: [1, 2, 3] } })));
    await click("Align vertical centers"); expect(command).toHaveBeenLastCalledWith("layer.align.verticalCenters", { to: "layers" });
    await click("Distribute horizontal spacing"); expect(command).toHaveBeenLastCalledWith("layer.distribute.horizontally", {});
    await pick("Align to", "canvas"); await click("Align bottom edges"); expect(command).toHaveBeenLastCalledWith("layer.align.bottomEdges", { to: "canvas" });
    await act(async () => usePhotoWorkspace.setState(s => ({ state: { ...s.state!, layers: s.state!.layers.map(layer => ({ ...layer, transformBounds: [0, 0, 0, 0] })) } })));
    expect(["Width", "X position", "Y position", "Angle"].map(label => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.disabled)).toEqual([true, true, true, true]);
    await act(async () => usePhotoWorkspace.setState(s => ({ state: { ...s.state!, layers: s.state!.layers.map(layer => ({ ...layer, transformBounds: [10, 20, 300, 200], locks: { transparency: false, pixels: false, position: true, all: false } })) } })));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Width"]')!.disabled).toBe(true);
  });
  it("keeps adjustments discoverable and adds them as layers edited in Properties", async () => {
    expect(button("Levels")).toBeUndefined(); await click("Adjustments");
    const caption = () => container.querySelector(".xd-photo-adjustments>p")?.textContent;
    expect(container.querySelectorAll(".xd-photo-adjustments>div")).toHaveLength(3); expect(caption()).toBe("Add an adjustment");
    await act(async () => button("Hue/Saturation").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))); expect(caption()).toBe("Hue/Saturation");
    await click("Levels");
    expect(command).toHaveBeenCalledWith("layer.newAdjustmentLayer.levels", {});
    expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(button("Properties").getAttribute("aria-selected")).toBe("true");
    await menu("Layer", "New Adjustment Layer", "Curves…"); expect(container.querySelector('[role="dialog"][aria-label="New Layer"]')).not.toBeNull();
    await click("OK"); expect(command).toHaveBeenLastCalledWith("layer.newAdjustmentLayer.curves", {}); expect(container.querySelector('[role="dialog"]')).toBeNull();
    await menu("Image", "Adjustments", "Curves…"); expect(container.querySelector('[role="dialog"][aria-label="Curves"]')).toBeTruthy();
  });
  it("enters a Transform mode from Edit > Transform and asks Image > Trim… before trimming", async () => {
    await menu("Edit", "Transform", "Skew"); expect(useFreeTransform.getState().session?.mode).toBe("skew");
    await menu("Edit", "Transform", "Perspective"); expect(useFreeTransform.getState().session?.mode).toBe("perspective"); await click("Cancel transform");
    await menu("Image", "Trim…"); expect(command).not.toHaveBeenCalledWith("image.trim", expect.anything()); expect(container.textContent).toContain("Trim Away");
    await click("OK"); expect(command).toHaveBeenLastCalledWith("image.trim", expect.objectContaining({ top: true, bottom: true, left: true, right: true }));
  });
  it("keeps Edit › Transform live during a Warp and routes its warp items to the open mesh", async () => {
    await menu("Edit","Transform");
    expect(["Split Warp Crosswise","Remove Warp Split","Convert warp anchor point","Toggle Guides"].map(label=>row(label).disabled)).toEqual([true,true,true,true]);
    await act(async()=>row("Warp").click());
    expect(container.querySelector('[aria-label="Warp layer canvas"]')).not.toBeNull();
    expect(container.querySelector(".xd-ps-menubar")!.hasAttribute("inert")).toBe(false);expect(button("Back to design").disabled).toBe(true);
    await menu("Edit");
    expect([...container.querySelectorAll<HTMLButtonElement>("[role=menu] > button")].filter(element=>!element.disabled).map(element=>element.textContent)).toEqual(["Transform"]);
    await act(async()=>row("Transform").click());
    expect(["Warp","Scale","Again"].map(label=>row(label).disabled)).toEqual([true,true,true]);
    expect(["Split Warp Crosswise","Remove Warp Split","Toggle Guides","Flip Horizontal"].map(label=>row(label).disabled)).toEqual([false,true,false,false]);
    await act(async()=>row("Split Warp Crosswise").click());
    expect(button("Split Warp Crosswise").getAttribute("aria-pressed")).toBe("true");
    await choose(["Edit","Transform"],"Flip Horizontal");expect(command).not.toHaveBeenCalledWith("edit.transform.flipHorizontal",expect.anything());
    await click("Cancel");expect(container.querySelector(".xd-ps-menubar")!.hasAttribute("inert")).toBe(false);
    await menu("Edit","Transform");expect(row("Split Warp Crosswise").disabled).toBe(true);
  });
  it("rotates the document from the Image menu without affecting layer selection", async () => {
    await menu("Image","Image Rotation","90° Clockwise");
    expect(command).toHaveBeenCalledWith("image.imageRotation.90cw", {});
    expect(usePhotoWorkspace.getState().state?.activeLayer).toBe(1);
    await click("Back to design"); expect(usePhotoWorkspace.getState().shapeId).toBeNull();
  });
  it("targets channels, changes visibility and loads saved selections without selecting another layer",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,channels:{composite:"RGB",compositeVisible:true,colors:[{name:"Red",visible:true}],alpha:[{index:0,name:"Cutout",spot:null,visible:false}],target:{kind:"composite"}}}})));
    await click("Channels");await click("Edit Red channel");
    expect(command).toHaveBeenCalledWith("channel.target",{channel:"Red"});
    await click("Show Cutout channel");expect(command).toHaveBeenCalledWith("channel.setVisible",{channel:0,visible:true});
    await act(async()=>button("Edit Cutout channel").dispatchEvent(new MouseEvent("click",{bubbles:true,metaKey:true})));expect(command).toHaveBeenCalledWith("select.loadSelection",{channel:0});
    expect(usePhotoWorkspace.getState().state?.activeLayer).toBe(1);
  });
  it("creates a named spot channel with ink controls in a dedicated dialog",async()=>{
    await click("Channels");await click("Channels panel options");await act(async()=>row("New Spot Channel…").click());
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("New image channel");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Spot channel solidity"]')!.value).toBe("0");
    await act(async()=>container.querySelector('[role="dialog"]')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    expect(command).toHaveBeenCalledWith("channel.newSpot",{name:"Spot color",color:"#ff0000",solidity:0,fromSelection:true});
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it("restores native channel overlay options and reorders saved channels",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,channels:{alpha:[{index:0,name:"Cutout",spot:null,color:[0,1,0],opacity:.25,indicates:"selectedAreas"},{index:1,name:"Ink",spot:{color:[1,0,0],solidity:.6}}]}}})));
    let hovered:Element|null=null;Object.defineProperty(document,"elementFromPoint",{configurable:true,value:()=>hovered});
    const drag=async(from:Element,to:Element,clientY:number)=>{hovered=to;await act(async()=>{from.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:0,clientY:clientY+50}));window.dispatchEvent(new MouseEvent("pointermove",{clientX:0,clientY}));});const shown=(to as HTMLElement).dataset.drop;await act(async()=>{window.dispatchEvent(new MouseEvent("pointerup",{clientX:0,clientY}));});return shown;};
    await click("Channels");const cutout=button("Edit Cutout channel"),ink=button("Edit Ink channel");
    expect(await drag(cutout,ink.parentElement!,1)).toBe("below");expect(command).toHaveBeenLastCalledWith("channel.move",{channel:0,to:1});
    expect(await drag(ink,cutout.parentElement!,-1)).toBe("above");expect(command).toHaveBeenLastCalledWith("channel.move",{channel:1,to:0});
    command.mockClear();expect(await drag(cutout,cutout.parentElement!,1)).toBeUndefined();expect(command).not.toHaveBeenCalled();
    Reflect.deleteProperty(document,"elementFromPoint");
    await act(async()=>cutout.parentElement!.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:10,clientY:10})));expect(row("Move Down")).toBeUndefined();await act(async()=>row("Channel Options…").click());
    expect(container.querySelector<HTMLInputElement>('[aria-label="Channel overlay opacity"]')!.value).toBe("25");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Channel overlay color"]')!.value).toBe("#00ff00");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Channel color indicates"]')!.value).toBe("selected");
    await act(async()=>container.querySelector('[role="dialog"]')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    expect(command).toHaveBeenCalledWith("channel.options",{channel:0,name:"Cutout",color:"#00ff00",opacity:25,indicates:"selected"});
  });
  it("opens layer-mask isolation through both its controls and Alt-click gesture",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,hasMask:true}))}})));
    await pick("Layer mask view","overlay");expect(command).toHaveBeenCalledWith("view.layerMask",{layer:1,mode:"overlay"});
    await act(async()=>button("Edit mask of Portrait layer").dispatchEvent(new MouseEvent("click",{bubbles:true,altKey:true,shiftKey:true})));
    expect(command).toHaveBeenCalledWith("view.layerMask",{layer:1,mode:"toggleOverlay"});
    await click("Quick Mask");expect(command).toHaveBeenCalledWith("select.editInQuickMaskMode",{});
  });
  it("lets native color-channel routing handle brush strokes instead of forcing layer pixels",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,channels:{colors:["Red","Green","Blue"].map(name=>({name,visible:true})),alpha:[],target:{kind:"color",index:0}}}})));
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800,height:600} as DOMRect);
    vi.spyOn(canvas,"getContext").mockReturnValue(null);
    canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:20}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:20,clientY:20}));});
    const call=command.mock.calls.find(([name])=>name==="paint.stroke");expect(call).toBeTruthy();
    expect(call![1]).not.toHaveProperty("target");
    expect(container.textContent).toContain("Editing Red channel");
  });
  it("creates live gradient layers and moves an existing fill without replacing its stops",async()=>{
    await chooseTool("paint.gradient");await pick("Tool Method","classic");
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800,height:600} as DOMRect);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;
    const drag=()=>act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:20}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:200,clientY:20}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:200,clientY:20}));});
    await drag();expect(command).toHaveBeenCalledWith("gradient.fill.create",expect.objectContaining({from:[20,20],to:[200,20],stops:[[0,"#ff3ea5"],[1,"#ffffff"]]}));
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,gradientFill:{style:"radial",angle:0,scale:80,offset:[0,0],reverse:true,dither:true,align:false,from:[20,20],to:[200,20],stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[],midpoints:[]}}))}})));
    command.mockClear();await drag();const call=command.mock.calls.find(([name])=>name==="gradient.fill.set")!;expect(call[1]).toMatchObject({layer:1,from:[20,20],to:[200,20],style:"radial",reverse:true});expect(call[1]).not.toHaveProperty("stops");
  });
  it("remembers the Method of a live gradient layer so its Gradient Fill dialog reopens with it",async()=>{
    await chooseTool("paint.gradient");await pick("Gradient mode","live");await pick("Tool Method","perceptual");
    const canvas=gestureCanvas();command.mockClear();await drag(canvas);
    const call=command.mock.calls.find(([name])=>name==="gradient.fill.create")!;expect(unbaked((call[1] as {stops:[number,string][]}).stops)).toEqual({method:"perceptual",stops:[[0,"#ff3ea5"],[1,"#ffffff"]]});
  });
  it("opens the Gradient Fill dialog from a fill layer's thumbnail and Layer Content Options, as Photoshop does",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,gradientFill:{style:"linear",angle:0,scale:100,offset:[0,0],reverse:false,dither:true,align:true,from:[0,0],to:[100,0],stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[],midpoints:[]}}))}})));
    const dialog=()=>container.querySelector('form[aria-label="Edit gradient fill"]');
    await act(async()=>container.querySelector(".xd-photo-layer-thumb-button")!.dispatchEvent(new MouseEvent("dblclick",{bubbles:true})));expect(dialog()).not.toBeNull();
    await click("Cancel");expect(dialog()).toBeNull();
    await menu("Layer","Layer Content Options…");expect(dialog()).not.toBeNull();
  });
  it("drops a new gradient fill layer, with nothing to redo, when its dialog is cancelled but keeps an existing one, as Photoshop does",async()=>{
    command.mockImplementation(async(id:string)=>{if(id==="layer.newFillLayer.gradient")usePhotoWorkspace.setState(s=>({state:{...s.state!,canUndo:true,layers:s.state!.layers.map(layer=>({...layer,gradientFill:{style:"linear",angle:90,scale:100,offset:[0,0],reverse:false,dither:false,align:true,from:[0,0],to:[0,100],stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[],midpoints:[]}}))}}));});
    const dialog=()=>container.querySelector('form[aria-label="Edit gradient fill"]');
    await menu("Layer","New Fill Layer","Gradient…");await click("OK");expect(dialog()).not.toBeNull();
    command.mockClear();await click("Cancel");expect(dialog()).toBeNull();expect(command).toHaveBeenCalledWith("history.select",{index:1,discardRedo:true});
    await menu("Layer","Layer Content Options…");command.mockClear();await click("Cancel");expect(dialog()).toBeNull();expect(command).not.toHaveBeenCalledWith("history.select",expect.anything());
  });
  it("keeps classic pixel gradients available for direct mask painting",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,hasMask:true}))}})));await click("Edit mask of Portrait layer");await chooseTool("paint.gradient");
    const mode=container.querySelector<HTMLSelectElement>('[aria-label="Gradient mode"]')!;expect(mode.disabled).toBe(true);expect(mode.value).toBe("classic");
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800,height:600} as DOMRect);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:20}));canvas.dispatchEvent(new MouseEvent("pointermove",{bubbles:true,clientX:200,clientY:20}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:200,clientY:20}));});
    expect(command).toHaveBeenCalledWith("paint.gradient",expect.objectContaining({target:"mask",from:[20,20],to:[200,20]}));expect(command.mock.calls.some(([id])=>id==="gradient.fill.create")).toBe(false);
  });
  it("switches mask/pixel targets and paints mask tones while preserving the pixel brush color",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,hasMask:true}))}})));
    await click("Edit mask of Portrait layer");
    expect(command).toHaveBeenCalledWith("layer.select",{layer:1,target:"mask"});
    expect(container.querySelector<HTMLInputElement>('[aria-label="Paint color"]')!.value).toBe("#000000");
    await click("Paint white");
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800,height:600} as DOMRect);
    vi.spyOn(canvas,"getContext").mockReturnValue(null);
    canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:20}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:20,clientY:20}));});
    const call=command.mock.calls.find(([name])=>name==="paint.stroke");
    expect(call![1]).toMatchObject({target:"mask",color:"#ffffff"});
    await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"x"})));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Paint color"]')!.value).toBe("#000000");
    await click("Portrait layer");
    expect(command).toHaveBeenCalledWith("layer.select",{layer:1,target:"pixels",mode:"replace"});
    expect(container.querySelector<HTMLInputElement>('[aria-label="Paint color"]')!.value).toBe("#ff3ea5");
    expect(button("Paint white")).toBeUndefined();
  });
  it("edits indexed layer effects without replacing the effect stack",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,effects:{enabled:true,items:[{kind:"Drop Shadow",type:"DropShadow",enabled:true,settings:{common:{enabled:true,opacity:.75,blend:"Multiply"},size:8},colors:{}}]}}))}})));
    await click("Styles");
    const opacity=container.querySelector<HTMLInputElement>('[aria-label="Common · Opacity"]')!;
    await act(async()=>{opacity.value="25";opacity.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});
    expect(command).toHaveBeenCalledWith("layer.layerStyle.editEffect",{layer:1,index:0,path:["common","opacity"],value:.25});
    await click("Duplicate Drop Shadow 1");expect(command).toHaveBeenCalledWith("layer.layerStyle.duplicateEffect",{layer:1,index:0});
    await click("Hide Drop Shadow 1");expect(command).toHaveBeenCalledWith("layer.layerStyle.editEffect",{layer:1,index:0,path:["common","enabled"],value:false});
    await click("Remove Drop Shadow 1");expect(command).toHaveBeenCalledWith("layer.layerStyle.removeEffect",{layer:1,index:0});
  });
  it("selects native brush presets and patches dynamics through the brush editor",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,brush:{sampledTip:false,sampledTexture:false,presets:[{name:"Soft round",group:"Basic",builtin:true,size:48,hardness:.2}],settings:{size:48,opacity:1,hardness:.2,shapeDynamics:{enabled:true,size:{control:"penPressure",jitter:0,minimum:0}}}}}})));
    await click("Brushes");await click("Use brush Soft round");
    expect(command).toHaveBeenCalledWith("tools.setBrush",{preset:"Soft round"});
    const control=container.querySelector<HTMLSelectElement>('[aria-label="Shape Dynamics · Size · Control"]')!;
    await act(async()=>{control.value="penTilt";control.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(command).toHaveBeenCalledWith("tools.setBrush",{shapeDynamics:{size:{control:"penTilt"}}});
    await click("Save preset");expect(command).toHaveBeenCalledWith("brush.presets.save",{name:"Custom brush"});
  });
  it("edits smart-filter order, blending and parameters without flattening the layer",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:s.state!.layers.map(layer=>({...layer,smartObject:{source:"embedded" as const,name:"Contents.pcraft",hasFilterMask:false},smartFiltersEnabled:true,smartFilters:[{command:"filter.blur.gaussianBlur",visible:true,opacity:.5,blend:"Normal",params:{radius:4}}]}))}})));
    await click("Toggle smart filter 1");expect(command).toHaveBeenCalledWith("layer.smartFilter.setVisible",{layer:1,index:0,visible:false});
    // Numeric smart-filter settings are edited in the Edit Filter dialog, not inline on the card.
    await click("Edit Gaussian Blur filter 1");
    const input=document.querySelector<HTMLInputElement>('[role=dialog][aria-label="Edit Gaussian Blur Filter"] [aria-label="Radius"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"8");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{input.form!.requestSubmit();});
    expect(command).toHaveBeenCalledWith("layer.smartFilter.setParams",{layer:1,index:0,params:{radius:8}});
    await pick("Smart filter 1 blend","Multiply");expect(command).toHaveBeenCalledWith("layer.smartFilter.blendingOptions",{layer:1,index:0,blend:"Multiply"});
  });
  it("uses persistent gradient stops and transparency while painting with the chosen shape",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,presets:{gradient:{name:"Sunset",stops:[[0,"foreground"],[1,"#00ff00"]],transparency:[[0,0],[1,100]]},gradients:[{name:"Custom",presets:[{name:"Sunset",stops:[[0,"foreground"],[1,"#00ff00"]],transparency:[[0,0],[1,100]]}]}],styles:[]}}})));
    await chooseTool("paint.gradient");await pick("Gradient mode","classic");await pick("Tool Method","classic");await click("Radial Gradient");
    const canvas=container.querySelector<HTMLCanvasElement>('[aria-label="Paint and select image"]')!;
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:800,height:600} as DOMRect);vi.spyOn(canvas,"getContext").mockReturnValue(null);canvas.setPointerCapture=vi.fn();canvas.hasPointerCapture=()=>false;
    await act(async()=>{canvas.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:20,clientY:20}));canvas.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,button:0,clientX:80,clientY:80}));});
    expect(command).toHaveBeenCalledWith("paint.gradient",expect.objectContaining({style:"radial",stops:[[0,"#ff3ea5"],[1,"#00ff00"]],transparency:[[0,0],[1,100]]}));
    const call=command.mock.calls.find(([name])=>name==="paint.gradient")!;expect(call[1]).not.toHaveProperty("colors");
    await click("Gradients");await click("Use gradient Sunset");expect(command).toHaveBeenCalledWith("gradient.presets.select",{preset:"Sunset",group:"Custom"});
  });
  const sunsetAndBasics=()=>act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,presets:{gradient:{name:"Sunset",stops:[[0,"foreground"],[1,"#00ff00"]],transparency:[[0,0],[1,100]]},gradients:[{name:"Basics",presets:[{name:"Black, White",stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[]}]}],styles:[]}}})));
  it("edits the Classic Gradient tool's gradient in the Gradient Editor from its swatch, previewing on the swatch until OK",async()=>{
    await sunsetAndBasics();await chooseTool("paint.gradient");await pick("Gradient mode","classic");
    const swatch=()=>button("Edit gradient").style.backgroundImage,before=swatch(),editor=()=>container.querySelector<HTMLElement>('[aria-label="Gradient Editor"]');
    const inEditor=async(label:string)=>{await act(async()=>[...editor()!.querySelectorAll("button")].find(element=>element.getAttribute("aria-label")===label||element.textContent===label)!.click());};
    expect(before).toContain("rgba(255,62,165,0) 0%");
    await click("Edit gradient");expect(editor()).not.toBeNull();expect(editor()!.querySelector<HTMLInputElement>('[aria-label="Gradient name"]')!.value).toBe("Sunset");
    await inEditor("Basics");await inEditor("Black, White");expect(swatch()).toContain("rgba(0,0,0,1) 0%");
    await inEditor("Cancel");expect(editor()).toBeNull();expect(swatch()).toBe(before);expect(command).not.toHaveBeenCalledWith("gradient.presets.select",expect.anything());
    await click("Edit gradient");await inEditor("Basics");await inEditor("Black, White");await inEditor("OK");expect(editor()).toBeNull();
    expect(command).toHaveBeenLastCalledWith("gradient.presets.select",{name:"Black, White",stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[],applyToLayer:false});
  });
  it("orders the Gradient tool bar as Photoshop does: Mode, Opacity, Reverse, Dither, Transparency, Method, with no Gradients button",async()=>{
    await chooseTool("paint.gradient");await pick("Gradient mode","classic");
    const bar=container.querySelector(".xd-photo-options")!,all=[...bar.querySelectorAll("*")];
    const reverse=[...bar.querySelectorAll("label")].find(label=>label.textContent==="Reverse")!;
    const order=['[aria-label="Tool Blend"]','[aria-label="Brush opacity"]',reverse,'[aria-label="Tool Dither"]','[aria-label="Gradient transparency"]','[aria-label="Tool Method"]'].map(target=>all.indexOf(typeof target==="string"?bar.querySelector(target)!:target));
    expect(order.every(index=>index>=0)).toBe(true);expect(order).toEqual([...order].sort((a,b)=>a-b));
    expect([...bar.querySelectorAll("button")].some(element=>element.textContent==="Gradients")).toBe(false);
  });
  it("opens the gradient presets from the live Gradient tool's swatch, with Transparency for Classic Gradient only",async()=>{
    await sunsetAndBasics();await chooseTool("paint.gradient");
    expect(button("Edit gradient").compareDocumentPosition(container.querySelector('[aria-label="Tool Dither"]')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[aria-label="Gradient transparency"]')).toBeNull();
    await click("Edit gradient");expect(container.querySelector('[aria-label="Gradient Editor"]')).toBeNull();expect(container.querySelector(".xd-ge-pick-presets")).not.toBeNull();
    await click("Basics");await click("Black, White");expect(command).toHaveBeenLastCalledWith("gradient.presets.select",{preset:"Black, White",group:"Basics"});expect(container.querySelector(".xd-ge-pick-presets")).toBeNull();
    await pick("Gradient mode","classic");await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Gradient transparency"]')!.click());
    await click("Gradient presets");await click("Basics");await click("Black, White");expect(command).toHaveBeenLastCalledWith("gradient.presets.select",{preset:"Black, White",group:"Basics",applyToLayer:false});
    await pick("Gradient mode","live");command.mockClear();await drag(gestureCanvas());expect(command).toHaveBeenLastCalledWith("gradient.fill.create",expect.objectContaining({transparency:[[0,0],[1,100]]}));
  });
  it("applies style presets to the selected layer with Shift adding effects",async()=>{
    await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,presets:{gradient:{name:"Default",stops:[[0,"foreground"],[1,"background"]],transparency:[]},gradients:[],styles:[{name:"Custom",presets:[{name:"Shadow",effects:["Drop Shadow"]}]}]}}})));
    await click("Styles");await act(async()=>button("Use style Shadow").dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true})));
    expect(command).toHaveBeenCalledWith("style.presets.apply",{preset:"Shadow",group:"Custom",layer:1,add:true});
    await click("Save style");expect(command).toHaveBeenCalledWith("style.presets.new",{name:"Custom style",layer:1,includeBlending:true,includeEffects:true});
  });

});

it("routes pixel Copy/Cut/Paste shortcuts through the Image workflow",async()=>{const canvas=gestureCanvas();for(const [key,shift,expected] of [["c",false,"edit.copy"],["c",true,"edit.copyMerged"],["x",false,"edit.cut"],["v",false,"edit.paste"],["v",true,"edit.pasteSpecial.pasteInPlace"]] as const){await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{key,metaKey:true,shiftKey:shift,bubbles:true,cancelable:true})));if(key==="v")await paste();expect(command).toHaveBeenLastCalledWith(expected,{});}expect(command).toHaveBeenCalledTimes(5);});
it("pastes an image copied in another app as a new layer instead of the internal clipboard",async()=>{const canvas=gestureCanvas(),image=new File([new Uint8Array([1])],"image.png",{type:"image/png"});await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"v",metaKey:true,bubbles:true,cancelable:true})));expect(document.activeElement?.className).toBe("xd-paste-catcher");await paste([image]);expect(placeBlob).toHaveBeenCalledWith(image);expect(command).not.toHaveBeenCalled();expect(document.querySelector(".xd-paste-catcher")).toBeNull();});
it("ignores clipboard shortcuts while repeating, composing, busy or editing text",async()=>{const canvas=gestureCanvas();for(const flags of [{repeat:true},{isComposing:true},{altKey:true}])await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"v",metaKey:true,bubbles:true,...flags})));await act(async()=>usePhotoWorkspace.setState({busy:true}));await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"v",metaKey:true,bubbles:true})));await act(async()=>usePhotoWorkspace.setState({busy:false}));const text=document.createElement("div");text.setAttribute("contenteditable","true");canvas.parentElement!.append(text);await act(async()=>text.dispatchEvent(new KeyboardEvent("keydown",{key:"c",metaKey:true,bubbles:true})));expect(command).not.toHaveBeenCalled();text.remove();});

it("routes mask clipboard menu actions and Photoshop shortcuts to the selected mask",async()=>{await act(async()=>usePhotoWorkspace.setState(state=>({state:{...state.state!,layers:state.state!.layers.map(layer=>({...layer,hasMask:true})),hasSelection:true}})));await click("Edit mask of Portrait layer");command.mockClear();const canvas=gestureCanvas();await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"v",metaKey:true,bubbles:true})));await paste();expect(command).toHaveBeenLastCalledWith("edit.paste",{target:"mask"});for(const [path,id] of [[["Copy"],"edit.copy"],[["Cut"],"edit.cut"],[["Copy Merged"],"edit.copyMerged"],[["Paste Special","Paste in Place"],"edit.pasteSpecial.pasteInPlace"],[["Paste Special","Paste Into"],"edit.pasteSpecial.pasteInto"],[["Paste Special","Paste Outside"],"edit.pasteSpecial.pasteOutside"]] as const){await menu("Edit",...path.slice(0,-1));expect(row(path.at(-1)!).disabled).toBe(false);await act(async()=>row(path.at(-1)!).click());expect(command).toHaveBeenLastCalledWith(id,{target:"mask"});}expect(canvas).toBe(container.querySelector('[aria-label="Paint and select image"]'));});
it.each(["alpha","color","quickMask"])("enables %s channel clipboard without inventing a layer-mask target",async(kind)=>{await act(async()=>usePhotoWorkspace.setState(state=>({state:{...state.state!,hasSelection:true,quickMask:kind==="quickMask",channels:{alpha:[],target:kind==="quickMask"?{kind:"composite"}:{kind:kind as "alpha"|"color",index:0}}}})));const canvas=gestureCanvas();await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"c",ctrlKey:true,bubbles:true})));expect(command).toHaveBeenLastCalledWith("edit.copy",{});await menu("Edit","Paste Special");expect(row("Copy").disabled).toBe(false);expect(row("Cut").disabled).toBe(false);expect(row("Paste Into").disabled).toBe(false);await act(async()=>row("Paste").click());expect(command).toHaveBeenLastCalledWith("edit.paste",{});});
it("uses a native displayed mask as the clipboard target after reopening and retains busy guards",async()=>{await act(async()=>usePhotoWorkspace.setState(state=>({state:{...state.state!,layers:state.state!.layers.map(layer=>({...layer,hasMask:true})),layerMaskView:{layer:1,mode:"gray"}}})));const canvas=gestureCanvas();await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"x",ctrlKey:true,bubbles:true})));expect(command).toHaveBeenLastCalledWith("edit.cut",{target:"mask"});command.mockClear();await act(async()=>usePhotoWorkspace.setState({busy:true}));await act(async()=>canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"v",ctrlKey:true,bubbles:true})));expect(command).not.toHaveBeenCalled();});

const layer=(id:number,name:string)=>({id,name,kind:"Raster",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false}) as PhotoLayer;
it("names Photoshop's tab: no layer for a lone Background, the layer otherwise, # when untagged",async()=>{
  const tab=()=>container.querySelector(".xd-ps-doctab span")!.textContent;
  expect(tab()).toMatch(/\(Portrait layer, RGB\/8\)$/);
  await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,mode:"Rgb",layers:[layer(1,"Background")],colorProfile:{description:"sRGB",colorSpace:"Rgb",embedded:false,bytes:0}}})));
  expect(tab()).toMatch(/\(RGB\/8#\)$/);
});
const labels=()=>[...container.querySelectorAll<HTMLButtonElement>("[role=menu]")].at(-1)!.querySelectorAll<HTMLButtonElement>(":scope > button");
const rowLabels=()=>[...labels()].map(element=>element.textContent!);
it("sorts filter submenus alphabetically and runs Find Edges and Solarize without a dialog",async()=>{
  for(const category of ["Blur","Noise","Render","Stylize","Other"]){
    await menu("Filter",category);const names=rowLabels().map(label=>label.replace("…","").toLowerCase());
    expect(names,category).toEqual([...names].sort((a,b)=>a.localeCompare(b)));
    if(category==="Noise")expect(rowLabels()).toContain("Dust & Scratches…");
    if(category==="Blur")expect(rowLabels()).toContain("Average");
    if(category==="Render")expect(rowLabels()).toEqual(expect.arrayContaining(["Clouds","Difference Clouds"]));
    if(category==="Stylize"){expect(rowLabels()).toEqual(expect.arrayContaining(["Find Edges","Solarize"]));expect(rowLabels()).not.toContain("Find Edges…");}
    await menu("Filter");
  }
  command.mockClear();await choose(["Filter","Stylize"],"Find Edges");expect(command).toHaveBeenLastCalledWith("filter.stylize.findEdges",{});
  await choose(["Filter","Stylize"],"Solarize");expect(command).toHaveBeenLastCalledWith("filter.stylize.solarize",{});
  await choose(["Filter","Render"],"Clouds");expect(command).toHaveBeenLastCalledWith("filter.render.clouds",{});
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("writes Brightness/Contrast and Hue/Saturation without spaces around the slash",async()=>{
  await menu("Image","Adjustments");expect(rowLabels()).toEqual(expect.arrayContaining(["Brightness/Contrast…","Hue/Saturation…"]));
});
it("starts a document from the clipboard image through File",async()=>{
  await choose(["File"],"New from Clipboard");expect(fromClipboard).toHaveBeenCalledTimes(1);
});
it("cycles Screen Mode from the toolbar foot",async()=>{
  const section=container.querySelector(".xd-photo")!;
  expect(section.getAttribute("data-screen-mode")).toBeNull();
  await click("Screen Mode");expect(section.getAttribute("data-screen-mode")).toBe("menu");
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Screen Mode"]')!.click());expect(section.getAttribute("data-screen-mode")).toBe("full");
});
it("removes the background with Select Subject and a mask from the selection, converting Background first",async()=>{
  await click("Remove background");
  expect(command.mock.calls.map(call=>call[0])).toEqual(["select.subject","layer.layerMask.revealSelection"]);
  command.mockClear();
  await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:[{...layer(1,"Background"),locks:{transparency:true}} as PhotoLayer]}})));
  await click("Remove background");
  expect(command.mock.calls.map(call=>call[0])).toEqual(["layer.new.layerFromBackground","select.subject","layer.layerMask.revealSelection"]);
});
it("lists the engine's Windows anti-alias modes, Stack Mode, Matting and Proof Setup presets",async()=>{
  await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:[{...layer(1,"Type"),kind:"Type",text:{text:"a",font:"x",sizePt:12}} as PhotoLayer]}})));
  await menu("Type","Anti-Alias");expect(rowLabels()).toEqual(expect.arrayContaining(["Windows LCD","Windows"]));
  await menu("Layer","Matting");expect(rowLabels()).toEqual(["Color Decontaminate…","Defringe…","Remove Black Matte","Remove White Matte"]);
  await act(async()=>row("Defringe…").click());
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  await click("OK");expect(command).toHaveBeenLastCalledWith("layer.matting.defringe",{width:1});
  await menu("View","Proof Setup");expect(rowLabels()).toEqual(expect.arrayContaining(["Working CMY Plate","Legacy Macintosh RGB (Gamma 1.8)"]));
});
it("copies shape and type layers as CSS or SVG and pastes clipboard text into a type layer without its formatting",async()=>{
  const writeText=vi.fn(async(_text:string)=>{}),readText=vi.fn(async()=>"one\r\ntwo");
  Object.defineProperty(navigator,"clipboard",{value:{writeText,readText},configurable:true});
  await menu("Layer");expect(row("Copy CSS").disabled).toBe(true);expect(row("Copy SVG").disabled).toBe(true);
  await menu("Edit","Paste Special");expect(rowLabels().slice(0,2)).toEqual(["Paste without Formatting","Paste in Place"]);expect(row("Paste without Formatting").disabled).toBe(true);
  await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,layers:[{...layer(1,"Box"),kind:"Shape"},{...layer(2,"Title"),kind:"Type",text:{text:"Hello",font:"Inter",sizePt:12}}] as PhotoLayer[],activeLayer:1}})));
  command.mockImplementation((async(id:string)=>id==="layer.copyCSS"?{text:".Box {}"}:id==="layer.copySVG"?{text:"<svg/>"}:id==="type.insertText"?{layer:2,caret:9}:undefined) as never);
  await act(async()=>container.querySelector('.xd-photo-layer-list [data-layer="1"]')!.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true})));
  expect(rowLabels()).toEqual(expect.arrayContaining(["Copy CSS","Copy SVG"]));await act(async()=>row("Copy CSS").click());
  expect(command).toHaveBeenLastCalledWith("layer.copyCSS");expect(writeText).toHaveBeenLastCalledWith(".Box {}");writeText.mockClear();
  await choose(["Layer"],"Copy CSS");
  expect(command).toHaveBeenLastCalledWith("layer.copyCSS");expect(writeText).toHaveBeenLastCalledWith(".Box {}");
  const written:Blob[]=[],write=vi.fn(async(items:{types:string[];blob:Promise<Blob>}[])=>{written.push(await items[0]!.blob);});
  vi.stubGlobal("ClipboardItem",class{types:string[];blob:Promise<Blob>;constructor(data:Record<string,Promise<Blob>>){this.types=Object.keys(data);this.blob=data["text/plain"]!;}});
  Object.defineProperty(navigator,"clipboard",{value:{writeText,readText,write},configurable:true});
  await choose(["Layer"],"Copy SVG");
  expect(command).toHaveBeenLastCalledWith("layer.copySVG");expect(await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(written[0]!);})).toBe("<svg/>");expect(writeText).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
  native.enabled=true;native.invoke.mockResolvedValue(undefined);write.mockClear();
  await choose(["Layer"],"Copy CSS");
  expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_copy_text",{text:".Box {}"});expect(write).not.toHaveBeenCalled();expect(writeText).toHaveBeenCalledTimes(1);
  native.invoke.mockImplementation(async(name:string)=>{if(name==="xdesign_photo_copy_text")throw "pbcopy failed";});
  await choose(["Layer"],"Copy SVG");
  expect(usePhotoWorkspace.getState().error).toBe("The clipboard could not be written: pbcopy failed");
  native.enabled=false;native.invoke.mockReset();await act(async()=>usePhotoWorkspace.setState({error:null}));

  await act(async()=>usePhotoWorkspace.setState(s=>({state:{...s.state!,activeLayer:2}})));
  lastTextCaret.current={layer:2,range:[1,3]};
  await choose(["Edit","Paste Special"],"Paste without Formatting");
  expect(command).toHaveBeenLastCalledWith("type.insertText",{layer:2,text:"one\ntwo",label:"Paste",range:[1,3]});
  expect(lastTextCaret.current).toEqual({layer:2,range:[9,9]});
  lastTextCaret.current={layer:7,range:[0,0]};readText.mockResolvedValueOnce("x");
  await choose(["Edit","Paste Special"],"Paste without Formatting");
  expect(command).toHaveBeenLastCalledWith("type.insertText",{layer:2,text:"x",label:"Paste"});
  command.mockClear();readText.mockResolvedValueOnce("");
  await choose(["Edit","Paste Special"],"Paste without Formatting");
  expect(command).not.toHaveBeenCalled();expect(usePhotoWorkspace.getState().error).toBe("The clipboard has no text.");
  Reflect.deleteProperty(navigator,"clipboard");lastTextCaret.current=null;
});
it("sets Units & Rulers and Guides, Grid & Slices in Preferences, previewing live and restoring on Cancel, like Photoshop",async()=>{
  localStorage.removeItem(PREFERENCES_KEY);usePreferences.setState({...DEFAULT_PREFERENCES,notice:null});
  const dialog=()=>container.querySelector<HTMLFormElement>('[role="dialog"][aria-label="Preferences"]');
  const pressedSection=()=>dialog()!.querySelector('nav [aria-pressed="true"]')!.textContent;
  await menu("Edit","Preferences");expect(rowLabels()).toEqual(["Units & Rulers…","Guides, Grid & Slices…"]);
  await act(async()=>row("Guides, Grid & Slices…").click());expect(pressedSection()).toBe("Guides, Grid & Slices");
  await pick("Grid color","#ff6b6b");await pick("Guides style","dashed");await inputNumber("Gridline every",50);await pick("Gridline units","pixels");
  expect(usePreferences.getState()).toMatchObject({grid:{color:"#ff6b6b",every:50,unit:"pixels"},guides:{style:"dashed"}});expect(localStorage.getItem(PREFERENCES_KEY)).toBeNull();
  await inputNumber("Grid subdivisions",0);expect(dialog()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);expect(usePreferences.getState().grid.subdivisions).toBe(4);
  await click("Cancel");expect(dialog()).toBeNull();expect(usePreferences.getState().grid).toEqual(DEFAULT_PREFERENCES.grid);expect(usePreferences.getState().guides).toEqual(DEFAULT_PREFERENCES.guides);

  await choose(["Edit","Preferences"],"Units & Rulers…");expect(pressedSection()).toBe("Units & Rulers");
  await pick("Ruler units","inches");await inputNumber("Screen resolution",144);
  await act(async()=>dialog()!.querySelector<HTMLInputElement>('[aria-label="Point/Pica Size"] input:not(:checked)')!.click());
  await click("Next");expect(pressedSection()).toBe("Guides, Grid & Slices");await act(async()=>dialog()!.querySelector<HTMLInputElement>('[aria-label="Show slice numbers"]')!.click());
  await act(async()=>dialog()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());expect(dialog()).toBeNull();
  const saved={...DEFAULT_PREFERENCES,rulerUnit:"inches",screenResolution:144,pointSize:"traditional",slices:{...DEFAULT_PREFERENCES.slices,numbers:false}};
  expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).toEqual({schemaVersion:1,preferences:saved});

  await choose(["View"],"Print Size");expect(container.querySelector(".xd-ps-doctab span")!.textContent).toContain("@ 200%");

  await act(async()=>useViewAids.setState(state=>({flags:{...state.flags,rulers:true}})));
  const ruler=container.querySelector<HTMLCanvasElement>('[aria-label="Vertical ruler"]')!;
  await act(async()=>ruler.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:5,clientY:40})));
  expect(rowLabels()).toEqual(["Pixels","Inches","Centimeters","Millimeters","Points","Picas","Percent"]);expect(row("Inches").getAttribute("aria-checked")).toBe("true");
  await act(async()=>row("Centimeters").click());expect(usePreferences.getState().rulerUnit).toBe("centimeters");expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!).preferences.rulerUnit).toBe("centimeters");
  await act(async()=>ruler.dispatchEvent(new MouseEvent("dblclick",{bubbles:true})));expect(pressedSection()).toBe("Units & Rulers");expect(container.querySelector<HTMLSelectElement>('[aria-label="Ruler units"]')!.value).toBe("centimeters");
  await click("Cancel");
  useViewAids.setState(state=>({flags:{...state.flags,rulers:false}}));localStorage.removeItem(PREFERENCES_KEY);usePreferences.setState({...DEFAULT_PREFERENCES,notice:null});
});
