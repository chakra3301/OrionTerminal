import { useState } from "react";
import type { Color, SceneNode, Variable, VariableType, VariableValue } from "@open-pencil/scene-graph";
import { usePencilWorkspace, persistPencil } from "./runtime";
import { editPencilGraph } from "./toolExecution";
import { colorHex, hexColor } from "./AppearancePanel";
import { setVariableAlias } from "./variableAliases";
import { resolveVariable } from "@open-pencil/scene-graph/variables";

function Value({variable,modeId,act}:{variable:Variable;modeId:string;act:(work:()=>void)=>void}) {
  const editor=usePencilWorkspace(s=>s.editor)!;
  const value=variable.valuesByMode[modeId];
  const commit=(next:VariableValue)=>act(()=>editor.updateVariableValue(variable.id,modeId,next));
  if(value&&typeof value==="object"&&"aliasId" in value){
    const target=editor.graph.variables.get(value.aliasId), resolved=resolveVariable(editor.graph,variable.id,modeId);
    return <span className="xd-pencil-alias-value" title={target?.name??value.aliasId}>{target?`↗ ${target.name}`:"Missing alias"}<small>{resolved&&typeof resolved==="object"&&"r" in resolved?colorHex(resolved):String(resolved??"Unresolved")}</small></span>;
  }
  if(variable.type==="COLOR")return <input aria-label={`${variable.name} value`} type="color" key={JSON.stringify(value)} defaultValue={colorHex((value as Color)??{r:0,g:0,b:0,a:1})} onBlur={e=>commit(hexColor(e.target.value))}/>;
  if(variable.type==="BOOLEAN")return <input aria-label={`${variable.name} value`} type="checkbox" checked={!!value} onChange={e=>commit(e.target.checked)}/>;
  return <input aria-label={`${variable.name} value`} key={String(value)} type={variable.type==="FLOAT"?"number":"text"} defaultValue={String(value??"")} onBlur={e=>{const next=variable.type==="FLOAT"?e.target.valueAsNumber:e.target.value;if(typeof next!=="number"||Number.isFinite(next))commit(next);}}/>;
}
export function VariablesPanel({node}:{node?:SceneNode}) {
  const editor=usePencilWorkspace(s=>s.editor)!;usePencilWorkspace(s=>s.version);
  const collections=editor.getCollections();
  const [collectionId,setCollectionId]=useState(collections[0]?.id??"");
  const collection=collections.find(c=>c.id===collectionId)??collections[0];
  const [name,setName]=useState("");const [type,setType]=useState<VariableType>("COLOR");
  const [binding,setBinding]=useState("fills/0/color");const [error,setError]=useState("");
  const modeId=collection?(editor.graph.activeMode.get(collection.id)??collection.defaultModeId):"";
  const variables=collection?editor.getVariablesForCollection(collection.id):[];
  const act=(work:()=>void)=>{try{work();persistPencil();setError("");}catch(e){setError(String(e));}};
  return <details className="xd-pencil-variables"><summary>Variables & modes · {editor.getVariableCount()}</summary>
    <div className="xd-pencil-buttons"><button onClick={()=>act(()=>{const c=editPencilGraph(editor,"Create collection",()=>editor.graph.createCollection(`Collection ${collections.length+1}`));setCollectionId(c.id);})}>New collection</button></div>
    {collection&&<><select aria-label="Variable collection" value={collection.id} onChange={e=>setCollectionId(e.target.value)}>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><input aria-label="Collection name" key={`${collection.id}/${collection.name}`} defaultValue={collection.name} onBlur={e=>act(()=>editor.renameCollection(collection.id,e.target.value))}/>
      <label>Mode<select aria-label="Variable mode" value={modeId} onChange={e=>act(()=>editor.setActiveMode(collection.id,e.target.value))}>{collection.modes.map(m=><option key={m.modeId} value={m.modeId}>{m.name}</option>)}</select></label><input aria-label="Mode name" key={`${modeId}/${collection.modes.find(m=>m.modeId===modeId)?.name}`} defaultValue={collection.modes.find(m=>m.modeId===modeId)?.name} onBlur={e=>act(()=>editor.renameMode(collection.id,modeId,e.target.value))}/>
      <div className="xd-pencil-buttons"><button onClick={()=>act(()=>{editor.addMode(collection.id);})}>Add mode</button><button onClick={()=>act(()=>{editor.duplicateMode(collection.id,modeId);})}>Duplicate mode</button><button disabled={collection.modes.length<2} onClick={()=>act(()=>editor.removeMode(collection.id,modeId))}>Remove mode</button></div>
      {variables.map(v=>{const value=v.valuesByMode[modeId],aliasId=value&&typeof value==="object"&&"aliasId" in value?value.aliasId:"";return <div className="xd-pencil-variable-group" key={v.id}><div className="xd-pencil-variable"><input aria-label="Variable name" defaultValue={v.name} key={v.name} onBlur={e=>act(()=>editor.renameVariable(v.id,e.target.value))}/><small>{v.type.toLowerCase()}</small><Value variable={v} modeId={modeId} act={act}/><button aria-label={`Delete ${v.name}`} onClick={()=>act(()=>editor.removeVariable(v.id))}>×</button></div><label className="xd-pencil-alias-picker">Reference<select aria-label={`${v.name} alias`} value={aliasId} onChange={e=>act(()=>setVariableAlias(editor,v.id,modeId,e.target.value||null))}><option value="">Own value</option>{aliasId&&!editor.graph.variables.has(aliasId)&&<option value={aliasId}>Missing variable</option>}{[...editor.graph.variables.values()].filter(target=>target.type===v.type&&target.id!==v.id).map(target=><option key={target.id} value={target.id}>{editor.graph.variableCollections.get(target.collectionId)?.name} / {target.name}</option>)}</select></label></div>;})}
      <label>New variable<input aria-label="New variable name" placeholder="Name" value={name} onChange={e=>setName(e.target.value)}/></label><select aria-label="New variable type" value={type} onChange={e=>setType(e.target.value as VariableType)}>{["COLOR","FLOAT","STRING","BOOLEAN"].map(v=><option key={v}>{v}</option>)}</select><button disabled={!name.trim()} onClick={()=>act(()=>{editPencilGraph(editor,"Create variable",()=>editor.graph.createVariable(name.trim(),type,collection.id,type==="COLOR"?{r:0,g:0,b:0,a:1}:type==="FLOAT"?0:type==="BOOLEAN"?false:""));setName("");})}>Add variable</button>
      {node&&<><h3>Bind selected layer</h3><select aria-label="Variable property" value={binding} onChange={e=>setBinding(e.target.value)}>{["fills/0/color","strokes/0/color","opacity","width","height","cornerRadius","fontSize","fontFamily","itemSpacing","paddingTop","paddingRight","paddingBottom","paddingLeft","visible"].map(v=><option key={v}>{v}</option>)}</select><select aria-label="Bind variable" value={node.boundVariables[binding]??""} onChange={e=>act(()=>e.target.value?editor.bindVariable(node.id,binding,e.target.value):editor.unbindVariable(node.id,binding))}><option value="">No variable</option>{[...editor.graph.variables.values()].map(v=><option key={v.id} value={v.id}>{v.name} · {v.type}</option>)}</select></>}
      <button onClick={()=>act(()=>editor.removeCollection(collection.id))}>Delete collection</button>
    </>}{error&&<p role="alert">{error}</p>}
  </details>;
}
