import { useState } from "react";
import type { ComponentPropertyReferenceField, SceneNode } from "@open-pencil/scene-graph";
import { usePencilWorkspace } from "./runtime";
import { bindComponentProperty, componentPropertyHost, createComponentProperty } from "./componentProperties";

export function ComponentBindingsPanel({node}:{node:SceneNode}) {
  const editor=usePencilWorkspace(state=>state.editor)!;
  const [name,setName]=useState(""),[error,setError]=useState("");
  const host=componentPropertyHost(editor.graph,node);
  if(!host)return null;
  const fields:Array<{field:ComponentPropertyReferenceField;label:string;type:"BOOLEAN"|"TEXT"|"INSTANCE_SWAP";value:string}>=[{field:"VISIBLE",label:"Visibility",type:"BOOLEAN",value:String(node.visible)}];
  if(node.type==="TEXT")fields.push({field:"TEXT",label:"Text",type:"TEXT",value:node.text});
  if(node.type==="INSTANCE")fields.push({field:"INSTANCE_SWAP",label:"Instance swap",type:"INSTANCE_SWAP",value:node.componentId??""});
  const run=(work:()=>void)=>{try{work();setError("");}catch(error){setError(String(error));}};
  return <details className="xd-pencil-property-card"><summary>Expose component properties</summary><p className="xd-pencil-section-help">Bind fields in {host.name} so each instance can set its own value.</p>
    <label>New property name<input aria-label="Exposed property name" value={name} placeholder={node.name} onChange={event=>setName(event.target.value)}/></label>
    {fields.map(({field,label,type,value})=><div key={field}><label>{label}<select aria-label={`Bind ${label.toLowerCase()} property`} value={node.componentPropertyReferences.find(ref=>ref.field===field)?.propertyId??""} onChange={event=>run(()=>bindComponentProperty(editor,node,field,event.target.value||null))}><option value="">Not exposed</option>{host.componentPropertyDefinitions.filter(def=>def.type===type).map(def=><option value={def.id} key={def.id}>{def.name}</option>)}</select></label><button onClick={()=>run(()=>{
      editor.undo.runBatch(`Expose ${label.toLowerCase()}`,()=>{const id=createComponentProperty(editor,host,name.trim()||`${node.name} ${label.toLowerCase()}`,type,value);bindComponentProperty(editor,node,field,id);});
    })}>Expose {label.toLowerCase()}</button></div>)}
    {error&&<p role="alert">{error}</p>}
  </details>;
}
