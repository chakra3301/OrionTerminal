import { effectiveFigmaRawNodeFields, parseFigBuffer } from "@open-pencil/fig";
import type { GUID, NodeChange } from "@open-pencil/kiwi/fig/codec";
import type { ComponentPropertyDefinition, SceneGraph, SceneNode } from "@open-pencil/scene-graph";
import { getInstanceOverride } from "@open-pencil/scene-graph";
import { cloneSlotChildren, containingSlot, installSlotSupport, instanceSlotFrames, isSlotDefinition, nearestSlotInstance, ownsSlotContent, slotPropertyId, defaultSlotSettings, type SlotDefinition } from "./slots";
import { readBehaviour,renameBehaviourProperties } from './behaviour/model';
import { encodeFigArchive } from './figArchive';
import { parseFigCompatible } from './figImport';

const markerPlugin = "orion.xdesign.slot-export";
const guidKey = (guid: GUID) => `${guid.sessionID}:${guid.localID}`;
type AnyRecord = Record<string, any>; // Kiwi's published types omit the already-present slot schema.
/** Recover native slot types and bindings rather than treating them as variants. */
export function recoverFigSlotDefinitions(graph: SceneGraph) {
  for (const node of graph.nodes.values()) {
    const raw = effectiveFigmaRawNodeFields(node) as AnyRecord;
    for (const definition of raw.componentPropDefs ?? []) {
      if (definition.type !== "SLOT" || !definition.id) continue;
      const id = guidKey(definition.id);
      // Authored local edits are authoritative when reopening an Orion project.
      const existing = node.componentPropertyDefinitions.find(def => def.id === id);
      if (existing && isSlotDefinition(existing)) continue;
      const config = definition.slotPropConfig ?? {}, preferredValues = (definition.preferredValues?.instanceSwapValues ?? []).flatMap((value: AnyRecord) => typeof value.key === 'string' ? [value.key] : []);
      const slot: SlotDefinition = { id, name: definition.name ?? "Content", type: "SLOT", defaultValue: "", preferredValues, slotSettings: { ...defaultSlotSettings, allowPreferredValuesOnly: config.allowPreferredValuesOnly ?? false, displayEmptyByDefault: config.displayByDefault ?? false, stretchChildOnInsert: config.stretchChildOnInsert ?? false, ...(config.minChildren !== undefined ? { minChildren: config.minChildren } : {}), ...(config.maxChildren !== undefined ? { maxChildren: config.maxChildren } : {}) } };
      node.componentPropertyDefinitions = [...node.componentPropertyDefinitions.filter(def => def.id !== id), slot as unknown as ComponentPropertyDefinition];
    }
    for (const entry of raw.parameterConsumptionMap?.entries ?? []) {
      if (entry.variableField !== "SLOT_CONTENT_ID" && entry.nodeField !== 4) continue;
      const id = entry.variableData?.value?.propRefValue?.defId;
      if (!id || slotPropertyId(node)) continue;
      node.componentPropertyReferences=[...node.componentPropertyReferences,{ field: "SLOT_CONTENT", propertyId: guidKey(id) } as unknown as SceneNode["componentPropertyReferences"][number]];
    }
  }
  // Variant slot records can be aliases containing only id + parentPropDefId.
  // Resolve the shared set definition while retaining the variant's local id.
  const slotsById=new Map([...graph.nodes.values()].flatMap(node=>node.componentPropertyDefinitions.filter(isSlotDefinition).map(def=>[def.id,def as unknown as SlotDefinition] as const)));
  for(const node of graph.nodes.values())for(const raw of (effectiveFigmaRawNodeFields(node).componentPropDefs??[]) as AnyRecord[]){
    if(!raw.id||!raw.parentPropDefId)continue;
    const inherited=slotsById.get(guidKey(raw.parentPropDefId)),id=guidKey(raw.id);
    if(!inherited||node.componentPropertyDefinitions.some(def=>def.id===id&&isSlotDefinition(def)))continue;
    const definition={...structuredClone(inherited),id};
    node.componentPropertyDefinitions=[...node.componentPropertyDefinitions.filter(def=>def.id!==id),definition as unknown as ComponentPropertyDefinition];
    slotsById.set(id,definition);
  }
  // Preferred choices imported as GUIDs need the same local identity remap as swaps.
  const sourceIds = new Map([...graph.nodes.values()].filter(node => node.source.id).map(node => [node.source.id!,node.id]));
  for (const node of graph.nodes.values()) for (const def of node.componentPropertyDefinitions) if (isSlotDefinition(def) && def.preferredValues) def.preferredValues = def.preferredValues.map(value => sourceIds.get(value) ?? [...graph.nodes.values()].find(node => node.type === 'COMPONENT' && (node.componentKey === value || node.sourceLibraryKey === value))?.id ?? value);
}

/** The old importer omits detached content records that have no canvas parent.
 * Make those resources reachable, import with the worker, then materialize each
 * assigned slot. The original schema and all opaque node fields are retained. */
export async function parseFigWithSlots(buffer: ArrayBuffer): Promise<SceneGraph> {
  // Most files have no slots. Let the worker decode them once; an eager protocol
  // decode here would duplicate a large archive and block the UI thread.
  const imported=await parseFigCompatible(buffer);
  const hasSlots=[...imported.nodes.values()].some(node=>(effectiveFigmaRawNodeFields(node).componentPropDefs as AnyRecord[]|undefined)?.some(def=>def.type==="SLOT"));
  if(!hasSlots)return imported;
  const parsed = parseFigBuffer(buffer);
  const contents = parsed.nodeChanges.filter(node => node.isSlotContent && node.guid);
  if (contents.length) {
    const doc = parsed.nodeChanges.find(node => node.type === "DOCUMENT");
    if (!doc?.guid) throw new Error("The slot document has no root.");
    const used = new Set(parsed.nodeChanges.flatMap(node => node.guid ? [guidKey(node.guid)] : []));
    let localID = 1; while (used.has(`4294967294:${localID}`)) localID++;
    const guid = { sessionID: 4294967294, localID };
    parsed.nodeChanges.push({ type: "CANVAS", guid, phase: "CREATED", name: "Slot content resources", parentIndex: { guid: doc.guid, position: '~' }, internalOnly: true });
    contents.forEach((node,index) => { node.parentIndex = { guid, position: String.fromCharCode(33 + index % 90) + String(index).padStart(8,'0') }; });
  }
  const prepared = encodeFigArchive(parsed);
  const graph = await parseFigCompatible(prepared.buffer.slice(prepared.byteOffset, prepared.byteOffset + prepared.byteLength) as ArrayBuffer);
  recoverFigSlotDefinitions(graph); installSlotSupport(graph);
  const resources = new Map([...graph.nodes.values()].filter(node => node.source.id).map(node => [node.source.id!,node]));
  const done = new Set<string>(), visiting = new Set<string>();
  const overrideTarget = (root: SceneNode, guids: GUID[]): SceneNode | undefined => {
    let current: SceneNode | undefined = root;
    for (const guid of guids) {
      const key=guidKey(guid),pending:string[]=[...current?.childIds ?? []]; let found:SceneNode|undefined;
      while(pending.length){
        const child=graph.getNode(pending.pop()!);if(!child)continue;
        const mapped=getInstanceOverride(root.instanceOverrides,root.id,child.id,'sourceComponentId'),source=graph.getNode(typeof mapped==='string'?mapped:child.componentId??'');
        if(child.source.id===key||source?.source.id===key){found=child;break;}
        if(child.type!=='INSTANCE')pending.push(...child.childIds);
      }
      current=found;if(!current)return;
    }
    return current;
  };
  const applyAssignments = (instance: SceneNode, assignments: AnyRecord[]) => {
    for (const assignment of assignments) {
      const contentGuid = assignment.varValue?.value?.slotContentIdValue?.guid;
      if (!contentGuid || !assignment.defID) continue;
      const property = guidKey(assignment.defID), frame = instanceSlotFrames(graph,instance).find(frame => slotPropertyId(frame) === property), source = resources.get(guidKey(contentGuid));
      if (!frame) throw new Error(`An assigned slot is missing from ${instance.name}.`);
      if (!source && contentGuid.sessionID === 0xffffffff && contentGuid.localID === 0xffffffff) continue;
      if (!source) throw new Error(`The contents of ${instance.name}'s slot are missing.`);
      const pending = [...source.childIds];
      while (pending.length) { const child = graph.getNode(pending.pop()!); if (!child) continue; if (child.type === "INSTANCE") apply(child); pending.push(...child.childIds); }
      for (const id of [...frame.childIds]) graph.deleteNode(id);
      // Slot overrides carry the content frame's own layout and fitted bounds.
      graph.updateNode(frame.id, { width: source.width, height: source.height, layoutMode: source.layoutMode, itemSpacing: source.itemSpacing, counterAxisSpacing: source.counterAxisSpacing, primaryAxisSizing: source.primaryAxisSizing, counterAxisSizing: source.counterAxisSizing, paddingTop: source.paddingTop, paddingRight: source.paddingRight, paddingBottom: source.paddingBottom, paddingLeft: source.paddingLeft });
      cloneSlotChildren(graph,source,frame,false);
      graph.updateNode(instance.id, { componentPropertyAssignments: { ...instance.componentPropertyAssignments, [property]: "" } });
    }
  };
  const apply = (instance: SceneNode) => {
    if (done.has(instance.id)) return;
    if (visiting.has(instance.id)) throw new Error('Slot content contains a circular instance assignment.');
    visiting.add(instance.id);
    const raw = instance.source.fig.rawNodeFields as AnyRecord;
    for(const override of instance.source.fig.symbolOverrides as AnyRecord[])if(override.componentPropAssignments?.some((assignment:AnyRecord)=>assignment.varValue?.value?.slotContentIdValue)){
      const target=overrideTarget(instance,override.guidPath?.guids??[]);
      if(target?.type!=='INSTANCE')throw new Error(`A nested slot override is missing from ${instance.name}.`);
      applyAssignments(target,override.componentPropAssignments);
    }
    applyAssignments(instance,raw.componentPropAssignments??[]);
    visiting.delete(instance.id); done.add(instance.id);
  };
  for (const instance of [...graph.nodes.values()]) if (instance.type === "INSTANCE") apply(instance);
  // Resources have been materialized; do not let stale raw assignments overwrite
  // future edits when this Orion document is opened again.
  for (const source of contents) { const resource = source.guid && resources.get(guidKey(source.guid)); if (resource && graph.getNode(resource.id)) graph.deleteNode(resource.id); }
  return graph;
}

type ExportedSlot = { frameId: string; ownerId: string; propertyId: string; path: string[] };
/** Mutates the caller's export clone. Native slot contents live as resource frames
 * on an internal canvas and are referenced by SLOT_CONTENT_ID assignments. */
export function prepareFigSlots(graph: SceneGraph): ((bytes: Uint8Array) => Uint8Array) | null {
  const definitions = [...graph.nodes.values()].flatMap(node => node.componentPropertyDefinitions.filter(isSlotDefinition).map(def => ({ node, def: def as unknown as SlotDefinition })));
  const behaviours=[...graph.nodes.values()].flatMap(node=>{const behaviour=readBehaviour(node);return behaviour?[{node,behaviour}]:[];});
  if (!definitions.length&&!behaviours.length) return null;
  const mark = (node: SceneNode) => { graph.updateNode(node.id,{pluginData:[...node.pluginData.filter(entry=>entry.pluginId!==markerPlugin),{ pluginId: markerPlugin, key: "id", value: node.id }]}); };
  for (const {node} of definitions) mark(node);
  if(behaviours.length)for(const node of graph.nodes.values())if(node.componentPropertyDefinitions.length||readBehaviour(node))mark(node);
  for (const {def} of definitions) for (const value of def.preferredValues ?? []) {
    const component = [...graph.nodes.values()].find(node => node.id === value || node.componentKey === value || node.sourceLibraryKey === value);
    if (component) { mark(component); if (!component.componentKey && !component.sourceLibraryKey) graph.updateNode(component.id,{componentKey:`orion.xdesign.slot:${component.id}`}); }
  }
  for (const node of graph.nodes.values()) if (slotPropertyId(node)) mark(node);
  const slots: ExportedSlot[] = [];
  for (const frame of [...graph.nodes.values()]) {
    if (!ownsSlotContent(graph,frame)) continue;
    let owner = nearestSlotInstance(graph,frame)!;
    const path: string[] = [];
    let parent = nearestSlotInstance(graph,owner);
    while (parent) {
      const content=containingSlot(graph,owner);
      // An instance placed in owned content is serialized with that resource,
      // independently of the component that contains the resource's slot.
      if(content&&ownsSlotContent(graph,content))break;
      const mapped = getInstanceOverride(parent.instanceOverrides,parent.id,owner.id,"sourceComponentId"), source = graph.getNode(typeof mapped === "string" ? mapped : owner.componentId ?? '');
      if (source?.type !== "INSTANCE") throw new Error("A nested slot has no portable component identity.");
      mark(source); path.unshift(source.id); owner = parent; parent = nearestSlotInstance(graph,owner);
    }
    mark(owner); mark(frame);
    slots.push({ frameId: frame.id, ownerId: owner.id, propertyId: slotPropertyId(frame)!, path });
  }
  if (slots.length) {
    const page = graph.getPages(true).find(page => page.internalOnly) ?? graph.addPage("Internal slot content"); page.internalOnly = true;
    // Move descendants first so independently owned nested slots become separate resources.
    for (const slot of [...slots].reverse()) {
      const frame = graph.getNode(slot.frameId)!;
      graph.reorderChild(frame.id,page.id,page.childIds.length);
      graph.updateNode(frame.id,{ componentId: null, componentPropertyReferences: frame.componentPropertyReferences.filter(ref => String(ref.field) !== "SLOT_CONTENT") });
    }
  }
  return bytes => {
    const parsed = parseFigBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset + bytes.byteLength) as ArrayBuffer), records = new Map<string,NodeChange>(), propertyGuids = new Map<string,GUID>();
    for (const record of parsed.nodeChanges) for (const entry of record.pluginData ?? []) if (entry.pluginID === markerPlugin && entry.key === "id") records.set(entry.value,record);
    if(behaviours.length)for(const node of graph.nodes.values())for(const definition of node.componentPropertyDefinitions){const native=(records.get(node.id)?.componentPropDefs as AnyRecord[]|undefined)?.find(property=>property.name===definition.name||property.id&&guidKey(property.id)===definition.id);if(native?.id)propertyGuids.set(definition.id,native.id);}
    for (const {node,def} of definitions) {
      const record = records.get(node.id), native = (record?.componentPropDefs as AnyRecord[] | undefined)?.find(property => property.name === def.name || property.id && guidKey(property.id)===def.id);
      if (!native?.id) throw new Error(`The exported slot ${node.name} / ${def.name} has no property identity.`);
      propertyGuids.set(def.id,native.id); native.type = "SLOT";native.name=def.name;
      native.varValue = slotValue({ sessionID: 0xffffffff, localID: 0xffffffff }); delete native.initialValue;
      const settings = { ...defaultSlotSettings,...def.slotSettings };
      native.slotPropConfig = { stretchChildOnInsert: settings.stretchChildOnInsert, displayByDefault: settings.displayEmptyByDefault, allowPreferredValuesOnly: settings.allowPreferredValuesOnly, ...(settings.minChildren !== undefined ? { minChildren: settings.minChildren } : {}), ...(settings.maxChildren !== undefined ? { maxChildren: settings.maxChildren } : {}) };
      // Resolve exported component GUIDs, including locally authored preferred components.
      native.preferredValues = { instanceSwapValues: (def.preferredValues ?? []).map(value => { const target = [...graph.nodes.values()].find(node => node.id === value || node.componentKey === value || node.sourceLibraryKey === value); return {type:'COMPONENT',key:target?.componentKey || target?.sourceLibraryKey || value}; }) };
    }
    for(const {node,def} of definitions){
      const alias=((effectiveFigmaRawNodeFields(node).componentPropDefs??[]) as AnyRecord[]).find(raw=>raw.id&&guidKey(raw.id)===def.id&&raw.parentPropDefId);
      if(!alias)continue;
      const parent=propertyGuids.get(guidKey(alias.parentPropDefId)),record=records.get(node.id),native=(record?.componentPropDefs as AnyRecord[]|undefined)?.find(property=>property.name===def.name);
      if(parent&&native)native.parentPropDefId=parent;
    }
    for (const node of graph.nodes.values()) {
      const property = slotPropertyId(node), record = records.get(node.id), guid = property && propertyGuids.get(property);
      if (!record || !guid) continue;
      // Figma slots use parameter bindings rather than legacy component refs.
      record.componentPropRefs = ((record.componentPropRefs ?? []) as AnyRecord[]).filter(ref => !ref.defID || guidKey(ref.defID) !== guidKey(guid));
      const map = (record.parameterConsumptionMap ?? { entries: [] }) as AnyRecord;
      map.entries = [...map.entries.filter((entry: AnyRecord) => !entry.variableData?.value?.propRefValue?.defId || guidKey(entry.variableData.value.propRefValue.defId) !== guidKey(guid)), { variableField: "SLOT_CONTENT_ID", variableData: { value: { propRefValue: { defId: guid } }, dataType: "PROP_REF", resolvedDataType: "SLOT_CONTENT_ID" } }];
      record.parameterConsumptionMap = map;
    }
    for (const slot of slots) {
      const frame = records.get(slot.frameId), owner = records.get(slot.ownerId), property = propertyGuids.get(slot.propertyId);
      if (!frame?.guid || !owner || !property) throw new Error(`Owned slot content could not be exported: ${graph.getNode(slot.ownerId)?.name ?? slot.ownerId} / ${graph.getNode(slot.frameId)?.name ?? slot.frameId} (${!frame?.guid?'content frame':!owner?'instance':'property'} missing).`);
      frame.isSlotContent = true;
      const map = frame.parameterConsumptionMap as AnyRecord | undefined;
      if (map) map.entries = map.entries.filter((entry: AnyRecord) => entry.variableField !== "SLOT_CONTENT_ID" && entry.variableData?.resolvedDataType !== "SLOT_CONTENT_ID");
      frame.componentPropRefs = [];
      const assignment = { defID: property, varValue: slotValue(frame.guid) };
      let target: AnyRecord = owner;
      if (slot.path.length) {
        const guids = slot.path.map(id => records.get(id)?.guid); if (guids.some(guid => !guid)) throw new Error("A nested slot override could not be exported.");
        const symbolData=owner.symbolData as AnyRecord|undefined;
        if(!symbolData?.symbolID)throw new Error('A nested slot override has no exported main component.');
        const overrides = (symbolData.symbolOverrides ?? []) as AnyRecord[];
        target = overrides.find(override => JSON.stringify(override.guidPath?.guids) === JSON.stringify(guids)) ?? { guidPath: { guids } };
        if (!overrides.includes(target)) overrides.push(target); symbolData.symbolOverrides = overrides;owner.symbolData=symbolData as NodeChange['symbolData'];
      }
      target.componentPropAssignments = [...(target.componentPropAssignments ?? []).filter((value: AnyRecord) => value.defID && guidKey(value.defID) !== guidKey(property)),assignment];
    }
    for(const {node,behaviour} of behaviours){const record=records.get(node.id);if(!record)throw new Error('An interactive component could not be exported.');const mapped=renameBehaviourProperties(behaviour,id=>{const guid=propertyGuids.get(id);if(!guid)throw new Error('An interactive component binding could not be exported.');return guidKey(guid);});record.pluginData=[...(record.pluginData??[]).filter(entry=>!(entry.pluginID==='open-pencil'&&entry.key==='behaviour')),{pluginID:'open-pencil',key:'behaviour',value:JSON.stringify(mapped)}];}
    for (const record of parsed.nodeChanges) record.pluginData = record.pluginData?.filter(entry => entry.pluginID !== markerPlugin);
    return encodeFigArchive(parsed);
  };
}
function slotValue(guid: GUID) { return { value: { slotContentIdValue: { guid } }, dataType: "SLOT_CONTENT_ID", resolvedDataType: "SLOT_CONTENT_ID" }; }
