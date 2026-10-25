import { useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import type { GradientFill, PhotoDocument, PhotoLayer } from "./types";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { GradientEditorDialog, GradientPick, gradientCss, type EditedGradient } from "./GradientEditorDialog";
import { AngleDial } from "./psAdjustControls";
import { PopupSlider } from "./OptionsBarControls";
import { documentUnder } from "./ColorRangeDialog";
import { GRADIENT_METHODS, bakeRemembered, unbaked, type GradientMethod } from "./gradientMethod";

type XY=[number,number];
type Stops=[number,string][];
const STYLES=["linear","radial","angle","reflected","diamond"];
const hex=(color:string)=>color.slice(0,7);
const round=(value:number)=>Math.round(value*100)/100||0;
const stop=(event:SyntheticEvent)=>event.stopPropagation();

/** The chord through the document's centre along `angle`: the length the engine's (and the PSD's) 100% scale spans. */
const chordAt=(angle:number,width:number,height:number)=>{
  const a=angle*Math.PI/180,cos=Math.abs(Math.cos(a)),sin=Math.abs(Math.sin(a));
  return Math.min(cos>1e-9?width/cos:Infinity,sin>1e-9?height/sin:Infinity);
};

/** Photoshop shows a fill's scale against the document's short side, halved for every style but Linear (133% for a stored 100% at 0° on 800 × 600, 67% Radial). */
export const scaleShown=(style:string,angle:number,width:number,height:number)=>chordAt(angle,width,height)/Math.min(width,height)/(style==="linear"?1:2);

/** Photoshop's Fit to document: through the document's centre at the gradient's angle, reaching as far as the engine's 100% does for the style. */
export function fitToDocument(style:string,angle:number,width:number,height:number):{from:XY;to:XY} {
  const a=angle*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a),centre:XY=[width/2,height/2];
  const chord=chordAt(angle,width,height);
  const reach=style==="linear"||style==="reflected"?chord/2:Math.hypot(cos*width,sin*height)/2;
  const at=(k:number):XY=>[round(centre[0]+cos*k),round(centre[1]-sin*k)];
  return style==="linear"?{from:at(-reach),to:at(reach)}:{from:centre,to:at(reach)};
}

/** A number field that can hold a partial entry while typing; only numbers in range reach the gradient. */
function NumberField({label,value,min,max,disabled,className,set}:{label:string;value:number;min:number;max:number;disabled:boolean;className?:string;set:(value:number)=>void}) {
  // The entry shows only while the value is still the one it set, so Reset and drags replace it.
  const [draft,setDraft]=useState<{text:string;value:number}|null>(null);
  return <input type="number" className={className} aria-label={label} min={min} max={max} step="any" disabled={disabled} value={draft?.value===value?draft.text:Math.round(value)} onChange={event=>{
    const next=event.target.valueAsNumber,valid=Number.isFinite(next)&&next>=min&&next<=max;
    setDraft({text:event.target.value,value:valid?next:value});if(valid)set(next);
  }} onBlur={()=>setDraft(null)}/>;
}

/** Photoshop's Gradient Fill dialog. Every change previews on the document, and dragging the image moves the gradient.
 * `cancel` replaces `close` for Cancel and Escape, so a layer made just for this dialog can be dropped as Photoshop does. */
export function GradientFillDialog({document,layer,canvas,close,cancel=close}:{document:PhotoDocument;layer:PhotoLayer;canvas?:HTMLElement|null;close:()=>void;cancel?:()=>void}) {
  const busy=usePhotoWorkspace(state=>state.busy),projectId=usePhotoWorkspace(state=>state.projectId),error=usePhotoWorkspace(state=>state.error);
  const previewAllowed=document.width*document.height<=16_777_216,[patch,setPatch]=useState<Partial<GradientFill>>({});
  const [editing,setEditing]=useState<{before:Partial<GradientFill>;root:Element}|null>(null);
  const preview=usePhotoCommandPreview(document,projectId,"gradient.fill.set",{layer:layer.id,...patch},{automatic:previewAllowed,enabled:!busy});
  const native=preview.result&&typeof preview.result==="object"&&"from" in preview.result&&"to" in preview.result?preview.result as GradientFill:null;
  const gradient:GradientFill={...layer.gradientFill!,...native,...patch};
  const found=unbaked(gradient.stops),method:GradientMethod=found?.method??"classic",plain:Stops=found?.stops??gradient.stops;
  const dialog=useDesignDialog<HTMLFormElement>(cancel,busy);
  const change=(next:Partial<GradientFill>)=>setPatch(current=>{
    const out={...current,...next};
    if("angle" in next||"scale" in next||"offset" in next||"align" in next){
      // Handles from a drag or Fit carry the angle, scale and offset the engine worked out; keep them when the handles go.
      if("from" in current)Object.assign(out,{angle:gradient.angle,scale:gradient.scale,offset:gradient.offset},next);
      delete out.from;delete out.to;
    }
    if("from" in next||"to" in next){delete out.angle;delete out.scale;delete out.offset;}
    return out;
  });
  // The engine blends stops linearly, so Methods other than Classic go as baked stops.
  const colors=(stops:Stops,as:GradientMethod)=>stops.every(([,color])=>/^#[\da-f]{6}$/i.test(color))&&bakeRemembered(stops,as)||stops;
  const transparency=(opacity:[number,number][]):[number,number][]=>opacity.length?opacity.map(([at,alpha])=>[at,Math.round(alpha*100)]):[[0,100],[1,100]];
  const edited=(next:EditedGradient<string>)=>change({stops:colors(next.stops,method),transparency:transparency(next.opacity),midpoints:method==="classic"&&next.stops.length===gradient.stops.length?gradient.midpoints:[]});
  const drag=(event:{target:unknown;currentTarget:unknown;button:number;clientX:number;clientY:number})=>{
    const image=event.button===0&&!busy&&event.target===event.currentTarget?documentUnder(canvas??null,event.clientX,event.clientY):null;
    if(!image)return;
    const scale=image.width?document.width/image.width:1,{from,to}=gradient;
    const move=(next:globalThis.PointerEvent)=>{const dx=Math.round((next.clientX-event.clientX)*scale),dy=Math.round((next.clientY-event.clientY)*scale);change({from:[from[0]+dx,from[1]+dy],to:[to[0]+dx,to[1]+dy]});};
    const end=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",end);window.removeEventListener("pointercancel",end);};
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",end);window.addEventListener("pointercancel",end);
  };
  const shown=scaleShown(gradient.style,gradient.angle,document.width,document.height);
  // The engine stores 10–150% where Photoshop clamps the shown scale instead, so a Radial fill tops out lower here.
  const stored=(scale:number)=>Math.min(150,Math.max(10,scale));
  // Photoshop keeps the scale it shows when the angle or style changes, so the stored scale follows.
  const reshape=(next:{angle:number}|{style:string})=>change({...next,scale:stored(gradient.scale*shown/scaleShown("style" in next?next.style:gradient.style,"angle" in next?next.angle:gradient.angle,document.width,document.height))});
  const check=(key:"reverse"|"dither"|"align",name:string,text:string)=><label className="xd-ps-dialog-check"><input type="checkbox" aria-label={name} disabled={busy} checked={gradient[key]} onChange={event=>change({[key]:event.target.checked})}/>{text}</label>;
  return <PhotoDialog dialog={dialog} title="Gradient Fill" label="Edit gradient fill" className="xd-gf-dialog" beside busy={busy} close={cancel} reset={()=>setPatch({})} scrim={{onPointerDown:drag}} onSubmit={event=>{event.preventDefault();void runPhotoCommand("gradient.fill.set",{layer:layer.id,...patch}).then(close).catch(()=>{});}}>
    <div className="xd-ps-dialog-grid">
      <span className="xd-ps-dialog-label">Gradient:</span><span className="xd-gf-field"><GradientPick css={gradientCss(gradient.stops,gradient.transparency.map(([at,alpha]):[number,number]=>[at,alpha/100]),hex)} disabled={busy}
        edit={event=>setEditing({before:patch,root:event.currentTarget.closest(".xd-photo")??window.document.body})} choose={next=>change({stops:colors(next.stops,method),transparency:transparency(next.opacity),midpoints:[]})}/></span>
      <label className="xd-ps-dialog-field"><span>Style:</span><select aria-label="Fill gradient style" value={gradient.style} disabled={busy} onChange={event=>reshape({style:event.target.value})}>{STYLES.map(style=><option key={style} value={style}>{style[0]!.toUpperCase()+style.slice(1)}</option>)}</select></label>
      <span className="xd-ps-dialog-label">Angle:</span><span className="xd-gf-field"><AngleDial label="Fill gradient angle" value={gradient.angle} disabled={busy} change={angle=>reshape({angle})}/><NumberField label="Fill gradient angle" value={gradient.angle} min={-360} max={360} disabled={busy} set={angle=>reshape({angle})}/><span className="xd-ps-dialog-unit">°</span></span>
      <span className="xd-ps-dialog-label">Scale:</span><span className="xd-gf-field"><PopupSlider label="Scale" ariaLabel="Fill gradient scale" unit="%" min={10} max={150} value={Math.round(gradient.scale*shown)} disabled={busy} change={scale=>change({scale:stored(scale/shown)})} commit={()=>{}}
        input={<NumberField label="Fill gradient scale" className="xd-ps-number" value={round(gradient.scale*shown)} min={10} max={150} disabled={busy} set={scale=>change({scale:stored(scale/shown)})}/>}/></span>
      <span className="xd-gf-field">{check("reverse","Reverse colors","Reverse")}{check("dither","Dither","Dither")}</span>
      <span className="xd-gf-field">{check("align","Align with layer","Align with layer")}</span>
      <span className="xd-gf-field"><button type="button" disabled={busy} onClick={()=>change({offset:[0,0]})}>Reset Alignment</button><button type="button" disabled={busy} onClick={()=>change(fitToDocument(gradient.style,gradient.angle,document.width,document.height))}>Fit to document</button></span>
      <label className="xd-ps-dialog-field"><span>Method:</span><select aria-label="Fill gradient method" value={method} disabled={busy} onChange={event=>change({stops:colors(plain,event.target.value as GradientMethod),midpoints:[]})}>{GRADIENT_METHODS.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    </div>
    {preview.error&&<p role="alert">{preview.error}</p>}{error&&<p role="alert">{error}</p>}
    {canvas&&preview.url&&createPortal(<img className="xd-photo-canvas-preview" src={preview.url} alt="" draggable={false}/>,canvas)}
    {/* Events bubble out of a portal through the React tree, so without this the editor's OK would submit this dialog. */}
    {editing&&createPortal(<div className="xd-ge-portal" onSubmit={stop} onKeyDown={stop} onFocus={stop} onBlur={stop}>
      <GradientEditorDialog<string> gradient={{stops:plain,opacity:gradient.transparency.every(([,alpha])=>alpha>=100)?[]:gradient.transparency.map(([at,alpha])=>[at,alpha/100])}} hex={hex} color={(value,from)=>from?.length===9?value+from.slice(7):value}
        preview={edited} choose={next=>{edited(next);setEditing(null);}} close={()=>{setPatch(editing.before);setEditing(null);}}/>
    </div>,editing.root)}
  </PhotoDialog>;
}
