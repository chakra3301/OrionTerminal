import { useState, type MouseEvent } from "react";
import { create } from "zustand";
import { save } from "@tauri-apps/plugin-dialog";
import { FileOutput, ListChecks, ListX, Trash2 } from "lucide-react";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import type { MenuEntry } from "../menuModel";
import type { PhotoMeasureSource, PhotoPanels } from "./types";

type Log=PhotoPanels["measurementLog"];
type Store={selected:number[];anchor:number|null;dialog:boolean;set:(patch:Partial<Omit<Store,"set">>)=>void};
export const useMeasurementLog=create<Store>(set=>({selected:[],anchor:null,dialog:false,set:patch=>set(patch)}));

const run=(command:string,params:Record<string,unknown>={})=>runPhotoCommand(command,params).catch(()=>undefined);
const SOURCES:[PhotoMeasureSource,string][]=[["selection","Selections"],["ruler","Ruler Tool"],["count","Count Tool"]];
const chosenRows=(log:Log)=>useMeasurementLog.getState().selected.filter(id=>log.rows.some(row=>row.id===id));
const cell=(value:unknown)=>typeof value==="number"?Number.isInteger(value)?String(value):value.toFixed(6):Array.isArray(value)?value.join(" "):value==null?"":String(value);

async function exportRows(rows:number[]) {
  const path=await save({defaultPath:"Measurements.csv",filters:[{name:"CSV",extensions:["csv"]}]});
  if(path)await run("measurementLog.export",{path,rows});
}
const selectAll=(log:Log)=>useMeasurementLog.getState().set({selected:log.rows.map(row=>row.id)});
const deselectAll=()=>useMeasurementLog.getState().set({selected:[],anchor:null});

export function MeasurementLogPanel({log}:{log:Log}) {
  const busy=usePhotoWorkspace(s=>s.busy),selected=useMeasurementLog(s=>s.selected),anchor=useMeasurementLog(s=>s.anchor),set=useMeasurementLog(s=>s.set);
  const ids=log.rows.map(row=>row.id),chosen=selected.filter(id=>ids.includes(id));
  const pick=(event:MouseEvent,id:number)=>{
    if(event.shiftKey&&anchor!==null&&ids.includes(anchor)){
      const from=ids.indexOf(anchor),to=ids.indexOf(id),step=from<=to?1:-1,range:number[]=[];
      for(let i=from;i!==to+step;i+=step)range.push(ids[i]!);
      set({selected:range});
    }else if(event.metaKey||event.ctrlKey)set({selected:chosen.includes(id)?chosen.filter(item=>item!==id):[...chosen,id],anchor:id});
    else set({selected:[id],anchor:id});
  };
  return <div className="xd-photo-log" role="group" aria-label="Measurement Log">
    <div className="xd-photo-notes-bar">
      <button className="xd-photo-log-record" aria-label="Record Measurements" disabled={busy} onClick={()=>void run("image.analysis.recordMeasurements",{source:"auto"})}>Record Measurements</button>
      <button aria-label="Select All" title="Select All" disabled={!ids.length} onClick={()=>selectAll(log)}><ListChecks size={14}/></button>
      <button aria-label="Deselect All" title="Deselect All" disabled={!chosen.length} onClick={deselectAll}><ListX size={14}/></button>
      <button aria-label="Export selected measurements" title="Export selected measurements" disabled={busy||!chosen.length} onClick={()=>void exportRows(chosen)}><FileOutput size={14}/></button>
      <button aria-label="Delete selected measurements" title="Delete selected measurements" disabled={busy||!chosen.length} onClick={()=>void run("measurementLog.delete",{rows:chosen})}><Trash2 size={14}/></button>
    </div>
    <div className="xd-photo-log-table">
      <table>
        <thead><tr>{log.columns.map(column=><th key={column.key} scope="col">{column.name}</th>)}</tr></thead>
        <tbody>{log.rows.map(row=><tr key={row.id} aria-label={cell(row.values.label)||`Measurement ${row.id}`} aria-selected={chosen.includes(row.id)} className={chosen.includes(row.id)?"selected":undefined} onClick={event=>pick(event,row.id)}>
          {log.columns.map(column=><td key={column.key}>{cell(row.values[column.key])}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

export function measurementLogPanelMenu(log:Log,busy:boolean):MenuEntry[] {
  const chosen=chosenRows(log);
  return [
    {label:"Select All",disabled:!log.rows.length,run:()=>selectAll(log)},
    {label:"Deselect All",disabled:!chosen.length,run:deselectAll},
    {label:"Export Selected…",disabled:busy||!chosen.length,run:()=>void exportRows(chosen)},
    {label:"Delete Selected",disabled:busy||!chosen.length,run:()=>void run("measurementLog.delete",{rows:chosen})},
  ];
}

function DataPointsForm({log,close}:{log:Log;close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error),dialog=useDesignDialog<HTMLFormElement>(close,busy);
  const [points,setPoints]=useState(()=>Object.fromEntries(SOURCES.map(([source])=>[source,log.dataPoints[source]])) as Record<PhotoMeasureSource,string[]>);
  const common=log.available.selection.filter(point=>SOURCES.every(([source])=>log.available[source].some(item=>item.key===point.key)));
  const toggle=(sources:PhotoMeasureSource[],key:string,on:boolean)=>setPoints(current=>({...current,...Object.fromEntries(sources.map(source=>[source,on?[...current[source].filter(item=>item!==key),key]:current[source].filter(item=>item!==key)]))}));
  const submit=()=>void runPhotoCommand("image.analysis.selectDataPoints",Object.fromEntries(SOURCES.map(([source])=>[source,log.available[source].map(point=>point.key).filter(key=>points[source].includes(key))]))).then(close,()=>{});
  return <PhotoDialog dialog={dialog} title="Select Data Points" busy={busy} close={close} onSubmit={event=>{event.preventDefault();submit();}}>
    <fieldset className="xd-ps-dialog-group"><legend>Common</legend>
      {common.map(point=><label key={point.key} className="xd-ps-dialog-check"><input type="checkbox" aria-label={`Data point ${point.name}`} checked={SOURCES.every(([source])=>points[source].includes(point.key))} onChange={event=>toggle(SOURCES.map(([source])=>source),point.key,event.target.checked)}/>{point.name}</label>)}
    </fieldset>
    {SOURCES.map(([source,title])=>{
      const own=log.available[source].filter(point=>!common.some(item=>item.key===point.key));
      return own.length?<fieldset key={source} className="xd-ps-dialog-group"><legend>{title}</legend>
        {own.map(point=><label key={point.key} className="xd-ps-dialog-check"><input type="checkbox" aria-label={`${title} ${point.name}`} checked={points[source].includes(point.key)} onChange={event=>toggle([source],point.key,event.target.checked)}/>{point.name}</label>)}
      </fieldset>:null;
    })}
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}

/** Image › Analysis › Select Data Points › Custom…. */
export function DataPointsDialog({log}:{log:Log|undefined}) {
  const open=useMeasurementLog(s=>s.dialog),set=useMeasurementLog(s=>s.set);
  return open&&log?<DataPointsForm log={log} close={()=>set({dialog:false})}/>:null;
}
