import { useState } from "react";
import type { PhotoLayer } from "./types";
import { usePhotoWorkspace } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { BLEND_MODES } from "./controls";
import { blendOptions } from "./blendOptions";

const layerNames=(layers:PhotoLayer[])=>{
  const names=new Set<string>(),walk=(list:PhotoLayer[])=>{for(const layer of list){names.add(layer.name);if(layer.children)walk(layer.children);}};
  walk(layers);
  return names;
};

/** The first unused "{base} N" across every layer, groups' contents included: the engine's name for a new layer. */
export function nextLayerName(layers:PhotoLayer[],base:string) {
  const names=layerNames(layers);
  for(let n=1;;n++)if(!names.has(`${base} ${n}`))return `${base} ${n}`;
}

/** Photoshop's name for a copy of `name`: "{name} copy" while that is free, else the first free "copy N", counting on from a copy's own number. */
export function copyName(layers:PhotoLayer[],name:string) {
  const names=layerNames(layers),copy=/^(.*) copy(?: (\d+))?$/.exec(name),base=copy?copy[1]!:name;
  if(!copy&&!names.has(`${base} copy`))return `${base} copy`;
  for(let n=copy?.[2]?Number(copy[2])+1:2;;n++)if(!names.has(`${base} copy ${n}`))return `${base} copy ${n}`;
}

// The colour each mode leaves the image unchanged with, as Photoshop fills a new layer when asked; other modes have none.
const NEUTRAL:Record<string,string>=Object.fromEntries([
  ...["Darken","Multiply","Color Burn","Linear Burn","Darker Color","Divide"].map(mode=>[mode,"#ffffff"]),
  ...["Lighten","Screen","Color Dodge","Linear Dodge (Add)","Lighter Color","Difference","Exclusion","Subtract"].map(mode=>[mode,"#000000"]),
  ...["Overlay","Soft Light","Hard Light","Vivid Light","Linear Light","Pin Light"].map(mode=>[mode,"#808080"]),
]);

/** What OK asks for: the name (and whether it was changed), a neutral fill colour if one was chosen, and `layer.setProps` for the other options taken off their defaults. */
export type NewLayerRequest={name:string;renamed:boolean;neutral?:string;props:Record<string,unknown>};

/** Photoshop's New Layer (or New Group) dialog. `kind` "layer" offers the neutral fill; groups start in Pass Through with no clipping. */
export function NewLayerDialog({title="New Layer",name,kind,create,close}:{title?:string;name:string;kind:"layer"|"group"|"other";create:(request:NewLayerRequest)=>Promise<unknown>;close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error),group=kind==="group",opening=group?"Pass Through":"Normal";
  const [entry,setEntry]=useState(name),[clipped,setClipped]=useState(false),[blend,setBlend]=useState(opening),[opacity,setOpacity]=useState(100),[fill,setFill]=useState(false);
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  const neutral=kind==="layer"?NEUTRAL[blend]:undefined,valid=entry.trim()!==""&&opacity>=0&&opacity<=100;
  const submit=()=>create({name:entry,renamed:entry!==name,neutral:fill?neutral:undefined,props:{...clipped&&{clipped},...blend!==opening&&{blend},...opacity!==100&&{opacity:opacity/100}}});
  return <PhotoDialog dialog={dialog} title={title} className="xd-nl-dialog" busy={busy} okDisabled={!valid} close={close} onSubmit={event=>{event.preventDefault();if(valid)void submit().then(close).catch(()=>{});}}>
    <div className="xd-ps-dialog-grid">
      <label className="xd-ps-dialog-field"><span>Name</span><input aria-label="Name" value={entry} onFocus={event=>event.target.select()} onChange={event=>setEntry(event.target.value)}/></label>
      {!group&&<label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Use previous layer to create clipping mask" checked={clipped} onChange={event=>setClipped(event.target.checked)}/>Use previous layer to create clipping mask</label>}
      <label className="xd-ps-dialog-field xd-nl-mode"><span>Mode</span><select aria-label="Mode" value={blend} onChange={event=>setBlend(event.target.value)}>{blendOptions(group?["Pass Through",...BLEND_MODES]:BLEND_MODES)}</select></label>
      <label className="xd-ps-dialog-field xd-nl-opacity"><span>Opacity</span><input type="number" aria-label="Opacity" min="0" max="100" step="1" value={Number.isFinite(opacity)?opacity:""} onChange={event=>setOpacity(event.target.valueAsNumber)}/><span className="xd-ps-dialog-unit">%</span></label>
      {kind==="layer"&&<label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Fill with neutral color" disabled={!neutral} checked={fill&&!!neutral} onChange={event=>setFill(event.target.checked)}/>Fill with neutral color<span className="xd-nl-swatch" style={neutral?{background:neutral}:undefined}/></label>}
    </div>
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}
