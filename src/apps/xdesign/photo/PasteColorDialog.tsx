import { useEffect, useState } from "react";
import { useXDProjects } from "../projectsStore";
import { useDesignDialog } from "../useDesignDialog";
import { cancelPasteColor,resolvePasteColor,usePhotoWorkspace } from "./runtime";
import type { PhotoPasteDecision } from "./types";
import { PhotoDialog } from "./photoDialog";
export function PasteColorDialog(){const decision=usePhotoWorkspace(state=>state.pasteDecision);return decision?<PasteChoice key={decision.token} decision={decision}/>:null;}
function PasteChoice({decision}:{decision:PhotoPasteDecision}){
  const [choice,setChoice]=useState<"convert"|"numbers">(decision.report.policy==="off"&&decision.report.canKeepNumbers?"numbers":"convert");
  const busy=usePhotoWorkspace(state=>state.pasteDecisionBusy),error=usePhotoWorkspace(state=>state.pasteDecisionError),active=useXDProjects(state=>state.activeId);
  const close=()=>void resolvePasteColor("cancel"),dialog=useDesignDialog<HTMLFormElement>(close,busy);
  useEffect(()=>{if(active!==decision.projectId)cancelPasteColor();},[active,decision.projectId]);
  return <PhotoDialog dialog={dialog} title="Paste Color Profile Mismatch" noValidate busy={busy} close={close} onSubmit={event=>{event.preventDefault();if(!busy)void resolvePasteColor(choice);}}>
    <p className="xd-ps-dialog-readout">Copied from {decision.report.sourceName}</p><p className="xd-ps-dialog-readout">Copied profile: {decision.report.sourceProfile} · {decision.report.sourceMode}</p><p className="xd-ps-dialog-readout">Target profile: {decision.report.targetProfile} · {decision.report.targetMode}</p>
    <fieldset className="xd-ps-dialog-group"><legend>How should these pixels be pasted?</legend><label className="xd-ps-dialog-check"><input type="radio" name="paste-color-action" aria-label="Convert clipboard colors to target profile" checked={choice==="convert"} disabled={busy} onChange={()=>setChoice("convert")}/>Convert colors to the target profile</label>{decision.report.canKeepNumbers&&<label className="xd-ps-dialog-check"><input type="radio" name="paste-color-action" aria-label="Keep copied channel values" checked={choice==="numbers"} disabled={busy} onChange={()=>setChoice("numbers")}/>Keep copied channel values</label>}</fieldset>
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}
