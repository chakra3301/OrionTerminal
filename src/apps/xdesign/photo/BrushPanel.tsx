import { PresetPreview } from "./PresetPreview";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Trash2 } from "lucide-react";
import { EffectSettings } from "./LayerEffects";
import { BrushTexturePattern, BrushTipGrid } from "./BrushSettingsPickers";
import { runPhotoCommand, usePhotoWorkspace, controlsLocked } from "./runtime";
import type { PhotoState } from "./types";

type Changed=(brush:Record<string,unknown>)=>void;
const attempt=(work:Promise<unknown>)=>{void work.catch(()=>{});};
const brushRun=(changed:Changed)=>async(command:string,params:Record<string,unknown>={})=>{await runPhotoCommand(command,params);const settings=usePhotoWorkspace.getState().state?.brush?.settings;if(settings&&(command==="tools.setBrush"||command==="brush.presets.importAbr"&&params.select===true))changed(settings);};

/** Window › Brushes: the presets. Their tip, dynamics and other options are the Brush Settings panel's, as in Photoshop. */
export function BrushPanel({state,changed}:{state:PhotoState;changed:Changed}) {
  const busy=usePhotoWorkspace(controlsLocked),[search,setSearch]=useState(""),[name,setName]=useState("Custom brush");
  const brush=state.brush;
  if(!brush)return null;
  const run=brushRun(changed);
  const presets=brush.presets.filter(preset=>`${preset.name} ${preset.group}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="xd-photo-brush-panel"><input className="xd-photo-brush-search" aria-label="Search brush presets" placeholder="Search brushes" value={search} onChange={event=>setSearch(event.target.value)}/><div className="xd-photo-brush-presets">{presets.map(preset=><div key={preset.name}><button className="xd-photo-preset-button" disabled={busy} title={`${preset.group} · ${Math.round(preset.size)} px`} aria-label={`Use brush ${preset.name}`} onClick={()=>attempt(run("tools.setBrush",{preset:preset.name}))}><PresetPreview kind="brush" preset={preset.name} revision={brush.revision}/><span>{preset.name}</span><small>{preset.group} · {Math.round(preset.size)} px</small></button>{!preset.builtin&&<button disabled={busy} aria-label={`Delete brush ${preset.name}`} onClick={()=>attempt(run("brush.presets.delete",{name:preset.name}))}><Trash2 size={12}/></button>}</div>)}</div><div className="xd-photo-brush-save"><input aria-label="Brush preset name" maxLength={255} value={name} onChange={event=>setName(event.target.value)}/><button disabled={busy||!name.trim()} onClick={()=>attempt(run("brush.presets.save",{name:name.trim()}))}>Save preset</button></div><button disabled={busy} onClick={()=>attempt((async()=>{const path=await open({multiple:false,filters:[{name:"Photoshop brushes",extensions:["abr"]}]});if(typeof path==="string")await run("brush.presets.importAbr",{path,select:true});})())}>Import .abr brushes</button>
  </div>;
}

/** Window › Brush Settings (F5). */
export function BrushSettingsPanel({state,changed}:{state:PhotoState;changed:Changed}) {
  const busy=usePhotoWorkspace(controlsLocked),brush=state.brush;
  if(!brush)return null;
  const run=brushRun(changed);
  const patch=(path:string[],value:unknown)=>{let result:unknown=value;for(const key of [...path].reverse())result={[key]:result};attempt(run("tools.setBrush",result as Record<string,unknown>));};
  const settings=Object.fromEntries(Object.entries(brush.settings).filter(([key])=>!["tip","color","background","erase","seed"].includes(key)));
  if(settings.texture&&typeof settings.texture==="object")settings.texture=Object.fromEntries(Object.entries(settings.texture).filter(([key])=>key!=="patternId"&&(key!=="pattern"||!brush.sampledTexture)));
  if(settings.dualBrush&&typeof settings.dualBrush==="object")settings.dualBrush=Object.fromEntries(Object.entries(settings.dualBrush).filter(([key])=>key!=="tip"));
  return <div className="xd-photo-brush-panel">
    {brush.sampledTip&&<p className="xd-photo-section-help">Sampled tip retained. Size, spacing and dynamics remain editable.</p>}{brush.sampledTexture&&<p className="xd-photo-section-help">Imported texture retained.</p>}
    <BrushTipGrid label="Brush Tip Shape" target="tip" brush={brush} disabled={busy} run={run}/>
    {(brush.settings.dualBrush as {enabled?:unknown}|undefined)?.enabled===true&&<BrushTipGrid label="Dual Brush tip" target="dualBrush" brush={brush} disabled={busy} run={run}/>}
    {(brush.settings.texture as {enabled?:unknown}|undefined)?.enabled===true&&<BrushTexturePattern state={state} disabled={busy} run={run}/>}
    <EffectSettings value={settings} commit={patch} disabled={busy} effectType="BrushSettings"/>
  </div>;
}
