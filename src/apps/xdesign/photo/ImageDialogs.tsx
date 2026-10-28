import { Fragment, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, Link2, Link2Off, Pipette } from "lucide-react";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer, PhotoState } from "./types";
import { ipc } from "../../../lib/ipc";
import { usePhotoCommandPreview } from "./commandPreview";
import { documentUnder } from "./ColorRangeDialog";
import { sampleImageColor } from "./eyedropper";
import { paintColorHex } from "./imageColors";
import { selectionDefaults, selectionRequest, selectionSamplePoint } from "./selectionSettings";
import { useDesignDialog } from "../useDesignDialog";
import { REPLACE_COLOR, type CommandField, type ImageCommand } from "./imageCommands";
import { useFontFamilies } from "./fontFamilies";
import { PhotoDialog } from "./photoDialog";
import { blendOptions } from "./blendOptions";

function Dialog({title,children,apply,close,reset,ok,okDisabled,...frame}:{title:string;children:ReactNode;apply:()=>Promise<unknown>;close:()=>void;reset?:()=>void;ok?:string;okDisabled?:boolean}&Pick<ComponentProps<typeof PhotoDialog>,"className"|"beside"|"scrim"|"preview"|"buttons">) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error);
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  return <PhotoDialog {...frame} dialog={dialog} title={title} busy={busy} ok={ok} okDisabled={okDisabled} close={close} reset={reset} onSubmit={e=>{e.preventDefault();void apply().then(close).catch(()=>{});}}>
    {children}{error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}

function Field({label,unit,children}:{label:string;unit?:ReactNode;children:ReactNode}) {
  return <label className="xd-ps-dialog-field"><span>{label}:</span>{children}{unit!==undefined&&<span className="xd-ps-dialog-unit">{unit}</span>}</label>;
}

function Group({legend,children}:{legend?:string;children:ReactNode}) {
  return legend?<fieldset className="xd-ps-dialog-group"><legend>{legend}</legend>{children}</fieldset>:<>{children}</>;
}

// Photoshop keeps each command's last values for the session; choices that no longer exist (closed images) fall back.
const remembered=new Map<string,Record<string,unknown>>();
const usable=(field:CommandField,value:unknown)=>field.kind==="number"?typeof value==="number"&&value>=field.min&&value<=field.max:
  field.kind==="enum"?field.choices.some(([choice])=>choice===value):field.kind==="boolean"?typeof value==="boolean":field.kind==="text"?typeof value==="string"&&value.trim()!=="":typeof value==="string";
function openingValues(command:ImageCommand,initial?:Record<string,unknown>) {
  const saved=remembered.get(command.id)??{};
  return {...Object.fromEntries(command.fields.map(field=>[field.key,usable(field,saved[field.key])?saved[field.key]:field.value])),...initial};
}

const NO_DOCUMENT={id:"",version:"",name:"",width:0,height:0} as PhotoDocument;
// The HSL shift Replace Color applies (and its inverse, for picking the Result swatch).
const hexRgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
function rgbHsl([r,g,b]:number[]){const max=Math.max(r!,g!,b!),min=Math.min(r!,g!,b!),l=(max+min)/2,d=max-min;if(!d)return [0,0,l] as const;const h=max===r?((g!-b!)/d+6)%6:max===g?(b!-r!)/d+2:(r!-g!)/d+4;return [h/6,d/(1-Math.abs(2*l-1)),l] as const;}
function hslHex([h,s,l]:readonly number[]){const c=(1-Math.abs(2*l!-1))*s!,x=c*(1-Math.abs((h!*6)%2-1)),m=l!-c/2,k=Math.floor(h!*6)%6,[r,g,b]=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][k]!;return "#"+[r,g,b].map(v=>Math.round(Math.min(1,Math.max(0,v!+m))*255).toString(16).padStart(2,"0")).join("");}
const lift=(v:number,amount:number)=>amount>=0?v+(1-v)*amount/100:v*(1+amount/100);
const unlift=(from:number,to:number)=>to>=from?from<1?(to-from)/(1-from)*100:0:from>0?(to/from-1)*100:0;
export const replacedColor=(hex:string,hue:number,saturation:number,lightness:number)=>{const [h,s,l]=rgbHsl(hexRgb(hex));return hslHex([((h+hue/360)%1+1)%1,Math.min(1,Math.max(0,lift(s,saturation))),Math.min(1,Math.max(0,lift(l,lightness)))]);};
export function replacementFor(hex:string,result:string){const [h,s,l]=rgbHsl(hexRgb(hex)),[th,ts,tl]=rgbHsl(hexRgb(result)),round=(v:number,limit:number)=>Math.max(-limit,Math.min(limit,Math.round(v)));return {hue:round(((th-h)*360+540)%360-180,180),saturation:round(unlift(s,ts),100),lightness:round(unlift(l,tl),100)};}

const moreShown=new Map<string,boolean>();

export function ImageCommandDialog({command,initial,document,canvas=null,close}:{command:ImageCommand;initial?:Record<string,unknown>;document?:PhotoDocument;canvas?:HTMLElement|null;close:()=>void}) {
  const [opening]=useState(()=>openingValues(command,initial)),[values,setValues]=useState(opening);
  const [more,setMore]=useState(()=>moreShown.get(command.id)??false),[live,setLive]=useState(true),[localError,setLocalError]=useState("");
  const [eyedropper,setEyedropper]=useState(true),[overImage,setOverImage]=useState(false),[thumbnail,setThumbnail]=useState<"selection"|"image">("selection");
  const projectId=usePhotoWorkspace(s=>s.projectId),imageState=usePhotoWorkspace(s=>s.state),busy=usePhotoWorkspace(s=>s.busy);
  const set=(key:string,value:unknown)=>{setValues(current=>({...current,[key]:value}));setLocalError("");};
  const radios=(field:CommandField)=>field.kind==="enum"&&!!field.radios;
  const name=(field:CommandField)=>field.group&&command.fields.some(other=>other!==field&&other.label===field.label)?`${field.group} ${field.label}`:field.label;
  const hasSelection=imageState?.hasSelection===true,replace=command.id===REPLACE_COLOR.id,match=command.id==="image.adjustments.matchColor";
  const off=(field:CommandField)=>field.off?.(values,hasSelection)===true;
  const control=(field:CommandField)=>field.kind==="number"?<>
    <Field label={field.label} unit={field.unit}><input type="number" aria-label={name(field)} required disabled={off(field)} min={field.min} max={field.max} step={field.step??1} value={Number.isFinite(values[field.key])?values[field.key] as number:""} onChange={e=>set(field.key,e.target.valueAsNumber)}/></Field>
    {command.sliders&&<input type="range" aria-label={`${name(field)} slider`} disabled={off(field)} min={field.min} max={field.max} step={field.step??1} value={Number.isFinite(values[field.key])?values[field.key] as number:field.value} onChange={e=>set(field.key,e.target.valueAsNumber)}/>}
  </>:field.kind==="enum"&&radios(field)?<fieldset className="xd-ps-dialog-group"><legend>{field.label}</legend><div role="radiogroup" aria-label={name(field)} className="xd-ps-dialog-radios">{field.choices.map(([value,label])=>
    <label key={value} className="xd-ps-dialog-check"><input type="radio" name={`${command.id}.${field.key}`} value={value} disabled={off(field)} checked={values[field.key]===value} onChange={()=>set(field.key,value)}/>{label}</label>)}</div></fieldset>:
  field.kind==="enum"?<Field label={field.label}><select aria-label={name(field)} disabled={off(field)} value={values[field.key] as string} onChange={e=>set(field.key,e.target.value)}>{field.key==="mode"?blendOptions(field.choices.map(([value])=>value)):field.choices.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>:
  field.kind==="boolean"?<label className="xd-ps-dialog-check"><input type="checkbox" aria-label={name(field)} disabled={off(field)} checked={values[field.key] as boolean} onChange={e=>set(field.key,e.target.checked)}/>{field.label}</label>:
  field.kind==="text"?<Field label={field.label}><input aria-label={name(field)} required maxLength={255} disabled={off(field)} value={values[field.key] as string} onChange={e=>set(field.key,e.target.value)}/></Field>:
  <Field label={field.label}><input type="color" aria-label={name(field)} disabled={off(field)} value={values[field.key] as string} onChange={e=>set(field.key,e.target.value)}/></Field>;
  const visible=command.fields.filter(field=>!field.more||more);
  const sections=visible.reduce<{group?:string;radio:boolean;fields:CommandField[]}[]>((list,field)=>{const last=list.at(-1);if(last&&!last.radio&&!radios(field)&&last.group===field.group)last.fields.push(field);else list.push({group:field.group,radio:radios(field),fields:[field]});return list;},[]);
  const params=command.params?command.params(values):values;
  const valid=command.fields.every(field=>usable(field,values[field.key]));
  const previewable=!!command.preview&&!!document&&isTauri()&&document.width*document.height<=16_777_216;
  const preview=usePhotoCommandPreview(document??NO_DOCUMENT,projectId,command.id,params,{automatic:live,enabled:previewable&&valid&&!busy,viewKey:imageState?.viewKey,cancelable:imageState?.canCancelPreview===true});
  const maskRequest=selectionRequest("color",{...selectionDefaults("color",[0,0,0,1]),colors:[values.color],sampleFuzziness:values.fuzziness,mode:"replace"},{width:document?.width??0,height:document?.height??0,hasSelection:false});
  const mask=usePhotoCommandPreview(document??NO_DOCUMENT,projectId,maskRequest.command,maskRequest.params,{automatic:true,delay:150,enabled:replace&&previewable&&thumbnail==="selection"&&!maskRequest.problem&&!busy,viewKey:imageState?.viewKey,selectionView:"mask"});
  const sampleAt=(x:number,y:number,bounds:{left:number;top:number;width:number;height:number})=>{
    const point=document&&selectionSamplePoint(x,y,bounds,document.width,document.height);
    if(!point||!projectId||!document)return;
    void sampleImageColor({projectId,photoId:document.id,version:document.version,viewKey:imageState?.viewKey??null,x:point[0],y:point[1]}).then(hex=>{if(hex)set("color",hex);}).catch(failure=>setLocalError(String(failure)));
  };
  const scrim=replace&&document?{className:overImage&&eyedropper?"xd-photo-eyedropper-cursor":undefined,
    onPointerDown:(event:{target:unknown;currentTarget:unknown;clientX:number;clientY:number})=>{const bounds=eyedropper&&!busy&&event.target===event.currentTarget?documentUnder(canvas,event.clientX,event.clientY):null;if(bounds)sampleAt(event.clientX,event.clientY,bounds);},
    onPointerMove:(event:{target:unknown;currentTarget:unknown;clientX:number;clientY:number})=>{const over=event.target===event.currentTarget&&!!documentUnder(canvas,event.clientX,event.clientY);if(over!==overImage)setOverImage(over);},
    onWheel:(event:{target:unknown;currentTarget:unknown;deltaX:number;deltaY:number})=>{if(event.target===event.currentTarget)canvas?.closest(".xd-photo-stage")?.scrollBy(event.deltaX,event.deltaY);}}:undefined;
  const portable=()=>Object.fromEntries(command.fields.filter(field=>field.key!=="sourceImage").map(field=>[field.key,values[field.key]]));
  const saveSettings=()=>save({defaultPath:`${command.title.replace(/\W+/g,"-")}.json`,filters:[{name:"Settings",extensions:["json"]}]}).then(path=>path?ipc.saveFileAtomic(path,JSON.stringify(portable(),null,2)):undefined).catch(failure=>setLocalError(String(failure)));
  const loadSettings=()=>open({multiple:false,filters:[{name:"Settings",extensions:["json"]}]}).then(path=>typeof path==="string"?ipc.readFile(path):null).then(text=>{
    if(text===null)return;
    const data=JSON.parse(text) as Record<string,unknown>;
    if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("This is not a settings file.");
    const loaded=command.fields.filter(field=>field.key!=="sourceImage"&&usable(field,data[field.key]));
    if(!loaded.length)throw new Error("This file has no settings for this dialog.");
    setValues(current=>({...current,...Object.fromEntries(loaded.map(field=>[field.key,data[field.key]]))}));setLocalError("");
    if(loaded.some(field=>field.more&&data[field.key]!==field.value))setMore(true);
  }).catch(failure=>setLocalError(String(failure)));
  const thumbnailPoint=(event:{clientX:number;clientY:number;currentTarget:Element})=>sampleAt(event.clientX,event.clientY,event.currentTarget.getBoundingClientRect());
  const extras=(group?:string)=>replace&&document&&group==="Selection"?<>
    <div className="xd-ps-dialog-row"><button type="button" className="xd-ps-dialog-tool" aria-label="Eyedropper Tool" title="Eyedropper Tool" aria-pressed={eyedropper} onClick={()=>setEyedropper(!eyedropper)}><Pipette size={14}/></button></div>
    <div className="xd-ps-dialog-thumb"><img className="xd-photo-eyedropper-cursor" src={thumbnail==="selection"&&mask.url?mask.url:convertFileSrc(document.previewPath)} alt={thumbnail==="selection"&&mask.url?"Replace Color selection":"Replace Color image"} draggable={false} onPointerDown={thumbnailPoint}/></div>
    <div role="radiogroup" aria-label="Thumbnail" className="xd-ps-dialog-radios">{(["selection","image"] as const).map(value=><label key={value} className="xd-ps-dialog-check"><input type="radio" name="xd-replace-color-thumbnail" aria-label={value==="selection"?"Selection":"Image"} checked={thumbnail===value} onChange={()=>setThumbnail(value)}/>{value==="selection"?"Selection":"Image"}</label>)}</div>
  </>:replace&&group==="Replacement"?<div className="xd-ps-dialog-row"><Field label="Result"><input type="color" aria-label="Result" value={replacedColor(String(values.color),Number(values.hue)||0,Number(values.saturation)||0,Number(values.lightness)||0)} onChange={e=>{const next=replacementFor(String(values.color),e.target.value);setValues(current=>({...current,...next}));}}/></Field></div>:null;
  const layerName=imageState?.layers.find(layer=>layer.id===imageState.activeLayer)?.name;
  return <Dialog title={command.title} close={close} className="is-scroll" beside={previewable||!!scrim} scrim={scrim} okDisabled={!valid} reset={()=>setValues(opening)}
    preview={command.preview?{checked:live&&previewable,disabled:!previewable,busy:live&&preview.loading,change:setLive}:undefined}
    buttons={command.settingsFile?<><button type="button" disabled={busy} onClick={()=>void loadSettings()}>Load…</button><button type="button" disabled={busy} onClick={()=>void saveSettings()}>Save…</button></>:undefined}
    apply={()=>runPhotoCommand(command.id,params).then(()=>{remembered.set(command.id,values);moreShown.set(command.id,more);})}>
    {match&&imageState&&<fieldset className="xd-ps-dialog-group"><legend>Destination Image</legend><p className="xd-ps-dialog-readout">Target: {imageState.name}{layerName?` (${layerName}, ${imageState.mode.toUpperCase()}/${imageState.depth})`:""}</p></fieldset>}
    {sections.map((section,index)=>section.radio?<div key={index}>{section.fields.map(field=><Fragment key={field.key}>{control(field)}</Fragment>)}</div>:
      <Fragment key={index}><Group legend={section.group}><div className={`xd-ps-dialog-grid${command.sliders?" has-sliders":""}`}>{section.fields.map(field=><div key={field.key} className="xd-ps-dialog-row">{control(field)}</div>)}{extras(section.group)}</div></Group></Fragment>)}
    {command.moreOptions&&<label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Show More Options" checked={more} onChange={e=>setMore(e.target.checked)}/>Show More Options</label>}
    {(localError||preview.error)&&<p role="alert">{localError||preview.error}</p>}
    {canvas&&live&&preview.url&&createPortal(<img className="xd-photo-canvas-preview" src={preview.url} alt="" draggable={false}/>,canvas)}
  </Dialog>;
}

const TRIM_BASES:[string,string][]=[["transparent","Transparent Pixels"],["topLeft","Top Left Pixel Color"],["bottomRight","Bottom Right Pixel Color"]];
const TRIM_SIDES:[string,string][]=[["top","Top"],["bottom","Bottom"],["left","Left"],["right","Right"]];

/** Image > Trim…. Transparent Pixels is offered only while the image can have transparency, i.e. it has no locked Background layer. */
export function ImageTrimDialog({state,close}:{state:PhotoState;close:()=>void}) {
  const transparency=!state.layers.some(layer=>layer.name==="Background"&&layer.locks?.transparency!==false);
  const [opening]=useState(()=>{
    const saved=remembered.get("image.trim")??{},based=TRIM_BASES.some(([id])=>id===saved.basedOn)&&(transparency||saved.basedOn!=="transparent")?saved.basedOn as string:transparency?"transparent":"topLeft";
    return {basedOn:based,...Object.fromEntries(TRIM_SIDES.map(([id])=>[id,typeof saved[id]==="boolean"?saved[id]:true]))} as Record<string,string|boolean>;
  }),[values,setValues]=useState(opening);
  const set=(key:string,value:string|boolean)=>setValues(current=>({...current,[key]:value}));
  return <Dialog title="Trim" close={close} reset={()=>setValues(opening)} okDisabled={!TRIM_SIDES.some(([id])=>values[id])} apply={()=>runPhotoCommand("image.trim",values).then(()=>{remembered.set("image.trim",values);})}>
    <fieldset className="xd-ps-dialog-group"><legend>Based On</legend><div role="radiogroup" aria-label="Based On" className="xd-ps-dialog-radios is-column">{TRIM_BASES.map(([id,label])=>
      <label key={id} className="xd-ps-dialog-check"><input type="radio" name="image.trim.basedOn" value={id} disabled={id==="transparent"&&!transparency} checked={values.basedOn===id} onChange={()=>set("basedOn",id)}/>{label}</label>)}</div></fieldset>
    <fieldset className="xd-ps-dialog-group"><legend>Trim Away</legend><div className="xd-ps-dialog-checks">{TRIM_SIDES.map(([id,label])=>
      <label key={id} className="xd-ps-dialog-check"><input type="checkbox" aria-label={label} checked={values[id] as boolean} onChange={e=>set(id,e.target.checked)}/>{label}</label>)}</div></fieldset>
  </Dialog>;
}

/** Image › Duplicate…. Merged Layers Only needs more than one layer, as in Photoshop. */
export function DuplicateImageDialog({name,layers,close}:{name:string;layers:number;close:()=>void}) {
  const [as,setAs]=useState(`${name.replace(/\.[^.]+$/,"")} copy`),[merged,setMerged]=useState(false);
  return <Dialog title="Duplicate Image" close={close} okDisabled={!as.trim()} apply={()=>runPhotoCommand("image.duplicate",{name:as.trim(),mergedOnly:layers>1&&merged})}>
    <p className="xd-ps-dialog-text">Duplicate: {name}</p>
    <Field label="As"><input aria-label="As" maxLength={512} value={as} onChange={e=>setAs(e.target.value)}/></Field>
    <label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Duplicate Merged Layers Only" disabled={layers<2} checked={layers>1&&merged} onChange={e=>setMerged(e.target.checked)}/>Duplicate Merged Layers Only</label>
  </Dialog>;
}

/** History › New Snapshot…. Merged Layers and Current Layer keep only those pixels, as in Photoshop. */
export function NewSnapshotDialog({next,close}:{next:string;close:()=>void}) {
  const [name,setName]=useState(next),[from,setFrom]=useState("document");
  return <Dialog title="New Snapshot" close={close} okDisabled={!name.trim()} apply={()=>runPhotoCommand("history.snapshot.new",{name:name.trim(),from})}>
    <Field label="Name"><input aria-label="Name" maxLength={255} value={name} onChange={e=>setName(e.target.value)}/></Field>
    <Field label="From"><select aria-label="From" value={from} onChange={e=>setFrom(e.target.value)}><option value="document">Full Document</option><option value="merged">Merged Layers</option><option value="layer">Current Layer</option></select></Field>
  </Dialog>;
}

const EXPORT_FORMATS:[string,string,string[]][]=[["psd","Photoshop (PSD)",["psd","psb"]],["png","PNG",["png"]],["jpg","JPEG",["jpg","jpeg"]],["webp","WebP (lossless)",["webp"]],["avif","AVIF",["avif"]],["tiff","TIFF",["tiff","tif"]],["pcraft","Native image",["pcraft"]]];
// Save As and Save a Copy also offer Photoshop PDF: one page, the flattened image at the document's resolution.
const COPY_FORMATS:[string,string,string[]][]=[...EXPORT_FORMATS.slice(0,1),["pdf","Photoshop PDF",["pdf"]],...EXPORT_FORMATS.slice(1)];
export function ImageExportDialog({name,kind="export",choose,close}:{name:string;kind?:"export"|"copy"|"save";choose:(path:string|null,quality:number|undefined)=>Promise<unknown>;close:()=>void}) {
  const formats=kind==="export"?EXPORT_FORMATS:COPY_FORMATS;
  const [format,setFormat]=useState("psd"),[quality,setQuality]=useState(90);
  const [,label,extensions]=formats.find(([id])=>id===format)!;
  const lossy=format==="jpg"||format==="avif";
  return <Dialog title={kind==="copy"?"Save a Copy":kind==="save"?"Save As":"Export As"} ok={kind==="export"?"Export":"Save"} close={close} reset={()=>{setFormat("psd");setQuality(90);}} apply={()=>save({defaultPath:`${name.replace(/\.[^.]+$/,"")}.${extensions[0]}`,filters:[{name:label,extensions}]}).then(path=>choose(path,lossy?quality:undefined))}>
    <div className="xd-ps-dialog-grid has-sliders">
      <div className="xd-ps-dialog-row"><Field label="Format"><select aria-label="Format" value={format} onChange={e=>setFormat(e.target.value)}>{formats.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field></div>
      {lossy&&<div className="xd-ps-dialog-row"><Field label="Quality" unit="%"><input type="number" aria-label="Quality" required min="1" max="100" value={Number.isFinite(quality)?quality:""} onChange={e=>setQuality(e.target.valueAsNumber)}/></Field>
        <input type="range" aria-label="Quality slider" min="1" max="100" value={Number.isFinite(quality)?quality:90} onChange={e=>setQuality(e.target.valueAsNumber)}/></div>}
    </div>
  </Dialog>;
}

const UNITS:[string,string][]=[["px","Pixels"],["percent","Percent"],["in","Inches"],["cm","Centimeters"],["mm","Millimeters"],["pt","Points"],["pica","Picas"]];
const PER_INCH:Record<string,number>={in:1,cm:2.54,mm:25.4,pt:72,pica:6};
const physical=(unit:string)=>unit in PER_INCH,perInch=(unit:string)=>PER_INCH[unit]??1;
const toUnit=(px:number,unit:string,original:number,ppi:number)=>unit==="px"?px:unit==="percent"?px/original*100:px/ppi*perInch(unit);
const fromUnit=(value:number,unit:string,original:number,ppi:number)=>unit==="px"?value:unit==="percent"?value*original/100:value/perInch(unit)*ppi;
const shown=(value:number,decimals:number)=>String(Number(value.toFixed(decimals)));
const MODE_CHANNELS:Record<string,number>={Bitmap:1,Grayscale:1,Indexed:1,Duotone:1,Rgb:3,Lab:3,Cmyk:4};
const imageBytes=(state:PhotoState,width:number,height:number)=>Math.max(0,width)*Math.max(0,height)*(state.channels?.colors?.length||MODE_CHANNELS[state.mode]||3)*state.depth/8;
// Photocraft's readout format: G to two places, M to one, K whole.
export const humanBytes=(bytes:number)=>bytes>=1024**3?`${(bytes/1024**3).toFixed(2)}G`:bytes>=1024**2?`${(bytes/1024**2).toFixed(1)}M`:`${Math.round(Math.max(1,bytes/1024))}K`;

// Text being typed is kept as typed so "8." or "" survive until the field loses focus.
function useDrafts() {
  const [draft,setDraft]=useState<{field:string;text:string}|null>(null);
  return (field:string,value:string,commit:(value:number)=>unknown)=>({value:draft?.field===field?draft.text:value,onChange:(e:{target:HTMLInputElement})=>{setDraft({field,text:e.target.value});const parsed=Number(e.target.value);if(e.target.value.trim()&&Number.isFinite(parsed))commit(parsed);},onBlur:()=>setDraft(null)});
}

const unitSelect=(label:string,value:string,change:(unit:string)=>void,disabled=false)=><select aria-label={label} value={value} disabled={disabled} onChange={e=>change(e.target.value)}>{UNITS.map(([id,text])=><option key={id} value={id}>{text}</option>)}</select>;

// Photoshop fits the image inside the preset turned to the image's orientation, so nothing is cropped or stretched.
type FitPreset=[label:string,width:number,height:number,unit:string,ppi:number];
const screen=(w:number,h:number):FitPreset=>[`${w} x ${h} px 72 ppi`,w,h,"px",72];
const paper=(label:string,w:number,h:number,unit:string):FitPreset=>[label,w,h,unit,300];
const FIT_TO:FitPreset[]=[
  screen(640,480),screen(800,600),screen(1024,768),screen(1280,800),screen(1366,768),
  paper("4 x 6 in 300 ppi",4,6,"in"),paper("5 x 7 in 300 ppi",5,7,"in"),paper("8 x 10 in 300 ppi",8,10,"in"),
  paper("Letter (300 ppi)",8.5,11,"in"),paper("Legal (300 ppi)",8.5,14,"in"),paper("Tabloid (300 ppi)",11,17,"in"),
  paper("A4 (300 ppi)",210,297,"mm"),paper("A3 (300 ppi)",297,420,"mm"),paper("B5 (300 ppi)",176,250,"mm"),paper("B4 (300 ppi)",250,353,"mm"),paper("B3 (300 ppi)",353,500,"mm"),
  paper("International Postcard (300 ppi)",105,148,"mm"),
];

const METHODS:[string,string][]=[["automatic","Automatic"],["preserveDetails","Preserve Details (enlargement)"],["lanczos","Bicubic Sharper (reduction)"],["bicubic","Bicubic (smooth gradients)"],["nearest","Nearest Neighbor (hard edges)"],["bilinear","Bilinear"]];

function ImageSize({state,document,close}:{state:PhotoState;document?:PhotoDocument;close:()=>void}) {
  const original={width:state.width,height:state.height,resolution:state.resolution};
  const opening={width:state.width,height:state.height,resolution:state.resolution,units:{width:"px",height:"px"},resolutionUnit:"in",linked:true,resample:true,method:"automatic",fit:"original"};
  const [form,setForm]=useState(opening),draft=useDrafts();
  const ppi=form.resolution,linked=form.linked||!form.resample;
  const setSize=(axis:"width"|"height",value:number)=>setForm(current=>{
    const unit=current.units[axis],px=fromUnit(value,unit,original[axis],current.resolution);
    if(!current.resample)return {...current,fit:"custom",resolution:original[axis]/(value/perInch(unit))};
    const other=axis==="width"?"height":"width";
    return {...current,fit:"custom",[axis]:px,...(current.linked?{[other]:px*original[other]/original[axis]}:{})};
  });
  const setResolution=(value:number)=>setForm(current=>{
    const resolution=current.resolutionUnit==="cm"?value*2.54:value,scale=resolution/current.resolution;
    // A print-unit field holds its size, so its pixels follow the resolution; the chain carries the other axis along.
    const [w,h]=[physical(current.units.width),physical(current.units.height)].map(held=>held||(current.linked&&(physical(current.units.width)||physical(current.units.height))));
    return !current.resample?{...current,fit:"custom",resolution}:{...current,fit:"custom",resolution,...(w?{width:current.width*scale}:{}),...(h?{height:current.height*scale}:{})};
  });
  const fitTo=(choice:string)=>{
    const preset=FIT_TO.find(([label])=>label===choice);
    if(!preset)return setForm(current=>choice==="original"?{...opening,method:current.method}:current);
    const [,a,b,unit,resolution]=preset,px=(value:number)=>unit==="px"?value:value/perInch(unit)*resolution;
    const [boxWidth,boxHeight]=(a>=b)===(original.width>=original.height)?[px(a),px(b)]:[px(b),px(a)];
    const scale=Math.min(boxWidth/original.width,boxHeight/original.height);
    setForm(current=>({...current,fit:choice,width:original.width*scale,height:original.height*scale,resolution,units:{width:unit,height:unit},resolutionUnit:"in",linked:true,resample:true}));
  };
  const width=Math.round(form.width),height=Math.round(form.height);
  const valid=width>=1&&height>=1&&ppi>0&&Number.isFinite(width*height*ppi);
  const method=form.method==="automatic"?(width*height>original.width*original.height?"preserveDetails":width*height<original.width*original.height?"lanczos":"bicubic"):form.method;
  const sizeField=(axis:"width"|"height",label:string)=>{const unit=form.units[axis];return <div className="xd-ps-dialog-row">
    <Field label={label}><input type="text" inputMode="decimal" aria-label={label} disabled={!form.resample&&!physical(unit)} {...draft(axis,shown(toUnit(form[axis],unit,original[axis],ppi),unit==="px"?0:2),value=>value>0&&setSize(axis,value))}/></Field>
    {unitSelect(`${label} unit`,unit,next=>setForm(current=>({...current,units:{...current.units,[axis]:next}})))}</div>;};
  return <Dialog title="Image Size" close={close} okDisabled={!valid} reset={()=>setForm(opening)} apply={()=>runPhotoCommand("image.imageSize",form.resample?{width,height,resolution:ppi,resample:method}:{width:original.width,height:original.height,resolution:ppi,resample:"none"})}>
    <p className="xd-ps-dialog-readout">Image Size: {humanBytes(imageBytes(state,width,height))}{(width!==original.width||height!==original.height)&&` (was ${humanBytes(imageBytes(state,original.width,original.height))})`}</p>
    <p className="xd-ps-dialog-readout">Dimensions: {width} px × {height} px</p>
    {document&&valid&&(()=>{const fit=Math.min(1,160/width,120/height);return <div className="xd-ps-dialog-thumb is-size"><img src={convertFileSrc(document.previewPath)} alt="Image Size preview" width={Math.max(1,Math.round(width*fit))} height={Math.max(1,Math.round(height*fit))} draggable={false}/></div>;})()}
    <div className="xd-ps-dialog-grid"><div className="xd-ps-dialog-row"><Field label="Fit To"><select aria-label="Fit To" value={form.fit} onChange={e=>fitTo(e.target.value)}>
      <option value="original">Original Size</option>{FIT_TO.map(([label])=><option key={label} value={label}>{label}</option>)}{form.fit==="custom"&&<option value="custom">Custom</option>}
    </select></Field></div></div>
    <div className="xd-ps-dialog-size">
      <button type="button" className="xd-ps-dialog-link" aria-label="Constrain aspect ratio" aria-pressed={linked} disabled={!form.resample} onClick={()=>setForm(current=>({...current,linked:!current.linked}))}>{linked?<Link2 size={14}/>:<Link2Off size={14}/>}</button>
      <div className="xd-ps-dialog-grid">{sizeField("width","Width")}{sizeField("height","Height")}</div>
    </div>
    <div className="xd-ps-dialog-grid">
      <div className="xd-ps-dialog-row"><Field label="Resolution"><input type="text" inputMode="decimal" aria-label="Resolution" {...draft("resolution",shown(form.resolutionUnit==="cm"?ppi/2.54:ppi,2),value=>value>0&&setResolution(value))}/></Field>
        <select aria-label="Resolution unit" value={form.resolutionUnit} onChange={e=>{const resolutionUnit=e.target.value;setForm(current=>({...current,resolutionUnit}));}}><option value="in">Pixels/Inch</option><option value="cm">Pixels/Centimeter</option></select></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check is-label"><input type="checkbox" aria-label="Resample" checked={form.resample} onChange={e=>{const resample=e.target.checked;setForm(current=>resample?{...current,resample}:{...current,resample,width:original.width,height:original.height});}}/>Resample:</label>
        <select aria-label="Resample method" value={form.method} disabled={!form.resample} onChange={e=>{const method=e.target.value;setForm(current=>({...current,method}));}}>{METHODS.map(([id,text])=><option key={id} value={id}>{text}</option>)}</select></div>
    </div>
  </Dialog>;
}

const ANCHORS=["topLeft","top","topRight","left","center","right","bottomLeft","bottom","bottomRight"];
const ANCHOR_NAMES=["top left","top","top right","left","center","right","bottom left","bottom","bottom right"];
const ARROWS:Record<string,typeof ArrowUp>={"-1,-1":ArrowUpLeft,"0,-1":ArrowUp,"1,-1":ArrowUpRight,"-1,0":ArrowLeft,"1,0":ArrowRight,"-1,1":ArrowDownLeft,"0,1":ArrowDown,"1,1":ArrowDownRight};
const EXTENSION_COLORS:[string,string][]=[["foreground","Foreground"],["background","Background"],["white","White"],["black","Black"],["#808080","Gray"],["other","Other…"]];

/** Arrows sit only in the cells next to the anchor and point the way the canvas grows (inward when it shrinks). */
function AnchorGrid({anchor,grow,pick}:{anchor:string;grow:[number,number];pick:(anchor:string)=>void}) {
  const at=Math.max(0,ANCHORS.indexOf(anchor)),[ax,ay]=[at%3,Math.floor(at/3)];
  return <div className="xd-ps-dialog-anchors" role="group" aria-label="Anchor">{ANCHORS.map((id,index)=>{
    const [dx,dy]=[index%3-ax,Math.floor(index/3)-ay],Arrow=Math.abs(dx)<=1&&Math.abs(dy)<=1?ARROWS[`${dx*(grow[0]<0?-1:1)},${dy*(grow[1]<0?-1:1)}`]:undefined;
    return <button key={id} type="button" aria-label={`Anchor ${ANCHOR_NAMES[index]}`} aria-pressed={id===anchor} onClick={()=>pick(id)}>{id===anchor?<span className="xd-ps-dialog-anchor-mark"/>:Arrow&&<Arrow size={12}/>}</button>;
  })}</div>;
}

function CanvasSize({state,close}:{state:PhotoState;close:()=>void}) {
  const extensionHex=(extension:string,other:string)=>extension==="foreground"?paintColorHex(state.tools?.foreground,"#000000"):extension==="background"?paintColorHex(state.tools?.background,"#ffffff"):extension==="white"?"#ffffff":extension==="black"?"#000000":extension==="other"?other:extension;
  const original={width:state.width,height:state.height},ppi=state.resolution;
  const opening={width:state.width,height:state.height,widthUnit:"px",heightUnit:"px",relative:false,anchor:"center",extension:"background",other:"#ffffff"};
  const [form,setForm]=useState(opening),draft=useDrafts();
  const background=state.layers.some(layer=>layer.name==="Background"&&layer.locks?.transparency!==false);
  const width=Math.round(form.width),height=Math.round(form.height);
  const valid=width>=1&&height>=1;
  const sizeField=(axis:"width"|"height",label:string)=>{
    const unit=form[axis==="width"?"widthUnit":"heightUnit"],shownPx=form.relative?form[axis]-original[axis]:form[axis];
    return <div className="xd-ps-dialog-row"><Field label={label}><input type="text" inputMode="decimal" aria-label={label} {...draft(axis,shown(toUnit(shownPx,unit,original[axis],ppi),unit==="px"?0:2),value=>setForm(current=>({...current,[axis]:fromUnit(value,unit,original[axis],ppi)+(current.relative?original[axis]:0)})))}/></Field>
      {unitSelect(`${label} unit`,unit,next=>setForm(current=>({...current,[axis==="width"?"widthUnit":"heightUnit"]:next})))}</div>;
  };
  return <Dialog title="Canvas Size" close={close} okDisabled={!valid} reset={()=>setForm(opening)} apply={()=>runPhotoCommand("image.canvasSize",{width,height,anchor:form.anchor,extensionColor:form.extension==="other"?form.other:form.extension})}>
    <fieldset className="xd-ps-dialog-group"><legend>Current Size: {humanBytes(imageBytes(state,original.width,original.height))}</legend>
      <div className="xd-ps-dialog-grid"><div className="xd-ps-dialog-row"><Field label="Width" unit="Pixels"><output>{original.width}</output></Field></div><div className="xd-ps-dialog-row"><Field label="Height" unit="Pixels"><output>{original.height}</output></Field></div></div>
    </fieldset>
    <fieldset className="xd-ps-dialog-group"><legend>New Size: {humanBytes(imageBytes(state,width,height))}</legend>
      <div className="xd-ps-dialog-grid">{sizeField("width","Width")}{sizeField("height","Height")}
        <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check xd-ps-dialog-indent"><input type="checkbox" aria-label="Relative" checked={form.relative} onChange={e=>{const relative=e.target.checked;setForm(current=>({...current,relative}));}}/>Relative</label></div>
        <div className="xd-ps-dialog-row"><span className="xd-ps-dialog-label">Anchor:</span><AnchorGrid anchor={form.anchor} grow={[width-original.width,height-original.height]} pick={anchor=>setForm(current=>({...current,anchor}))}/></div>
      </div>
    </fieldset>
    <div className="xd-ps-dialog-grid">
      <div className="xd-ps-dialog-row"><Field label="Canvas extension color"><select aria-label="Canvas extension color" disabled={!background} value={form.extension} onChange={e=>{const extension=e.target.value;setForm(current=>({...current,extension}));}}>{EXTENSION_COLORS.map(([id,text])=><option key={id} value={id}>{text}</option>)}</select></Field>
        <input type="color" aria-label="Canvas extension custom color" disabled={!background} value={extensionHex(form.extension,form.other)} onChange={e=>{const other=e.target.value;setForm(current=>({...current,other,extension:"other"}));}}/></div>
    </div>
  </Dialog>;
}

export function ImageSizeDialog({state,document,canvas,close}:{state:PhotoState;document?:PhotoDocument;canvas:boolean;close:()=>void}) {
  return canvas?<CanvasSize state={state} close={close}/>:<ImageSize state={state} document={document} close={close}/>;
}

export function textReplacement(before:string,after:string):{start:number;end:number;text:string}|null {
  const old=Array.from(before.replace(/\r\n?/g,"\n")),next=Array.from(after.replace(/\r\n?/g,"\n"));
  let start=0,end=old.length,last=next.length;
  while(start<end&&start<last&&old[start]===next[start])start++;
  while(end>start&&last>start&&old[end-1]===next[last-1]){end--;last--;}
  return start===end&&start===last?null:{start,end,text:next.slice(start,last).join("")};
}
export function ImageTextDialog({layer,point,close}:{layer?:PhotoLayer;point?:[number,number];close:()=>void}) {
  const [text,setText]=useState(layer?.text?.text??"Text"),[font,setFont]=useState(layer?.text?.font??"Arial"),[size,setSize]=useState(layer?.text?.sizePt??48),[color,setColor]=useState("#ffffff");
  const [changeColor,setChangeColor]=useState(!layer);
  const fonts=useFontFamilies();
  const style={...(!layer||font!==layer.text?.font?{font}:{}),...(!layer||size!==layer.text?.sizePt?{size}:{}),...(changeColor?{color}:{})};
  return <Dialog title={layer?"Edit Text Layer":"New Text Layer"} close={close} apply={()=>{
    if(!layer)return runPhotoCommand("type.create",{text,...style,x:point?.[0]??100,y:point?.[1]??100});
    const replace=textReplacement(layer.text?.text??"",text);
    if(!replace&&!Object.keys(style).length)return Promise.resolve();
    return runPhotoCommand("type.edit",{layer:layer.id,...(replace?{replace}:{}),...(Object.keys(style).length?{runs:[{start:0,end:Array.from(text).length,...style}]}:{})});
  }}>
    <label className="xd-ps-dialog-text"><span>Text:</span><textarea aria-label="Image text" value={text} onChange={e=>setText(e.target.value)}/></label>
    <div className="xd-ps-dialog-grid">
      <div className="xd-ps-dialog-row"><Field label="Font"><input aria-label="Image font" list={fonts.listId} value={font} onChange={e=>setFont(e.target.value)}/></Field>{fonts.list}</div>
      <div className="xd-ps-dialog-row"><Field label="Size" unit="pt"><input type="number" aria-label="Size" required min="1" max="10000" value={size} onChange={e=>setSize(e.target.valueAsNumber)}/></Field></div>
      {layer&&<div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check xd-ps-dialog-indent"><input type="checkbox" checked={changeColor} onChange={e=>setChangeColor(e.target.checked)}/>Change Text Color</label></div>}
      <div className="xd-ps-dialog-row"><Field label="Color"><input type="color" aria-label="Color" disabled={!changeColor} value={color} onChange={e=>setColor(e.target.value)}/></Field></div>
    </div>
  </Dialog>;
}

