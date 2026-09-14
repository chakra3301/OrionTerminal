import { describe, expect, it } from "vitest";
import { newSculptSpec } from "./sculptSpec";
import { checkDetailInventory, scanZones } from "./detailInventory";

function baseSpec() {
  const spec = newSculptSpec("Chest", "ref.png");
  spec.materials.push({
    id: "wood", baseColor: "#654321", roughness: { base: 0.6, variation: 0.1 }, metalness: 0,
    opacity: { base: 1 }, localOverrides: [{ id: "stain-1", kind: "stain", region: { x: 0, y: 0, w: 0.2, h: 0.2 }, dirtAmount: 0.4 }],
  });
  spec.preSpecAssessment.detailInventory.targetMinDetails = 2;
  return spec;
}

describe("scanZones", () => {
  it("grid-3x3 produces 9 zones covering the unit square", () => {
    const zones = scanZones("grid-3x3");
    expect(zones).toHaveLength(9);
    expect(zones[0]).toEqual({ id: "zone-0-0", x: 0, y: 0, w: 1 / 3, h: 1 / 3 });
  });
  it("grid-4x4 produces 16 zones", () => {
    expect(scanZones("grid-4x4")).toHaveLength(16);
  });
});

describe("checkDetailInventory", () => {
  it("flags a detail whose mapsTo does not resolve to a real field", () => {
    const spec = baseSpec();
    spec.preSpecAssessment.detailInventory.details.push({
      id: "d1", kind: "stain", region: { x: 0, y: 0, w: 0.1, h: 0.1 }, affects: "material",
      scale: 0.5, evidenceRef: "top-left", confidence: 0.8, mapsTo: "nonexistent-id",
    });
    const report = checkDetailInventory(spec);
    expect(report.ok).toBe(false);
    expect(report.unmapped).toContain("d1");
  });

  it("counts a correctly-mapped, sufficiently-confident detail", () => {
    const spec = baseSpec();
    spec.preSpecAssessment.detailInventory.details.push({
      id: "d1", kind: "stain", region: { x: 0, y: 0, w: 0.1, h: 0.1 }, affects: "material",
      scale: 0.5, evidenceRef: "top-left", confidence: 0.8, mapsTo: "stain-1",
    });
    const report = checkDetailInventory(spec);
    expect(report.count).toBe(1);
    expect(report.unmapped).toHaveLength(0);
  });

  it("does not credit a low-confidence detail toward the target floor", () => {
    const spec = baseSpec();
    spec.preSpecAssessment.detailInventory.details.push({
      id: "d1", kind: "stain", region: { x: 0, y: 0, w: 0.1, h: 0.1 }, affects: "material",
      scale: 0.5, evidenceRef: "top-left", confidence: 0.1, mapsTo: "stain-1",
    });
    const report = checkDetailInventory(spec);
    expect(report.count).toBe(0);
    expect(report.lowConfidence).toContain("d1");
  });
});
