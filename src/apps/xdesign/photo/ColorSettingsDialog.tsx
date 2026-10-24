import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useDesignDialog } from "../useDesignDialog";
import { photoColorSettings } from "./runtime";
import { PROFILES, INTENTS, profileInfo } from "./ColorProfileDialog";
import type { PhotoColorSettings } from "./types";
import { PhotoDialog } from "./photoDialog";
const SLOTS = [["workingRgb", "RGB", "Rgb"], ["workingCmyk", "CMYK", "Cmyk"], ["workingGray", "Gray", "Gray"]] as const;
type Slot = typeof SLOTS[number][0];
const POLICIES = { workingRgb: "policyRgb", workingCmyk: "policyCmyk", workingGray: "policyGray" } as const;
type Check = "askOnMismatch" | "askOnPaste" | "askOnMissing";
type Custom = {path:string;data:string;description:string};
const object = (value:unknown):Record<string,unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
export function colorSettingsReply(value:unknown):PhotoColorSettings|null {
  const root=object(value),settings=object(root.settings),working=object(root.working);
  if(typeof root.revision!=="string"||!(/^[0-9a-f]{64}$/.test(root.revision)||root.revision==="default"))return null;
  for(const [slot,,space] of SLOTS){const profile=object(working[slot]);if(typeof settings[slot]!=="string"||settings[slot]!=="current"&&!PROFILES.some(([id,,model])=>id===settings[slot]&&model===space)||typeof profile.description!=="string"||profile.description.length>4096||profile.colorSpace!==space||typeof profile.custom!=="boolean"||profile.source!==null&&(typeof profile.source!=="string"||profile.source.length>4096))return null;}
  if(!["policyRgb","policyCmyk","policyGray"].every(name=>["preserve","convert","off"].includes(settings[name] as string))||!["askOnMismatch","askOnPaste","askOnMissing","bpc","dither"].every(name=>typeof settings[name]==="boolean")||!INTENTS.some(([id])=>id===settings.intent)||settings.monitorProfile!=="srgb"||typeof settings.blendTextGamma!=="number"||!Number.isFinite(settings.blendTextGamma))return null;
  return value as PhotoColorSettings;
}
export function ColorSettingsDialog({close}:{close:()=>void}) {
  const [source,setSource]=useState<PhotoColorSettings|null>(null),[values,setValues]=useState<PhotoColorSettings["settings"]|null>(null),[custom,setCustom]=useState<Partial<Record<Slot,Custom>>>({}),[processing,setProcessing]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const mounted=useRef(true),pending=useRef(false),dialog=useDesignDialog<HTMLFormElement>(close,processing);
  useEffect(()=>{mounted.current=true;void photoColorSettings("read").then(reply=>{if(!mounted.current)return;const parsed=colorSettingsReply(reply);if(!parsed)throw new Error("Native color settings are unavailable.");setSource(parsed);setValues({...parsed.settings});}).catch(error=>{if(mounted.current)setError(String(error));}).finally(()=>{if(mounted.current)setLoading(false);});return()=>{mounted.current=false;};},[]);
  const operation=async(work:()=>Promise<void>)=>{if(pending.current)return;pending.current=true;setProcessing(true);setError("");try{await work();}catch(error){if(mounted.current)setError(String(error));}finally{pending.current=false;if(mounted.current)setProcessing(false);}};
  const choose=(slot:Slot,space:string)=>operation(async()=>{
    const path=await open({multiple:false,filters:[{name:"ICC color profile",extensions:["icc","icm"]}]});if(typeof path!=="string"||!mounted.current)return;
    const result=object(await photoColorSettings("profileInfo",{profile:path,includeData:true}));if(!mounted.current)return;
    const profile=profileInfo(result.profile);
    if(!profile||result.profileSource!==path||typeof result.profileData!=="string"||!result.profileData.length||result.profileData.length>22_369_624||typeof profile.description!=="string"||profile.description.length>4096)throw new Error("The native working-profile import returned invalid data.");
    if(profile.colorSpace!==space)throw new Error(`Choose a ${space} working profile.`);
    setCustom(current=>({...current,[slot]:{path,data:result.profileData as string,description:profile.description as string}}));setValues(current=>current?{...current,[slot]:"custom"}:current);
  });
  const restoreDefaults=()=>void operation(async()=>{const result=await photoColorSettings("defaults");const parsed=colorSettingsReply(result);if(!parsed)throw new Error("Native color settings are unavailable.");if(mounted.current){setValues({...parsed.settings});setCustom({});}});
  return <PhotoDialog dialog={dialog} title="Color Settings" noValidate busy={processing} okDisabled={loading||!values} close={close} reset={()=>{if(!source)return;setValues({...source.settings});setCustom({});}} buttons={<button type="button" disabled={processing||!source} onClick={restoreDefaults}>Restore Defaults</button>} onSubmit={event=>{event.preventDefault();if(!values||!source||processing)return;void operation(async()=>{
    const params:Record<string,unknown>={...values,expectedRevision:source.revision};for(const [slot] of SLOTS){if(values[slot]==="custom"){const selected=custom[slot];if(!selected)throw new Error("Choose a working ICC profile.");params[slot]=selected.path;params[`${slot}Data`]=selected.data;}}
    const result=await photoColorSettings("update",params);if(!colorSettingsReply(result))throw new Error("The native settings response is unavailable.");if(mounted.current)close();
  });}}>
    {loading&&<p role="status">Loading color settings…</p>}
    {values&&source&&<>
      <fieldset className="xd-ps-dialog-group"><legend>Working Spaces</legend><div className="xd-ps-dialog-grid">
        {SLOTS.map(([slot,name,space])=><div key={slot} className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{name}:</span><select aria-label={`${name} working profile`} disabled={processing} value={values[slot]} onChange={event=>setValues({...values,[slot]:event.target.value})}><option value="current">Current · {source.working[slot].description}</option>{PROFILES.filter(([,,model])=>model===space).map(([id,label])=><option key={id} value={id}>{label}</option>)}{custom[slot]&&<option value="custom">{custom[slot]!.description}</option>}</select></label>
          <button type="button" disabled={processing} onClick={()=>void choose(slot,space)}>Choose {name} ICC profile…</button></div>)}
      </div></fieldset>
      <fieldset className="xd-ps-dialog-group"><legend>Color Management Policies</legend><div className="xd-ps-dialog-grid">
        {SLOTS.map(([slot,name])=>{const policy=POLICIES[slot];return <div key={policy} className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{name}:</span><select aria-label={`${name} color policy`} disabled={processing} value={values[policy]} onChange={event=>setValues({...values,[policy]:event.target.value})}><option value="off">Off</option><option value="preserve">Preserve Embedded Profiles</option><option value="convert">Convert to Working {name}</option></select></label></div>;})}
        {[["Profile Mismatches:",[["askOnMismatch","Ask When Opening"],["askOnPaste","Ask When Pasting"]]],["Missing Profiles:",[["askOnMissing","Ask When Opening"]]]].map(([heading,checks])=><div key={heading as string} className="xd-ps-dialog-row"><span className="xd-ps-dialog-label">{heading as string}</span><div className="xd-ps-dialog-checks is-inline">{(checks as [Check,string][]).map(([key,label])=><label key={key} className="xd-ps-dialog-check"><input type="checkbox" aria-label={`${(heading as string).replace(":","")} ${label}`} disabled={processing} checked={values[key]} onChange={event=>setValues({...values,[key]:event.target.checked})}/>{label}</label>)}</div></div>)}
      </div></fieldset>
      <fieldset className="xd-ps-dialog-group"><legend>Conversion Options</legend><div className="xd-ps-dialog-grid">
        <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Intent:</span><select aria-label="Color settings rendering intent" value={values.intent} disabled={processing} onChange={event=>setValues({...values,intent:event.target.value})}>{INTENTS.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label></div>
        {([["bpc","Use Black Point Compensation"],["dither","Use Dither (8-bit/channel images)"]] as const).map(([key,label])=><div key={key} className="xd-ps-dialog-row"><label className="xd-ps-dialog-check xd-ps-dialog-indent"><input type="checkbox" aria-label={label} disabled={processing} checked={values[key]} onChange={event=>setValues({...values,[key]:event.target.checked})}/>{label}</label></div>)}
      </div></fieldset>
    </>}
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}
