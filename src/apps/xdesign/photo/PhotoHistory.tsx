import { Brush, Camera, FilePlus, Image as ImageIcon, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { historyBrushSource } from "./HistoryBrushSource";
import { runPhotoCommand } from "./runtime";
import type { PhotoState } from "./types";

const SOURCE_TIP="Sets the source for the history brush";
const SNAPSHOT_GONE="The history brush can only paint from a Full Document snapshot whose state is still in History.";
const run=(command:string,params:Record<string,unknown>)=>void runPhotoCommand(command,params).catch(()=>{});

/** New Document and Delete, shared by the footer and the panel menu. Delete drops the current state and everything after it, as in Photoshop's linear history. */
export function historyActions(state:PhotoState) {
  const past=state.historySources??[],at=past.find(row=>row.current),current=at?.index??past.length-1,snapshot=state.historySnapshots?.find(row=>row.current);
  return {
    newDocument:()=>run("image.duplicate",{name:snapshot?.name??at?.label??state.name,mergedOnly:false}),
    canDelete:!!snapshot||current>(past[0]?.index??0),
    remove:()=>snapshot?run("history.snapshot.delete",{id:snapshot.id}):run("history.select",{index:current-1,discardRedo:true}),
  };
}

export function PhotoHistory({state,disabled,contents,name,preview,source,chooseSource,newSnapshot}:{state:PhotoState;disabled:boolean;contents:boolean;name?:string;preview?:string;source?:string|null;chooseSource?:(id:string)=>void;newSnapshot?:()=>void}) {
  const past=state.historySources??[],current=past.find(source=>source.current)?.index??past.length-1;
  const rows=[...past.map(source=>({index:source.index,label:source.label,current:source.current,redo:false,id:source.id,available:source.available,reason:source.reason})),...(state.historyRedo??[]).map((label,offset)=>({index:current+1+offset,label,current:false,redo:true,id:"",available:false,reason:null}))];
  const currentRow=useRef<HTMLDivElement>(null),footer=useRef<HTMLDivElement>(null),currentId=past.find(source=>source.current)?.id;
  const [renaming,setRenaming]=useState<{id:string;name:string}|null>(null);
  // Only a new or chosen state scrolls the list, so it can still be browsed while nothing changes. scrollIntoView
  // would also scroll the shell's clipped ancestors (a window dragged half off the desktop) and ignores the sticky footer.
  useEffect(()=>{
    const row=currentRow.current;let box=row?.parentElement;
    while(box&&!/auto|scroll/.test(getComputedStyle(box).overflowY))box=box.parentElement;
    if(!row||!box)return;
    const at=row.getBoundingClientRect(),view=box.getBoundingClientRect(),bottom=Math.min(view.bottom,footer.current?.getBoundingClientRect().top??view.bottom);
    if(at.top<view.top)box.scrollTop+=at.top-view.top;else if(at.bottom>bottom)box.scrollTop+=at.bottom-bottom;
  },[currentId]);
  if(contents)return <p className="xd-photo-section-help">Use Undo and Redo while editing smart-object contents.</p>;
  if(!rows.length)return <p className="xd-photo-section-help">Reopen the image to load its history.</p>;
  const chosen=historyBrushSource(past,source??null)?.id,open=past[0]?.label==="Open"?past[0]:undefined;
  const jump=(index:number)=>run("history.select",{index});
  const snapshots=state.historySnapshots??[],actions=historyActions(state);
  const rename=()=>{if(renaming?.name.trim())run("history.snapshot.rename",{id:renaming.id,name:renaming.name.trim()});setRenaming(null);};
  const pick=(row:{id:string;available:boolean;reason?:string|null})=><button className={`xd-photo-history-src${row.id===chosen?" on":""}`} aria-label={SOURCE_TIP} aria-pressed={row.id===chosen} title={row.available||!row.id?SOURCE_TIP:row.reason??"The paint target did not exist in this history state."} disabled={disabled||!row.id||!row.available||!chooseSource} onClick={()=>chooseSource?.(row.id)}>{row.id===chosen&&<Brush size={10}/>}</button>;
  return <>
    <div className="xd-photo-history-list" role="list" aria-label="Image history">
      <div role="listitem" className={`xd-photo-layer xd-photo-history-snapshot${open?.current?" selected":""}`}>
        {open?pick(open):<span className="xd-photo-history-src"/>}
        <button className="xd-photo-layer-name" disabled={disabled||!open||open.current} aria-current={open?.current?"step":undefined} title={!open?"The opening state is no longer retained":open.current?"Current state":"Return to this state"} onClick={()=>open&&jump(open.index)}>
          {preview&&open?.current?<img className="xd-photo-layer-thumb" src={preview} alt=""/>:<span className="xd-photo-layer-thumb xd-photo-history-thumb"><ImageIcon size={14}/></span>}<span>{name||state.name}</span></button>
      </div>
      {snapshots.map(row=>{const at=past.find(state=>state.id===row.source);return <div key={row.id} role="listitem" className={`xd-photo-layer xd-photo-history-snapshot${row.current?" selected":""}`}>
        {pick({id:row.source,available:!!at?.available,reason:at?at.reason:SNAPSHOT_GONE})}
        {renaming?.id===row.id?<input className="xd-photo-layer-name" aria-label="Snapshot name" autoFocus maxLength={255} value={renaming.name} onChange={e=>setRenaming({id:row.id,name:e.target.value})} onBlur={rename} onKeyDown={e=>{if(e.key==="Enter")rename();else if(e.key==="Escape")setRenaming(null);}}/>:
        <button className="xd-photo-layer-name" disabled={disabled} aria-current={row.current?"step":undefined} title={row.current?"Current snapshot. Double-click to rename":"Return to this snapshot. Double-click to rename"} onClick={()=>{if(!row.current)run("history.snapshot.select",{id:row.id});}} onDoubleClick={()=>setRenaming({id:row.id,name:row.name})}>
          <span className="xd-photo-layer-thumb xd-photo-history-thumb"><ImageIcon size={14}/></span><span>{row.name}</span></button>}
      </div>;})}
      <hr className="xd-photo-history-divider"/>
      {rows.map(row=><div key={`${row.index}/${row.redo}`} ref={row.current?currentRow:undefined} role="listitem" className={`xd-photo-layer${row.current?" selected":""}${row.redo?" xd-photo-history-redo":""}`}>
        {row.redo||(open&&row.id===open.id)||snapshots.some(snap=>snap.source===row.id)?<span className="xd-photo-history-src"/>:pick(row)}
        <button className="xd-photo-layer-name" disabled={disabled||row.current} aria-current={row.current?"step":undefined} title={row.current?"Current state":row.redo?"Redo to this state":"Return to this state"} onClick={()=>jump(row.index)}><span>{row.label}</span></button>
      </div>)}
    </div>
    <div ref={footer} className="xd-photo-layer-actions xd-ps-layer-actions xd-photo-history-actions">
      <button aria-label="Create new document from current state" title="Create new document from current state" disabled={disabled} onClick={actions.newDocument}><FilePlus size={14}/></button>
      {/* Alt-click asks for a name and source, as in Photoshop; a plain click takes the whole document. */}
      <button aria-label="Create new snapshot" title="Create new snapshot" disabled={disabled} onClick={e=>{if(e.altKey&&newSnapshot)newSnapshot();else run("history.snapshot.new",{});}}><Camera size={14}/></button>
      <button aria-label="Delete current state" title="Delete current state" disabled={disabled||!actions.canDelete} onClick={actions.remove}><Trash2 size={14}/></button>
    </div>
  </>;
}
