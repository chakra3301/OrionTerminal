import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import type { PhotoDocument, PhotoLayer } from "./types";
import { identityTransform, layerFrame, CORNERS, distortCorners, perspectiveQuad, quadCentre, quadHandle, resizeTransform, rotateQuad, scaleQuad, skewQuad, transformHandle, transformMatrix, type TransformSettings } from "./transformMath";
import { beginFreeTransform, cancelFreeTransform, commitFreeTransform, freeTransformChanged, freeTransformParams, patchFreeTransform, useFreeTransform, type Quad } from "./freeTransform";
import { controlsLocked, runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";

const HANDLES=[[-1,-1,"top left"],[0,-1,"top"],[1,-1,"top right"],[1,0,"right"],[1,1,"bottom right"],[0,1,"bottom"],[-1,1,"bottom left"],[-1,0,"left"]] as const;
const RESIZE_CURSORS=["ew-resize","nwse-resize","ns-resize","nesw-resize"];
type Drag={pointer:number;kind:"move"|"resize"|"rotate"|"distort"|"skew"|"perspective";hx:number;hy:number;start:[number,number];initial:TransformSettings;quad:Quad;moving:number[];prior:Quad|null;fresh:boolean};
const QUAD_KINDS:Drag["kind"][]=["distort","skew","perspective"];
const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest("input,select,textarea,[contenteditable]");
export function ImageTransformOverlay({document,layer,zoom,untilShown,autoSelect=false}:{document:PhotoDocument;layer:PhotoLayer;zoom:number;autoSelect?:boolean;untilShown:(work:Promise<unknown>)=>Promise<void>}) {
  const projectId=usePhotoWorkspace(workspace=>workspace.projectId),busy=usePhotoWorkspace(controlsLocked),viewKey=usePhotoWorkspace(workspace=>workspace.state?.viewKey);
  const active=useFreeTransform(store=>store.session),held=useFreeTransform(store=>store.held),session=active&&active.documentId===document.id&&active.layerId===layer.id?active:null;
  // `layer` still has its old bounds until the committed image is shown.
  const shape=session??(held&&held.documentId===document.id&&held.layerId===layer.id?held:null);
  const raw=layer.transformBounds??layer.bounds,bounds=shape?.bounds??(raw&&raw[2]>0&&raw[3]>0?layerFrame(document,layer):null);
  const [cmd,setCmd]=useState(false),drag=useRef<Drag|null>(null),svg=useRef<SVGSVGElement|null>(null),shownRef=useRef(untilShown);shownRef.current=untilShown;
  const mode=session?.mode??"free",visible=shape?.settings??identityTransform(bounds??[0,0,1,1]),quad=shape?.quad??null,changed=!!session&&freeTransformChanged(session);
  const params=session?freeTransformParams(session):{layer:layer.id,matrix:transformMatrix(bounds??[0,0,1,1],visible),interpolation:"bicubic"};
  const preview=usePhotoCommandPreview(document,projectId,"edit.transform",params,{automatic:true,enabled:changed&&document.width*document.height<=16_777_216,viewKey,delay:120});
  useEffect(()=>{if(session&&session.preview!==preview.url)patchFreeTransform({preview:preview.url});},[session!==null,preview.url]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      setCmd(event.metaKey||event.ctrlKey);
      const open=useFreeTransform.getState().session;if(!open||event.defaultPrevented)return;
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();drag.current=null;cancelFreeTransform();}
      else if(event.key==="Enter"&&!editable(event.target)&&!(event.target instanceof HTMLButtonElement)){event.preventDefault();event.stopPropagation();drag.current=null;commitFreeTransform(shownRef.current)?.catch(()=>{});}
    };
    const up=(event:KeyboardEvent)=>setCmd(event.metaKey||event.ctrlKey);
    window.addEventListener("keydown",key,true);window.addEventListener("keyup",up,true);
    return()=>{window.removeEventListener("keydown",key,true);window.removeEventListener("keyup",up,true);};
  },[]);
  if(!bounds)return null;
  const point=(event:PointerEvent<SVGElement>):[number,number]=>{const rect=svg.current!.getBoundingClientRect();return [(event.clientX-rect.left)/rect.width*document.width,(event.clientY-rect.top)/rect.height*document.height];};
  const corners:Quad=quad??CORNERS.map(([x,y])=>transformHandle(bounds,visible,x,y) as [number,number]);
  const begin=(event:PointerEvent<SVGElement>,kind:Drag["kind"],hx=0,hy=0)=>{
    if(event.button!==0||busy||drag.current)return;
    const live=useFreeTransform.getState().session,fresh=!live;if(fresh&&!beginFreeTransform(document,layer,viewKey)||live&&(live.documentId!==document.id||live.layerId!==layer.id))return;
    event.preventDefault();event.stopPropagation();
    const open=useFreeTransform.getState().session!,initial=open.settings,start=corners;
    // Edit ▸ Transform entries fix what a handle does; Free Transform leaves it to the modifier keys.
    let resolved:Drag["kind"]=kind==="move"&&open.quad?"distort":kind;
    if(kind==="resize")resolved=open.mode==="rotate"?"rotate":QUAD_KINDS.includes(open.mode as Drag["kind"])?open.mode as Drag["kind"]:open.mode==="free"&&(event.metaKey||event.ctrlKey)?"distort":"resize";
    drag.current={pointer:event.pointerId,kind:resolved,hx,hy,start:point(event),initial:{...initial},quad:start,moving:resolved==="distort"?kind==="move"?[0,1,2,3]:distortCorners(hx,hy):[],prior:open.quad,fresh};
    if(QUAD_KINDS.includes(resolved)&&!open.quad)patchFreeTransform({quad:start});
    svg.current!.setPointerCapture(event.pointerId);
  };
  const moved=(event:PointerEvent<SVGElement>)=>{
    const current=drag.current,open=useFreeTransform.getState().session;if(!current||!open||current.pointer!==event.pointerId)return;const p=point(event),initial=current.initial;
    if(current.kind==="distort"){
      const dx=p[0]-current.start[0],dy=p[1]-current.start[1],next=current.quad.map((corner,index)=>current.moving.includes(index)?[corner[0]+dx,corner[1]+dy]:corner) as Quad;
      if(next.flat().every(value=>Number.isFinite(value)&&Math.abs(value)<=1_000_000))patchFreeTransform({quad:next});return;
    }
    if(current.kind==="skew"||current.kind==="perspective"){
      const next=(current.kind==="skew"?skewQuad:perspectiveQuad)(current.quad,current.hx,current.hy,[p[0]-current.start[0],p[1]-current.start[1]]);
      if(next.flat().every(value=>Number.isFinite(value)&&Math.abs(value)<=1_000_000))patchFreeTransform({quad:next});return;
    }
    if(open.quad){
      // A distorted box has no scale/angle settings, so scale and rotate act on its corners directly.
      let next:Quad;
      if(current.kind==="resize")next=scaleQuad(current.quad,current.hx,current.hy,p,event.altKey);
      else if(current.kind==="rotate"){const centre=quadCentre(current.quad);let turn=Math.atan2(p[1]-centre[1],p[0]-centre[0])-Math.atan2(current.start[1]-centre[1],current.start[0]-centre[0]);if(event.shiftKey)turn=Math.round(turn*12/Math.PI)*Math.PI/12;next=rotateQuad(current.quad,centre,turn);}
      else return;
      if(next.flat().every(value=>Number.isFinite(value)&&Math.abs(value)<=1_000_000))patchFreeTransform({quad:next});return;
    }
    let value:TransformSettings;
    if(current.kind==="resize")value=resizeTransform(open.bounds,initial,current.hx,current.hy,p,open.linked!==event.shiftKey,event.altKey);
    else if(current.kind==="move")value={...initial,x:initial.x+p[0]-current.start[0],y:initial.y+p[1]-current.start[1]};
    else {let angle=initial.angle+(Math.atan2(p[1]-initial.y,p[0]-initial.x)-Math.atan2(current.start[1]-initial.y,current.start[0]-initial.x))*180/Math.PI;if(event.shiftKey)angle=Math.round(angle/15)*15;value={...initial,angle};}
    if(![value.x,value.y,value.width,value.height,value.angle].every(Number.isFinite)||Math.abs(value.x)>1_000_000||Math.abs(value.y)>1_000_000)return;
    patchFreeTransform({settings:value});
  };
  const release=(event:PointerEvent<SVGSVGElement>)=>{if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);};
  const finish=(event:PointerEvent<SVGSVGElement>)=>{
    const current=drag.current;if(!current||current.pointer!==event.pointerId)return;moved(event);drag.current=null;release(event);
    const open=useFreeTransform.getState().session;if(!open)return;
    // A click on a distorting handle that never moved must not leave an identity quad behind.
    if(!current.fresh){if(QUAD_KINDS.includes(current.kind)&&!current.prior&&open.quad&&JSON.stringify(open.quad)===JSON.stringify(current.quad))patchFreeTransform({quad:null});return;}
    // Dragging the Move tool's box moves the layer right away; its handles start a pending Free Transform.
    if(!freeTransformChanged(open))cancelFreeTransform();
    else if(current.kind==="move")commitFreeTransform(untilShown)?.catch(()=>{});
  };
  const abort=()=>{const current=drag.current;drag.current=null;if(!current)return;if(current.fresh)cancelFreeTransform();else patchFreeTransform({settings:current.initial,quad:current.prior});};
  const keyTransform=(event:ReactKeyboardEvent<SVGElement>,kind:"move"|"resize",hx=0,hy=0)=>{
    if(busy||kind==="resize"&&mode!=="free"&&mode!=="scale")return;
    const step=event.shiftKey?10:1,dx=event.key==="ArrowRight"?step:event.key==="ArrowLeft"?-step:0,dy=event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0;if(!dx&&!dy)return;
    event.preventDefault();event.stopPropagation();
    if(session){
      if(session.quad)return;
      if(kind==="move")patchFreeTransform({settings:{...visible,x:visible.x+dx,y:visible.y+dy}});
      else {const handle=transformHandle(bounds,visible,hx,hy);patchFreeTransform({settings:resizeTransform(bounds,visible,hx,hy,[handle[0]+dx,handle[1]+dy],session.linked!==event.shiftKey,event.altKey)});}
      return;
    }
    const defaults=identityTransform(bounds);let matrix:number[];
    if(kind==="move")matrix=[1,0,0,1,dx,dy];
    else {const handle=transformHandle(bounds,defaults,hx,hy);matrix=transformMatrix(bounds,resizeTransform(bounds,defaults,hx,hy,[handle[0]+dx,handle[1]+dy],!event.altKey));}
    void runPhotoCommand("edit.transform",{layer:layer.id,matrix,interpolation:"bicubic"}).catch(()=>{});
  };
  const handlePoint=(hx:number,hy:number):readonly number[]=>quad?quadHandle(quad,hx,hy):transformHandle(bounds,visible,hx,hy);
  // Written without `p[1]!-…`: Tailwind's class scanner reads that as a class and crashes the stylesheet build.
  const resizeCursor=(p:readonly number[])=>{
    if(mode==="free"?cmd:mode!=="scale")return "crosshair";
    const [x=0,y=0]=p;
    const octant=Math.round(Math.atan2(y-visible.y,x-visible.x)/(Math.PI/4));
    return RESIZE_CURSORS[(octant%4+4)%4];
  };
  // With Auto-Select on (⌘ inverts it), the Move tool's box lets the click through so the canvas can pick the layer under the cursor.
  const passThrough=!session&&!held&&autoSelect!==cmd;
  const shown=changed?preview.url:held?.preview;
  return <>{shown&&<img className="xd-photo-main-transform-preview" src={shown} alt="Unapplied layer transform"/>}
    <svg ref={svg} className="xd-photo-main-transform" data-pending={session?"":undefined} viewBox={`0 0 ${document.width} ${document.height}`} aria-label="Layer transform handles" onPointerMove={event=>moved(event)} onPointerUp={finish} onPointerCancel={abort} onLostPointerCapture={abort}>
      <polygon role="button" tabIndex={0} aria-disabled={busy} aria-label="Move selected image layer" points={corners.map(p=>p.join(",")).join(" ")} vectorEffect="non-scaling-stroke" style={passThrough?{pointerEvents:"none"}:undefined} onPointerDown={event=>begin(event,"move")} onDoubleClick={()=>{if(session&&!busy)commitFreeTransform(untilShown)?.catch(()=>{});}} onKeyDown={event=>keyTransform(event,"move")}/>
      {!quad&&(mode==="free"||mode==="rotate")&&CORNERS.map(([hx,hy])=>{const p=transformHandle(bounds,visible,hx,hy),length=Math.hypot(p[0]-visible.x,p[1]-visible.y)||1,outward=11/zoom;
        return <circle key={`${hx}${hy}`} className="xd-photo-rotate-zone" cx={p[0]+(p[0]-visible.x)/length*outward} cy={p[1]+(p[1]-visible.y)/length*outward} r={13/zoom} aria-label={`Rotate image layer ${hy<0?"top":"bottom"} ${hx<0?"left":"right"}`} onPointerDown={event=>begin(event,"rotate")}/>;})}
      {HANDLES.map(([hx,hy,name])=>{const p=handlePoint(hx,hy);return <circle role="button" tabIndex={0} aria-disabled={busy} key={name} cx={p[0]} cy={p[1]} r={5/zoom} vectorEffect="non-scaling-stroke" style={{cursor:resizeCursor(p)}} aria-label={`Resize image layer ${name}`} onPointerDown={event=>begin(event,"resize",hx,hy)} onKeyDown={event=>keyTransform(event,"resize",hx,hy)}/>;})}
      {session&&!quad&&<circle data-pivot="" cx={visible.x} cy={visible.y} r={4/zoom} vectorEffect="non-scaling-stroke"/>}
    </svg></>;
}
