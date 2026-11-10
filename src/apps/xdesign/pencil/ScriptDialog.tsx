import { useEffect, useRef, useState } from "react";
import { useDesignDialog } from "../useDesignDialog";
import { downloadFile } from "../exportXD";
import { applyPencilScript, previewPencilScript, scriptDraftCurrent, type ScriptDraft } from "./scriptRuntime";
import { usePencilWorkspace } from "./runtime";
const example = `const frame = figma.createFrame();
frame.name = "Card grid";
frame.resize(640, 480);
for (let i = 0; i < 6; i++) {
  const card = figma.createRectangle();
  card.name = "Card " + (i + 1);
  card.resize(180, 180);
  card.x = 24 + (i % 3) * 204;
  card.y = 24 + Math.floor(i / 3) * 204;
  frame.appendChild(card);
}
figma.currentPage.selection = [frame];
frame`;
export function ScriptDialog({close}:{close:()=>void}) {
  const [code,setCode]=useState(example),[draft,setDraft]=useState<ScriptDraft|null>(null),[error,setError]=useState<string|null>(null),[running,setRunning]=useState(false),[applying,setApplying]=useState(false),[timeout,setTimeout]=useState(5);
  const busy=usePencilWorkspace(s=>s.busy);usePencilWorkspace(s=>s.version);
  const controller=useRef<AbortController|null>(null),alive=useRef(true),operation=useRef(false),intent=useRef(0),file=useRef<HTMLInputElement>(null);
  const dismiss=()=>{if(applying||!alive.current)return;intent.current++;alive.current=false;controller.current?.abort();close();};
  const dialog=useDesignDialog<HTMLDivElement>(dismiss,applying);
  useEffect(()=>{alive.current=true;return()=>{intent.current++;alive.current=false;controller.current?.abort();};},[]);
  const preview=async()=>{
    if(!alive.current||operation.current||busy)return;intent.current++;operation.current=true;const abort=new AbortController();controller.current=abort;setRunning(true);setError(null);setDraft(null);
    try{const result=await previewPencilScript(code,abort.signal,timeout*1000);if(alive.current&&!abort.signal.aborted)setDraft(result);}
    catch(error){if(alive.current&&!abort.signal.aborted)setError(String(error));}
    finally{operation.current=false;if(controller.current===abort)controller.current=null;if(alive.current)setRunning(false);}
  };
  const apply=async()=>{
    if(!alive.current||!draft||operation.current||busy)return;intent.current++;operation.current=true;setApplying(true);setError(null);
    try{await applyPencilScript(draft);if(alive.current)setDraft(null);}
    catch(error){if(alive.current)setError(String(error));}
    finally{operation.current=false;if(alive.current)setApplying(false);}
  };
  const valid=draft&&scriptDraftCurrent(draft),changed=draft&&(draft.output.graph!==draft.before||draft.summary.pageChanged||draft.summary.selectionChanged);
  return <div ref={dialog} className="xd-pencil-dialog xd-script-dialog" role="dialog" aria-modal="true" aria-label="Design scripts"><form onSubmit={event=>{event.preventDefault();void preview();}}>
    <header><strong>Design scripts</strong><button type="button" disabled={applying} onClick={dismiss}>Close</button></header>
    <p>Run JavaScript on a separate design draft with the OpenPencil <code>figma</code> API. Review the result, then apply it as one undoable action.</p>
    <label>JavaScript<textarea aria-label="Design script" value={code} disabled={running||applying} spellCheck={false} onChange={event=>{if(!alive.current||operation.current)return;intent.current++;setCode(event.target.value);setDraft(null);setError(null);}}/></label>
    <div className="xd-script-controls"><label>Time limit (seconds)<input aria-label="Script time limit" type="number" min={.5} max={30} step={.5} value={timeout} disabled={running||applying} onChange={event=>setTimeout(event.target.valueAsNumber)}/></label>
      <button type="button" disabled={running||applying} onClick={()=>file.current?.click()}>Open .js</button><button type="button" disabled={running||applying} onClick={()=>downloadFile("xdesign-script.js",new Blob([code],{type:"text/javascript"}))}>Save .js</button>
      <button type="submit" disabled={busy||running||applying||!Number.isFinite(timeout)||timeout<.5||timeout>30}>{running?"Running draft…":"Preview script"}</button>{running&&<button type="button" onClick={()=>controller.current?.abort()}>Stop script</button>}
    </div>
    {error&&<p role="alert">{error}</p>}{draft&&<section className="xd-script-result"><p role="status">{valid?"Draft ready":"The design changed. Preview again."} · {draft.summary.added} added, {draft.summary.removed} removed, {draft.summary.changed} changed layers · {draft.summary.images} images and {draft.summary.variables} variables changed · {draft.summary.collections} collections, {draft.summary.modes} modes and {draft.summary.libraries} libraries changed{draft.summary.documentChanged ? " · document color space changed" : ""}</p>
      {draft.output.logs.length>0&&<details open><summary>Console</summary><pre>{draft.output.logs.join("\n")}</pre></details>}<details open><summary>Result</summary><pre>{draft.output.result}</pre></details>
      <button type="button" disabled={!valid||busy||applying||!changed} onClick={()=>{void apply();}}>{applying?"Applying…":"Apply script changes"}</button>
    </section>}
    <input ref={file} type="file" accept=".js,.mjs,text/javascript" aria-label="Open design script file" hidden disabled={running||applying} onChange={event=>{const selected=event.target.files?.[0],current=++intent.current;event.target.value="";if(!selected||!alive.current||operation.current)return;if(selected.size>65536){setError("Open a JavaScript file up to 64 KiB.");return;}void selected.text().then(text=>{if(alive.current&&intent.current===current&&!operation.current){setCode(text);setDraft(null);setError(null);}}).catch(error=>{if(alive.current&&intent.current===current&&!operation.current)setError(String(error));});}}/>
  </form></div>;
}
