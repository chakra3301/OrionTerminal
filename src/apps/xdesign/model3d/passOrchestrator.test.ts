import { describe, expect, it } from "vitest";
import { newSculptSpec, type ReviewEntry } from "./sculptSpec";
import { checkPass, completedPasses, currentPass, passOrderFor, syncPipeline } from "./passOrchestrator";

function review(overrides: Partial<ReviewEntry>): ReviewEntry {
  return {
    timestamp: new Date().toISOString(), passId: "blockout", estimatedFidelity: 0.8, aiVisionScore: 0.8,
    visualAcceptanceThreshold: 0.7, layerScores: {}, featureReviews: [], action: "continue", summary: "ok",
    matched: [], mismatches: [], specFixes: [], codeFixes: [], evidence: [], referenceScreenshot: "", renderScreenshot: "shot.png",
    comparisonImage: "cmp.png", cameraView: "front", notes: "", aiVisionNotes: "",
    ...overrides,
  };
}

describe("passOrderFor", () => {
  it("is the 8-stage default order for an object domain", () => {
    const spec = newSculptSpec("Chair", "ref.png");
    expect(passOrderFor(spec)).toEqual([
      "blockout", "structural-pass", "form-refinement", "material-pass", "surface-pass", "lighting-pass", "interaction-pass", "optimization-pass",
    ]);
  });

  it("splices proportion-lock + feature-placement after blockout for a character domain", () => {
    const spec = newSculptSpec("Hero", "ref.png");
    spec.preSpecAssessment.objectClass.primaryDomain = "character";
    const order = passOrderFor(spec);
    expect(order[0]).toBe("blockout");
    expect(order[1]).toBe("proportion-lock");
    expect(order[2]).toBe("feature-placement");
    expect(order).toHaveLength(10);
  });
});

describe("pass gating", () => {
  it("starts locked on blockout with nothing completed", () => {
    const spec = newSculptSpec("Chair", "ref.png");
    expect(currentPass(spec)).toBe("blockout");
    expect(completedPasses(spec)).toHaveLength(0);
    expect(checkPass(spec, "structural-pass").ok).toBe(false);
  });

  it("does not unlock the next pass on a sub-threshold review", () => {
    const spec = newSculptSpec("Chair", "ref.png");
    spec.reviewHistory = [review({ aiVisionScore: 0.4 })];
    const next = syncPipeline(spec);
    expect(next.sculptPipeline.currentPass).toBe("blockout");
  });

  it("unlocks the next pass after a real continue review above threshold", () => {
    const spec = newSculptSpec("Chair", "ref.png");
    spec.reviewHistory = [review({})];
    const next = syncPipeline(spec);
    expect(next.sculptPipeline.currentPass).toBe("structural-pass");
    expect(next.sculptPipeline.completedPasses).toEqual(["blockout"]);
    expect(checkPass(next, "structural-pass").ok).toBe(true);
  });

  it("does not unlock without a comparison image even at a passing score", () => {
    const spec = newSculptSpec("Chair", "ref.png");
    spec.reviewHistory = [review({ comparisonImage: "" })];
    const next = syncPipeline(spec);
    expect(next.sculptPipeline.currentPass).toBe("blockout");
  });

  it("respects an unmet critical feature gate even with a passing global score", () => {
    const spec = newSculptSpec("Chair", "ref.png");
    spec.featureReviewTargets = [{ id: "leg-count", name: "Leg count", tier: "critical", passIds: ["blockout"], minimumScore: 0.8, evidenceRefs: [] }];
    spec.reviewHistory = [review({ featureReviews: [{ id: "leg-count", score: 0.2, visible: true }] })];
    const next = syncPipeline(spec);
    expect(next.sculptPipeline.currentPass).toBe("blockout");
  });

  it("reports complete once every pass in order is done", () => {
    let spec = newSculptSpec("Chair", "ref.png");
    for (const passId of passOrderFor(spec)) {
      spec = { ...spec, reviewHistory: [...spec.reviewHistory, review({ passId })] };
      spec = syncPipeline(spec);
    }
    expect(currentPass(spec)).toBe("complete");
  });
});
