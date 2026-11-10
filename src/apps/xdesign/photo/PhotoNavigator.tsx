import { useRef, type PointerEvent } from "react";
import { Mountain } from "lucide-react";

export type NavigatorView={x:number;y:number;width:number;height:number};
const MIN=Math.log(.01),MAX=Math.log(16);

export function PhotoNavigator({src,width,height,view,zoom,center,zoomTo}:{src:string|undefined;width:number;height:number;view:NavigatorView|null;zoom:number;center:(x:number,y:number)=>void;zoomTo:(zoom:number)=>void}) {
  const frame=useRef<HTMLDivElement>(null),pointer=useRef<number|null>(null);
  const go=(event:PointerEvent<HTMLDivElement>)=>{const rect=frame.current!.getBoundingClientRect();if(rect.width&&rect.height)center((event.clientX-rect.left)/rect.width*width,(event.clientY-rect.top)/rect.height*height);};
  const percent=(value:number,total:number)=>`${Math.max(0,Math.min(100,value/total*100))}%`;
  const to=(value:number)=>zoomTo(Math.min(Math.exp(MAX),Math.max(Math.exp(MIN),value)));
  return <div className="xd-photo-navigator">
    <div ref={frame} className="xd-photo-navigator-frame" style={{aspectRatio:`${width} / ${height}`}} aria-label="Navigator" role="slider" aria-valuetext={view?`Showing ${Math.round(view.x)}, ${Math.round(view.y)}`:undefined}
      onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);pointer.current=event.pointerId;go(event);}}
      onPointerMove={event=>{if(pointer.current===event.pointerId)go(event);}}
      onPointerUp={event=>{if(pointer.current===event.pointerId)pointer.current=null;}} onPointerCancel={()=>{pointer.current=null;}}>
      {src&&<img src={src} alt="" draggable={false}/>}
      {view&&<div className="xd-photo-navigator-view" style={{left:percent(view.x,width),top:percent(view.y,height),width:percent(view.width,width),height:percent(view.height,height)}}/>}
    </div>
    <div className="xd-photo-navigator-zoom">
      <input aria-label="Navigator zoom percent" type="number" min={1} max={1600} key={zoom} defaultValue={Math.round(zoom*100)}
        onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur();if(event.key==="Escape"){event.currentTarget.value=String(Math.round(zoom*100));event.currentTarget.blur();}}}
        onBlur={event=>{const value=event.target.valueAsNumber;if(Number.isFinite(value)&&value>0&&value!==Math.round(zoom*100))to(value/100);}}/><span>%</span>
      <button aria-label="Navigator zoom out" title="Zoom out" onClick={()=>to(zoom/1.25)}><Mountain size={10}/></button>
      <input aria-label="Navigator zoom" type="range" min={MIN} max={MAX} step=".01" value={Math.log(zoom)} onChange={event=>zoomTo(Math.exp(event.target.valueAsNumber))}/>
      <button aria-label="Navigator zoom in" title="Zoom in" onClick={()=>to(zoom*1.25)}><Mountain size={15}/></button>
    </div>
  </div>;
}
