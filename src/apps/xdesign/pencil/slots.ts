import type { Editor } from "@open-pencil/core/editor";
import { resolveComponentPropertyValue, type SceneNode } from "@open-pencil/scene-graph";
import { ulid } from "ulid";
import { editPencilGraph } from "./toolExecution";
import { assertEditable, isSlotDefinition, nativeDefinitions, slotOwner, slotPropertyId, instanceSlotFrames, resetSlot, defaultSlotSettings, slotDefinitions, nearestSlotInstance, mainSlotComponent, claimSlotContent, type SlotDefinition, type SlotSettings } from "./slotGraph";
export * from "./slotGraph";

export function createSlot(editor: Editor, frame: SceneNode): string {
  const graph = editor.graph, owner = slotOwner(graph, frame);
  if (frame.type !== "FRAME" || slotPropertyId(frame) || !owner) throw new Error("Choose an ordinary frame inside a main component.");
  assertEditable(graph, frame);
  if (owner.componentPropertyDefinitions.length >= 512) throw new Error("This component's property limit has been reached.");
  const base = frame.name.trim() || "Content", taken = new Set(owner.componentPropertyDefinitions.map(def => def.name));
  let name = base, suffix = 2; while (taken.has(name)) name = `${base} ${suffix++}`;
  const id = `prop:${ulid()}`;
  editPencilGraph(editor, "Create component slot", () => {
    graph.updateNode(owner.id, { componentPropertyDefinitions: nativeDefinitions([...owner.componentPropertyDefinitions, { id, name, type: "SLOT", defaultValue: "", preferredValues: [], slotSettings: { ...defaultSlotSettings } }]) });
    graph.updateNode(frame.id, { componentPropertyReferences: [...frame.componentPropertyReferences, { field: "SLOT_CONTENT", propertyId: id }] as SceneNode["componentPropertyReferences"] });
    graph.syncInstances(owner.id);
  });
  return id;
}
export function updateSlot(editor: Editor, owner: SceneNode, propertyId: string, patch: { name?: string; preferredValues?: string[]; slotSettings?: Partial<SlotSettings> }) {
  assertEditable(editor.graph, owner);
  const definition = owner.componentPropertyDefinitions.find(def => def.id === propertyId && isSlotDefinition(def)) as SlotDefinition | undefined;
  if (!definition) throw new Error("The slot definition is no longer available.");
  const name = (patch.name ?? definition.name).trim(), settings = { ...defaultSlotSettings, ...definition.slotSettings, ...patch.slotSettings }, preferred = patch.preferredValues ?? definition.preferredValues ?? [];
  if (!name || name.length > 256 || owner.componentPropertyDefinitions.some(def => def.id !== propertyId && def.name === name)) throw new Error("Enter a unique slot name up to 256 characters.");
  for (const value of [settings.minChildren, settings.maxChildren]) if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 10_000)) throw new Error("Slot limits must be whole numbers between 0 and 10,000.");
  if ((settings.minChildren ?? 0) > (settings.maxChildren ?? Infinity)) throw new Error("The minimum cannot exceed the maximum.");
  if (preferred.length > 256 || new Set(preferred).size !== preferred.length || preferred.some(value => !resolveComponentPropertyValue(editor.graph, value) && !definition.preferredValues?.includes(value))) throw new Error("Choose up to 256 distinct existing components.");
  editPencilGraph(editor, "Change slot settings", () => {
    editor.graph.updateNode(owner.id, { componentPropertyDefinitions: nativeDefinitions(owner.componentPropertyDefinitions.map(def => def.id === propertyId ? { ...definition, name, preferredValues: [...preferred], slotSettings: settings } : def)) });
    editor.graph.syncInstances(owner.id);
  });
}
export function removeSlot(editor: Editor, frame: SceneNode) {
  const graph = editor.graph, owner = slotOwner(graph, frame), propertyId = slotPropertyId(frame);
  if (!owner || !propertyId) throw new Error("Choose a slot in the main component.");
  assertEditable(graph, frame);
  editPencilGraph(editor, "Remove component slot", () => {
    // Rejoin definition content before removing the binding; discard no parked layers.
    for (const instance of graph.getInstances(owner.id)) for (const slot of instanceSlotFrames(graph, instance)) if (slotPropertyId(slot) === propertyId) resetSlot(graph, slot);
    graph.updateNode(owner.id, { componentPropertyDefinitions: owner.componentPropertyDefinitions.filter(def => def.id !== propertyId) });
    graph.updateNode(frame.id, { componentPropertyReferences: frame.componentPropertyReferences.filter(ref => ref.propertyId !== propertyId) });
    graph.syncInstances(owner.id);
  });
}
export function editSlot(editor: Editor, frame: SceneNode, action: "claim" | "clear" | "reset") {
  assertEditable(editor.graph, frame);
  editPencilGraph(editor, action === "reset" ? "Reset slot content" : action === "clear" ? "Clear slot content" : "Edit slot content", () => {
    if (action === "reset") resetSlot(editor.graph, frame);
    else { claimSlotContent(editor.graph, frame); if (action === "clear") for (const id of [...frame.childIds]) editor.graph.deleteNode(id); }
  });
}
export function addSlotComponent(editor: Editor, frame: SceneNode, componentId: string) {
  assertEditable(editor.graph, frame);
  const instance = nearestSlotInstance(editor.graph, frame), definition = instance && slotDefinitions(editor.graph, instance).find(def => def.id === slotPropertyId(frame));
  const component = editor.graph.getNode(componentId);
  if (!definition || component?.type !== "COMPONENT") throw new Error("Choose an existing component for this slot.");
  const settings = { ...defaultSlotSettings, ...definition.slotSettings };
  if (frame.childIds.length >= (settings.maxChildren ?? Infinity)) throw new Error("This slot has reached its maximum number of layers.");
  if (settings.allowPreferredValuesOnly && !definition.preferredValues?.some(value => resolveComponentPropertyValue(editor.graph, value)?.id === componentId)) throw new Error("Choose one of the slot's preferred components.");
  if (componentId === mainSlotComponent(editor.graph, instance!)?.id || editor.graph.isDescendant(frame.id, componentId)) throw new Error("A component cannot contain itself in its slot.");
  editPencilGraph(editor, "Add component to slot", () => {
    claimSlotContent(editor.graph, frame);
    const child = editor.graph.createInstance(componentId, frame.id, settings.stretchChildOnInsert ? { width: frame.width, layoutAlignSelf: "STRETCH" } : {});
    if (!child) throw new Error("The component could not be added.");
  });
}
