/**
 * Port of img2threejs `forge/stage1_intake/delight_albedo.py`. De-lighting
 * makes reference-texture projection safe (`projectionBake.ts`) — a raw
 * photo crop carries the photographer's key light baked in, so projecting
 * it straight onto a differently-lit 3D scene reads as a flat sticker with
 * a phantom highlight. This is a canvas-space approximation (clamp+soften
 * specular highlights, lift shadow floor, mild desaturation toward a
 * flatter "albedo-ish" response) — inference, not real light-transport
 * inversion, exactly as upstream frames it.
 */

/** Mutates a copy of the ImageData in place and returns it. `strength` 0..1. */
export function delightAlbedo(img: ImageData, strength = 0.6): ImageData {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const d = out.data;
  const n = img.width * img.height;

  // Pass 1: global luma stats to find the highlight ceiling / shadow floor.
  let lo = 255, hi = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4]!, g = d[i * 4 + 1]!, b = d[i * 4 + 2]!;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  const range = Math.max(1, hi - lo);

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const r = d[idx]!, g = d[idx + 1]!, b = d[idx + 2]!;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const norm = (l - lo) / range; // 0..1 within this image's own dynamic range

    // Compress toward mid-gray at both ends (clamp specular blowout, lift
    // crushed shadow) proportional to `strength`.
    const target = 0.5 + (norm - 0.5) * (1 - strength * 0.55);
    const gain = target > 1e-3 ? (target * 255) / Math.max(1, l) : 1;
    let nr = r * gain, ng = g * gain, nb = b * gain;

    // Mild desaturation toward luma — a de-lit "albedo-ish" read is flatter
    // than a directly-lit photo.
    const mixLuma = strength * 0.25;
    nr = nr * (1 - mixLuma) + l * mixLuma;
    ng = ng * (1 - mixLuma) + l * mixLuma;
    nb = nb * (1 - mixLuma) + l * mixLuma;

    d[idx] = clamp255(nr);
    d[idx + 1] = clamp255(ng);
    d[idx + 2] = clamp255(nb);
  }
  return out;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
