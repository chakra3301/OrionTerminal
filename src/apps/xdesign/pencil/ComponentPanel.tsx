import { useState } from "react";
import { isSlotDefinition } from "./slots";
import { resolveComponentPropertyValue, type ComponentPropertyDefinition, type SceneNode, type SceneGraph } from "@open-pencil/scene-graph";
import { usePencilWorkspace } from "./runtime";
import { createComponentProperty, deleteComponentProperty, editComponentDefinition, resetInstanceProperties, setPreferredComponents } from "./componentProperties";

function componentLabel(graph:SceneGraph,node:SceneNode):string {
  const parent=node.parentId?graph.getNode(node.parentId):null;
  const name=parent?.type==="COMPONENT_SET"?`${parent.name} / ${node.name}`:node.name;
  const identity=node.librarySource?.identity??parent?.librarySource?.identity;
  const library=node.pluginData.find(item=>item.pluginId==="orion.xdesign"&&item.key==="libraryDisplayName")?.value??parent?.pluginData.find(item=>item.pluginId==="orion.xdesign"&&item.key==="libraryDisplayName")?.value;
  return identity?`${name} · ${library??identity.libraryId.slice(-8)}`:name;
}

function PreferredComponents({definition,owner,act}:{definition:ComponentPropertyDefinition;owner:SceneNode;act:(work:()=>unknown)=>void}) {
  const editor=usePencilWorkspace(s=>s.editor)!;
  const [search,setSearch]=useState("");
  const values=definition.preferredValues??[];
  const components=[...editor.graph.nodes.values()].filter(node=>node.type==="COMPONENT"&&componentLabel(editor.graph,node).toLowerCase().includes(search.toLowerCase())).sort((a,b)=>componentLabel(editor.graph,a).localeCompare(componentLabel(editor.graph,b)));
  const selected=(id:string)=>values.some(value=>resolveComponentPropertyValue(editor.graph,value)?.id===id);
  return <details><summary>Preferred components · {values.length}</summary><input aria-label={`Search preferred ${definition.name}`} placeholder="Search components…" value={search} onChange={event=>setSearch(event.target.value)}/><div className="xd-pencil-preferred-components">{components.map(component=><label key={component.id} className="xd-library-checkbox"><input aria-label={`Prefer ${componentLabel(editor.graph,component)} for ${definition.name}`} type="checkbox" checked={selected(component.id)} onChange={event=>act(()=>setPreferredComponents(editor,owner,definition.id,event.target.checked?[...values,component.id]:values.filter(value=>resolveComponentPropertyValue(editor.graph,value)?.id!==component.id)))}/><span>{componentLabel(editor.graph,component)}</span></label>)}{values.filter(value=>!resolveComponentPropertyValue(editor.graph,value)).map(value=><label key={value} className="xd-library-checkbox"><span>Unavailable component</span><button aria-label={`Remove unavailable preferred component ${value}`} onClick={()=>act(()=>setPreferredComponents(editor,owner,definition.id,values.filter(item=>item!==value)))}>Remove</button></label>)}</div><p className="xd-pencil-section-help">Preferred choices appear first in instances. All other components remain available.</p></details>;
}

function VariantValues({definition,owner,act}:{definition:ComponentPropertyDefinition;owner:SceneNode;act:(work:()=>unknown)=>void}) {
  const editor=usePencilWorkspace(s=>s.editor)!;
  const values=definition.variantOptions??[];
  const move=(index:number,step:number)=>{const next=[...values];[next[index],next[index+step]]=[next[index+step]!,next[index]!];act(()=>editor.reorderVariantValues(owner.id,definition.id,next));};
  return <details><summary>Variant values</summary>{values.map((value,index)=><div key={value} className="xd-pencil-variant-value"><input aria-label={`Rename ${definition.name} value ${value}`} defaultValue={value} onBlur={event=>{const next=event.target.value.trim();if(next!==value)act(()=>editor.renameVariantValue(owner.id,definition.id,value,next));}}/><button aria-label={`Move ${definition.name} ${value} up`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button><button aria-label={`Move ${definition.name} ${value} down`} disabled={index===values.length-1} onClick={()=>move(index,1)}>↓</button></div>)}<p className="xd-pencil-section-help">The first value is the default for this property.</p></details>;
}

export function ComponentPanel({node}:{node:SceneNode}) {
  const editor=usePencilWorkspace(s=>s.editor)!;
  const [error,setError]=useState(""),[name,setName]=useState("New property"),[type,setType]=useState<ComponentPropertyDefinition["type"]>("TEXT"),[defaultValue,setDefault]=useState("");
  const main=node.componentId?editor.graph.getNode(node.componentId):node;
  const set=main?.parentId?editor.graph.getNode(main.parentId):null;
  const componentSet=node.type==="COMPONENT_SET"?node:set?.type==="COMPONENT_SET"?set:null;
  const owner=node.type==="COMPONENT_SET"?node:node.type==="COMPONENT"?node:null;
  const definitions=node.type==="INSTANCE"?editor.getInstanceComponentPropertyDefinitions(node.id):node.type==="COMPONENT_SET"?node.componentPropertyDefinitions:node.type==="COMPONENT"?[...(componentSet?.componentPropertyDefinitions??[]),...node.componentPropertyDefinitions]:[];
  const components=[...editor.graph.nodes.values()].filter(node=>node.type==="COMPONENT").sort((a,b)=>a.name.localeCompare(b.name));
  if(!["COMPONENT","COMPONENT_SET","INSTANCE"].includes(node.type))return null;
  const act=(work:()=>unknown)=>{try{const result=work();setError(result===false?"This change could not be applied.":result&&typeof result==="object"&&"error" in result?String(result.error):result&&typeof result==="object"&&"kind" in result&&["unavailable","invalid","conflict"].includes(String(result.kind))?`This component change is ${String(result.kind)}. Choose an existing variant combination.`:"");}catch(e){setError(String(e));}};
  const valueField=(def:ComponentPropertyDefinition,value:string,change:(next:string)=>void)=>{
    const preferred=new Set((def.preferredValues??[]).flatMap(value=>{const component=resolveComponentPropertyValue(editor.graph,value);return component?[component.id]:[];}));
    const options=(choices:SceneNode[])=>choices.map(component=><option key={component.id} value={component.id}>{componentLabel(editor.graph,component)}</option>);
    return def.type==="BOOLEAN"?<input aria-label={def.name} type="checkbox" checked={value==="true"} onChange={e=>change(String(e.target.checked))}/>:def.type==="INSTANCE_SWAP"?<select aria-label={def.name} value={resolveComponentPropertyValue(editor.graph,value)?.id??value} onChange={event=>change(event.target.value)}><option value="" disabled>Choose component</option>{!resolveComponentPropertyValue(editor.graph,value)&&value&&<option value={value}>Unavailable component</option>}{preferred.size?<><optgroup label="Preferred components">{options([...preferred].flatMap(id=>{const component=editor.graph.getNode(id);return component?[component]:[];}))}</optgroup><optgroup label="Other components">{options(components.filter(component=>!preferred.has(component.id)))}</optgroup></>:options(components)}</select>:<input aria-label={def.name} key={value} defaultValue={value} onBlur={e=>{if(e.target.value!==value)change(e.target.value);}}/>;
  };
  return <><h3>{node.type==="INSTANCE"?"Instance properties":"Component properties"}</h3>
    {definitions.map((def,index)=>{
      if(isSlotDefinition(def))return null;
      if(owner&&owner.componentPropertyDefinitions.includes(def))return <div className="xd-pencil-property-card" key={def.id}>
        <input aria-label="Component property name" defaultValue={def.name} key={def.name} onBlur={event=>act(()=>{
          if(def.type==="VARIANT")return editor.renamePropertyDefinition(owner.id,def.id,event.target.value);
          const next=event.target.value.trim();if(!next||owner.componentPropertyDefinitions.some(item=>item.id!==def.id&&item.name===next))throw new Error("Enter a unique property name.");
          return editComponentDefinition(editor,owner,"Rename component property",()=>editor.graph.updateNode(owner.id,{componentPropertyDefinitions:owner.componentPropertyDefinitions.map(item=>item.id===def.id?{...item,name:next}:item)}));
        })}/><small>{def.type.toLowerCase().replaceAll("_"," ")}</small>
        {def.type!=="VARIANT"&&<label>Default{valueField(def,def.defaultValue,next=>act(()=>editComponentDefinition(editor,owner,"Change property default",()=>editor.graph.updateNode(owner.id,{componentPropertyDefinitions:owner.componentPropertyDefinitions.map(item=>item.id===def.id?{...item,defaultValue:next}:item)}))))}</label>}
        {def.type==="INSTANCE_SWAP"&&<PreferredComponents definition={def} owner={owner} act={act}/>}
        {def.type==="VARIANT"&&<VariantValues definition={def} owner={owner} act={act}/>}
        {owner.type==="COMPONENT_SET"&&<div className="xd-pencil-buttons">{[-1,1].map(step=><button key={step} aria-label={`Move property ${def.name} ${step===-1?"up":"down"}`} disabled={index+step<0||index+step>=owner.componentPropertyDefinitions.length} onClick={()=>act(()=>{const ids=owner.componentPropertyDefinitions.map(def=>def.id),position=ids.indexOf(def.id);[ids[position],ids[position+step]]=[ids[position+step]!,ids[position]!];return editor.reorderPropertyDefinitions(owner.id,ids);})}>{step===-1?"↑":"↓"}</button>)}</div>}
        <button onClick={()=>act(()=>def.type==="VARIANT"?editor.removePropertyDefinition(owner.id,def.id):deleteComponentProperty(editor,owner,def.id))}>Remove property</button>
      </div>;
      if(node.type==="COMPONENT"&&def.type!=="VARIANT")return <p className="xd-pencil-section-help" key={def.id}>{def.name} · defined in {componentSet?.name}</p>;
      const value=node.type==="INSTANCE"?editor.getInstanceComponentPropertyValue(node.id,def):node.componentPropertyValues[def.name]??def.defaultValue;
      const change=(next:string)=>act(()=>node.type==="INSTANCE"?def.type==="VARIANT"?editor.switchInstanceVariant(node.id,def.name,next):editor.setInstanceComponentProperty(node.id,def.id,next):editor.setVariantPropertyValue(node.id,def.id,next));
      const collected=componentSet?[...(editor.collectVariantOptions(componentSet.id).get(def.name)??[])]:[];
      const options=[...def.variantOptions??[],...collected.filter(value=>!def.variantOptions?.includes(value))];
      const availability=node.type==="INSTANCE"&&def.type==="VARIANT"?editor.getVariantOptionAvailability(node.id,def.name):[];
      return <label key={def.id}>{def.name}{def.type==="VARIANT"?<select aria-label={def.name} value={value} onChange={e=>change(e.target.value)}>{[...new Set([value,...options])].map(v=><option key={v} disabled={availability.some(option=>option.value===v&&!option.available)}>{v}</option>)}</select>:valueField(def,value,change)}</label>;
    })}
    {owner&&<details className="xd-pencil-property-card"><summary>Add component property</summary><label>Name<input aria-label="New component property name" value={name} onChange={event=>setName(event.target.value)}/></label><label>Type<select aria-label="New component property type" value={type} onChange={event=>{setType(event.target.value as typeof type);setDefault(event.target.value==="BOOLEAN"?"true":"");}}>{["TEXT","BOOLEAN","INSTANCE_SWAP",...(node.type==="COMPONENT_SET"?["VARIANT"]:[])].map(value=><option key={value}>{value}</option>)}</select></label><label>Default{valueField({id:"new",name:"New property default",type,defaultValue},defaultValue,setDefault)}</label><button disabled={!name.trim()} onClick={()=>act(()=>type==="VARIANT"?editor.addPropertyDefinition(owner.id,name,type,defaultValue||"Default"):createComponentProperty(editor,owner,name,type,defaultValue))}>Add property</button></details>}
    {componentSet&&node.type!=="INSTANCE"&&<div className="xd-pencil-buttons"><button onClick={()=>act(()=>editor.addVariant(componentSet.id))}>Add variant</button><button disabled={node.type!=="COMPONENT"} onClick={()=>act(()=>editor.duplicateVariant(node.id))}>Duplicate variant</button>{node.type==="COMPONENT"&&<button onClick={()=>act(()=>editor.removeVariant(node.id))}>Remove variant</button>}</div>}
    {componentSet&&editor.validateComponentSet(componentSet.id).length>0&&<p role="status">Some variant combinations are duplicated or missing a property value.</p>}
    {node.type==="INSTANCE"&&<div className="xd-pencil-buttons"><button onClick={()=>{void editor.goToMainComponent();}}>Go to main component</button><button onClick={()=>act(()=>resetInstanceProperties(editor,node))}>Reset all overrides</button></div>}{error&&<p role="alert">{error}</p>}
  </>;
}
