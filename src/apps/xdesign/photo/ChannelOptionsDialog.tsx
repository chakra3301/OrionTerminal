import { useState } from "react";
import { useDesignDialog } from "../useDesignDialog";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PhotoState } from "./types";
import { PhotoDialog } from "./photoDialog";

function colorHex(color?: number[]) {
  return color && color.length>=3 ? "#"+color.slice(0,3).map(value=>Math.round(Math.max(0,Math.min(1,value))*255).toString(16).padStart(2,"0")).join("") : "#ff0000";
}
export function ChannelOptionsDialog({state,channel,spot=false,close}:{state:PhotoState;channel:number|"quickMask"|null;spot?:boolean;close:()=>void}) {
  const current=channel==="quickMask"?state.channels?.quickMask:typeof channel==="number"?state.channels?.alpha.find(item=>item.index===channel):null;
  const ink=current&&"spot" in current?current.spot as {color:number[];solidity:number}|null:null;
  const [name,setName]=useState(current&&"name" in current?current.name:spot?"Spot color":"Alpha channel");
  const [kind,setKind]=useState(ink||spot?"spot":current?.indicates==="selectedAreas"?"selected":"masked");
  const [color,setColor]=useState(colorHex(ink?.color??current?.color)),[opacity,setOpacity]=useState(Math.round((current?.opacity??.5)*100)),[solidity,setSolidity]=useState(Math.round((ink?.solidity??0)*100));
  const [fill,setFill]=useState(state.hasSelection?"selection":"black"),[fromSelection,setFromSelection]=useState(true);
  const [opening]=useState(()=>({name,kind,color,opacity,solidity,fill,fromSelection}));
  const busy=usePhotoWorkspace(workspace=>workspace.busy),error=usePhotoWorkspace(workspace=>workspace.error);
  const dialog=useDesignDialog<HTMLFormElement>(close,busy),creating=channel===null;
  return <PhotoDialog dialog={dialog} title={creating?"New Channel":"Channel Options"} label={creating?"New image channel":"Channel options"} busy={busy} okDisabled={channel!=="quickMask"&&!name.trim()} close={close} reset={()=>{setName(opening.name);setKind(opening.kind);setColor(opening.color);setOpacity(opening.opacity);setSolidity(opening.solidity);setFill(opening.fill);setFromSelection(opening.fromSelection);}} onSubmit={event=>{
    event.preventDefault();
    const command=creating?(kind==="spot"?"channel.newSpot":"channel.new"):"channel.options";
    const params={...(creating?{}:{channel}),...(channel!=="quickMask"?{name:name.trim()}:{}),color,...(kind==="spot"?{solidity,...(creating?{fromSelection}:{}),...(!creating?{indicates:"spot"}:{})}:{opacity,indicates:kind,...(creating?{fill}:{})})};
    void runPhotoCommand(command,params).then(close).catch(()=>{});
  }}>
    <div className="xd-ps-dialog-grid">
      {channel!=="quickMask"&&<div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Name:</span><input aria-label="Channel name" required maxLength={255} disabled={busy} value={name} onChange={event=>setName(event.target.value)}/></label></div>}
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Color Indicates:</span><select aria-label="Channel color indicates" disabled={busy} value={kind} onChange={event=>setKind(event.target.value)}><option value="masked">Masked Areas</option><option value="selected">Selected Areas</option>{channel!=="quickMask"&&<option value="spot">Spot Color</option>}</select></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{kind==="spot"?"Ink Color:":"Overlay Color:"}</span><input aria-label="Channel overlay color" type="color" disabled={busy} value={color} onChange={event=>setColor(event.target.value)}/></label></div>
      <div className="xd-ps-dialog-row">{kind==="spot"?<label className="xd-ps-dialog-field"><span>Solidity:</span><input aria-label="Spot channel solidity" type="number" required min="0" max="100" disabled={busy} value={solidity} onChange={event=>setSolidity(event.target.valueAsNumber)}/><span className="xd-ps-dialog-unit">%</span></label>:<label className="xd-ps-dialog-field"><span>Opacity:</span><input aria-label="Channel overlay opacity" type="number" required min="0" max="100" disabled={busy} value={opacity} onChange={event=>setOpacity(event.target.valueAsNumber)}/><span className="xd-ps-dialog-unit">%</span></label>}</div>
      {creating&&<div className="xd-ps-dialog-row">{kind==="spot"?<label className="xd-ps-dialog-check"><input type="checkbox" checked={fromSelection} disabled={busy||!state.hasSelection} onChange={event=>setFromSelection(event.target.checked)}/>Use Current Selection</label>:<label className="xd-ps-dialog-field"><span>Fill:</span><select aria-label="New channel fill" disabled={busy} value={fill} onChange={event=>setFill(event.target.value)}><option value="black">Black</option><option value="white">White</option><option value="selection" disabled={!state.hasSelection}>Current Selection</option></select></label>}</div>}
    </div>
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}
