import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhotoPaths, pathsPanelMenu } from "./PhotoPaths";
import type { PhotoState } from "./types";
const native=vi.hoisted(()=>({run:vi.fn()}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:native.run}));
const state=(paths:{saved:string[];work:boolean}):PhotoState=>({name:"x",width:100,height:50,mode:"RGB",depth:8,resolution:72,activeLayer:1,hasSelection:true,selectionBounds:null,layers:[],viewKey:"k",canUndo:false,canRedo:false,paths});
const tri={subpaths:[{closed:true,knots:[{anchor:[0,0],in:[0,0],out:[0,0],smooth:false},{anchor:[10,0],in:[10,0],out:[10,0],smooth:false},{anchor:[10,10],in:[10,10],out:[10,10],smooth:false}]}]};
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);native.run.mockReset().mockImplementation(async(id:string)=>id==="path.info"?{path:tri}:{});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const render=(paths:{saved:string[];work:boolean},active:string|null=null,select=vi.fn())=>act(async()=>root.render(<PhotoPaths state={state(paths)} disabled={false} active={active} select={select} version="v1"/>));
const button=(label:string)=>container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const labels=(menu:ReturnType<typeof pathsPanelMenu>)=>menu.map(entry=>typeof entry==="string"?entry:entry.label);

it("draws a silhouette per row and italicises the Work Path",async()=>{
  await render({saved:["Path 1"],work:true});
  expect([...container.querySelectorAll(".xd-photo-path-thumb path")].map(path=>path.getAttribute("d"))).toEqual(["M0 0C0 0 10 0 10 0C10 0 10 10 10 10C10 10 0 0 0 0Z","M0 0C0 0 10 0 10 0C10 0 10 10 10 10C10 10 0 0 0 0Z"]);
  expect(container.querySelector(".xd-photo-path-thumb")!.getAttribute("viewBox")).toBe("0 0 100 50");
  const work=[...container.querySelectorAll(".xd-photo-path-name")].find(element=>element.textContent==="Work Path")!;
  expect(work.classList.contains("xd-photo-path-work")).toBe(true);
});
it("has Photoshop's footer: mask from path and an empty new path",async()=>{
  const select=vi.fn();await render({saved:["Path 1"],work:false},"Path 1",select);
  expect([...container.querySelectorAll(".xd-ps-layer-actions button")].map(element=>element.getAttribute("aria-label"))).toEqual(["Fill path with foreground color","Stroke path with brush","Load path as a selection","Make work path from selection","Add a mask","Create new path","Delete current path"]);
  await act(async()=>button("Add a mask").click());expect(native.run).toHaveBeenLastCalledWith("layer.vectorMask.fromPath",{name:"Path 1"});
  await act(async()=>button("Create new path").click());expect(native.run).toHaveBeenLastCalledWith("path.set",{name:"Path 2",path:{subpaths:[]}});expect(select).toHaveBeenCalledWith("Path 2");
});
it("orders the flyout like Photoshop and maps its commands",async()=>{
  const saved=pathsPanelMenu(state({saved:["Path 1"],work:false}),"Path 1",false);
  expect(labels(saved)).toEqual(["New Path…","Duplicate Path…","Delete Path","-","Make Work Path…","Make Selection…","Fill Path…","Stroke Path…","Clipping Path…","-","Panel Options…"]);
  const item=(label:string)=>saved.find(entry=>typeof entry!=="string"&&entry.label===label) as Exclude<typeof saved[number],"-">;
  item("Clipping Path…").run!();expect(native.run).toHaveBeenLastCalledWith("path.clippingPath.set",{name:"Path 1",flatness:0});
  item("Duplicate Path…").run!();await act(async()=>{await Promise.resolve();});expect(native.run).toHaveBeenLastCalledWith("path.set",{name:"Path 1 copy",path:tri});
  expect(item("Panel Options…").disabled).toBe(true);
  const work=pathsPanelMenu(state({saved:[],work:true}),"work",false);
  expect(labels(work)[0]).toBe("Save Path…");expect((work.find(entry=>typeof entry!=="string"&&entry.label==="Clipping Path…") as {disabled:boolean}).disabled).toBe(true);
});
