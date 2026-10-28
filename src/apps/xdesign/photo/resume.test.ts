import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {ulid} from "ulid";
import {useXDesign} from "../store";
import {useHtmlArtifact} from "../htmlArtifactStore";
import {snapshotActiveDoc,useXDProjects,validateDesignDoc} from "../projectsStore";
import {usePhotoWorkspace,editImage} from "./runtime";
import {editPencilImage,pencilPhotoDocumentId,pencilEditorProject} from "../pencil/runtime";
import {toast} from "@/store/toastStore";
import {startOpenImageTracking,closeImageEditor,resumeImageEditor} from "./resume";
import type {PhotoDocument} from "./types";
const invoke=vi.hoisted(()=>vi.fn());
vi.mock("@tauri-apps/api/core",()=>({invoke,isTauri:()=>true,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),editImage:vi.fn(async()=>{})}));
vi.mock("../pencil/runtime",async original=>({...await original<typeof import("../pencil/runtime")>(),editPencilImage:vi.fn(async()=>{}),pencilPhotoDocumentId:vi.fn(()=>null),pencilEditorProject:vi.fn(()=>null)}));
let doc:PhotoDocument,shape:string,projectId:string,stop:()=>void;
const remembered=()=>useXDesign.getState().photoResume;
const open=()=>usePhotoWorkspace.setState({shapeId:shape,documentId:doc.id,projectId,source:"legacy",stateVersion:doc.version,smartTrail:[]});
beforeEach(()=>{
  vi.mocked(editImage).mockReset().mockResolvedValue();vi.mocked(editPencilImage).mockReset().mockResolvedValue();vi.mocked(pencilPhotoDocumentId).mockReset().mockReturnValue(null);vi.mocked(pencilEditorProject).mockReset().mockReturnValue(null);
  invoke.mockReset();useXDesign.getState().hydrate(null);usePhotoWorkspace.setState({busy:false,error:null});usePhotoWorkspace.getState().close();projectId=ulid();useXDProjects.setState({activeId:projectId,transitioning:false});useHtmlArtifact.getState().setProject(projectId,null);
  stop=startOpenImageTracking();
  const version=ulid();doc={id:ulid(),version,name:"Portrait",width:24,height:24,previewWidth:24,previewHeight:24,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:"/Users/me/Portrait.psd"};shape=useXDesign.getState().applyPhotoDocument(doc);
  open();
});
afterEach(()=>{stop();usePhotoWorkspace.setState({busy:false,error:null});usePhotoWorkspace.getState().close();useXDProjects.setState({activeId:null,transitioning:false});vi.restoreAllMocks();});
describe("Picking up the image you were editing",()=>{
  it("remembers the open image with the project, through undo and a restart",()=>{
    expect(remembered()).toEqual({source:"legacy",placementId:shape,documentId:doc.id});
    const version=ulid();useXDesign.getState().applyPhotoDocument({...doc,version,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`},shape);useXDesign.getState().undo();
    expect(remembered()).toEqual({source:"legacy",placementId:shape,documentId:doc.id});
    const snapshot=JSON.parse(JSON.stringify(snapshotActiveDoc()));validateDesignDoc(snapshot);
    useXDesign.getState().hydrate(null);expect(remembered()).toBeNull();
    useXDesign.getState().hydrate(snapshot);expect(remembered()).toEqual({source:"legacy",placementId:shape,documentId:doc.id});
  });
  it("forgets it when you close the editor, and undo doesn't bring it back",()=>{
    const version=ulid();useXDesign.getState().applyPhotoDocument({...doc,version,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`},shape);
    closeImageEditor();
    expect(usePhotoWorkspace.getState().documentId).toBeNull();expect(remembered()).toBeNull();
    useXDesign.getState().undo();expect(remembered()).toBeNull();
    open();usePhotoWorkspace.setState({busy:true});
    closeImageEditor();
    expect(usePhotoWorkspace.getState().documentId).toBe(doc.id);expect(remembered()).toEqual({source:"legacy",placementId:shape,documentId:doc.id});
  });
  it("keeps it through the automatic close on a project switch",()=>{
    usePhotoWorkspace.getState().close();
    expect(remembered()).toEqual({source:"legacy",placementId:shape,documentId:doc.id});
  });
  it("keeps the image itself while its smart object contents are open",()=>{
    usePhotoWorkspace.setState({documentId:ulid(),smartTrail:[{parent:doc,childId:ulid(),layer:1} as never]});
    expect(remembered()).toEqual({source:"legacy",placementId:shape,documentId:doc.id});
  });
  it("doesn't record an editor left open on another project",()=>{
    useXDesign.setState({photoResume:null});
    usePhotoWorkspace.setState({projectId:ulid()});expect(remembered()).toBeNull();
    useXDProjects.setState({transitioning:true});open();expect(remembered()).toBeNull();
  });
  it("reopens straight into the image editor on the remembered image",async()=>{
    usePhotoWorkspace.getState().close();
    await expect(resumeImageEditor(projectId)).resolves.toBe(true);
    expect(editImage).toHaveBeenCalledExactlyOnceWith(shape);
    useXDesign.setState({photoResume:{source:"pencil",placementId:"node-1",documentId:doc.id}});
    vi.mocked(pencilPhotoDocumentId).mockReturnValue(doc.id);vi.mocked(pencilEditorProject).mockReturnValue(projectId);
    await expect(resumeImageEditor(projectId)).resolves.toBe(true);
    expect(editPencilImage).toHaveBeenCalledExactlyOnceWith("node-1");
  });
  it("opens on the board, quietly, when the image is gone",async()=>{
    const error=vi.spyOn(toast,"error");
    usePhotoWorkspace.getState().close();
    for(const photoResume of [{source:"legacy" as const,placementId:"missing",documentId:doc.id},{source:"legacy" as const,placementId:shape,documentId:ulid()}]){
      useXDesign.setState({photoResume});
      await expect(resumeImageEditor(projectId)).resolves.toBe(true);
      expect(remembered()).toBeNull();
    }
    expect(editImage).not.toHaveBeenCalled();
    useXDesign.setState({photoResume:{source:"legacy",placementId:shape,documentId:doc.id}});
    vi.mocked(editImage).mockImplementationOnce(async()=>{usePhotoWorkspace.setState({error:"Error: engine refused"});throw new Error("engine refused");});
    await expect(resumeImageEditor(projectId)).resolves.toBe(true);
    expect(remembered()).toBeNull();expect(usePhotoWorkspace.getState().error).toBeNull();expect(error).not.toHaveBeenCalled();
  });
  it("leaves it alone for a project that's no longer active, or a Pencil board still loading",async()=>{
    const kept={source:"legacy" as const,placementId:shape,documentId:doc.id};
    await resumeImageEditor(projectId);expect(editImage).not.toHaveBeenCalled();
    usePhotoWorkspace.getState().close();
    await resumeImageEditor(ulid());expect(editImage).not.toHaveBeenCalled();expect(remembered()).toEqual(kept);
    useXDProjects.setState({registry:[{id:projectId,name:"FX Scene",createdAt:1,updatedAt:1,kind:"fx"}]});
    await resumeImageEditor(projectId);expect(editImage).not.toHaveBeenCalled();expect(remembered()).toEqual(kept);
    useXDProjects.setState({registry:[]});
    vi.mocked(editImage).mockImplementationOnce(async()=>{useXDProjects.setState({activeId:ulid()});throw new Error("switched");});
    await resumeImageEditor(projectId);expect(remembered()).toEqual(kept);
    useXDProjects.setState({activeId:projectId});
    const pencil={source:"pencil" as const,placementId:"node-1",documentId:doc.id};useXDesign.setState({photoResume:pencil});
    vi.mocked(pencilEditorProject).mockReturnValue(ulid());
    await expect(resumeImageEditor(projectId)).resolves.toBe(false);
    expect(editPencilImage).not.toHaveBeenCalled();expect(remembered()).toEqual(pencil);
  });
  it("validates the remembered image's shape",()=>{
    const valid=snapshotActiveDoc();
    for(const photoResume of [{source:"x",placementId:"a",documentId:doc.id},{source:"legacy",placementId:"",documentId:doc.id},{source:"legacy",placementId:"a",documentId:"not-an-id"},{source:"legacy",placementId:"a".repeat(129),documentId:doc.id},[]])expect(()=>validateDesignDoc({...valid,photoResume} as never)).toThrow();
    expect(()=>validateDesignDoc({...valid,photoResume:null})).not.toThrow();
    expect(()=>validateDesignDoc({...valid,photoResume:{source:"pencil",placementId:"gone",documentId:ulid()}})).not.toThrow();
  });
});
