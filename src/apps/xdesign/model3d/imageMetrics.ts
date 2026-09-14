/**
 * Pixel-math foundation — a faithful port of img2threejs's stdlib-only PNG
 * analysis (`forge/stage1_intake/extract_pbr_evidence.py`,
 * `forge/stage4_review/diagnose_render.py`, `forge/_shared/image_hash.py`)
 * adapted to browser `ImageData` (we get RGBA arrays for free from
 * `canvas.getImageData`, no PNG decoder needed). Every function here is
 * pure and unit-tested — this is the "scripts enforce" layer; nothing here
 * ever produces a pass/fail verdict on its own (see `divineEye.ts`).
 */

export type Px = { w: number; h: number; data: Uint8ClampedArray }; // RGBA, length w*h*4

export function fromImageData(img: ImageData): Px {
  return { w: img.width, h: img.height, data: img.data };
}

function at(px: Px, x: number, y: number): [number, number, number, number] {
  const i = (y * px.w + x) * 4;
  return [px.data[i]!, px.data[i + 1]!, px.data[i + 2]!, px.data[i + 3]!];
}

export function srgbLuma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
export function saturation(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}
export function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
export function rgbToHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
function medianColor(samples: [number, number, number][]): [number, number, number] {
  if (samples.length === 0) return [128, 128, 128];
  const r = samples.map((s) => s[0]).sort((a, b) => a - b);
  const g = samples.map((s) => s[1]).sort((a, b) => a - b);
  const b = samples.map((s) => s[2]).sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  return [r[mid]!, g[mid]!, b[mid]!];
}
function percentile(values: number[], frac: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(frac * s.length))]!;
}

export type ForegroundMask = { mask: Uint8Array; coverage: number; backgroundColor: string; warnings: string[] };

/** Port of `build_foreground_mask` — corner-sampled background subtraction
 * with an alpha-transparency fast path. Works on opaque OR alpha-punched
 * PNGs (our screenshots are usually the latter — WebGL clear alpha=0). */
export function buildForegroundMask(px: Px): ForegroundMask {
  const { w, h, data } = px;
  const n = w * h;
  const warnings: string[] = [];
  let transparentCount = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3]! < 245) transparentCount++;
  const transparentFraction = transparentCount / n;

  const radius = Math.max(3, Math.floor(Math.min(w, h) / 40));
  const corners: [number, number, number, number][] = [
    [0, radius, 0, radius], [w - radius, w, 0, radius],
    [0, radius, h - radius, h], [w - radius, w, h - radius, h],
  ];
  const samples: [number, number, number][] = [];
  for (const [x0, x1, y0, y1] of corners) {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        const [r, g, b, a] = at(px, x, y);
        if (a > 16) samples.push([r, g, b]);
      }
    }
  }
  const background = medianColor(samples);
  const backgroundNoise = percentile(samples.map((s) => colorDistance(s, background)), 0.75);
  const threshold = Math.max(24, backgroundNoise * 2.4);

  let mask = new Uint8Array(n);
  if (transparentFraction > 0.03) {
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3]! > 24 ? 1 : 0;
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = at(px, x, y);
        const dist = colorDistance([r, g, b], background);
        const sat = saturation(r, g, b);
        const luma = srgbLuma(r, g, b);
        mask[y * w + x] = a > 16 && (dist > threshold || (sat > 0.16 && luma < 0.94)) ? 1 : 0;
      }
    }
  }
  let coverage = mask.reduce((s, v) => s + v, 0) / n;
  if (coverage < 0.035) {
    warnings.push("foreground mask is tiny; evidence extraction is likely unreliable");
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3]! > 16 ? 1 : 0;
    coverage = mask.reduce((s, v) => s + v, 0) / n;
  }
  if (coverage > 0.9) warnings.push("image is not clearly isolated from background; using most pixels as evidence");
  return { mask, coverage, backgroundColor: rgbToHex(background), warnings };
}

/** Resample a full-res mask into a size×size boolean grid (row-major). */
export function resizeMask(px: Px, mask: Uint8Array, size = 96): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(px.h - 1, Math.floor((y * px.h) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(px.w - 1, Math.floor((x * px.w) / size));
      out[y * size + x] = mask[sy * px.w + sx]!;
    }
  }
  return out;
}

export function silhouetteIoU(a: Uint8Array, b: Uint8Array): number {
  let intersection = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) {
      union++;
      if (a[i] && b[i]) intersection++;
    }
  }
  return union ? intersection / union : 1;
}

export function bboxOf(mask: Uint8Array, size: number): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % size, y = Math.floor(i / size);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return [0, 0, 0, 0];
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

export function proportionDelta(
  refBox: [number, number, number, number], renBox: [number, number, number, number],
): { aspectRatioDelta: number; scaleDelta: number } {
  const [, , rw, rh] = refBox, [, , dw, dh] = renBox;
  const refAr = rh ? rw / rh : 0, renAr = dh ? dw / dh : 0;
  const aspectRatioDelta = refAr ? Math.abs(refAr - renAr) / refAr : renAr === 0 ? 0 : 1;
  const refArea = rw * rh, renArea = dw * dh;
  const scaleDelta = refArea ? Math.abs(refArea - renArea) / refArea : renArea === 0 ? 0 : 1;
  return { aspectRatioDelta, scaleDelta };
}

export function bilateralSymmetryError(mask: Uint8Array, size: number): number {
  let total = 0, mismatches = 0;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const mx = size - 1 - x;
      total++;
      if (mask[row + x] !== mask[row + mx]) mismatches++;
    }
  }
  return total ? mismatches / total : 0;
}

/** Downsample luma to a size×size grid in 0..1, box-averaged. */
export function lumaGrid(px: Px, size: number): Float64Array {
  const out = new Float64Array(size * size);
  const cnt = new Int32Array(size * size);
  for (let y = 0; y < px.h; y++) {
    const sy = Math.min(size - 1, Math.floor((y * size) / px.h));
    for (let x = 0; x < px.w; x++) {
      const sx = Math.min(size - 1, Math.floor((x * size) / px.w));
      const [r, g, b] = at(px, x, y);
      const cell = sy * size + sx;
      out[cell]! += srgbLuma(r, g, b);
      cnt[cell]!++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] ? out[i]! / cnt[i]! : 0;
  return out;
}

function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return xs.length ? s / xs.length : 0;
}

/** Global SSIM-lite over two luma grids (single "window" = whole image, C1/C2 per the classic formula). */
export function globalSsim(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const ma = mean(a), mb = mean(b);
  let va = 0, vb = 0, cov = 0;
  for (let i = 0; i < a.length; i++) {
    va += (a[i]! - ma) ** 2; vb += (b[i]! - mb) ** 2; cov += (a[i]! - ma) * (b[i]! - mb);
  }
  va /= a.length; vb /= a.length; cov /= a.length;
  const c1 = 0.01 ** 2, c2 = 0.03 ** 2;
  const ssim = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
  return Math.max(0, Math.min(1, ssim));
}

function sobelEdges(luma: Float64Array, size: number, thresh = 0.12): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const gx = luma[y * size + x + 1]! - luma[y * size + x - 1]!;
      const gy = luma[(y + 1) * size + x]! - luma[(y - 1) * size + x]!;
      out[y * size + x] = Math.hypot(gx, gy) > thresh ? 1 : 0;
    }
  }
  return out;
}

export function edgeOverlap(a: Float64Array, b: Float64Array, size: number): number {
  const ea = sobelEdges(a, size), eb = sobelEdges(b, size);
  let union = 0, inter = 0;
  for (let i = 0; i < ea.length; i++) {
    if (ea[i] || eb[i]) { union++; if (ea[i] && eb[i]) inter++; }
  }
  return union ? inter / union : 1;
}

function blownFraction(luma: Float64Array, hi = 0.95): number {
  let n = 0;
  for (let i = 0; i < luma.length; i++) if (luma[i]! >= hi) n++;
  return luma.length ? n / luma.length : 0;
}
export function blowoutParity(ref: Float64Array, ren: Float64Array): number {
  const diff = Math.abs(blownFraction(ren) - blownFraction(ref));
  return Math.max(0, 1 - diff * 4);
}

export function flatFraction(luma: Float64Array, size: number, eps = 0.02): number {
  let flat = 0, total = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const c = luma[y * size + x]!;
      const nb = [luma[y * size + x - 1]!, luma[y * size + x + 1]!, luma[(y - 1) * size + x]!, luma[(y + 1) * size + x]!];
      total++;
      if (nb.every((v) => Math.abs(v - c) < eps)) flat++;
    }
  }
  return total ? flat / total : 0;
}

export function tonalParity(ref: Float64Array, ren: Float64Array, bins = 16): number {
  const histA = new Float64Array(bins), histB = new Float64Array(bins);
  for (const v of ref) histA[Math.min(bins - 1, Math.floor(v * bins))]!++;
  for (const v of ren) histB[Math.min(bins - 1, Math.floor(v * bins))]!++;
  for (let i = 0; i < bins; i++) { histA[i]! /= ref.length || 1; histB[i]! /= ren.length || 1; }
  let l1 = 0;
  for (let i = 0; i < bins; i++) l1 += Math.abs(histA[i]! - histB[i]!);
  return Math.max(0, 1 - l1 / 2);
}

// ── Perceptual hash (DCT-based pHash, 32→8x8, no DC) ───────────────────────

let dctCache: Map<number, number[][]> | null = null;
function dctMatrix(n: number): number[][] {
  dctCache ??= new Map();
  const cached = dctCache.get(n);
  if (cached) return cached;
  const factor = Math.PI / (2 * n);
  const m: number[][] = [];
  for (let k = 0; k < n; k++) {
    const scale = k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
    const row: number[] = [];
    for (let i = 0; i < n; i++) row.push(scale * Math.cos((2 * i + 1) * k * factor));
    m.push(row);
  }
  dctCache.set(n, m);
  return m;
}
function dct2d(block: number[][]): number[][] {
  const n = block.length;
  const m = dctMatrix(n);
  const temp: number[][] = [];
  for (let k = 0; k < n; k++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += m[k]![i]! * block[i]![j]!;
      row.push(s);
    }
    temp.push(row);
  }
  const out: number[][] = [];
  for (let k = 0; k < n; k++) {
    const row: number[] = [];
    for (let l = 0; l < n; l++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += temp[k]![j]! * m[l]![j]!;
      row.push(s);
    }
    out.push(row);
  }
  return out;
}
function grayscaleDownsampled(px: Px, size = 32): number[][] {
  const out: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  const counts: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let y = 0; y < px.h; y++) {
    const sy = Math.min(size - 1, Math.floor((y * size) / px.h));
    for (let x = 0; x < px.w; x++) {
      const sx = Math.min(size - 1, Math.floor((x * size) / px.w));
      const [r, g, b] = at(px, x, y);
      out[sy]![sx]! += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      counts[sy]![sx]!++;
    }
  }
  for (let sy = 0; sy < size; sy++) for (let sx = 0; sx < size; sx++) if (counts[sy]![sx]) out[sy]![sx]! /= counts[sy]![sx]!;
  return out;
}
export function phashFromImage(px: Px, hashSize = 8, imgSize = 32): bigint {
  const gray = grayscaleDownsampled(px, imgSize);
  const coeffs = dct2d(gray);
  const low: number[] = [];
  for (let k = 0; k < hashSize; k++) for (let l = 0; l < hashSize; l++) low.push(coeffs[k]![l]!);
  const ac = low.slice(1);
  const ordered = [...ac].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[mid]! : 0.5 * (ordered[mid - 1]! + ordered[mid]!);
  let bits = 0n;
  for (const v of low) { bits <<= 1n; if (v > median) bits |= 1n; }
  return bits;
}
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b, n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}
export function normalizedSimilarity(a: bigint, b: bigint, bits = 64): number {
  return 1 - hamming(a, b) / bits;
}

// ── Palette (k-means on foreground samples, seeded by luma-sorted quantiles) ─

export function kmeansPalette(samples: [number, number, number][], k = 5): string[] {
  if (samples.length === 0) return ["#8A7A5F"];
  const ordered = [...samples].sort((a, b) => srgbLuma(...a) - srgbLuma(...b));
  let centers: [number, number, number][] = Array.from({ length: k }, (_, i) =>
    ordered[Math.floor((i + 0.5) * (ordered.length - 1) / k)]!,
  );
  for (let iter = 0; iter < 8; iter++) {
    const groups: [number, number, number][][] = centers.map(() => []);
    for (const s of samples) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const d = colorDistance(s, centers[i]!);
        if (d < bestD) { bestD = d; best = i; }
      }
      groups[best]!.push(s);
    }
    centers = centers.map((c, i) => {
      const g = groups[i]!;
      if (g.length === 0) return c;
      const r = g.reduce((a, s) => a + s[0], 0) / g.length;
      const gg = g.reduce((a, s) => a + s[1], 0) / g.length;
      const b = g.reduce((a, s) => a + s[2], 0) / g.length;
      return [Math.round(r), Math.round(gg), Math.round(b)];
    });
  }
  const counts = new Map<number, number>();
  for (const s of samples) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = colorDistance(s, centers[i]!);
      if (d < bestD) { bestD = d; best = i; }
    }
    counts.set(best, (counts.get(best) ?? 0) + 1);
  }
  const order = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  return order.map((i) => rgbToHex(centers[i]!)).slice(0, k);
}

export function representativeSamples(px: Px, mask: Uint8Array, limit = 7000): [number, number, number][] {
  const all: [number, number, number][] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % px.w, y = Math.floor(i / px.w);
    const [r, g, b] = at(px, x, y);
    all.push([r, g, b]);
  }
  const candidates = all.length ? all : Array.from({ length: px.w * px.h }, (_, i) => {
    const x = i % px.w, y = Math.floor(i / px.w);
    return at(px, x, y).slice(0, 3) as [number, number, number];
  });
  if (candidates.length <= limit) return candidates;
  const step = Math.max(1, Math.floor(candidates.length / limit));
  const out: [number, number, number][] = [];
  for (let i = 0; i < candidates.length; i += step) out.push(candidates[i]!);
  return out.slice(0, limit);
}
