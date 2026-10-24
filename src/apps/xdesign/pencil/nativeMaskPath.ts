const MAX_MASK_PATH = 4 * 1024 * 1024;
type Span = { x: number; y: number; width: number; height: number };

/** A binary hit region follows every nonzero native alpha pixel, including soft edges. */
function maskPath(pixels: Uint8Array, stride: number, offset: number, width: number, height: number, scale: number, minX: number, minY: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4 * 1024 * 1024 || pixels.length !== width * height * stride || ![scale, minX, minY].every(Number.isFinite) || scale <= 0) throw new Error('This mask has invalid native hit-region pixels.');
  let active = new Map<string, Span>(), path = '';
  const append = (span: Span) => {
    const x = minX + span.x / scale, y = minY + span.y / scale, w = span.width / scale, h = span.height / scale;
    if (![x, y, w, h].every(Number.isFinite)) throw new Error('This mask has invalid native hit-region coordinates.');
    path += `M${x},${y}h${w}v${h}h${-w}Z`;
    if (path.length > MAX_MASK_PATH) throw new Error('This mask exceeds the 4 MB native hit-region allowance.');
  };
  for (let y = 0; y < height; y++) {
    const next = new Map<string, Span>();
    for (let x = 0; x < width;) {
      if (!pixels[(y * width + x) * stride + offset]) { x++; continue; }
      const start = x++;
      while (x < width && pixels[(y * width + x) * stride + offset]) x++;
      const key = `${start}/${x - start}`, before = active.get(key);
      next.set(key, before ? { ...before, height: before.height + 1 } : { x: start, y, width: x - start, height: 1 });
    }
    for (const [key, span] of active) if (!next.has(key)) append(span);
    active = next;
  }
  for (const span of active.values()) append(span);
  return path;
}

export function nativeMaskPath(rgba: Uint8Array, width: number, height: number, scale: number, minX: number, minY: number) {
  return maskPath(rgba, 4, 3, width, height, scale, minX, minY);
}

export function nativeMaskAlphaPath(alpha: Uint8Array, width: number, height: number, scale: number, minX: number, minY: number) {
  return maskPath(alpha, 1, 0, width, height, scale, minX, minY);
}
