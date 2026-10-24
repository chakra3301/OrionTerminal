import { useState } from "react";
import { createImage, usePhotoWorkspace, type NewPhotoOptions } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";

const BACKGROUNDS: [string, string][] = [["transparent", "Transparent"], ["white", "White"], ["black", "Black"]];

export function NewImageDialog({close}:{close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy);const [error,setError]=useState("");
  const dialog=useDesignDialog<HTMLFormElement>(close,busy);
  const [opening]=useState<NewPhotoOptions>(()=>({width:1920,height:1080,name:"Untitled image",mode:"rgb",depth:8,resolution:72,background:"transparent"}));
  const [values,setValues]=useState(opening);
  return <PhotoDialog dialog={dialog} title="New" label="New image" busy={busy} close={close} reset={()=>{setValues(opening);setError("");}} onSubmit={e=>{e.preventDefault();if(values.width*values.height>268435456){setError("Choose dimensions under 256 megapixels");return;}void createImage(undefined,values).then(close).catch(error=>setError(String(error)));}}>
    <div className="xd-ps-dialog-grid">
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Name:</span><input autoFocus aria-label="Image name" maxLength={120} value={values.name} onChange={e=>setValues(v=>({...v,name:e.target.value}))} disabled={busy}/></label></div>
      {(["width","height","resolution"] as const).map(field=><div key={field} className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{field==="resolution"?"Resolution":field==="width"?"Width":"Height"}:</span><input aria-label={field} type="number" min={1} max={field==="resolution"?12000:65535} required value={values[field]} onChange={e=>setValues(v=>({...v,[field]:e.target.valueAsNumber}))} disabled={busy}/><span className="xd-ps-dialog-unit">{field==="resolution"?"Pixels/Inch":"Pixels"}</span></label></div>)}
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Color Mode:</span><select aria-label="Image color mode" value={values.mode} onChange={e=>setValues(v=>({...v,mode:e.target.value as NewPhotoOptions["mode"]}))} disabled={busy}>{(["rgb","gray","cmyk","lab"] as const).map(mode=><option key={mode} value={mode}>{mode.toUpperCase()}</option>)}</select></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Bit Depth:</span><select aria-label="Image bit depth" value={values.depth} onChange={e=>setValues(v=>({...v,depth:Number(e.target.value) as NewPhotoOptions["depth"]}))} disabled={busy}>{[8,16,32].map(depth=><option key={depth} value={depth}>{depth} bit</option>)}</select></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Background Contents:</span><select aria-label="Background" value={values.background} onChange={e=>setValues(v=>({...v,background:e.target.value}))} disabled={busy}>{BACKGROUNDS.map(([id,text])=><option key={id} value={id}>{text}</option>)}</select></label></div>
    </div>
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}
