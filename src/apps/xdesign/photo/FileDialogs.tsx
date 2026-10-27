import { useEffect, useState, type ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";

const CANCELLED = Symbol("cancelled");
const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "Untitled";

/** `done` replaces closing after a successful apply, for dialogs that go on to a second step. */
export function FileDialog({title,children,apply,close,done,ok,okDisabled}:{title:string;children:ReactNode;apply:()=>Promise<unknown>;close:()=>void;done?:()=>void;ok?:string;okDisabled?:boolean}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error),[failure,setFailure]=useState<string|null>(null);
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  return <PhotoDialog dialog={dialog} title={title} busy={busy} ok={ok} okDisabled={okDisabled} close={close} onSubmit={e=>{e.preventDefault();setFailure(null);void apply().then(done??close).catch(reason=>{if(reason!==CANCELLED)setFailure(reason instanceof Error?reason.message:String(reason));});}}>
    {children}{(failure??error)&&<p role="alert">{failure??error}</p>}
  </PhotoDialog>;
}

export function Field({label,unit,children}:{label:string;unit?:string;children:ReactNode}) {
  return <label className="xd-ps-dialog-field"><span>{label}:</span>{children}{unit&&<span className="xd-ps-dialog-unit">{unit}</span>}</label>;
}

const INFO_KEYS=["title","author","authorTitle","description","keywords","copyright","copyrightStatus","copyrightUrl"] as const;
type Info=Record<typeof INFO_KEYS[number],string>;
const COPYRIGHT_STATUS=[["unknown","Unknown"],["copyrighted","Copyrighted"],["publicDomain","Public Domain"]] as const;

/** File › File Info…, the Basic tab. Only edited fields are sent, so opening and closing it adds no history step. */
export function FileInfoDialog({close}:{close:()=>void}) {
  const [loaded,setLoaded]=useState<Info|null>(null),[info,setInfo]=useState<Info|null>(null);
  useEffect(()=>{let live=true;runPhotoCommand("file.fileInfo",{}).then(reply=>{
    if(!live)return;
    const values=(reply??{}) as Record<string,unknown>;
    const read=Object.fromEntries(INFO_KEYS.map(key=>{const value=values[key];return [key,Array.isArray(value)?value.join("; "):typeof value==="string"?value:""];})) as Info;
    read.copyrightStatus||="unknown";
    setLoaded(read);setInfo(read);
  }).catch(()=>{});return()=>{live=false;};},[]);
  const edit=(key:keyof Info,value:string)=>setInfo(current=>current&&{...current,[key]:value});
  const text=(key:keyof Info,label:string)=><Field label={label}><input aria-label={label} value={info?.[key]??""} disabled={!info} onChange={e=>edit(key,e.target.value)}/></Field>;
  const apply=()=>{const changed=INFO_KEYS.filter(key=>info&&loaded&&info[key]!==loaded[key]);return changed.length?runPhotoCommand("file.fileInfo",Object.fromEntries(changed.map(key=>[key,info![key]]))):Promise.resolve();};
  return <FileDialog title="File Info" close={close} okDisabled={!info} apply={apply}>
    {text("title","Document Title")}{text("author","Author")}{text("authorTitle","Author Title")}
    <Field label="Description"><textarea aria-label="Description" value={info?.description??""} disabled={!info} onChange={e=>edit("description",e.target.value)}/></Field>
    {text("keywords","Keywords")}
    <p className="xd-ps-dialog-text">Semicolons or commas can be used to separate multiple values</p>
    <Field label="Copyright Status"><select aria-label="Copyright Status" value={info?.copyrightStatus??"unknown"} disabled={!info} onChange={e=>edit("copyrightStatus",e.target.value)}>{COPYRIGHT_STATUS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
    {text("copyright","Copyright Notice")}{text("copyrightUrl","Copyright Info URL")}
  </FileDialog>;
}

/** File › Automate › Fit Image…. Sent as the host's Image Size so it keeps the host's resampling and size limits. */
export function FitImageDialog({width,height,close}:{width:number;height:number;close:()=>void}) {
  const [box,setBox]=useState({width,height}),[dontEnlarge,setDontEnlarge]=useState(false);
  const valid=[box.width,box.height].every(value=>Number.isFinite(value)&&value>=1&&value<=300000);
  const apply=()=>{
    const scale=Math.min(box.width/width,box.height/height),fitted={width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
    if((scale>1&&dontEnlarge)||(fitted.width===width&&fitted.height===height))return Promise.resolve();
    return runPhotoCommand("image.imageSize",{...fitted,resample:"bicubic"});
  };
  const size=(key:"width"|"height",label:string)=><Field label={label} unit="pixels"><input type="number" aria-label={label} required min="1" max="300000" value={Number.isFinite(box[key])?box[key]:""} onChange={e=>{const value=e.target.valueAsNumber;setBox(current=>({...current,[key]:value}));}}/></Field>;
  return <FileDialog title="Fit Image" close={close} okDisabled={!valid} apply={apply}>
    <fieldset className="xd-ps-dialog-group"><legend>Constrain Within</legend>{size("width","Width")}{size("height","Height")}</fieldset>
    <label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Don't Enlarge" checked={dontEnlarge} onChange={e=>setDontEnlarge(e.target.checked)}/>Don't Enlarge</label>
  </FileDialog>;
}

const SOURCE_MODES=[["bitmap","Bitmap"],["grayscale","Grayscale"],["duotone","Duotone"],["indexed","Indexed Color"],["rgb","RGB Color"],["cmyk","CMYK Color"],["lab","Lab Color"],["multichannel","Multichannel"]] as const;
const TARGET_MODES=[["grayscale","Grayscale"],["rgb","RGB Color"],["cmyk","CMYK Color"],["lab","Lab Color"]] as const;

/** File › Automate › Conditional Mode Change…. Sent as the host's Image › Mode command so conversions stay colour-managed. */
export function ConditionalModeDialog({mode,close}:{mode:string;close:()=>void}) {
  const [sources,setSources]=useState<string[]>([]),[target,setTarget]=useState("rgb");
  const apply=()=>{const current=mode.toLowerCase();return sources.includes(current)&&current!==target?runPhotoCommand(`image.mode.${target}`,{}):Promise.resolve();};
  return <FileDialog title="Conditional Mode Change" close={close} apply={apply}>
    <fieldset className="xd-ps-dialog-group"><legend>Source Mode</legend>
      <div className="xd-ps-dialog-grid">{SOURCE_MODES.map(([value,label])=><label key={value} className="xd-ps-dialog-check"><input type="checkbox" aria-label={label} checked={sources.includes(value)} onChange={e=>setSources(current=>e.target.checked?[...current,value]:current.filter(item=>item!==value))}/>{label}</label>)}</div>
      <div className="xd-ps-dialog-row"><button type="button" onClick={()=>setSources(SOURCE_MODES.map(([value])=>value))}>All</button><button type="button" onClick={()=>setSources([])}>None</button></div>
    </fieldset>
    <fieldset className="xd-ps-dialog-group"><legend>Target Mode</legend>
      <Field label="Mode"><select aria-label="Mode" value={target} onChange={e=>setTarget(e.target.value)}>{TARGET_MODES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
    </fieldset>
  </FileDialog>;
}

/** The engine writes the file atomically itself; a 256-point lookup table is hundreds of megabytes of text, too much to return over IPC. */
async function exportTo(defaultPath:string,filter:{name:string;extensions:string[]},command:string,params:Record<string,unknown>) {
  const path=await save({defaultPath,filters:[filter]});
  if(!path)throw CANCELLED;
  await runPhotoCommand(command,{...params,path});
}

/** File › Export › Color Lookup Tables…. The engine writes CUBE only. */
export function ColorLookupDialog({name,close}:{name:string;close:()=>void}) {
  const [title,setTitle]=useState(stem(name)),[size,setSize]=useState(32);
  const valid=Number.isInteger(size)&&size>=7&&size<=256;
  return <FileDialog title="Export Color Lookup Tables" close={close} okDisabled={!valid} apply={()=>exportTo(`${stem(name)}.cube`,{name:"CUBE",extensions:["cube"]},"file.export.colorLookupTables",{size,title})}>
    <Field label="Description"><input aria-label="Description" value={title} onChange={e=>setTitle(e.target.value)}/></Field>
    <fieldset className="xd-ps-dialog-group"><legend>Quality</legend>
      <Field label="Grid Points"><input type="number" aria-label="Grid Points" required min="7" max="256" value={Number.isFinite(size)?size:""} onChange={e=>setSize(e.target.valueAsNumber)}/></Field>
    </fieldset>
    <fieldset className="xd-ps-dialog-group"><legend>Formats</legend><p className="xd-ps-dialog-text">CUBE</p></fieldset>
  </FileDialog>;
}

/** File › Export › Paths to Illustrator…. */
export function PathsToIllustratorDialog({name,paths,close}:{name:string;paths:{saved:string[];work:boolean};close:()=>void}) {
  const [choice,setChoice]=useState("all");
  const choices=[["all","All Paths"],...(paths.work?[["work","Work Path"]]:[]),...paths.saved.map(path=>[path,path])];
  return <FileDialog title="Export Paths to Illustrator" close={close} apply={()=>exportTo(`${stem(name)}.ai`,{name:"Adobe Illustrator",extensions:["ai"]},"file.export.pathsToIllustrator",{paths:choice})}>
    <Field label="Write"><select aria-label="Write" value={choice} onChange={e=>setChoice(e.target.value)}>{choices.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
  </FileDialog>;
}

/** File › Export › Artboards to PDF…, one page per artboard. The engine encodes pages as JPEG at Photoshop's 0–12 quality. */
export function ArtboardsToPdfDialog({name,selected,close}:{name:string;selected:number[];close:()=>void}) {
  const [onlySelected,setOnlySelected]=useState(false),[quality,setQuality]=useState(10);
  const valid=Number.isInteger(quality)&&quality>=0&&quality<=12;
  return <FileDialog title="Artboards To PDF" ok="Run" close={close} okDisabled={!valid} apply={()=>exportTo(`${stem(name)}.pdf`,{name:"PDF",extensions:["pdf"]},"file.export.artboardsToPdf",{quality,...(onlySelected?{artboards:selected}:{})})}>
    <label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Export Selected Artboards" disabled={!selected.length} checked={onlySelected&&!!selected.length} onChange={e=>setOnlySelected(e.target.checked)}/>Export Selected Artboards</label>
    <fieldset className="xd-ps-dialog-group"><legend>Encoding: JPEG</legend>
      <Field label="Quality"><input type="number" aria-label="Quality" required min="0" max="12" value={Number.isFinite(quality)?quality:""} onChange={e=>setQuality(e.target.valueAsNumber)}/></Field>
    </fieldset>
  </FileDialog>;
}

const LAYER_FORMATS=[["bmp","BMP"],["jpg","JPEG"],["psd","PSD"],["tga","Targa"],["tif","TIFF"],["png","PNG-24"]] as const;

/** File › Export › Layers to Files…. */
export function LayersToFilesDialog({name,close}:{name:string;close:()=>void}) {
  const [dir,setDir]=useState(""),[prefix,setPrefix]=useState(stem(name)),[visibleOnly,setVisibleOnly]=useState(true),[format,setFormat]=useState("psd"),[quality,setQuality]=useState(8);
  const jpeg=format==="jpg",valid=!!dir.trim()&&(!jpeg||(Number.isInteger(quality)&&quality>=0&&quality<=12));
  const browse=()=>void open({directory:true,multiple:false}).then(path=>{if(typeof path==="string")setDir(path);}).catch(()=>{});
  return <FileDialog title="Export Layers To Files" ok="Run" close={close} okDisabled={!valid} apply={()=>runPhotoCommand("file.export.layersToFiles",{dir:dir.trim(),prefix,visibleOnly,format,...(jpeg?{quality}:{})})}>
    <fieldset className="xd-ps-dialog-group"><legend>Destination</legend>
      <div className="xd-ps-dialog-row"><input aria-label="Destination" value={dir} onChange={e=>setDir(e.target.value)}/><button type="button" onClick={browse}>Browse…</button></div>
    </fieldset>
    <Field label="File Name Prefix"><input aria-label="File Name Prefix" value={prefix} onChange={e=>setPrefix(e.target.value)}/></Field>
    <label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Visible Layers Only" checked={visibleOnly} onChange={e=>setVisibleOnly(e.target.checked)}/>Visible Layers Only</label>
    <fieldset className="xd-ps-dialog-group"><legend>File Type</legend>
      <select aria-label="File Type" value={format} onChange={e=>setFormat(e.target.value)}>{LAYER_FORMATS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
    </fieldset>
    {jpeg&&<fieldset className="xd-ps-dialog-group"><legend>JPEG Options</legend>
      <Field label="Quality"><input type="number" aria-label="Quality" required min="0" max="12" value={Number.isFinite(quality)?quality:""} onChange={e=>setQuality(e.target.valueAsNumber)}/></Field>
    </fieldset>}
  </FileDialog>;
}
