/**
 * Port of img2threejs `forge/stage4_review/objectness.py` — OSIM-lite: a
 * stdlib gradient-orientation-histogram (HOG-like) descriptor of the
 * foreground object, cosine-compared. Invariant to background, position,
 * scale, and absolute brightness — exactly the axes where silhouette-IoU /
 * SSIM / edge-overlap collapse for a photo-reference-vs-procedural-render
 * pair (see `grimoire/review/self_correction.md`'s "Divine Eye caveat").
 */

import type { Px } from "./imageMetrics";
import { buildForegroundMask } from "./imageMetrics";

const GRID = 96;
const CELLS = 8;
const BINS = 9;

function toGray(px: Px): Float64Array {
  const out = new Float64Array(px.w * px.h);
  for (let i = 0; i < px.w * px.h; i++) {
    const r = px.data[i * 4]!, g = px.data[i * 4 + 1]!, b = px.data[i * 4 + 2]!;
    out[i] = (r * 30 + g * 59 + b * 11) / 100;
  }
  return out;
}

function bboxOfMask(mask: Uint8Array, w: number, h: number): [number, number, number, number] {
  let minx = w, miny = h, maxx = -1, maxy = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx < 0) return [0, 0, w, h];
  return [minx, miny, maxx + 1, maxy + 1];
}

function resampleBbox(gray: Float64Array, w: number, h: number, box: [number, number, number, number], n: number): Float64Array {
  const [x0, y0, x1, y1] = box;
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const out = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    const sy = Math.min(h - 1, y0 + Math.floor((j * bh) / n));
    const base = sy * w;
    for (let i = 0; i < n; i++) {
      const sx = Math.min(w - 1, x0 + Math.floor((i * bw) / n));
      out[j * n + i] = gray[base + sx]!;
    }
  }
  return out;
}

export function objectnessDescriptor(px: Px): Float64Array {
  const gray = toGray(px);
  const { mask } = buildForegroundMask(px);
  const [x0, y0, x1, y1] = bboxOfMask(mask, px.w, px.h);
  const px_ = Math.floor((x1 - x0) * 0.1) + 2;
  const py_ = Math.floor((y1 - y0) * 0.1) + 2;
  const box: [number, number, number, number] = [
    Math.max(0, x0 - px_), Math.max(0, y0 - py_), Math.min(px.w, x1 + px_), Math.min(px.h, y1 + py_),
  ];
  const g = resampleBbox(gray, px.w, px.h, box, GRID);

  const hist = new Float64Array(CELLS * CELLS * BINS);
  const cell = Math.floor(GRID / CELLS);
  for (let y = 1; y < GRID - 1; y++) {
    const row = y * GRID;
    const cy = Math.min(CELLS - 1, Math.floor(y / cell));
    for (let x = 1; x < GRID - 1; x++) {
      const gx = g[row + x + 1]! - g[row + x - 1]!;
      const gy = g[(y + 1) * GRID + x]! - g[(y - 1) * GRID + x]!;
      const mag = Math.hypot(gx, gy);
      if (mag < 1e-6) continue;
      const ang = ((Math.atan2(gy, gx) * 180) / Math.PI) % 180;
      const angPos = ang < 0 ? ang + 180 : ang;
      const bin = Math.floor((angPos / 180) * BINS) % BINS;
      const cx = Math.min(CELLS - 1, Math.floor(x / cell));
      hist[(cy * CELLS + cx) * BINS + bin]! += mag;
    }
  }
  for (let c = 0; c < CELLS * CELLS; c++) {
    const base = c * BINS;
    let norm = 0;
    for (let k = 0; k < BINS; k++) norm += hist[base + k]! ** 2;
    norm = Math.sqrt(norm) + 1e-6;
    for (let k = 0; k < BINS; k++) hist[base + k]! /= norm;
  }
  return hist;
}

export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(na * nb)));
}

export function objectnessSimilarity(reference: Px, render: Px): number {
  return cosineSimilarity(objectnessDescriptor(reference), objectnessDescriptor(render));
}
