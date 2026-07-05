/**
 * Natural aspect (width/height) of loaded image/video sources, published by
 * the raster/video paths and read by the canvas transform overlay so it can
 * draw an accurate bounding box for contain-fit sources.
 */

const aspects = new Map<string, number>();

export function setSourceAspect(layerId: string, aspect: number): void {
  if (Number.isFinite(aspect) && aspect > 0) aspects.set(layerId, aspect);
}

/** natW/natH, or null when the source hasn't loaded / isn't measurable. */
export function getSourceAspect(layerId: string): number | null {
  return aspects.get(layerId) ?? null;
}

export function dropSourceAspect(layerId: string): void {
  aspects.delete(layerId);
}
