import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelMergeDialog } from "./ChannelMergeDialog";
import { usePhotoWorkspace } from "./runtime";
import { useXDesign } from "../store";
import type { PhotoDocument, PhotoState } from "./types";
const native=vi.hoisted(()=>({invoke:vi.fn(),run:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke,isTauri:()=>false,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:native.run}));
const photo=(id:string,version="v1"):PhotoDocument=>({id,version,name:id,width:100,height:100,previewWidth:100,previewHeight:100,bundlePath:"",previewPath:"",originalPath:null});
const current=photo("current"),gray:PhotoState={name:"Gray",width:100,height:100,mode:"Grayscale",depth:16,resolution:72,activeLayer:1,hasSelection:false,selectionBounds:null,layers:[],channels:{alpha:[]},viewKey:"same",canUndo:false,canRedo:false};
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);native.run.mockReset().mockResolvedValue({});native.invoke.mockReset().mockResolvedValue(gray);useXDesign.setState({photoDocuments:{current,red:photo("red"),green:photo("green"),blue:photo("blue")}});usePhotoWorkspace.setState({projectId:"project",busy:false,state:gray});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const render=()=>act(async()=>root.render(<ChannelMergeDialog document={current} close={vi.fn()}/>));
const choose=(index:number,id:string)=>act(async()=>{const select=container.querySelector<HTMLSelectElement>(`[aria-label="Merge channel ${index} source"]`)!;select.value=id;select.dispatchEvent(new Event("change",{bubbles:true}));});
const submit=()=>container.querySelector<HTMLButtonElement>('[type="submit"]')!;
it("uses reviewed source versions and requires review again when a source changes",async()=>{
  await render();await choose(1,"red");await choose(2,"green");await choose(3,"blue");expect(submit().disabled).toBe(false);
  await act(async()=>useXDesign.setState(state=>({photoDocuments:{...state.photoDocuments,red:photo("red","v2")}})));expect(submit().disabled).toBe(true);
  await choose(1,"red");expect(submit().disabled).toBe(false);await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(native.run).toHaveBeenCalledWith("channel.merge",{mode:"rgb",name:"Merged channels",documents:[{photoId:"red",version:"v2"},{photoId:"green",version:"v1"},{photoId:"blue",version:"v1"}]});
});
it("rejects color and mismatched-depth sources before merging",async()=>{
  native.invoke.mockResolvedValue({...gray,mode:"RGB"});await render();await choose(1,"red");await choose(2,"green");await choose(3,"blue");expect(submit().disabled).toBe(true);expect(container.textContent).toContain("Choose grayscale images");
});
