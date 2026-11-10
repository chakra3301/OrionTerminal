import type { SceneGraph } from '@open-pencil/scene-graph';
import { createCollection, createVariable } from '@open-pencil/scene-graph/variables';

export function installSharedIds(graph: SceneGraph, peerId: () => number): () => void {
  const originalNode = graph.createNode, originalCollection = graph.createCollection, originalVariable = graph.createVariable;
  let sequence = 0;
  const next = () => {
    const peer = peerId();
    if (!Number.isInteger(peer) || peer < 0 || peer > 0xffffffff) throw new Error('Invalid shared design peer ID.');
    let id: string;
    do { id = `${peer}:${++sequence}`; } while (graph.nodes.has(id) || graph.variables.has(id) || graph.variableCollections.has(id) || [...graph.variableCollections.values()].some(collection => collection.modes.some(mode => mode.modeId === id)));
    return id;
  };
  const node: typeof graph.createNode = (type, parent, overrides = {}) => originalNode.call(graph, type, parent, { ...overrides, id: next() });
  const collection: typeof graph.createCollection = name => createCollection(graph, next, name);
  const variable: typeof graph.createVariable = (name, type, owner, value) => createVariable(graph, next, name, type, owner, value);
  graph.createNode = node; graph.createCollection = collection; graph.createVariable = variable;
  return () => {
    if (graph.createNode === node) graph.createNode = originalNode;
    if (graph.createCollection === collection) graph.createCollection = originalCollection;
    if (graph.createVariable === variable) graph.createVariable = originalVariable;
  };
}
