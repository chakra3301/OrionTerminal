import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhotoChannels, channelSlots, channelsPanelMenu } from "./PhotoChannels";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoState } from "./types";
const native=vi.hoisted(()=>({invoke:vi.fn(),run:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke,isTauri:()=>true,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:native.run}));
const state=(target:NonNullable<PhotoState["channels"]>["target"]):PhotoState=>({name:"x",width:100,height:100,mode:"RGB",depth:8,resolution:72,activeLayer:1,hasSelection:true,selectionBounds:null,layers:[],viewKey:"k",canUndo:false,canRedo:false,
  channels:{composite:"RGB",compositeVisible:true,colors:[{name:"Red",visible:true},{name:"Green",visible:true},{name:"Blue",visible:true}],alpha:[{index:0,name:"Alpha 1",spot:null,visible:false}],target}});
let root:Root,container:HTMLDivElement;
const thumbs={composite:"AA",colors:["BB","CC","DD"],alpha:["EE"],quickMask:null};
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.useFakeTimers();native.run.mockReset().mockResolvedValue({});native.invoke.mockReset().mockResolvedValue(thumbs);usePhotoWorkspace.setState({busy:false});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
const render=async(target:NonNullable<PhotoState["channels"]>["target"])=>{await act(async()=>root.render(<PhotoChannels state={state(target)} targetChanged={vi.fn()} options={vi.fn()} source={{projectId:"p",photoId:"d",version:"v1"}}/>));await act(async()=>{await vi.advanceTimersByTimeAsync(200);});};
const button=(label:string)=>container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

it("numbers rows with Command-2 to 9 and fetches thumbnails for every row",async()=>{
  await render({kind:"composite"});
  expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_channel_thumbnails",{projectId:"p",photoId:"d",version:"v1",size:56});
  expect([...container.querySelectorAll(".xd-photo-channel-key")].map(element=>element.textContent)).toEqual(["⌘2","⌘3","⌘4","⌘5","⌘6"]);
  expect([...container.querySelectorAll("img")].map(image=>image.getAttribute("src"))).toEqual(["AA","BB","CC","DD","EE"].map(data=>`data:image/png;base64,${data}`));
  expect(channelSlots(state({kind:"composite"})).map(item=>[item.slot,item.channel])).toEqual([[2,"composite"],[3,"Red"],[4,"Green"],[5,"Blue"],[6,0]]);
});
it("loads the targeted channel, including the composite and colour channels, as a selection",async()=>{
  await render({kind:"composite"});await act(async()=>button("Load channel as selection").click());expect(native.run).toHaveBeenLastCalledWith("select.loadSelection",{channel:"composite"});
  await render({kind:"color",index:1});await act(async()=>button("Load channel as selection").click());expect(native.run).toHaveBeenLastCalledWith("select.loadSelection",{channel:{color:1}});
  expect(button("Delete current channel").disabled).toBe(true);
  await act(async()=>button("Edit Green channel").dispatchEvent(new MouseEvent("click",{bubbles:true,metaKey:true,shiftKey:true})));expect(native.run).toHaveBeenLastCalledWith("select.loadSelection",{channel:{color:1},operation:"add"});
  await act(async()=>button("Edit RGB channel").dispatchEvent(new MouseEvent("click",{bubbles:true,metaKey:true})));expect(native.run).toHaveBeenLastCalledWith("select.loadSelection",{channel:"composite"});
  await render({kind:"alpha",index:0});expect(button("Delete current channel").disabled).toBe(false);
});
it("labels the flyout like Photoshop",()=>{
  expect(channelsPanelMenu(state({kind:"composite"}),false,vi.fn(),vi.fn()).map(entry=>typeof entry==="string"?entry:entry.label)).toEqual(["New Channel…","Duplicate Channel…","Delete Channel","-","New Spot Channel…","Merge Spot Channel","-","Channel Options…","-","Split Channels","Merge Channels…","-","Panel Options…"]);
});
