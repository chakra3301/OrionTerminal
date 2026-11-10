import { useEffect, useState, type ReactNode } from "react";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";

function EditDialog({title,children,apply,close,ok,okDisabled,cancel,buttons}:{title:string;children:ReactNode;apply:()=>Promise<unknown>;close:()=>void;ok?:string;okDisabled?:boolean;cancel?:boolean;buttons?:ReactNode}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error);
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  return <PhotoDialog dialog={dialog} title={title} busy={busy} ok={ok} okDisabled={okDisabled} cancel={cancel} close={close} buttons={buttons} onSubmit={e=>{e.preventDefault();void apply().then(close).catch(()=>{});}}>
    {children}{error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}

export type PurgeCommand="edit.purge.clipboard"|"edit.purge.histories"|"edit.purge.all";
export function PurgeDialog({command,close}:{command:PurgeCommand;close:()=>void}) {
  return <EditDialog title="Purge" close={close} apply={()=>runPhotoCommand(command,{})}><p>This cannot be undone. Continue?</p></EditDialog>;
}

const PRESET_TITLES={brushes:"Brush Name",patterns:"Pattern Name",customShapes:"Shape Name"} as const;
export type PresetKind=keyof typeof PRESET_TITLES;
export function PresetNameDialog({kind,name:initial,apply,close}:{kind:PresetKind;name:string;apply:(name:string)=>Promise<unknown>;close:()=>void}) {
  const [name,setName]=useState(initial);
  return <EditDialog title={PRESET_TITLES[kind]} close={close} okDisabled={!name.trim()} apply={()=>apply(name.trim())}>
    <label className="xd-ps-dialog-field"><span>Name:</span><input aria-label="Name" maxLength={255} value={name} onFocus={e=>e.target.select()} onChange={e=>setName(e.target.value)}/></label>
  </EditDialog>;
}

// Photoshop keeps the last search for the session.
let lastSearch={find:"",replace:"",allLayers:true,forward:true,caseSensitive:false,wholeWord:false};
export function FindReplaceTextDialog({close}:{close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy),[search,setSearch]=useState(lastSearch),[found,setFound]=useState(false),[status,setStatus]=useState("");
  const update=(patch:Partial<typeof lastSearch>)=>setSearch(current=>(lastSearch={...current,...patch}));
  const run=(action:"find"|"change"|"changeAll"|"changeFind")=>{void runPhotoCommand("edit.findAndReplaceText",{...search,action}).then(result=>{
    const reply=(result??{}) as {count?:number;found?:unknown};
    if(action==="changeAll"){setFound(false);setStatus(`${reply.count??0} replacement${reply.count===1?"":"s"} made.`);}
    else if(action==="change"){setFound(false);setStatus("");}
    else{setFound(!!reply.found);setStatus(reply.found?"":"No more matches.");}
  }).catch(()=>{});};
  const check=(key:"allLayers"|"forward"|"caseSensitive"|"wholeWord",label:string)=><label className="xd-ps-dialog-check"><input type="checkbox" aria-label={label} checked={search[key]} onChange={e=>update({[key]:e.target.checked})}/>{label}</label>;
  const blocked=busy||!search.find;
  return <EditDialog title="Find and Replace Text" ok="Done" cancel={false} close={close} apply={async()=>{}} buttons={<>
    <button type="button" disabled={blocked} onClick={()=>run("find")}>Find Next</button>
    <button type="button" disabled={blocked||!found} onClick={()=>run("change")}>Change</button>
    <button type="button" disabled={blocked} onClick={()=>run("changeAll")}>Change All</button>
    <button type="button" disabled={blocked} onClick={()=>run("changeFind")}>Change/Find</button>
  </>}>
    <label className="xd-ps-dialog-field"><span>Find What:</span><input aria-label="Find What" value={search.find} onChange={e=>{update({find:e.target.value});setFound(false);}}/></label>
    <label className="xd-ps-dialog-field"><span>Change To:</span><input aria-label="Change To" value={search.replace} onChange={e=>update({replace:e.target.value})}/></label>
    {check("allLayers","Search All Layers")}{check("forward","Forward")}{check("caseSensitive","Case Sensitive")}{check("wholeWord","Whole Word")}
    {status&&<p role="status">{status}</p>}
  </EditDialog>;
}

type Misspelling={layer:number;start:number;end:number;word:string;suggestions:string[]};
const spot=(layer:number,start:number)=>`${layer}:${start}`;
// Ignored occurrences are remembered by position, so edits earlier in the same layer move them.
const shifted=(skipped:string[],edits:{layer:number;start:number;delta:number}[])=>skipped.map(key=>{
  const [layer,start]=key.split(":").map(Number) as [number,number];
  return spot(layer,start+edits.filter(edit=>edit.layer===layer&&edit.start<start).reduce((sum,edit)=>sum+edit.delta,0));
});
export function CheckSpellingDialog({close}:{close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy);
  const [allLayers,setAllLayers]=useState(true),[ignore,setIgnore]=useState<string[]>([]),[skipped,setSkipped]=useState<string[]>([]),[list,setList]=useState<Misspelling[]|null>(null),[changeTo,setChangeTo]=useState("");
  const current=list?.find(item=>!skipped.includes(spot(item.layer,item.start)));
  const show=(items:Misspelling[],skip:string[])=>{const next=items.find(item=>!skip.includes(spot(item.layer,item.start)));setChangeTo(next?.suggestions[0]??next?.word??"");};
  const check=(next:{allLayers?:boolean;ignore?:string[];skipped?:string[]}={})=>{
    const skip=next.skipped??skipped;
    return runPhotoCommand("edit.checkSpelling",{allLayers:next.allLayers??allLayers,ignore:next.ignore??ignore}).then(result=>{
      const items=(result as {misspellings?:Misspelling[]}|undefined)?.misspellings??[];
      setList(items);setSkipped(skip);show(items,skip);
    });
  };
  useEffect(()=>{void check().catch(()=>{});},[]);
  const withWord=(work:(word:Misspelling)=>Promise<unknown>|void)=>{if(current)void Promise.resolve(work(current)).catch(()=>{});};
  const delta=(word:Misspelling)=>[...changeTo].length-(word.end-word.start);
  const disabled=busy||!current;
  return <EditDialog title="Check Spelling" ok="Done" cancel={false} close={close} apply={async()=>{}} buttons={<>
    <button type="button" disabled={disabled} onClick={()=>withWord(word=>{const skip=[...skipped,spot(word.layer,word.start)];setSkipped(skip);show(list??[],skip);})}>Ignore</button>
    <button type="button" disabled={disabled} onClick={()=>withWord(word=>{const ignored=[...ignore,word.word];setIgnore(ignored);return check({ignore:ignored});})}>Ignore All</button>
    <button type="button" disabled={disabled} onClick={()=>withWord(word=>runPhotoCommand("edit.checkSpelling",{action:"change",layer:word.layer,start:word.start,end:word.end,word:word.word,replace:changeTo})
      .then(()=>check({skipped:[...shifted(skipped,[{layer:word.layer,start:word.start,delta:delta(word)}]),spot(word.layer,word.start)]})))}>Change</button>
    <button type="button" disabled={disabled} onClick={()=>withWord(word=>runPhotoCommand("edit.checkSpelling",{action:"changeAll",word:word.word,replace:changeTo,allLayers})
      .then(()=>check({skipped:shifted(skipped,(list??[]).filter(item=>item.word===word.word).map(item=>({layer:item.layer,start:item.start,delta:delta(item)})))})))}>Change All</button>
    <button type="button" disabled={disabled} onClick={()=>withWord(word=>runPhotoCommand("edit.checkSpelling",{action:"addToDictionary",word:word.word}).then(()=>check()))}>Add</button>
  </>}>
    <label className="xd-ps-dialog-field"><span>Not in Dictionary:</span><input aria-label="Not in Dictionary" readOnly value={current?.word??""}/></label>
    <label className="xd-ps-dialog-field"><span>Change To:</span><input aria-label="Change To" disabled={!current} value={changeTo} onChange={e=>setChangeTo(e.target.value)}/></label>
    <label className="xd-ps-dialog-field"><span>Suggestions:</span><select aria-label="Suggestions" size={6} disabled={!current} value={current?.suggestions.includes(changeTo)?changeTo:""} onChange={e=>setChangeTo(e.target.value)}>
      {current?.suggestions.map(suggestion=><option key={suggestion} value={suggestion}>{suggestion}</option>)}
    </select></label>
    <p className="xd-ps-dialog-field"><span>Language:</span><span>English: USA</span></p>
    <label className="xd-ps-dialog-check"><input type="checkbox" checked={allLayers} onChange={e=>{setAllLayers(e.target.checked);void check({allLayers:e.target.checked,skipped:[]}).catch(()=>{});}}/>Check All Layers</label>
    {list&&!current&&<p role="status">Spell check complete.</p>}
  </EditDialog>;
}

const PRESET_TYPES:[PresetKind,string][]=[["brushes","Brushes"],["patterns","Patterns"],["customShapes","Custom Shapes"]];
export function PresetManagerDialog({close}:{close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy);
  const [kind,setKind]=useState<PresetKind>("brushes"),[names,setNames]=useState<string[]>([]),[selected,setSelected]=useState<number|null>(null),[renaming,setRenaming]=useState(false);
  const manage=(params:{kind:PresetKind}&Record<string,unknown>)=>runPhotoCommand("edit.presets.presetManager",params).then(result=>{
    const list=(result as Partial<Record<PresetKind,string[]>>|undefined)?.[params.kind];if(list)setNames(list);
  });
  useEffect(()=>{setSelected(null);void manage({kind}).catch(()=>{});},[kind]);
  const index=selected!==null&&selected<names.length?selected:null;
  return <>
    <EditDialog title="Preset Manager" ok="Done" cancel={false} close={close} apply={async()=>{}} buttons={<>
      <button type="button" disabled={busy||index===null} onClick={()=>setRenaming(true)}>Rename…</button>
      <button type="button" disabled={busy||index===null} onClick={()=>{void manage({action:"delete",kind,index}).then(()=>setSelected(null)).catch(()=>{});}}>Delete</button>
    </>}>
      <label className="xd-ps-dialog-field"><span>Preset Type:</span><select aria-label="Preset Type" value={kind} onChange={e=>setKind(e.target.value as PresetKind)}>{PRESET_TYPES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <select aria-label="Presets" size={12} value={index===null?"":String(index)} onChange={e=>setSelected(Number(e.target.value))}>{names.map((name,i)=><option key={i} value={i}>{name}</option>)}</select>
    </EditDialog>
    {renaming&&index!==null&&<PresetNameDialog kind={kind} name={names[index]??""} apply={newName=>manage({action:"rename",kind,index,newName})} close={()=>setRenaming(false)}/>}
  </>;
}

const PROJECTIONS:[string,string,string][]=[["auto","Auto","Determine the best projection automatically."],["perspective","Perspective","Only allow perspective image transform."],["collage","Collage","Allow image rotation, scale and translation."],
  ["cylindrical","Cylindrical","Only allow cylindrical image transform."],["spherical","Spherical","Only allow spherical image transform."],["reposition","Reposition","Only allow image translation."]];
let lastAlign={projection:"auto",geometricCorrection:false};
export function AutoAlignDialog({close}:{close:()=>void}) {
  const [values,setValues]=useState(lastAlign);
  return <EditDialog title="Auto-Align Layers" close={close} apply={()=>runPhotoCommand("edit.autoAlignLayers",values).then(()=>{lastAlign=values;})}>
    <fieldset className="xd-ps-dialog-group"><legend>Projection</legend><div role="radiogroup" aria-label="Projection" className="xd-ps-dialog-radios is-grid">{PROJECTIONS.map(([id,label])=>
      <label key={id} className="xd-ps-dialog-check"><input type="radio" name="edit.autoAlignLayers.projection" value={id} checked={values.projection===id} onChange={()=>setValues({...values,projection:id})}/>{label}</label>)}</div>
      <p className="xd-ps-dialog-readout">{PROJECTIONS.find(([id])=>id===values.projection)?.[2]}</p></fieldset>
    <fieldset className="xd-ps-dialog-group"><legend>Lens Correction</legend><label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Geometric Distortion" checked={values.geometricCorrection} onChange={e=>setValues({...values,geometricCorrection:e.target.checked})}/>Geometric Distortion</label></fieldset>
  </EditDialog>;
}

let lastBlend={method:"panorama",seamlessTones:true};
export function AutoBlendDialog({close}:{close:()=>void}) {
  const [values,setValues]=useState(lastBlend);
  return <EditDialog title="Auto-Blend Layers" close={close} apply={()=>runPhotoCommand("edit.autoBlendLayers",values).then(()=>{lastBlend=values;})}>
    <fieldset className="xd-ps-dialog-group"><legend>Blend Method</legend><div role="radiogroup" aria-label="Blend Method" className="xd-ps-dialog-radios is-column">{([["panorama","Panorama"],["stack","Stack Images"]] as const).map(([id,label])=>
      <label key={id} className="xd-ps-dialog-check"><input type="radio" name="edit.autoBlendLayers.method" value={id} checked={values.method===id} onChange={()=>setValues({...values,method:id})}/>{label}</label>)}</div></fieldset>
    <label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Seamless Tones and Colors" checked={values.seamlessTones} onChange={e=>setValues({...values,seamlessTones:e.target.checked})}/>Seamless Tones and Colors</label>
  </EditDialog>;
}
