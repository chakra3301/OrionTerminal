import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { snapshotActiveDoc, useXDProjects, validateDesignDoc } from "../projectsStore";
import { openSmartContents, finishSmartContents, runPhotoCommand, stepSmartContentsHistory, usePhotoWorkspace, resumeSmartContents, removePhotoDraft, editImage } from "./runtime";
import type { PhotoDocument, PhotoReply, PhotoState } from "./types";
import { useHtmlArtifact } from "../htmlArtifactStore";
const invoke=vi.hoisted(()=>vi.fn<(...args:unknown[])=>Promise<unknown>>());
vi.mock("@tauri-apps/api/core",()=>({invoke,isTauri:()=>true,convertFileSrc:(path:string)=>path}));
const document=(id=ulid()):PhotoDocument=>{const version=ulid();return {id,version,name:"Contents",width:24,height:24,previewWidth:24,previewHeight:24,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null};};
const state:PhotoState={name:"Contents",width:24,height:24,mode:"RGB",depth:8,resolution:72,activeLayer:1,hasSelection:false,selectionBounds:null,layers:[],canUndo:false,canRedo:false};
const reply=(doc:PhotoDocument):PhotoReply=>({document:doc,state,warnings:[]});
let parent:PhotoDocument,shape:string,projectId:string;
beforeEach(()=>{
  invoke.mockReset();useXDesign.getState().hydrate(null);usePhotoWorkspace.setState({busy:false});usePhotoWorkspace.getState().close();
  parent=document();shape=useXDesign.getState().applyPhotoDocument(parent);projectId=ulid();
  useXDProjects.setState({activeId:projectId,transitioning:false});
  useHtmlArtifact.getState().setProject(projectId,null);
  usePhotoWorkspace.setState({shapeId:shape,documentId:parent.id,projectId,source:"legacy",state,stateVersion:parent.version});
});
afterEach(()=>{usePhotoWorkspace.setState({busy:false});usePhotoWorkspace.getState().close();useXDProjects.setState({activeId:null});});
describe("Smart-object contents workspace",()=>{
  it("isolates child edits and commits one parent history entry when saved",async()=>{
    const history=useXDesign.getState().past.length,child=document();
    invoke.mockResolvedValueOnce(reply(child));await runPhotoCommand("layer.smartObjects.editContents",{layer:1});
    expect(usePhotoWorkspace.getState().documentId).toBe(child.id);
    const changed=document(child.id);invoke.mockResolvedValueOnce(reply(changed));await runPhotoCommand("paint.stroke",{color:"#ff0000"});
    expect(useXDesign.getState().photoDocuments[parent.id]).toEqual(parent);
    expect(useXDesign.getState().past).toHaveLength(history);
    const saved=document(parent.id);invoke.mockResolvedValueOnce(reply(saved));await runPhotoCommand("layer.smartObjects.saveContents");
    expect(invoke).toHaveBeenLastCalledWith("xdesign_photo_smart_apply",{projectId,photoId:parent.id,version:parent.version,childId:child.id,childVersion:changed.version,layer:1});
    expect(usePhotoWorkspace.getState().smartTrail).toEqual([]);
    expect(useXDesign.getState().past).toHaveLength(history+1);
    useXDesign.getState().undo();expect(useXDesign.getState().photoDocuments[parent.id]).toEqual(parent);
  });
  it("undoes and redoes draft versions without touching the parent",async()=>{
    const child=document();invoke.mockResolvedValueOnce(reply(child));await openSmartContents(1);
    const changed=document(child.id);invoke.mockResolvedValueOnce(reply(changed));await runPhotoCommand("layer.new.layer");
    invoke.mockResolvedValueOnce(reply(child));await stepSmartContentsHistory(false);
    expect(useXDesign.getState().photoDocuments[child.id]).toEqual(child);
    invoke.mockResolvedValueOnce(reply(changed));await stepSmartContentsHistory(true);
    expect(useXDesign.getState().photoDocuments[child.id]).toEqual(changed);
    expect(useXDesign.getState().photoDocuments[parent.id]).toEqual(parent);
    invoke.mockResolvedValueOnce(reply(parent));await finishSmartContents(false);
    expect(usePhotoWorkspace.getState().documentId).toBe(parent.id);
    expect(invoke).toHaveBeenLastCalledWith("xdesign_photo_open",expect.objectContaining({photoId:parent.id,version:parent.version}));
  });
  it("keeps nested contents isolated until each parent is saved",async()=>{
    const child=document(),nested=document();invoke.mockResolvedValueOnce(reply(child));await openSmartContents(1);
    invoke.mockResolvedValueOnce(reply(nested));await openSmartContents(2);
    const changed=document(child.id);invoke.mockResolvedValueOnce(reply(changed));await finishSmartContents(true);
    expect(usePhotoWorkspace.getState().smartTrail).toHaveLength(1);
    expect(usePhotoWorkspace.getState().smartTrail[0]!.past).toEqual([child]);
    expect(useXDesign.getState().photoDocuments[parent.id]).toEqual(parent);
  });
  it("retains the draft after failed commits and refuses a changed parent",async()=>{
    const child=document();invoke.mockResolvedValueOnce(reply(child));await openSmartContents(1);
    invoke.mockRejectedValueOnce(new Error("Disk full"));await expect(finishSmartContents(true)).rejects.toThrow("Disk full");
    expect(usePhotoWorkspace.getState().documentId).toBe(child.id);
    useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[parent.id]:document(parent.id)}}));
    const calls=invoke.mock.calls.length;await expect(finishSmartContents(true)).rejects.toThrow("parent changed");
    expect(invoke.mock.calls).toHaveLength(calls);
    expect(usePhotoWorkspace.getState().smartTrail).toHaveLength(1);
  });
  it("recovers nested drafts and undo versions after a project reload",async()=>{
    const child=document(),nested=document();invoke.mockResolvedValueOnce(reply(child));await openSmartContents(1);
    const changed=document(child.id);invoke.mockResolvedValueOnce(reply(changed));await runPhotoCommand("layer.new.layer");
    invoke.mockResolvedValueOnce(reply(nested));await openSmartContents(2);
    const saved=JSON.parse(JSON.stringify(snapshotActiveDoc()));validateDesignDoc(saved);
    usePhotoWorkspace.getState().close();useXDesign.getState().hydrate(saved);
    expect(useXDesign.getState().photoDrafts).toHaveLength(1);
    invoke.mockResolvedValueOnce(reply(nested));await resumeSmartContents(child.id);
    expect(usePhotoWorkspace.getState()).toMatchObject({shapeId:shape,documentId:nested.id,smartTrail:[{childId:child.id,past:[child]},{childId:nested.id}]});
    invoke.mockResolvedValueOnce(reply(changed));await finishSmartContents(false);
    invoke.mockResolvedValueOnce(reply(child));await stepSmartContentsHistory(false);
    expect(useXDesign.getState().photoDocuments[parent.id]).toEqual(parent);
    expect(useXDesign.getState().photoDrafts[0]!.trail[0]!.future).toEqual([changed]);
  });
  it("keeps a draft when navigating to another image and removes it only after a successful finish",async()=>{
    const child=document();invoke.mockResolvedValueOnce(reply(child));await openSmartContents(1);
    invoke.mockResolvedValueOnce(reply(parent));await editImage(shape);
    expect(usePhotoWorkspace.getState().smartTrail).toEqual([]);
    expect(useXDesign.getState().photoDrafts).toHaveLength(1);
    invoke.mockResolvedValueOnce(reply(child));await resumeSmartContents(child.id);
    invoke.mockRejectedValueOnce(new Error("Disk full"));await expect(finishSmartContents(true)).rejects.toThrow("Disk full");
    expect(useXDesign.getState().photoDrafts).toHaveLength(1);
    invoke.mockResolvedValueOnce(reply(parent));await finishSmartContents(false);
    expect(useXDesign.getState().photoDrafts).toEqual([]);
  });
  it("discards recovery navigation while retaining immutable assets and the parent",async()=>{
    const child=document();invoke.mockResolvedValueOnce(reply(child));await openSmartContents(1);
    removePhotoDraft(child.id);
    expect(useXDesign.getState().photoDrafts).toEqual([]);
    expect(usePhotoWorkspace.getState().shapeId).toBeNull();
    expect(useXDesign.getState().photoDocuments[child.id]).toEqual(child);
    expect(useXDesign.getState().photoDocuments[parent.id]).toEqual(parent);
  });
});
