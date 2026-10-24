import type { SceneGraph } from '@open-pencil/scene-graph';
import { constrainedChildRect, scaledChildRect, scaledGeometryChanges, type ResizeSnapshot } from '@open-pencil/scene-graph/resize';

const containers = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP', 'BOOLEAN_OPERATION']);
export function snapshotPrototypeGeometry(graph: SceneGraph): ReadonlyMap<string, ResizeSnapshot> {
  return new Map([...graph.nodes.values()].map(node => [node.id, { x: node.x, y: node.y, width: node.width, height: node.height, vectorNetwork: node.vectorNetwork, fillGeometry: node.fillGeometry, strokeGeometry: node.strokeGeometry, derivedTextGlyphs: node.derivedTextGlyphs, strokes: node.strokes, textPathData: node.textPathData, textPathBox: node.textPathBox }]));
}

/** Geometry references are immutable during this private-graph pass, so paths need no second snapshot copy. */
export function reconcilePrototypeGeometry(graph: SceneGraph, originals: ReadonlyMap<string, ResizeSnapshot>, explicit: ReadonlyMap<string, ReadonlySet<string>> = new Map()) {
  const pending = [...graph.nodes.values()].filter(node => !node.parentId || !graph.getNode(node.parentId)).map(node => ({ node, depth: 0 })), seen = new Set<string>();
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (seen.has(node.id) || depth > 128) throw new Error('This prototype resize has a recursive or overly deep layer tree.');
    seen.add(node.id);
    const before = originals.get(node.id);
    if (!before) continue;
    const resized = node.width !== before.width || node.height !== before.height;
    if (resized) {
      const changes = scaledGeometryChanges(before, before.width, before.height, node.width, node.height);
      // Changing a layout dimension must not turn an ordinary resize into a stroke-scale operation.
      delete changes.strokes;
      Object.assign(node, changes);
      if (node.type === 'TEXT') node.textPicture = null;
    }
    for (const child of graph.getChildren(node.id)) {
      const original = originals.get(child.id);
      if (resized && original && containers.has(node.type) && (node.layoutMode === 'NONE' || child.layoutPositioning === 'ABSOLUTE')) {
        const rect = ['GROUP', 'BOOLEAN_OPERATION'].includes(node.type) ? scaledChildRect(original, before, node) : constrainedChildRect(original, before, node, child.horizontalConstraint, child.verticalConstraint);
        for (const field of ['x', 'y', 'width', 'height'] as const) if (!explicit.get(child.id)?.has(field)) child[field] = rect[field];
      }
      pending.push({ node: child, depth: depth + 1 });
    }
  }
  if (seen.size !== graph.nodes.size) throw new Error('This prototype resize has disconnected or recursive layer ancestry.');
  graph.clearAbsPosCache();
}
