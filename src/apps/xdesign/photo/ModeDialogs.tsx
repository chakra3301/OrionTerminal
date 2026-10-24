import { useEffect, useState } from "react";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";

function ModeDialog({title,children,apply,close,reset,okDisabled}:{title:string;children:React.ReactNode;apply:()=>Promise<unknown>;close:()=>void;reset:()=>void;okDisabled?:boolean}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error);
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  return <PhotoDialog dialog={dialog} title={title} busy={busy} okDisabled={okDisabled} close={close} reset={reset} onSubmit={e=>{e.preventDefault();void apply().then(close).catch(()=>{});}}>
    {children}{error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}

const DUOTONE_TYPES:[string,string,number][]=[["monotone","Monotone",1],["duotone","Duotone",2],["tritone","Tritone",3],["quadtone","Quadtone",4]];
const DEFAULT_INKS=[{name:"Black",color:"#000000"},{name:"Warm Brown",color:"#9e612e"},{name:"Gold",color:"#dbad2e"},{name:"Slate Blue",color:"#456194"}];
let lastDuotone:{type:string;inks:typeof DEFAULT_INKS}|null=null;

/** Image > Mode > Duotone…. The engine keeps each ink's tone curve but takes no curve edits from here, so a re-applied duotone starts from the engine's default curves. */
export function DuotoneDialog({close}:{close:()=>void}) {
  const [opening]=useState(()=>lastDuotone??{type:"duotone",inks:DEFAULT_INKS}),[type,setType]=useState(opening.type),[inks,setInks]=useState(opening.inks);
  const count=DUOTONE_TYPES.find(([id])=>id===type)![2];
  const edit=(index:number,patch:Partial<typeof DEFAULT_INKS[number]>)=>setInks(list=>list.map((ink,i)=>i===index?{...ink,...patch}:ink));
  const shown=inks.slice(0,count);
  return <ModeDialog title="Duotone Options" close={close} reset={()=>{setType(opening.type);setInks(opening.inks);}} okDisabled={shown.some(ink=>!ink.name.trim())}
    apply={()=>runPhotoCommand("image.mode.duotone",{type,inks:shown}).then(()=>{lastDuotone={type,inks};})}>
    <label className="xd-ps-dialog-field"><span>Type:</span><select aria-label="Type" value={type} onChange={e=>setType(e.target.value)}>{DUOTONE_TYPES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    <fieldset className="xd-ps-dialog-group"><legend>Inks</legend>{shown.map((ink,index)=>
      <div key={index} className="xd-ps-dialog-ink"><span>Ink {index+1}:</span>
        <input type="color" aria-label={`Ink ${index+1} color`} value={ink.color} onChange={e=>edit(index,{color:e.target.value})}/>
        <input aria-label={`Ink ${index+1} name`} maxLength={64} value={ink.name} onChange={e=>edit(index,{name:e.target.value})}/></div>)}</fieldset>
  </ModeDialog>;
}

const COLOR_TABLES:[string,string][]=[["custom","Custom"],["blackBody","Black Body"],["grayscale","Grayscale"],["spectrum","Spectrum"],["systemMac","Mac OS"],["systemWindows","Windows"],["web","Web"]];

/** Image > Mode > Color Table…. The grid shows the document's current table; a preset replaces it when OK is pressed, then the edited entries are applied on top. */
export function ColorTableDialog({close}:{close:()=>void}) {
  const [current,setCurrent]=useState<{colors:string[];transparent:number|null}|null>(null),[failure,setFailure]=useState("");
  const [table,setTable]=useState("custom"),[edits,setEdits]=useState<Record<number,string>>({}),[transparent,setTransparent]=useState<number|null>(null),[selected,setSelected]=useState(0);
  useEffect(()=>{let live=true;runPhotoCommand("image.mode.colorTable",{}).then(reply=>{
    const result=reply as {colors?:string[];transparent?:number|null}|undefined;
    if(!live)return;
    if(!result?.colors?.length)throw new Error("This image has no color table.");
    setCurrent({colors:result.colors,transparent:result.transparent??null});setTransparent(result.transparent??null);
  }).catch(error=>{if(live)setFailure(String(error));});return ()=>{live=false;};},[]);
  const colors=current?.colors.map((color,index)=>edits[index]??color)??[];
  const pick=(preset:string)=>{setTable(preset);setEdits({});};
  const reset=()=>{setTable("custom");setEdits({});setTransparent(current?.transparent??null);};
  return <ModeDialog title="Color Table" close={close} reset={reset} okDisabled={!current}
    apply={()=>runPhotoCommand("image.mode.colorTable",{table,...(Object.keys(edits).length?{entries:edits}:{}),transparent})}>
    <label className="xd-ps-dialog-field"><span>Table:</span><select aria-label="Table" value={table} onChange={e=>pick(e.target.value)}>{COLOR_TABLES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    {failure?<p role="alert">{failure}</p>:current&&<>
      <div className="xd-ps-swatches" role="group" aria-label="Colors">{colors.map((color,index)=>
        <button key={index} type="button" aria-pressed={selected===index} aria-label={`Color ${index}`} title={`${index}: ${color}`} style={{background:color}} onClick={()=>setSelected(index)}/>)}</div>
      <label className="xd-ps-dialog-field"><span>Color {selected}:</span><input type="color" aria-label="Selected color" value={colors[selected]??"#000000"} onChange={e=>setEdits(list=>({...list,[selected]:e.target.value}))}/></label>
      <label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Transparent" checked={transparent===selected} onChange={e=>setTransparent(e.target.checked?selected:transparent===selected?null:transparent)}/>Transparent</label>
    </>}
  </ModeDialog>;
}
