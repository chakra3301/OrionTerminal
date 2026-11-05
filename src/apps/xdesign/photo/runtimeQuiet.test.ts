import { beforeEach,afterEach,expect,it,vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePencilWorkspace } from "../pencil/runtime";
import { holdImageGesture,refreshImage,runPhotoCommand,usePhotoWorkspace } from "./runtime";
import type { PhotoDocument,PhotoReply } from "./types";
const invoke=vi.hoisted(()=>vi.fn<(...args:unknown[])=>Promise<unknown>>());
vi.mock("@tauri-apps/api/core",()=>({invoke,isTauri:()=>true,convertFileSrc:(path:string)=>path}));
let doc:PhotoDocument;
const reply=(version:string):PhotoReply=>({document:{...doc,version,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`},state:{name:doc.name,width:20,height:16,mode:"RGB",depth:16,resolution:72,activeLayer:1,hasSelection:false,selectionBounds:null,layers:[],canUndo:true,canRedo:false,viewKey:"composite"},warnings:[],result:null});
beforeEach(()=>{
  invoke.mockReset();useXDesign.getState().hydrate(null);usePencilWorkspace.setState({busy:false});usePhotoWorkspace.setState({busy:false,quiet:false});usePhotoWorkspace.getState().close();
  const projectId=ulid(),version=ulid();doc={id:ulid(),version,name:"Target",width:20,height:16,previewWidth:20,previewHeight:16,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null};
  const shapeId=useXDesign.getState().applyPhotoDocument(doc);useXDProjects.setState({activeId:projectId,transitioning:false});
  usePhotoWorkspace.setState({shapeId,documentId:doc.id,projectId,source:"legacy",state:reply(version).state,stateVersion:version});
});
afterEach(()=>{usePhotoWorkspace.setState({busy:false,quiet:false});usePhotoWorkspace.getState().close();useXDProjects.setState({activeId:null});});

it("holds the lock for a command without locking the controls and runs commands started meanwhile after it",async()=>{
  let commit!:(reply:PhotoReply)=>void;const stroked=ulid(),undone=ulid();
  invoke.mockImplementationOnce(()=>new Promise(resolve=>{commit=resolve;})).mockImplementationOnce(async()=>reply(undone));
  const stroke=runPhotoCommand("paint.stroke",{seed:1});
  expect(usePhotoWorkspace.getState()).toMatchObject({busy:true,quiet:true});
  const undo=runPhotoCommand("edit.undo");
  await Promise.resolve();await Promise.resolve();
  expect(invoke).toHaveBeenCalledTimes(1);
  commit(reply(stroked));await stroke;await undo;
  expect(invoke).toHaveBeenCalledTimes(2);expect(invoke.mock.calls[1]![1]).toMatchObject({command:"edit.undo",version:stroked});
  expect(useXDesign.getState().photoDocuments[doc.id]!.version).toBe(undone);
  expect(usePhotoWorkspace.getState()).toMatchObject({busy:false,quiet:false,error:null});
});

it("still refuses a command while opening or refreshing the image holds the lock",async()=>{
  let finish!:(reply:PhotoReply)=>void;
  invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const refresh=refreshImage(doc);
  expect(usePhotoWorkspace.getState()).toMatchObject({busy:true,quiet:false});
  await expect(runPhotoCommand("edit.undo")).rejects.toThrow("Wait for the image operation to finish");
  finish(reply(doc.version));await refresh;
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("runs the command a gesture commits on release before the commands queued during the gesture",async()=>{
  const stroked=ulid(),undone=ulid();
  invoke.mockImplementationOnce(async()=>reply(stroked)).mockImplementationOnce(async()=>reply(undone));
  const release=holdImageGesture("Finish the gesture");
  expect(usePhotoWorkspace.getState()).toMatchObject({busy:true,quiet:true});
  const undo=runPhotoCommand("edit.undo");
  await Promise.resolve();await Promise.resolve();
  expect(invoke).not.toHaveBeenCalled();
  release();const stroke=runPhotoCommand("paint.stroke",{seed:1});
  await stroke;await undo;
  expect(invoke.mock.calls.map(call=>(call[1] as {command:string}).command)).toEqual(["paint.stroke","edit.undo"]);
  expect(invoke.mock.calls[1]![1]).toMatchObject({version:stroked});
  expect(useXDesign.getState().photoDocuments[doc.id]!.version).toBe(undone);
  expect(usePhotoWorkspace.getState()).toMatchObject({busy:false,quiet:false,error:null});
});
