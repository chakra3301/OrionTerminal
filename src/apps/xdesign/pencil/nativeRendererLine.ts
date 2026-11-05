import type { SkiaRenderer } from '@open-pencil/core/canvas';
import type { Canvas } from 'canvaskit-wasm';
import type { SceneNode } from '@open-pencil/scene-graph';

type StrokeMethod = SkiaRenderer['drawNodeStroke'];
const restorers = new WeakMap<SkiaRenderer, () => void>();

export function installNativeLineStroke(renderer: SkiaRenderer) {
  const existing = restorers.get(renderer);
  if (existing) return existing;

  const ownMethod = Object.getOwnPropertyDescriptor(renderer, 'drawNodeStroke');
  const original = renderer.drawNodeStroke;
  const replacement: StrokeMethod = function (canvas: Canvas, node: SceneNode, rect: Float32Array, hasRadius: boolean) {
    if (node.type === 'LINE') canvas.drawLine(0, 0, node.width, node.height, renderer.strokePaint);
    else original.call(renderer, canvas, node, rect, hasRadius);
  };
  renderer.drawNodeStroke = replacement;

  let active = true;
  const restore = () => {
    if (!active) return;
    active = false;
    if (renderer.drawNodeStroke === replacement) {
      if (ownMethod) Object.defineProperty(renderer, 'drawNodeStroke', ownMethod);
      else delete (renderer as unknown as { drawNodeStroke?: StrokeMethod }).drawNodeStroke;
    }
    restorers.delete(renderer);
  };
  restorers.set(renderer, restore);
  return restore;
}
