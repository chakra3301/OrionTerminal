import { cloneInstanceOverrideState, createInstanceOverrideState, setInstanceOverride, type SceneGraph, type SceneNode } from "@open-pencil/scene-graph";
import { findInstanceAncestor } from "@open-pencil/scene-graph/instances";

export function normalizeLibraryNestedInstances(graph: SceneGraph, rootId: string) {
  const pending=[...graph.getNode(rootId)?.childIds??[]];
  while(pending.length) {
    const node=graph.getNode(pending.pop()!)!; pending.push(...node.childIds);
    // Internal definition locks must not lock editable instance descendants.
    const locked=node.pluginData.find(p=>p.pluginId==="orion.xdesign"&&p.key==="librarySourceLocked")?.value==="true";
    graph.updateNode(node.id,{locked,librarySource:null});
    if(node.type!=="INSTANCE"||!node.componentId)continue;
    const sourceId=node.componentId;let component=graph.getNode(sourceId);const visited=new Set<string>();
    while(component?.type==="INSTANCE"&&component.componentId) {if(visited.has(component.id))throw new Error("A nested library instance has a circular component reference");visited.add(component.id);component=graph.getNode(component.componentId);}
    if(component?.type==="COMPONENT"&&component.id!==sourceId) {
      const parent=node.parentId?findInstanceAncestor(graph,node.parentId):null;
      if(parent)setInstanceOverride(parent.instanceOverrides,parent.id,node.id,"sourceComponentId",sourceId);
      graph.updateNode(node.id,{componentId:component.id});
    }
  }
}

function descendantPaths(graph: SceneGraph, rootId: string) {
  const paths = new Map<string, { stable: string; named: string }>();
  const visit = (parentId: string, stable: string[], named: string[]) => {
    for (const node of graph.getChildren(parentId)) {
      const sourceId = node.pluginData.find(p => p.pluginId === "orion.xdesign" && p.key === "librarySourceNodeId")?.value ?? node.id;
      const nextStable = [...stable, sourceId], nextNamed = [...named, `${node.type}:${node.name}`];
      paths.set(node.id, { stable: JSON.stringify(nextStable), named: JSON.stringify(nextNamed) });
      visit(node.id, nextStable, nextNamed);
    }
  };
  visit(rootId, [], []); return paths;
}

/** Upstream component swaps rebuild children. Carry declared overrides to matching new children. */
export function swapLibraryInstance(graph: SceneGraph, instanceId: string, componentId: string): number {
  const instance = graph.getNode(instanceId)!;
  const previous = cloneInstanceOverrideState(instance.instanceOverrides);
  if(instance.pluginData.some(p=>p.pluginId==="orion.xdesign"&&p.key==="photoDocumentId")) {
    previous.self.set("fills",instance.fills); instance.instanceOverrides=cloneInstanceOverrideState(previous);
  }
  const oldPaths = descendantPaths(graph, instanceId);
  const overrides = new Map<string, { fields: Map<string, unknown>; node: SceneNode }>();
  for (const [id, fields] of previous.descendants) {
    const node = graph.getNode(id); if (node) overrides.set(id, { fields, node: structuredClone(node) });
  }
  // Linked personal image edits must remain linked even when they were applied outside property controls.
  for (const id of oldPaths.keys()) {
    const node = graph.getNode(id)!;
    if (!node.pluginData.some(p => p.pluginId === "orion.xdesign" && p.key === "photoDocumentId")) continue;
    const entry = overrides.get(id) ?? { fields: new Map<string, unknown>(), node: structuredClone(node) };
    entry.fields.set("fills", node.fills); entry.fields.set("pluginData", node.pluginData); overrides.set(id, entry);
  }
  graph.swapInstanceComponent(instanceId, componentId);
  const current = graph.getNode(instanceId)!;
  current.instanceOverrides = createInstanceOverrideState(); current.instanceOverrides.self = previous.self;
  normalizeLibraryNestedInstances(graph,instanceId);
  const newPaths = descendantPaths(graph, instanceId);
  const unique = (kind: "stable" | "named", key: string) => {
    const matches = [...newPaths].filter(([, path]) => path[kind] === key); return matches.length === 1 ? matches[0]![0] : null;
  };
  let discarded = 0;
  for (const [id, { fields, node }] of overrides) {
    const path = oldPaths.get(id); if (!path) continue;
    const targetId = unique("stable", path.stable) ?? unique("named", path.named);
    const meaningful = [...fields.keys()].filter(field => field !== "sourceComponentId");
    if (!targetId) { discarded += meaningful.length; continue; }
    for (const field of meaningful) {
      if (["id", "parentId", "childIds", "type", "librarySource"].includes(field) || !Object.hasOwn(node, field)) continue;
      const value = structuredClone((node as unknown as Record<string, unknown>)[field]);
      if (field === "componentId" && graph.getNode(targetId)?.type === "INSTANCE" && typeof value === "string") graph.swapInstanceComponent(targetId, value);
      else graph.updateNode(targetId, { [field]: value });
      setInstanceOverride(current.instanceOverrides, instanceId, targetId, field, structuredClone(fields.get(field)));
    }
  }
  return discarded;
}
