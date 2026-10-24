import { Fragment, useRef, useState, type PointerEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { GradientFill, PhotoDocument, PhotoLayer } from "./types";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import { geometryPoint } from "./GeometryDialog";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";

type XY=[number,number];
export function GradientFillDialog({document,layer,close}:{document:PhotoDocument;layer:PhotoLayer;close:()=>void}) {
  const busy=usePhotoWorkspace(state=>state.busy),projectId=usePhotoWorkspace(state=>state.projectId),error=usePhotoWorkspace(state=>state.error);
  const previewAllowed=document.width*document.height<=16_777_216,[patch,setPatch]=useState<Partial<GradientFill>>({}),[live,setLive]=useState(previewAllowed);
  const preview=usePhotoCommandPreview(document,projectId,"gradient.fill.set",{layer:layer.id,...patch},{automatic:live,enabled:!busy});
  const native=preview.result&&typeof preview.result==="object"&&"from" in preview.result&&"to" in preview.result?preview.result as GradientFill:null;
  const gradient={...layer.gradientFill!,...patch,...native};
  const dialog=useDesignDialog<HTMLFormElement>(close,busy),drag=useRef<"from"|"to"|null>(null),surface=useRef<SVGSVGElement|null>(null);
  const change=(next:Partial<GradientFill>)=>setPatch(current=>{
    const out={...current,...next};
    if("angle" in next||"scale" in next||"offset" in next||"align" in next){delete out.from;delete out.to;}
    if("from" in next||"to" in next){delete out.angle;delete out.scale;delete out.offset;}
    return out;
  });
  const point=(event:PointerEvent<SVGSVGElement>)=>geometryPoint(event.clientX,event.clientY,event.currentTarget.getBoundingClientRect(),document.width,document.height);
  const number=(label:string,value:number,commit:(value:number)=>void,min:number,max:number,text:string,unit?:string)=><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{text}:</span><input aria-label={label} type="number" required min={min} max={max} step="any" disabled={busy} value={value} onChange={event=>{if(Number.isFinite(event.target.valueAsNumber))commit(event.target.valueAsNumber);}}/>{unit!==undefined&&<span className="xd-ps-dialog-unit">{unit}</span>}</label></div>;
  const handles=(key:"from"|"to",position:XY)=><circle role="button" tabIndex={0} aria-label={`Gradient ${key} handle`} cx={position[0]} cy={position[1]} r={Math.max(document.width,document.height)/90} onPointerDown={event=>{if(busy)return;event.stopPropagation();drag.current=key;surface.current?.setPointerCapture(event.pointerId);}} onKeyDown={event=>{
    const delta=event.shiftKey?10:1,dx=event.key==="ArrowLeft"?-delta:event.key==="ArrowRight"?delta:0,dy=event.key==="ArrowUp"?-delta:event.key==="ArrowDown"?delta:0;
    if(busy||!dx&&!dy)return;event.preventDefault();event.stopPropagation();change({from:gradient.from,to:gradient.to,[key]:[position[0]+dx,position[1]+dy]});
  }}/>;
  return <PhotoDialog dialog={dialog} title="Gradient Fill" label="Edit gradient fill" className="xd-photo-special-dialog" busy={busy} close={close} reset={()=>setPatch({})} preview={{checked:live,disabled:busy||!previewAllowed,busy:live&&preview.loading,change:checked=>{setLive(checked);if(checked)void preview.preview();}}} onSubmit={event=>{event.preventDefault();void runPhotoCommand("gradient.fill.set",{layer:layer.id,...patch}).then(close).catch(()=>{});}}>
    <div className="xd-photo-special-body"><div className="xd-photo-special-preview"><svg ref={surface} className="xd-photo-geometry-stage" viewBox={`0 0 ${document.width} ${document.height}`} aria-label="Gradient fill canvas" onPointerMove={event=>{if(drag.current&&!busy)change({from:gradient.from,to:gradient.to,[drag.current]:point(event)});}} onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{drag.current=null;}}>
      <image href={preview.url??convertFileSrc(document.previewPath)} width={document.width} height={document.height}/><line className="xd-photo-warp-guide" x1={gradient.from[0]} y1={gradient.from[1]} x2={gradient.to[0]} y2={gradient.to[1]} vectorEffect="non-scaling-stroke"/>{handles("from",gradient.from)}{handles("to",gradient.to)}
    </svg>{preview.error&&<p role="alert">{preview.error}</p>}</div>
    <div className="xd-photo-special-controls"><div className="xd-ps-dialog-grid">
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Style:</span><select aria-label="Fill gradient style" value={gradient.style} disabled={busy} onChange={event=>change({style:event.target.value})}>{["linear","radial","angle","reflected","diamond"].map(style=><option key={style} value={style}>{style[0]!.toUpperCase()+style.slice(1)}</option>)}</select></label></div>
      {number("Fill gradient angle",gradient.angle,value=>change({angle:value}),-3600,3600,"Angle","°")}{number("Fill gradient scale (%)",gradient.scale,value=>change({scale:value}),10,150,"Scale","%")}
      {number("Fill gradient offset X (%)",gradient.offset[0],value=>change({offset:[value,gradient.offset[1]]}),-10000,10000,"Offset X","%")}{number("Fill gradient offset Y (%)",gradient.offset[1],value=>change({offset:[gradient.offset[0],value]}),-10000,10000,"Offset Y","%")}
      {([ ["reverse","Reverse colors","Reverse"],["dither","Dither","Dither"],["align","Align with layer","Align with Layer"] ] as const).map(([key,name,text])=><div key={key} className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input type="checkbox" aria-label={name} disabled={busy} checked={gradient[key]} onChange={event=>change({[key]:event.target.checked})}/>{text}</label></div>)}
    </div>
      <details open><summary>Color stops</summary>{gradient.stops.map(([position,color],index)=><div key={index}><div className="xd-ps-dialog-grid">{number(`Fill stop ${index+1} position (%)`,position*100,value=>change({stops:gradient.stops.map((stop,i)=>i===index?[value/100,color] as [number,string]:stop).sort((a,b)=>a[0]-b[0]),midpoints:[]}),0,100,"Location","%")}<div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Color:</span><input aria-label={`Fill stop ${index+1} color`} type="color" disabled={busy} value={color.slice(0,7)} onChange={event=>change({stops:gradient.stops.map((stop,i)=>i===index?[position,event.target.value+(color.length===9?color.slice(7):"")] as [number,string]:stop)})}/></label></div>{number(`Fill stop ${index+1} color opacity (%)`,color.length===9?parseInt(color.slice(7),16)/255*100:100,value=>change({stops:gradient.stops.map((stop,i)=>i===index?[position,color.slice(0,7)+Math.round(value/100*255).toString(16).padStart(2,"0")] as [number,string]:stop)}),0,100,"Opacity","%")}</div><button type="button" disabled={busy||gradient.stops.length<=2} onClick={()=>change({stops:gradient.stops.filter((_,i)=>i!==index),midpoints:[]})}>Remove color stop</button></div>)}<button type="button" disabled={busy||gradient.stops.length>=256} onClick={()=>change({stops:[...gradient.stops,[.5,"#ffffff"] as [number,string]].sort((a,b)=>a[0]-b[0]),midpoints:[]})}>Add color stop</button></details>
      <details><summary>Midpoints</summary><div className="xd-ps-dialog-grid">{gradient.stops.slice(1).map((_,index)=><Fragment key={index}>{number(`Fill midpoint ${index+1} (%)`,(gradient.midpoints[index]??.5)*100,value=>change({midpoints:gradient.stops.slice(1).map((_,i)=>i===index?value/100:gradient.midpoints[i]??.5)}),5,95,`Midpoint ${index+1}`,"%")}</Fragment>)}</div></details>
      <details><summary>Transparency stops</summary>{gradient.transparency.map(([position,opacity],index)=><div key={index}><div className="xd-ps-dialog-grid">{number(`Fill transparency ${index+1} position (%)`,position*100,value=>change({transparency:gradient.transparency.map((stop,i)=>i===index?[value/100,opacity] as [number,number]:stop).sort((a,b)=>a[0]-b[0])}),0,100,"Location","%")}{number(`Fill transparency ${index+1} opacity (%)`,opacity,value=>change({transparency:gradient.transparency.map((stop,i)=>i===index?[position,value] as [number,number]:stop)}),0,100,"Opacity","%")}</div><button type="button" disabled={busy} onClick={()=>change({transparency:gradient.transparency.filter((_,i)=>i!==index)})}>Remove transparency stop</button></div>)}<button type="button" disabled={busy||gradient.transparency.length>=256} onClick={()=>change({transparency:[...gradient.transparency,[.5,100] as [number,number]].sort((a,b)=>a[0]-b[0])})}>Add transparency stop</button></details>
    </div></div>{error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}
