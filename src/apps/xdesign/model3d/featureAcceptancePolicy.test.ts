import { describe, expect, it } from "vitest";
import { newSculptSpec } from "./sculptSpec";
import { featureGateFailures } from "./featureAcceptancePolicy";

function specWithTargets() {
  const spec = newSculptSpec("Lamp", "ref.png");
  spec.featureReviewTargets = [
    { id: "silhouette", name: "Silhouette", tier: "critical", passIds: ["blockout"], minimumScore: 0.8, evidenceRefs: [] },
    { id: "base-shape", name: "Base shape", tier: "critical", passIds: ["blockout"], minimumScore: 0.75, evidenceRefs: [] },
  ];
  return spec;
}

describe("featureGateFailures", () => {
  it("passes when every critical feature is reviewed and above threshold", () => {
    const spec = specWithTargets();
    const failures = featureGateFailures(
      spec,
      { featureReviews: [{ id: "silhouette", score: 0.9, visible: true }, { id: "base-shape", score: 0.8, visible: true }] },
      "blockout",
    );
    expect(failures).toHaveLength(0);
  });

  it("fails a missing critical feature review", () => {
    const spec = specWithTargets();
    const failures = featureGateFailures(spec, { featureReviews: [{ id: "silhouette", score: 0.9, visible: true }] }, "blockout");
    expect(failures.some((f) => f.includes("base-shape"))).toBe(true);
  });

  it("fails a critical feature below its own threshold", () => {
    const spec = specWithTargets();
    const failures = featureGateFailures(
      spec,
      { featureReviews: [{ id: "silhouette", score: 0.5, visible: true }, { id: "base-shape", score: 0.9, visible: true }] },
      "blockout",
    );
    expect(failures.some((f) => f.includes("silhouette"))).toBe(true);
  });

  it("fails a critical feature marked not visible even with a high score", () => {
    const spec = specWithTargets();
    const failures = featureGateFailures(
      spec,
      { featureReviews: [{ id: "silhouette", score: 0.95, visible: false }, { id: "base-shape", score: 0.9, visible: true }] },
      "blockout",
    );
    expect(failures.some((f) => f.includes("silhouette") && f.includes("not visible"))).toBe(true);
  });

  it("caps critical features per pass at the policy's maxCriticalFeaturesPerPass", () => {
    const spec = newSculptSpec("Overloaded", "ref.png");
    spec.selfCorrectLoop.visualAcceptance.featureReviewPolicy.maxCriticalFeaturesPerPass = 2;
    spec.featureReviewTargets = Array.from({ length: 3 }, (_, i) => ({
      id: `f${i}`, name: `Feature ${i}`, tier: "critical" as const, passIds: ["blockout" as const], minimumScore: 0.8, evidenceRefs: [],
    }));
    const failures = featureGateFailures(spec, { featureReviews: [] }, "blockout");
    expect(failures.some((f) => f.includes("group them into at most 2"))).toBe(true);
  });

  it("no-ops when the policy is disabled", () => {
    const spec = specWithTargets();
    spec.selfCorrectLoop.visualAcceptance.featureReviewPolicy.enabled = false;
    expect(featureGateFailures(spec, { featureReviews: [] }, "blockout")).toHaveLength(0);
  });
});
