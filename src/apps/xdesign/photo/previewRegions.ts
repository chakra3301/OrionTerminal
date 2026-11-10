import { boundBlurViewport, type BlurViewport } from './blurViewport';
import type { PhotoPreviewRegion } from './commandPreview';

type Size = { width: number; height: number };
export function photoPreviewRegions(document: Size, viewport: BlurViewport, frame: Size, pixelRatio = 1): PhotoPreviewRegion[] {
  const { width, height } = document, view = boundBlurViewport(width, height, viewport);
  if (!view || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > 4_294_967_295 || height > 4_294_967_295 || ![frame.width, frame.height, pixelRatio].every(value => Number.isFinite(value) && value > 0) || view.zoom <= 1) return [];
  const baseScale = Math.max(1, Math.ceil(Math.max(width, height) / 2048));
  if (baseScale === 1) return [];
  const cssScale = Math.min(frame.width * view.zoom / width, frame.height * view.zoom / height);
  if (!(cssScale > 0) || !Number.isFinite(cssScale)) return [];
  const sourcePerPixel = 1 / (cssScale * Math.min(pixelRatio, 4));
  let scale = 1;
  while (scale < 64 && scale * 2 <= sourcePerPixel) scale *= 2;
  for (; scale < baseScale && scale <= 64; scale *= 2) {
    const left = Math.max(0, Math.floor(view.x / scale) * scale), top = Math.max(0, Math.floor(view.y / scale) * scale);
    const right = Math.min(width, Math.ceil((view.x + width / view.zoom) / scale) * scale), bottom = Math.min(height, Math.ceil((view.y + height / view.zoom) / scale) * scale);
    if (right <= left || bottom <= top) return [];
    const edge = 512 * scale, count = Math.ceil((right - left) / edge) * Math.ceil((bottom - top) / edge);
    if (count > 8) continue;
    const result: PhotoPreviewRegion[] = [];
    for (let y = top; y < bottom; y += edge) for (let x = left; x < right; x += edge) result.push({ x, y, width: Math.min(edge, right - x), height: Math.min(edge, bottom - y), scale });
    return result;
  }
  return [];
}
