/**
 * Port of img2threejs `forge/stage1_intake/extract_pbr_evidence.py`.
 * Reference-derived material evidence from a cropped image region:
 * dominant palette, a de-lit albedo estimate, a roughness estimate from
 * specular-highlight variance, and a confidence score. This is inference,
 * not inverse rendering — pixels include baked lighting — so a confidence
 * below `targetThreshold` (default 0.7) is a `request-input`/`refine-spec`
 * signal, never a silent pass, matching upstream exactly.
 */

import { delightAlbedo } from "./delight";
import {
  buildForegroundMask, kmeansPalette, representativeSamples, rgbToHex, srgbLuma, fromImageData, type Px,
} from "./imageMetrics";

export type PbrEvidence = {
  palette: string[];
  deLitAlbedo: string;
  roughnessEstimate: number;
  confidence: number;
  confidenceNotes: string[];
  cropRegion: { x: number; y: number; w: number; h: number };
};

function valueRangeOf(px: Px): number {
  let lo = 1, hi = 0;
  for (let i = 0; i < px.w * px.h; i++) {
    const l = srgbLuma(px.data[i * 4]!, px.data[i * 4 + 1]!, px.data[i * 4 + 2]!);
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  return Math.max(0, hi - lo);
}

/** Specular-highlight variance as a stand-in for roughness: a tight, bright
 * highlight cluster ⇒ low roughness (glossy); a diffuse, low-contrast field
 * ⇒ high roughness (matte). */
function roughnessFromHighlights(px: Px): number {
  const lumas: number[] = [];
  for (let i = 0; i < px.w * px.h; i++) {
    lumas.push(srgbLuma(px.data[i * 4]!, px.data[i * 4 + 1]!, px.data[i * 4 + 2]!));
  }
  const mean = lumas.reduce((a, b) => a + b, 0) / (lumas.length || 1);
  const variance = lumas.reduce((a, l) => a + (l - mean) ** 2, 0) / (lumas.length || 1);
  const brightFraction = lumas.filter((l) => l > 0.85).length / (lumas.length || 1);
  // High variance + a small, very bright fraction (a tight hotspot) ⇒ glossy.
  const glossSignal = Math.min(1, variance * 6) * Math.min(1, brightFraction * 12 + 0.15);
  return Math.max(0.05, Math.min(0.95, 1 - glossSignal * 0.9));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function extractPbrEvidence(
  cropImageData: ImageData,
  cropRegion: { x: number; y: number; w: number; h: number },
  singleImage = true,
): PbrEvidence {
  const px = fromImageData(cropImageData);
  const { mask, coverage, warnings } = buildForegroundMask(px);
  const samples = representativeSamples(px, mask);
  const palette = kmeansPalette(samples, 5);

  const delit = delightAlbedo(cropImageData, 0.6);
  const delitPx = fromImageData(delit);
  const delitSamples = representativeSamples(delitPx, mask, 2000);
  const medianR = median(delitSamples.map((s) => s[0]));
  const medianG = median(delitSamples.map((s) => s[1]));
  const medianB = median(delitSamples.map((s) => s[2]));
  const deLitAlbedo = rgbToHex([medianR, medianG, medianB]);

  const roughnessEstimate = roughnessFromHighlights(px);

  const minDim = Math.min(px.w, px.h);
  const resolutionScore = clamp(minDim / 1024, 0.35, 1.0);
  let maskScore: number;
  const notes: string[] = [];
  if (coverage >= 0.08 && coverage <= 0.82) maskScore = 1.0;
  else if (coverage >= 0.035 && coverage < 0.08) { maskScore = 0.55; notes.push("foreground mask is very small"); }
  else if (coverage > 0.9) { maskScore = 0.68; notes.push("object/background separation is weak"); }
  else maskScore = 0.78;
  const valueRange = valueRangeOf(px);
  const dynamicScore = clamp(valueRange / 0.48, 0.35, 1.0);
  const detailScore = clamp(roughnessFromHighlights(px) < 0.5 ? 0.7 : 0.5, 0.35, 1.0);
  const warningPenalty = Math.min(0.16, warnings.length * 0.035);
  const cap = singleImage ? 0.86 : 0.93;

  let confidence = 0.44 + resolutionScore * 0.14 + maskScore * 0.14 + dynamicScore * 0.12 + detailScore * 0.16 - warningPenalty;
  confidence = Math.min(cap, clamp(confidence, 0, 1));
  if (singleImage) notes.push("single-image inverse rendering cannot prove true physical PBR; confidence is capped");
  if (dynamicScore < 0.5) notes.push("low value range weakens height/roughness inference");
  notes.push(...warnings);

  return {
    palette, deLitAlbedo, roughnessEstimate: round3(roughnessEstimate),
    confidence: round3(confidence), confidenceNotes: notes, cropRegion,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 128;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const PBR_TARGET_THRESHOLD = 0.7;
