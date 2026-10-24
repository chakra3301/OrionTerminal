import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import type { SceneNode } from "@open-pencil/scene-graph";
import { addSlotComponent, createSlot, editSlot, installSlotSupport, instanceSlotFrames, ownsSlotContent, removeSlot, slotDefinitions, slotPropertyId, slotViolations, updateSlot } from "./slots";
import { installSlotEditing } from "./slotEditing";
import { installInstancePropertyUpdates } from "./instanceUpdates";
import { deserializeGraph, serializeGraph } from "./document";
let editor: Editor;
beforeEach(() => { editor = createEditor(); installSlotSupport(editor.graph); installInstancePropertyUpdates(editor); installSlotEditing(editor); });
afterEach(() => editor.dispose());
function component(name = "Card") {
  const main = editor.graph.createNode("COMPONENT",editor.state.currentPageId,{ name,width:200,height:150 }), frame = editor.graph.createNode("FRAME",main.id,{ name:"Body",width:200,height:100 });
  editor.graph.createNode("TEXT",frame.id,{ text:"Default",name:"Default label" });
  const property = createSlot(editor,frame);
  return {main,frame,property};
}
const slot = (instance: SceneNode) => instanceSlotFrames(editor.graph,instance)[0]!;
describe("component content slots",() => {
  it("converts existing frames and instances together and restores the binding in one undo",() => {
    const main = editor.graph.createNode("COMPONENT",editor.state.currentPageId), frame = editor.graph.createNode("FRAME",main.id,{name:"Body"}), instance = editor.graph.createInstance(main.id,editor.state.currentPageId)!;
    const property = createSlot(editor,frame);
    expect(slotPropertyId(slot(instance))).toBe(property); expect(slotDefinitions(editor.graph,instance)[0]?.type).toBe("SLOT");
    editor.undoAction(); expect(slotPropertyId(frame)).toBeUndefined(); expect(slotPropertyId(editor.graph.getNode(instance.childIds[0]!)!)).toBeUndefined();
    editor.redoAction(); expect(slotPropertyId(slot(instance))).toBe(property);
  });
  it("inherits changes until claimed, then preserves owned content and transient guards through sync, undo and reopening",() => {
    const {main,frame,property} = component(), instance = editor.graph.createInstance(main.id,editor.state.currentPageId)!, sibling = editor.graph.createInstance(main.id,editor.state.currentPageId)!;
    const label = editor.graph.getNode(slot(instance).childIds[0]!)!;
    editor.updateNodeWithUndo(label.id,{text:"Personal"}); expect(ownsSlotContent(editor.graph,slot(instance))).toBe(true);
    const defaultLabel = editor.graph.getNode(frame.childIds[0]!)!; editor.graph.updateNode(defaultLabel.id,{text:"New default"}); editor.graph.syncInstances(main.id);
    expect(label.text).toBe("Personal"); expect(editor.graph.getNode(slot(sibling).childIds[0]!)?.text).toBe("New default");
    expect(instance.instanceOverrides.descendants.get(slot(instance).id)?.has("componentId")).toBeFalsy();
    const reopened = deserializeGraph(serializeGraph(editor.graph)); reopened.syncInstances(main.id);
    expect(reopened.getNode(label.id)?.text).toBe("Personal"); expect(reopened.getNode(instance.id)?.componentPropertyAssignments[property]).toBe("");
    editor.undoAction(); expect(ownsSlotContent(editor.graph,slot(instance))).toBe(false); expect(editor.graph.getNode(label.id)?.text).toBe("Default");
    editor.redoAction(); expect(editor.graph.getNode(label.id)?.text).toBe("Personal");
  });
  it("clears and resets an instance without changing its siblings or losing editable content on undo",() => {
    const {main} = component(), instance = editor.graph.createInstance(main.id,editor.state.currentPageId)!, other = editor.graph.createInstance(main.id,editor.state.currentPageId)!;
    editSlot(editor,slot(instance),"clear"); editor.graph.syncInstances(main.id); expect(slot(instance).childIds).toHaveLength(0); expect(slot(other).childIds).toHaveLength(1);
    editSlot(editor,slot(instance),"reset"); expect(slot(instance).childIds).toHaveLength(1); expect(ownsSlotContent(editor.graph,slot(instance))).toBe(false);
    editor.undoAction(); expect(slot(instance).childIds).toHaveLength(0); expect(ownsSlotContent(editor.graph,slot(instance))).toBe(true);
    editor.undoAction(); expect(slot(instance).childIds).toHaveLength(1); expect(ownsSlotContent(editor.graph,slot(instance))).toBe(false);
  });
  it("preserves owned empty slots and ordered content by name across swaps",() => {
    const first = component("First"), second = component("Second"), instance = editor.graph.createInstance(first.main.id,editor.state.currentPageId)!;
    editSlot(editor,slot(instance),"claim"); const content = [...slot(instance).childIds];
    editor.graph.swapInstanceComponent(instance.id,second.main.id); expect(slot(instance).childIds).toEqual(content); expect(instance.componentPropertyAssignments[second.property]).toBe(""); expect(instance.componentPropertyAssignments[first.property]).toBeUndefined();
    editSlot(editor,slot(instance),"clear"); editor.graph.swapInstanceComponent(instance.id,first.main.id); expect(slot(instance).childIds).toHaveLength(0); expect(ownsSlotContent(editor.graph,slot(instance))).toBe(true);
  });
  it("preserves nested owned slots when their enclosing instance changes",() => {
    const inner = component("Inner"), outer = editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Outer"});
    editor.graph.createInstance(inner.main.id,outer.id,{name:"Nested"});
    const replacement = editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Replacement"}); editor.graph.createInstance(inner.main.id,replacement.id,{name:"Nested"});
    const instance = editor.graph.createInstance(outer.id,editor.state.currentPageId)!, nested = editor.graph.getNode(instance.childIds[0]!)!;
    editSlot(editor,slot(nested),"claim"); const ids = [...slot(nested).childIds];editor.graph.updateNode(ids[0]!,{text:'Nested personal'});
    editor.graph.syncInstances(outer.id);expect(editor.graph.getNode(ids[0]!)?.text).toBe('Nested personal');
    expect(instance.instanceOverrides.descendants.get(slot(nested).id)?.has('componentId')).toBeFalsy();
    editor.graph.swapInstanceComponent(instance.id,replacement.id);
    const rebuilt = editor.graph.getNode(instance.childIds[0]!)!; expect(slot(rebuilt).childIds).toEqual(ids); expect(ownsSlotContent(editor.graph,slot(rebuilt))).toBe(true);
  });
  it("groups delete and duplicate with ownership changes in a single reversible edit",() => {
    const {main} = component(), instance = editor.graph.createInstance(main.id,editor.state.currentPageId)!, frame = slot(instance), id = frame.childIds[0]!;
    editor.select([id]); editor.duplicateSelected(); expect(frame.childIds).toHaveLength(2); expect(ownsSlotContent(editor.graph,frame)).toBe(true);
    editor.undoAction(); expect(frame.childIds).toHaveLength(1); expect(ownsSlotContent(editor.graph,frame)).toBe(false);
    editor.select([id]); editor.deleteSelected(); expect(frame.childIds).toHaveLength(0); expect(ownsSlotContent(editor.graph,frame)).toBe(true);
    editor.undoAction(); expect(frame.childIds).toEqual([id]); expect(ownsSlotContent(editor.graph,frame)).toBe(false);
  });
  it('restores content lost to a variant without the slot in a single undo',()=>{
    const graph=editor.graph,set=graph.createNode('COMPONENT_SET',editor.state.currentPageId,{name:'Cards'});
    const first=component('With content');graph.reorderChild(first.main.id,set.id,0);graph.updateNode(first.main.id,{componentPropertyValues:{State:'With'}});
    const second=graph.createNode('COMPONENT',set.id,{name:'Without content',componentPropertyValues:{State:'Without'}});
    editor.addPropertyDefinition(set.id,'State','VARIANT','With');graph.updateNode(first.main.id,{componentPropertyValues:{State:'With'}});graph.updateNode(second.id,{componentPropertyValues:{State:'Without'}});
    const instance=graph.createInstance(first.main.id,editor.state.currentPageId)!;editSlot(editor,slot(instance),'claim');const id=slot(instance).childIds[0]!;graph.updateNode(id,{text:'Retained on undo'});
    expect(editor.switchInstanceVariant(instance.id,'State','Without').kind).toBe('changed');expect(instance.componentId).toBe(second.id);expect(graph.getNode(id)).toBeUndefined();
    editor.undoAction();expect(graph.getNode(id)?.text).toBe('Retained on undo');expect(ownsSlotContent(graph,slot(instance))).toBe(true);
    editor.redoAction();expect(graph.getNode(id)).toBeUndefined();
  });
  it("validates preferred components and child limits, stretches insertions and reports imported violations",() => {
    const {main,frame,property} = component(), icon = editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Icon"}), other = editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Other"});
    updateSlot(editor,main,property,{preferredValues:[icon.id],slotSettings:{minChildren:1,maxChildren:2,allowPreferredValuesOnly:true,stretchChildOnInsert:true}});
    const instance = editor.graph.createInstance(main.id,editor.state.currentPageId)!;
    expect(slotViolations(editor.graph,slot(instance))).toContain("Contains a layer outside the preferred components.");
    editSlot(editor,slot(instance),"clear"); expect(slotViolations(editor.graph,slot(instance))).toContain("Requires at least 1 layers.");
    expect(() => addSlotComponent(editor,slot(instance),other.id)).toThrow("preferred");
    addSlotComponent(editor,slot(instance),icon.id); expect(editor.graph.getNode(slot(instance).childIds[0]!)?.layoutAlignSelf).toBe("STRETCH");
    addSlotComponent(editor,slot(instance),icon.id); expect(() => addSlotComponent(editor,slot(instance),icon.id)).toThrow("maximum");
    expect(() => updateSlot(editor,main,property,{slotSettings:{minChildren:3,maxChildren:2}})).toThrow("minimum");
    editor.graph.updateNode(frame.id,{locked:true}); expect(() => removeSlot(editor,frame)).toThrow("Unlock");
  });
  it("removes a binding and restores definition and owned content with undo",() => {
    const {main,frame,property} = component(), instance = editor.graph.createInstance(main.id,editor.state.currentPageId)!;
    editSlot(editor,slot(instance),"clear"); removeSlot(editor,frame); expect(slotDefinitions(editor.graph,instance)).toHaveLength(0); expect(instance.componentPropertyAssignments[property]).toBeUndefined();
    const reopened = deserializeGraph(serializeGraph(editor.graph)); expect(slotDefinitions(reopened,reopened.getNode(instance.id)!)).toHaveLength(0);
    editor.undoAction(); expect(slot(instance).childIds).toHaveLength(0); expect(ownsSlotContent(editor.graph,slot(instance))).toBe(true);
  });
});
