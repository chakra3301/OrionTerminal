import { invoke } from "@tauri-apps/api/core";
import type { PhotoTile } from "./tiles";

// Display tiles are the color-managed pixels shown on the canvas, so sampling works for every document mode.
export async function sampleImageColor(request:{projectId:string;photoId:string;version:string;viewKey:string|null;x:number;y:number;width?:number;height?:number}):Promise<string|null> {
  const width=request.width??1,height=request.height??1;
  const tile=await invoke<PhotoTile>("xdesign_photo_tile",{projectId:request.projectId,photoId:request.photoId,version:request.version,x:request.x,y:request.y,width,height,viewKey:request.viewKey,scale:1});
  const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(tile.png),char=>char.charCodeAt(0))],{type:"image/png"}));
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
  const context=canvas.getContext("2d");if(!context){bitmap.close();throw new Error("Color sampling is unavailable");}
  context.drawImage(bitmap,0,0);bitmap.close();
  const data=context.getImageData(0,0,width,height).data;let red=0,green=0,blue=0,coverage=0;
  for(let index=0;index<data.length;index+=4){const alpha=data[index+3]!;red+=data[index]!*alpha;green+=data[index+1]!*alpha;blue+=data[index+2]!*alpha;coverage+=alpha;}
  return coverage?"#"+[red,green,blue].map(value=>Math.round(value/coverage).toString(16).padStart(2,"0")).join(""):null;
}
export function grayHex(hex:string):string {
  const value=Number.parseInt(hex.slice(1),16),gray=Math.round(.299*(value>>16&255)+.587*(value>>8&255)+.114*(value&255)).toString(16).padStart(2,"0");
  return `#${gray}${gray}${gray}`;
}

/** Colour of one layer, or of the layer and everything below it, from the host's isolated layer view (no display colour management). */
export async function sampleLayerColor(request:{projectId:string;photoId:string;version:string;layer:number;aboveHidden:boolean;x:number;y:number;width?:number;height?:number}):Promise<string|null> {
  const rgb=await invoke<[number,number,number]|null>("xdesign_photo_sample",{projectId:request.projectId,photoId:request.photoId,version:request.version,layer:request.layer,below:false,aboveHidden:request.aboveHidden,x:request.x,y:request.y,width:request.width??1,height:request.height??1});
  return rgb?"#"+rgb.map(value=>Math.max(0,Math.min(255,Math.round(value))).toString(16).padStart(2,"0")).join(""):null;
}
