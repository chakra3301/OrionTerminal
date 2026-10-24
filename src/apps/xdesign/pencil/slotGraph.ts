import { getInstanceOverride, setInstanceOverride, resolveComponentPropertyValue, type SceneGraph, type SceneNode, type ComponentPropertyDefinition } from "@open-pencil/scene-graph";
import { cloneNodeProps } from "@open-pencil/scene-graph/copy";


// Slot semantics follow OpenPencil's MIT-licensed slots/{frames,content,authoring}.ts.
// The published 0.15.1 engine predates these fields; keep its type boundary here.
export type SlotSettings = { allowPreferredValuesOnly: boolean; displayEmptyByDefault: boolean; stretchChildOnInsert: boolean; minChildren?: number; maxChildren?: number };
export type SlotDefinition = Omit<ComponentPropertyDefinition, "type"> & { type: "SLOT"; slotSettings?: SlotSettings };
export const defaultSlotSettings: SlotSettings = { allowPreferredValuesOnly: false, displayEmptyByDefault: false, stretchChildOnInsert: false };
export const isSlotDefinition = (def: { type: string }): boolean => def.type === "SLOT";
export const nativeDefinitions = (defs: (ComponentPropertyDefinition | SlotDefinition)[]) => defs as ComponentPropertyDefinition[];
export const slotPropertyId = (node: SceneNode) => node.componentPropertyReferences.find(ref => String(ref.field) === "SLOT_CONTENT")?.propertyId;
export function slotOwner(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current = node.parentId ? graph.getNode(node.parentId) : undefined;
  while (current) { if (current.type === "INSTANCE") return; if (current.type === "COMPONENT") return current; current = current.parentId ? graph.getNode(current.parentId) : undefined; }
}
export function nearestSlotInstance(graph: SceneGraph, frame: SceneNode): SceneNode | undefined {
  let current = frame.parentId ? graph.getNode(frame.parentId) : undefined;
  while (current) { if (current.type === "INSTANCE") return current; current = current.parentId ? graph.getNode(current.parentId) : undefined; }
}
export function mainSlotComponent(graph: SceneGraph, instance: SceneNode): SceneNode | undefined {
  let current = instance.componentId ? graph.getNode(instance.componentId) : undefined;
  const seen = new Set<string>();
  while (current?.type === "INSTANCE" && current.componentId && !seen.has(current.id)) { seen.add(current.id); current = graph.getNode(current.componentId); }
  return current?.type === "COMPONENT" ? current : undefined;
}
export function slotDefinitions(graph: SceneGraph, instance: SceneNode): SlotDefinition[] {
  const main = instance.type === "INSTANCE" ? mainSlotComponent(graph, instance) : instance;
  const set = main?.parentId ? graph.getNode(main.parentId) : undefined;
  return [...main?.componentPropertyDefinitions ?? [], ...set?.componentPropertyDefinitions ?? []].filter(isSlotDefinition) as unknown as SlotDefinition[];
}
export function instanceSlotFrames(graph: SceneGraph, instance: SceneNode): SceneNode[] {
  const frames: SceneNode[] = [], pending = [...instance.childIds].reverse();
  while (pending.length) { const child = graph.getNode(pending.pop()!); if (!child) continue; if (slotPropertyId(child)) frames.push(child); else if (child.type !== "INSTANCE") pending.push(...[...child.childIds].reverse()); }
  return frames;
}
export function ownsSlotContent(graph: SceneGraph, frame: SceneNode): boolean {
  const property = slotPropertyId(frame), owner = nearestSlotInstance(graph, frame);
  return !!property && !!owner && Object.hasOwn(owner.componentPropertyAssignments, property);
}
/** Slot containing an editable layer; stop at nested component boundaries. */
export function containingSlot(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current = node.parentId ? graph.getNode(node.parentId) : undefined;
  while (current) { if (slotPropertyId(current) && nearestSlotInstance(graph, current)) return current; if (current.type === "INSTANCE") return; current = current.parentId ? graph.getNode(current.parentId) : undefined; }
}
function sourceOf(graph: SceneGraph, frame: SceneNode, instance = nearestSlotInstance(graph, frame)) {
  const mapped = instance && getInstanceOverride(instance.instanceOverrides, instance.id, frame.id, "sourceComponentId");
  return graph.getNode(typeof mapped === "string" ? mapped : frame.componentId ?? "");
}
function refreshReferences(graph: SceneGraph) {
  for (const node of graph.nodes.values()) {
    if (!node.componentId || node.type === "INSTANCE") continue;
    const source = sourceOf(graph, node); if (!source) continue;
    // References are definition metadata, not an editable instance override.
    node.componentPropertyReferences = structuredClone(source.componentPropertyReferences);
  }
}
/** Published clones link nested instances to an instance definition. Normalize
 * those links so property and behavior APIs see the actual main component. */
function normalizeInstanceLinks(graph:SceneGraph){
  for(const node of [...graph.nodes.values()]){
    if(node.type!=='INSTANCE'||!node.componentId)continue;
    const source=node.componentId,component=mainSlotComponent(graph,node);
    if(!component||component.id===source)continue;
    const owner=nearestSlotInstance(graph,node);
    if(owner)setInstanceOverride(owner.instanceOverrides,owner.id,node.id,'sourceComponentId',source);
    graph.updateNode(node.id,{componentId:component.id});
  }
}
export function cloneSlotChildren(graph: SceneGraph, source: SceneNode, destination: SceneNode, linked: boolean) {
  for (const child of graph.getChildren(source.id)) {
    const clone = graph.createNode(child.type, destination.id, cloneNodeProps(child, child.type === "INSTANCE" ? null : linked ? child.id : null));
    if (child.type === "INSTANCE" && linked) {
      const owner = nearestSlotInstance(graph, clone);
      if (owner) setInstanceOverride(owner.instanceOverrides, owner.id, clone.id, "sourceComponentId", child.id);
    }
    cloneSlotChildren(graph, child, clone, linked);
  }
}
function descendants(graph: SceneGraph, node: SceneNode, enterInstances: boolean): SceneNode[] {
  const result: SceneNode[] = [], pending = [...node.childIds];
  while (pending.length) { const child = graph.getNode(pending.pop()!); if (!child) continue; result.push(child); if (enterInstances || child.type !== "INSTANCE") pending.push(...child.childIds); }
  return result;
}
export function claimSlotContent(graph: SceneGraph, frame: SceneNode) {
  assertEditable(graph,frame);
  const instance = nearestSlotInstance(graph, frame), propertyId = slotPropertyId(frame);
  if (!instance || !propertyId) throw new Error("Choose a slot inside an instance.");
  if (ownsSlotContent(graph, frame)) return;
  const overrides = instance.instanceOverrides;
  for (const child of descendants(graph, frame, false)) {
    overrides.descendants.delete(child.id);
    if (child.type !== "INSTANCE") graph.updateNode(child.id, { componentId: null });
    else for (const inner of descendants(graph, child, true)) {
      for (const [field, value] of overrides.descendants.get(inner.id) ?? []) if (field !== "sourceComponentId") setInstanceOverride(child.instanceOverrides, child.id, inner.id, field, value);
      overrides.descendants.delete(inner.id);
    }
  }
  graph.updateNode(instance.id, { componentPropertyAssignments: { ...instance.componentPropertyAssignments, [propertyId]: "" }, instanceOverrides: overrides });
}
export function assertEditable(graph: SceneGraph, node: SceneNode) {
  let current: SceneNode | undefined = node;
  while (current) { if (current.locked || current.internalOnly || current.librarySource?.readOnly) throw new Error("Unlock the original component before editing this slot."); current = current.parentId ? graph.getNode(current.parentId) : undefined; }
}
export function resetSlot(graph: SceneGraph, frame: SceneNode) {
  const instance = nearestSlotInstance(graph, frame), propertyId = slotPropertyId(frame);
  if (!instance || !propertyId) throw new Error("Choose an instance slot.");
  const source = sourceOf(graph, frame, instance); if (!source) throw new Error("The main component slot is unavailable.");
  for (const childId of [...frame.childIds]) graph.deleteNode(childId);
  const assignments = { ...instance.componentPropertyAssignments }; delete assignments[propertyId];
  graph.updateNode(instance.id, { componentPropertyAssignments: assignments });
  cloneSlotChildren(graph, source, frame, true);
}
export function slotViolations(graph: SceneGraph, frame: SceneNode): string[] {
  const owner = nearestSlotInstance(graph, frame), definition = owner ? slotDefinitions(graph, owner).find(def => def.id === slotPropertyId(frame)) : slotOwner(graph, frame)?.componentPropertyDefinitions.find(def => def.id === slotPropertyId(frame)) as SlotDefinition | undefined;
  const settings = { ...defaultSlotSettings, ...definition?.slotSettings }, children = graph.getChildren(frame.id), issues: string[] = [];
  if (children.length < (settings.minChildren ?? 0)) issues.push(`Requires at least ${settings.minChildren} layers.`);
  if (children.length > (settings.maxChildren ?? Infinity)) issues.push(`Allows at most ${settings.maxChildren} layers.`);
  if (settings.allowPreferredValuesOnly && children.some(child => !preferredSlotChild(graph, child, definition?.preferredValues ?? []))) issues.push("Contains a layer outside the preferred components.");
  return issues;
}
function preferredSlotChild(graph: SceneGraph, node: SceneNode, values: readonly string[]) {
  const component = mainSlotComponent(graph, node);
  return !!component && values.some(value => resolveComponentPropertyValue(graph, value)?.id === component.id || value === component.componentKey || value === component.sourceLibraryKey);
}

type ParkedSlot = { path: string[]; name: string; content: string[] };
function nestedInstances(graph: SceneGraph, node: SceneNode): SceneNode[] {
  const found: SceneNode[] = [], pending = [...node.childIds];
  while (pending.length) { const child = graph.getNode(pending.pop()!); if (!child || slotPropertyId(child)) continue; if (child.type === "INSTANCE") found.push(child); else pending.push(...child.childIds); }
  return found;
}
function defaultSlots(graph: SceneGraph, instance: SceneNode) {
  for (const frame of instanceSlotFrames(graph, instance)) {
    if (ownsSlotContent(graph, frame)) continue;
    const source = sourceOf(graph, frame);
    if (source?.childIds.length === 0) for (const id of [...frame.childIds]) graph.deleteNode(id);
  }
}
const installed = new WeakSet<SceneGraph>();
/** Extend only this graph. Transient sync guards are never persisted as overrides. */
export function installSlotSupport(graph: SceneGraph) {
  if (installed.has(graph)) return;
  installed.add(graph);
  const sync = graph.syncInstances.bind(graph), swap = graph.swapInstanceComponent.bind(graph), create = graph.createInstance.bind(graph);
  graph.syncInstances = componentId => {
    refreshReferences(graph);
    const protectedFields: { instance: SceneNode; frame: SceneNode; had: boolean; value: unknown }[] = [];
    for (const frame of graph.nodes.values()) if (ownsSlotContent(graph, frame)) {
      let instance = nearestSlotInstance(graph, frame);
      // The published synchronizer uses the outer instance's override map even
      // while recursing through an inner instance. Guard every applicable map.
      while(instance){
        const fields = instance.instanceOverrides.descendants.get(frame.id);
        protectedFields.push({ instance, frame, had: fields?.has("componentId") ?? false, value: fields?.get("componentId") });
        setInstanceOverride(instance.instanceOverrides, instance.id, frame.id, "componentId", true);
        instance=nearestSlotInstance(graph,instance);
      }
    }
    try { sync(componentId); }
    finally {
      for (const { instance, frame, had, value } of protectedFields) {
        const fields = instance.instanceOverrides.descendants.get(frame.id);
        if (had) fields?.set("componentId", value); else { fields?.delete("componentId"); if (!fields?.size) instance.instanceOverrides.descendants.delete(frame.id); }
      }
      normalizeInstanceLinks(graph);refreshReferences(graph);
    }
    for (const instance of graph.nodes.values()) if (instance.type === "INSTANCE") defaultSlots(graph, instance);
  };
  graph.createInstance = (...args) => { const instance = create(...args); if (instance) { normalizeInstanceLinks(graph); refreshReferences(graph); defaultSlots(graph, instance); } return instance; };
  graph.swapInstanceComponent = (id, componentId) => {
    const instance = graph.getNode(id), target = graph.getNode(componentId);
    if (instance?.type !== "INSTANCE" || target?.type !== "COMPONENT") { swap(id, componentId); return; }
    const parked: ParkedSlot[] = [], ownedProperties: string[] = [];
    const visit = (owner: SceneNode, path: string[]) => {
      for (const child of nestedInstances(graph, owner)) visit(child, [...path, child.name]);
      for (const frame of instanceSlotFrames(graph, owner)) {
        const propertyId = slotPropertyId(frame)!;
        if (!ownsSlotContent(graph, frame)) continue;
        if (owner.id === id) ownedProperties.push(propertyId);
        const name = slotDefinitions(graph, owner).find(def => def.id === propertyId)?.name;
        if (!name) continue;
        // Reject ambiguous names rather than silently choosing the wrong content.
        if (parked.some(slot => slot.name === name && JSON.stringify(slot.path) === JSON.stringify(path))) throw new Error("Rename duplicate nested instances before changing this component.");
        const content = [...frame.childIds];
        parked.push({ path, name, content });
      }
    };
    visit(instance, []);
    for (const slot of parked) for (const childId of slot.content) graph.reorderChild(childId, graph.rootId, graph.getNode(graph.rootId)!.childIds.length);
    swap(id, componentId); normalizeInstanceLinks(graph);refreshReferences(graph);
    const assignments = { ...instance.componentPropertyAssignments }; for (const property of ownedProperties) delete assignments[property]; graph.updateNode(id, { componentPropertyAssignments: assignments });
    for (const slot of parked) {
      let owner: SceneNode | undefined = instance;
      for (const name of slot.path) { const matches: SceneNode[] = owner ? nestedInstances(graph, owner).filter(child => child.name === name) : []; owner = matches.length === 1 ? matches[0] : undefined; }
      const frames = owner ? instanceSlotFrames(graph, owner).filter(frame => slotDefinitions(graph, owner!).find(def => def.id === slotPropertyId(frame))?.name === slot.name) : [];
      const frame = frames.length === 1 ? frames[0] : undefined;
      if (!owner || !frame) { for (const childId of slot.content) graph.deleteNode(childId); continue; }
      for (const childId of [...frame.childIds]) graph.deleteNode(childId);
      for (const [index, childId] of slot.content.entries()) graph.reorderChild(childId, frame.id, index);
      graph.updateNode(owner.id, { componentPropertyAssignments: { ...owner.componentPropertyAssignments, [slotPropertyId(frame)!]: "" } });
    }
    defaultSlots(graph, instance);
  };
  normalizeInstanceLinks(graph);refreshReferences(graph);
}
