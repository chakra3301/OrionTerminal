import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { PhotoDocument, PhotoLayer } from "./types";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import { useDesignDialog } from "../useDesignDialog";
import { CurveEditor } from "./PhotoActionDialog";
import { PhotoDialog } from "./photoDialog";

type Field=[string,string,number,number,number?];
const GROUPS:Array<{name:string;fields:Field[]}>=[
  {name:"Light & color",fields:[["temperature","Temperature",-100,100],["tint","Tint",-100,100],["exposure","Exposure",-5,5,.1],["contrast","Contrast",-100,100],["highlights","Highlights",-100,100],["shadows","Shadows",-100,100],["whites","Whites",-100,100],["blacks","Blacks",-100,100],["texture","Texture",-100,100],["clarity","Clarity",-100,100],["dehaze","Dehaze",-100,100],["vibrance","Vibrance",-100,100],["saturation","Saturation",-100,100]]},
  {name:"Parametric curve",fields:[["curveHighlights","Highlights",-100,100],["curveLights","Lights",-100,100],["curveDarks","Darks",-100,100],["curveShadows","Shadows",-100,100]]},
  {name:"Detail",fields:[["sharpenAmount","Sharpening",0,150],["sharpenRadius","Radius",.5,3,.1],["sharpenDetail","Detail",0,100],["sharpenMasking","Masking",0,100],["noiseLuminance","Luminance noise",0,100],["noiseLuminanceDetail","Luminance detail",0,100],["noiseColor","Color noise",0,100],["noiseColorDetail","Color detail",0,100]]},
  {name:"Effects",fields:[["grainAmount","Grain",0,100],["grainSize","Grain size",0,100],["grainRoughness","Grain roughness",0,100],["vignetteAmount","Vignette",-100,100],["vignetteMidpoint","Midpoint",0,100],["vignetteRoundness","Roundness",-100,100],["vignetteFeather","Feather",0,100],["vignetteHighlights","Highlight protection",0,100],["gradeBlending","Grading blend",0,100],["gradeBalance","Grading balance",-100,100]]},
];
const DEFAULTS:Record<string,number>={sharpenRadius:1,sharpenDetail:25,noiseLuminanceDetail:50,noiseColorDetail:50,grainSize:25,grainRoughness:50,vignetteMidpoint:50,vignetteFeather:50,gradeBlending:50};
const COLORS=["Red","Orange","Yellow","Green","Aqua","Blue","Purple","Magenta"];
export type DevelopFilterEdit={index:number;command:string;params:Record<string,unknown>};
type ScalarDraft={id:symbol;finish:()=>void;discard:()=>void};
function DevelopScalar({name,label,value,min,max,step,scope,disabled,drafts,commit}:{name:string;label:string;value:number;min:number;max:number;step:number;scope:string;disabled:boolean;drafts:{current:ScalarDraft|null};commit:(value:number)=>void}) {
  const [draft,setDraft]=useState(String(value)),text=useRef(draft),dirty=useRef(false),captured=useRef<string|null>(null),id=useRef(Symbol()).current,latest=useRef({value,min,max,scope,disabled,commit});
  latest.current={value,min,max,scope,disabled,commit};
  const discard=()=>{text.current=String(latest.current.value);setDraft(text.current);dirty.current=false;captured.current=null;if(drafts.current?.id===id)drafts.current=null;};
  const finish=()=>{
    const current=latest.current,next=text.current.trim()===""?NaN:Number(text.current),changed=dirty.current,valid=changed&&!current.disabled&&captured.current===current.scope&&Number.isFinite(next)&&Number.isFinite(Math.fround(next))&&next>=current.min&&next<=current.max;
    discard();if(valid&&next!==current.value){text.current=String(next);setDraft(text.current);current.commit(next);}
  };
  useEffect(()=>{discard();return ()=>{if(drafts.current?.id===id)drafts.current=null;};},[value,scope,disabled]);
  const capture=()=>{captured.current=latest.current.scope;drafts.current={id,finish,discard};};
  // Camera Raw applies arrow-key nudges at once; typed text still waits for Enter or blur.
  const nudge=(delta:number)=>{
    const current=latest.current,typed=text.current.trim()===""?NaN:Number(text.current);if(current.disabled)return;
    const next=Math.max(current.min,Math.min(current.max,Number(((dirty.current&&Number.isFinite(typed)?typed:current.value)+delta).toFixed(10))));
    discard();if(next!==current.value){text.current=String(next);setDraft(text.current);current.commit(next);}
  };
  // Slider detents stay valid without quantizing the number field or its committed setting.
  const sliderValue=Math.max(min,Math.min(max,Number((min+Math.round((value-min)/step)*step).toFixed(10))));
  return <label className="xd-ps-dialog-field"><span>{label}:</span><input aria-label={`Develop ${name}`} type="number" required min={min} max={max} step="any" disabled={disabled} value={draft} onFocus={()=>{dirty.current=false;capture();}} onChange={event=>{if(latest.current.disabled)return;if(captured.current===null)capture();text.current=event.target.value;dirty.current=true;setDraft(text.current);drafts.current={id,finish,discard};}} onBlur={event=>{if((event.relatedTarget as HTMLElement|null)?.dataset.developDiscard)discard();else finish();}} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();finish();event.currentTarget.blur();}else if(event.key==="ArrowUp"||event.key==="ArrowDown"){event.preventDefault();nudge((event.key==="ArrowUp"?1:-1)*step*(event.shiftKey?10:1));}}}/><input aria-label={`Develop ${name} slider`} type="range" min={min} max={max} step={step} disabled={disabled} value={sliderValue} onChange={event=>{const current=latest.current,next=event.target.valueAsNumber;discard();if(!current.disabled&&Number.isFinite(next)&&Number.isFinite(Math.fround(next))&&next>=current.min&&next<=current.max&&next!==current.value)current.commit(next);}}/></label>;
}
function RegionBoundary({index,label,value,min,max,disabled,commit}:{index:number;label:string;value:number;min:number;max:number;disabled:boolean;commit:(value:number)=>void}) {
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>setDraft(String(value)),[value,disabled]);
  const finish=(text:string)=>{
    const parsed=text.trim()===""?NaN:Number(text);
    if(disabled||!Number.isFinite(parsed)){setDraft(String(value));return;}
    const next=Math.max(min,Math.min(max,Math.round(parsed)));setDraft(String(next));commit(next);
  };
  return <label className="xd-ps-dialog-field"><span>{label}:</span><input aria-label={`Develop curveSplit${index}`} type="number" min={min} max={max} step="1" disabled={disabled} value={draft} onChange={event=>{if(!disabled)setDraft(event.target.value);}} onBlur={event=>finish(event.currentTarget.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();finish(event.currentTarget.value);event.currentTarget.blur();}else if(event.key==="ArrowUp"||event.key==="ArrowDown"){event.preventDefault();const typed=draft.trim()===""?NaN:Number(draft);finish(String((Number.isFinite(typed)?typed:value)+(event.key==="ArrowUp"?1:-1)*(event.shiftKey?10:1)));}}}/><input aria-label={`Develop curveSplit${index} slider`} type="range" min={min} max={max} step="1" disabled={disabled} value={value} onChange={event=>commit(event.target.valueAsNumber)}/></label>;
}
export function DevelopDialog({document,layer,close,existing}:{document:PhotoDocument;layer:PhotoLayer;close:()=>void;existing?:DevelopFilterEdit}) {
  const busy=usePhotoWorkspace(state=>state.busy),projectId=usePhotoWorkspace(state=>state.projectId),workspaceError=usePhotoWorkspace(state=>state.error);
  const filter=existing?layer.smartFilters?.[existing.index]:undefined;
  const invalid=!!existing&&(!layer.smartObject||existing.command!=="filter.cameraRaw"||filter?.command!==existing.command||JSON.stringify(filter.params)!==JSON.stringify(existing.params));
  const sourceKey=JSON.stringify([projectId,document.id,document.version,layer.id,existing?[existing.index,existing.command,existing.params,filter?.command,filter?.params]:null]),initialSource=useRef(sourceKey),currentSource=useRef(sourceKey),submitting=useRef(false);
  currentSource.current=sourceKey;
  const [applying,setApplying]=useState(false),stale=initialSource.current!==sourceKey||invalid,locked=busy||applying||stale;
  useEffect(()=>{if(stale)close();},[stale,close]);
  const [opening]=useState<Record<string,unknown>>(()=>structuredClone(existing?.params??{}));
  const [values,setValues]=useState<Record<string,unknown>>(()=>structuredClone(opening)),[curveChannel,setCurveChannel]=useState("pointCurve"),[hsl,setHSL]=useState("hslHue"),[grade,setGrade]=useState("gradeShadows");
  const committed=useRef(values),focusedDraft=useRef<ScalarDraft|null>(null),lockedRef=useRef(locked),[draftEpoch,setDraftEpoch]=useState(0);lockedRef.current=locked;
  const [live,setLive]=useState(document.width*document.height<=16_777_216);
  const parameters=(settings:Record<string,unknown>)=>existing?{layer:layer.id,index:existing.index,params:settings}:{...settings,layer:layer.id};
  const command=existing?"layer.smartFilter.setParams":"filter.cameraRaw",params=parameters(values);
  const preview=usePhotoCommandPreview(document,projectId,command,params,{automatic:live,enabled:!locked}),dialog=useDesignDialog<HTMLFormElement>(close,locked);
  const replaceValues=(next:Record<string,unknown>)=>{if(lockedRef.current||currentSource.current!==initialSource.current)return;committed.current=next;setValues(next);};
  const change=(key:string,value:unknown)=>replaceValues({...committed.current,[key]:value});
  const finishDraft=()=>flushSync(()=>focusedDraft.current?.finish());
  const discardDraft=()=>{focusedDraft.current?.discard();focusedDraft.current=null;};
  const resetValues=(next:Record<string,unknown>)=>{discardDraft();replaceValues(next);setDraftEpoch(epoch=>epoch+1);};
  const storedCurve=values[curveChannel],curve=Array.isArray(storedCurve)&&storedCurve.length&&storedCurve.every(point=>Array.isArray(point)&&point.length===2&&point.every(value=>typeof value==="number"&&Number.isFinite(value)))?storedCurve as [number,number][]:[[0,0],[255,255]] as [number,number][];
  const storedSplits=values.curveSplits,splits=Array.isArray(storedSplits)&&storedSplits.length===3&&storedSplits.every(value=>typeof value==="number"&&Number.isFinite(value))?storedSplits as number[]:[25,50,75];
  const splitMin=(i:number)=>i===0?5:Math.ceil(splits[i-1]!+1),splitMax=(i:number)=>i===2?95:Math.floor(splits[i+1]!-1);
  const splitEditable=(storedSplits===undefined||storedSplits===splits)&&splits.every((value,i)=>value>=5&&value<=95&&(i===0||value-splits[i-1]!>=1)&&splitMin(i)<=splitMax(i));
  const changeSplit=(index:number,value:number)=>{
    if(locked||!splitEditable||!Number.isFinite(value))return;
    const previous=(committed.current.curveSplits as number[]|undefined)??[25,50,75];
    const next=Math.max(index===0?5:Math.ceil(previous[index-1]!+1),Math.min(index===2?95:Math.floor(previous[index+1]!-1),Math.round(value)));
    if(next!==previous[index])change("curveSplits",previous.map((split,i)=>i===index?next:split));
  };
  const changeGrading=(key:string,value:number)=>change(grade,{hue:0,sat:0,lum:0,...committed.current[grade] as Record<string,unknown>|undefined,[key]:value});
  const grading={hue:0,sat:0,lum:0,...values[grade] as {hue?:number;sat?:number;lum?:number}|undefined};
  const field=([key,label,min,max,step=1]:Field,value=Number(values[key]??DEFAULTS[key]??0),commit=(value:number)=>change(key,value),identity=key)=><DevelopScalar key={key} name={key} label={label} value={value} min={min} max={max} step={step} scope={JSON.stringify([sourceKey,identity,draftEpoch])} disabled={locked} drafts={focusedDraft} commit={commit}/>;
  const grid=(children:ReactNode)=><div className="xd-ps-dialog-grid has-sliders">{children}</div>;
  const choice=(label:string,aria:string,value:string,change:(value:string)=>void,options:Array<[string,string]>)=><label className="xd-ps-dialog-field"><span>{label}:</span><select aria-label={aria} disabled={locked} value={value} onChange={event=>change(event.target.value)}>{options.map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>;
  return <PhotoDialog dialog={dialog} title="Camera Raw Filter" label={existing?"Edit Camera Raw Filter":"Develop image"} className="xd-photo-special-dialog" noValidate={!!existing} busy={locked} close={()=>{discardDraft();close();}} reset={()=>resetValues(structuredClone(opening))} preview={{checked:live,disabled:locked||document.width*document.height>16_777_216,busy:live&&preview.loading,change:checked=>{if(lockedRef.current)return;finishDraft();if(lockedRef.current)return;setLive(checked);if(checked)void preview.preview();}}} onSubmit={event=>{event.preventDefault();if(lockedRef.current||submitting.current)return;finishDraft();if(lockedRef.current||currentSource.current!==initialSource.current)return;submitting.current=true;setApplying(true);void runPhotoCommand(command,parameters(committed.current)).then(()=>{if(currentSource.current===sourceKey)close();}).catch(()=>{submitting.current=false;setApplying(false);});}}>
    <div className="xd-photo-special-body"><div className="xd-photo-special-preview"><img src={live&&preview.url?preview.url:convertFileSrc(document.previewPath)} alt="Develop preview"/>{preview.error&&<p role="alert">{preview.error}</p>}</div>
      <div className="xd-photo-special-controls">{GROUPS.map((group,index)=><details key={group.name} open={index===0}><summary>{group.name}</summary>{grid(<>{group.fields.map(entry=>field(entry))}{group.name==="Parametric curve"&&<>{["Shadows / Darks (%)","Darks / Lights (%)","Lights / Highlights (%)"].map((label,i)=><RegionBoundary key={`${draftEpoch}/${i}`} index={i} label={label} value={splits[i]!} min={splitMin(i)} max={splitMax(i)} disabled={locked||!splitEditable} commit={value=>changeSplit(i,value)}/>)}</>}</>)}{group.name==="Parametric curve"&&<>{!splitEditable&&<p className="xd-photo-section-help">Stored boundaries are preserved. Reset them to edit this range.</p>}<button type="button" disabled={locked} data-develop-discard="true" onMouseDown={event=>event.preventDefault()} onClick={()=>{const next={...committed.current};if(existing)next.curveSplits=[25,50,75];else delete next.curveSplits;resetValues(next);}}>Reset region boundaries</button></>}</details>)}
        <details><summary>Point curves</summary><div className="xd-ps-dialog-grid">{choice("Channel","Develop curve channel",curveChannel,setCurveChannel,["pointCurve","pointCurveRed","pointCurveGreen","pointCurveBlue"].map((key,index)=>[key,["Composite","Red","Green","Blue"][index]!]))}</div><CurveEditor key={`${sourceKey}:${curveChannel}`} label="Develop point curve" points={curve} disabled={locked} maxPoints={16} change={points=>change(curveChannel,points)}/></details>
        <details><summary>Color mixer</summary>{grid(<>{choice("Control","Develop HSL control",hsl,setHSL,["hslHue","hslSat","hslLum"].map((key,index)=>[key,["Hue","Saturation","Luminance"][index]!]))}{COLORS.map((color,index)=>field([`${hsl}-${index}`,color,-100,100],(values[hsl] as number[]|undefined)?.[index]??0,value=>change(hsl,COLORS.map((_,i)=>i===index?value:(committed.current[hsl] as number[]|undefined)?.[i]??0))))}</>)}</details>
        <details><summary>Color grading</summary>{grid(<>{choice("Range","Develop grading range",grade,setGrade,["gradeShadows","gradeMidtones","gradeHighlights","gradeGlobal"].map((key,index)=>[key,["Shadows","Midtones","Highlights","Global"][index]!]))}{field(["hue","Hue",0,360],grading.hue,hue=>changeGrading("hue",hue),`${grade}.hue`)}{field(["sat","Saturation",0,100],grading.sat,sat=>changeGrading("sat",sat),`${grade}.sat`)}{field(["lum","Luminance",-100,100],grading.lum,lum=>changeGrading("lum",lum),`${grade}.lum`)}</>)}</details>
        <div className="xd-ps-dialog-grid">{choice("Vignette Style","Develop vignette style",String(values.vignetteStyle??"highlightPriority"),value=>change("vignetteStyle",value),["highlightPriority","colorPriority","paintOverlay"].map(value=>[value,value]))}</div>
      </div></div>{workspaceError&&<p role="alert">{workspaceError}</p>}
  </PhotoDialog>;
}
