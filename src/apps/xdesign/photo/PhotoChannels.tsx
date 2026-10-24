import { useEffect, useState, type PointerEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { CircleDashed, Eye, EyeOff, Plus, SquareDashed, Trash2 } from "lucide-react";
import { ContextMenu } from "../EditorMenus";
import type { MenuEntry } from "../menuModel";
import { runPhotoCommand, usePhotoWorkspace, controlsLocked } from "./runtime";
import type { PhotoState } from "./types";
import { startRowDrag } from "./rowDrag";

type ThumbSource={projectId:string;photoId:string;version:string};
type Thumbs={composite:string;colors:string[];alpha:string[];quickMask:string|null};
type ChannelRef=string|number|{color:number};
const png=(data?:string|null)=>data?`data:image/png;base64,${data}`:undefined;
function useThumbs(source:ThumbSource|null|undefined) {
  const [thumbs,setThumbs]=useState<Thumbs|null>(null);
  useEffect(()=>{
    if(!source||!isTauri())return;
    let alive=true;
    const timer=setTimeout(()=>{void invoke<Thumbs>("xdesign_photo_channel_thumbnails",{...source,size:56}).then(result=>{if(alive&&result?.composite)setThumbs(result);}).catch(()=>{});},150);
    return()=>{alive=false;clearTimeout(timer);};
  },[source?.projectId,source?.photoId,source?.version]);
  return thumbs;
}
// Photoshop's Command-2 (composite), 3… (colour channels), then alpha channels up to 9.
export const channelSlots=(state:PhotoState)=>{
  const channels=state.channels;
  return [{name:channels?.composite??state.mode,channel:"composite" as string|number},...(channels?.colors??[]).map(color=>({name:color.name,channel:color.name as string|number})),...(channels?.alpha??[]).map(alpha=>({name:alpha.name,channel:alpha.index as string|number}))]
    .map((item,index)=>({...item,slot:index+2})).filter(item=>item.slot<=9);
};
const targetRef=(state:PhotoState):ChannelRef=>{const target=state.channels?.target;return target?.kind==="alpha"?target.index:target?.kind==="color"?{color:target.index}:"composite";};
// Command loads a new selection; with Shift it adds, with Option it subtracts, with both it intersects.
const loadOperation=(event:{shiftKey:boolean;altKey:boolean})=>event.shiftKey&&event.altKey?"intersect":event.shiftKey?"add":event.altKey?"subtract":"new";

type ChannelOptions=(channel:number|"quickMask"|null,spot?:boolean)=>void;
const run=(id:string,params:Record<string,unknown>={})=>{void runPhotoCommand(id,params).catch(()=>{});};
const targetAlpha=(state:PhotoState)=>{const target=state.channels?.target;return target?.kind==="alpha"?state.channels?.alpha.find(channel=>channel.index===target.index):undefined;};

export function channelsPanelMenu(state:PhotoState,busy:boolean,options:ChannelOptions,merge?:()=>void):MenuEntry[] {
  const alpha=targetAlpha(state);
  return [
    {label:"New Channel…",disabled:busy,run:()=>options(null)},
    {label:"Duplicate Channel…",disabled:busy,run:()=>run("channel.duplicate",{channel:targetRef(state)})},
    {label:"Delete Channel",disabled:busy||!alpha,run:()=>run("channel.delete",{channel:alpha!.index})},
    "-",
    {label:"New Spot Channel…",disabled:busy,run:()=>options(null,true)},
    {label:"Merge Spot Channel",disabled:busy||!alpha?.spot,run:()=>run("channel.mergeSpot",{channel:alpha!.index})},
    "-",
    {label:"Channel Options…",disabled:busy||!alpha&&!state.quickMask,run:()=>options(alpha?alpha.index:"quickMask")},
    "-",
    {label:"Split Channels",disabled:busy,run:()=>run("channel.split")},
    ...(merge?[{label:"Merge Channels…",disabled:busy,run:merge}]:[]),
    "-",
    {label:"Panel Options…",disabled:true},
  ];
}

export function PhotoChannels({state,targetChanged,options,source}:{state:PhotoState;targetChanged:()=>void;options:ChannelOptions;source?:ThumbSource|null}) {
  const thumbs=useThumbs(source);
  const busy=usePhotoWorkspace(controlsLocked);
  const [renaming,setRenaming]=useState<number|null>(null),[menu,setMenu]=useState<{x:number;y:number;index:number}|null>(null);
  const channels=state.channels,alphas=channels?.alpha??[],alpha=targetAlpha(state);
  const target=channels?.target??{kind:"composite"};
  const choose=(channel:string|number)=>{targetChanged();run("channel.target",{channel});};
  const rowMenu=(index:number):MenuEntry[]=>[
    {label:"Duplicate Channel…",disabled:busy,run:()=>run("channel.duplicate",{channel:index})},
    {label:"Delete Channel",disabled:busy,run:()=>run("channel.delete",{channel:index})},
    ...(alphas.find(channel=>channel.index===index)?.spot?[{label:"Merge Spot Channel",disabled:busy,run:()=>run("channel.mergeSpot",{channel:index})}]:[]),
    "-",
    {label:"Channel Options…",disabled:busy,run:()=>options(index)},
  ];
  // channel.move removes the channel and reinserts it at `to`, so a drop below the dragged row's old slot shifts up by one.
  const destination=(from:number,index:number,position:string)=>{const slot=position==="above"?index:index+1;return from<slot?slot-1:slot;};
  const drag=(event:PointerEvent<HTMLElement>,from:number)=>{
    if(busy)return;
    startRowDrag(event,{scope:".xd-photo-channels",ghost:event.currentTarget.closest<HTMLElement>(".xd-photo-channel-row")!,
      position:(target,clientY)=>{const bounds=target.getBoundingClientRect(),position=clientY<bounds.top+bounds.height/2?"above":"below";return destination(from,Number(target.dataset.channel),position)===from?null:position;},
      drop:(target,position)=>{const to=destination(from,Number(target.dataset.channel),position);if(to!==from&&!controlsLocked(usePhotoWorkspace.getState()))run("channel.move",{channel:from,to});}});
  };
  // Alpha channels are addressed by index; color channels by name and the composite by "composite".
  const row=(name:string,channel:string|number,visible:boolean,selected:boolean,thumb?:string,ref:ChannelRef=channel)=>{
    const saved=typeof channel==="number",slot=channelSlots(state).find(item=>item.channel===channel)?.slot;
    return <div className={`xd-photo-channel-row${selected?" selected":""}`} key={String(channel)} {...(saved?{"data-drop-target":"","data-channel":channel}:{})} onContextMenu={saved?event=>{event.preventDefault();if(!busy)setMenu({x:event.clientX,y:event.clientY,index:channel});}:undefined}>
      <button disabled={busy} aria-label={`${visible?"Hide":"Show"} ${name} channel`} aria-pressed={visible} onClick={()=>run("channel.setVisible",{channel,visible:!visible})}>{visible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
      {thumb&&<img className="xd-photo-layer-thumb" src={thumb} alt=""/>}
      {saved&&renaming===channel?<input autoFocus className="xd-photo-channel-rename" aria-label={`Name of ${name} channel`} defaultValue={name}
        onKeyDown={event=>{if(event.key==="Escape")event.currentTarget.value=name;if(event.key==="Enter"||event.key==="Escape")event.currentTarget.blur();}}
        onBlur={event=>{const next=event.target.value.trim();setRenaming(null);if(next&&next!==name)run("channel.rename",{channel,name:next});}}/>:
      <button disabled={busy} aria-label={`Edit ${name} channel`} aria-pressed={selected} className="xd-photo-channel-name" title={saved?"Double-click to rename · Command-click to load as a selection · Drag to reorder":"Command-click to load as a selection"}
        onPointerDown={saved?event=>drag(event,channel):undefined} onDragStart={event=>event.preventDefault()}
        onClick={event=>{if(event.metaKey||event.ctrlKey)run("select.loadSelection",{channel:ref,...loadOperation(event)==="new"?{}:{operation:loadOperation(event)}});else choose(channel);}} onDoubleClick={saved?()=>setRenaming(channel):undefined}>{name}</button>}
      {slot&&<span className="xd-photo-channel-key">{`⌘${slot}`}</span>}
    </div>;
  };
  return <>
    <div className="xd-photo-layer-list"><div className="xd-photo-channels">
      {row(channels?.composite??state.mode,"composite",channels?.compositeVisible??true,target.kind==="composite"&&!state.layerMaskView,png(thumbs?.composite))}
      {(channels?.colors??[]).map((channel,index)=>row(channel.name,channel.name,channel.visible,target.kind==="color"&&target.index===index,png(thumbs?.colors[index]),{color:index}))}
      {alphas.map((channel,index)=>row(channel.name,channel.index,!!channel.visible,target.kind==="alpha"&&target.index===channel.index,png(thumbs?.alpha[index])))}
      {state.quickMask&&<div className="xd-photo-channel-row"><button disabled={busy} aria-label={`${channels?.quickMask?.visible?"Hide":"Show"} Quick Mask overlay`} onClick={()=>run("channel.setVisible",{channel:"quickMask",visible:!channels?.quickMask?.visible})}>{channels?.quickMask?.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button>{thumbs?.quickMask&&<img className="xd-photo-layer-thumb" src={png(thumbs.quickMask)} alt=""/>}<button disabled={busy} className="xd-photo-channel-name" onClick={()=>choose("composite")}>Quick Mask</button></div>}
      {state.layerMaskView&&<div className="xd-photo-channel-row selected"><SquareDashed size={13}/><span className="xd-photo-channel-name">Layer mask · {state.layerMaskView.mode==="gray"?"Grayscale":"Overlay"}</span><button disabled={busy} aria-label="Close layer mask view" onClick={()=>{targetChanged();run("view.layerMask",{layer:state.layerMaskView!.layer,mode:"off"});}}>Close</button></div>}
    </div></div>
    <div className="xd-photo-layer-actions xd-ps-layer-actions">
      <button aria-label="Load channel as selection" title="Load channel as selection" disabled={busy} onClick={()=>run("select.loadSelection",{channel:targetRef(state)})}><CircleDashed size={14}/></button>
      <button aria-label="Save selection as channel" title="Save selection as channel" disabled={busy||!state.hasSelection} onClick={()=>run("select.saveSelection",{})}><SquareDashed size={14}/></button>
      <button aria-label="Create new channel" title="Create new channel · Alt-click for options" disabled={busy} onClick={event=>{if(event.altKey)options(null);else run("channel.new",{});}}><Plus size={14}/></button>
      <button aria-label="Delete current channel" title="Delete current channel" disabled={busy||!alpha} onClick={()=>run("channel.delete",{channel:alpha!.index})}><Trash2 size={14}/></button>
    </div>
    {menu&&<ContextMenu x={menu.x} y={menu.y} label="Channel" close={()=>setMenu(null)} items={rowMenu(menu.index)}/>}
  </>;
}
