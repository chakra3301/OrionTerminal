import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePencilWorkspace } from "../pencil/runtime";
import { setPhotoColors, usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoReply, PhotoRGBA, PhotoState } from "./types";

const invoke=vi.hoisted(()=>vi.fn<(...args:unknown[])=>Promise<unknown>>());
vi.mock("@tauri-apps/api/core",()=>({invoke,isTauri:()=>true,convertFileSrc:(path:string)=>path}));
let doc:PhotoDocument,projectId:string,shape:string;
const state:PhotoState={name:"Colors",width:24,height:24,mode:"RGB",depth:16,resolution:72,activeLayer:1,hasSelection:false,selectionBounds:null,layers:[],canUndo:false,canRedo:false};
const reply=(foreground:PhotoRGBA=[1,0,0,1],background:PhotoRGBA=[0,1,1,1]):PhotoReply=>({document:doc,state:{...state,tools:{foreground,background}},warnings:[]});
const pending=()=>{let resolve!:(value:PhotoReply)=>void;const promise=new Promise<PhotoReply>(done=>{resolve=done;});return {promise,resolve};};
beforeEach(()=>{
  invoke.mockReset();useXDesign.getState().hydrate(null);usePhotoWorkspace.setState({busy:false});usePhotoWorkspace.getState().close();usePencilWorkspace.setState({busy:false});
  const version=ulid();doc={id:ulid(),version,name:"Colors",width:24,height:24,previewWidth:24,previewHeight:24,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null};shape=useXDesign.getState().applyPhotoDocument(doc);projectId=ulid();
  useXDProjects.setState({activeId:projectId,transitioning:false});usePhotoWorkspace.setState({shapeId:shape,documentId:doc.id,projectId,source:"legacy",state,stateVersion:version});
});
afterEach(()=>{usePhotoWorkspace.setState({busy:false});usePhotoWorkspace.getState().close();useXDProjects.setState({activeId:null});});
it("coalesces rapid foreground/background changes under one busy lease without changing image/project history",async()=>{
  const first=pending(),second=pending();invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);const history=useXDesign.getState().past.length;
  const initial=setPhotoColors({foreground:"#ff0000"});expect(usePhotoWorkspace.getState().busy).toBe(true);
  const middle=setPhotoColors({foreground:"#00ff00"}),latest=setPhotoColors({foreground:"#204060",background:"#00ffff"});expect(invoke).toHaveBeenCalledOnce();
  first.resolve(reply());await Promise.resolve();await Promise.resolve();expect(usePhotoWorkspace.getState().busy).toBe(true);expect(invoke).toHaveBeenCalledTimes(2);expect(invoke.mock.lastCall).toEqual(["xdesign_photo_command",{projectId,photoId:doc.id,version:doc.version,command:"tools.setColors",params:{foreground:"#204060",background:"#00ffff"}}]);
  const native:[number,number,number,number]=[.123456,.4,.7,.75];second.resolve(reply(native));await Promise.all([initial,middle,latest]);expect(usePhotoWorkspace.getState().state!.tools!.foreground).toEqual(native);expect(usePhotoWorkspace.getState().busy).toBe(false);expect(useXDesign.getState().past).toHaveLength(history);expect(useXDesign.getState().photoDocuments[doc.id]).toEqual(doc);
});
it("drops queued settings after native failure and releases busy before a later retry",async()=>{
  invoke.mockRejectedValueOnce(new Error("Native write unavailable"));const first=setPhotoColors({foreground:"#ff0000"}),second=setPhotoColors({background:"#00ffff"});await expect(first).rejects.toThrow("Native write unavailable");await expect(second).rejects.toThrow("Native write unavailable");expect(invoke).toHaveBeenCalledOnce();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(usePhotoWorkspace.getState().error).toContain("Native write unavailable");
  invoke.mockResolvedValueOnce(reply());await setPhotoColors({foreground:"#ff0000"});expect(invoke).toHaveBeenCalledTimes(2);
});
it("starts a fresh update when a synchronous subscriber acts as the preceding busy lease ends",async()=>{
  invoke.mockResolvedValue(reply());let next:Promise<void>|undefined;const unsubscribe=usePhotoWorkspace.subscribe((current,previous)=>{if(previous.busy&&!current.busy&&!next){next=Promise.resolve();next=setPhotoColors({background:"#204060"});}});
  try{await setPhotoColors({foreground:"#ff0000"});await next;expect(invoke).toHaveBeenCalledTimes(2);expect(invoke.mock.lastCall).toEqual(["xdesign_photo_command",expect.objectContaining({params:{background:"#204060"}})]);expect(usePhotoWorkspace.getState().busy).toBe(false);}finally{unsubscribe();}
});
it("refuses queued updates for a different image and stops when the captured version changes",async()=>{
  const first=pending();invoke.mockReturnValueOnce(first.promise);const work=setPhotoColors({foreground:"#ff0000"}),queued=setPhotoColors({background:"#00ffff"});
  const changed={...doc,version:ulid()};useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[doc.id]:changed}}));await expect(setPhotoColors({foreground:"#00ff00"})).rejects.toThrow("Reopen the image");first.resolve(reply());await expect(work).rejects.toThrow("image changed");await expect(queued).rejects.toThrow("image changed");expect(invoke).toHaveBeenCalledOnce();expect(usePhotoWorkspace.getState().busy).toBe(false);expect(useXDesign.getState().photoDocuments[doc.id]).toBe(changed);
});
it("refuses a color reply that changes document identity or version",async()=>{
  const invalid=reply();invalid.document={...doc,id:ulid()};invoke.mockResolvedValueOnce(invalid);await expect(setPhotoColors({foreground:"#ff0000"})).rejects.toThrow("image changed");expect(usePhotoWorkspace.getState().state).toBe(state);expect(usePhotoWorkspace.getState().busy).toBe(false);
});
it("rejects invalid colors and unrelated busy/stale/project state before native mutation",async()=>{
  await expect(setPhotoColors({foreground:"bad"})).rejects.toThrow("valid paint color");usePhotoWorkspace.setState({busy:true});await expect(setPhotoColors({foreground:"#ff0000"})).rejects.toThrow("Wait for the image");usePhotoWorkspace.setState({busy:false,stateVersion:ulid()});await expect(setPhotoColors({foreground:"#ff0000"})).rejects.toThrow("Reopen the image");usePhotoWorkspace.setState({stateVersion:doc.version});useXDProjects.setState({transitioning:true});await expect(setPhotoColors({foreground:"#ff0000"})).rejects.toThrow("Reopen the image");expect(invoke).not.toHaveBeenCalled();
});
