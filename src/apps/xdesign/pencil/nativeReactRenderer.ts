import { prepareGraphFonts } from '@open-pencil/core/text';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { capturePrototypeVariables, materializePrototypeBindings } from './prototypeVariableGraph';
import { reconcilePrototypeGeometry, snapshotPrototypeGeometry } from './prototypeGeometry';
import type { PrototypeSession } from './prototypeValues';
import { cloneDesignSubgraph } from './graphSubset';
import { prepareNativeSceneComponents } from './nativeSceneComponents';
import type { DesignControlSession } from './reactExportRuntime';
import { selectionToDesignModel, type DesignModel } from './reactExport';
import { inheritNativeMotionComposites } from './nativeReactMotionComposite';

export type NativeReactRenderRequest = {
  controlScope?: string;
  session?: PrototypeSession;
  controls?: DesignControlSession;
  rootSizes?: Record<string, { width?: number; height?: number }>;
};

function selectedRoots(graph: SceneGraph, ids: readonly string[]) {
  const selected = new Set(ids);
  for (const id of selected) if (!graph.getNode(id)) throw new Error('A native render selection contains a missing layer.');
  return [...selected].filter(id => {
    let parent = graph.getNode(id)?.parentId;
    while (parent) { if (selected.has(parent)) return false; parent = graph.getNode(parent)?.parentId; }
    return true;
  });
}

function authoredRootTarget(graph: SceneGraph, id: string) {
  const original = graph.getNode(id)!;
  const main = original.type === 'COMPONENT_SET' ? graph.getChildren(id).find(child => child.type === 'COMPONENT') : original;
  if (!main) throw new Error('This component set is empty.');
  return main.id;
}

function validateRootSizes(graph: SceneGraph, roots: readonly string[], sizes: NativeReactRenderRequest['rootSizes']) {
  if (!sizes) return;
  const allowed = new Set(roots);
  for (const [id, size] of Object.entries(sizes)) {
    if (!allowed.has(id) || !graph.getNode(id)) throw new Error('A native render size must target an authored selected root.');
    if (!size || typeof size !== 'object' || !Object.keys(size).some(field => field === 'width' || field === 'height')) throw new Error('Supply a host width or height for each sized root.');
    for (const field of ['width', 'height'] as const) if (size[field] !== undefined && (!Number.isFinite(size[field]) || size[field]! <= 0)) throw new Error(`A host root ${field} must be positive and finite.`);
  }
}

function setHostSize(node: SceneNode, size: { width?: number; height?: number }) {
  if (size.width !== undefined) {
    node.width = size.width;
    delete node.boundVariables.width;
  }
  if (size.height !== undefined) {
    node.height = size.height;
    delete node.boundVariables.height;
  }
  if (node.layoutMode === 'HORIZONTAL') {
    if (size.width !== undefined) node.primaryAxisSizing = 'FIXED';
    if (size.height !== undefined) node.counterAxisSizing = 'FIXED';
  } else if (node.layoutMode === 'VERTICAL') {
    if (size.width !== undefined) node.counterAxisSizing = 'FIXED';
    if (size.height !== undefined) node.primaryAxisSizing = 'FIXED';
  } else if (node.layoutMode === 'GRID') {
    if (size.width !== undefined) node.primaryAxisSizing = 'FIXED';
    if (size.height !== undefined) node.counterAxisSizing = 'FIXED';
  }
}

/** Rebuild a private, source-backed native model for the requested prototype state and host size. */
export async function renderNativeReactModel(kit: CanvasKit, source: SceneGraph, ids: readonly string[], request: NativeReactRenderRequest = {}, preparedScene?: (graph: SceneGraph, ids: readonly string[]) => void): Promise<DesignModel> {
  if (!ids.length) throw new Error('Select design layers to render natively.');
  if (new Set(ids).size !== ids.length) throw new Error('A native render selection cannot contain duplicate layers.');
  const roots = selectedRoots(source, ids);
  validateRootSizes(source, roots, request.rootSizes);
  const graph = cloneDesignSubgraph(source, ids);
  inheritNativeMotionComposites(source, graph);
  prepareNativeSceneComponents(graph, ids);
  const targets = new Map(roots.map(id => [id, authoredRootTarget(graph, id)]));

  const originals = snapshotPrototypeGeometry(graph);
  const explicit = new Map([...graph.nodes.values()].map(node => [node.id, new Set(Object.keys(node.boundVariables).filter(field => ['x', 'y', 'width', 'height'].includes(field)))]));
  const definitions = capturePrototypeVariables(graph, graph.nodes.values());
  materializePrototypeBindings(graph, definitions, request.session, { detachResolved: false });
  for (const [authoredId, size] of Object.entries(request.rootSizes ?? {})) {
    const target = graph.getNode(targets.get(authoredId)!)!;
    setHostSize(target, size);
  }
  if (Object.keys(request.rootSizes ?? {}).length) reconcilePrototypeGeometry(graph, originals, explicit);

  await prepareGraphFonts(graph, roots);
  const model = selectionToDesignModel(graph, roots, kit, true, request.session, request.controls ?? {}, true, request.controlScope, true, preparedScene);
  if (model.prototypeIssues.length) throw new Error(model.prototypeIssues[0]);
  return model;
}
