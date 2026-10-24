import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PhotoDocument, PhotoState } from "./types";

export function hasImageView(state: PhotoState|null) {
  return !!(state?.colorView?.active || state?.layerMaskView || state?.channels?.colors?.some(channel=>!channel.visible) ||
    state?.channels?.alpha.some(channel=>channel.visible) || state?.channels?.quickMask?.visible);
}

export function imageEditTarget(state:PhotoState|null, mask:boolean) {
  if(mask||state?.layerMaskView)return "Layer mask";
  const target=state?.channels?.target;
  if(target?.kind==="alpha")return state?.channels?.alpha.find(channel=>channel.index===target.index)?.name??"Alpha channel";
  if(target?.kind==="color")return `${state?.channels?.colors?.[target.index]?.name??"Color"} channel`;
  return state?.quickMask?"Quick Mask":"Layer pixels";
}

export function photoPreviewURL(png:string) {
  const bytes=Uint8Array.from(atob(png),char=>char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes],{type:"image/png"}));
}

/** View changes can share the same image version. Keep preview requests and
 * object URLs scoped to both identities, including during undo and close. */
export function useImageViewPreview(document:PhotoDocument|null,projectId:string|null,state:PhotoState|null) {
  const viewKey=state?.viewKey;
  const active=hasImageView(state);
  const identity=`${projectId}/${document?.id}/${document?.version}/${viewKey}`;
  const [result,setResult]=useState<{identity:string;url:string|null;error:string|null}|null>(null);
  const [retry,setRetry]=useState(0);
  const owned=useRef<string|null>(null);
  useEffect(()=>{
    if(!active||!isTauri()||!document||!projectId||!viewKey)return;
    let closed=false,url:string|null=null;
    void invoke<{width:number;height:number;png:string}>("xdesign_photo_view_preview",{
      projectId,photoId:document.id,version:document.version,viewKey,
    }).then(preview=>{
      if(closed)return;
      if(!Number.isInteger(preview.width)||!Number.isInteger(preview.height)||preview.width<1||preview.height<1||
        preview.width>2048||preview.height>2048)throw new Error("The image view preview has invalid dimensions");
      url=photoPreviewURL(preview.png);owned.current=url;setResult({identity,url,error:null});
    }).catch(error=>{if(!closed)setResult({identity,url:null,error:`Image view preview failed: ${String(error)}`});});
    return()=>{closed=true;if(url){URL.revokeObjectURL(url);if(owned.current===url)owned.current=null;}};
  },[identity,active,projectId,document?.id,document?.version,viewKey,retry]);
  const current=result?.identity===identity?result:null;
  return {active,url:active&&current?.url===owned.current?current?.url??null:null,error:active?current?.error??null:null,retry:()=>setRetry(value=>value+1)};
}
