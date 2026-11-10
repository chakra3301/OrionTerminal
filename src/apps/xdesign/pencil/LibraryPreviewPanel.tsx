import { useEffect, useState } from "react";
import type { LibraryUpdateReview } from "./librarySession";
import { libraryPreviewChoices, renderLibraryPreview } from "./libraryPreview";
import { usePencilWorkspace } from "./runtime";

export function LibraryPreviewPanel({review}:{review:LibraryUpdateReview}) {
  const editor=usePencilWorkspace(workspace=>workspace.editor),[id,setId]=useState(""),[choices,setChoices]=useState<{id:string;name:string}[]>([]),[preview,setPreview]=useState<Awaited<ReturnType<typeof renderLibraryPreview>>|null>(null),[error,setError]=useState("");
  useEffect(()=>{try{const choices=libraryPreviewChoices(review);setChoices(choices);setId(choices[0]?.id??"");}catch(error){setError(String(error));}},[review]);
  useEffect(()=>{setPreview(null);if(!id||!editor?.renderer?.ck)return;let active=true;
    const timer=window.setTimeout(()=>{try{void renderLibraryPreview(review,id,editor.renderer!.ck).then(preview=>{if(active){setPreview(preview);setError("");}}).catch(error=>{if(active)setError(String(error));});}catch(error){if(active)setError(String(error));}},0);
    return()=>{active=false;window.clearTimeout(timer);};
  },[review,id,editor]);
  if(!choices.length)return error?<p role="alert">{error}</p>:null;
  return <section className="xd-library-preview"><label>Preview instance<select aria-label="Library update preview instance" value={id} onChange={event=>setId(event.target.value)}>{choices.map(choice=><option value={choice.id} key={choice.id}>{choice.name}</option>)}</select></label>
    {preview?<div className="xd-pencil-grid"><figure><figcaption>Current · {preview.beforeSize}</figcaption><img src={preview.before} alt="Current library instance"/></figure><figure><figcaption>Reviewed update · {preview.afterSize}</figcaption><img src={preview.after} alt="Updated library instance"/></figure></div>:<p role="status">Rendering reviewed component…</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
