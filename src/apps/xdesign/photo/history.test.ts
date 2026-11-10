import { beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import type { PhotoDocument } from "./types";
const id=ulid();
const document=(version=ulid()):PhotoDocument=>({id,version,name:"Linked",width:4000,height:3000,previewWidth:2048,previewHeight:1536,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null});
beforeEach(()=>useXDesign.getState().hydrate(null));
describe("linked photo history",()=>{
 it("updates all placements without changing their geometry and survives undo/redo",()=>{
   const first=document();const shapeId=useXDesign.getState().applyPhotoDocument(first);const copy=useXDesign.getState().duplicate([shapeId])[0]!;
   const bounds=useXDesign.getState().shapes.map(s=>[s.id,s.x,s.y,s.w,s.h]);
   const edited=document();useXDesign.getState().applyPhotoDocument(edited,shapeId);
   expect(useXDesign.getState().shapes.map(s=>[s.id,s.x,s.y,s.w,s.h])).toEqual(bounds);
   expect(useXDesign.getState().shapes.find(s=>s.id===copy)).toMatchObject({photoDocumentId:id});
   useXDesign.getState().undo();expect(useXDesign.getState().photoDocuments[id]!.version).toBe(first.version);
   useXDesign.getState().redo();expect(useXDesign.getState().photoDocuments[id]!.version).toBe(edited.version);
 });
 it("keeps later shared edits when undoing an earlier action on another page",()=>{
   const first=document();const a=useXDesign.getState().applyPhotoDocument(first);
   const changedA=document();useXDesign.getState().applyPhotoDocument(changedA,a);
   const pageA=useXDesign.getState().activePageId;useXDesign.getState().copy([a]);useXDesign.getState().newPage();const b=useXDesign.getState().paste()[0]!;
   const changedB=document();useXDesign.getState().applyPhotoDocument(changedB,b);useXDesign.getState().switchPage(pageA);useXDesign.getState().undo();
   expect(useXDesign.getState().photoDocuments[id]!.version).toBe(changedB.version);
 });
 it("clears the clipboard when another project is hydrated",()=>{
   const shapeId=useXDesign.getState().applyPhotoDocument(document());useXDesign.getState().copy([shapeId]);useXDesign.getState().hydrate(null);expect(useXDesign.getState().paste()).toEqual([]);
 });
});
