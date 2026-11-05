import { useState } from "react";
import { Field, FileDialog } from "./FileDialogs";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";

const NEW="new";
const COMBINE=[["add","Add to Channel"],["subtract","Subtract from Channel"],["intersect","Intersect with Channel"]] as const;

/** Select › Save Selection…. Other open photos are separate sessions, so the destination is the image being edited. */
export function SaveSelectionDialog({document,close}:{document:string;close:()=>void}) {
  const channels=usePhotoWorkspace(s=>s.state?.channels?.alpha);
  const alpha=(channels??[]).filter(channel=>!channel.spot);
  const [channel,setChannel]=useState(NEW),[name,setName]=useState(""),[operation,setOperation]=useState("new");
  const fresh=channel===NEW;
  const operations=[[fresh?"new":"replace",fresh?"New Channel":"Replace Channel"],...COMBINE];
  const params=fresh?{channel:"new",operation:"new",...(name.trim()?{name:name.trim()}:{})}:{channel:Number(channel),operation};
  return <FileDialog title="Save Selection" close={close} apply={()=>runPhotoCommand("select.saveSelection",params)}>
    <fieldset className="xd-ps-dialog-group"><legend>Destination</legend><div className="xd-ps-dialog-grid">
      <Field label="Document"><select aria-label="Document" defaultValue="current"><option value="current">{document}</option></select></Field>
      <Field label="Channel"><select aria-label="Channel" value={channel} onChange={e=>{setChannel(e.target.value);setOperation(e.target.value===NEW?"new":"replace");}}>
        <option value={NEW}>New</option>{alpha.map(entry=><option key={entry.index} value={entry.index}>{entry.name}</option>)}
      </select></Field>
      <Field label="Name"><input aria-label="Name" disabled={!fresh} value={fresh?name:""} onChange={e=>setName(e.target.value)}/></Field>
    </div></fieldset>
    <fieldset className="xd-ps-dialog-group"><legend>Operation</legend><div className="xd-ps-dialog-radios is-column">
      {operations.map(([value,label])=><label key={value} className="xd-ps-dialog-check"><input type="radio" name="save-selection-operation" aria-label={label} disabled={fresh&&value!=="new"} checked={operation===value} onChange={()=>setOperation(value!)}/>{label}</label>)}
    </div></fieldset>
  </FileDialog>;
}
