import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Crosshair, Pipette, Ruler, SquareDashed } from "lucide-react";
import { hexToRgb, rgbToHsb } from "./colorModel";
import { rulerReadout, useAnalysisTool, type RulerLine } from "./analysisTool";
import { useDocumentSamplers } from "./colorSamplers";
import "./infoPanel.css";

export const useInfoCursor = create<{point:[number,number]|null;set:(point:[number,number]|null)=>void}>(set=>({point:null,set:point=>set({point})}));

const Row=({label,value,unit=""}:{label:string;value:number|null;unit?:string}) => <div className="xd-info-row" aria-label={`Info ${label}`}><span>{label}:</span><output>{value===null?"":`${value}${unit}`}</output></div>;
type Ink=(x:number,y:number)=>Promise<number[]|null>;
const Inks=({inks}:{inks:number[]|null})=><>{["C","M","Y","K"].map((label,i)=><Row key={label} label={label} value={inks&&Math.round(inks[i]??0)} unit="%"/>)}</>;

/** One readout per color sampler, sampled again whenever `refresh` changes (a new image version, view or sample size). */
function SamplerReadouts({documentId,refresh,sample,ink}:{documentId:string;refresh:string;sample:(x:number,y:number)=>Promise<string|null>;ink?:Ink}) {
  const points=useDocumentSamplers(documentId),[colors,setColors]=useState<(string|number[]|null)[]>([]),fn=useRef({sample,ink});
  fn.current={sample,ink};
  useEffect(()=>{
    let live=true;
    const read=(x:number,y:number):Promise<string|number[]|null>=>fn.current.ink?fn.current.ink(x,y):fn.current.sample(x,y);
    void Promise.all(points.map(point=>read(point.x,point.y).catch(()=>null))).then(result=>{if(live)setColors(result);});
    return()=>{live=false;};
  },[points,refresh]);
  return points.map((_,i)=>{const color=colors[i],rgb=typeof color==="string"?hexToRgb(color):null;
    return <div key={i} className="xd-info-cell" aria-label={`Info sampler ${i+1}`}><span className="xd-info-sampler">#{i+1}</span>{ink?<Inks inks={Array.isArray(color)?color:null}/>:<><Row label="R" value={rgb&&rgb[0]}/><Row label="G" value={rgb&&rgb[1]}/><Row label="B" value={rgb&&rgb[2]}/></>}</div>;});
}

/** `ruler` is set while the Ruler tool is chosen; Photoshop then shows its angle and length instead of HSB, and its size as W and H. `ink` reads a CMYK image's inks (0–100 %), which then replace RGB as the actual colour. */
export function InfoPanel({width,height,selectionBounds,sample,ink,ruler,documentId,refresh=""}:{width:number;height:number;selectionBounds:[number,number,number,number]|null|undefined;sample:(x:number,y:number)=>Promise<string|null>;ink?:Ink;ruler?:RulerLine|null;documentId?:string;refresh?:string}) {
  const point=useInfoCursor(s=>s.point),[hex,setHex]=useState<string|null>(null),[inks,setInks]=useState<number[]|null>(null),draft=useAnalysisTool(s=>s.ruler);
  const line=ruler===undefined?null:draft??ruler,measure=line&&rulerReadout(line),tenth=(v:number)=>Math.round(v*10)/10;
  const x=point?Math.floor(point[0]):null,y=point?Math.floor(point[1]):null;
  const inside=x!==null&&y!==null&&x>=0&&y>=0&&x<width&&y<height;
  const fn=useRef(sample),inkFn=useRef(ink),busy=useRef(false),next=useRef<[number,number]|null>(null),alive=useRef(true);
  fn.current=sample;inkFn.current=ink;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!inside){next.current=null;setHex(null);setInks(null);return;}
    next.current=[x,y];
    if(busy.current)return;
    const run=async()=>{
      busy.current=true;
      while(next.current&&alive.current){
        const [px,py]=next.current;next.current=null;
        let result:string|null=null,read:number[]|null=null;
        try{result=await fn.current(px,py);}catch{result=null;}
        if(inkFn.current)try{read=await inkFn.current(px,py);}catch{read=null;}
        if(alive.current&&!next.current){setHex(result);setInks(read);}
      }
      busy.current=false;
    };
    void run();
  },[inside,x,y]);
  const rgb=inside&&hex?hexToRgb(hex):null,hsb=rgb?rgbToHsb(rgb):null,round=(v:number)=>Math.round(v);
  return <div className="xd-info-panel" role="group" aria-label="Info">
    <div className="xd-info-cell"><Pipette size={12} aria-hidden/>{ink?<Inks inks={inside?inks:null}/>:<><Row label="R" value={rgb&&rgb[0]}/><Row label="G" value={rgb&&rgb[1]}/><Row label="B" value={rgb&&rgb[2]}/></>}</div>
    {ruler===undefined?<div className="xd-info-cell"><Pipette size={12} aria-hidden/><Row label="H" value={hsb&&round(hsb[0])} unit="°"/><Row label="S" value={hsb&&round(hsb[1])} unit="%"/><Row label="B" value={hsb&&round(hsb[2])} unit="%"/></div>
      :<div className="xd-info-cell"><Ruler size={12} aria-hidden/><Row label="A" value={measure&&tenth(measure.angle)} unit="°"/>{measure?.l2!=null?<><Row label="D1" value={tenth(measure.l1)}/><Row label="D2" value={tenth(measure.l2)}/></>:<Row label="L" value={measure&&tenth(measure.l1)}/>}</div>}
    <div className="xd-info-cell"><Crosshair size={12} aria-hidden/><Row label="X" value={inside?x:null}/><Row label="Y" value={inside?y:null}/></div>
    <div className="xd-info-cell"><SquareDashed size={12} aria-hidden/><Row label="W" value={measure?tenth(measure.w):selectionBounds?selectionBounds[2]:null}/><Row label="H" value={measure?tenth(measure.h):selectionBounds?selectionBounds[3]:null}/></div>
    {documentId&&<SamplerReadouts documentId={documentId} refresh={refresh} sample={sample} ink={ink}/>}
    <div className="xd-info-doc">Doc: {width} × {height} px</div>
  </div>;
}
