import { Fragment, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Field, FileDialog } from "./FileDialogs";
import { runPhotoCommand } from "./runtime";

// Raster and camera formats Orion decodes itself; .pcraft bundles are folders and SVG has no pixels to align.
const MERGE_EXTENSIONS=["png","jpg","jpeg","tif","tiff","psd","psb","webp","heic","heif","avif","bmp","gif","exr","hdr","qoi","tga","pnm","dng","cr2","cr3","nef","nrw","arw","srf","sr2","pef","orf","rw2","raf"];
const CURRENT="";
const base=(path:string)=>path.split(/[\\/]/).pop()||path;

type Sources={paths:string[];open:boolean};
const NO_SOURCES:Sources={paths:[],open:false};
const count=(sources:Sources)=>sources.paths.length+(sources.open?1:0);
const sourceParams=(sources:Sources)=>({paths:sources.paths,useOpenDocuments:sources.open});

/** Photoshop's Source Files box. Other open photos are separate sessions, so Add Open Files adds the image being edited. */
function SourceFiles({current,sources,set}:{current:string;sources:Sources;set:(next:Sources)=>void}) {
  const [picked,setPicked]=useState<string[]>([]);
  const browse=()=>void open({multiple:true,filters:[{name:"Images",extensions:MERGE_EXTENSIONS}]}).then(chosen=>{
    const paths=Array.isArray(chosen)?chosen:typeof chosen==="string"?[chosen]:[];
    if(paths.length)set({...sources,paths:[...new Set([...sources.paths,...paths])]});
  }).catch(()=>{});
  const remove=()=>{set({paths:sources.paths.filter(path=>!picked.includes(path)),open:sources.open&&!picked.includes(CURRENT)});setPicked([]);};
  return <fieldset className="xd-ps-dialog-group"><legend>Source Files</legend>
    <div className="xd-ps-dialog-grid"><Field label="Use"><select aria-label="Use" defaultValue="files"><option value="files">Files</option></select></Field></div>
    <div className="xd-ps-merge-files">
      <select multiple aria-label="Source files" size={8} value={picked} onChange={e=>setPicked([...e.target.selectedOptions].map(option=>option.value))}>
        {sources.open&&<option value={CURRENT}>{current}</option>}
        {sources.paths.map(path=><option key={path} value={path} title={path}>{base(path)}</option>)}
      </select>
      <div className="xd-ps-merge-buttons">
        <button type="button" onClick={browse}>Browse…</button>
        <button type="button" disabled={!picked.length} onClick={remove}>Remove</button>
        <button type="button" disabled={sources.open} onClick={()=>set({...sources,open:true})}>Add Open Files</button>
      </div>
    </div>
  </fieldset>;
}

const check=(label:string,checked:boolean,change:(checked:boolean)=>void)=><label className="xd-ps-dialog-check"><input type="checkbox" aria-label={label} checked={checked} onChange={e=>change(e.target.checked)}/>{label}</label>;

const LAYOUTS=[["auto","Auto"],["perspective","Perspective"],["cylindrical","Cylindrical"],["spherical","Spherical"],["collage","Collage"],["reposition","Reposition"]] as const;
const PHOTOMERGE_OPTIONS=[["blend","Blend Images Together"],["vignetteRemoval","Vignette Removal"],["geometricCorrection","Geometric Distortion Correction"],["contentAwareFill","Content Aware Fill Transparent Areas"]] as const;
type PhotomergeOption=typeof PHOTOMERGE_OPTIONS[number][0];

/** File › Automate › Photomerge…. The panorama opens as a new image, one masked layer per source. */
export function PhotomergeDialog({current,close}:{current:string;close:()=>void}) {
  const [sources,setSources]=useState(NO_SOURCES),[layout,setLayout]=useState("auto");
  const [options,setOptions]=useState<Record<PhotomergeOption,boolean>>({blend:true,vignetteRemoval:false,geometricCorrection:false,contentAwareFill:false});
  return <FileDialog title="Photomerge" close={close} okDisabled={count(sources)<2} apply={()=>runPhotoCommand("file.automate.photomerge",{...sourceParams(sources),layout,...options})}>
    <div className="xd-ps-merge">
      <fieldset className="xd-ps-dialog-group"><legend>Layout</legend>
        <div className="xd-ps-dialog-radios is-column">{LAYOUTS.map(([value,label])=><label key={value} className="xd-ps-dialog-check"><input type="radio" name="photomerge-layout" aria-label={label} checked={layout===value} onChange={()=>setLayout(value)}/>{label}</label>)}</div>
      </fieldset>
      <div>
        <SourceFiles current={current} sources={sources} set={setSources}/>
        {PHOTOMERGE_OPTIONS.map(([key,label])=><Fragment key={key}>{check(label,options[key],checked=>setOptions(state=>({...state,[key]:checked})))}</Fragment>)}
      </div>
    </div>
  </FileDialog>;
}

type Slider={key:string;label:string;min:number;max:number;step:number;value:number;unit?:string};
const slider=(key:string,label:string,min:number,max:number,value:number,step=1,unit?:string):Slider=>({key,label,min,max,step,value,unit});
// The engine's Local Adaptation ranges and defaults.
const EDGE_GLOW=[slider("radius","Radius",1,500,7,1,"px"),slider("strength","Strength",.1,4,.52,.01)];
const TONE=[slider("gamma","Gamma",.1,2,1,.01),slider("exposure","Exposure",-5,5,0,.01),slider("detail","Detail",-100,300,30,1,"%")];
const ADVANCED=[slider("shadow","Shadow",-100,100,0,1,"%"),slider("highlight","Highlight",-100,100,0,1,"%"),slider("vibrance","Vibrance",-100,100,0,1,"%"),slider("saturation","Saturation",-100,100,20,1,"%")];
const EXPOSURE_GAMMA=[TONE[1]!,TONE[0]!];
const METHODS=[["localAdaptation","Local Adaptation"],["equalizeHistogram","Equalize Histogram"],["exposureGamma","Exposure and Gamma"],["highlightCompression","Highlight Compression"]] as const;
const MODES=[["32","32 Bit"],["16","16 Bit"],["8","8 Bit"]] as const;
const methodSliders=(method:string)=>method==="localAdaptation"?[...EDGE_GLOW,...TONE,...ADVANCED]:method==="exposureGamma"?EXPOSURE_GAMMA:[];

/** File › Automate › Merge to HDR Pro…: the source files, then Photoshop's HDR Pro options. 32-bit keeps the linear merge; 16 and 8 bit tone-map it. */
export function MergeToHdrDialog({current,close}:{current:string;close:()=>void}) {
  const [step,setStep]=useState<"sources"|"options">("sources"),[sources,setSources]=useState(NO_SOURCES),[align,setAlign]=useState(true);
  const [removeGhosts,setRemoveGhosts]=useState(false),[mode,setMode]=useState("16"),[method,setMethod]=useState("localAdaptation");
  const [values,setValues]=useState<Record<string,number>>(()=>Object.fromEntries([...EDGE_GLOW,...TONE,...ADVANCED].map(field=>[field.key,field.value])));
  if(step==="sources")return <FileDialog key="sources" title="Merge to HDR Pro" close={close} okDisabled={count(sources)<2} apply={()=>Promise.resolve()} done={()=>setStep("options")}>
    <p className="xd-ps-dialog-text">Choose two or more files from a set of exposures to merge and create a High Dynamic Range image.</p>
    <SourceFiles current={current} sources={sources} set={setSources}/>
    {check("Attempt to Automatically Align Source Images",align,setAlign)}
  </FileDialog>;
  const shown=mode==="32"?[]:methodSliders(method);
  const valid=shown.every(field=>Number.isFinite(values[field.key])&&values[field.key]!>=field.min&&values[field.key]!<=field.max);
  const set=(key:string,value:number)=>setValues(state=>({...state,[key]:value}));
  const sliders=(fields:Slider[])=><div className="xd-ps-dialog-grid has-sliders">{fields.map(field=><Fragment key={field.key}>
    <Field label={field.label} unit={field.unit}><input type="number" aria-label={field.label} required min={field.min} max={field.max} step={field.step} value={Number.isFinite(values[field.key])?values[field.key]:""} onChange={e=>set(field.key,e.target.valueAsNumber)}/></Field>
    <input type="range" aria-label={`${field.label} slider`} min={field.min} max={field.max} step={field.step} value={Number.isFinite(values[field.key])?values[field.key]:field.value} onChange={e=>set(field.key,e.target.valueAsNumber)}/>
  </Fragment>)}</div>;
  const group=(legend:string,fields:Slider[])=><fieldset className="xd-ps-dialog-group"><legend>{legend}</legend>{sliders(fields)}</fieldset>;
  const apply=()=>runPhotoCommand("file.automate.mergeToHdrPro",{...sourceParams(sources),align,removeGhosts,mode,...(mode==="32"?{}:{method,...Object.fromEntries(shown.map(field=>[field.key,values[field.key]]))})});
  return <FileDialog key="options" title="Merge to HDR Pro" close={close} okDisabled={!valid} apply={apply}>
    {check("Remove ghosts",removeGhosts,setRemoveGhosts)}
    <div className="xd-ps-dialog-grid">
      <Field label="Mode"><select aria-label="Mode" value={mode} onChange={e=>setMode(e.target.value)}>{MODES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
      {mode!=="32"&&<Field label="Method"><select aria-label="Method" value={method} onChange={e=>setMethod(e.target.value)}>{METHODS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>}
    </div>
    {mode!=="32"&&method==="localAdaptation"&&<>{group("Edge Glow",EDGE_GLOW)}{group("Tone and Detail",TONE)}{group("Advanced",ADVANCED)}</>}
    {mode!=="32"&&method==="exposureGamma"&&sliders(EXPOSURE_GAMMA)}
  </FileDialog>;
}
