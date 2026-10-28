import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {ulid} from "ulid";
import {useXDesign} from "../store";
import {useHtmlArtifact} from "../htmlArtifactStore";
import {snapshotActiveDoc,useXDProjects,validateDesignDoc} from "../projectsStore";
import {usePhotoWorkspace,exportImage} from "./runtime";
import type {PhotoDocument} from "./types";
const invoke=vi.hoisted(()=>vi.fn());
vi.mock("@tauri-apps/api/core",()=>({invoke,isTauri:()=>true,convertFileSrc:(path:string)=>path}));
let doc:PhotoDocument,shape:string,projectId:string;
const noteImageSaved=vi.fn(async(_id:string,_path:string,_saveAs:boolean)=>{});const realNoteImageSaved=useXDProjects.getState().noteImageSaved;
beforeEach(()=>{
  invoke.mockReset();noteImageSaved.mockReset();useXDProjects.setState({noteImageSaved});useXDesign.getState().hydrate(null);usePhotoWorkspace.setState({busy:false});usePhotoWorkspace.getState().close();projectId=ulid();useXDProjects.setState({activeId:projectId,transitioning:false});useHtmlArtifact.getState().setProject(projectId,null);
  const version=ulid();doc={id:ulid(),version,name:"Portrait",width:24,height:24,previewWidth:24,previewHeight:24,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:"/Users/me/Portrait.psd"};shape=useXDesign.getState().applyPhotoDocument(doc);
  usePhotoWorkspace.setState({shapeId:shape,documentId:doc.id,projectId,source:"legacy",stateVersion:version});
});
afterEach(()=>{usePhotoWorkspace.setState({busy:false});usePhotoWorkspace.getState().close();useXDProjects.setState({activeId:null,transitioning:false,noteImageSaved:realNoteImageSaved});});
describe("Save As location",()=>{
  it("remembers where Save As put a PSD with the project, through undo and reopening",async()=>{
    invoke.mockResolvedValue([]);
    await exportImage("/Users/me/Renamed.psd",undefined,true);
    expect(invoke).toHaveBeenLastCalledWith("xdesign_photo_export",expect.objectContaining({photoId:doc.id,path:"/Users/me/Renamed.psd"}));
    expect(useXDesign.getState().photoSavePaths).toEqual({[doc.id]:"/Users/me/Renamed.psd"});
    const version=ulid();useXDesign.getState().applyPhotoDocument({...doc,version,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`},shape);useXDesign.getState().undo();
    expect(useXDesign.getState().photoSavePaths).toEqual({[doc.id]:"/Users/me/Renamed.psd"});
    const snapshot=JSON.parse(JSON.stringify(snapshotActiveDoc()));validateDesignDoc(snapshot);
    useXDesign.getState().hydrate(null);expect(useXDesign.getState().photoSavePaths).toEqual({});
    useXDesign.getState().hydrate(snapshot);expect(useXDesign.getState().photoSavePaths).toEqual({[doc.id]:"/Users/me/Renamed.psd"});
  });
  it("leaves exports, copies and saves to other formats out",async()=>{
    invoke.mockResolvedValue([]);
    await exportImage("/Users/me/Copy.psd");await exportImage("/Users/me/Flat.pdf",undefined,true);
    expect(invoke).toHaveBeenCalledTimes(2);expect(useXDesign.getState().photoSavePaths).toEqual({});
  });
  it("refuses saved locations that aren't a Photoshop document for an image identity",()=>{
    const valid=snapshotActiveDoc();
    for(const photoSavePaths of [[],{[doc.id]:"/Users/me/Flat.png"},{"not-an-id":"/Users/me/A.psd"},{[doc.id]:42}])expect(()=>validateDesignDoc({...valid,photoSavePaths} as never)).toThrow();
    expect(()=>validateDesignDoc({...valid,photoSavePaths:{[doc.id]:"/Users/me/A.PSB"}})).not.toThrow();
  });
  it("tells the project list about each saved image file, after it's written",async()=>{
    invoke.mockResolvedValue([]);
    await exportImage("/Users/me/Renamed.psd",undefined,true);
    expect(noteImageSaved).toHaveBeenLastCalledWith(projectId,"/Users/me/Renamed.psd",true);
    await exportImage("/Users/me/Flat.jpg",90);
    expect(noteImageSaved).toHaveBeenLastCalledWith(projectId,"/Users/me/Flat.jpg",false);
    invoke.mockRejectedValueOnce(new Error("disk full"));
    await expect(exportImage("/Users/me/Fail.psd",undefined,true)).rejects.toThrow("disk full");
    expect(noteImageSaved).toHaveBeenCalledTimes(2);
  });
  it("still reports the save when the project list can't be updated",async()=>{
    invoke.mockResolvedValue(["warning"]);noteImageSaved.mockRejectedValueOnce(new Error("registry busy"));
    await expect(exportImage("/Users/me/A.psd",undefined,true)).resolves.toEqual(["warning"]);
  });
});
