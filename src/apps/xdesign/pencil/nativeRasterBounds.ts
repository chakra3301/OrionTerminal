import { getWorldMatrix, TransformMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';

export type RasterBounds = { minX: number; minY: number; maxX: number; maxY: number };

const union = (a: RasterBounds, b: RasterBounds): RasterBounds => ({
  minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
});

function intersect(a: RasterBounds, b: RasterBounds): RasterBounds | undefined {
  const result = { minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) };
  return result.minX < result.maxX && result.minY < result.maxY ? result : undefined;
}

function clipBounds(node: SceneNode, graph: SceneGraph): RasterBounds {
  const matrix = getWorldMatrix(node, graph);
  const corners = [[0, 0], [node.width, 0], [node.width, node.height], [0, node.height]].map(([x, y]) => TransformMatrix.mapPoint(matrix, { x: x!, y: y! }));
  return { minX: Math.min(...corners.map(point => point.x)), minY: Math.min(...corners.map(point => point.y)), maxX: Math.max(...corners.map(point => point.x)), maxY: Math.max(...corners.map(point => point.y)) };
}

function lineSquareCapBounds(graph: SceneGraph, node: SceneNode): RasterBounds | undefined {
  if (node.type !== 'LINE') return;
  let extra = 0;
  for (const stroke of node.strokes) {
    if (!stroke.visible || stroke.align !== 'CENTER' || (stroke.cap ?? node.strokeCap) !== 'SQUARE') continue;
    const weight = node.independentStrokeWeights
      ? Math.max(stroke.weight, node.borderTopWeight, node.borderRightWeight, node.borderBottomWeight, node.borderLeftWeight)
      : stroke.weight;
    if (!(weight > 0) || !Number.isFinite(weight)) continue;
    const length = Math.hypot(node.width, node.height);
    const extension = length ? weight / 2 * ((Math.abs(node.width) + Math.abs(node.height)) / length) : weight / 2;
    extra = Math.max(extra, extension);
  }
  if (!extra) return;
  const matrix = getWorldMatrix(node, graph);
  const points = [
    { x: -extra, y: -extra }, { x: node.width + extra, y: -extra },
    { x: node.width + extra, y: node.height + extra }, { x: -extra, y: node.height + extra },
  ].map(point => TransformMatrix.mapPoint(matrix, point));
  return {
    minX: Math.min(...points.map(point => point.x)), minY: Math.min(...points.map(point => point.y)),
    maxX: Math.max(...points.map(point => point.x)), maxY: Math.max(...points.map(point => point.y)),
  };
}

export function expandRasterBounds(graph: SceneGraph, selectedIds: readonly string[], base: RasterBounds): RasterBounds {
  let bounds = base;
  const seen = new Set<string>();
  const pending = selectedIds.map(id => ({ id, clips: [] as RasterBounds[] }));
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    const node = graph.getNode(current.id);
    if (!node?.visible || node.internalOnly) continue;
    const candidate = lineSquareCapBounds(graph, node);
    if (candidate) {
      let visible: RasterBounds | undefined = candidate;
      for (const clip of current.clips) {
        if (!visible) break;
        visible = intersect(visible, clip);
      }
      if (visible) bounds = union(bounds, visible);
    }
    const clips = ['FRAME', 'COMPONENT', 'INSTANCE'].includes(node.type) && node.clipsContent
      ? [...current.clips, clipBounds(node, graph)]
      : current.clips;
    for (const childId of node.childIds) pending.push({ id: childId, clips });
  }
  return bounds;
}

export function withRasterBoundsPadding<T>(
  graph: SceneGraph,
  pageId: string,
  selectedIds: readonly string[],
  base: RasterBounds,
  expanded: RasterBounds,
  render: (nodeIds: string[]) => T,
): T {
  if (base.minX === expanded.minX && base.minY === expanded.minY && base.maxX === expanded.maxX && base.maxY === expanded.maxY) {
    return render([...selectedIds]);
  }
  if (!(expanded.maxX > expanded.minX && expanded.maxY > expanded.minY)) throw new Error('Raster bounds are invalid.');
  const padding = graph.createNode('RECTANGLE', pageId, {
    name: 'Temporary export bounds', x: expanded.minX, y: expanded.minY,
    width: expanded.maxX - expanded.minX, height: expanded.maxY - expanded.minY,
    visible: true, opacity: 0, fills: [], strokes: [], effects: [], childIds: [],
  });
  try { return render([...selectedIds, padding.id]); }
  finally { graph.deleteNode(padding.id); }
}
