import { useEffect, useMemo, useRef, useState, type PointerEvent, type SVGAttributes } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Grid2x2, Settings as Gear } from "lucide-react";
import type { PhotoDocument, PhotoLayer } from "./types";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import { historyId } from "./selectAndMask";
import type { HistoryFold } from "./freeTransform";
import { useDesignDialog } from "../useDesignDialog";
import { beginXDesignActivity } from "../runtimeActivity";
import { ContextMenu } from "../EditorMenus";
import type { MenuEntry } from "../menuModel";
import { cylinderDefault, cylinderDragged, cylinderHandles, cylinderMesh, type CylinderHandle, type CylinderValues } from "./warpCylinder";
import { useWarpSession, warpMenuItems, WARP_TURNS, type WarpSession, type WarpSplit, type WarpTurn } from "./warpSession";

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
type Drag={kind:"pin"|"corner"|"mesh";index:number;plane?:number;start?:XY}|{kind:"stroke";stroke:Stroke}|{kind:"plane";start:XY;end:XY}|{kind:"surface";at:[number,number];start:XY}|{kind:"cylinder";handle:CylinderHandle;start?:XY};
const TITLES:Record<GeometryKind,string>={liquify:"Liquify",puppet:"Puppet Warp",perspective:"Perspective Warp",warp:"Warp layer"};
const COMMANDS:Record<GeometryKind,string>={liquify:"filter.liquify",puppet:"edit.puppetWarp",perspective:"edit.perspectiveWarp",warp:"edit.transform.warp"};
// Photoshop's Warp menu has no None; its presets come in separated groups.
const WARP_STYLE_GROUPS=[["custom"],["arc","arcLower","arcUpper"],["arch","bulge","shellLower","shellUpper"],["flag","wave","fish","rise"],["fisheye","inflate","squeeze","twist"],["cylinder"]];
type SplitTool=WarpSplit;
const SPLITS:[SplitTool,string][]=[["Crosswise","M8 2v12M2 8h12"],["Vertically","M8 2v12"],["Horizontally","M2 8h12"]];
const GUIDE_MODES:[string,string][]=[["auto","Auto Show Guides"],["always","Always Show Guides"],["never","Never Show Guides"]];
const WARP_GRIDS:[string,string][]=[["1","Default"],["3","3 x 3"],["4","4 x 4"],["5","5 x 5"]];
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
const bernstein=(t:number)=>{const s=1-t;return [s*s*s,3*s*s*t,3*s*t*t,t*t*t];};
const BERN_INV=[[1,0,0,0],[-5/6,3,-1.5,1/3],[1/3,-1.5,3,-5/6],[0,0,0,1]];
function locateKnot(knots:number[],value:number):[number,number] {
  const s=Math.min(1,Math.max(0,value));let index=0;
  while(index+2<knots.length&&s>knots[index+1]!)index++;
  const width=knots[index+1]!-knots[index]!;return [index,width>0?(s-knots[index]!)/width:0];
}
export function warpMeshPoint(mesh:Mesh,s:number,t:number):XY {
  const [pi,a]=locateKnot(mesh.us,s),[pj,b]=locateKnot(mesh.vs,t),nx=3*mesh.us.length-2,out:XY=[0,0];
  bernstein(b).forEach((wb,j)=>bernstein(a).forEach((wa,i)=>{const p=mesh.points[(3*pj+j)*nx+3*pi+i]!,k=wa*wb;out[0]+=p[0]*k;out[1]+=p[1]*k;}));
  return out;
}
function fitWarpMesh(map:(s:number,t:number)=>XY,us:number[],vs:number[]):Mesh {
  const nx=3*us.length-2,points:XY[]=Array.from({length:nx*(3*vs.length-2)},()=>[0,0]);
  for(let pj=0;pj+1<vs.length;pj++)for(let pi=0;pi+1<us.length;pi++){
    const sample=[0,1,2,3].map(j=>[0,1,2,3].map(i=>map(us[pi]!+(us[pi+1]!-us[pi]!)*i/3,vs[pj]!+(vs[pj+1]!-vs[pj]!)*j/3)));
    for(let j=0;j<4;j++)for(let i=0;i<4;i++){const acc:XY=[0,0];BERN_INV[j]!.forEach((wa,a)=>BERN_INV[i]!.forEach((wb,b)=>{const k=wa*wb;acc[0]+=k*sample[a]![b]![0];acc[1]+=k*sample[a]![b]![1];}));points[(3*pj+j)*nx+3*pi+i]=acc;}
  }
  return {us,vs,points};
}
const evenKnots=(count:number)=>Array.from({length:count+1},(_,index)=>index/count);
// Photoshop's Custom grid has separate columns and rows, but native warpGrid is square only; this is its refit (BezierMesh::fit of the current surface).
export const regridWarpMesh=(mesh:Mesh,cols:number,rows:number)=>fitWarpMesh((s,t)=>warpMeshPoint(mesh,s,t),evenKnots(cols),evenKnots(rows));
function warpGridId(mesh:Mesh) {
  const cols=mesh.us.length-1,even=(knots:number[])=>knots.every((value,index)=>Math.abs(value-index/(knots.length-1))<1e-4);
  return cols===mesh.vs.length-1&&even(mesh.us)&&even(mesh.vs)&&[1,3,4,5].includes(cols)?String(cols):"custom";
}
const warpCurve=(mesh:Mesh,axis:"u"|"v",value:number)=>Array.from({length:65},(_,index)=>(axis==="u"?warpMeshPoint(mesh,value,index/64):warpMeshPoint(mesh,index/64,value)).join(",")).join(" ");
/** Density lines between neighbouring grid lines, as Photoshop's warp guides draw them. */
export const warpGuideValues=(knots:number[],density:number)=>knots.slice(1).flatMap((end,index)=>Array.from({length:density},(_,m)=>knots[index]!+(end-knots[index]!)*(m+1)/(density+1)));
/** Normalised (s, t) of the surface point nearest p: a coarse search, then Newton steps (photocraft's BezierMesh::param_at). */
export function warpParamAt(mesh:Mesh,p:XY):[number,number] {
  let best:[number,number,number]=[.5,.5,Infinity];
  for(let j=0;j<=48;j++)for(let i=0;i<=48;i++){const q=warpMeshPoint(mesh,i/48,j/48),d=(q[0]-p[0])**2+(q[1]-p[1])**2;if(d<best[2])best=[i/48,j/48,d];}
  let [s,t]=best;const clamp=(value:number)=>Math.min(1,Math.max(0,value));
  for(let step=0;step<12;step++){
    const h=1e-5,q=warpMeshPoint(mesh,s,t),qs=warpMeshPoint(mesh,s+h,t),qt=warpMeshPoint(mesh,s,t+h);
    const a=(qs[0]-q[0])/h,b=(qt[0]-q[0])/h,c=(qs[1]-q[1])/h,d=(qt[1]-q[1])/h,det=a*d-b*c;if(Math.abs(det)<1e-12)break;
    const ex=p[0]-q[0],ey=p[1]-q[1];s=clamp(s+(d*ex-b*ey)/det);t=clamp(t+(a*ey-c*ex)/det);
  }
  return [s,t];
}
/** The anchor a handle or inner point belongs to. */
const warpAnchorOf=(mesh:Mesh,index:number)=>{const nx=3*mesh.us.length-2,i=index%nx,j=Math.floor(index/nx);return (j+(j%3===1?-1:j%3===2?1:0))*nx+i+(i%3===1?-1:i%3===2?1:0);};
const nearestWarpAnchor=(mesh:Mesh,p:XY)=>{
  const nx=3*mesh.us.length-2,distance=(index:number)=>Math.hypot(mesh.points[index]![0]-p[0],mesh.points[index]![1]-p[1]);let best=0;
  mesh.points.forEach((_,index)=>{if(index%nx%3===0&&Math.floor(index/nx)%3===0&&distance(index)<distance(best))best=index;});
  return best;
};
/** Drags control point `index` by d from `base`: an anchor takes its 3 x 3 block; a handle takes the two points beside it across its line and, with its anchor in unison, the opposite handle turns the other way (photocraft's BezierMesh::drag_point). */
export function dragWarpPoint(mesh:Mesh,base:XY[],index:number,d:XY,unison=true):Mesh {
  const nx=3*mesh.us.length-2,ny=3*mesh.vs.length-2,i=index%nx,j=Math.floor(index/nx),points=base.map(p=>[...p] as XY);
  if(!d.every(Number.isFinite))return {...mesh,points};
  const shift=(a:number,b:number,k=1)=>{if(a>=0&&b>=0&&a<nx&&b<ny){const p=points[b*nx+a]!;p[0]+=d[0]*k;p[1]+=d[1]*k;}};
  const span=(knots:number[],k:number)=>unison&&k>0&&k+1<knots.length?[knots[k]!-knots[k-1]!,knots[k+1]!-knots[k]!] as const:null;
  if(i%3===0&&j%3===0){for(let b=-1;b<=1;b++)for(let a=-1;a<=1;a++)shift(i+a,j+b);}
  else if(i%3===0){for(let a=-1;a<=1;a++)shift(i+a,j);const lengths=span(mesh.vs,Math.floor(j/3)+(j%3===2?1:0));if(lengths){const [other,k]=j%3===1?[j-2,lengths[0]/lengths[1]]:[j+2,lengths[1]/lengths[0]];for(let a=-1;a<=1;a++)shift(i+a,other,-k);}}
  else if(j%3===0){for(let b=-1;b<=1;b++)shift(i,j+b);const lengths=span(mesh.us,Math.floor(i/3)+(i%3===2?1:0));if(lengths){const [other,k]=i%3===1?[i-2,lengths[0]/lengths[1]]:[i+2,lengths[1]/lengths[0]];for(let b=-1;b<=1;b++)shift(other,j+b,-k);}}
  else shift(i,j);
  return {...mesh,points};
}
/** Evens the tangents either side of every interior grid line within columns i0..i1 and rows j0..j1 (photocraft's smooth_lines). */
function smoothWarpLines(mesh:Mesh,i0:number,i1:number,j0:number,j1:number) {
  const nx=3*mesh.us.length-2,ny=3*mesh.vs.length-2,p=mesh.points,triples:[number,number,number,number,number][]=[];
  for(let a=1;a<mesh.us.length-1;a++)if(3*a>=i0&&3*a<Math.min(i1,nx))for(let j=j0;j<Math.min(j1,ny);j++)triples.push([j*nx+3*a-1,j*nx+3*a,j*nx+3*a+1,mesh.us[a]!-mesh.us[a-1]!,mesh.us[a+1]!-mesh.us[a]!]);
  for(let b=1;b<mesh.vs.length-1;b++)if(3*b>=j0&&3*b<Math.min(j1,ny))for(let i=i0;i<Math.min(i1,nx);i++)triples.push([(3*b-1)*nx+i,3*b*nx+i,(3*b+1)*nx+i,mesh.vs[b]!-mesh.vs[b-1]!,mesh.vs[b+1]!-mesh.vs[b]!]);
  for(const [l,c,r,hl,hr] of triples){const pl=p[l]!,pc=p[c]!,pr=p[r]!,tan=[0,1].map(k=>((pc[k]!-pl[k]!)/hl+(pr[k]!-pc[k]!)/hr)/2) as XY;p[l]=[pc[0]-tan[0]*hl,pc[1]-tan[1]*hl];p[r]=[pc[0]+tan[0]*hr,pc[1]+tan[1]*hr];}
}
/** Pulls the surface point at (s, t) by d, as dragging inside the mesh does (photocraft's BezierMesh::pull): anchors within about two cells follow with a falloff, the border stays unless grabbed near it, and the grabbed patch closes the gap exactly. */
export function pullWarpMesh(mesh:Mesh,base:XY[],s:number,t:number,d:XY):Mesh {
  const cols=mesh.us.length-1,rows=mesh.vs.length-1,nx=3*cols+1,ny=3*rows+1,out:Mesh={...mesh,points:base.map(p=>[...p] as XY)},points=out.points;
  if(!d.every(Number.isFinite))return out;
  const [pi,a]=locateKnot(mesh.us,s),[pj,b]=locateKnot(mesh.vs,t),ba=bernstein(a),bb=bernstein(b),w=(k:number[],x:number)=>k[x]!;
  const anchor=(ai:number,aj:number)=>base[3*aj*nx+3*ai]??[0,0],at0=warpMeshPoint({...mesh,points:base},s,t),target:XY=[at0[0]+d[0],at0[1]+d[1]];
  const quad=[anchor(pi,pj),anchor(pi+1,pj),anchor(pi,pj+1),anchor(pi+1,pj+1)],size=Math.max(1,...[0,1].map(k=>Math.max(...quad.map(p=>p[k]!))-Math.min(...quad.map(p=>p[k]!))));
  const innerW=(w(ba,1)+w(ba,2))*(w(bb,1)+w(bb,2)),interior=Math.min(1,innerW/.5625),nearBorder=Math.max(0,1-Math.min(s,1-s,t,1-t)/.12);
  const reach=(ai:number,aj:number)=>(ai===0||ai===cols)&&(aj===0||aj===rows)?0:ai===0||ai===cols||aj===0||aj===rows?nearBorder:1;
  const corner=([[pi,pj,(w(ba,0)+w(ba,1))*(w(bb,0)+w(bb,1))],[pi+1,pj,(w(ba,2)+w(ba,3))*(w(bb,0)+w(bb,1))],[pi,pj+1,(w(ba,0)+w(ba,1))*(w(bb,2)+w(bb,3))],[pi+1,pj+1,(w(ba,2)+w(ba,3))*(w(bb,2)+w(bb,3))]] as const).map(([ai,aj,weight])=>[ai,aj,weight*reach(ai,aj)] as const);
  const share=Array.from({length:(cols+1)*(rows+1)},(_,k)=>{const ai=k%(cols+1),aj=Math.floor(k/(cols+1)),p=anchor(ai,aj),x=Math.min(1,Math.hypot(p[0]-at0[0],p[1]-at0[1])/(1.8*size));return .5*(1+Math.cos(Math.PI*x))*reach(ai,aj);});
  for(const [ai,aj,weight] of corner)share[aj*(cols+1)+ai]=Math.max(share[aj*(cols+1)+ai]!,(1-interior)*weight);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=share[Math.min(rows,Math.floor((j+1)/3))*(cols+1)+Math.min(cols,Math.floor((i+1)/3))]!,p=points[j*nx+i]!;p[0]+=d[0]*k;p[1]+=d[1]*k;}
  const inner=[1,2].flatMap(j=>[1,2].map(i=>[(3*pj+j)*nx+3*pi+i,w(ba,i)*w(bb,j)] as const)),norm=inner.reduce((sum,[,weight])=>sum+weight*weight,0),cornerNorm=corner.reduce((sum,[,,weight])=>sum+weight*weight,0);
  const innerPart=cornerNorm>1e-12?Math.min(1,innerW/.15):1,edge:[number,number][]=[];
  for(const k of [1,2]){if(pi===0)edge.push([(3*pj+k)*nx,w(ba,0)*w(bb,k)]);if(pi+1===cols)edge.push([(3*pj+k)*nx+3*pi+3,w(ba,3)*w(bb,k)]);if(pj===0)edge.push([3*pi+k,w(ba,k)*w(bb,0)]);if(pj+1===rows)edge.push([(3*pj+3)*nx+3*pi+k,w(ba,k)*w(bb,3)]);}
  const edgeNorm=edge.reduce((sum,[,weight])=>sum+weight*weight,0),edgePart=edgeNorm>1e-12?nearBorder:0,innerShare=(1-edgePart)*innerPart,cornerShare=(1-edgePart)*(1-innerPart);
  for(let step=0;step<60;step++){
    const now=warpMeshPoint(out,s,t),rem:XY=[target[0]-now[0],target[1]-now[1]];if(Math.hypot(...rem)<1e-9)break;
    const nudge=(index:number,k:number)=>{const p=points[index];if(p){p[0]+=rem[0]*k;p[1]+=rem[1]*k;}};
    if(innerShare>0&&norm>0)for(const [index,weight] of inner)nudge(index,weight/norm*innerShare);
    if(edgePart>0)for(const [index,weight] of edge)nudge(index,weight/edgeNorm*edgePart);
    if(cornerShare>0&&cornerNorm>0)for(const [ai,aj,weight] of corner)for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){const i=3*ai+di,j=3*aj+dj;if(i>=0&&j>=0&&i<nx&&j<ny)nudge(j*nx+i,weight/cornerNorm*cornerShare);}
    for(let pass=0;pass<3;pass++)smoothWarpLines(out,Math.max(0,3*pi-3),3*pi+7,Math.max(0,3*pj-3),3*pj+7);
  }
  return out;
}
/** Cmd-click splits crosswise, or across a grid line the click lands near (photocraft's quick_split_kind). */
export function quickWarpSplit(mesh:Mesh,rect:number[],p:XY):SplitTool {
  const [s,t]=warpParamAt(mesh,p),thirds=mesh.us.length===2&&mesh.vs.length===2,tolerance=(size:number)=>Math.min(.12,Math.max(.02,8/Math.max(1,Math.abs(size))));
  const near=(knots:number[],value:number,size:number)=>[...knots.slice(1,-1),...(thirds?[1/3,2/3]:[])].some(knot=>Math.abs(knot-value)<tolerance(size));
  const u=near(mesh.us,s,rect[2]!-rect[0]!),v=near(mesh.vs,t,rect[3]!-rect[1]!);
  return u&&!v?"Horizontally":v&&!u?"Vertically":"Crosswise";
}
/** Edit › Transform's rotations and flips during a Warp turn the mesh about the box centre. */
export function turnWarpMesh(mesh:Mesh,rect:number[],turn:WarpTurn):Mesh {
  const cx=(rect[0]!+rect[2]!)/2,cy=(rect[1]!+rect[3]!)/2;
  return {...mesh,points:mesh.points.map(([x,y]):XY=>turn==="rotate180"?[2*cx-x,2*cy-y]:turn==="rotate90Cw"?[cx-(y-cy),cy+(x-cx)]:turn==="rotate90Ccw"?[cx+(y-cy),cy-(x-cx)]:turn==="flipHorizontal"?[2*cx-x,y]:[x,2*cy-y])};
}
export function movePlaneCorner(planes:Plane[],plane:number,index:number,destination:XY):Plane[] {
  const source=planes[plane]!.src[index]!;
  return planes.map(current=>({...current,dst:current.dst.map((point,i)=>Math.abs(current.src[i]![0]-source[0])<.001&&Math.abs(current.src[i]![1]-source[1])<.001?destination:point)}));
}
export function GeometryDialog({kind,document,layer,close,canvas,fold,freeTransform}:{kind:GeometryKind;document:PhotoDocument;layer:PhotoLayer;close:()=>void;canvas?:{element:HTMLElement;zoom:number};fold?:HistoryFold;freeTransform?:(work:Promise<unknown>|null,fold?:HistoryFold)=>void}) {
  const busy=usePhotoWorkspace(state=>state.busy),projectId=usePhotoWorkspace(state=>state.projectId),workspaceError=usePhotoWorkspace(state=>state.error),viewKey=usePhotoWorkspace(state=>state.state?.viewKey);
  const [x,y,width,height]=layer.bounds??[0,0,document.width,document.height],rect=[x,y,x+Math.max(1,width),y+Math.max(1,height)];
  const corners:XY[]=[[rect[0]!,rect[1]!],[rect[2]!,rect[1]!],[rect[2]!,rect[3]!],[rect[0]!,rect[3]!]];
  const [pins,setPins]=useState<Pin[]>([]),[planes,setPlanes]=useState<Plane[]>([{src:corners,dst:corners}]),[strokes,setStrokes]=useState<Stroke[]>([]),[mesh,setMesh]=useState(()=>identityWarpMesh(rect,1));
  const [selected,setSelected]=useState(0),[addingPlane,setAddingPlane]=useState(false),[draft,setDraft]=useState<Drag|null>(null);
  const [splitTool,setSplitTool]=useState<SplitTool|null>(null),[splitLine,setSplitLine]=useState<{axis:"u"|"v";index:number}|null>(null),[customGrid,setCustomGrid]=useState<{root:Element;initial:[number,number]}|null>(null);
  const [gestureError,setGestureError]=useState<string|null>(null);
  const [anchor,setAnchor]=useState<number|null>(null),[independent,setIndependent]=useState<string[]>([]),[guides,setGuides]=useState({on:true,mode:"always",density:2}),[hover,setHover]=useState(false),[splitPreview,setSplitPreview]=useState<{at:[number,number];tool:SplitTool}|null>(null),[menu,setMenu]=useState<{x:number;y:number}|null>(null),[cylinder,setCylinder]=useState<CylinderValues>(()=>cylinderDefault(rect));
  const drag=useRef<Drag|null>(null),surface=useRef<SVGSVGElement|null>(null);
  const pointerId=useRef<number|null>(null),baseline=useRef<{pins:Pin[];planes:Plane[];mesh:Mesh;cylinder:CylinderValues}|null>(null);
  const identity=JSON.stringify([projectId,document.id,document.version,layer.id,kind,viewKey]),initial=useRef(identity),stale=initial.current!==identity;
  useEffect(()=>{if(stale)close();},[stale,close]);
  useEffect(()=>beginXDesignActivity("photo-operation","Apply or cancel the image deformation before switching projects."),[]);
  const [tool,setTool]=useState("forwardWarp"),[size,setSize]=useState(100),[density,setDensity]=useState(50),[pressure,setPressure]=useState(100),[rate,setRate]=useState(80),[mode,setMode]=useState("normal"),[expansion,setExpansion]=useState(2),[style,setStyle]=useState("custom"),[bend,setBend]=useState(50),[hDistort,setH]=useState(0),[vDistort,setV]=useState(0),[vertical,setVertical]=useState(false);
  const cylinderSurface=useMemo(()=>style==="cylinder"?cylinderMesh(cylinder):null,[style,cylinder]);
  const inRange=(value:number,min:number,max:number)=>Number.isFinite(value)&&value>=min&&value<=max;
  const validPoint=(point:XY)=>point.every(value=>inRange(value,-1_000_000,1_000_000));
  const hasContent=kind==="liquify"?strokes.length>0||draft?.kind==="stroke":kind==="puppet"?pins.length>0:kind==="perspective"?planes.length>0:true;
  const valid=!!hasContent&&(kind==="liquify"?[inRange(size,1,5000),inRange(density,0,100),inRange(pressure,0,100),inRange(rate,0,100)].every(Boolean)&&strokes.every(stroke=>stroke.points.every(validPoint)):kind==="puppet"?inRange(expansion,0,100)&&pins.every(pin=>validPoint(pin.src)&&validPoint(pin.dst)&&inRange(pin.rotate,-3600,3600)&&inRange(pin.depth,-100,100)):kind==="perspective"?planes.every(plane=>[...plane.src,...plane.dst].every(validPoint)):style==="custom"?mesh.points.every(validPoint):style==="cylinder"?!!cylinderSurface?.points.every(validPoint):[bend,hDistort,vDistort].every(value=>inRange(value,-100,100)));
  const [live,setLive]=useState(document.width*document.height<=16_777_216);
  // The pinned engine has no Cylinder style, so its surface goes over as a custom mesh.
  const warp={rect,style:style==="cylinder"?"custom":style,bend,hDistort,vDistort,vertical,...(style==="custom"?{mesh}:style==="cylinder"&&cylinderSurface?{mesh:cylinderSurface}:{})};
  const params:Record<string,unknown>={layer:layer.id,interpolation:"bicubic",...(kind==="liquify"?{strokes:[...strokes,...(draft?.kind==="stroke"?[draft.stroke]:[])]}:kind==="puppet"?{pins,mode,density:"normal",expansion}:kind==="perspective"?{planes}:warp)};
  const untouched=useRef(JSON.stringify(params));
  const apply=()=>runPhotoCommand(COMMANDS[kind],params).then(()=>fold&&runPhotoCommand("history.fold",fold));
  // Photoshop's Cancel ends the whole transform session, so the Free Transform applied before Warp goes too.
  const cancel=()=>{close();if(fold&&historyId(usePhotoWorkspace.getState().state)!==fold.fromId)void runPhotoCommand("history.select",{id:fold.fromId,discardRedo:true}).catch(()=>{});};
  const toFreeTransform=()=>{
    if(JSON.stringify(params)===untouched.current)return freeTransform?.(null,fold);
    const id=historyId(usePhotoWorkspace.getState().state);freeTransform?.(apply(),fold??(id===null?undefined:{fromId:id,label:"Warp"}));
  };
  const adopt=(next:Mesh|undefined)=>{if(!next)return;setMesh(next);setStyle("custom");setSplitLine(null);setAnchor(null);return next;};
  const editWarp=async(command:string,extra:Record<string,unknown>)=>((await runPhotoCommand(command,{...warp,...extra})) as {warp?:{mesh?:Mesh}}|undefined)?.warp?.mesh;
  const reshape=(command:string,extra:Record<string,unknown>)=>{void editWarp(command,extra).then(adopt).catch(()=>{});};
  // Photoshop selects the anchor a crosswise split creates under the pointer.
  const split=(tool:SplitTool,at:XY)=>{void editWarp(`edit.transform.splitWarp${tool}`,{at}).then(adopt).then(next=>{if(next&&tool==="Crosswise")setAnchor(nearestWarpAnchor(next,at));}).catch(()=>{});};
  const turn=(how:WarpTurn)=>{void (style==="custom"?Promise.resolve(mesh):style==="cylinder"?Promise.resolve(cylinderSurface??undefined):editWarp("edit.transform.warpGrid",{size:1})).then(base=>adopt(base&&turnWarpMesh(base,rect,how))).catch(()=>{});};
  const anchorKey=(m:Mesh,index:number)=>{const at=warpAnchorOf(m,index),nx=3*m.us.length-2;return `${m.us[at%nx/3]}:${m.vs[Math.floor(at/nx)/3]}`;};
  const unison=(m:Mesh,index:number)=>!independent.includes(anchorKey(m,index));
  const convertAnchor=(index:number)=>{const key=anchorKey(mesh,index);setIndependent(current=>current.includes(key)?current.filter(value=>value!==key):[...current,key]);};
  const chooseStyle=(next:string)=>{
    if(next==="cylinder"){setSplitTool(null);setCylinder(cylinderDefault(rect));}
    if(next==="custom"&&cylinderSurface)adopt(cylinderSurface);else setStyle(next);
  };
  const sizeGrid=(cols:number,rows:number)=>{
    if(cols===rows)return reshape("edit.transform.warpGrid",{size:cols});
    void (style==="custom"?Promise.resolve(mesh):editWarp("edit.transform.warpGrid",{size:1})).then(base=>adopt(base&&regridWarpMesh(base,cols,rows))).catch(()=>{});
  };
  const removeSplit=()=>{
    if(!splitLine)return;const middle=(knots:number[])=>(knots[0]!+knots[1]!)/2;
    // Halfway along the line's first patch, so the native nearest-split search can't pick a crossing line.
    reshape("edit.transform.removeWarpSplit",{at:splitLine.axis==="u"?warpMeshPoint(mesh,mesh.us[splitLine.index]!,middle(mesh.vs)):warpMeshPoint(mesh,middle(mesh.us),mesh.vs[splitLine.index]!)});
  };
  const preview=usePhotoCommandPreview(document,projectId,COMMANDS[kind],params,{automatic:live,enabled:valid&&!busy&&!stale}),dialog=useDesignDialog<HTMLFormElement>(cancel,busy,{additionalRoots:()=>canvas?[surface.current]:[]});
  const point=(event:{clientX:number;clientY:number}):XY=>geometryPoint(event.clientX,event.clientY,surface.current!.getBoundingClientRect(),document.width,document.height);
  const tolerance=canvas?6/canvas.zoom:Math.max(document.width,document.height)/90;
  const onMesh=(m:Mesh,p:XY,at=warpParamAt(m,p))=>{const q=warpMeshPoint(m,at[0],at[1]);return Math.hypot(q[0]-p[0],q[1]-p[1])<=tolerance;};
  // The split guide follows the pointer while a split is armed or Cmd is held, as Photoshop previews it.
  const trackSplit=(event:PointerEvent<SVGSVGElement>)=>{
    if(kind!=="warp"||style!=="custom"||drag.current||!splitTool&&!event.metaKey){if(splitPreview)setSplitPreview(null);return;}
    const p=point(event),at=warpParamAt(mesh,p);setSplitPreview(onMesh(mesh,p,at)?{at,tool:splitTool??quickWarpSplit(mesh,rect,p)}:null);
  };
  const toggleGuides=()=>setGuides(current=>({...current,on:!current.on}));
  const flags={canSplit:style!=="cylinder",canRemove:!!splitLine&&style==="custom",canConvert:anchor!==null&&style==="custom"};
  const actions=useRef({split:(_:SplitTool)=>{},removeSplit,convertAnchor:()=>{},toggleGuides,turn});
  useEffect(()=>{actions.current={split:tool=>{setSplitTool(tool);setAnchor(null);},removeSplit,convertAnchor:()=>{if(anchor!==null)convertAnchor(anchor);},toggleGuides,turn};});
  useEffect(()=>{
    if(kind!=="warp")return;
    useWarpSession.setState({session:{split:tool=>actions.current.split(tool),removeSplit:()=>actions.current.removeSplit(),convertAnchor:()=>actions.current.convertAnchor(),toggleGuides:()=>actions.current.toggleGuides(),turn:how=>actions.current.turn(how),...flags}});
    return ()=>useWarpSession.setState({session:null});
  },[kind,flags.canSplit,flags.canRemove,flags.canConvert]);// eslint-disable-line react-hooks/exhaustive-deps
  // The canvas menu splits where it was opened, as Photoshop's does.
  const canvasMenu=(at:{x:number;y:number}):MenuEntry[]=>{
    const local:WarpSession={split:tool=>split(tool,point({clientX:at.x,clientY:at.y})),removeSplit,convertAnchor:()=>{if(anchor!==null)convertAnchor(anchor);},toggleGuides,turn,...flags};
    const off=(label:string)=>({label,disabled:true}),turns=WARP_TURNS.map(([label,how])=>({label,run:()=>turn(how),disabled:busy}));
    return [off("Free Transform"),"-",...["Scale","Rotate","Skew","Distort","Perspective"].map(off),"-",...warpMenuItems(local,busy,{label:"Warp",checked:true}),"-",off("Content-Aware Scale"),off("Puppet Warp"),"-",...turns.slice(0,3),"-",...turns.slice(3)];
  };
  const capture=(event:PointerEvent,gesture:Drag)=>{pointerId.current=event.pointerId;baseline.current=structuredClone({pins,planes,mesh,cylinder});drag.current=gesture;setDraft(gesture);surface.current?.setPointerCapture(event.pointerId);};
  const finish=(cancelled=false)=>{
    const gesture=drag.current;drag.current=null;pointerId.current=null;setDraft(null);
    if(cancelled&&baseline.current){setPins(baseline.current.pins);setPlanes(baseline.current.planes);setMesh(baseline.current.mesh);setCylinder(baseline.current.cylinder);}baseline.current=null;if(cancelled||!gesture)return;
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
  const handle=(position:XY,label:string,gesture:Drag,options:{square?:boolean;className?:string;press?:(event:PointerEvent<SVGElement>)=>boolean;menu?:()=>void}={})=>{
    const r=canvas?5/canvas.zoom:Math.max(document.width,document.height)/90;
    const shared:SVGAttributes<SVGElement>={"aria-label":label,role:"button",tabIndex:busy?-1:0,"aria-disabled":busy,className:options.className,onContextMenu:options.menu,onPointerDown:event=>{
      // Cmd-click splits and Control-click opens the canvas menu, so both reach the canvas through a warp point.
      if(busy||event.button!==0||drag.current||splitTool||kind==="warp"&&(event.metaKey||event.ctrlKey))return;event.stopPropagation();if(options.press?.(event))return;
      if(gesture.kind==="pin")setSelected(gesture.index);capture(event,gesture.kind==="mesh"||gesture.kind==="cylinder"?{...gesture,start:point(event)}:gesture);
    },onKeyDown:event=>{
      const delta=event.shiftKey?10:1,dx=event.key==="ArrowLeft"?-delta:event.key==="ArrowRight"?delta:0,dy=event.key==="ArrowUp"?-delta:event.key==="ArrowDown"?delta:0;
      if(!dx&&!dy||busy)return;event.preventDefault();const destination:XY=[position[0]+dx,position[1]+dy];
      if(gesture.kind==="pin")setPins(current=>current.map((pin,index)=>index===gesture.index?{...pin,dst:destination}:pin));
      if(gesture.kind==="corner")setPlanes(current=>movePlaneCorner(current,gesture.plane!,gesture.index,destination));
      if(gesture.kind==="mesh")setMesh(current=>dragWarpPoint(current,current.points,gesture.index,[dx,dy],unison(current,gesture.index)));
      if(gesture.kind==="cylinder")setCylinder(current=>cylinderDragged(current,gesture.handle,[dx,dy]));
    }};
    return options.square?<rect {...shared} x={position[0]-r} y={position[1]-r} width={2*r} height={2*r}/>:<circle {...shared} cx={position[0]} cy={position[1]} r={r}/>;
  };
  const move=(event:PointerEvent<SVGSVGElement>)=>{
      const gesture=drag.current;if(!gesture||busy||pointerId.current!==event.pointerId)return;const p=point(event),base=baseline.current,offset=(start:XY):XY=>[p[0]-start[0],p[1]-start[1]];
      if(gesture.kind==="pin")setPins(current=>current.map((pin,index)=>index===gesture.index?{...pin,dst:p}:pin));
      if(gesture.kind==="corner")setPlanes(current=>movePlaneCorner(current,gesture.plane!,gesture.index,p));
      if(gesture.kind==="mesh"&&gesture.start&&base)setMesh(dragWarpPoint(base.mesh,base.mesh.points,gesture.index,offset(gesture.start),unison(base.mesh,gesture.index)));
      if(gesture.kind==="surface"&&base)setMesh(pullWarpMesh(base.mesh,base.mesh.points,gesture.at[0],gesture.at[1],offset(gesture.start)));
      if(gesture.kind==="cylinder"&&gesture.start&&base)setCylinder(cylinderDragged(base.cylinder,gesture.handle,offset(gesture.start)));
      if(gesture.kind==="stroke"){
        const result=appendLiquifyPoint(gesture.stroke.points,p,MAX_LIQUIFY_POINTS-strokes.reduce((sum,stroke)=>sum+stroke.points.length,0));
        if(result==="limit"){finish(true);setGestureError("This Liquify stroke was cancelled because the session reached 16,384 points. Apply the existing strokes before continuing.");return;}
        if(result==="added")setDraft({...gesture,stroke:{...gesture.stroke,points:[...gesture.stroke.points]}});
      }
      if(gesture.kind==="plane"){gesture.end=p;setDraft({...gesture});}

  };
  const single=mesh.us.length===2&&mesh.vs.length===2,meshColumns=3*mesh.us.length-2;
  const warpRole=(index:number)=>{const ci=index%meshColumns%3,cj=Math.floor(index/meshColumns)%3;return ci===0&&cj===0?"anchor":ci===0||cj===0?"handle":"twist";};
  // Photoshop shows every handle of a one-patch warp, otherwise only the selected anchor's or those along the selected split.
  const handleShown=(index:number)=>{const ci=index%meshColumns,cj=Math.floor(index/meshColumns);return single||anchor!==null&&warpAnchorOf(mesh,index)===anchor||!!splitLine&&(splitLine.axis==="u"?ci===3*splitLine.index&&cj%3!==0:cj===3*splitLine.index&&ci%3!==0);};
  const guideDensity=inRange(guides.density,1,10)?Math.round(guides.density):0,showGuides=guides.on&&(guides.mode==="always"||guides.mode==="auto"&&(hover||!!draft));
  const stage=<svg ref={surface} className={`xd-photo-geometry-stage${canvas?" xd-photo-main-geometry":""}${canvas&&preview.url?" has-preview":""}${splitTool?" is-splitting":""}`} aria-label={`${TITLES[kind]} canvas`} viewBox={`0 0 ${document.width} ${document.height}`} onPointerDown={event=>{
      if(busy||stale||event.button!==0||drag.current)return;const p=point(event);
      if(kind==="warp"){
        if(event.ctrlKey)return;
        if(style==="cylinder"){if(cylinderSurface&&onMesh(cylinderSurface,p))capture(event,{kind:"cylinder",handle:{kind:"surface"},start:p});return;}
        if(splitTool||event.metaKey){const tool=splitTool??(style==="custom"?quickWarpSplit(mesh,rect,p):"Crosswise");setSplitTool(null);setSplitPreview(null);split(tool,p);return;}
        setSplitLine(null);setAnchor(null);
        if(style==="custom"){const at=warpParamAt(mesh,p);if(onMesh(mesh,p,at))capture(event,{kind:"surface",at,start:p});}
      }
      if(kind==="liquify"){
        if(strokes.length>=128||strokes.reduce((sum,stroke)=>sum+stroke.points.length,0)>=MAX_LIQUIFY_POINTS){setGestureError("Apply the existing Liquify strokes before starting another gesture.");return;}
        setGestureError(null);capture(event,{kind:"stroke",stroke:{tool,size,density,pressure,rate,points:[p]}});
      }
      if(kind==="puppet"&&pins.length<64){const pin={src:p,dst:p,rotate:0,depth:0};setPins(current=>[...current,pin]);setSelected(pins.length);capture(event,{kind:"pin",index:pins.length});}
      if(kind==="perspective"&&addingPlane&&planes.length<16)capture(event,{kind:"plane",start:p,end:p});
    }} onPointerMove={event=>{trackSplit(event);move(event);}} onPointerEnter={()=>setHover(true)} onPointerLeave={()=>{setHover(false);setSplitPreview(null);}} onContextMenu={event=>{if(kind!=="warp"||busy||stale)return;event.preventDefault();setMenu({x:event.clientX,y:event.clientY});}} onPointerUp={event=>{if(pointerId.current===event.pointerId){move(event);finish();}}} onPointerCancel={event=>{if(pointerId.current===event.pointerId)finish(true);}} onLostPointerCapture={event=>{if(pointerId.current===event.pointerId)finish(true);}}>
      {(!canvas||preview.url)&&<image href={preview.url??convertFileSrc(document.previewPath)} x="0" y="0" width={document.width} height={document.height}/>}
      {kind==="liquify"&&[...strokes,...(draft?.kind==="stroke"?[draft.stroke]:[])].map((stroke,index)=><polyline className="xd-photo-warp-guide" key={index} points={stroke.points.map(point=>point.join(",")).join(" ")} vectorEffect="non-scaling-stroke"/>)}
      {kind==="puppet"&&pins.map((pin,index)=><g key={index}><line className="xd-photo-warp-guide" x1={pin.src[0]} y1={pin.src[1]} x2={pin.dst[0]} y2={pin.dst[1]} vectorEffect="non-scaling-stroke"/>{handle(pin.dst,`Puppet pin ${index+1}`,{kind:"pin",index})}</g>)}
      {kind==="perspective"&&planes.map((plane,i)=><g key={i}><polygon className="xd-photo-warp-guide" points={plane.dst.map(point=>point.join(",")).join(" ")} vectorEffect="non-scaling-stroke"/>{plane.dst.map((p,index)=><g key={index}>{handle(p,`Plane ${i+1} corner ${index+1}`,{kind:"corner",plane:i,index})}</g>)}</g>)}
      {draft?.kind==="plane"&&<rect className="xd-photo-warp-guide" x={Math.min(draft.start[0],draft.end[0])} y={Math.min(draft.start[1],draft.end[1])} width={Math.abs(draft.end[0]-draft.start[0])} height={Math.abs(draft.end[1]-draft.start[1])} vectorEffect="non-scaling-stroke"/>}
      {kind==="warp"&&style==="custom"&&<>
        {(["u","v"] as const).flatMap(axis=>(axis==="u"?mesh.us:mesh.vs).map((value,index)=><polyline key={`${axis}${index}`} className="xd-photo-warp-guide" points={warpCurve(mesh,axis,value)} vectorEffect="non-scaling-stroke"/>))}
        {showGuides&&(["u","v"] as const).flatMap(axis=>warpGuideValues(axis==="u"?mesh.us:mesh.vs,guideDensity).map((value,index)=><polyline key={`g${axis}${index}`} className="xd-photo-warp-guide is-minor" points={warpCurve(mesh,axis,value)} vectorEffect="non-scaling-stroke"/>))}
        {splitPreview&&(["u","v"] as const).filter(axis=>splitPreview.tool==="Crosswise"||(splitPreview.tool==="Vertically")===(axis==="u")).map(axis=><polyline key={`preview${axis}`} className="xd-photo-warp-guide is-preview" points={warpCurve(mesh,axis,splitPreview.at[axis==="u"?0:1])} vectorEffect="non-scaling-stroke"/>)}
        {mesh.points.map((p,index)=>{if(warpRole(index)!=="handle"||!handleShown(index))return null;const anchor=mesh.points[warpAnchorOf(mesh,index)]!;return <line key={`h${index}`} className="xd-photo-warp-guide" x1={anchor[0]} y1={anchor[1]} x2={p[0]} y2={p[1]} vectorEffect="non-scaling-stroke"/>;})}
        {(["u","v"] as const).flatMap(axis=>(axis==="u"?mesh.us:mesh.vs).slice(1,-1).map((value,i)=>{const line={axis,index:i+1};return <polyline key={`split${axis}${i}`} className="xd-photo-warp-split" role="button" tabIndex={busy?-1:0} aria-label={`${axis==="u"?"Vertical":"Horizontal"} warp split ${i+1}`} aria-pressed={splitLine?.axis===axis&&splitLine.index===i+1} points={warpCurve(mesh,axis,value)} vectorEffect="non-scaling-stroke" onPointerDown={event=>{if(busy||event.button!==0||drag.current||splitTool||event.metaKey||event.ctrlKey)return;event.stopPropagation();setSplitLine(line);setAnchor(null);}} onKeyDown={event=>{if(event.key!=="Enter"&&event.key!==" ")return;event.preventDefault();setSplitLine(line);setAnchor(null);}}/>;}))}
        {mesh.points.map((p,index)=>{
          const role=warpRole(index);if(role==="twist"||role==="handle"&&!handleShown(index))return null;
          if(role==="handle")return <g key={index}>{handle(p,`Warp point ${index+1}`,{kind:"mesh",index})}</g>;
          const ci=index%meshColumns,cj=Math.floor(index/meshColumns),border=ci===0||cj===0||ci===meshColumns-1||cj===mesh.points.length/meshColumns-1;
          const select=()=>{setAnchor(index);setSplitLine(null);};
          return <g key={index}>{handle(p,`Warp point ${index+1}`,{kind:"mesh",index},{square:!single&&border,className:[!single&&!border?"is-inner":"",anchor===index?"is-selected":""].filter(Boolean).join(" ")||undefined,menu:select,press:event=>{select();if(!event.altKey)return false;convertAnchor(index);return true;}})}</g>;
        })}
      </>}
      {kind==="warp"&&style==="cylinder"&&cylinderSurface&&<>
        {(["u","v"] as const).flatMap(axis=>(axis==="u"?cylinderSurface.us:cylinderSurface.vs).map((value,index)=><polyline key={`${axis}${index}`} className="xd-photo-warp-guide" points={warpCurve(cylinderSurface,axis,value)} vectorEffect="non-scaling-stroke"/>))}
        {cylinderHandles(cylinder).map(([p,h],index)=><g key={index}>{handle(p,`Cylinder ${h.kind} ${"index" in h?h.index+1:""}`,{kind:"cylinder",handle:h},{square:h.kind!=="depth"})}</g>)}
      </>}
    </svg>;
  const feedback=<><div className="xd-photo-preview-actions"><label><input type="checkbox" checked={live} disabled={busy||document.width*document.height>16_777_216} onChange={event=>setLive(event.target.checked)}/>Live preview</label><button type="button" disabled={busy||preview.loading||!valid} onClick={()=>{void preview.preview();}}>{preview.loading?"Rendering…":"Preview changes"}</button>{preview.url&&<span role="status">{preview.stale?"Updating preview…":"Unapplied preview"}</span>}</div>{preview.error&&<p role="alert">{preview.error}</p>}{gestureError&&<p role="alert">{gestureError}</p>}</>;
  const controls=<div className="xd-photo-special-controls" inert={busy||stale}>
      {kind==="liquify"&&<><label>Tool<select aria-label="Liquify tool" value={tool} onChange={event=>setTool(event.target.value)}>{LIQUIFY_TOOLS.map(tool=><option value={tool} key={tool}>{labelFor(tool)}</option>)}</select></label>{number("Liquify brush size",size,setSize,1,5000)}{number("Liquify density",density,setDensity,0,100)}{number("Liquify pressure",pressure,setPressure,0,100)}{number("Liquify rate",rate,setRate,0,100)}<p>{strokes.length} strokes</p><button type="button" disabled={busy||!strokes.length} onClick={()=>setStrokes(current=>current.slice(0,-1))}>Undo last stroke</button><button type="button" disabled={busy||!strokes.length} onClick={()=>setStrokes([])}>Reset deformation</button></>}
      {kind==="puppet"&&<><label>Mode<select aria-label="Puppet mode" value={mode} onChange={event=>setMode(event.target.value)}>{["rigid","normal","distort"].map(value=><option key={value}>{value}</option>)}</select></label>{number("Mesh expansion",expansion,setExpansion,0,100)}<label>Pin<select aria-label="Selected puppet pin" value={selected} onChange={event=>setSelected(Number(event.target.value))}>{pins.map((_,index)=><option key={index} value={index}>Pin {index+1}</option>)}</select></label>{pins[selected]&&<>{number("Pin X",pins[selected]!.dst[0],value=>setPins(current=>current.map((pin,index)=>index===selected?{...pin,dst:[value,pin.dst[1]]}:pin)),-100000,100000)}{number("Pin Y",pins[selected]!.dst[1],value=>setPins(current=>current.map((pin,index)=>index===selected?{...pin,dst:[pin.dst[0],value]}:pin)),-100000,100000)}{number("Pin rotation",pins[selected]!.rotate,value=>setPins(current=>current.map((pin,index)=>index===selected?{...pin,rotate:value}:pin)),-3600,3600)}{number("Pin depth",pins[selected]!.depth,value=>setPins(current=>current.map((pin,index)=>index===selected?{...pin,depth:value}:pin)),-100,100)}<button type="button" disabled={busy} onClick={()=>{setPins(current=>current.filter((_,index)=>index!==selected));setSelected(0);}}>Remove pin</button></>}</>}
      {kind==="perspective"&&<><button type="button" disabled={busy||planes.length>=16} onClick={()=>setAddingPlane(value=>!value)}>{addingPlane?"Cancel new plane":"Add plane"}</button>{addingPlane&&<p>Drag a rectangle on the image to define a source plane.</p>}{planes.map((_,index)=><div key={index}><span>Plane {index+1}</span><button type="button" disabled={busy} onClick={()=>setPlanes(current=>current.filter((_,i)=>i!==index))}>Remove plane</button></div>)}<button type="button" disabled={busy} onClick={()=>setPlanes(current=>current.map(plane=>({...plane,dst:structuredClone(plane.src)})))}>Reset perspective</button></>}
      {kind==="warp"&&<>
        <div role="group" aria-label="Split" className="xd-photo-warp-split-tools"><span>Split</span>{SPLITS.map(([tool,path])=><button key={tool} type="button" aria-label={`Split Warp ${tool}`} title={`Split Warp ${tool}`} aria-pressed={splitTool===tool} disabled={busy||style==="cylinder"} onClick={()=>setSplitTool(current=>current===tool?null:tool)}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12"/><path d={path}/></svg></button>)}</div>
        <label>Grid<select aria-label="Warp grid" disabled={style==="cylinder"} value={style==="custom"?warpGridId(mesh):"1"} onChange={event=>{
          const value=event.target.value,[cols,rows]=[mesh.us.length-1,mesh.vs.length-1];
          if(value!=="customSize")return reshape("edit.transform.warpGrid",{size:Number(value)});
          setCustomGrid({root:event.currentTarget.closest(".xd-photo")??window.document.body,initial:style==="custom"&&cols*rows>1?[cols,rows]:[3,3]});
        }}>{style==="custom"&&warpGridId(mesh)==="custom"&&<option value="custom" hidden>Custom</option>}<option value="customSize">Custom</option>{WARP_GRIDS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Warp<select aria-label="Warp style" value={style} onChange={event=>chooseStyle(event.target.value)}>{WARP_STYLE_GROUPS.flatMap((group,index)=>[...(index?[<hr key={`hr${index}`}/>]:[]),...group.map(value=><option key={value} value={value}>{labelFor(value)}</option>)])}</select></label>
        <details className="xd-photo-warp-guides"><summary aria-label="Guide options" title="Guide options"><Gear size={14} aria-hidden="true"/></summary><label>Show guides<select aria-label="Show guides" value={guides.mode} onChange={event=>setGuides(current=>({...current,mode:event.target.value}))}>{GUIDE_MODES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{number("Guide density",guides.density,value=>setGuides(current=>({...current,density:value})),1,10)}</details>
        {style==="cylinder"?null:style==="custom"?<><button type="button" disabled={busy||!splitLine} onClick={removeSplit}>Remove Warp Split</button><button type="button" disabled={busy} onClick={()=>setMesh(current=>fitWarpMesh((s,t)=>[rect[0]!+s*(rect[2]!-rect[0]!),rect[1]!+t*(rect[3]!-rect[1]!)],current.us,current.vs))}>Reset mesh</button></>:<>{number("Warp bend",bend,setBend,-100,100)}{number("Horizontal distortion",hDistort,setH,-100,100)}{number("Vertical distortion",vDistort,setV,-100,100)}<label><input type="checkbox" checked={vertical} onChange={event=>setVertical(event.target.checked)}/>Vertical warp</label></>}
        {freeTransform&&<button type="button" aria-label="Switch between free transform and warp modes" title="Switch between free transform and warp modes" disabled={busy||stale||!valid||!!draft} onClick={toFreeTransform}><Grid2x2 size={16} aria-hidden="true"/></button>}</>}
    </div>;
  const form=<form ref={dialog} role="dialog" aria-modal={canvas?undefined:true} aria-label={TITLES[kind]} className={canvas?"xd-photo-geometry-inspector":"xd-photo-dialog xd-photo-special-dialog"} onSubmit={event=>{event.preventDefault();if(valid&&!busy&&!stale&&!drag.current)void apply().then(close).catch(()=>{});}}>
    <header><h3>{TITLES[kind]}</h3><p>{kind==="liquify"?"Paint deformation strokes on the image.":kind==="puppet"?"Click to place pins, then drag or use arrow keys to position them.":kind==="perspective"?"Drag plane corners. Shared source corners stay linked.":"Drag mesh points or choose a warp preset. Arrow keys nudge the focused point."}</p></header>
    {canvas?<>{feedback}{controls}</>:<div className="xd-photo-special-body"><div className="xd-photo-special-preview">{stage}{feedback}</div>{controls}</div>}
    {workspaceError&&<p role="alert">{workspaceError}</p>}<div className="xd-photo-dialog-actions"><button type="button" disabled={busy} onClick={cancel}>Cancel</button><button type="submit" disabled={busy||!valid||stale||!!draft}>Apply</button></div>
  </form>;
  const sizeDialog=customGrid&&createPortal(<CustomGridSizeDialog initial={customGrid.initial} apply={sizeGrid} close={()=>setCustomGrid(null)}/>,customGrid.root);
  const contextMenu=menu&&<ContextMenu x={menu.x} y={menu.y} items={canvasMenu(menu)} label="Warp" close={()=>setMenu(null)}/>;
  return canvas?<>{createPortal(stage,canvas.element)}{form}{sizeDialog}{contextMenu}</>:<><div className="xd-photo-dialog-scrim">{form}</div>{sizeDialog}{contextMenu}</>;
}
function CustomGridSizeDialog({initial,apply,close}:{initial:[number,number];apply:(cols:number,rows:number)=>void;close:()=>void}) {
  const [values,setValues]=useState(initial),[corrected,setCorrected]=useState(false),dialog=useDesignDialog<HTMLFormElement>(close);
  const field=(label:string,index:0|1)=><label>{label}:<input aria-label={label} type="number" min={1} max={50} step={1} value={Number.isNaN(values[index])?"":values[index]} onChange={event=>{const next:[number,number]=[...values];next[index]=event.target.valueAsNumber;setValues(next);}}/></label>;
  return <div className="xd-photo-dialog-scrim"><form ref={dialog} role="dialog" aria-modal aria-label="Custom Grid Size" className="xd-photo-dialog" noValidate onSubmit={event=>{
    event.preventDefault();event.stopPropagation();
    const closest=values.map(value=>Number.isFinite(value)?Math.min(50,Math.max(1,Math.round(value))):1) as [number,number];
    if(closest.some((value,index)=>value!==values[index])){setValues(closest);setCorrected(true);return;}
    close();apply(...closest);
  }}>
    <h3>Custom Grid Size</h3>{field("Columns",0)}{field("Rows",1)}{corrected&&<p role="alert">An integer between 1 and 50 is required. Closest value inserted.</p>}
    <div className="xd-photo-dialog-actions"><button type="button" onClick={close}>Cancel</button><button type="submit">OK</button></div>
  </form></div>;
}
