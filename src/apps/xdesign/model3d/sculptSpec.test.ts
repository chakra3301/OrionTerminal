import { describe, expect, it } from "vitest";
import { minimumSpecDepthFor, newSculptSpec, targetMinDetailsFor } from "./sculptSpec";

describe("sculptSpec skeleton", () => {
  it("targetMinDetailsFor scales with complexity tier", () => {
    expect(targetMinDetailsFor("simple")).toBe(3);
    expect(targetMinDetailsFor("moderate")).toBe(6);
    expect(targetMinDetailsFor("complex")).toBe(10);
    expect(targetMinDetailsFor("ultra-complex")).toBe(16);
  });

  it("minimumSpecDepthFor increases monotonically with tier", () => {
    const s = minimumSpecDepthFor("simple");
    const m = minimumSpecDepthFor("moderate");
    const c = minimumSpecDepthFor("complex");
    const u = minimumSpecDepthFor("ultra-complex");
    expect(m.macroComponents).toBeGreaterThanOrEqual(s.macroComponents);
    expect(c.mesoComponents).toBeGreaterThan(m.mesoComponents);
    expect(u.microFeatureGroups).toBeGreaterThan(c.microFeatureGroups);
  });

  it("newSculptSpec starts on blockout with an empty review history", () => {
    const spec = newSculptSpec("Test Object", "data:image/png;base64,x");
    expect(spec.sculptPipeline.currentPass).toBe("blockout");
    expect(spec.reviewHistory).toHaveLength(0);
    expect(spec.components).toHaveLength(0);
    expect(spec.selfCorrectLoop.visualAcceptance.threshold).toBeCloseTo(0.7);
  });
});
