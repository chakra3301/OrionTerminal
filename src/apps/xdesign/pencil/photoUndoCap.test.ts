import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { SceneGraph } from "@open-pencil/scene-graph";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { serializeGraph } from "./document";
import { startPencilSession, commitPencilPhoto } from "./runtime";
import { PHOTO_UNDO_LIMIT } from "./photoUndoCap";
import type { PhotoDocument } from "../photo/types";

vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>false,invoke:vi.fn(),convertFileSrc:(path:string)=>path}));
let session:ReturnType<typeof startPencilSession>;
beforeEach(()=>{
  useXDesign.getState().hydrate(null);const id=ulid();useXDProjects.setState({activeId:id,transitioning:false,ready:true,registry:[{id,name:"Undo cap",createdAt:0,updatedAt:0}]});
  const graph=new SceneGraph();const doc={formatVersion:1 as const,graph:serializeGraph(graph),pageId:graph.getPages()[0]!.id,panX:0,panY:0,zoom:1,photoLinks:{}};useXDesign.setState({pencilDocument:doc});session=startPencilSession(document.createElement("div"),doc,()=>{});
  let preview=0;vi.stubGlobal("fetch",vi.fn(async()=>new Response(new Uint8Array([137,80,78,71,++preview]))));
});
afterEach(()=>{session.dispose();vi.unstubAllGlobals();});
const photo=(id=ulid()):PhotoDocument=>{const version=ulid();return {id,version,name:"Linked photo",width:400,height:300,previewWidth:400,previewHeight:300,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null};};
const imageOf=(id:string)=>session.editor.graph.getNode(id)?.fills[0]?.imageHash;
const undoAll=()=>{let steps=0;while(session.editor.undo.canUndo){session.editor.undoAction();steps++;}return steps;};

it("keeps only the latest photo edits undoable and frees the previews they replaced",async()=>{
  const doc=photo(),id=await commitPencilPhoto(doc),hashes=[imageOf(id)!];
  for(let edit=0;edit<PHOTO_UNDO_LIMIT+1;edit++){await commitPencilPhoto(photo(doc.id),id);hashes.push(imageOf(id)!);}
  const images=session.editor.graph.images;
  expect(images.has(hashes[0]!)).toBe(false);
  expect(hashes.slice(1).every(hash=>images.has(hash))).toBe(true);
  expect(undoAll()).toBe(PHOTO_UNDO_LIMIT);
  expect(imageOf(id)).toBe(hashes[1]);
  while(session.editor.undo.canRedo)session.editor.redoAction();
  expect(imageOf(id)).toBe(hashes.at(-1));
});

it("keeps a preview that undoing a later design edit can still restore",async()=>{
  const removed=await commitPencilPhoto(photo()),removedImage=imageOf(removed)!;
  const doc=photo(),id=await commitPencilPhoto(doc);
  session.editor.select([removed]);session.editor.deleteSelected();
  for(let edit=0;edit<PHOTO_UNDO_LIMIT-1;edit++)await commitPencilPhoto(photo(doc.id),id);
  expect(session.editor.graph.images.has(removedImage)).toBe(true);
  await commitPencilPhoto(photo(doc.id),id);
  expect(session.editor.graph.images.has(removedImage)).toBe(true);
  undoAll();
  expect(imageOf(removed)).toBe(removedImage);
  while(session.editor.undo.canRedo)session.editor.redoAction();
  await commitPencilPhoto(photo(doc.id),id);
  expect(session.editor.graph.images.has(removedImage)).toBe(false);
  undoAll();
  expect(session.editor.graph.getNode(removed)).toBeUndefined();
});
