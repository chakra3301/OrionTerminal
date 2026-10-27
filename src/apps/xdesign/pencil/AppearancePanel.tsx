import type { Color, Effect, Fill, SceneNode, Stroke } from "@open-pencil/scene-graph";
import { useMemo } from "react";
import { usePencilWorkspace } from "./runtime";
import { PatternFillControls } from "./PatternFillControls";
import { TextureFillControls } from "./TextureFillControls";
import { VideoFillControls } from './VideoFillControls';
import { IDENTITY_PAINT_TRANSFORM, centerPaint, flipPaint, initialImageTransform, paintAngle, paintCenter, rotatePaint, sizePaintAxis, validPaintTransform } from "./fillGeometry";

export const colorHex=(color:Color)=>`#${[color.r,color.g,color.b].map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,"0")).join("")}`;
export const hexColor=(hex:string,alpha=1):Color=>({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255,a:alpha});
export const displayNumber=(value:number)=>Math.round(value*100)/100;
export function NumericValue({label,value,onCommit,min=0,max}:{label:string;value:number;onCommit:(value:number)=>void;min?:number;max?:number}) {
  const shown=displayNumber(value);
  return <label>{label}<input aria-label={label} key={value} type="number" defaultValue={shown} min={min} max={max} step="any" onBlur={e=>{const v=e.currentTarget.valueAsNumber;if(Number.isFinite(v)&&v>=min&&(max===undefined||v<=max)&&v!==shown)onCommit(v);}} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/></label>;
}
function ColorValue({label,color,onCommit}:{label:string;color:Color;onCommit:(color:Color)=>void}) {
  return <label>{label}<input aria-label={label} type="color" defaultValue={colorHex(color)} key={colorHex(color)} onBlur={e=>{if(e.currentTarget.value!==colorHex(color))onCommit(hexColor(e.currentTarget.value,color.a));}}/></label>;
}
export const BLEND_LABELS:Record<SceneNode["blendMode"],string>={PASS_THROUGH:"Pass through",NORMAL:"Normal",DARKEN:"Darken",MULTIPLY:"Multiply",COLOR_BURN:"Color burn",LIGHTEN:"Lighten",SCREEN:"Screen",COLOR_DODGE:"Color dodge",OVERLAY:"Overlay",SOFT_LIGHT:"Soft light",HARD_LIGHT:"Hard light",DIFFERENCE:"Difference",EXCLUSION:"Exclusion",HUE:"Hue",SATURATION:"Saturation",COLOR:"Color",LUMINOSITY:"Luminosity"};
const BLENDS=Object.keys(BLEND_LABELS) as SceneNode["blendMode"][];
const DEFAULT_FILL:Fill={type:"SOLID",color:{r:.75,g:.75,b:.75,a:1},opacity:1,visible:true};
const DEFAULT_STROKE:Stroke={color:{r:0,g:0,b:0,a:1},opacity:1,weight:1,visible:true,align:"INSIDE"};
const DEFAULT_EFFECT:Effect={type:"DROP_SHADOW",color:{r:0,g:0,b:0,a:.25},offset:{x:0,y:4},radius:8,spread:0,visible:true};
function PaintGeometryControls({fill,node,index,change}:{fill:Fill;node:SceneNode;index:number;change:(patch:Partial<Fill>)=>void}) {
  const editor=usePencilWorkspace(state=>state.editor)!;
  const image=fill.type==="IMAGE", prefix=`${image?"Image":"Gradient"} ${index+1}`;
  const bytes=fill.imageHash?editor.graph.images.get(fill.imageHash):undefined, renderer=editor.renderer;
  const dimensions=useMemo(()=>{
    if(!image||!bytes||!renderer)return null;
    const cached=fill.imageHash?renderer.imageCache.get(fill.imageHash):undefined;
    if(cached)return {width:cached.width(),height:cached.height()};
    const decoded=renderer.ck.MakeImageFromEncoded(bytes);if(!decoded)return null;
    try{return {width:decoded.width(),height:decoded.height()};}finally{decoded.delete();}
  },[image,bytes,renderer,fill.imageHash]);
  const matrix=image?fill.imageTransform??(dimensions?initialImageTransform(fill,node,dimensions):null):fill.gradientTransform??IDENTITY_PAINT_TRANSFORM;
  if(!matrix)return <p className="xd-pencil-paint-help">Image transform controls become available when the source image is loaded.</p>;
  const valid=validPaintTransform(matrix), center=paintCenter(matrix);
  const commit=(next:typeof matrix)=>{if(validPaintTransform(next))change(image?{imageTransform:next}:{gradientTransform:next});};
  return <details className="xd-pencil-property-card"><summary>{image?"Source image transform":"Gradient geometry"}</summary>
    {image&&<p className="xd-pencil-paint-help">The source region uses percentages of the image. Rotation and flips keep its center fixed.</p>}
    {!valid&&<p role="alert">This imported transform has a collapsed axis. Reset its geometry to edit it.</p>}
    {valid&&<><div className="xd-pencil-grid"><NumericValue label={`${prefix} center X %`} min={-10000} max={10000} value={center[0]*100} onCommit={value=>commit(centerPaint(matrix,[value/100,center[1]]))}/><NumericValue label={`${prefix} center Y %`} min={-10000} max={10000} value={center[1]*100} onCommit={value=>commit(centerPaint(matrix,[center[0],value/100]))}/></div>
      <div className="xd-pencil-grid"><NumericValue label={`${prefix} width %`} min={.01} max={10000} value={Math.hypot(matrix.m00,matrix.m10)*100} onCommit={value=>commit(sizePaintAxis(matrix,"x",value/100))}/><NumericValue label={`${prefix} height %`} min={.01} max={10000} value={Math.hypot(matrix.m01,matrix.m11)*100} onCommit={value=>commit(sizePaintAxis(matrix,"y",value/100))}/></div>
      <NumericValue label={`${prefix} angle`} min={-360} max={360} value={paintAngle(matrix)} onCommit={value=>commit(rotatePaint(matrix,value))}/>
      <div className="xd-pencil-buttons"><button aria-label={`${prefix} flip horizontal`} onClick={()=>commit(flipPaint(matrix,"x"))}>Flip horizontal</button><button aria-label={`${prefix} flip vertical`} onClick={()=>commit(flipPaint(matrix,"y"))}>Flip vertical</button></div>
    </>}
    <button aria-label={`${prefix} reset geometry`} onClick={()=>change(image?{imageTransform:undefined}:{gradientTransform:{...IDENTITY_PAINT_TRANSFORM}})}>Reset geometry</button>
  </details>;
}
export function AppearancePanel({node}:{node:SceneNode}) {
  const editor=usePencilWorkspace(s=>s.editor)!;
  const update=(patch:Partial<SceneNode>,label:string)=>editor.updateNodeWithUndo(node.id,patch,label);
  const fill=(i:number,patch:Partial<Fill>)=>update({fills:node.fills.map((f,j)=>i===j?{...f,...patch}:f)},"Change fill");
  const stroke=(i:number,patch:Partial<Stroke>)=>update({strokes:node.strokes.map((s,j)=>i===j?{...s,...patch}:s)},"Change stroke");
  const effect=(i:number,patch:Partial<Effect>)=>update({effects:node.effects.map((s,j)=>i===j?{...s,...patch}:s)},"Change effect");
  return <div className="xd-pencil-appearance">
    <label>Blend<select aria-label="Layer blend" value={node.blendMode} onChange={e=>update({blendMode:e.target.value as SceneNode["blendMode"]},"Change blend mode")}>{BLENDS.map(v=><option key={v} value={v}>{BLEND_LABELS[v]}</option>)}</select></label>
    <NumericValue label="Opacity %" value={Math.round(node.opacity*100)} max={100} onCommit={v=>update({opacity:v/100},"Change opacity")}/>
    <div className="xd-pencil-section-title"><h3>Fills</h3><button aria-label="Add fill" onClick={()=>update({fills:[...node.fills,structuredClone(DEFAULT_FILL)]},"Add fill")}>+</button></div>
    {node.fills.map((f,i)=><details className="xd-pencil-property-card" key={i} open={node.fills.length===1}>
      <summary>Fill {i+1} · {f.type.toLowerCase().replaceAll("_"," ")}</summary>
      <div className="xd-pencil-buttons"><button onClick={()=>fill(i,{visible:!f.visible})}>{f.visible?"Hide":"Show"}</button><button onClick={()=>update({fills:node.fills.filter((_,j)=>i!==j)},"Remove fill")}>Remove</button><button disabled={i===0} onClick={()=>{const fills=[...node.fills];[fills[i-1],fills[i]]=[fills[i]!,fills[i-1]!];update({fills},"Reorder fills");}}>Move up</button></div>
      <select aria-label={`Fill ${i+1} type`} value={f.type} onChange={e=>{const type=e.target.value as Fill["type"];fill(i,{type,...(type.startsWith("GRADIENT")&&!f.gradientStops?{gradientStops:[{position:0,color:f.color},{position:1,color:{r:1,g:1,b:1,a:1}}],gradientTransform:{m00:1,m01:0,m02:0,m10:0,m11:1,m12:0}}:{})});}}>{["SOLID","GRADIENT_LINEAR","GRADIENT_RADIAL","GRADIENT_ANGULAR","GRADIENT_DIAMOND","PATTERN","NOISE","CUSTOM",...(f.imageHash||f.type==="IMAGE"?["IMAGE"]:[]),...(!["SOLID","GRADIENT_LINEAR","GRADIENT_RADIAL","GRADIENT_ANGULAR","GRADIENT_DIAMOND","PATTERN","NOISE","CUSTOM","IMAGE"].includes(f.type)?[f.type]:[])].map(v=><option key={v}>{v}</option>)}</select>
      <NumericValue label={`Fill ${i+1} opacity %`} value={Math.round(f.opacity*100)} max={100} onCommit={v=>fill(i,{opacity:v/100})}/>
      <label>Paint blend<select aria-label={`Fill ${i+1} blend`} value={f.blendMode??"NORMAL"} onChange={event=>fill(i,{blendMode:event.target.value as Fill["blendMode"]})}>{BLENDS.map(mode=><option key={mode} value={mode}>{BLEND_LABELS[mode]}</option>)}</select></label>
      {f.type==="PATTERN"&&<PatternFillControls node={node} fill={f} index={i} change={patch=>fill(i,patch)}/>}
      {["NOISE","CUSTOM"].includes(f.type)&&<TextureFillControls fill={f} index={i} change={patch=>fill(i,patch)}/>}
      {["SOLID","NOISE","CUSTOM"].includes(f.type)&&<ColorValue label={`Fill ${i+1} color`} color={f.color} onCommit={color=>fill(i,{color})}/>}
      {f.type==="IMAGE"&&<><label>Image fit<select aria-label={`Image ${i+1} fit`} value={f.imageScaleMode??"FILL"} onChange={e=>fill(i,{imageScaleMode:e.target.value as Fill["imageScaleMode"]})}>{["FILL","FIT","CROP","TILE"].map(v=><option key={v}>{v}</option>)}</select></label>{["CROP","TILE"].includes(f.imageScaleMode??"FILL")&&<PaintGeometryControls fill={f} node={node} index={i} change={patch=>fill(i,patch)}/>}</>}
      {f.type==='VIDEO'&&<VideoFillControls node={node} fill={f} index={i} change={patch=>fill(i,patch)}/>}
      {f.type.startsWith("GRADIENT")&&<>
        {(f.gradientStops??[]).map((stop,j)=><div className="xd-pencil-gradient-stop" key={j}><ColorValue label={`Stop ${j+1} color`} color={stop.color} onCommit={color=>fill(i,{gradientStops:f.gradientStops!.map((s,k)=>k===j?{...s,color}:s)})}/><NumericValue label={`Stop ${j+1} %`} value={Math.round(stop.position*100)} max={100} onCommit={v=>fill(i,{gradientStops:f.gradientStops!.map((s,k)=>k===j?{...s,position:v/100}:s).sort((a,b)=>a.position-b.position)})}/><NumericValue label={`Stop ${j+1} alpha %`} value={Math.round(stop.color.a*100)} max={100} onCommit={v=>fill(i,{gradientStops:f.gradientStops!.map((s,k)=>k===j?{...s,color:{...s.color,a:v/100}}:s)})}/><button disabled={(f.gradientStops?.length??0)<=2} onClick={()=>fill(i,{gradientStops:f.gradientStops!.filter((_,k)=>k!==j)})}>Remove stop</button></div>)}
        <button onClick={()=>fill(i,{gradientStops:[...(f.gradientStops??[]),{position:.5,color:{r:.5,g:.5,b:.5,a:1}}].sort((a,b)=>a.position-b.position)})}>Add stop</button>
        <PaintGeometryControls fill={f} node={node} index={i} change={patch=>fill(i,patch)}/>
      </>}
    </details>)}
    <div className="xd-pencil-section-title"><h3>Strokes</h3><button aria-label="Add stroke" onClick={()=>update({strokes:[...node.strokes,structuredClone(DEFAULT_STROKE)]},"Add stroke")}>+</button></div>
    {node.strokes.map((s,i)=><details className="xd-pencil-property-card" key={i} open={node.strokes.length===1}><summary>Stroke {i+1} · {s.weight}px</summary><div className="xd-pencil-buttons"><button onClick={()=>stroke(i,{visible:!s.visible})}>{s.visible?"Hide":"Show"}</button><button onClick={()=>update({strokes:node.strokes.filter((_,j)=>i!==j)},"Remove stroke")}>Remove</button></div><ColorValue label={`Stroke ${i+1} color`} color={s.color} onCommit={color=>stroke(i,{color})}/><NumericValue label="Stroke width" value={s.weight} onCommit={weight=>stroke(i,{weight})}/><NumericValue label="Stroke opacity %" value={Math.round(s.opacity*100)} max={100} onCommit={v=>stroke(i,{opacity:v/100})}/><label>Alignment<select value={s.align} onChange={e=>stroke(i,{align:e.target.value as Stroke["align"]})}>{["INSIDE","CENTER","OUTSIDE"].map(v=><option key={v}>{v}</option>)}</select></label><label>Cap<select value={s.cap??"NONE"} onChange={e=>stroke(i,{cap:e.target.value as Stroke["cap"]})}>{["NONE","ROUND","SQUARE","ARROW_LINES","ARROW_EQUILATERAL"].map(v=><option key={v}>{v}</option>)}</select></label><label>Join<select value={s.join??"MITER"} onChange={e=>stroke(i,{join:e.target.value as Stroke["join"]})}>{["MITER","BEVEL","ROUND"].map(v=><option key={v}>{v}</option>)}</select></label><label>Dashes<input aria-label="Stroke dashes" key={(s.dashPattern??[]).join(",")} defaultValue={(s.dashPattern??[]).join(", ")} placeholder="4, 4" onBlur={e=>{const values=e.target.value.trim()?e.target.value.split(/[ ,]+/).map(Number):[];if(values.every(v=>Number.isFinite(v)&&v>=0))stroke(i,{dashPattern:values});}}/></label></details>)}
    <div className="xd-pencil-section-title"><h3>Effects</h3><button aria-label="Add effect" onClick={()=>update({effects:[...node.effects,structuredClone(DEFAULT_EFFECT)]},"Add effect")}>+</button></div>
    {node.effects.map((s,i)=><details className="xd-pencil-property-card" key={i} open={node.effects.length===1}><summary>{s.type.toLowerCase().replaceAll("_"," ")}</summary><div className="xd-pencil-buttons"><button onClick={()=>effect(i,{visible:!s.visible})}>{s.visible?"Hide":"Show"}</button><button onClick={()=>update({effects:node.effects.filter((_,j)=>i!==j)},"Remove effect")}>Remove</button></div><select aria-label={`Effect ${i+1} type`} value={s.type} onChange={e=>effect(i,{type:e.target.value as Effect["type"]})}>{["DROP_SHADOW","INNER_SHADOW","LAYER_BLUR","BACKGROUND_BLUR","FOREGROUND_BLUR"].map(v=><option key={v}>{v}</option>)}</select>{s.type.includes("SHADOW")&&<label>Effect blend<select aria-label={`Effect ${i+1} blend`} value={s.blendMode??"NORMAL"} onChange={event=>effect(i,{blendMode:event.target.value as Effect["blendMode"]})}>{BLENDS.map(mode=><option key={mode} value={mode}>{BLEND_LABELS[mode]}</option>)}</select></label>}<NumericValue label="Blur" value={s.radius} onCommit={radius=>effect(i,{radius})}/>{s.type.includes("SHADOW")&&<><label><input aria-label={`Effect ${i+1} show behind layer`} type="checkbox" checked={s.showShadowBehindNode!==false} onChange={event=>effect(i,{showShadowBehindNode:event.target.checked})}/>Show shadow behind layer</label><ColorValue label="Shadow color" color={s.color} onCommit={color=>effect(i,{color})}/><NumericValue label="Shadow opacity %" value={Math.round(s.color.a*100)} max={100} onCommit={v=>effect(i,{color:{...s.color,a:v/100}})}/><div className="xd-pencil-grid"><NumericValue label="Shadow X" min={-100000} value={s.offset.x} onCommit={x=>effect(i,{offset:{...s.offset,x}})}/><NumericValue label="Shadow Y" min={-100000} value={s.offset.y} onCommit={y=>effect(i,{offset:{...s.offset,y}})}/></div><NumericValue label="Spread" min={-100000} value={s.spread} onCommit={spread=>effect(i,{spread})}/></>}</details>)}
    <label><input type="checkbox" checked={node.isMask} onChange={e=>update({isMask:e.target.checked},"Change mask")}/>Use as mask</label>{node.isMask&&<select aria-label="Mask type" value={node.maskType} onChange={e=>update({maskType:e.target.value as SceneNode["maskType"]},"Change mask type")}>{["ALPHA","VECTOR","LUMINANCE"].map(v=><option key={v}>{v}</option>)}</select>}
  </div>;
}
