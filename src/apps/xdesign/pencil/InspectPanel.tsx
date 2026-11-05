import { useEffect, useMemo, useRef, useState } from "react";
import { selectionToJSX } from "@open-pencil/core/io";
import { createLinter, type LintMessage } from "@open-pencil/core/lint";
import { executeDesignToolAsync, exportPencil, persistPencil, usePencilWorkspace, withPencilTask } from "./runtime";
import { applyCodeEdits, prepareCodeEdits } from "./codeEdits";
import { fixLintIssues, lintFix } from "./lintFixes";
import { trackXDesignActivity } from "../runtimeActivity";
import { saveExport } from "../exportXD";

export function InspectPanel({tab}:{tab:"code"|"lint"}) {
  const editor=usePencilWorkspace(s=>s.editor),version=usePencilWorkspace(s=>s.version),busy=usePencilWorkspace(s=>s.busy);
  const [format,setFormat]=useState<"openpencil"|"tailwind"|"react"|"native-react">("tailwind"),[copied,setCopied]=useState(false);
  const [draft,setDraft]=useState(""),[baseline,setBaseline]=useState(""),[dirty,setDirty]=useState(false),[status,setStatus]=useState("");
  const [stale,setStale]=useState(false),revision=useRef(0),mounted=useRef(true);
  const ids=editor?[...editor.state.selectedIds]:[],selectionKey=`${editor?.state.currentPageId}/${ids.join("/")}`;
  const resourceKey=(format==="react"||format==="native-react")&&editor?JSON.stringify([[...editor.graph.variables],[...editor.graph.variableCollections],[...editor.graph.activeMode],editor.graph.documentColorSpace]):"";
  const content=useMemo(()=>{
    if(!editor)return {code:"",messages:[] as LintMessage[],error:null};
    try{
      const target=ids.length?ids:editor.graph.getChildren(editor.state.currentPageId).map(n=>n.id);
      return tab==="code"?{code:format==="react"||format==="native-react"?"":selectionToJSX(target,editor.graph,format),messages:[] as LintMessage[],error:null}:{code:"",messages:createLinter({preset:"recommended"}).lintGraph(editor.graph,target).messages,error:null};
    }catch(error){return {code:"",messages:[] as LintMessage[],error:String(error)};}
  },[editor,version,tab,format,selectionKey]);
  useEffect(()=>{setDirty(false);setDraft("");setBaseline("");setCopied(false);setStatus("");setStale(false);revision.current++;},[selectionKey,format,tab]);
  useEffect(()=>{revision.current++;setStale(true);setCopied(false);},[resourceKey]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(!editor)return;
    const changed=()=>{revision.current++;setStale(true);setCopied(false);};
    const remove=[editor.graph.emitter.on("node:updated",changed),editor.graph.emitter.on("node:created",changed),editor.graph.emitter.on("node:deleted",changed),editor.graph.emitter.on("node:reparented",changed),editor.graph.emitter.on("node:reordered",changed)];
    return()=>remove.forEach(unsubscribe=>unsubscribe());
  },[editor]);
  useEffect(()=>{if(!dirty){setDraft(content.code);setBaseline(content.code);}},[content.code,dirty]);
  const fix=(issues:LintMessage[])=>{if(!editor)return;void withPencilTask(()=>trackXDesignActivity("ui-tool","Wait for design fixes before switching projects.",async()=>{const count=fixLintIssues(editor,issues);await editor.loadFontsForNodes(issues.map(issue=>issue.nodeId));persistPencil();setStatus(`Fixed ${count} layer${count===1?"":"s"}.`);})).catch(()=>{});};
  const available=content.messages.filter(issue=>lintFix(editor?.graph.getNode(issue.nodeId),issue));
  return <>{content.error&&<p role="alert">{content.error}</p>}{tab==="code"?<>
    <h3>Design to code</h3><select disabled={busy} aria-label="Code format" value={format} onChange={e=>{setFormat(e.target.value as typeof format);setCopied(false);}}><option value="tailwind">Tailwind JSX</option><option value="react">Interactive React</option><option value="native-react">Native React</option><option value="openpencil">Design JSX</option></select>
    {format==="native-react"&&<><p>Responsive React with native artwork, embedded fonts and an offline renderer.</p><button disabled={busy||!editor||ids.length!==1} onClick={()=>{
      const captured=revision.current;
      void withPencilTask(()=>trackXDesignActivity("ui-tool","Wait for native React export before switching projects.",async()=>{
        const bytes=await exportPencil("NATIVE_REACT",1,ids);
        if(!mounted.current||captured!==revision.current)return;
        const saved=await saveExport("xdesign-native-react.zip",new Blob([bytes.slice().buffer],{type:"application/zip"}));
        if(mounted.current)setStatus(saved?"Native React archive saved.":"Export cancelled.");
      })).catch(error=>{if(mounted.current)setStatus(String(error));});
    }}>{busy?"Generating…":"Export native React"}</button>{ids.length!==1&&<p>Select one root layer to export.</p>}</>}
    {format==="react"&&<><p>Standalone React with embedded artwork, bound values, and keyboard controls. Install the design's fonts in the destination app.</p><button disabled={busy||!editor} onClick={()=>{
      const captured=revision.current;
      void withPencilTask(()=>trackXDesignActivity("ui-tool","Wait for code generation before switching projects.",async()=>{
        const bytes=await exportPencil("REACT",1,ids.length?ids:undefined);
        if(!mounted.current||captured!==revision.current)return;
        setDraft(new TextDecoder().decode(bytes));setStale(false);setCopied(false);setStatus("React component ready.");
      })).catch(error=>{if(mounted.current)setStatus(String(error));});
    }}>{busy?"Generating…":"Generate React component"}</button>{stale&&draft&&<p role="status">The design changed. Generate again to update this component.</p>}</>}
    {format!=="native-react"&&<button disabled={!draft||format==="react"&&stale} onClick={()=>{void navigator.clipboard.writeText(draft).then(()=>setCopied(true)).catch(error=>usePencilWorkspace.setState({error:String(error)}));}}>{copied?"Copied":"Copy code"}</button>}
    {format==="openpencil"&&<>
      <p>Apply property edits to preserve layer identities and component links. Replace or insert for changes to the layer structure.</p>
      <button disabled={busy||!dirty||ids.length!==1||!editor||baseline!==content.code} onClick={()=>{if(!editor)return;void withPencilTask(()=>trackXDesignActivity("ui-tool","Wait for the code edit before switching projects.",async()=>{const patches=await prepareCodeEdits(editor,ids[0]!,baseline,draft);const count=applyCodeEdits(editor,patches);await editor.loadFontsForNodes(patches.map(patch=>patch.id));persistPencil();setDirty(false);setStatus(`Updated ${count} layer${count===1?"":"s"}.`);})).catch(()=>{});}}>Apply property edits</button>
      {dirty&&baseline!==content.code&&<p role="status">The design changed after editing began. Refresh to edit the current version.</p>}
      <button disabled={busy||!draft||ids.length>1} onClick={()=>{void executeDesignToolAsync("render",{jsx:draft,...(ids.length===1?{replace_id:ids[0]}:{})}).then(()=>setDirty(false)).catch(()=>{});}}>{ids.length===1?"Replace selected layer":"Insert JSX"}</button>
      <button disabled={busy||!dirty} onClick={()=>{setDirty(false);setDraft(content.code);setBaseline(content.code);}}>Refresh code</button>
    </>}
    {format!=="native-react"&&<textarea readOnly={format!=="openpencil"} aria-label="Generated design code" className="xd-pencil-code" value={draft} onChange={e=>{setDraft(e.target.value);setDirty(true);setCopied(false);}}/>}
  </>:<>
    <h3>Design checks</h3><p>{ids.length?"Selection":"Page"} · {content.messages.length} finding{content.messages.length===1?"":"s"}</p>
    {!!available.length&&<><p>Available fixes: round pixel bounds, enlarge touch targets to 44px, or raise plain text to 12px. Each change can be undone.</p><button disabled={busy} onClick={()=>fix(available)}>Apply {available.length} available fixes</button></>}
    {content.messages.map((message,i)=><div key={`${message.nodeId}/${message.ruleId}/${i}`}><button className="xd-pencil-lint-issue" onClick={()=>{editor?.select([message.nodeId]);editor?.zoomToSelection();}}><strong>{message.nodeName}</strong><span>{message.message}</span>{message.suggest&&<small>{message.suggest}</small>}</button>{lintFix(editor?.graph.getNode(message.nodeId),message)&&<button disabled={busy} aria-label={`Fix ${message.ruleId} on ${message.nodeName}`} onClick={()=>fix([message])}>Apply fix</button>}</div>)}
  </>}{status&&<p role="status">{status}</p>}</>;
}
