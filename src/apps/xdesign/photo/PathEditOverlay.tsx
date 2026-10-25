import { useRef, useState, type PointerEvent } from "react";
import type { XY } from "./penPath";

export type PathKnot={anchor:XY;in:XY;out:XY;smooth:boolean};
export type PathData={subpaths:{closed:boolean;op?:string;knots:PathKnot[]}[];fillRule?:string;inverted?:boolean};
type Part="anchor"|"in"|"out";
type Drag={pointer:number;start:XY;origin:PathData;target:{subpath:number;knot:number;part:Part}|null;alt:boolean};

export function pathCurve(path:PathData):string {
  return path.subpaths.map(({knots,closed})=>{
    if(!knots.length)return "";
    const segment=(from:PathKnot,to:PathKnot)=>`C${from.out.join(" ")} ${to.in.join(" ")} ${to.anchor.join(" ")}`;
    return `M${knots[0]!.anchor.join(" ")}${knots.slice(1).map((knot,index)=>segment(knots[index]!,knot)).join("")}${closed&&knots.length>1?`${segment(knots.at(-1)!,knots[0]!)}Z`:""}`;
  }).join("");
}
const offset=(point:XY,dx:number,dy:number):XY=>[point[0]+dx,point[1]+dy];
const same=(a:XY,b:XY)=>a[0]===b[0]&&a[1]===b[1];
// Moving a smooth knot's handle turns the opposite handle to stay collinear, keeping its own length.
function dragKnot(knot:PathKnot,part:Part,dx:number,dy:number,alt:boolean):PathKnot {
  if(part==="anchor")return {...knot,anchor:offset(knot.anchor,dx,dy),in:offset(knot.in,dx,dy),out:offset(knot.out,dx,dy)};
  const moved=offset(knot[part],dx,dy),other:Part=part==="in"?"out":"in",smooth=knot.smooth&&!alt;
  if(!smooth)return {...knot,[part]:moved,smooth:false};
  const [ax,ay]=knot.anchor,length=Math.hypot(knot[other][0]-ax,knot[other][1]-ay),away=Math.hypot(moved[0]-ax,moved[1]-ay);
  const mirrored:XY=away?[ax-(moved[0]-ax)/away*(length||away),ay-(moved[1]-ay)/away*(length||away)]:knot[other];
  return {...knot,[part]:moved,[other]:mirrored};
}

export function TargetPathOverlay({width,height,zoom,path}:{width:number;height:number;zoom:number;path:PathData}) {
  const size=5/zoom;
  return <svg className="xd-photo-path-edit" viewBox={`0 0 ${width} ${height}`} aria-label="Target path">
    <path className="xd-photo-path-line" d={pathCurve(path)} vectorEffect="non-scaling-stroke"/>
    {path.subpaths.map((subpath,s)=>subpath.knots.map((knot,k)=><rect key={`${s}/${k}`} className="xd-photo-path-knot" x={knot.anchor[0]-size/2} y={knot.anchor[1]-size/2} width={size} height={size}/>))}
  </svg>;
}

export function PathEditOverlay({width,height,zoom,path,direct,commit,move}:{width:number;height:number;zoom:number;path:PathData;direct:boolean;commit:(path:PathData)=>Promise<unknown>|void;move:(dx:number,dy:number)=>Promise<unknown>|void}) {
  const svg=useRef<SVGSVGElement>(null),drag=useRef<Drag|null>(null),committing=useRef(false),[draft,setDraft]=useState<PathData|null>(null);
  const shown=draft??path,size=7/zoom;
  const at=(event:PointerEvent<SVGElement>):XY=>{const rect=svg.current!.getBoundingClientRect();return [(event.clientX-rect.left)/rect.width*width,(event.clientY-rect.top)/rect.height*height];};
  const begin=(event:PointerEvent<SVGElement>,target:Drag["target"])=>{if(event.button!==0||committing.current)return;event.preventDefault();event.stopPropagation();svg.current!.setPointerCapture(event.pointerId);drag.current={pointer:event.pointerId,start:at(event),origin:path,target,alt:event.altKey};};
  const next=(event:PointerEvent<SVGSVGElement>)=>{
    const current=drag.current;if(!current||current.pointer!==event.pointerId)return null;
    const [x,y]=at(event),dx=Math.round(x-current.start[0]),dy=Math.round(y-current.start[1]),target=current.target;
    return {dx,dy,path:{...current.origin,subpaths:current.origin.subpaths.map((subpath,s)=>({...subpath,knots:subpath.knots.map((knot,k)=>!target?dragKnot(knot,"anchor",dx,dy,false):target.subpath===s&&target.knot===k?dragKnot(knot,target.part,dx,dy,current.alt):knot)}))}};
  };
  const end=(event:PointerEvent<SVGSVGElement>)=>{
    const result=next(event),current=drag.current;if(!result||!current)return;drag.current=null;
    if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);
    if(!result.dx&&!result.dy){setDraft(null);return;}
    // The dragged path stays until the edited one arrives, so it never snaps back for a moment.
    committing.current=true;
    void Promise.resolve(current.target?commit(result.path):move(result.dx,result.dy)).finally(()=>{committing.current=false;setDraft(null);});
  };
  return <svg ref={svg} className="xd-photo-path-edit" viewBox={`0 0 ${width} ${height}`} aria-label="Path editor" onPointerMove={event=>{const result=next(event);if(result)setDraft(result.path);}} onPointerUp={end} onPointerCancel={()=>{drag.current=null;setDraft(null);}}>
    <path className="xd-photo-path-hit" d={pathCurve(shown)} strokeWidth={12/zoom} role="button" aria-label="Move path" onPointerDown={event=>{if(!direct)begin(event,null);}}/>
    <path className="xd-photo-path-line" d={pathCurve(shown)} vectorEffect="non-scaling-stroke"/>
    {direct&&shown.subpaths.map((subpath,s)=>subpath.knots.map((knot,k)=><g key={`${s}/${k}`}>
      {(["in","out"] as const).filter(part=>!same(knot[part],knot.anchor)).map(part=><g key={part}><line className="xd-photo-path-handle-line" x1={knot.anchor[0]} y1={knot.anchor[1]} x2={knot[part][0]} y2={knot[part][1]} vectorEffect="non-scaling-stroke"/><circle className="xd-photo-path-handle" role="button" aria-label={`Path ${s+1} point ${k+1} ${part} handle`} cx={knot[part][0]} cy={knot[part][1]} r={size/2} vectorEffect="non-scaling-stroke" onPointerDown={event=>begin(event,{subpath:s,knot:k,part})}/></g>)}
      <rect className="xd-photo-path-anchor" role="button" aria-label={`Path ${s+1} point ${k+1}`} x={knot.anchor[0]-size/2} y={knot.anchor[1]-size/2} width={size} height={size} vectorEffect="non-scaling-stroke" onPointerDown={event=>begin(event,{subpath:s,knot:k,part:"anchor"})}/>
    </g>))}
  </svg>;
}
