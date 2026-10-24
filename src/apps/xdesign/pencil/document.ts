import type { SceneGraph } from "@open-pencil/scene-graph";
import { convertFigImageModes } from "./figPaintCompatibility";
import { deserializeGraph as decodeGraph } from "./graphDocument";
import { restoreSharedDesign, type SharedCheckpoint } from './sharedCheckpoint';
import { assertRoomImageResources } from './roomImageReferences';
import { readRoomImageBindings, type RoomImageBindings } from './roomImageBindings';
export { serializeGraph } from "./graphDocument";

export type PencilDocument = { formatVersion: 1; graph: string; pageId: string; panX: number; panY: number; zoom: number; photoLinks: Record<string,string>; shared?: SharedCheckpoint; roomImages?: RoomImageBindings };

export function deserializeGraph(json: string, allowInternalPages = false): SceneGraph {
  return decodeGraph(json,allowInternalPages,graph=>convertFigImageModes(graph,"import"));
}

let snapshot: (()=>PencilDocument|null)|null=null;
export function registerPencilSnapshot(provider:()=>PencilDocument|null):()=>void { snapshot=provider;return()=>{if(snapshot===provider)snapshot=null;}; }
export function livePencilSnapshot(fallback:PencilDocument|null):PencilDocument|null {return snapshot?snapshot():fallback;}
export function validatePencilDocument(doc:PencilDocument): void {
  if(doc.formatVersion!==1 || ![doc.panX,doc.panY,doc.zoom].every(Number.isFinite) || doc.zoom<=0 || typeof doc.pageId!=="string" || !doc.photoLinks || typeof doc.photoLinks!=="object" || Array.isArray(doc.photoLinks)) throw new Error("Invalid design canvas data");
  const graph=deserializeGraph(doc.graph);
  if(graph.getNode(doc.pageId)?.type!=="CANVAS") throw new Error("Invalid design page");
  assertRoomImageResources(graph);
  readRoomImageBindings(doc.roomImages);
  for(const [nodeId,photoId] of Object.entries(doc.photoLinks)) if(!graph.getNode(nodeId) || typeof photoId!=="string") throw new Error("Invalid linked photo layer");
  if (doc.shared !== undefined) restoreSharedDesign(doc).dispose();
}
