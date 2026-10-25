import { Brush, Camera, FilePlus, Image as ImageIcon, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { historyBrushSource } from "./HistoryBrushSource";
import { runPhotoCommand } from "./runtime";
import type { PhotoState } from "./types";

const SOURCE_TIP="Sets the source for the history brush";
// New Document, New Snapshot and Delete have no native support yet: the engine keeps no named snapshots, no duplicate-from-state and no way to drop a state with its successors.
const FOOTER=[[FilePlus,"Create new document from current state"],[Camera,"Create new snapshot"],[Trash2,"Delete current state"]] as const;

export function PhotoHistory({state,disabled,contents,name,preview,source,chooseSource}:{state:PhotoState;disabled:boolean;contents:boolean;name?:string;preview?:string;source?:string|null;chooseSource?:(id:string)=>void}) {
  const past=state.historySources??[],current=past.find(source=>source.current)?.index??past.length-1;
  const rows=[...past.map(source=>({index:source.index,label:source.label,current:source.current,redo:false,id:source.id,available:source.available,reason:source.reason})),...(state.historyRedo??[]).map((label,offset)=>({index:current+1+offset,label,current:false,redo:true,id:"",available:false,reason:null}))];
  const currentRow=useRef<HTMLDivElement>(null),footer=useRef<HTMLDivElement>(null),currentId=past.find(source=>source.current)?.id;
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
  const jump=(index:number)=>void runPhotoCommand("history.select",{index}).catch(()=>{});
  const pick=(row:{id:string;available:boolean;reason?:string|null})=><button className={`xd-photo-history-src${row.id===chosen?" on":""}`} aria-label={SOURCE_TIP} aria-pressed={row.id===chosen} title={row.available||!row.id?SOURCE_TIP:row.reason??"The paint target did not exist in this history state."} disabled={disabled||!row.id||!row.available||!chooseSource} onClick={()=>chooseSource?.(row.id)}>{row.id===chosen&&<Brush size={10}/>}</button>;
  return <>
    <div className="xd-photo-history-list" role="list" aria-label="Image history">
      <div role="listitem" className={`xd-photo-layer xd-photo-history-snapshot${open?.current?" selected":""}`}>
        {open?pick(open):<span className="xd-photo-history-src"/>}
        <button className="xd-photo-layer-name" disabled={disabled||!open||open.current} aria-current={open?.current?"step":undefined} title={!open?"The opening state is no longer retained":open.current?"Current state":"Return to this state"} onClick={()=>open&&jump(open.index)}>
          {preview&&open?.current?<img className="xd-photo-layer-thumb" src={preview} alt=""/>:<span className="xd-photo-layer-thumb xd-photo-history-thumb"><ImageIcon size={14}/></span>}<span>{name||state.name}</span></button>
      </div>
      <hr className="xd-photo-history-divider"/>
      {rows.map(row=><div key={`${row.index}/${row.redo}`} ref={row.current?currentRow:undefined} role="listitem" className={`xd-photo-layer${row.current?" selected":""}${row.redo?" xd-photo-history-redo":""}`}>
        {row.redo?<span className="xd-photo-history-src"/>:pick(row)}
        <button className="xd-photo-layer-name" disabled={disabled||row.current} aria-current={row.current?"step":undefined} title={row.current?"Current state":row.redo?"Redo to this state":"Return to this state"} onClick={()=>jump(row.index)}><span>{row.label}</span></button>
      </div>)}
    </div>
    <div ref={footer} className="xd-photo-layer-actions xd-ps-layer-actions xd-photo-history-actions">{FOOTER.map(([Icon,tip])=><button key={tip} aria-label={tip} title={tip} disabled><Icon size={14}/></button>)}</div>
  </>;
}
