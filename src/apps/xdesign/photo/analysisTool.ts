import { create } from "zustand";

export type XY=[number,number];
export type RulerLine={start:XY;end:XY;protractor:XY|null};
export type SliceStyle="normal"|"ratio"|"size";
/** Auto slices have no id, so they are found by number. */
export type SliceRef={id:number|null;number:number};

type Store={
  /** The line being dragged, shown in the options bar and Info panel before the engine has it. */
  ruler:RulerLine|null;
  note:number;
  slice:SliceRef|null;
  author:string;
  noteColor:string;
  hideAuto:boolean;
  style:SliceStyle;
  ratio:XY;
  size:XY;
  dialog:"options"|"divide"|null;
  divide:{rect:[number,number,number,number];down:number;across:number}|null;
  set:(patch:Partial<Omit<Store,"set">>)=>void;
};

export const useAnalysisTool=create<Store>(set=>({ruler:null,note:0,slice:null,author:"",noteColor:"#ffff82",hideAuto:false,style:"normal",ratio:[1,1],size:[64,64],dialog:null,divide:null,set:patch=>set(patch)}));

/** The engine's `ruler_info`: the angle runs counter-clockwise from +x with y up, or is the angle between a protractor's two lines. */
export function rulerReadout({start,end,protractor}:RulerLine) {
  const dx=end[0]-start[0],dy=end[1]-start[1],a1=Math.atan2(-dy,dx);
  let angle=a1*180/Math.PI,l2:number|null=null;
  if(protractor){
    const ex=protractor[0]-start[0],ey=protractor[1]-start[1];
    l2=Math.hypot(ex,ey);angle=Math.abs((a1-Math.atan2(-ey,ex))*180/Math.PI);
    if(angle>180)angle=360-angle;
  }
  return {x:start[0],y:start[1],w:dx,h:dy,angle,l1:Math.hypot(dx,dy),l2};
}

/** Engine colours are 0..1 RGB. */
export const rgbHex=(rgb:number[])=>`#${rgb.slice(0,3).map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,"0")).join("")}`;
