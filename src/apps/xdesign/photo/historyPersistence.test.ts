import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {ulid} from "ulid";
import {useXDesign} from "../store";
import {useHtmlArtifact} from "../htmlArtifactStore";
import {snapshotActiveDoc,useXDProjects,validateDesignDoc} from "../projectsStore";
import {usePhotoWorkspace,selectHistoryBrushSource,runPhotoCommand,editImage} from "./runtime";
import {validatePhotoDocuments,type PhotoDocument,type PhotoState} from "./types";
const invoke=vi.hoisted(()=>vi.fn());
vi.mock("@tauri-apps/api/core",()=>({invoke,isTauri:()=>true,convertFileSrc:(path:string)=>path}));
let doc:PhotoDocument,shape:string,source:string,projectId:string,state:PhotoState;
const changed=():PhotoDocument=>{const version=ulid();return {...doc,version,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`};};
beforeEach(()=>{
  invoke.mockReset();useXDesign.getState().hydrate(null);usePhotoWorkspace.setState({busy:false});usePhotoWorkspace.getState().close();projectId=ulid();source=ulid();useXDProjects.setState({activeId:projectId,transitioning:false});useHtmlArtifact.getState().setProject(projectId,null);
  const version=ulid();doc={id:ulid(),version,name:"History",width:24,height:24,previewWidth:24,previewHeight:24,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null};shape=useXDesign.getState().applyPhotoDocument(doc);
  state={name:"History",width:24,height:24,mode:"RGB",depth:8,resolution:72,activeLayer:1,hasSelection:false,selectionBounds:null,layers:[],canUndo:true,canRedo:false,historySources:[{id:source,index:0,label:"Open",current:false,available:true}]};
  usePhotoWorkspace.setState({shapeId:shape,documentId:doc.id,projectId,source:"legacy",state,stateVersion:version});
});
afterEach(()=>{usePhotoWorkspace.setState({busy:false});usePhotoWorkspace.getState().close();useXDProjects.setState({activeId:null,transitioning:false});});
describe("Saved image history selection",()=>{
  it("saves the selected source with project metadata and restores it after hydration and image reopen",async()=>{
    const past=useXDesign.getState().past.length;selectHistoryBrushSource(source);expect(useXDesign.getState().past).toHaveLength(past);const snapshot=JSON.parse(JSON.stringify(snapshotActiveDoc()));validateDesignDoc(snapshot);expect(snapshot.photoDocuments[doc.id].historyBrushSourceId).toBe(source);
    usePhotoWorkspace.getState().close();useXDesign.getState().hydrate(snapshot);invoke.mockResolvedValueOnce({document:doc,state,warnings:[]});await editImage(shape);expect(useXDesign.getState().photoDocuments[doc.id]?.historyBrushSourceId).toBe(source);expect(usePhotoWorkspace.getState().state?.historySources?.[0]?.id).toBe(source);
  });
  it("keeps source identity across new native versions and project undo/redo without moving linked placements",async()=>{
    selectHistoryBrushSource(source);const geometry=useXDesign.getState().shapes.map(shape=>[shape.id,shape.x,shape.y,shape.w,shape.h]);const next=changed();invoke.mockResolvedValueOnce({document:next,state:{...state,historySources:[{...state.historySources![0]!,index:1}]},warnings:[]});await runPhotoCommand("paint.historyBrush",{historySource:source});expect(useXDesign.getState().photoDocuments[doc.id]?.historyBrushSourceId).toBe(source);expect(useXDesign.getState().shapes.map(shape=>[shape.id,shape.x,shape.y,shape.w,shape.h])).toEqual(geometry);
    useXDesign.getState().undo();expect(useXDesign.getState().photoDocuments[doc.id]).toMatchObject({version:doc.version,historyBrushSourceId:source});useXDesign.getState().redo();expect(useXDesign.getState().photoDocuments[doc.id]).toMatchObject({version:next.version,historyBrushSourceId:source});
  });
  it("refuses unavailable, stale, busy and other-project selections without editing documents",()=>{
    for(const change of ["missing","unavailable","stale","busy","project"]){usePhotoWorkspace.setState({busy:false,state,stateVersion:doc.version,projectId});if(change==="unavailable")usePhotoWorkspace.setState({state:{...state,historySources:[{...state.historySources![0]!,available:false}]}});if(change==="stale")usePhotoWorkspace.setState({stateVersion:ulid()});if(change==="busy")usePhotoWorkspace.setState({busy:true});if(change==="project")usePhotoWorkspace.setState({projectId:ulid()});const before=useXDesign.getState().photoDocuments;expect(()=>selectHistoryBrushSource(change==="missing"?ulid():source)).toThrow();expect(useXDesign.getState().photoDocuments).toBe(before);}
  });
  it("validates saved source identities and clears an explicit choice without a design undo entry",()=>{
    expect(()=>validatePhotoDocuments({[doc.id]:{...doc,historyBrushSourceId:"arbitrary"}})).toThrow();selectHistoryBrushSource(source);const past=useXDesign.getState().past.length;selectHistoryBrushSource(null);expect(useXDesign.getState().photoDocuments[doc.id]).not.toHaveProperty("historyBrushSourceId");expect(useXDesign.getState().past).toHaveLength(past);
  });
});
