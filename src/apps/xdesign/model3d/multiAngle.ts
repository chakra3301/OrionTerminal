/**
 * Port of img2threejs `forge/stage4_review/diagnose_render_multi_angle.py`.
 * "Multi-angle or it didn't happen": a non-planar form must hold from ≥2
 * camera angles — this catches a flat plane/decal faking volume (a
 * silhouette that reads correctly from the review angle but collapses when
 * orbited). Orbit angles use reference-free self-consistency (silhouette
 * area + aspect ratio should vary smoothly across angles, never collapse
 * toward zero or flip abruptly) — never scored against a reference angle
 * the source photo doesn't cover.
 */

import type { Px } from "./imageMetrics";
import { bboxOf, buildForegroundMask, resizeMask } from "./imageMetrics";

const MASK_SIZE = 96;

export type OrbitShot = { angleDeg: number; px: Px };

export type MultiAngleResult = {
  ok: boolean;
  degenerateAngles: number[];
  areas: number[];
  aspectRatios: number[];
  note: string;
};

/** A view is "degenerate" when its foreground silhouette area collapses to
 * near-zero relative to the max observed area — the classic tell for a flat
 * plane/billboard masquerading as a volume once you rotate past its normal. */
export function diagnoseMultiAngle(shots: OrbitShot[], collapseRatio = 0.12): MultiAngleResult {
  if (shots.length < 2) {
    return { ok: true, degenerateAngles: [], areas: [], aspectRatios: [], note: "need ≥2 angles to run this gate; skipped" };
  }
  const areas: number[] = [];
  const aspectRatios: number[] = [];
  for (const shot of shots) {
    const { mask } = buildForegroundMask(shot.px);
    const resized = resizeMask(shot.px, mask, MASK_SIZE);
    const [, , w, h] = bboxOf(resized, MASK_SIZE);
    areas.push((w * h) / (MASK_SIZE * MASK_SIZE));
    aspectRatios.push(h > 0 ? w / h : 0);
  }
  const maxArea = Math.max(...areas);
  const degenerateAngles: number[] = [];
  for (let i = 0; i < shots.length; i++) {
    if (maxArea > 0 && areas[i]! / maxArea < collapseRatio) degenerateAngles.push(shots[i]!.angleDeg);
  }
  const ok = degenerateAngles.length === 0;
  return {
    ok,
    degenerateAngles,
    areas,
    aspectRatios,
    note: ok
      ? "silhouette holds across all orbit angles"
      : `silhouette collapses at ${degenerateAngles.join(", ")}° — likely a flat plane faking volume from the review angle`,
  };
}
