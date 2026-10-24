import { SceneGraph, componentPropertyDefinitions, resolveComponentPropertyValue } from '@open-pencil/scene-graph';
import { installSlotSupport } from './slots';
import { copyVideoResources } from './videoPaints';
const MAX_EXPORT_NODES=20_000;
function exportAncestry(source: SceneGraph, id: string) {
  const ancestry = new Set([id]), parents: string[] = [];
  let parent = source.getNode(id)?.parentId;
  while (parent) {
    if (ancestry.has(parent)) throw new Error('This design has recursive layer ancestry.');
    ancestry.add(parent);
    if (ancestry.size > 129) throw new Error('This design exceeds 128 layer nesting levels.');
    const ancestor = source.getNode(parent);
    if (!ancestor) throw new Error('Restore this design’s missing parent layer before exporting.');
    parents.push(parent); parent = ancestor.parentId;
  }
  return parents;
}

/** Copy just the selection and its component/paint dependencies. Image bytes are
 * immutable and shared here; every mutable node is private to this export. */
export function cloneDesignSubgraph(source: SceneGraph, ids: readonly string[]): SceneGraph {
  for (const id of ids) exportAncestry(source, id);
  const closure = new Set<string>(), pending = [...ids];
  while (pending.length) {
    const id = pending.pop()!;
    if (closure.has(id)) continue;
    const node = source.getNode(id);
    if (!node) throw new Error('A selected design layer or component is missing.');
    closure.add(id);
    if (closure.size > MAX_EXPORT_NODES) throw new Error('Export a smaller selection; React export supports 20,000 dependent layers.');
    pending.push(...node.childIds);
    if(node.type==='COMPONENT'&&node.parentId&&source.getNode(node.parentId)?.type==='COMPONENT_SET')pending.push(node.parentId);
    if (node.componentId) {
      const main = source.getNode(node.componentId), parent = main?.parentId && source.getNode(main.parentId);
      pending.push(parent && parent.type === 'COMPONENT_SET' ? parent.id : node.componentId);
    }
    const definitions = node.type === 'INSTANCE' ? componentPropertyDefinitions(source, node) : node.componentPropertyDefinitions;
    for (const definition of definitions) if (definition.type === 'INSTANCE_SWAP') {
      const value = node.componentPropertyAssignments[definition.id] ?? definition.defaultValue;
      const target = resolveComponentPropertyValue(source, value);
      if (target) pending.push(target.id);
    }
    for (const fill of node.fills) if (fill.sourceNodeId) pending.push(fill.sourceNodeId);
  }
  // Keep ancestry without bringing in siblings elsewhere in the document.
  for (const id of [...closure]) {
    for (const parent of exportAncestry(source, id)) {
      closure.add(parent);
      if (closure.size > MAX_EXPORT_NODES) throw new Error('Export a smaller selection; React export supports 20,000 dependent layers.');
    }
  }
  if (closure.size > MAX_EXPORT_NODES) throw new Error('Export a smaller selection; React export supports 20,000 dependent layers.');
  const graph = new SceneGraph();
  graph.nodes = new Map([...closure].map(id => { const node = structuredClone(source.getNode(id)!); node.childIds = node.childIds.filter(child => closure.has(child)); return [id, node]; }));
  graph.rootId = source.rootId;
  graph.images = new Map();
  for (const node of graph.nodes.values()) for (const fill of node.fills) if (fill.imageHash) {
    const bytes = source.images.get(fill.imageHash); if (bytes) graph.images.set(fill.imageHash, bytes);
  }
  copyVideoResources(source, graph);
  if([...graph.images.values()].reduce((total,bytes)=>total+bytes.byteLength,0)>24*1024*1024)throw new Error('React export supports up to 24 MB of embedded media; export a smaller selection.');
  graph.variables = structuredClone(source.variables);
  graph.variableCollections = structuredClone(source.variableCollections);
  graph.activeMode = new Map(source.activeMode);
  graph.documentColorSpace = source.documentColorSpace;
  graph.instanceIndex.clear();
  for (const node of graph.nodes.values()) if (node.type === 'INSTANCE' && node.componentId) {
    const set = graph.instanceIndex.get(node.componentId) ?? new Set<string>(); set.add(node.id); graph.instanceIndex.set(node.componentId, set);
  }
  installSlotSupport(graph);
  return graph;
}

