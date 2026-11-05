export type BlurViewport = { x: number; y: number; zoom: number };
type Rect = { left: number; top: number; width: number; height: number };
export const FIT_BLUR_VIEW: BlurViewport = { x: 0, y: 0, zoom: 1 };
const finite = (...values: number[]) => values.every(Number.isFinite);
const measured = (value: number) => Number(value.toPrecision(15));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function boundBlurViewport(width: number, height: number, viewport: BlurViewport): BlurViewport | undefined {
  if (!finite(width, height, viewport.x, viewport.y, viewport.zoom) || width <= 0 || height <= 0 || viewport.zoom <= 0) return;
  const zoom = clamp(viewport.zoom, 1, 64), w = width / zoom, h = height / zoom;
  return { x: measured(clamp(viewport.x, -w / 4, width - w * .75)), y: measured(clamp(viewport.y, -h / 4, height - h * .75)), zoom };
}

export function blurDocumentPoint(rect: Rect, width: number, height: number, viewport: BlurViewport, x: number, y: number): [number, number] | undefined {
  const bounded = boundBlurViewport(width, height, viewport);
  if (!bounded || !finite(rect.left, rect.top, rect.width, rect.height, x, y) || rect.width <= 0 || rect.height <= 0) return;
  const w = width / bounded.zoom, h = height / bounded.zoom, scale = Math.min(rect.width / w, rect.height / h);
  if (!(scale > 0) || !Number.isFinite(scale)) return;
  const left = rect.left + (rect.width - w * scale) / 2, top = rect.top + (rect.height - h * scale) / 2;
  return [bounded.x + (x - left) / scale, bounded.y + (y - top) / scale];
}

export function zoomBlurViewport(width: number, height: number, viewport: BlurViewport, nextZoom: number, anchor?: [number, number]): BlurViewport | undefined {
  const bounded = boundBlurViewport(width, height, viewport);
  if (!bounded || !finite(nextZoom) || nextZoom <= 0 || anchor && !finite(...anchor)) return;
  const zoom = clamp(nextZoom, 1, 64), [x, y] = anchor ?? [bounded.x + width / (2 * bounded.zoom), bounded.y + height / (2 * bounded.zoom)];
  const u = (x - bounded.x) * bounded.zoom / width, v = (y - bounded.y) * bounded.zoom / height;
  return boundBlurViewport(width, height, { x: x - u * width / zoom, y: y - v * height / zoom, zoom });
}

export function panBlurViewport(rect: Rect, width: number, height: number, viewport: BlurViewport, dx: number, dy: number): BlurViewport | undefined {
  const bounded = boundBlurViewport(width, height, viewport);
  if (!bounded || !finite(rect.width, rect.height, dx, dy) || rect.width <= 0 || rect.height <= 0) return;
  const scale = Math.min(rect.width * bounded.zoom / width, rect.height * bounded.zoom / height);
  if (!(scale > 0) || !Number.isFinite(scale)) return;
  return boundBlurViewport(width, height, { ...bounded, x: bounded.x - dx / scale, y: bounded.y - dy / scale });
}
