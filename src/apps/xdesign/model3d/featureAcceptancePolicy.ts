/**
 * Port of img2threejs `forge/_shared/feature_acceptance_policy.py`. Shared
 * feature-level acceptance logic: caps how many critical/important features
 * a pass may claim (forces the model to group into semantic systems instead
 * of listing 20 nitpicks), and enforces per-feature score thresholds.
 */

import type { FeatureReviewTarget, ObjectSculptSpec, PassId, ReviewEntry } from "./sculptSpec";

export function featureTargetsForPass(spec: ObjectSculptSpec, passId: PassId): FeatureReviewTarget[] {
  return spec.featureReviewTargets.filter((t) => t.passIds.includes(passId));
}

/** Returns a list of human-readable failure strings; empty = gate passes. */
export function featureGateFailures(
  spec: ObjectSculptSpec,
  entry: Pick<ReviewEntry, "featureReviews">,
  passId: PassId,
): string[] {
  const policy = spec.selfCorrectLoop.visualAcceptance.featureReviewPolicy;
  if (!policy.enabled) return [];

  const targets = featureTargetsForPass(spec, passId);
  const critical = targets.filter((t) => t.tier === "critical");
  const failures: string[] = [];

  if (critical.length > policy.maxCriticalFeaturesPerPass) {
    failures.push(
      `pass "${passId}" defines ${critical.length} critical features; group them into at most ${policy.maxCriticalFeaturesPerPass} semantic systems`,
    );
  }
  const important = targets.filter((t) => t.tier === "important");
  if (important.length > policy.maxImportantFeaturesPerPass) {
    failures.push(
      `pass "${passId}" defines ${important.length} important features; keep only the ${policy.maxImportantFeaturesPerPass} most uncertain or high-value systems`,
    );
  }

  const byId = new Map(entry.featureReviews.map((r) => [r.id, r]));
  for (const target of critical) {
    const review = byId.get(target.id);
    if (!review) {
      failures.push(`critical feature "${target.id}" has no AI vision review`);
      continue;
    }
    if (review.visible === false) {
      failures.push(`critical feature "${target.id}" is not visible in the review view`);
      continue;
    }
    const min = target.minimumScore ?? policy.criticalDefaultThreshold;
    if (typeof review.score !== "number") {
      failures.push(`critical feature "${target.id}" has no numeric score`);
    } else if (review.score < min) {
      failures.push(`critical feature "${target.id}" score ${review.score.toFixed(2)} is below ${min}`);
    }
  }

  const importantIds = new Set(important.map((t) => t.id));
  const importantScores = entry.featureReviews
    .filter((r) => importantIds.has(r.id) && typeof r.score === "number")
    .map((r) => r.score);
  if (importantScores.length > 0) {
    const avg = importantScores.reduce((a, b) => a + b, 0) / importantScores.length;
    if (avg < policy.importantAverageThreshold) {
      failures.push(
        `reviewed important features average ${avg.toFixed(3)} is below ${policy.importantAverageThreshold.toFixed(3)}`,
      );
    }
  }
  return failures;
}
