import { useState } from "react";
import { usePhotoWorkspace } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";

/** Photoshop's Duplicate Layer dialog. `name` is the copy's starting name, or null for several layers, which Photoshop duplicates without asking for one and so shows with As disabled. The engine can only duplicate into the open document, so Destination offers that alone. */
export function DuplicateLayerDialog({title,source,name,document,create,close}:{title:string;source:string;name:string|null;document:string;create:(name:string|null)=>Promise<unknown>;close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error);
  const [entry,setEntry]=useState(name??"");
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  const valid=name===null||entry.trim()!=="";
  return <PhotoDialog dialog={dialog} title={title} busy={busy} okDisabled={!valid} close={close} onSubmit={event=>{event.preventDefault();if(valid)void create(name===null?null:entry).then(close).catch(()=>{});}}>
    <div className="xd-ps-dialog-grid">
      <span className="xd-ps-dialog-label">Duplicate:</span><span>{source}</span>
      <label className="xd-ps-dialog-field"><span>As:</span><input aria-label="As" value={entry} disabled={name===null} onFocus={event=>event.target.select()} onChange={event=>setEntry(event.target.value)}/></label>
    </div>
    <fieldset className="xd-ps-dialog-group"><legend>Destination</legend><div className="xd-ps-dialog-grid">
      <label className="xd-ps-dialog-field"><span>Document:</span><select aria-label="Document" defaultValue={document}><option value={document}>{document}</option></select></label>
      <label className="xd-ps-dialog-field"><span>Artboard:</span><select aria-label="Artboard" disabled><option>Canvas</option></select></label>
      <label className="xd-ps-dialog-field"><span>Name:</span><input aria-label="Name" disabled/></label>
    </div></fieldset>
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}
