import { useRef, useState, type PointerEvent } from "react";
import { createLucideIcon, type LucideIcon } from "lucide-react";
import { surfaceFraction } from "./viewTurn";

export type CropBox={x:number;y:number;width:number;height:number};
export type CropGuide="thirds"|"grid"|"diagonal"|"triangle"|"golden"|"spiral"|"none";
// Photoshop's overlay glyphs: a crop frame with the guide's lines drawn through it.
const guideIcon=(name:string,d:string)=>createLucideIcon(name,[["rect",{x:"5",y:"5",width:"14",height:"14",strokeWidth:"1.5",key:"frame"}],["path",{d,strokeWidth:"1.5",key:"lines"}]]);
export const CROP_GUIDES:[CropGuide,string,LucideIcon][]=[
  ["thirds","Rule of Thirds",guideIcon("CropThirds","M9.7 2v20M14.3 2v20M2 9.7h20M2 14.3h20")],
  ["grid","Grid",guideIcon("CropGrid","M8.5 2v20M12 2v20M15.5 2v20M2 8.5h20M2 12h20M2 15.5h20")],
  ["diagonal","Diagonal",guideIcon("CropDiagonal","M5 5l14 14M19 5 5 19")],
  ["triangle","Triangle",guideIcon("CropTriangle","M5 5l14 14M19 5l-7 7")],
  ["golden","Golden Ratio",guideIcon("CropGolden","M10.3 2v20M13.7 2v20M2 10.3h20M2 13.7h20")],
  ["spiral","Golden Spiral",guideIcon("CropSpiral","M12 12a1 1 0 0 1 2 0a2 2 0 0 1-4 0a3 3 0 0 1 6 0a4 4 0 0 1-8 0")],
];
export type CropOverlayShow="auto"|"always"|"never";
export const CROP_OVERLAY_SHOWS:[CropOverlayShow,string][]=[["auto","Auto Show Overlay"],["always","Always Show Overlay"],["never","Never Show Overlay"]];
type XY=[number,number];
const PHI=(1+Math.sqrt(5))/2,GOLDEN=1/(1+PHI);
// Fractions of the box; grid lines are spaced in screen pixels so their density stays readable at any zoom.
const guideFractions=(guide:CropGuide,length:number,zoom:number)=>guide==="thirds"?[1/3,2/3]:guide==="golden"?[GOLDEN,1-GOLDEN]:guide==="grid"?Array.from({length:Math.max(0,Math.ceil(length*zoom/32)-1)},(_,index)=>(index+1)*32/zoom/length):[];
// The diagonal plus perpendiculars dropped onto it from the other two corners; odd orientations use the other diagonal.
const triangle=(box:CropBox,orientation:number):[XY,XY][]=>{
  const right=box.x+box.width,bottom=box.y+box.height;
  const [a,b,p,q]:[XY,XY,XY,XY]=orientation%2?[[right,box.y],[box.x,bottom],[box.x,box.y],[right,bottom]]:[[box.x,box.y],[right,bottom],[right,box.y],[box.x,bottom]];
  const dx=b[0]-a[0],dy=b[1]-a[1],foot=([x,y]:XY):XY=>{const t=((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy);return [a[0]+t*dx,a[1]+t*dy];};
  return [[a,b],[p,foot(p)],[q,foot(q)]];
};
// Quarter arcs through ever smaller golden squares, laid out in a landscape golden rectangle, then transposed for portrait boxes and mirrored by `orientation`.
const goldenSpiral=(box:CropBox,orientation:number)=>{
  const turned=box.height>box.width,flipX=orientation%2===1,flipY=orientation>=2;
  const map=(gx:number,gy:number):XY=>{let u=gx/PHI,v=gy;if(turned)[u,v]=[v,u];if(flipX)u=1-u;if(flipY)v=1-v;return [box.x+u*box.width,box.y+v*box.height];};
  const sweep=[turned,flipX,flipY].filter(Boolean).length%2?0:1,cuts:[XY,XY][]=[];
  let x=0,y=0,w=PHI,h=1,d=`M${map(0,1).join(" ")}`;
  for(let step=0;step<10;step++){
    const s=step%2?w:h;let to:XY,cut:[XY,XY];
    if(step%4===0){to=[x+s,y];cut=[[x+s,y],[x+s,y+h]];x+=s;w-=s;}
    else if(step%4===1){to=[x+w,y+s];cut=[[x,y+s],[x+w,y+s]];y+=s;h-=s;}
    else if(step%4===2){to=[x+w-s,y+h];cut=[[x+w-s,y],[x+w-s,y+h]];w-=s;}
    else{to=[x,y+h-s];cut=[[x,y+h-s],[x+w,y+h-s]];h-=s;}
    const [ru,rv]=turned?[s,s/PHI]:[s/PHI,s];
    d+=` A${ru*box.width} ${rv*box.height} 0 0 ${sweep} ${map(...to).join(" ")}`;cuts.push([map(...cut[0]),map(...cut[1])]);
  }
  return {d,cuts};
};
const segment=([[x1,y1],[x2,y2]]:[XY,XY],key:number)=><line key={key} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke"/>;
const HANDLES=[["top left",0,0,"nwse"],["top",.5,0,"ns"],["top right",1,0,"nesw"],["right",1,.5,"ew"],["bottom right",1,1,"nwse"],["bottom",.5,1,"ns"],["bottom left",0,1,"nesw"],["left",0,.5,"ew"]] as const;
type Drag={pointer:number;fx:number;fy:number;kind:"move"|"resize"|"rotate";start:[number,number];client:[number,number];box:CropBox;angle:number};
const turn=(x:number,y:number,degrees:number):[number,number]=>{const radians=degrees*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);return [cos*x-sin*y,sin*x+cos*y];};
/** The image's corners in the canvas a crop makes (a rotated crop turns the image by -angle about the box), or null when the box stays on the image and adds no canvas. */
export function cropAddedCanvas(box:CropBox,angle:number,width:number,height:number):XY[]|null{
  const image=([[0,0],[width,0],[width,height],[0,height]] as XY[]).map(([x,y]):XY=>{const [u,v]=turn(x-box.x-box.width/2,y-box.y-box.height/2,-angle);return [Math.round((u+box.width/2)*1000)/1000,Math.round((v+box.height/2)*1000)/1000];});
  // A canvas corner more than half a pixel outside an image edge means the crop adds canvas there.
  const outside=([x,y]:XY)=>image.some(([ax,ay],index)=>{const [bx,by]=image[(index+1)%4]!;return ((bx-ax)*(y-ay)-(by-ay)*(x-ax))/Math.hypot(bx-ax,by-ay)<-.5;});
  return ([[0,0],[box.width,0],[box.width,box.height],[0,box.height]] as XY[]).some(outside)?image:null;
}
// One axis of a ratio-held box: the dragged edge moves while the opposite edge stays, unless it is centred.
const span=(f:number,lo:number,hi:number,size:number,centred:boolean):[number,number]=>centred||f===.5?[(lo+hi)/2-size/2,(lo+hi)/2+size/2]:f===0?[hi-size,hi]:[lo,lo+size];

// `angle` rotates the box clockwise on screen about its centre; resizing works in the box's own axes.
// Handle drags hold `ratio` (width ÷ height), or the box's own shape while Shift is down, and Option resizes about the centre, as in Photoshop.
// `autoGuide` is Photoshop's Auto Show Overlay: the guide only shows while the box is being dragged.
// `hideOutside` is Photoshop's Show Cropped Area turned off: everything outside the box is painted over with the pasteboard.
// Without `movable`, drags inside the box fall through to the canvas, so a box covering the whole image can be redrawn.
// With `pan`, dragging inside the box moves the image under it instead (Photoshop's non-classic crop): `pan` gets the box
// shifted the opposite way in image pixels, and the caller offsets the image to match so the box stays put on screen.
export function CropOverlay({width,height,zoom,box,change,label="Crop",shade=true,shadeOpacity,hideOutside=false,angle=0,rotate,guide="none",autoGuide=false,orientation=0,menu,movable=true,pan,ratio}:{width:number;height:number;zoom:number;box:CropBox;change:(box:CropBox)=>void;ratio?:number;label?:string;shade?:boolean;shadeOpacity?:number;hideOutside?:boolean;angle?:number;rotate?:(angle:number)=>void;guide?:CropGuide;autoGuide?:boolean;orientation?:number;menu?:(at:{x:number;y:number})=>void;movable?:boolean;pan?:(box:CropBox)=>void}) {
  const svg=useRef<SVGSVGElement>(null),drag=useRef<Drag|null>(null),[dragging,setDragging]=useState(false);
  const at=(event:PointerEvent<SVGElement>):[number,number]=>{const [fx,fy]=surfaceFraction(svg.current!,event.clientX,event.clientY);return [fx*width,fy*height];};
  const begin=(event:PointerEvent<SVGElement>,kind:Drag["kind"],fx=0,fy=0)=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();svg.current!.setPointerCapture(event.pointerId);drag.current={pointer:event.pointerId,fx,fy,kind,start:at(event),client:[event.clientX,event.clientY],box,angle};setDragging(true);};
  const moved=(event:PointerEvent<SVGSVGElement>)=>{
    const current=drag.current;if(!current||current.pointer!==event.pointerId)return;
    const [x,y]=at(event),{box:from}=current,cx=from.x+from.width/2,cy=from.y+from.height/2;
    if(current.kind==="rotate"){let next=current.angle+(Math.atan2(y-cy,x-cx)-Math.atan2(current.start[1]-cy,current.start[0]-cx))*180/Math.PI;if(event.shiftKey)next=Math.round(next/15)*15;rotate?.(((next+180)%360+360)%360-180);return;}
    const dx=Math.round(x-current.start[0]),dy=Math.round(y-current.start[1]);
    if(current.kind==="move"&&pan){
      // The svg moves with the image, so measure from the pointer's screen travel rather than svg coordinates.
      const [fx,fy]=surfaceFraction(svg.current!,event.clientX,event.clientY),[sx,sy]=surfaceFraction(svg.current!,current.client[0],current.client[1]),px=Math.round((fx-sx)*width),py=Math.round((fy-sy)*height);
      pan({...from,x:from.x-px,y:from.y-py});return;
    }
    if(current.kind==="move"){change({...from,x:from.x+dx,y:from.y+dy});return;}
    const [lx,ly]=turn(dx,dy,-current.angle);let left=-from.width/2,right=from.width/2,top=-from.height/2,bottom=from.height/2;
    if(current.fx===0)left+=lx;if(current.fx===1)right+=lx;if(current.fy===0)top+=ly;if(current.fy===1)bottom+=ly;
    if(event.altKey){if(current.fx===0)right=-left;if(current.fx===1)left=-right;if(current.fy===0)bottom=-top;if(current.fy===1)top=-bottom;}
    const keep=ratio??(event.shiftKey?from.width/from.height:0);
    if(keep>0){
      let w=Math.abs(right-left),h=Math.abs(bottom-top);
      if(current.fy===.5)h=w/keep;else if(current.fx===.5)w=h*keep;else if(w/keep>h)h=w/keep;else w=h*keep;
      [left,right]=span(current.fx,left,right,w,event.altKey);[top,bottom]=span(current.fy,top,bottom,h,event.altKey);
    }
    const w=Math.max(1,Math.round(Math.abs(right-left))),h=Math.max(1,Math.round(Math.abs(bottom-top))),[mx,my]=turn((left+right)/2,(top+bottom)/2,current.angle);
    change({x:Math.round(cx+mx-w/2),y:Math.round(cy+my-h/2),width:w,height:h});
  };
  const end=(event:PointerEvent<SVGSVGElement>)=>{if(drag.current?.pointer!==event.pointerId)return;drag.current=null;setDragging(false);if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);};
  // With the outside hidden, the shade runs past the image so its antialiased edge can't leave a column of image pixels at fractional zooms.
  const size=10/zoom,cx=box.x+box.width/2,cy=box.y+box.height/2,pad=hideOutside?2/zoom:0;
  const corners=[[0,0],[1,0],[1,1],[0,1]].map(([fx,fy])=>{const [x,y]=turn((fx!-.5)*box.width,(fy!-.5)*box.height,angle);return `${cx+x} ${cy+y}`;});
  return <svg ref={svg} className="xd-photo-crop" viewBox={`0 0 ${width} ${height}`} aria-label={`${label} box`} onPointerMove={moved} onPointerUp={end} onPointerCancel={end} onContextMenu={menu&&(event=>{event.preventDefault();menu({x:event.clientX,y:event.clientY});})}>
    {(shade||hideOutside)&&<path className="xd-photo-crop-shade" data-hidden={hideOutside||undefined} style={hideOutside||shadeOpacity===undefined?undefined:{fill:`rgba(0,0,0,${shadeOpacity})`}} fillRule="evenodd" d={`M${-pad} ${-pad}H${width+pad}V${height+pad}H${-pad}Z M${corners.join(" L")}Z`}/>}
    <g transform={angle?`rotate(${angle} ${cx} ${cy})`:undefined}>
      {guide!=="none"&&(!autoGuide||dragging)&&<g className="xd-photo-crop-guide" data-guide={guide}>
        {guideFractions(guide,box.width,zoom).map(f=><line key={`x${f}`} x1={box.x+f*box.width} y1={box.y} x2={box.x+f*box.width} y2={box.y+box.height} vectorEffect="non-scaling-stroke"/>)}
        {guideFractions(guide,box.height,zoom).map(f=><line key={`y${f}`} x1={box.x} y1={box.y+f*box.height} x2={box.x+box.width} y2={box.y+f*box.height} vectorEffect="non-scaling-stroke"/>)}
        {guide==="triangle"&&triangle(box,orientation).map(segment)}
        {guide==="spiral"&&(({d,cuts})=><>{cuts.map(segment)}<path d={d} fill="none" vectorEffect="non-scaling-stroke"/></>)(goldenSpiral(box,orientation))}
        {guide==="diagonal"&&<><line x1={box.x} y1={box.y} x2={box.x+box.width} y2={box.y+box.height} vectorEffect="non-scaling-stroke"/><line x1={box.x+box.width} y1={box.y} x2={box.x} y2={box.y+box.height} vectorEffect="non-scaling-stroke"/></>}
      </g>}
      <rect className="xd-photo-crop-area" role={movable?"button":undefined} aria-label={movable?`Move ${label.toLowerCase()} box`:undefined} style={movable?undefined:{pointerEvents:"none"}} x={box.x} y={box.y} width={box.width} height={box.height} vectorEffect="non-scaling-stroke" onPointerDown={movable?event=>begin(event,"move"):undefined}/>
      {HANDLES.map(([name,fx,fy,cursor])=><rect key={name} className="xd-photo-crop-handle" role="button" aria-label={`${label} handle ${name}`} style={{cursor:`${cursor}-resize`}} x={box.x+fx*box.width-size/2} y={box.y+fy*box.height-size/2} width={size} height={size} vectorEffect="non-scaling-stroke" onPointerDown={event=>begin(event,"resize",fx,fy)}/>)}
      {rotate&&<><line className="xd-photo-crop-stem" x1={cx} y1={box.y} x2={cx} y2={box.y-24/zoom} vectorEffect="non-scaling-stroke"/><circle className="xd-photo-crop-handle" role="button" aria-label={`Rotate ${label.toLowerCase()} box`} style={{cursor:"grab"}} cx={cx} cy={box.y-24/zoom} r={size/2} vectorEffect="non-scaling-stroke" onPointerDown={event=>begin(event,"rotate")}/></>}
    </g>
  </svg>;
}
