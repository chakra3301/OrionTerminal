import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, FolderPlus, Settings2, StickyNote, Trash2 } from "lucide-react";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { useInfoCursor } from "./InfoPanel";
import { useColorSamplers, useDocumentSamplers } from "./colorSamplers";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { rgbHex, rulerReadout, useAnalysisTool, type RulerLine, type SliceRef, type SliceStyle, type XY } from "./analysisTool";
import type { PhotoAnalysis, PhotoNote, PhotoSlice } from "./types";
import { surfaceFraction } from "./viewTurn";
import { usePreferences } from "./preferences";

type Rect=[number,number,number,number];
type Handle="nw"|"n"|"ne"|"e"|"se"|"s"|"sw"|"w";
type Drag=
  |{kind:"ruler";part:"new"|"line"|"start"|"end"|"protractor";from:XY;origin:RulerLine}
  |{kind:"count";group:number;index:number;from:XY;origin:XY}
  |{kind:"note";index:number;from:XY;origin:XY}
  |{kind:"sampler";index:number;from:XY;origin:XY}
  |{kind:"slice";part:"new"|"move"|Handle;from:XY;origin:Rect;id:number|null};

export const ANALYSIS_TOOLS=["colorSampler","ruler","note","count","slice","slice.select"];
const SLICE_TOOLS=["slice","slice.select"];
const HANDLES:Handle[]=["nw","n","ne","e","se","s","sw","w"];
const round2=(value:number)=>Math.round(value*100)/100;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const pad=(number:number)=>String(number).padStart(2,"0");
const sliceParams=(slice:SliceRef)=>slice.id!==null?{slice:slice.id}:{number:slice.number};
const run=(id:string,params:Record<string,unknown>)=>runPhotoCommand(id,params).catch(()=>undefined);

export const findSlice=(slices:PhotoSlice[],ref:SliceRef|null)=>ref&&slices.find(slice=>ref.id!==null?slice.id===ref.id:slice.id===null&&slice.number===ref.number)||null;
/** User and layer slices sit above auto slices; where they overlap the smallest wins, as the engine keeps no stacking order. */
function sliceAt(slices:PhotoSlice[],[x,y]:XY) {
  return slices.filter(({rect:[sx,sy,w,h]})=>x>=sx&&y>=sy&&x<sx+w&&y<sy+h).sort((a,b)=>Number(a.id===null)-Number(b.id===null)||a.rect[2]*a.rect[3]-b.rect[2]*b.rect[3])[0]??null;
}
/** Shift keeps the ruler on 45° steps, projecting the pointer onto the nearest one. */
function constrain(from:XY,to:XY):XY {
  const dx=to[0]-from[0],dy=to[1]-from[1],a=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4,length=dx*Math.cos(a)+dy*Math.sin(a);
  return [round2(from[0]+length*Math.cos(a)),round2(from[1]+length*Math.sin(a))];
}
function dragRuler({part,from,origin}:Extract<Drag,{kind:"ruler"}>,[x,y]:XY,shift:boolean):RulerLine {
  const by=(point:XY):XY=>[round2(point[0]+x-from[0]),round2(point[1]+y-from[1])];
  switch(part){
    case "new":return {...origin,end:shift?constrain(origin.start,[x,y]):[round2(x),round2(y)]};
    case "line":return {start:by(origin.start),end:by(origin.end),protractor:origin.protractor&&by(origin.protractor)};
    case "start":return {...origin,start:by(origin.start)};
    default:{const point=by(origin[part]!);return {...origin,[part]:shift?constrain(origin.start,point):point};}
  }
}
const normalRect=([x,y,w,h]:Rect):Rect=>{const x0=Math.round(Math.min(x,x+w)),y0=Math.round(Math.min(y,y+h));return [x0,y0,Math.round(Math.max(x,x+w))-x0,Math.round(Math.max(y,y+h))-y0];};
function dragSlice({part,from,origin}:Extract<Drag,{kind:"slice"}>,[x,y]:XY,shift:boolean,{style,ratio,size}:{style:SliceStyle;ratio:XY;size:XY}):Rect {
  const dx=x-from[0],dy=y-from[1];
  if(part==="new"){
    if(style==="size")return [Math.round(x),Math.round(y),size[0],size[1]];
    let w=Math.abs(dx),h=Math.abs(dy);
    if(style==="ratio"){w=Math.max(w,h*ratio[0]/ratio[1]);h=w*ratio[1]/ratio[0];}
    else if(shift)w=h=Math.max(w,h);
    return normalRect([from[0],from[1],Math.sign(dx||1)*w,Math.sign(dy||1)*h]);
  }
  if(part==="move")return [Math.round(origin[0]+dx),Math.round(origin[1]+dy),origin[2],origin[3]];
  let [x0,y0,x1,y1]=[origin[0],origin[1],origin[0]+origin[2],origin[1]+origin[3]];
  if(part.includes("w"))x0+=dx;
  if(part.includes("e"))x1+=dx;
  if(part.includes("n"))y0+=dy;
  if(part.includes("s"))y1+=dy;
  return normalRect([x0,y0,x1-x0,y1-y0]);
}
const handleAt=(handle:Handle,[x,y,w,h]:Rect):XY=>[handle.includes("w")?x:handle.includes("e")?x+w:x+w/2,handle.includes("n")?y:handle.includes("s")?y+h:y+h/2];

/** The Ruler line, color samplers, count markers, notes and slices over the image, and the pointer work of the tools that edit them. `samplers` shows the color samplers, which Photoshop shows only with the Color Sampler Tool or the Info panel. */
export function AnalysisOverlay({tool,documentId,width,height,zoom,analysis,active,extras,samplers,openNotes}:{tool:string;documentId:string;width:number;height:number;zoom:number;analysis:PhotoAnalysis|undefined;active:boolean;extras:boolean;samplers:boolean;openNotes:()=>void}) {
  const svg=useRef<SVGSVGElement>(null),drag=useRef<Drag|null>(null);
  const tools=useAnalysisTool(),[moved,setMoved]=useState<XY|null>(null),[box,setBox]=useState<{id:number|null;rect:Rect}|null>(null);
  const slices=analysis?.slices??[],selected=findSlice(slices,tools.slice),locked=!!analysis?.slicesLocked;
  const sliceLines=usePreferences(s=>s.slices);
  const shownSlices=extras?slices.filter(slice=>slice.id!==null||SLICE_TOOLS.includes(tool)&&!tools.hideAuto):[];
  const ruler=tool==="ruler"?tools.ruler??analysis?.ruler??null:null,unit=1/zoom;
  const samplerPoints=useDocumentSamplers(documentId),inside=([x,y]:XY)=>x>=0&&y>=0&&x<width&&y<height,pixel=([x,y]:XY)=>({x:Math.floor(x),y:Math.floor(y)});
  const sampled=(current:Extract<Drag,{kind:"sampler"}>,p:XY):XY=>[current.origin[0]+p[0]-current.from[0],current.origin[1]+p[1]-current.from[1]];
  const at=(event:{clientX:number;clientY:number}):XY=>{const [fx,fy]=surfaceFraction(svg.current!,event.clientX,event.clientY);return [fx*width,fy*height];};
  const point=(event:{clientX:number;clientY:number}):XY=>{const [x,y]=at(event);return [round2(x),round2(y)];};
  const begin=(event:PointerEvent<SVGElement>,next:Drag)=>{event.preventDefault();event.stopPropagation();svg.current!.setPointerCapture(event.pointerId);drag.current=next;};
  const usable=(event:PointerEvent<SVGElement>,on:string)=>active&&tool===on&&event.button===0;
  const down=(event:PointerEvent<SVGSVGElement>)=>{
    if(!active||event.button!==0)return;
    const p=point(event);
    if(tool==="ruler")begin(event,{kind:"ruler",part:"new",from:p,origin:{start:p,end:p,protractor:null}});
    else if(tool==="colorSampler"){event.preventDefault();if(!event.altKey&&inside(p))useColorSamplers.getState().add(documentId,pixel(p));}
    else if(tool==="count"){event.preventDefault();void run(event.altKey?"count.remove":"count.add",event.altKey?{x:p[0],y:p[1],radius:round2(6/zoom)}:{x:p[0],y:p[1]});}
    else if(tool==="note"){event.preventDefault();void runPhotoCommand("notes.add",{x:p[0],y:p[1],author:tools.author,color:tools.noteColor}).then(result=>{const index=(result as {index?:unknown}|undefined)?.index;if(typeof index==="number"){tools.set({note:index});openNotes();}},()=>{});}
    else if(tool==="slice"&&!locked){begin(event,{kind:"slice",part:"new",from:p,origin:[p[0],p[1],0,0],id:null});if(tools.style==="size")setBox({id:null,rect:dragSlice(drag.current as Extract<Drag,{kind:"slice"}>,p,false,tools)});}
    else if(tool==="slice.select"){
      const hit=sliceAt(shownSlices,p);tools.set({slice:hit&&{id:hit.id,number:hit.number}});
      if(hit?.origin==="user"&&!locked)begin(event,{kind:"slice",part:"move",from:p,origin:hit.rect,id:hit.id});
    }
  };
  const move=(event:PointerEvent<SVGSVGElement>)=>{
    const p=at(event),current=drag.current;useInfoCursor.getState().set(p);
    if(!current)return;
    if(current.kind==="ruler")tools.set({ruler:dragRuler(current,p,event.shiftKey)});
    else if(current.kind==="slice")setBox({id:current.id,rect:dragSlice(current,p,event.shiftKey,tools)});
    else if(current.kind==="sampler"){const to=sampled(current,p);if(inside(to))useColorSamplers.getState().move(documentId,current.index,pixel(to));}
    else setMoved([round2(current.origin[0]+p[0]-current.from[0]),round2(current.origin[1]+p[1]-current.from[1])]);
  };
  const cancel=()=>{const current=drag.current;if(current?.kind==="sampler")useColorSamplers.getState().move(documentId,current.index,pixel(current.origin));drag.current=null;tools.set({ruler:null});setMoved(null);setBox(null);};
  // What was dragged stays until the edited state arrives, so it never snaps back for a moment.
  const up=(event:PointerEvent<SVGSVGElement>)=>{
    const current=drag.current;if(!current)return;drag.current=null;
    if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);
    const p=at(event);
    if(current.kind==="ruler"){
      const line=dragRuler(current,p,event.shiftKey);
      if(same(line,current.origin)){tools.set({ruler:null});return;}
      tools.set({ruler:line});void run("image.analysis.rulerTool",{start:line.start,end:line.end,protractor:line.protractor}).finally(()=>tools.set({ruler:null}));
    }else if(current.kind==="slice"){
      const rect=dragSlice(current,p,event.shiftKey,tools);
      if(current.part==="new"){
        if(!rect[2]||!rect[3]){setBox(null);return;}
        void runPhotoCommand("slice.new",{rect}).then(result=>{const {slice,number}=(result??{}) as {slice?:unknown;number?:unknown};if(typeof slice==="number"&&typeof number==="number")tools.set({slice:{id:slice,number}});},()=>{}).finally(()=>setBox(null));
      }else if(same(rect,current.origin)||!rect[2]||!rect[3])setBox(null);
      else void run("slice.set",{slice:current.id,rect}).finally(()=>setBox(null));
    }else if(current.kind==="sampler"){
      // Photoshop deletes a sampler dragged off the image.
      const to=sampled(current,p),samplers=useColorSamplers.getState();
      if(inside(to))samplers.move(documentId,current.index,pixel(to));else samplers.remove(documentId,current.index);
    }else{
      const to:XY=[round2(current.origin[0]+p[0]-current.from[0]),round2(current.origin[1]+p[1]-current.from[1])];
      if(same(to,current.origin)){setMoved(null);return;}
      void (current.kind==="count"?run("count.move",{group:current.group,index:current.index,to}):run("notes.set",{index:current.index,x:to[0],y:to[1]})).finally(()=>setMoved(null));
    }
  };
  const doubleClick=(event:MouseEvent<SVGSVGElement>)=>{
    if(!active||tool!=="slice.select"||locked)return;
    const hit=sliceAt(shownSlices,at(event));
    if(hit)tools.set({slice:{id:hit.id,number:hit.number},dialog:"options"});
  };
  const grabRuler=(event:PointerEvent<SVGElement>,part:"start"|"end"|"protractor")=>{
    if(!usable(event,"ruler")||!ruler)return;
    const p=point(event),vertex=ruler[part]!;
    // Alt-dragging an end of a single line starts the protractor's second line from that end.
    if(event.altKey&&!ruler.protractor&&part!=="protractor")begin(event,{kind:"ruler",part:"protractor",from:p,origin:{start:vertex,end:part==="end"?ruler.start:ruler.end,protractor:vertex}});
    else begin(event,{kind:"ruler",part,from:p,origin:ruler});
  };
  const dragging=drag.current;
  const divide=tools.divide;
  return <svg ref={svg} className={`xd-photo-analysis${active?" is-active":""}`} data-tool={tool} viewBox={`0 0 ${width} ${height}`} aria-label="Analysis overlay" style={{"--xd-photo-slice":sliceLines.color} as CSSProperties}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={()=>{if(!drag.current)useInfoCursor.getState().set(null);}} onDoubleClick={doubleClick}>
    {active&&<rect className="xd-photo-analysis-hit" width={width} height={height}/>}
    {shownSlices.map(slice=>{
      const [x,y,w,h]=box&&box.id!==null&&box.id===slice.id?box.rect:slice.rect,mine=slice===selected&&SLICE_TOOLS.includes(tool);
      return <g key={`${slice.id??"auto"}/${slice.number}`} aria-label={`Slice ${pad(slice.number)}`} className={`xd-photo-slice ${slice.origin}${mine?" selected":""}`}>
        <rect x={x} y={y} width={w} height={h} vectorEffect="non-scaling-stroke"/>
        {sliceLines.numbers&&<><rect className="xd-photo-slice-badge" x={x} y={y} width={18*unit} height={12*unit}/>
        <text x={x+3*unit} y={y+9.5*unit} fontSize={9*unit}>{pad(slice.number)}</text></>}
        {mine&&tool==="slice.select"&&slice.origin==="user"&&!locked&&HANDLES.map(handle=>{const [hx,hy]=handleAt(handle,[x,y,w,h]);return <rect key={handle} className="xd-photo-slice-handle" data-handle={handle} aria-label={`Slice handle ${handle}`} x={hx-3*unit} y={hy-3*unit} width={6*unit} height={6*unit} vectorEffect="non-scaling-stroke"
          onPointerDown={event=>{if(usable(event,"slice.select"))begin(event,{kind:"slice",part:handle,from:point(event),origin:slice.rect,id:slice.id});}}/>;})}
      </g>;
    })}
    {box&&box.id===null&&<rect className="xd-photo-slice-draft" x={box.rect[0]} y={box.rect[1]} width={box.rect[2]} height={box.rect[3]} vectorEffect="non-scaling-stroke"/>}
    {divide&&<g aria-label="Divide preview" className="xd-photo-slice-divide">
      {Array.from({length:divide.down-1},(_,i)=>{const y=divide.rect[1]+Math.floor(divide.rect[3]*(i+1)/divide.down);return <line key={`h${i}`} x1={divide.rect[0]} x2={divide.rect[0]+divide.rect[2]} y1={y} y2={y} vectorEffect="non-scaling-stroke"/>;})}
      {Array.from({length:divide.across-1},(_,i)=>{const x=divide.rect[0]+Math.floor(divide.rect[2]*(i+1)/divide.across);return <line key={`v${i}`} x1={x} x2={x} y1={divide.rect[1]} y2={divide.rect[1]+divide.rect[3]} vectorEffect="non-scaling-stroke"/>;})}
    </g>}
    {extras&&analysis?.count.groups.map((group,g)=>group.visible&&group.points.map((origin,i)=>{
      const [x,y]=moved&&dragging?.kind==="count"&&dragging.group===g&&dragging.index===i?moved:origin,r=group.markerSize*unit;
      return <g key={`${g}/${i}`} aria-label={`${group.name} marker ${i+1}`} className="xd-photo-count-marker" style={{color:rgbHex(group.color)}}
        onPointerDown={event=>{if(usable(event,"count")&&!event.altKey)begin(event,{kind:"count",group:g,index:i,from:point(event),origin});}}>
        <circle cx={x} cy={y} r={Math.max(r,4*unit)} className="xd-photo-count-hit"/>
        <circle cx={x} cy={y} r={r}/>
        <text x={x+r+2*unit} y={y-r-2*unit} fontSize={group.labelSize*unit}>{i+1}</text>
      </g>;
    }))}
    {extras&&samplers&&samplerPoints.map((sampler,i)=>{
      const x=sampler.x+.5,y=sampler.y+.5,s=4*unit;
      return <g key={i} aria-label={`Color sampler ${i+1}`} className="xd-photo-color-sampler"
        onPointerDown={event=>{if(!usable(event,"colorSampler"))return;if(event.altKey){event.preventDefault();event.stopPropagation();useColorSamplers.getState().remove(documentId,i);}else begin(event,{kind:"sampler",index:i,from:point(event),origin:[sampler.x,sampler.y]});}}>
        <circle cx={x} cy={y} r={2*s} className="xd-photo-count-hit"/>
        <circle cx={x} cy={y} r={s} vectorEffect="non-scaling-stroke"/>
        <path d={`M${x-2*s} ${y}h${1.5*s}M${x+.5*s} ${y}h${1.5*s}M${x} ${y-2*s}v${1.5*s}M${x} ${y+.5*s}v${1.5*s}`} vectorEffect="non-scaling-stroke"/>
        <text x={x+s+2*unit} y={y+2*s+2*unit} fontSize={10*unit}>{i+1}</text>
      </g>;
    })}
    {extras&&analysis?.notes.map(note=>{
      const [x,y]=moved&&dragging?.kind==="note"&&dragging.index===note.index?moved:note.position,w=16*unit,h=14*unit;
      return <path key={note.index} aria-label={`Note ${note.index+1}`} className={`xd-photo-note${note.index===tools.note?" selected":""}`} fill={rgbHex(note.color)} d={`M${x} ${y}h${w}v${h*.65}l${-w*.35} ${h*.35}H${x}Z`} vectorEffect="non-scaling-stroke"
        onPointerDown={event=>{if(!usable(event,"note"))return;tools.set({note:note.index});begin(event,{kind:"note",index:note.index,from:point(event),origin:note.position});}}
        onDoubleClick={event=>{if(tool!=="note")return;event.stopPropagation();tools.set({note:note.index});openNotes();}}/>;
    })}
    {ruler&&<g className="xd-photo-ruler" aria-label="Ruler line">
      <polyline points={[...(ruler.protractor?[ruler.protractor]:[]),ruler.start,ruler.end].map(p=>p.join(",")).join(" ")} vectorEffect="non-scaling-stroke"/>
      {(["start","end","protractor"] as const).map(part=>{const p=ruler[part];if(!p)return null;const s=4*unit;
        return <g key={part} aria-label={`Ruler ${part} point`} className="xd-photo-ruler-point" onPointerDown={event=>grabRuler(event,part)}>
          <circle cx={p[0]} cy={p[1]} r={5*unit}/><path d={`M${p[0]-s} ${p[1]}h${2*s}M${p[0]} ${p[1]-s}v${2*s}`} vectorEffect="non-scaling-stroke"/>
        </g>;})}
    </g>}
  </svg>;
}

/** A number box that commits on blur or Enter, clamped and rounded like the engine's ranges. */
function NumberField({label,title,value,min,max,digits=0,disabled,commit}:{label:string;title:string;value:number;min:number;max:number;digits?:number;disabled?:boolean;commit:(value:number)=>void}) {
  const [draft,setDraft]=useState<string|null>(null);
  const done=()=>{
    if(draft===null)return;
    setDraft(null);const number=Number(draft);if(draft.trim()===""||!Number.isFinite(number))return;
    const next=Math.round(Math.max(min,Math.min(max,number))*10**digits)/10**digits;
    if(next!==value)commit(next);
  };
  return <label>{title}:<input aria-label={label} className="xd-ps-number" type="number" min={min} max={max} step={10**-digits} disabled={disabled} value={draft??value} onChange={event=>setDraft(event.target.value)} onBlur={done} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur();}}/></label>;
}
/** The native picker fires `input` while it is open; only its `change` commits, so a drag through colours is one edit. */
function ColorField({label,value,disabled,commit}:{label:string;value:string;disabled?:boolean;commit:(value:string)=>void}) {
  const input=useRef<HTMLInputElement>(null),latest=useRef(commit),[draft,setDraft]=useState<string|null>(null);
  latest.current=commit;
  useEffect(()=>{const element=input.current!,change=()=>{setDraft(null);if(element.value!==value)latest.current(element.value);};element.addEventListener("change",change);return()=>element.removeEventListener("change",change);},[value]);
  return <input ref={input} type="color" aria-label={label} disabled={disabled} value={draft??value} onChange={event=>setDraft(event.target.value)}/>;
}

/** The options bar of the Ruler, Count, Note, Slice and Slice Select tools. */
export function AnalysisOptions({tool,analysis,toggleNotes}:{tool:string;analysis:PhotoAnalysis|undefined;toggleNotes:()=>void}) {
  const tools=useAnalysisTool(),busy=usePhotoWorkspace(s=>s.busy);
  if(tool==="ruler"){
    const line=tools.ruler??analysis?.ruler??null,info=line&&rulerReadout(line),value=(n:number)=>String(round2(n));
    const cells:[string,string][]=[["X",info?value(info.x):""],["Y",info?value(info.y):""],["W",info?value(info.w):""],["H",info?value(info.h):""],["A",info?`${info.angle.toFixed(1)}°`:""],["L1",info?info.l1.toFixed(2):""],["L2",info?.l2!=null?info.l2.toFixed(2):""]];
    return <>
      {cells.map(([label,text])=><label key={label} className="xd-ps-readout">{label}:<output aria-label={`Ruler ${label}`}>{text}</output></label>)}
      <button disabled={busy||!analysis?.ruler} title="Level the active layer along the ruler line · Alt-click to straighten without cropping" onClick={event=>void run("image.analysis.straightenLayer",event.altKey?{crop:false}:{})}>Straighten Layer</button>
      <button aria-label="Clear ruler" title="Clear the ruler line" disabled={busy||!analysis?.ruler} onClick={()=>void run("image.analysis.rulerTool",{clear:true})}>Clear</button>
    </>;
  }
  if(tool==="count"){
    const count=analysis?.count,groups=count?.groups??[],index=count?.activeGroup??0,group=groups[index];
    const edit=(patch:Record<string,unknown>)=>void run("count.setGroup",{group:index,...patch});
    return <>
      <span className="xd-ps-readout" aria-label="Count total">Count: {count?.total??0}</span>
      <select aria-label="Count group" disabled={busy||!groups.length} value={index} onChange={event=>void run("count.setGroup",{group:Number(event.target.value),active:true})}>{groups.map((item,i)=><option key={i} value={i}>{item.name}</option>)}</select>
      <button aria-label="Toggle count group visibility" title="Toggle count group visibility" disabled={busy||!group} onClick={()=>edit({visible:!group!.visible})}>{group?.visible===false?<EyeOff size={14}/>:<Eye size={14}/>}</button>
      <button aria-label="New count group" title="Create a new count group" disabled={busy} onClick={()=>void run("count.newGroup",{})}><FolderPlus size={14}/></button>
      <button aria-label="Delete count group" title="Delete the current count group" disabled={busy||!group} onClick={()=>void run("count.deleteGroup",{group:index})}><Trash2 size={14}/></button>
      <button aria-label="Clear count" title="Reset the count of the current group" disabled={busy||!group?.points.length} onClick={()=>void run("count.clear",{})}>Clear</button>
      <ColorField label="Count group color" value={group?rgbHex(group.color):"#000000"} disabled={busy||!group} commit={color=>edit({color})}/>
      <NumberField label="Marker size" title="Marker Size" min={1} max={10} value={group?.markerSize??1} disabled={busy||!group} commit={markerSize=>edit({markerSize})}/>
      <NumberField label="Label size" title="Label Size" min={8} max={72} value={group?.labelSize??8} disabled={busy||!group} commit={labelSize=>edit({labelSize})}/>
    </>;
  }
  if(tool==="note")return <>
    <label>Author:<input aria-label="Note author" value={tools.author} onChange={event=>tools.set({author:event.target.value})}/></label>
    <label>Color:<input type="color" aria-label="Note color" value={tools.noteColor} onChange={event=>tools.set({noteColor:event.target.value})}/></label>
    <button aria-label="Clear all notes" disabled={busy||!analysis?.notes.length} onClick={()=>void run("notes.delete",{all:true})}>Clear All</button>
    <button aria-label="Show or hide the Notes panel" title="Show or hide the Notes panel" onClick={toggleNotes}><StickyNote size={14}/></button>
  </>;
  if(tool==="slice"){
    const ratio=tools.style!=="size",pair=ratio?tools.ratio:tools.size,change=(axis:0|1,value:number)=>{const next:XY=[...pair];next[axis]=value;tools.set(ratio?{ratio:next}:{size:next});};
    const limits=ratio?{min:.001,max:1000,digits:3}:{min:1,max:30000,digits:0};
    return <>
      <label>Style:<select aria-label="Slice style" value={tools.style} onChange={event=>tools.set({style:event.target.value as SliceStyle})}><option value="normal">Normal</option><option value="ratio">Fixed Aspect Ratio</option><option value="size">Fixed Size</option></select></label>
      <NumberField label="Slice width" title="Width" {...limits} value={pair[0]} disabled={tools.style==="normal"} commit={value=>change(0,value)}/>
      <NumberField label="Slice height" title="Height" {...limits} value={pair[1]} disabled={tools.style==="normal"} commit={value=>change(1,value)}/>
    </>;
  }
  if(tool==="slice.select"){
    const selected=findSlice(analysis?.slices??[],tools.slice),locked=!!analysis?.slicesLocked;
    return <>
      <button disabled={busy||locked||!selected||selected.origin==="user"} title="Turn the selected auto or layer-based slice into a user slice" onClick={()=>void run("slice.promote",sliceParams(selected!))}>Promote</button>
      <button disabled={busy||locked||!selected} onClick={()=>tools.set({dialog:"divide"})}>Divide…</button>
      <button onClick={()=>tools.set({hideAuto:!tools.hideAuto})}>{tools.hideAuto?"Show Auto Slices":"Hide Auto Slices"}</button>
      <button aria-label="Slice Options" title="Set options for the current slice" disabled={busy||locked||!selected} onClick={()=>tools.set({dialog:"options"})}><Settings2 size={14}/></button>
    </>;
  }
  return null;
}

/** Photoshop's Notes panel: the selected note's text, stepping through the notes, and deleting one. */
export function NotesPanel({notes}:{notes:PhotoNote[]}) {
  const busy=usePhotoWorkspace(s=>s.busy),selected=useAnalysisTool(s=>s.note),set=useAnalysisTool(s=>s.set);
  const current=Math.max(0,Math.min(selected,notes.length-1)),note=notes[current]??null,[text,setText]=useState(note?.text??"");
  useEffect(()=>setText(note?.text??""),[note?.index,note?.text]);
  const commit=()=>{if(note&&text!==note.text)void run("notes.set",{index:note.index,text});};
  const go=(index:number)=>{commit();set({note:index});};
  return <div className="xd-photo-notes" role="group" aria-label="Notes">
    <textarea aria-label="Note text" disabled={busy||!note} value={text} onChange={event=>setText(event.target.value)} onBlur={commit}/>
    <div className="xd-photo-notes-bar">
      <button aria-label="Previous note" title="Previous note" disabled={current<=0} onClick={()=>go(current-1)}><ChevronLeft size={14}/></button>
      <button aria-label="Next note" title="Next note" disabled={current>=notes.length-1} onClick={()=>go(current+1)}><ChevronRight size={14}/></button>
      <output aria-label="Notes position">{notes.length?`${current+1} of ${notes.length}`:""}</output>
      <button aria-label="Delete note" title="Delete note" disabled={busy||!note} onClick={()=>void run("notes.delete",{index:note!.index})}><Trash2 size={14}/></button>
    </div>
  </div>;
}

const BACKGROUNDS:[string,string][]=[["none","None"],["#ffffff","White"],["#000000","Black"],["other","Other"]];

function SliceOptionsDialog({slice,close}:{slice:PhotoSlice;close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error),dialog=useDesignDialog<HTMLFormElement>(close,busy);
  const [fields,setFields]=useState({kind:slice.kind,name:slice.name,url:slice.url,target:slice.target,message:slice.message,alt:slice.alt,cellText:slice.cellText});
  const [rect,setRect]=useState<Rect>(slice.rect),[background,setBackground]=useState(slice.background??"none");
  const kind=BACKGROUNDS.some(([value])=>value===background)?background:"other";
  const text=(key:keyof typeof fields,label:string,title:string)=><label className="xd-ps-dialog-field"><span>{title}:</span><input aria-label={label} value={fields[key]} onChange={event=>setFields(current=>({...current,[key]:event.target.value}))}/></label>;
  const submit=()=>void runPhotoCommand("slice.set",{...sliceParams(slice),...fields,background,...(same(rect,slice.rect)?{}:{rect})}).then(close,()=>{});
  return <PhotoDialog dialog={dialog} title="Slice Options" busy={busy} close={close} onSubmit={event=>{event.preventDefault();submit();}}>
    <div className="xd-ps-dialog-grid">
      <label className="xd-ps-dialog-field"><span>Slice Type:</span><select aria-label="Slice type" value={fields.kind} onChange={event=>setFields(current=>({...current,kind:event.target.value}))}><option value="image">Image</option><option value="noImage">No Image</option><option value="table">Table</option></select></label>
      {text("name","Slice name","Name")}
      {fields.kind==="noImage"?<label className="xd-ps-dialog-field"><span>Text Displayed in Cell:</span><textarea aria-label="Slice cell text" value={fields.cellText} onChange={event=>setFields(current=>({...current,cellText:event.target.value}))}/></label>:<>{text("url","Slice URL","URL")}{text("target","Slice target","Target")}</>}
      {text("message","Slice message","Message Text")}
      {fields.kind!=="noImage"&&text("alt","Slice alt","Alt Tag")}
    </div>
    <fieldset className="xd-ps-dialog-group"><legend>Dimensions</legend><div className="xd-ps-dialog-grid">
      {(["X","Y","W","H"] as const).map((label,i)=><label key={label} className="xd-ps-dialog-field"><span>{label}:</span><input aria-label={`Dimensions ${label}`} type="number" min={i<2?0:1} disabled={slice.origin==="layer"} value={rect[i]} onChange={event=>{const value=Math.round(event.target.valueAsNumber);if(Number.isFinite(value))setRect(current=>current.map((v,j)=>j===i?value:v) as Rect);}}/><span>px</span></label>)}
    </div></fieldset>
    <label className="xd-ps-dialog-field"><span>Slice Background Type:</span><select aria-label="Slice background" value={kind} onChange={event=>setBackground(event.target.value==="other"?"#808080":event.target.value)}>{BACKGROUNDS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      {kind==="other"&&<input type="color" aria-label="Slice background color" value={background} onChange={event=>setBackground(event.target.value)}/>}</label>
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}

function DivideSliceDialog({slice,close}:{slice:PhotoSlice;close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error),dialog=useDesignDialog<HTMLFormElement>(close,busy),set=useAnalysisTool(s=>s.set);
  const [down,setDown]=useState({on:true,count:2}),[across,setAcross]=useState({on:false,count:2}),[preview,setPreview]=useState(true);
  const horizontal=down.on?down.count:1,vertical=across.on?across.count:1,[x,y,w,h]=slice.rect;
  useEffect(()=>{set({divide:preview&&(horizontal>1||vertical>1)?{rect:[x,y,w,h],down:horizontal,across:vertical}:null});},[set,preview,horizontal,vertical,x,y,w,h]);
  useEffect(()=>()=>set({divide:null}),[set]);
  const axis=(title:string,label:string,unit:string,value:{on:boolean;count:number},change:(value:{on:boolean;count:number})=>void,max:number)=><fieldset className="xd-ps-dialog-group"><legend><label className="xd-ps-dialog-check"><input type="checkbox" aria-label={title} checked={value.on} onChange={event=>change({...value,on:event.target.checked})}/>{title}</label></legend>
    <label className="xd-ps-dialog-field"><input aria-label={label} type="number" min={2} max={max} disabled={!value.on} value={value.count} onChange={event=>{const count=Math.round(event.target.valueAsNumber);if(Number.isFinite(count))change({...value,count:Math.max(2,Math.min(max,count))});}}/><span>{unit}, evenly spaced</span></label>
  </fieldset>;
  return <PhotoDialog dialog={dialog} title="Divide Slice" busy={busy} okDisabled={horizontal===1&&vertical===1} close={close} preview={{checked:preview,change:setPreview}} onSubmit={event=>{event.preventDefault();void runPhotoCommand("slice.divide",{...sliceParams(slice),horizontal,vertical}).then(close,()=>{});}}>
    {axis("Divide Horizontally Into","Slices down","slices down",down,setDown,Math.max(2,h))}
    {axis("Divide Vertically Into","Slices across","slices across",across,setAcross,Math.max(2,w))}
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}

/** Slice Options and Divide Slice, opened from the Slice Select tool. */
export function AnalysisDialogs({analysis}:{analysis:PhotoAnalysis|undefined}) {
  const dialog=useAnalysisTool(s=>s.dialog),ref=useAnalysisTool(s=>s.slice),set=useAnalysisTool(s=>s.set);
  const slice=findSlice(analysis?.slices??[],ref);
  if(!dialog||!slice)return null;
  const close=()=>set({dialog:null});
  return dialog==="options"?<SliceOptionsDialog key={`${slice.id}/${slice.number}`} slice={slice} close={close}/>:<DivideSliceDialog key={`${slice.id}/${slice.number}`} slice={slice} close={close}/>;
}
