import { useEffect, useState } from "react";
import { Circle, CircleDashed, Plus, Spline, Square, Trash2 } from "lucide-react";
import { create } from "zustand";
import { ContextMenu } from "../EditorMenus";
import type { MenuEntry } from "../menuModel";
import { runPhotoCommand } from "./runtime";
import type { PhotoState } from "./types";
import { pathCurve, type PathData } from "./PathEditOverlay";

const run=(id:string,params:Record<string,unknown>)=>void runPhotoCommand(id,params).catch(()=>{});
const pathRows=(state:PhotoState)=>[...(state.paths?.work?[{name:"work",label:"Work Path"}]:[]),...(state.paths?.saved??[]).map(name=>({name,label:name}))];
const nextName=(saved:string[])=>{let index=saved.length+1;while(saved.includes(`Path ${index}`))index++;return `Path ${index}`;};
// Clicking the panel's empty space deselects every path, which hides the target path.
export const NO_PATH="";
// Photoshop saves the path target with the document, so reopening an image keeps its path deselected or targeted.
export const usePathTargets=create<Record<string,string|null>>(()=>({}));
// Like Photoshop, a freshly drawn work path is the selected path until another row is chosen.
export const selectedPath=(state:PhotoState,active:string|null)=>active===NO_PATH?null:pathRows(state).some(row=>row.name===active)?active:state.paths?.work?"work":null;

// Photoshop's New Path makes an empty "Path N"; Save Path stands in for it while the work path is selected.
const createPath=(saved:string[],select?:(name:string)=>void)=>{const name=nextName(saved);run("path.set",{name,path:{subpaths:[]}});select?.(name);};
const makeWorkPath=(select?:(name:string)=>void)=>{run("select.toWorkPath",{tolerance:2});select?.("work");};
const savePath=(saved:string[],select?:(name:string)=>void)=>{const name=nextName(saved);run("path.rename",{name:"work",to:name});select?.(name);};
const duplicatePath=(saved:string[],path:string,select?:(name:string)=>void)=>{
  const base=path==="work"?nextName(saved):`${path} copy`;let name=base,index=2;while(saved.includes(name))name=`${base} ${index++}`;
  void runPhotoCommand("path.info",{name:path}).then(result=>{const data=(result as {path?:PathData}|undefined)?.path;if(data){run("path.set",{name,path:data});select?.(name);}}).catch(()=>{});
};

export function pathsPanelMenu(state:PhotoState,path:string|null,disabled:boolean,select?:(name:string)=>void):MenuEntry[] {
  const saved=state.paths?.saved??[],work=path==="work";
  return [
    work?{label:"Save Path…",disabled,run:()=>savePath(saved,select)}:{label:"New Path…",disabled,run:()=>createPath(saved,select)},
    {label:"Duplicate Path…",disabled:disabled||!path,run:()=>duplicatePath(saved,path!,select)},
    {label:"Delete Path",disabled:disabled||!path,run:()=>run("path.delete",{name:path})},
    "-",
    {label:"Make Work Path…",disabled:disabled||!state.hasSelection,run:()=>makeWorkPath(select)},
    {label:"Make Selection…",disabled:disabled||!path,run:()=>run("path.toSelection",{name:path})},
    {label:"Fill Path…",disabled:disabled||!path||!state.activeLayer,run:()=>run("path.fill",{name:path})},
    {label:"Stroke Path…",disabled:disabled||!path||!state.activeLayer,run:()=>run("path.stroke",{name:path})},
    {label:"Clipping Path…",disabled:disabled||!path||work,run:()=>run("path.clippingPath.set",{name:path,flatness:0})},
    "-",
    {label:"Panel Options…",disabled:true},
  ];
}

// Each row's silhouette comes from path.info, refetched whenever the document changes.
function usePathShapes(names:string[],version:string|undefined) {
  const [shapes,setShapes]=useState<Record<string,string>>({}),key=names.join("\n");
  useEffect(()=>{
    let alive=true;
    void Promise.all(key.split("\n").filter(Boolean).map(name=>runPhotoCommand("path.info",{name}).then(result=>[name,pathCurve((result as {path?:PathData}|undefined)?.path??{subpaths:[]})] as const).catch(()=>[name,""] as const))).then(list=>{if(alive)setShapes(Object.fromEntries(list));});
    return()=>{alive=false;};
  },[key,version]);
  return shapes;
}

export function PhotoPaths({state,disabled,active,select,version}:{state:PhotoState;disabled:boolean;active:string|null;select:(name:string)=>void;version?:string}) {
  const shapes=usePathShapes(pathRows(state).map(row=>row.name),version);
  const [renaming,setRenaming]=useState<string|null>(null),[menu,setMenu]=useState<{x:number;y:number}|null>(null);
  const saved=state.paths?.saved??[],path=selectedPath(state,active);
  return <>
    <div className="xd-photo-layer-list" onClick={event=>{if(!disabled&&!(event.target as Element).closest(".xd-photo-path"))select(NO_PATH);}}><div role="list" aria-label="Paths">{pathRows(state).map(row=><div key={row.name} role="listitem" className={`xd-photo-path${row.name===path?" selected":""}`}
      onContextMenu={event=>{event.preventDefault();if(disabled)return;select(row.name);setMenu({x:event.clientX,y:event.clientY});}}>
      <svg className="xd-photo-path-thumb" viewBox={`0 0 ${state.width} ${state.height}`} aria-hidden="true"><path d={shapes[row.name]??""}/></svg>
      {renaming===row.name?<input autoFocus className="xd-photo-channel-rename" aria-label={`Name of ${row.label}`} defaultValue={row.label}
        onKeyDown={event=>{if(event.key==="Escape")event.currentTarget.value=row.label;if(event.key==="Enter"||event.key==="Escape")event.currentTarget.blur();}}
        onBlur={event=>{const next=event.target.value.trim();setRenaming(null);if(next&&next!==row.name&&!saved.includes(next)){run("path.rename",{name:row.name,to:next});select(next);}}}/>:
      <button disabled={disabled} aria-pressed={row.name===path} className={`xd-photo-path-name${row.name==="work"?" xd-photo-path-work":""}`} title="Double-click to rename"
        onClick={()=>select(row.name)} onDoubleClick={()=>setRenaming(row.name)}>{row.label}</button>}
    </div>)}</div></div>
    <div className="xd-photo-layer-actions xd-ps-layer-actions">
      <button aria-label="Fill path with foreground color" title="Fill path with foreground color" disabled={disabled||!path||!state.activeLayer} onClick={()=>run("path.fill",{name:path})}><Circle size={14} fill="currentColor"/></button>
      <button aria-label="Stroke path with brush" title="Stroke path with brush" disabled={disabled||!path||!state.activeLayer} onClick={()=>run("path.stroke",{name:path})}><Circle size={14}/></button>
      <button aria-label="Load path as a selection" title="Load path as a selection" disabled={disabled||!path} onClick={()=>run("path.toSelection",{name:path})}><CircleDashed size={14}/></button>
      <button aria-label="Make work path from selection" title="Make work path from selection" disabled={disabled||!state.hasSelection} onClick={()=>makeWorkPath(select)}><Spline size={14}/></button>
      <button aria-label="Add a mask" title="Add a mask" disabled={disabled||!path||!state.activeLayer} onClick={()=>run("layer.vectorMask.fromPath",{name:path})}><Square size={14}/></button>
      <button aria-label="Create new path" title="Create new path" disabled={disabled} onClick={()=>createPath(saved,select)}><Plus size={14}/></button>
      <button aria-label="Delete current path" title="Delete current path" disabled={disabled||!path} onClick={()=>run("path.delete",{name:path})}><Trash2 size={14}/></button>
    </div>
    {menu&&<ContextMenu x={menu.x} y={menu.y} label="Path" close={()=>setMenu(null)} items={pathsPanelMenu(state,path,disabled,select)}/>}
  </>;
}
