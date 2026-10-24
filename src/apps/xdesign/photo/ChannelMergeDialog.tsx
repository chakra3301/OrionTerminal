import { useState } from "react";
import { useDesignDialog } from "../useDesignDialog";
import { useChannelSources } from "./useChannelSources";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PhotoDocument } from "./types";
import type { PhotoReference } from "./channelSources";
import type { ChannelSource } from "./channelSources";
import { PhotoDialog } from "./photoDialog";

const MODES = {rgb:["Red","Green","Blue"],cmyk:["Cyan","Magenta","Yellow","Black"],lab:["Lightness","a","b"]};
export function ChannelMergeDialog({document,close}:{document:PhotoDocument;close:()=>void}) {
  const state=usePhotoWorkspace(workspace=>workspace.state),projectId=usePhotoWorkspace(workspace=>workspace.projectId),busy=usePhotoWorkspace(workspace=>workspace.busy);
  const [identity]=useState(()=>({version:document.version,viewKey:state?.viewKey}));
  const [mode,setMode]=useState<keyof typeof MODES>("rgb"),[name,setName]=useState("Merged channels"),[refs,setRefs]=useState<(PhotoReference|null)[]>([]),[error,setError]=useState("");
  const [opening]=useState(()=>({mode,name,refs}));
  const choices=useChannelSources(document,state,projectId,[]).documents;
  const ids=refs.map(ref=>ref?.photoId??"");
  const reference=(ref:PhotoReference|null):ChannelSource=>({layer:"merged",channel:"composite",invert:false,...(ref&&ref.photoId!==document.id?{document:ref}:{})});
  const selected=refs.map(reference),sources=useChannelSources(document,state,projectId,selected);
  const cc=MODES[mode].length;
  const valid=!!state&&document.version===identity.version&&state.viewKey===identity.viewKey&&ids.length>=cc&&ids.every((id,index)=>!!id&&!!sources.resolve(selected[index]!)&&/gray/i.test(sources.resolve(selected[index]!)!.mode)&&sources.resolve(selected[index]!)!.depth===state.depth&&sources.valid(selected[index]!))&&new TextEncoder().encode(name.trim()).length<=512;
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  const select=(index:number,value:string)=>setRefs(current=>{const next=Array.from({length:Math.max(cc,current.length)},(_,i)=>current[i]??null);const photo=choices.find(photo=>photo.id===value);next[index]=photo?{photoId:photo.id,version:photo.version}:null;return next;});
  return <PhotoDialog dialog={dialog} title="Merge Channels" busy={busy} okDisabled={!valid} close={close} reset={()=>{setMode(opening.mode);setName(opening.name);setRefs(opening.refs);}} onSubmit={event=>{event.preventDefault();if(!valid||busy)return;setError("");void runPhotoCommand("channel.merge",{mode,name:name.trim()||"Merged channels",documents:refs}).then(close).catch(error=>setError(String(error)));}}>
    <div className="xd-ps-dialog-grid">
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Mode:</span><select aria-label="Merged image mode" disabled={busy} value={mode} onChange={event=>{setMode(event.target.value as keyof typeof MODES);setRefs([]);}}>{Object.keys(MODES).map(mode=><option key={mode} value={mode}>{mode.toUpperCase()}</option>)}</select></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Name:</span><input aria-label="Merged image name" disabled={busy} value={name} maxLength={512} onChange={event=>setName(event.target.value)}/></label></div>
      {Array.from({length:Math.max(cc,ids.length)},(_,index)=><div key={index} className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{MODES[mode][index]??`Alpha ${index-cc+1}`}:</span><select aria-label={`Merge channel ${index+1} source`} disabled={busy} value={ids[index]??""} onChange={event=>select(index,event.target.value)}><option value="">Choose grayscale image</option>{choices.map(photo=><option key={photo.id} value={photo.id}>{photo.name}</option>)}</select></label>{index>=cc&&<button type="button" disabled={busy} aria-label={`Remove alpha ${index-cc+1}`} onClick={()=>setRefs(values=>values.filter((_,i)=>i!==index))}>Remove</button>}</div>)}
    </div>
    <button type="button" disabled={busy||ids.length>=cc+64} onClick={()=>setRefs(values=>[...Array.from({length:Math.max(cc,values.length)},(_,i)=>values[i]??null),null])}>Add alpha channel</button>
    {ids.some((id,index)=>id&&sources.resolve(selected[index]!)&&!/gray/i.test(sources.resolve(selected[index]!)!.mode))&&<p role="alert">Choose grayscale images. Split Channels creates grayscale sources from a color image.</p>}
    {ids.some((id,index)=>id&&sources.resolve(selected[index]!)&&sources.resolve(selected[index]!)!.depth!==state?.depth)&&<p role="alert">Source images must have the same bit depth as the current image.</p>}
    {(error||sources.error)&&<p role="alert">{error||sources.error}</p>}
  </PhotoDialog>;
}
