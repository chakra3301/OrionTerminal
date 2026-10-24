import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { PhotoDocument, PhotoLayer } from "./types";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import { useDesignDialog } from "../useDesignDialog";
import { beginXDesignActivity } from "../runtimeActivity";

export type GeometryKind="liquify"|"puppet"|"perspective"|"warp";
type XY=[number,number];
type Pin={src:XY;dst:XY;rotate:number;depth:number};
type Plane={src:XY[];dst:XY[]};
type Stroke={tool:string;size:number;density:number;pressure:number;rate:number;points:XY[]};
export const MAX_LIQUIFY_POINTS=16_384;
export function appendLiquifyPoint(points:XY[],point:XY,budget:number=MAX_LIQUIFY_POINTS):"added"|"same"|"limit" {
  if(points.at(-1)?.every((value,index)=>value===point[index]))return "same";
  if(points.length>=budget)return "limit";
  points.push(point);return "added";
}
type Mesh={us:number[];vs:number[];points:XY[]};
type Drag={kind:"pin"|"corner"|"mesh";index:number;plane?:number}|{kind:"stroke";stroke:Stroke}|{kind:"plane";start:XY;end:XY};
const TITLES:Record<GeometryKind,string>={liquify:"Liquify",puppet:"Puppet Warp",perspective:"Perspective Warp",warp:"Warp layer"};
const COMMANDS:Record<GeometryKind,string>={liquify:"filter.liquify",puppet:"edit.puppetWarp",perspective:"edit.perspectiveWarp",warp:"edit.transform.warp"};
const WARP_STYLES=["custom","none","arc","arcLower","arcUpper","arch","bulge","shellLower","shellUpper","flag","wave","fish","rise","fisheye","inflate","squeeze","twist"];
const LIQUIFY_TOOLS=["forwardWarp","reconstruct","smooth","twirlCw","twirlCcw","pucker","bloat","pushLeft","freeze","thaw","lassoMask"];
const labelFor=(name:string)=>name.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,value=>value.toUpperCase());
export function geometryPoint(x:number,y:number,bounds:{left:number;top:number;width:number;height:number},width:number,height:number):XY {
  const scale=Math.min(bounds.width/width,bounds.height/height);
  if(!Number.isFinite(scale)||scale<=0)return [0,0];
  return [(x-bounds.left-(bounds.width-width*scale)/2)/scale,(y-bounds.top-(bounds.height-height*scale)/2)/scale];
}
export function identityWarpMesh(rect:number[],patches:number):Mesh {
  const [x0,y0,x1,y1]=rect as [number,number,number,number],side=patches*3+1;
  return {us:Array.from({length:patches+1},(_,index)=>index/patches),vs:Array.from({length:patches+1},(_,index)=>index/patches),points:Array.from({length:side*side},(_,index)=>[x0+(index%side)/(side-1)*(x1-x0),y0+Math.floor(index/side)/(side-1)*(y1-y0)])};
}
export function movePlaneCorner(planes:Plane[],plane:number,index:number,destination:XY):Plane[] {
  const source=planes[plane]!.src[index]!;
  return planes.map(current=>({...current,dst:current.dst.map((point,i)=>Math.abs(current.src[i]![0]-source[0])<.001&&Math.abs(current.src[i]![1]-source[1])<.001?destination:point)}));
}
export function GeometryDialog({kind,document,layer,close,canvas}:{kind:GeometryKind;document:PhotoDocument;layer:PhotoLayer;close:()=>void;canvas?:{element:HTMLElement;zoom:number}}) {
  const busy=usePhotoWorkspace(state=>state.busy),projectId=usePhotoWorkspace(state=>state.projectId),workspaceError=usePhotoWorkspace(state=>state.error),viewKey=usePhotoWorkspace(state=>state.state?.viewKey);
  const [x,y,width,height]=layer.bounds??[0,0,document.width,document.height],rect=[x,y,x+Math.max(1,width),y+Math.max(1,height)];
  const corners:XY[]=[[rect[0]!,rect[1]!],[rect[2]!,rect[1]!],[rect[2]!,rect[3]!],[rect[0]!,rect[3]!]];
  const [pins,setPins]=useState<Pin[]>([]),[planes,setPlanes]=useState<Plane[]>([{src:corners,dst:corners}]),[strokes,setStrokes]=useState<Stroke[]>([]),[mesh,setMesh]=useState(()=>identityWarpMesh(rect,1));
  const [selected,setSelected]=useState(0),[patches,setPatches]=useState(1),[addingPlane,setAddingPlane]=useState(false),[draft,setDraft]=useState<Drag|null>(null);
  const [gestureError,setGestureError]=useState<string|null>(null);
  const drag=useRef<Drag|null>(null),surface=useRef<SVGSVGElement|null>(null);
  const pointerId=useRef<number|null>(null),baseline=useRef<{pins:Pin[];planes:Plane[];mesh:Mesh}|null>(null);
  const identity=JSON.stringify([projectId,document.id,document.version,layer.id,kind,viewKey]),initial=useRef(identity),stale=initial.current!==identity;
  useEffect(()=>{if(stale)close();},[stale,close]);
  useEffect(()=>beginXDesignActivity("photo-operation","Apply or cancel the image deformation before switching projects."),[]);
  const [tool,setTool]=useState("forwardWarp"),[size,setSize]=useState(100),[density,setDensity]=useState(50),[pressure,setPressure]=useState(100),[rate,setRate]=useState(80),[mode,setMode]=useState("normal"),[expansion,setExpansion]=useState(2),[style,setStyle]=useState("custom"),[bend,setBend]=useState(50),[hDistort,setH]=useState(0),[vDistort,setV]=useState(0),[vertical,setVertical]=useState(false);
  const inRange=(value:number,min:number,max:number)=>Number.isFinite(value)&&value>=min&&value<=max;
  const validPoint=(point:XY)=>point.every(value=>inRange(value,-1_000_000,1_000_000));
  const hasContent=kind==="liquify"?strokes.length>0||draft?.kind==="stroke":kind==="puppet"?pins.length>0:kind==="perspective"?planes.length>0:true;
  const valid=!!hasContent&&(kind==="liquify"?[inRange(size,1,5000),inRange(density,0,100),inRange(pressure,0,100),inRange(rate,0,100)].every(Boolean)&&strokes.every(stroke=>stroke.points.every(validPoint)):kind==="puppet"?inRange(expansion,0,100)&&pins.every(pin=>validPoint(pin.src)&&validPoint(pin.dst)&&inRange(pin.rotate,-3600,3600)&&inRange(pin.depth,-100,100)):kind==="perspective"?planes.every(plane=>[...plane.src,...plane.dst].every(validPoint)):style==="custom"?mesh.points.every(validPoint):[bend,hDistort,vDistort].every(value=>inRange(value,-100,100)));
  const [live,setLive]=useState(document.width*document.height<=16_777_216);
  const params:Record<string,unknown>={layer:layer.id,interpolation:"bicubic",...(kind==="liquify"?{strokes:[...strokes,...(draft?.kind==="stroke"?[draft.stroke]:[])]}:kind==="puppet"?{pins,mode,density:"normal",expansion}:kind==="perspective"?{planes}:{rect,style,bend,hDistort,vDistort,vertical,...(style==="custom"?{mesh}:{})})};
  const preview=usePhotoCommandPreview(document,projectId,COMMANDS[kind],params,{automatic:live,enabled:valid&&!busy&&!stale}),dialog=useDesignDialog<HTMLFormElement>(close,busy,{additionalRoots:()=>canvas?[surface.current]:[]});
  const point=(event:PointerEvent<SVGSVGElement>):XY=>geometryPoint(event.clientX,event.clientY,event.currentTarget.getBoundingClientRect(),document.width,document.height);
  const capture=(event:PointerEvent,gesture:Drag)=>{pointerId.current=event.pointerId;baseline.current=structuredClone({pins,planes,mesh});drag.current=gesture;setDraft(gesture);surface.current?.setPointerCapture(event.pointerId);};
  const finish=(cancelled=false)=>{
    const gesture=drag.current;drag.current=null;pointerId.current=null;setDraft(null);
    if(cancelled&&baseline.current){setPins(baseline.current.pins);setPlanes(baseline.current.planes);setMesh(baseline.current.mesh);}baseline.current=null;if(cancelled||!gesture)return;
    if(gesture.kind==="stroke"){
      if(JSON.stringify({...params,strokes:[...strokes,gesture.stroke]}).length>900_000){setGestureError("This Liquify stroke exceeds the operation size limit and was cancelled. Apply the existing strokes before continuing.");return;}
      setStrokes(current=>[...current,gesture.stroke]);
    }
    if(gesture.kind==="plane"){
      const [x0,x1]=[gesture.start[0],gesture.end[0]].sort((a,b)=>a-b),[y0,y1]=[gesture.start[1],gesture.end[1]].sort((a,b)=>a-b);
      if(x1!-x0!>1&&y1!-y0!>1){const src:XY[]=[[x0!,y0!],[x1!,y0!],[x1!,y1!],[x0!,y1!]];setPlanes(current=>[...current,{src,dst:src}]);}setAddingPlane(false);
    }
  };
  const number=(label:string,value:number,change:(value:number)=>void,min:number,max:number)=><label>{label}<input aria-label={label} type="number" required min={min} max={max} step="any" disabled={busy} value={value} onChange={event=>change(event.target.valueAsNumber)}/></label>;
  const handle=(position:XY,label:string,gesture:Drag)=><circle aria-label={label} role="button" tabIndex={busy?-1:0} aria-disabled={busy} cx={position[0]} cy={position[1]} r={canvas?5/canvas.zoom:Math.max(document.width,document.height)/90} onPointerDown={event=>{if(busy||event.button!==0||drag.current)return;event.stopPropagation();if(gesture.kind==="pin")setSelected(gesture.index);capture(event,gesture);}} onKeyDown={event=>{
    const delta=event.shiftKey?10:1,dx=event.key==="ArrowLeft"?-delta:event.key==="ArrowRight"?delta:0,dy=event.key==="ArrowUp"?-delta:event.key==="ArrowDown"?delta:0;
    if(!dx&&!dy||busy)return;event.preventDefault();const destination:XY=[position[0]+dx,position[1]+dy];
    if(gesture.kind==="pin")setPins(current=>current.map((pin,index)=>index===gesture.index?{...pin,dst:destination}:pin));
    if(gesture.kind==="corner")setPlanes(current=>movePlaneCorner(current,gesture.plane!,gesture.index,destination));
    if(gesture.kind==="mesh")setMesh(current=>({...current,points:current.points.map((point,index)=>index===gesture.index?destination:point)}));
  }}/>;
  const move=(event:PointerEvent<SVGSVGElement>)=>{
      const gesture=drag.current;if(!gesture||busy||pointerId.current!==event.pointerId)return;const p=point(event);
      if(gesture.kind==="pin")setPins(current=>current.map((pin,index)=>index===gesture.index?{...pin,dst:p}:pin));
      if(gesture.kind==="corner")setPlanes(current=>movePlaneCorner(current,gesture.plane!,gesture.index,p));
      if(gesture.kind==="mesh")setMesh(current=>({...current,points:current.points.map((point,index)=>index===gesture.index?p:point)}));
      if(gesture.kind==="stroke"){
        const result=appendLiquifyPoint(gesture.stroke.points,p,MAX_LIQUIFY_POINTS-strokes.reduce((sum,stroke)=>sum+stroke.points.length,0));
        if(result==="limit"){finish(true);setGestureError("This Liquify stroke was cancelled because the session reached 16,384 points. Apply the existing strokes before continuing.");return;}
        if(result==="added")setDraft({...gesture,stroke:{...gesture.stroke,points:[...gesture.stroke.points]}});
      }
      if(gesture.kind==="plane"){gesture.end=p;setDraft({...gesture});}

  };
  const stage=<svg ref={surface} className={`xd-photo-geometry-stage${canvas?" xd-photo-main-geometry":""}${canvas&&preview.url?" has-preview":""}`} aria-label={`${TITLES[kind]} canvas`} viewBox={`0 0 ${document.width} ${document.height}`} onPointerDown={event=>{
      if(busy||stale||event.button!==0||drag.current)return;const p=point(event);
      if(kind==="liquify"){
        if(strokes.length>=128||strokes.reduce((sum,stroke)=>sum+stroke.points.length,0)>=MAX_LIQUIFY_POINTS){setGestureError("Apply the existing Liquify strokes before starting another gesture.");return;}
        setGestureError(null);capture(event,{kind:"stroke",stroke:{tool,size,density,pressure,rate,points:[p]}});
      }
      if(kind==="puppet"&&pins.length<64){const pin={src:p,dst:p,rotate:0,depth:0};setPins(current=>[...current,pin]);setSelected(pins.length);capture(event,{kind:"pin",index:pins.length});}
      if(kind==="perspective"&&addingPlane&&planes.length<16)capture(event,{kind:"plane",start:p,end:p});
    }} onPointerMove={move} onPointerUp={event=>{if(pointerId.current===event.pointerId){move(event);finish();}}} onPointerCancel={event=>{if(pointerId.current===event.pointerId)finish(true);}} onLostPointerCapture={event=>{if(pointerId.current===event.pointerId)finish(true);}}>
      {(!canvas||preview.url)&&<image href={preview.url??convertFileSrc(document.previewPath)} x="0" y="0" width={document.width} height={document.height}/>}
      {kind==="liquify"&&[...strokes,...(draft?.kind==="stroke"?[draft.stroke]:[])].map((stroke,index)=><polyline className="xd-photo-warp-guide" key={index} points={stroke.points.map(point=>point.join(",")).join(" ")} vectorEffect="non-scaling-stroke"/>)}
      {kind==="puppet"&&pins.map((pin,index)=><g key={index}><line className="xd-photo-warp-guide" x1={pin.src[0]} y1={pin.src[1]} x2={pin.dst[0]} y2={pin.dst[1]} vectorEffect="non-scaling-stroke"/>{handle(pin.dst,`Puppet pin ${index+1}`,{kind:"pin",index})}</g>)}
      {kind==="perspective"&&planes.map((plane,i)=><g key={i}><polygon className="xd-photo-warp-guide" points={plane.dst.map(point=>point.join(",")).join(" ")} vectorEffect="non-scaling-stroke"/>{plane.dst.map((p,index)=><g key={index}>{handle(p,`Plane ${i+1} corner ${index+1}`,{kind:"corner",plane:i,index})}</g>)}</g>)}
      {draft?.kind==="plane"&&<rect className="xd-photo-warp-guide" x={Math.min(draft.start[0],draft.end[0])} y={Math.min(draft.start[1],draft.end[1])} width={Math.abs(draft.end[0]-draft.start[0])} height={Math.abs(draft.end[1]-draft.start[1])} vectorEffect="non-scaling-stroke"/>}
      {kind==="warp"&&style==="custom"&&<>{Array.from({length:patches*3+1},(_,index)=><g key={index}><polyline className="xd-photo-warp-guide" points={mesh.points.slice(index*(patches*3+1),(index+1)*(patches*3+1)).map(point=>point.join(",")).join(" ")} vectorEffect="non-scaling-stroke"/><polyline className="xd-photo-warp-guide" points={mesh.points.filter((_,i)=>i%(patches*3+1)===index).map(point=>point.join(",")).join(" ")} vectorEffect="non-scaling-stroke"/></g>)}{mesh.points.map((p,index)=><g key={index}>{handle(p,`Warp point ${index+1}`,{kind:"mesh",index})}</g>)}</>}
    </svg>;
  const feedback=<><div className="xd-photo-preview-actions"><label><input type="checkbox" checked={live} disabled={busy||document.width*document.height>16_777_216} onChange={event=>setLive(event.target.checked)}/>Live preview</label><button type="button" disabled={busy||preview.loading||!valid} onClick={()=>{void preview.preview();}}>{preview.loading?"Rendering…":"Preview changes"}</button>{preview.url&&<span role="status">{preview.stale?"Updating preview…":"Unapplied preview"}</span>}</div>{preview.error&&<p role="alert">{preview.error}</p>}{gestureError&&<p role="alert">{gestureError}</p>}</>;
  const controls=<div className="xd-photo-special-controls" inert={busy||stale}>
      {kind==="liquify"&&<><label>Tool<select aria-label="Liquify tool" value={tool} onChange={event=>setTool(event.target.value)}>{LIQUIFY_TOOLS.map(tool=><option value={tool} key={tool}>{labelFor(tool)}</option>)}</select></label>{number("Liquify brush size",size,setSize,1,5000)}{number("Liquify density",density,setDensity,0,100)}{number("Liquify pressure",pressure,setPressure,0,100)}{number("Liquify rate",rate,setRate,0,100)}<p>{strokes.length} strokes</p><button type="button" disabled={busy||!strokes.length} onClick={()=>setStrokes(current=>current.slice(0,-1))}>Undo last stroke</button><button type="button" disabled={busy||!strokes.length} onClick={()=>setStrokes([])}>Reset deformation</button></>}
      {kind==="puppet"&&<><label>Mode<select aria-label="Puppet mode" value={mode} onChange={event=>setMode(event.target.value)}>{["rigid","normal","distort"].map(value=><option key={value}>{value}</option>)}</select></label>{number("Mesh expansion",expansion,setExpansion,0,100)}<label>Pin<select aria-label="Selected puppet pin" value={selected} onChange={event=>setSelected(Number(event.target.value))}>{pins.map((_,index)=><option key={index} value={index}>Pin {index+1}</option>)}</select></label>{pins[selected]&&<>{number("Pin X",pins[selected]!.dst[0],value=>setPins(current=>current.map((pin,index)=>index===selected?{...pin,dst:[value,pin.dst[1]]}:pin)),-100000,100000)}{number("Pin Y",pins[selected]!.dst[1],value=>setPins(current=>current.map((pin,index)=>index===selected?{...pin,dst:[pin.dst[0],value]}:pin)),-100000,100000)}{number("Pin rotation",pins[selected]!.rotate,value=>setPins(current=>current.map((pin,index)=>index===selected?{...pin,rotate:value}:pin)),-3600,3600)}{number("Pin depth",pins[selected]!.depth,value=>setPins(current=>current.map((pin,index)=>index===selected?{...pin,depth:value}:pin)),-100,100)}<button type="button" disabled={busy} onClick={()=>{setPins(current=>current.filter((_,index)=>index!==selected));setSelected(0);}}>Remove pin</button></>}</>}
      {kind==="perspective"&&<><button type="button" disabled={busy||planes.length>=16} onClick={()=>setAddingPlane(value=>!value)}>{addingPlane?"Cancel new plane":"Add plane"}</button>{addingPlane&&<p>Drag a rectangle on the image to define a source plane.</p>}{planes.map((_,index)=><div key={index}><span>Plane {index+1}</span><button type="button" disabled={busy} onClick={()=>setPlanes(current=>current.filter((_,i)=>i!==index))}>Remove plane</button></div>)}<button type="button" disabled={busy} onClick={()=>setPlanes(current=>current.map(plane=>({...plane,dst:structuredClone(plane.src)})))}>Reset perspective</button></>}
      {kind==="warp"&&<><label>Style<select aria-label="Warp style" value={style} onChange={event=>setStyle(event.target.value)}>{WARP_STYLES.map(style=><option key={style} value={style}>{labelFor(style)}</option>)}</select></label>{style==="custom"?<><label>Mesh<select aria-label="Warp mesh patches" value={patches} onChange={event=>{const count=Number(event.target.value);setPatches(count);setMesh(identityWarpMesh(rect,count));}}>{[1,2,3,4].map(value=><option key={value} value={value}>{value} × {value}</option>)}</select></label><button type="button" disabled={busy} onClick={()=>setMesh(identityWarpMesh(rect,patches))}>Reset mesh</button></>:<>{number("Warp bend",bend,setBend,-100,100)}{number("Horizontal distortion",hDistort,setH,-100,100)}{number("Vertical distortion",vDistort,setV,-100,100)}<label><input type="checkbox" checked={vertical} onChange={event=>setVertical(event.target.checked)}/>Vertical warp</label></>}</>}
    </div>;
  const form=<form ref={dialog} role="dialog" aria-modal={canvas?undefined:true} aria-label={TITLES[kind]} className={canvas?"xd-photo-geometry-inspector":"xd-photo-dialog xd-photo-special-dialog"} onSubmit={event=>{event.preventDefault();if(valid&&!busy&&!stale&&!drag.current)void runPhotoCommand(COMMANDS[kind],params).then(close).catch(()=>{});}}>
    <header><h3>{TITLES[kind]}</h3><p>{kind==="liquify"?"Paint deformation strokes on the image.":kind==="puppet"?"Click to place pins, then drag or use arrow keys to position them.":kind==="perspective"?"Drag plane corners. Shared source corners stay linked.":"Drag mesh points or choose a warp preset. Arrow keys nudge the focused point."}</p></header>
    {canvas?<>{feedback}{controls}</>:<div className="xd-photo-special-body"><div className="xd-photo-special-preview">{stage}{feedback}</div>{controls}</div>}
    {workspaceError&&<p role="alert">{workspaceError}</p>}<div className="xd-photo-dialog-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button type="submit" disabled={busy||!valid||stale||!!draft}>Apply</button></div>
  </form>;
  return canvas?<>{createPortal(stage,canvas.element)}{form}</>:<div className="xd-photo-dialog-scrim">{form}</div>;
}
