/**
 * Port of img2threejs `forge/stage4_review/append_review.py` +
 * `orchestrate_passes.py sync`. Records one self-correction entry per pass
 * review and recomputes `sculptPipeline` from the updated `reviewHistory`.
 * `continue` on a visual pass requires the Divine Eye's deterministic
 * verdict to not be a hard reject (pixel comparison is never itself the
 * acceptance authority — the model's vision score is — but a hard
 * geometric failure cannot be talked past by the model).
 */

import type { ObjectSculptSpec, PassId, ReviewEntry } from "./sculptSpec";
import type { DivineEyeResult } from "./divineEye";
import { featureGateFailures } from "./featureAcceptancePolicy";
import { syncPipeline } from "./passOrchestrator";

export type ReviewInput = Omit<ReviewEntry, "timestamp" | "visualAcceptanceThreshold" | "divineEye"> & {
  visualAcceptanceThreshold?: number;
  divineEye?: DivineEyeResult;
};

export type AppendReviewResult = {
  spec: ObjectSculptSpec;
  entry: ReviewEntry;
  blocked: string[]; // non-empty means `continue` was downgraded / flagged
};

/** Append a review entry, enforcing the same gates upstream enforces before
 * accepting a `continue`: Divine Eye hard-gate failure always blocks it
 * (forced down to `refine-code`), and an unmet feature-acceptance policy
 * blocks it too. The caller (the agent loop) should re-propose the action
 * when `blocked` is non-empty. */
export function appendReview(spec: ObjectSculptSpec, input: ReviewInput): AppendReviewResult {
  const blocked: string[] = [];
  let action = input.action;

  if (input.divineEye && input.divineEye.hardGateFailures.length > 0 && action === "continue") {
    blocked.push(`Divine Eye hard gate failed: ${input.divineEye.hardGateFailures.join("; ")}`);
    action = "refine-code";
  }
  if (action === "continue") {
    const failures = featureGateFailures(spec, { featureReviews: input.featureReviews }, input.passId);
    if (failures.length > 0) {
      blocked.push(...failures);
      action = "refine-spec";
    }
  }

  const entry: ReviewEntry = {
    ...input,
    action,
    timestamp: new Date().toISOString(),
    visualAcceptanceThreshold: input.visualAcceptanceThreshold ?? spec.selfCorrectLoop.visualAcceptance.threshold,
    divineEye: input.divineEye
      ? {
          verdict: input.divineEye.verdict,
          action: input.divineEye.action,
          fidelity: input.divineEye.fidelity,
          hardFailures: input.divineEye.hardGateFailures,
          reconstructionModeSuspected: input.divineEye.reconstructionModeSuspected,
        }
      : undefined,
  };

  const next = syncPipeline({ ...spec, reviewHistory: [...spec.reviewHistory, entry] });
  return { spec: next, entry, blocked };
}

export function passHistory(spec: ObjectSculptSpec, passId: PassId): ReviewEntry[] {
  return spec.reviewHistory.filter((e) => e.passId === passId);
}
