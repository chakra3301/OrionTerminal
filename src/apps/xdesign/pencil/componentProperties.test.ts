import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import { bindComponentProperty, createComponentProperty, deleteComponentProperty, resetInstanceProperties, setPreferredComponents } from "./componentProperties";
import { installInstancePropertyUpdates } from "./instanceUpdates";
import { deserializeGraph, serializeGraph } from "./document";
let editor:Editor;
beforeEach(()=>{editor=createEditor();installInstancePropertyUpdates(editor);});
afterEach(()=>editor.dispose());
const component=()=>editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Button",width:120,height:40});
describe("component property controls",()=>{
  it("keeps preferred swaps as ordered guidance, persists them and restores them with undo",()=>{
    const main=component(),first=editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"First icon"}),second=editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Second icon"});
    const property=createComponentProperty(editor,main,"Icon","INSTANCE_SWAP",first.id);
    setPreferredComponents(editor,main,property,[second.id,first.id]);
    expect(main.componentPropertyDefinitions[0]?.preferredValues).toEqual([second.id,first.id]);
    expect(deserializeGraph(serializeGraph(editor.graph)).getNode(main.id)?.componentPropertyDefinitions[0]?.preferredValues).toEqual([second.id,first.id]);
    editor.undoAction();expect(main.componentPropertyDefinitions[0]?.preferredValues).toBeUndefined();editor.redoAction();
    const before=serializeGraph(editor.graph);expect(()=>setPreferredComponents(editor,main,property,["missing"])).toThrow("existing");expect(()=>setPreferredComponents(editor,main,property,[first.id,first.id])).toThrow("distinct");expect(serializeGraph(editor.graph)).toBe(before);
    editor.graph.updateNode(main.id,{locked:true});expect(()=>setPreferredComponents(editor,main,property,[])).toThrow("Unlock");
  });
  it("binds text and visibility to existing instances, preserves assignments and undo, and reopens",()=>{
    const main=component(),label=editor.graph.createNode("TEXT",main.id,{name:"Label",text:"Default"});
    const instance=editor.graph.createInstance(main.id,editor.state.currentPageId)!;
    const text=createComponentProperty(editor,main,"Label","TEXT","Default"),visible=createComponentProperty(editor,main,"Show label","BOOLEAN","true");
    bindComponentProperty(editor,label,"TEXT",text);bindComponentProperty(editor,label,"VISIBLE",visible);
    editor.setInstanceComponentProperty(instance.id,text,"Custom");editor.setInstanceComponentProperty(instance.id,visible,"false");
    const child=editor.graph.getNode(instance.childIds[0]!)!;
    expect(child).toMatchObject({text:"Custom",visible:false});
    editor.undoAction();expect(child.visible).toBe(true);expect(child.text).toBe("Custom");
    const reopened=deserializeGraph(serializeGraph(editor.graph));
    reopened.syncInstances(main.id);expect(reopened.getNode(child.id)?.text).toBe("Custom");
    expect(reopened.getNode(instance.id)?.componentPropertyAssignments[text]).toBe("Custom");
  });
  it("swaps an exposed nested instance and resets only the chosen outer instance, with complete undo",()=>{
    const main=component(),first=editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"First icon"}),second=editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Second icon"});
    editor.graph.createNode("RECTANGLE",first.id,{name:"Square"});editor.graph.createNode("ELLIPSE",second.id,{name:"Circle"});
    const slot=editor.graph.createInstance(first.id,main.id)!;
    const property=createComponentProperty(editor,main,"Icon","INSTANCE_SWAP",first.id);bindComponentProperty(editor,slot,"INSTANCE_SWAP",property);
    const instance=editor.graph.createInstance(main.id,editor.state.currentPageId,{x:200,y:300})!,other=editor.graph.createInstance(main.id,editor.state.currentPageId)!;
    const originalOther=structuredClone(editor.graph.getNode(other.childIds[0]!)!);
    editor.setInstanceComponentProperty(instance.id,property,second.id);
    expect(editor.graph.getNode(instance.childIds[0]!)?.componentId).toBe(second.id);
    resetInstanceProperties(editor,instance);
    expect(editor.graph.getNode(instance.childIds[0]!)?.componentId).toBe(first.id);expect(instance).toMatchObject({x:200,y:300});
    expect(editor.graph.getNode(other.childIds[0]!)).toEqual(originalOther);
    editor.undoAction();expect(editor.graph.getNode(instance.childIds[0]!)?.componentId).toBe(second.id);
    expect(instance.componentPropertyAssignments[property]).toBe(second.id);
  });
  it("removes definitions and descendant bindings together, then restores them in one undo",()=>{
    const main=component(),label=editor.graph.createNode("TEXT",main.id);
    const property=createComponentProperty(editor,main,"Caption","TEXT","Caption");bindComponentProperty(editor,label,"TEXT",property);
    const instance=editor.graph.createInstance(main.id,editor.state.currentPageId)!;editor.setInstanceComponentProperty(instance.id,property,"Changed");
    deleteComponentProperty(editor,main,property);
    expect(main.componentPropertyDefinitions).toHaveLength(0);expect(label.componentPropertyReferences).toHaveLength(0);expect(instance.componentPropertyAssignments).toEqual({});
    editor.undoAction();expect(main.componentPropertyDefinitions[0]?.id).toBe(property);expect(label.componentPropertyReferences[0]?.propertyId).toBe(property);expect(instance.componentPropertyAssignments[property]).toBe("Changed");
  });
  it("rejects duplicate names, incompatible bindings and changes to locked definitions without partial edits",()=>{
    const main=component(),label=editor.graph.createNode("TEXT",main.id);
    const property=createComponentProperty(editor,main,"Caption","TEXT","Caption");
    const before=serializeGraph(editor.graph);
    expect(()=>createComponentProperty(editor,main,"Caption","BOOLEAN","true")).toThrow("already exists");
    expect(()=>bindComponentProperty(editor,label,"VISIBLE",property)).toThrow("does not match");
    expect(serializeGraph(editor.graph)).toBe(before);
    editor.graph.updateNode(main.id,{locked:true});
    expect(()=>createComponentProperty(editor,main,"New","TEXT","")).toThrow("Unlock");expect(main.componentPropertyDefinitions).toHaveLength(1);
  });
});
