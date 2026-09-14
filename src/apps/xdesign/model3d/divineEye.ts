/**
 * Port of img2threejs `forge/stage4_review/divine_eye.py` — "the harness
 * heart": a zero-token deterministic multi-signal ensemble. HARD gates
 * (silhouette IoU, scale delta) reject outright; SOFT signals (proportion,
 * symmetry parity, pHash, SSIM, edge overlap, blowout/flat/tonal parity,
 * objectness) are weighted into a fidelity score with self-uncertainty
 * (wide disagreement ⇒ `probe` instead of a confident verdict). Includes
 * the "reconstruction-mode rescue": when a photo reference vs a procedural
 * render fails ONLY the IoU hard gate but objectness says "same object",
 * downgrade the reject to `probe` rather than hard-failing a faithful
 * build on framing/background alone.
 *
 * This is deterministic-first, model-last: Claude's vision judgment
 * (`modelAssist.ts`) is a calibrated LAST layer — it is never consulted on
 * a hard-gate failure and can only rescue a soft near-threshold reject, it
 * can never grant `continue` past a hard geometric failure.
 */

import type { Px } from "./imageMetrics";
import {
  bboxOf, bilateralSymmetryError, blowoutParity, buildForegroundMask, edgeOverlap,
  flatFraction, globalSsim, hamming, lumaGrid, normalizedSimilarity, phashFromImage,
  proportionDelta, resizeMask, silhouetteIoU, tonalParity,
} from "./imageMetrics";
import { objectnessSimilarity } from "./objectness";

const MASK_SIZE = 96;
const LUMA_SIZE = 48;
const EDGE_SIZE = 48;

export const IOU_HARD_MIN = 0.85;
export const SCALE_HARD_MAX = 0.08;
export const FIDELITY_TARGET = 0.85;
export const DISAGREEMENT_SPREAD = 0.35;
export const ASPECT_SOFT_MAX = 0.05;
export const RECON_OBJ_MIN = 0.48;

export type DivineEyeResult = {
  verdict: "pass" | "low-confidence" | "reject";
  action: "continue" | "refine-code" | "probe";
  fidelity: number;
  fidelityTarget: number;
  hardGateFailures: string[];
  disagreementSpread: number;
  signals: {
    silhouetteIoU: number; scaleDelta: number; aspectRatioDelta: number; symmetryParity: number;
    phashSimilarity: number; ssim: number; edgeOverlap: number; blowoutParity: number;
    flatRegionScore: number; tonalParity: number; objectness: number | null;
  };
  reconstructionModeSuspected: boolean;
  weights: Record<string, number>;
};

export function evaluateDivineEye(reference: Px, render: Px): DivineEyeResult {
  const refFg = buildForegroundMask(reference);
  const renFg = buildForegroundMask(render);
  const refMask = resizeMask(reference, refFg.mask, MASK_SIZE);
  const renMask = resizeMask(render, renFg.mask, MASK_SIZE);
  const refLuma = lumaGrid(reference, LUMA_SIZE);
  const renLuma = lumaGrid(render, LUMA_SIZE);
  const refEdge = lumaGrid(reference, EDGE_SIZE);
  const renEdge = lumaGrid(render, EDGE_SIZE);

  const iou = silhouetteIoU(refMask, renMask);
  const refBox = bboxOf(refMask, MASK_SIZE), renBox = bboxOf(renMask, MASK_SIZE);
  const { aspectRatioDelta, scaleDelta } = proportionDelta(refBox, renBox);

  const symRef = bilateralSymmetryError(refMask, MASK_SIZE);
  const symRen = bilateralSymmetryError(renMask, MASK_SIZE);
  const sym = Math.max(0, 1 - Math.abs(symRen - symRef) / 0.1);

  const flatRef = flatFraction(refLuma, LUMA_SIZE);
  const flatRen = flatFraction(renLuma, LUMA_SIZE);
  const flat = Math.max(0, 1 - Math.abs(flatRen - flatRef) * 4);

  const phashSim = normalizedSimilarity(phashFromImage(reference), phashFromImage(render));
  const ssim = globalSsim(refLuma, renLuma);
  const edges = edgeOverlap(refEdge, renEdge, EDGE_SIZE);
  const blow = blowoutParity(refLuma, renLuma);
  const tonal = tonalParity(refLuma, renLuma);

  let objectness: number | null = null;
  try { objectness = objectnessSimilarity(reference, render); } catch { objectness = null; }

  const hardFailures: string[] = [];
  if (iou < IOU_HARD_MIN) hardFailures.push(`silhouette IoU ${iou.toFixed(3)} < ${IOU_HARD_MIN}`);
  if (scaleDelta > SCALE_HARD_MAX) hardFailures.push(`scale delta ${scaleDelta.toFixed(3)} > ${SCALE_HARD_MAX}`);

  const soft: Record<string, [number, number]> = {
    proportion: [Math.max(0, 1 - aspectRatioDelta / 0.05), 1.0],
    symmetry: [sym, 0.5],
    phash: [phashSim, 1.0],
    ssim: [ssim, 1.5],
    edgeOverlap: [edges, 1.0],
    blowoutParity: [blow, 0.8],
    flatRegion: [flat, 0.8],
    tonalParity: [tonal, 1.0],
  };
  if (objectness !== null) soft.objectness = [objectness, 1.5];

  let weighted = 0, totalW = 0;
  for (const [s, w] of Object.values(soft)) { weighted += s * w; totalW += w; }
  const fidelity = totalW ? weighted / totalW : 0;

  const softScores = Object.values(soft).map(([s]) => s);
  const spread = softScores.length ? Math.max(...softScores) - Math.min(...softScores) : 0;

  let verdict: DivineEyeResult["verdict"];
  let action: DivineEyeResult["action"];
  if (hardFailures.length > 0) { verdict = "reject"; action = "refine-code"; }
  else if (spread > DISAGREEMENT_SPREAD && fidelity < FIDELITY_TARGET) { verdict = "low-confidence"; action = "probe"; }
  else if (fidelity >= FIDELITY_TARGET) { verdict = "pass"; action = "continue"; }
  else { verdict = "reject"; action = "refine-code"; }

  let reconstructionModeSuspected = false;
  if (hardFailures.length > 0 && objectness !== null && objectness >= RECON_OBJ_MIN) {
    if (hardFailures.every((f) => f.includes("silhouette IoU"))) {
      reconstructionModeSuspected = true;
      if (fidelity >= FIDELITY_TARGET && scaleDelta <= SCALE_HARD_MAX && aspectRatioDelta <= ASPECT_SOFT_MAX) {
        verdict = "pass"; action = "continue";
      } else {
        verdict = "low-confidence"; action = "probe";
      }
    }
  }

  return {
    verdict, action,
    fidelity: round4(fidelity), fidelityTarget: FIDELITY_TARGET,
    hardGateFailures: hardFailures, disagreementSpread: round4(spread),
    signals: {
      silhouetteIoU: round4(iou), scaleDelta: round4(scaleDelta), aspectRatioDelta: round4(aspectRatioDelta),
      symmetryParity: round4(sym), phashSimilarity: round4(phashSim), ssim: round4(ssim), edgeOverlap: round4(edges),
      blowoutParity: round4(blow), flatRegionScore: round4(flat), tonalParity: round4(tonal),
      objectness: objectness === null ? null : round4(objectness),
    },
    reconstructionModeSuspected,
    weights: Object.fromEntries(Object.entries(soft).map(([k, [, w]]) => [k, w])),
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export { hamming };
