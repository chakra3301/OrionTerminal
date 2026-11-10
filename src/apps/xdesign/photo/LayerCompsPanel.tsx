import { useState } from "react";
import { create } from "zustand";
import { ChevronDown, ChevronLeft, ChevronRight, Eye, Layers2, Move, Plus, RefreshCw, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import type { MenuEntry } from "../menuModel";
import type { PhotoLayerComp, PhotoPanels } from "./types";

type Comps=PhotoPanels["layerComps"];
type Store={selected:number|null;dialog:"new"|"options"|null;set:(patch:Partial<Omit<Store,"set">>)=>void};
export const useLayerComps=create<Store>(set=>({selected:null,dialog:null,set:patch=>set(patch)}));

const run=(command:string,params:Record<string,unknown>={})=>runPhotoCommand(command,params).catch(()=>undefined);
const selectedComp=(comps:Comps)=>comps.comps.find(comp=>comp.id===useLayerComps.getState().selected);
const APPLY:[keyof Pick<PhotoLayerComp,"visibility"|"position"|"appearance">,string,typeof Eye][]=[["visibility","Visibility",Eye],["position","Position",Move],["appearance","Appearance",Sparkles]];

export function LayerCompsPanel({comps}:{comps:Comps}) {
  const busy=usePhotoWorkspace(s=>s.busy),selected=useLayerComps(s=>s.selected),set=useLayerComps(s=>s.set);
  const [comments,setComments]=useState<number[]>([]);
  const comp=comps.comps.find(item=>item.id===selected);
  const apply=(item:PhotoLayerComp)=>{set({selected:item.id});void run("layerComp.apply",{comp:item.id});};
  return <div className="xd-photo-rows" role="group" aria-label="Layer Comps">
    <ul>
      <li className="xd-photo-row">
        <button className="xd-photo-comp-apply" aria-label="Apply Last Document State" title="Apply Last Document State" aria-pressed={comps.lastApplied===null} disabled={busy||!comps.hasLastDocumentState} onClick={()=>void run("layerComp.restoreLastDocumentState")}><Layers2 size={13}/></button>
        <span className="xd-photo-row-name">Last Document State</span>
      </li>
      {comps.comps.map(item=><li key={item.id} className={`xd-photo-row${item.id===selected?" selected":""}`}>
        <button className="xd-photo-comp-apply" aria-label={`Apply ${item.name}`} title="Apply layer comp" aria-pressed={comps.lastApplied===item.id} disabled={busy} onClick={()=>apply(item)}><Layers2 size={13}/></button>
        {item.comment?<button className="xd-photo-comp-disclose" aria-label={`Show comment for ${item.name}`} aria-expanded={comments.includes(item.id)} onClick={()=>setComments(current=>current.includes(item.id)?current.filter(id=>id!==item.id):[...current,item.id])}><ChevronDown size={11}/></button>:<span className="xd-photo-comp-disclose"/>}
        <button className="xd-photo-row-name" aria-label={item.name} aria-pressed={item.id===selected} onClick={()=>set({selected:item.id})} onDoubleClick={()=>set({selected:item.id,dialog:"options"})}>{item.name}</button>
        {item.missingLayers>0&&<span role="img" className="xd-photo-comp-warning" aria-label={`${item.name} cannot be fully restored`} title="Layer comp cannot be fully restored"><TriangleAlert size={12}/></span>}
        {APPLY.map(([field,label,Icon])=><button key={field} className="xd-photo-comp-toggle" aria-label={`${label} of ${item.name}`} title={label} aria-pressed={item[field]} disabled={busy} onClick={()=>void run("layerComp.setOptions",{comp:item.id,[field]:!item[field]})}><Icon size={12}/></button>)}
        {comments.includes(item.id)&&<p className="xd-photo-comp-comment">{item.comment}</p>}
      </li>)}
    </ul>
    <div className="xd-photo-notes-bar">
      {APPLY.map(([field,label,Icon])=><button key={field} aria-label={`Update ${label}`} title={`Update ${label}`} disabled={busy||!comp} onClick={()=>void run("layerComp.update",{comp:comp!.id,what:field})}><Icon size={14}/></button>)}
      <button aria-label="Apply Previous Selected Layer Comp" title="Apply Previous Selected Layer Comp" disabled={busy||!comps.comps.length} onClick={()=>void run("layerComp.previous")}><ChevronLeft size={14}/></button>
      <button aria-label="Apply Next Selected Layer Comp" title="Apply Next Selected Layer Comp" disabled={busy||!comps.comps.length} onClick={()=>void run("layerComp.next")}><ChevronRight size={14}/></button>
      <button aria-label="Update Layer Comp" title="Update Layer Comp" disabled={busy||!comp} onClick={()=>void run("layerComp.update",{comp:comp!.id,what:"all"})}><RefreshCw size={14}/></button>
      <button aria-label="Create New Layer Comp" title="Create New Layer Comp" disabled={busy} onClick={()=>set({dialog:"new"})}><Plus size={14}/></button>
      <button aria-label="Delete Layer Comp" title="Delete Layer Comp" disabled={busy||!comp} onClick={()=>void run("layerComp.delete",{comp:comp!.id})}><Trash2 size={14}/></button>
    </div>
  </div>;
}

export function layerCompsPanelMenu(comps:Comps,busy:boolean):MenuEntry[] {
  const comp=selectedComp(comps),none=busy||!comp,set=useLayerComps.getState().set;
  return [
    {label:"New Layer Comp…",disabled:busy,run:()=>set({dialog:"new"})},
    {label:"Duplicate Layer Comp",disabled:none,run:()=>void run("layerComp.duplicate",{comp:comp!.id})},
    {label:"Delete Layer Comp",disabled:none,run:()=>void run("layerComp.delete",{comp:comp!.id})},
    {label:"Update Layer Comp",disabled:none,run:()=>void run("layerComp.update",{comp:comp!.id,what:"all"})},
    {label:"Apply Layer Comp",disabled:none,run:()=>void run("layerComp.apply",{comp:comp!.id})},
    {label:"Next Layer Comp",disabled:busy||!comps.comps.length,run:()=>void run("layerComp.next")},
    {label:"Previous Layer Comp",disabled:busy||!comps.comps.length,run:()=>void run("layerComp.previous")},
    {label:"Restore Last Document State",disabled:busy||!comps.hasLastDocumentState,run:()=>void run("layerComp.restoreLastDocumentState")},
    "-",
    {label:"Layer Comp Options…",disabled:none,run:()=>set({dialog:"options"})},
    {label:"Clear All Layer Comp Warnings",disabled:busy||!comps.comps.some(item=>item.missingLayers>0),run:()=>void run("layerComp.updateWarnings",{clear:true})},
  ];
}

function LayerCompDialog({comp,count,close}:{comp:PhotoLayerComp|null;count:number;close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error),dialog=useDesignDialog<HTMLFormElement>(close,busy);
  const [fields,setFields]=useState(()=>comp?{name:comp.name,visibility:comp.visibility,position:comp.position,appearance:comp.appearance,comment:comp.comment}:{name:`Layer Comp ${count+1}`,visibility:true,position:true,appearance:true,comment:""});
  const submit=()=>void runPhotoCommand(comp?"layerComp.setOptions":"layerComp.new",comp?{comp:comp.id,...fields}:fields).then(close,()=>{});
  return <PhotoDialog dialog={dialog} title={comp?"Layer Comp Options":"New Layer Comp"} busy={busy} okDisabled={!fields.name.trim()} close={close} onSubmit={event=>{event.preventDefault();submit();}}>
    <label className="xd-ps-dialog-field"><span>Name:</span><input aria-label="Layer comp name" value={fields.name} onChange={event=>setFields(current=>({...current,name:event.target.value}))}/></label>
    <fieldset className="xd-ps-dialog-group"><legend>Apply To Layers:</legend>
      {APPLY.map(([field,label])=><label key={field} className="xd-ps-dialog-check"><input type="checkbox" aria-label={`Apply ${field}`} checked={fields[field]} onChange={event=>setFields(current=>({...current,[field]:event.target.checked}))}/>{field==="appearance"?"Appearance (Layer Style)":label}</label>)}
    </fieldset>
    <label className="xd-ps-dialog-field"><span>Comment:</span><textarea aria-label="Layer comp comment" value={fields.comment} onChange={event=>setFields(current=>({...current,comment:event.target.value}))}/></label>
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}

/** New Layer Comp and Layer Comp Options. Rendered at studio level because the flyout's box would clip the dialog scrim. */
export function LayerCompDialogs({comps}:{comps:Comps|undefined}) {
  const dialog=useLayerComps(s=>s.dialog),selected=useLayerComps(s=>s.selected),set=useLayerComps(s=>s.set);
  const comp=comps?.comps.find(item=>item.id===selected)??null,close=()=>set({dialog:null});
  if(!comps)return null;
  if(dialog==="new")return <LayerCompDialog comp={null} count={comps.comps.length} close={close}/>;
  return dialog==="options"&&comp?<LayerCompDialog key={comp.id} comp={comp} count={comps.comps.length} close={close}/>:null;
}
