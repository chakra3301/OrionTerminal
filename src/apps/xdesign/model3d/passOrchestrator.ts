/**
 * Port of img2threejs `forge/stage3_build/orchestrate_passes.py`. Locked
 * pass-gate state machine: `blockout → structural-pass → form-refinement →
 * material-pass → surface-pass → lighting-pass → interaction-pass →
 * optimization-pass`. A pass unlocks only after the prior pass has a review
 * with `action=continue`, backed by a global AI-vision score at/above
 * threshold AND every critical feature at/above its own threshold
 * (`featureAcceptancePolicy.ts`).
 *
 * Character/hybrid domain specs splice `proportion-lock` and
 * `feature-placement` in right after `blockout` (upstream: "character build
 * passes").
 */

import type { ObjectSculptSpec, PassId, ReviewEntry, SculptPipelineState } from "./sculptSpec";
import { DEFAULT_PASS_ORDER, VISUAL_PASS_IDS } from "./sculptSpec";
import { featureGateFailures } from "./featureAcceptancePolicy";

export function passOrderFor(spec: ObjectSculptSpec): PassId[] {
  const domain = spec.preSpecAssessment.objectClass.primaryDomain;
  if (domain === "character" || domain === "hybrid") {
    const idx = DEFAULT_PASS_ORDER.indexOf("blockout");
    return [
      ...DEFAULT_PASS_ORDER.slice(0, idx + 1),
      "proportion-lock" as PassId,
      "feature-placement" as PassId,
      ...DEFAULT_PASS_ORDER.slice(idx + 1),
    ];
  }
  return DEFAULT_PASS_ORDER;
}

function reviewCompletesPass(spec: ObjectSculptSpec, entry: ReviewEntry, passId: PassId): boolean {
  if (entry.passId !== passId || entry.action !== "continue") return false;
  if (VISUAL_PASS_IDS.has(passId) || passId === "proportion-lock" || passId === "feature-placement") {
    const threshold = entry.visualAcceptanceThreshold ?? spec.selfCorrectLoop.visualAcceptance.threshold;
    if (typeof entry.aiVisionScore !== "number" || entry.aiVisionScore < threshold) return false;
    if (!entry.renderScreenshot || !entry.comparisonImage) return false;
    if (featureGateFailures(spec, entry, passId).length > 0) return false;
  }
  return true;
}

export function completedPasses(spec: ObjectSculptSpec): PassId[] {
  const order = passOrderFor(spec);
  const done: PassId[] = [];
  for (const passId of order) {
    const hasCompletingReview = spec.reviewHistory.some((e) => reviewCompletesPass(spec, e, passId));
    if (hasCompletingReview) done.push(passId);
    else break; // locked-sequential: stop at the first incomplete pass
  }
  return done;
}

export function currentPass(spec: ObjectSculptSpec): PassId | "complete" {
  const order = passOrderFor(spec);
  const done = completedPasses(spec);
  if (done.length >= order.length) return "complete";
  return order[done.length]!;
}

export function nextRequiredEvidence(spec: ObjectSculptSpec, passId: PassId | "complete"): string[] {
  if (passId === "complete") return [];
  const evidence = ["a rendered screenshot of the current pass"];
  evidence.push("a reference-vs-render comparison sheet");
  evidence.push(`AI vision score >= ${spec.selfCorrectLoop.visualAcceptance.threshold}`);
  evidence.push("every critical feature score >= its own threshold");
  return evidence;
}

export function statusPayload(spec: ObjectSculptSpec): SculptPipelineState {
  const order = passOrderFor(spec);
  const done = completedPasses(spec);
  const cur = currentPass(spec);
  return {
    passGateMode: "locked-sequential",
    passOrder: order,
    currentPass: cur,
    completedPasses: done,
    lastCompletedPass: done.length ? done[done.length - 1]! : "",
    blockedReason: cur === "complete" ? "all build passes completed" : "",
    nextRequiredEvidence: nextRequiredEvidence(spec, cur),
  };
}

/** `orchestrate_passes.py check` — non-zero unless the requested pass is
 * unlocked (== currentPass) or already completed. */
export function checkPass(spec: ObjectSculptSpec, requestedPass: PassId): { ok: boolean; reason: string } {
  const done = completedPasses(spec);
  const cur = currentPass(spec);
  if (done.includes(requestedPass)) return { ok: true, reason: "already completed — re-review is allowed but not required" };
  if (requestedPass === cur) return { ok: true, reason: "unlocked" };
  return { ok: false, reason: `pass "${requestedPass}" is locked — current unlocked pass is "${cur}"` };
}

/** `orchestrate_passes.py sync` — recompute `sculptPipeline` from
 * `reviewHistory`. Call after appending a review. */
export function syncPipeline(spec: ObjectSculptSpec): ObjectSculptSpec {
  return { ...spec, sculptPipeline: statusPayload(spec) };
}
