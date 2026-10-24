import type { Editor } from "@open-pencil/core/editor";
import { applyComponentPropertyValue, createInstanceOverrideState, removeComponentProperty, resolveComponentPropertyValue, type ComponentPropertyDefinition, type ComponentPropertyReferenceField, type SceneGraph, type SceneNode } from "@open-pencil/scene-graph";
import { ulid } from "ulid";
import { isLibraryDefinition } from "./librarySession";
import { editPencilGraph } from "./toolExecution";
import { isSlotDefinition } from "./slots";

export function componentPropertyHost(graph:SceneGraph,node:SceneNode):SceneNode|null {
  let current=node.parentId?graph.getNode(node.parentId):null,component:SceneNode|null=null;
  while(current){
    if(current.type==="INSTANCE")return null;
    if(current.type==="COMPONENT"&&!component)component=current;
    if(current.type==="COMPONENT_SET")return current;
    current=current.parentId?graph.getNode(current.parentId):null;
  }
  return component;
}
function assertEditable(graph:SceneGraph,node:SceneNode) {
  if(isLibraryDefinition(graph,node))throw new Error("Unlock the original component before editing its properties.");
  let ancestor:SceneNode|undefined=node;
  while(ancestor){if(ancestor.locked)throw new Error("Unlock the original component before editing its properties.");ancestor=ancestor.parentId?graph.getNode(ancestor.parentId):undefined;}
}
function syncHost(graph:SceneGraph,host:SceneNode) {
  if(host.type==="COMPONENT")graph.syncInstances(host.id);
  else for(const id of host.childIds)if(graph.getNode(id)?.type==="COMPONENT")graph.syncInstances(id);
}
export function editComponentDefinition(editor:Editor,host:SceneNode,label:string,work:()=>void) {
  assertEditable(editor.graph,host);
  return editPencilGraph(editor,label,()=>{work();syncHost(editor.graph,host);});
}
export function createComponentProperty(editor:Editor,host:SceneNode,name:string,type:Exclude<ComponentPropertyDefinition["type"],"VARIANT">,defaultValue:string):string {
  const clean=name.trim();
  if(!clean||clean.length>256)throw new Error("Enter a property name up to 256 characters.");
  if(host.componentPropertyDefinitions.some(def=>def.name===clean))throw new Error("A property with this name already exists.");
  if(host.componentPropertyDefinitions.length>=512||defaultValue.length>4096)throw new Error("This component's property limit has been reached.");
  if(type==="INSTANCE_SWAP"&&!resolveComponentPropertyValue(editor.graph,defaultValue))throw new Error("Choose an existing component for the default instance.");
  const id=`prop:${ulid()}`;
  editComponentDefinition(editor,host,"Add component property",()=>editor.graph.updateNode(host.id,{componentPropertyDefinitions:[...host.componentPropertyDefinitions,{id,name:clean,type,defaultValue:type==="BOOLEAN"?String(defaultValue==="true"):defaultValue}]}));
  return id;
}
export function bindComponentProperty(editor:Editor,node:SceneNode,field:ComponentPropertyReferenceField,propertyId:string|null) {
  const host=componentPropertyHost(editor.graph,node);if(!host)throw new Error("Choose a layer in the main component.");
  assertEditable(editor.graph,node);
  const type=field==="TEXT"?"TEXT":field==="VISIBLE"?"BOOLEAN":"INSTANCE_SWAP";
  if(propertyId&&!host.componentPropertyDefinitions.some(def=>def.id===propertyId&&def.type===type))throw new Error("This property does not match the selected field.");
  if(field==="TEXT"&&node.type!=="TEXT"||field==="INSTANCE_SWAP"&&node.type!=="INSTANCE")throw new Error("This layer does not support the selected property.");
  editComponentDefinition(editor,host,"Bind component property",()=>editor.graph.updateNode(node.id,{componentPropertyReferences:[...node.componentPropertyReferences.filter(ref=>ref.field!==field),...(propertyId?[{field,propertyId}]:[])]}));
}
export function deleteComponentProperty(editor:Editor,host:SceneNode,id:string) {
  editComponentDefinition(editor,host,"Remove component property",()=>removeComponentProperty(editor.graph,host.id,id));
}
export function setPreferredComponents(editor:Editor,host:SceneNode,id:string,values:readonly string[]) {
  const definition=host.componentPropertyDefinitions.find(def=>def.id===id);
  if(definition?.type!=="INSTANCE_SWAP")throw new Error("Choose an instance-swap property.");
  if(values.length>256||new Set(values).size!==values.length)throw new Error("Choose up to 256 distinct preferred components.");
  for(const value of values)if(!resolveComponentPropertyValue(editor.graph,value)&&!definition.preferredValues?.includes(value))throw new Error("Choose an existing preferred component.");
  if(JSON.stringify(definition.preferredValues??[])===JSON.stringify(values))return;
  editComponentDefinition(editor,host,"Set preferred components",()=>editor.graph.updateNode(host.id,{componentPropertyDefinitions:host.componentPropertyDefinitions.map(def=>def.id===id?{...def,preferredValues:[...values]}:def)}));
}
export function resetInstanceProperties(editor:Editor,node:SceneNode) {
  assertEditable(editor.graph,node);
  if(node.type!=="INSTANCE"||!node.componentId)throw new Error("Choose a linked component instance.");
  const definitions=editor.getInstanceComponentPropertyDefinitions(node.id);
  editPencilGraph(editor,"Reset instance overrides",()=>{
    editor.graph.updateNode(node.id,{instanceOverrides:createInstanceOverrideState(),componentPropertyAssignments:{}});
    editor.graph.swapInstanceComponent(node.id,node.componentId!);
    for(const definition of definitions)if(definition.type!=="VARIANT"&&!isSlotDefinition(definition))applyComponentPropertyValue(editor.graph,node.id,definition,definition.defaultValue);
  });
}
