import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PhotoCommand } from "./types";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { ActionFields, photoFields } from "../ActionFields";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";

export function PhotoCommandBrowser({close}:{close:()=>void}) {
  const [commands,setCommands]=useState<PhotoCommand[]>([]);const [search,setSearch]=useState("");const [command,setCommand]=useState<PhotoCommand|null>(null);const [params,setParams]=useState("{}");const [error,setError]=useState<string|null>(null);
  const busy=usePhotoWorkspace(s=>s.busy);
  const canFade=usePhotoWorkspace(s=>s.state?.canFade===true);
  const ready=!!command&&(command.id!=="edit.fade"||canFade);
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  const workspaceError=usePhotoWorkspace(s=>s.error);
  const [result,setResult]=useState("");
  const [values,setValues]=useState<Record<string,unknown>>({});
  useEffect(()=>{let cancelled=false;invoke<{commands:PhotoCommand[]}>("xdesign_photo_catalog").then(reply=>{if(!cancelled)setCommands(reply.commands);}).catch(e=>{if(!cancelled)setError(String(e));});return()=>{cancelled=true;};},[]);
  const matches=commands.filter(c=>(c.hostDispatch||["layer.smartObjects.editContents","layer.smartObjects.saveContents"].includes(c.id))&&`${c.label} ${c.id} ${c.menu.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  return <PhotoDialog dialog={dialog} title="Image Actions" className="xd-photo-command-dialog" busy={busy} okDisabled={!ready} close={close} onSubmit={e=>{e.preventDefault();if(!command||busy||!ready)return;try{const extra=JSON.parse(params);if(!extra||Array.isArray(extra)||typeof extra!=="object")throw new Error("Enter a parameter object");const fields=Object.fromEntries(Object.entries(values).filter(([,value])=>value!==undefined));void runPhotoCommand(command.id,{...extra,...fields}).then(value=>{setError(null);setResult(value===undefined||value===null?"Applied":JSON.stringify(value,null,2));}).catch(e=>setError(String(e)));}catch(error){setError(String(error));}}}>
    <div className="xd-ps-dialog-grid">
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Search:</span><input autoFocus aria-label="Search image actions" placeholder="Search actions…" value={search} onChange={e=>setSearch(e.target.value)} disabled={busy}/></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Action:</span><select aria-label="Image action" value={command?.id??""} onChange={e=>{setCommand(commands.find(c=>c.id===e.target.value)??null);setParams("{}");setValues({});setError(null);setResult("");}} disabled={busy}><option value="">Choose an action</option>{matches.map(c=><option key={c.id} value={c.id}>{[...c.menu,c.label].join(" / ")}</option>)}</select></label></div>
    </div>
    {command&&<><ActionFields fields={photoFields(command.params)} values={values} disabled={busy} change={(key,value)=>setValues(previous=>({...previous,[key]:value}))}/><details><summary>Advanced parameters</summary><p className="xd-photo-command-help">{command.params}</p><label>Additional values<textarea aria-label="Image action values" value={params} onChange={e=>setParams(e.target.value)} spellCheck={false} disabled={busy}/></label></details></>}
    {(error||workspaceError)&&<p role="alert">{error??workspaceError}</p>}
    {result&&<pre role="status">{result}</pre>}
    {command?.id==="edit.fade"&&!canFade&&<p className="xd-photo-section-help">Apply Fade immediately after a filter, adjustment, or painting step.</p>}
  </PhotoDialog>;
}
