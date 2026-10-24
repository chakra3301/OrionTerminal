import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { SceneGraph } from "@open-pencil/scene-graph";
import { useXDesign } from "../store";
import { useXDProjects, snapshotActiveDoc } from "../projectsStore";
import { useHtmlArtifact } from "../htmlArtifactStore";
import { deserializeGraph, serializeGraph } from "./graphDocument";
import { startPencilSession, persistPencil, commitPencilPhoto } from "./runtime";
import type { PhotoDocument } from "../photo/types";

vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>false,invoke:vi.fn(),convertFileSrc:(path:string)=>path}));
vi.mock("./graphDocument",async original=>{const actual=await original<typeof import("./graphDocument")>();return {...actual,serializeGraph:vi.fn(actual.serializeGraph)};});
let session:ReturnType<typeof startPencilSession>;
beforeEach(()=>{
  vi.useFakeTimers();useXDesign.getState().hydrate(null);const id=ulid();useXDProjects.setState({activeId:id,transitioning:false,ready:true,registry:[{id,name:"Persistence",createdAt:0,updatedAt:0}]});
  useHtmlArtifact.getState().setProject(id);
  const graph=new SceneGraph();graph.images.set("d".repeat(40),new Uint8Array([9,9,9]));
  const doc={formatVersion:1 as const,graph:serializeGraph(graph),pageId:graph.getPages()[0]!.id,panX:0,panY:0,zoom:1,photoLinks:{}};useXDesign.setState({pencilDocument:doc});session=startPencilSession(document.createElement("div"),doc,()=>{});
  vi.mocked(serializeGraph).mockClear();
});
afterEach(()=>{session.dispose();vi.useRealTimers();vi.unstubAllGlobals();});

it("re-encodes the graph only after scene changes, not after view-only changes or autosave snapshots",()=>{
  const editor=session.editor;
  editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:"Card"});vi.advanceTimersByTime(300);
  expect(serializeGraph).toHaveBeenCalledTimes(1);const graph=useXDesign.getState().pencilDocument!.graph;
  editor.pan(40,-20);vi.advanceTimersByTime(300);editor.select([]);vi.advanceTimersByTime(300);
  expect(useXDesign.getState().pencilDocument).toMatchObject({graph,panX:40,panY:-20});
  expect(snapshotActiveDoc().pencilDocument?.graph).toBe(graph);persistPencil();
  expect(serializeGraph).toHaveBeenCalledTimes(1);
  editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:"Second"});vi.advanceTimersByTime(300);
  expect(serializeGraph).toHaveBeenCalledTimes(2);expect(useXDesign.getState().pencilDocument!.graph).not.toBe(graph);
});
it("persists only the images the design still references",()=>{
  session.editor.graph.createNode("RECTANGLE",session.editor.state.currentPageId,{name:"Card"});vi.advanceTimersByTime(300);
  expect(deserializeGraph(useXDesign.getState().pencilDocument!.graph).images.size).toBe(0);expect(session.editor.graph.images.size).toBe(1);
});
const photo=(id=ulid()):PhotoDocument=>{const version=ulid();return {id,version,name:"Linked photo",width:400,height:300,previewWidth:400,previewHeight:300,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null};};
const stubPreviews=()=>{let preview=0;vi.stubGlobal("fetch",vi.fn(async()=>new Response(new Uint8Array([137,80,78,71,++preview]))));};
it("saves photo edits once the canvas goes quiet, not inside each edit",async()=>{
  stubPreviews();const before=useXDesign.getState().pencilDocument,doc=photo();
  const id=await commitPencilPhoto(doc);await commitPencilPhoto(photo(doc.id),id);
  expect(serializeGraph).not.toHaveBeenCalled();expect(useXDesign.getState().pencilDocument).toBe(before);
  vi.advanceTimersByTime(300);
  expect(serializeGraph).toHaveBeenCalledTimes(1);expect(useXDesign.getState().pencilDocument!.photoLinks).toEqual({[id]:doc.id});
  session.editor.undoAction();expect(serializeGraph).toHaveBeenCalledTimes(1);vi.advanceTimersByTime(300);expect(serializeGraph).toHaveBeenCalledTimes(2);
});
it("still saves a pending photo edit when the canvas closes",async()=>{
  stubPreviews();const doc=photo(),id=await commitPencilPhoto(doc);
  session.dispose();
  expect(useXDesign.getState().pencilDocument!.photoLinks).toEqual({[id]:doc.id});
});
