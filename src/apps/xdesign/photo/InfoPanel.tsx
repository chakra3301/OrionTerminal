import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Crosshair, Pipette, SquareDashed } from "lucide-react";
import { hexToRgb, rgbToHsb } from "./colorModel";
import "./infoPanel.css";

export const useInfoCursor = create<{point:[number,number]|null;set:(point:[number,number]|null)=>void}>(set=>({point:null,set:point=>set({point})}));

const Row=({label,value,unit=""}:{label:string;value:number|null;unit?:string}) => <div className="xd-info-row" aria-label={`Info ${label}`}><span>{label}:</span><output>{value===null?"":`${value}${unit}`}</output></div>;

export function InfoPanel({width,height,selectionBounds,sample}:{width:number;height:number;selectionBounds:[number,number,number,number]|null|undefined;sample:(x:number,y:number)=>Promise<string|null>}) {
  const point=useInfoCursor(s=>s.point),[hex,setHex]=useState<string|null>(null);
  const x=point?Math.floor(point[0]):null,y=point?Math.floor(point[1]):null;
  const inside=x!==null&&y!==null&&x>=0&&y>=0&&x<width&&y<height;
  const fn=useRef(sample),busy=useRef(false),next=useRef<[number,number]|null>(null),alive=useRef(true);
  fn.current=sample;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!inside){next.current=null;setHex(null);return;}
    next.current=[x,y];
    if(busy.current)return;
    const run=async()=>{
      busy.current=true;
      while(next.current&&alive.current){
        const [px,py]=next.current;next.current=null;
        let result:string|null=null;
        try{result=await fn.current(px,py);}catch{result=null;}
        if(alive.current&&!next.current)setHex(result);
      }
      busy.current=false;
    };
    void run();
  },[inside,x,y]);
  const rgb=inside&&hex?hexToRgb(hex):null,hsb=rgb?rgbToHsb(rgb):null,round=(v:number)=>Math.round(v);
  return <div className="xd-info-panel" role="group" aria-label="Info">
    <div className="xd-info-cell"><Pipette size={12} aria-hidden/><Row label="R" value={rgb&&rgb[0]}/><Row label="G" value={rgb&&rgb[1]}/><Row label="B" value={rgb&&rgb[2]}/></div>
    <div className="xd-info-cell"><Pipette size={12} aria-hidden/><Row label="H" value={hsb&&round(hsb[0])} unit="°"/><Row label="S" value={hsb&&round(hsb[1])} unit="%"/><Row label="B" value={hsb&&round(hsb[2])} unit="%"/></div>
    <div className="xd-info-cell"><Crosshair size={12} aria-hidden/><Row label="X" value={inside?x:null}/><Row label="Y" value={inside?y:null}/></div>
    <div className="xd-info-cell"><SquareDashed size={12} aria-hidden/><Row label="W" value={selectionBounds?selectionBounds[2]:null}/><Row label="H" value={selectionBounds?selectionBounds[3]:null}/></div>
    <div className="xd-info-doc">Doc: {width} × {height} px</div>
  </div>;
}
