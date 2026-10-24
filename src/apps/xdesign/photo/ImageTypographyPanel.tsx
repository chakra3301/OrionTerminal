import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PhotoDocument, PhotoLayer, PhotoTextRun } from "./types";
import { runPhotoCommand, usePhotoWorkspace, controlsLocked } from "./runtime";
import { PhotoTextGeometryDialog } from "./PhotoTextGeometryDialog";
import { useFontFamilies } from "./fontFamilies";

export function characterRange(text:string,start:number,end:number):[number,number] {
  return [Array.from(text.slice(0,start)).length,Array.from(text.slice(0,end)).length];
}
export function rangeStyle(runs:PhotoTextRun[],range:[number,number],field:string):unknown {
  const touched=runs.filter(run=>run.start<range[1]&&run.end>range[0]||run.start===run.end&&range[0]===range[1]);
  if(!touched.length)return undefined;
  const value=touched[0]!.style[field];
  return touched.every(run=>JSON.stringify(run.style[field])===JSON.stringify(value))?value:undefined;
}
export function parseFontSettings(value:string,kind:"features"|"variations"):Record<string,number> {
  const settings:Record<string,number>={};
  for(const entry of value.split(",").map(value=>value.trim()).filter(Boolean)) {
    const match=/^([a-zA-Z0-9]{4})\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(entry);
    if(!match)throw new Error("Use four-character tags and numbers, for example wght=650 or ss01=1.");
    const number=Number(match[2]);
    if(!Number.isFinite(number)||kind==="features"&&(!Number.isInteger(number)||number<0||number>65535))throw new Error("OpenType features require whole numbers from 0 to 65535.");
    settings[match[1]!]=number;
  }
  return settings;
}

export function ImageTypographyPanel({layer,document}:{layer:PhotoLayer;document?:PhotoDocument}) {
  const busy=usePhotoWorkspace(controlsLocked),text=layer.text!;
  const length=Array.from(text.text).length,[selected,setSelected]=useState<[number,number]>([0,length]),[error,setError]=useState<string|null>(null);
  const [geometry,setGeometry]=useState<"box"|"warp"|null>(null);
  const fonts=useFontFamilies();
  const panel=useRef<HTMLDivElement>(null),dialogHost=panel.current?.closest(".xd-photo");
  const geometryDialog=geometry&&document?<PhotoTextGeometryDialog key={`${layer.id}/${geometry}`} kind={geometry} document={document} layer={layer} close={()=>setGeometry(null)}/>:null;
  const range:[number,number]=[Math.min(selected[0],length),Math.min(selected[1],length)];
  const characters=text.runs??[{start:0,end:length,style:{font:text.font,size:text.sizePt}}],paragraphs=text.paragraphs??[];
  const value=(field:string,paragraph=false)=>rangeStyle(paragraph?paragraphs:characters,range,field);
  const update=(patch:Record<string,unknown>)=>{setError(null);void runPhotoCommand("type.setStyle",{layer:layer.id,range,...patch}).catch(()=>{});};
  const options=(field:string,label:string,choices:string[],paragraph=false)=><label className="xd-photo-property">{label}<select aria-label={`Image type ${label}`} disabled={busy||range[0]===range[1]} value={typeof value(field,paragraph)==="string"?String(value(field,paragraph)):""} onChange={event=>update({[field]:event.target.value})}><option value="" disabled>Mixed</option>{choices.map(choice=><option key={choice}>{choice}</option>)}</select></label>;
  const number=(field:string,label:string,min:number,max:number,paragraph=false)=>{
    const current=value(field,paragraph);return <label className="xd-photo-property">{label}<input aria-label={`Image type ${label}`} key={`${layer.id}/${range.join("-")}/${field}/${current}`} type="number" min={min} max={max} step="any" placeholder="Mixed" disabled={busy||range[0]===range[1]} defaultValue={typeof current==="number"?current:""} onBlur={event=>{const next=event.target.valueAsNumber;if(Number.isFinite(next)&&next>=min&&next<=max&&next!==current)update({[field]:next});}}/></label>;
  };
  const boolean=(field:string,label:string,paragraph=false)=>{const current=value(field,paragraph);return <label className="xd-photo-property">{label}<input aria-label={`Image type ${label}`} type="checkbox" disabled={busy||range[0]===range[1]} checked={current===true} ref={element=>{if(element)element.indeterminate=current===undefined;}} onChange={event=>update({[field]:event.target.checked})}/></label>;};
  const color=value("color"),leading=value("leading");
  return <div ref={panel} className="xd-photo-type-panel">
    <p className="xd-photo-section-help">Select characters below to format a range. Each change preserves other character and paragraph styles.</p><textarea className="xd-photo-type-range" aria-label="Select image text range" readOnly value={text.text} onSelect={event=>{const element=event.currentTarget;if(element.selectionStart!==element.selectionEnd)setSelected(characterRange(text.text,element.selectionStart,element.selectionEnd));}}/>
    <div className="xd-photo-type-range-controls"><span>{range[0]===0&&range[1]===length?"Whole text":`Characters ${range[0]+1}–${range[1]}`}</span><button disabled={busy} onClick={()=>setSelected([0,length])}>Select all text</button></div>
    <label className="xd-photo-property">Font{fonts.list}<input aria-label="Image type Font" list={fonts.listId} placeholder="Mixed" disabled={busy} key={`${layer.id}/${range.join("-")}/${value("font")}`} defaultValue={typeof value("font")==="string"?String(value("font")):""} onBlur={event=>{if(event.target.value&&event.target.value!==value("font"))update({font:event.target.value});}}/></label>
    {number("size","Size (pt)",.1,10000)}{number("weight","Weight",1,1000)}
    <label className="xd-photo-property">Color<input aria-label="Image type Color" type="color" disabled={busy} key={String(color)} defaultValue={typeof color==="string"?color.slice(0,7):"#ffffff"} onChange={event=>{event.currentTarget.dataset.changed="true";}} onBlur={event=>{if(event.currentTarget.dataset.changed)update({color:event.target.value+(typeof color==="string"&&color.length===9?color.slice(7):"")});}}/></label>
    {boolean("italic","Italic")}{boolean("underline","Underline")}{boolean("strikethrough","Strikethrough")}
    <details className="xd-photo-effect-card"><summary>Character spacing & shaping</summary>{number("tracking","Tracking",-1000,10000)}{options("kerning","Kerning",["metrics","optical","off"])}{number("kerning","Manual kerning",-1000,10000)}
      <label className="xd-photo-property">Leading (pt)<input aria-label="Image type Leading" key={`${range.join("-")}/${leading}`} defaultValue={typeof leading==="number"?leading:leading==="auto"?"auto":""} placeholder="Mixed or auto" disabled={busy} onBlur={event=>{const input=event.target.value.trim(),next=input==="auto"?"auto":Number(input);if(input&&(next==="auto"||Number.isFinite(next)&&Number(next)>0))update({leading:next});}}/></label>
      {number("baselineShift","Baseline shift (pt)",-10000,10000)}{number("horizontalScale","Horizontal scale (%)",1,1000)}{number("verticalScale","Vertical scale (%)",1,1000)}{options("caps","Capitalization",["normal","small","all"])}{boolean("ligatures","Ligatures")}{boolean("discretionaryLigatures","Discretionary ligatures")}{boolean("fauxBold","Faux bold")}{boolean("fauxItalic","Faux italic")}
      <label className="xd-photo-property">Language<input aria-label="Image type Language" disabled={busy} key={`${range.join("-")}/${value("language")}`} defaultValue={typeof value("language")==="string"?String(value("language")):""} placeholder="auto or BCP-47" onBlur={event=>{if(event.target.value.trim()!==(typeof value("language")==="string"?String(value("language")):""))update({language:event.target.value.trim()||null});}}/></label>
      {(["features","variations"] as const).map(kind=>{const current=value(kind),initial=current&&typeof current==="object"?Object.entries(current).map(([key,value])=>`${key}=${value}`).join(", "):"";return <label className="xd-photo-property" key={kind}>{kind==="features"?"OpenType features":"Font axes"}<input aria-label={`Image type ${kind}`} disabled={busy} key={`${range.join("-")}/${JSON.stringify(current)}`} placeholder={kind==="features"?"ss01=1":"wght=650"} defaultValue={initial} onBlur={event=>{if(event.target.value===initial)return;try{update({[kind]:parseFontSettings(event.target.value,kind)});}catch(error){setError(String(error));}}}/></label>;})}
    </details>
    <details className="xd-photo-effect-card"><summary>Paragraph</summary>{options("align","Alignment",["left","center","right","justify","justifyCenter","justifyRight","justifyAll"],true)}{options("direction","Direction",["auto","ltr","rtl"],true)}{number("firstLineIndent","First line indent (pt)",-10000,10000,true)}{number("startIndent","Start indent (pt)",-10000,10000,true)}{number("endIndent","End indent (pt)",-10000,10000,true)}{number("spaceBefore","Space before (pt)",0,10000,true)}{number("spaceAfter","Space after (pt)",0,10000,true)}{number("autoLeading","Auto leading (%)",1,1000,true)}{boolean("hyphenate","Hyphenate",true)}</details>
    <label className="xd-photo-property">Antialias<select aria-label="Image type Antialias" disabled={busy} value={text.antialias??"smooth"} onChange={event=>{void runPhotoCommand("type.edit",{layer:layer.id,antialias:event.target.value}).catch(()=>{});}}>{["none","sharp","crisp","strong","smooth"].map(value=><option key={value}>{value}</option>)}</select></label>
    <label className="xd-photo-property">Orientation<select aria-label="Image type Orientation" disabled={busy} value={text.orientation??"horizontal"} onChange={event=>{void runPhotoCommand(`type.orientation.${event.target.value}`,{layer:layer.id}).catch(()=>{});}}><option>horizontal</option><option>vertical</option></select></label>
    <div className="xd-pencil-buttons"><button type="button" disabled={busy||!document||!text.transform} onClick={()=>setGeometry("box")}>Text position & box…</button><button type="button" disabled={busy||!document} onClick={()=>setGeometry("warp")}>Warp text…</button></div>
    <button type="button" disabled={busy} onClick={()=>{void runPhotoCommand(text.shape?.kind==="box"?"type.convertToPointText":"type.convertToParagraphText",{layer:layer.id}).catch(()=>{});}}>{text.shape?.kind==="box"?"Convert to point text":"Convert to paragraph text"}</button>
    {geometryDialog&&(dialogHost?createPortal(geometryDialog,dialogHost):geometryDialog)}
    {text.truncated&&<p className="xd-photo-section-help">Only the first 4096 style runs are listed. The native document retains all runs.</p>}{error&&<p role="alert">{error}</p>}
  </div>;
}
