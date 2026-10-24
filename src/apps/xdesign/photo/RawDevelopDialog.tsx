import { useRef, useState } from "react";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import type { RawDevelopOptions } from "./runtime";

export function RawDevelopDialog({path,close,develop}:{path:string;close:()=>void;develop:(path:string,options:RawDevelopOptions)=>Promise<void>}) {
  const [opening]=useState({exposure:"0",orient:true}),[exposure,setExposure]=useState(opening.exposure),[orient,setOrient]=useState(opening.orient),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const submitting=useRef(false);
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  return <PhotoDialog dialog={dialog} title="Camera Raw" label="Develop camera RAW" busy={busy} close={close} reset={()=>{setExposure(opening.exposure);setOrient(opening.orient);setError("");}} onSubmit={event=>{event.preventDefault();if(submitting.current)return;const value=Number(exposure);if(!exposure.trim()||!Number.isFinite(value)||value < -5||value > 5){setError("Exposure must be between -5 and 5 EV.");return;}submitting.current=true;setBusy(true);setError("");void develop(path,{exposure:value,orient}).then(close).catch(reason=>{submitting.current=false;setError(String(reason));setBusy(false);});}}>
    <div className="xd-ps-dialog-grid"><label className="xd-ps-dialog-field"><span>Exposure:</span><input aria-label="RAW exposure" type="number" min={-5} max={5} step={0.1} value={exposure} disabled={busy} onChange={event=>setExposure(event.target.value)}/><span className="xd-ps-dialog-unit">EV</span></label>
    <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input aria-label="Apply camera orientation" type="checkbox" checked={orient} disabled={busy} onChange={event=>setOrient(event.target.checked)}/>Apply Camera Orientation</label></div></div>
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}
