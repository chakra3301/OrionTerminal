import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useDesignDialog } from "../useDesignDialog";
import { useXDProjects } from "../projectsStore";
import { PROFILES, profileInfo } from "./ColorProfileDialog";
import { cancelColorImport, resolveColorImport, usePhotoWorkspace } from "./runtime";
import type { PhotoColorDecision } from "./types";
import { PhotoDialog } from "./photoDialog";

type Choice=PhotoColorDecision["choices"][number];
const LABELS:Record<Choice,string>={preserve:"Preserve the image's current profile",convert:"Convert to the working space",discard:"Discard the embedded profile",assignWorking:"Assign the working profile",assignProfile:"Assign another profile"};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function ColorImportDialog(){
  const decision=usePhotoWorkspace(s=>s.colorDecision);
  return decision?<ImportChoice key={decision.token} decision={decision}/>:null;
}
function ImportChoice({decision}:{decision:PhotoColorDecision}){
  const initial:Choice=decision.report.missing?decision.report.policy==="off"?"preserve":"assignWorking":decision.report.policy==="convert"?"convert":decision.report.policy==="off"?"discard":"preserve";
  const [choice,setChoice]=useState<Choice>(initial),[profile,setProfile]=useState("srgb"),[custom,setCustom]=useState<{path:string;data:string;description:string}|null>(null),[convert,setConvert]=useState(false),[processing,setProcessing]=useState(false),[error,setError]=useState("");
  const nativeBusy=usePhotoWorkspace(s=>s.colorDecisionBusy),nativeError=usePhotoWorkspace(s=>s.colorDecisionError),activeId=useXDProjects(s=>s.activeId);
  const mounted=useRef(true),pending=useRef(false),blocked=processing||nativeBusy;
  const space=decision.report.mode==="Cmyk"?"Cmyk":decision.report.mode==="Grayscale"?"Gray":"Rgb";
  const available=PROFILES.filter(([,,model])=>model===space);
  const selected=available.some(([id])=>id===profile)?profile:available[0]![0]!;
  const current=()=>mounted.current&&usePhotoWorkspace.getState().colorDecision?.token===decision.token&&useXDProjects.getState().activeId===decision.projectId;
  const close=()=>{if(!pending.current&&!usePhotoWorkspace.getState().colorDecisionBusy)void resolveColorImport({action:"cancel"});};
  const dialog=useDesignDialog<HTMLFormElement>(close,blocked);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(activeId!==decision.projectId)cancelColorImport();},[activeId,decision.projectId]);
  const choose=async()=>{
    if(pending.current||nativeBusy||!current())return;pending.current=true;setProcessing(true);setError("");
    try{
      const path=await open({multiple:false,filters:[{name:"ICC color profile",extensions:["icc","icm"]}]});if(typeof path!=="string"||!current())return;
      // The import owns the activity lease until this dialog completes.
      const reply=object(await invoke("xdesign_photo_color_settings",{action:"profileInfo",params:{profile:path,includeData:true}}));if(!current())return;
      const info=profileInfo(reply.profile);
      if(!info||reply.profileSource!==path||typeof reply.profileData!=="string"||!reply.profileData.length||reply.profileData.length>22_369_624||typeof info.description!=="string"||info.description.length>4096)throw new Error("The native profile import returned invalid data.");
      if(info.colorSpace!==space)throw new Error(`This image needs a ${space} profile.`);
      setCustom({path,data:reply.profileData,description:info.description});setProfile("custom");
    }catch(error){if(current())setError(String(error));}finally{pending.current=false;if(mounted.current)setProcessing(false);}
  };
  const title=decision.report.missing?"Missing Color Profile":"Color Profile Mismatch";
  return <PhotoDialog dialog={dialog} title={title} noValidate busy={blocked} close={close} onSubmit={event=>{
    event.preventDefault();if(blocked||pending.current||!current())return;
    const params:Record<string,unknown>={action:choice};
    if(choice==="assignProfile"){
      if(profile==="custom"){if(!custom){setError("Choose an ICC profile.");return;}Object.assign(params,{profile:custom.path,profileData:custom.data});}else params.profile=selected;
      params.convertToWorking=convert;
    }
    void resolveColorImport(params);
  }}>
    <p className="xd-ps-dialog-readout">{decision.report.name} · {decision.report.mode} · {decision.report.depth}-bit</p>
    <p className="xd-ps-dialog-readout">{decision.report.missing?"This image has no compatible embedded color profile.":`Embedded profile: ${decision.report.embedded}`}</p><p className="xd-ps-dialog-readout">Working space: {decision.report.working}</p>
    <fieldset className="xd-ps-dialog-group"><legend>How should this image open?</legend>{decision.choices.map(action=><label className="xd-ps-dialog-check" key={action}><input type="radio" name="import-color-action" aria-label={LABELS[action]} value={action} checked={choice===action} disabled={blocked} onChange={()=>{setChoice(action);setError("");}}/>{LABELS[action]}</label>)}</fieldset>
    {choice==="assignProfile"&&<><div className="xd-ps-dialog-grid"><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Profile:</span><select aria-label="Import color profile" value={profile==="custom"?"custom":selected} disabled={blocked} onChange={event=>setProfile(event.target.value)}>{available.map(([id,label])=><option key={id} value={id}>{label}</option>)}{custom&&<option value="custom">{custom.description}</option>}</select></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Convert assigned profile to working space" checked={convert} disabled={blocked} onChange={event=>setConvert(event.target.checked)}/>Then Convert to Working Space</label></div></div>
      <button type="button" disabled={blocked} onClick={()=>void choose()}>Choose ICC profile…</button>{custom&&profile==="custom"&&<p className="xd-ps-dialog-readout">{custom.path.split(/[\\/]/).at(-1)} · {custom.description}</p>}</>}
    {(error||nativeError)&&<p role="alert">{error||nativeError}</p>}
  </PhotoDialog>;
}
