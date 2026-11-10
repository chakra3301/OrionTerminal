import { beforeEach,afterEach,expect,it,vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePencilWorkspace } from "../pencil/runtime";
import { runPhotoCommand,usePhotoWorkspace } from "./runtime";
import { ACTIONS_KEY,useActions } from "./actions";
import { playSelection } from "./ActionsPanel";
import type { PhotoDocument,PhotoReply } from "./types";
const invoke=vi.hoisted(()=>vi.fn<(...args:unknown[])=>Promise<unknown>>());
vi.mock("@tauri-apps/api/core",()=>({invoke,isTauri:()=>true,convertFileSrc:(path:string)=>path}));
let doc:PhotoDocument,history:{id:string;index:number;label:string;current:boolean;available:boolean}[];
const reply=(version:string,activeLayer=1):PhotoReply=>({document:{...doc,version,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`},state:{name:doc.name,width:20,height:16,mode:"RGB",depth:16,resolution:72,activeLayer,hasSelection:false,selectionBounds:null,layers:[],canUndo:true,canRedo:false,viewKey:"composite",historySources:history},warnings:[],result:null});
const step=(label:string,activeLayer=1)=>async()=>{history=[...history.map(item=>({...item,current:false})),{id:ulid(),index:history.length,label,current:true,available:true}];return reply(ulid(),activeLayer);};
const same=(activeLayer=1)=>async()=>reply(ulid(),activeLayer);
const sent=()=>invoke.mock.calls.map(call=>{const {command,params}=call[1] as {command:string;params:unknown};return [command,params];});
beforeEach(()=>{
  invoke.mockReset();localStorage.removeItem(ACTIONS_KEY);useXDesign.getState().hydrate(null);usePencilWorkspace.setState({busy:false});usePhotoWorkspace.setState({busy:false,quiet:false});usePhotoWorkspace.getState().close();
  history=[{id:"open",index:0,label:"Open",current:true,available:true}];
  const projectId=ulid(),version=ulid();doc={id:ulid(),version,name:"Target",width:20,height:16,previewWidth:20,previewHeight:16,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null};
  const shapeId=useXDesign.getState().applyPhotoDocument(doc);useXDProjects.setState({activeId:projectId,transitioning:false});
  usePhotoWorkspace.setState({shapeId,documentId:doc.id,projectId,source:"legacy",state:reply(version).state,stateVersion:version});
  useActions.setState({sets:[{id:"default",name:"Default Actions",actions:[{id:"a",name:"Action 1",enabled:true,steps:[]}]}],recording:{set:"default",action:"a"},selected:{set:"default",action:"a"},playing:false,failed:null,allowTools:false});
});
afterEach(()=>{useActions.setState({recording:null,playing:false});usePhotoWorkspace.setState({busy:false,quiet:false});usePhotoWorkspace.getState().close();useXDProjects.setState({activeId:null});});

it("records the commands that made History states, with their History names, and plays them back through the same gate",async()=>{
  invoke.mockImplementationOnce(step("Gaussian Blur")).mockImplementationOnce(same()).mockImplementationOnce(step("Layer Properties",2)).mockImplementationOnce(step("Brush Tool")).mockImplementationOnce(same(2)).mockImplementationOnce(step("Fill",2));
  await runPhotoCommand("filter.blur.gaussianBlur",{radius:4,layer:1});
  await runPhotoCommand("view.zoomIn");
  await runPhotoCommand("layer.setProps",{opacity:50,layer:3});
  await runPhotoCommand("paint.stroke",{seed:1});
  await runPhotoCommand("edit.undo");
  await runPhotoCommand("edit.fill",{contents:"black"});
  expect(useActions.getState().sets[0]!.actions[0]!.steps).toEqual([
    {command:"filter.blur.gaussianBlur",params:{radius:4},label:"Gaussian Blur",enabled:true},
    {command:"layer.setProps",params:{opacity:50,layer:3},label:"Layer Properties",enabled:true},
    {command:"edit.fill",params:{contents:"black"},label:"Fill",enabled:true},
  ]);
  expect(JSON.parse(localStorage.getItem(ACTIONS_KEY)!).sets[0].actions[0].steps).toHaveLength(3);

  useActions.setState({recording:null});
  useActions.getState().sets[0]!.actions[0]!.steps[1]!.enabled=false;
  invoke.mockReset();invoke.mockImplementation(step("Again"));
  await playSelection();
  expect(sent()).toEqual([["filter.blur.gaussianBlur",{radius:4}],["edit.fill",{contents:"black"}]]);
  expect(useActions.getState().sets[0]!.actions[0]!.steps).toHaveLength(3);
});

it("records tool strokes only with Allow Tool Recording on and stops playback at a failing step",async()=>{
  useActions.setState({allowTools:true});
  invoke.mockImplementationOnce(step("Brush Tool")).mockImplementationOnce(step("Gradient"));
  await runPhotoCommand("paint.stroke",{seed:1});
  await runPhotoCommand("paint.gradient",{kind:"linear"});
  expect(useActions.getState().sets[0]!.actions[0]!.steps.map(item=>item.label)).toEqual(["Brush Tool","Gradient"]);

  useActions.setState({recording:null,selected:{set:"default"}});
  invoke.mockReset();invoke.mockRejectedValueOnce(new Error("No pixels are selected")).mockImplementation(step("Again"));
  await playSelection();
  expect(sent()).toEqual([["paint.stroke",{seed:1}]]);
  expect(useActions.getState()).toMatchObject({playing:false,failed:{action:"a",step:0,message:"No pixels are selected"}});
});
