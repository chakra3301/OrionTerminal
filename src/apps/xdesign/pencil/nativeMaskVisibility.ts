import type { CanvasKit, Path, PathBuilder } from 'canvaskit-wasm';
import { getWorldMatrix, TransformMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import type { DesignNode } from './reactExportRuntime';
import { releaseNativeResources } from './nativeRendererLifecycle';

/** Empty native intersections remove tab targets; overflowing visible descendants keep their container. */
export function applyNativeMaskVisibility(kit: CanvasKit, graph: SceneGraph, root: DesignNode, originals: WeakMap<DesignNode, SceneNode>) {
  const pending = [root]; let masked = false;
  while (pending.length && !masked) { const node = pending.pop()!; masked = node.maskPath !== undefined; pending.push(...node.children, ...(node.control?.variants.map(variant => variant.tree) ?? [])); }
  if (!masked) return;
  const sourceRoot = originals.get(root);
  if (!sourceRoot) return;
  const base = TransformMatrix.invert(getWorldMatrix(sourceRoot, graph));
  if (!base) throw new Error('This mask has an invalid semantic scene transform.');
  const visit = (node: DesignNode, inherited?: Path): boolean => {
    const original = originals.get(node);
    let clip = inherited, own: Path | undefined, path: Path | undefined, box: Path | undefined, intersection: Path | undefined, builder: PathBuilder | undefined, failure: { reason: unknown } | undefined;
    try {
      const matrix = original && TransformMatrix.multiply(base, getWorldMatrix(original, graph));
      if (node.maskPath !== undefined) {
        if (!matrix) throw new Error('This mask is missing its semantic parent.');
        path = node.maskPath ? kit.Path.MakeFromSVGString(node.maskPath) ?? undefined : kit.Path.MakeFromSVGString('M0,0') ?? undefined;
        if (!path) throw new Error('This mask could not prepare its semantic clip path.');
        builder = new kit.PathBuilder();
        if (!builder.addPath(path, matrix)) throw new Error('This mask could not transform its semantic clip path.');
        own = builder.detach();
        if (inherited) { intersection = kit.Path.MakeFromOp(inherited, own, kit.PathOp.Intersect) ?? undefined; if (!intersection) throw new Error('This mask could not intersect its semantic clip path.'); clip = intersection; }
        else clip = own;
      }
      if (clip && matrix && original) {
        const points = [[0, 0], [original.width, 0], [original.width, original.height], [0, original.height]].flatMap(([x, y]) => { const point = TransformMatrix.mapPoint(matrix, { x: x!, y: y! }); return [point.x, point.y]; });
        if (!points.every(Number.isFinite)) throw new Error('This mask has invalid semantic layer geometry.');
        const polygon = new kit.PathBuilder();
        try { box = polygon.addPolygon(points, true).detach(); } finally { polygon.delete(); }
        const result = kit.Path.MakeFromOp(clip, box, kit.PathOp.Intersect);
        if (!result) throw new Error('This mask could not intersect its semantic layer geometry.');
        try { node.hitHidden = result.isEmpty(); } finally { result.delete(); }
      }
      const descendants = [...node.children, ...(node.control?.variants.map(variant => variant.tree) ?? [])].map(child => visit(child, clip));
      if (clip && node.hitHidden && !descendants.some(Boolean)) node.visible = false;
      return node.visible && (!node.hitHidden || descendants.some(Boolean));
    } catch (error) { failure = { reason: error }; throw error; }
    finally { releaseNativeResources([() => intersection?.delete(), () => box?.delete(), () => own?.delete(), () => builder?.delete(), () => path?.delete()], failure); }
  };
  visit(root);
}
