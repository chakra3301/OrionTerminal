import { describe, expect, it } from "vitest";
import { REFINE_FIELDS, effectiveSelectionOutput, selectionDefaults, selectionRequest, selectionSamplePoint } from "./selectionSettings";
import type { PhotoLayer } from "./types";
const context = { width: 800, height: 600, hasSelection: true, layer: { kind: "Raster", hasPixels: true } as PhotoLayer };
describe("selection workspace native settings", () => {
  it("validates local edge strokes without changing normal refinement parameters", () => {
    const values = { ...selectionDefaults("refine", "#000000"), edgeBrushes: [{ points: [[10, 20], [30, 40]], size: 42, erase: false }] };
    expect(selectionRequest("refine", values, context).params.edgeBrushes).toEqual(values.edgeBrushes);
    expect(selectionRequest("refine", { ...values, edgeBrushes: [] }, context).params).not.toHaveProperty("edgeBrushes");
    for (const edgeBrushes of ["bad", [{ size: 0, erase: false, points: [[1, 2]] }], [{ size: 20, erase: "no", points: [[1, 2]] }], [{ size: 20, erase: false, points: [[800, 2]] }], [{ size: 20, erase: false, points: [[1, 2, .5]] }], [{ size: 20, erase: false, points: Array(8193).fill([1, 2]) }], Array(129).fill({ size: 20, erase: false, points: [[1, 2]] })]) expect(selectionRequest("refine", { ...values, edgeBrushes }, context).problem).not.toBeNull();
  });
  it("retains exact native refine fields and makes decontamination output explicit", () => {
    const values = { ...selectionDefaults("refine", "#000000"), radius: 2.5, smooth: 12.25, feather: 3.5, contrast: 28, shiftEdge: -17, smartRadius: true, sampleAllLayers: true, decontaminate: true, amount: 42 };
    expect(effectiveSelectionOutput(values)).toBe("newLayerWithMask"); expect(selectionRequest("refine", values, context)).toEqual({ command: "select.refineEdge", problem: null, params: { radius: 2.5, smooth: 12.25, feather: 3.5, contrast: 28, shiftEdge: -17, smartRadius: true, sampleAllLayers: true, decontaminate: true, amount: 42, output: "newLayerWithMask" } });
    expect(effectiveSelectionOutput({ ...values, output: "newLayer" })).toBe("newLayer");
    const inactive = selectionRequest("refine", { ...values, decontaminate: false, amount: NaN, output: "layerMask" }, context); expect(inactive.problem).toBeNull(); expect(inactive.params).not.toHaveProperty("amount");
  });
  it("requires a selection and a suitable layer for native output conversion", () => {
    expect(selectionRequest("refine", selectionDefaults("refine", "#000000"), { ...context, hasSelection: false }).problem).toContain("Make a selection");
    expect(selectionRequest("refine", { ...selectionDefaults("refine", "#000000"), output: "layerMask" }, { ...context, layer: null }).problem).toContain("Select a layer");
    expect(selectionRequest("refine", { ...selectionDefaults("refine", "#000000"), output: "newLayer" }, { ...context, layer: { kind: "Text", hasPixels: false } as PhotoLayer }).problem).toContain("layer with pixels");
  });
  it("stops Feather at Photoshop's 250 px, keeps the Quick Selection size out of the refinement and opens without a selection", () => {
    const values = selectionDefaults("refine", "#000000");
    expect(REFINE_FIELDS.find(field => field.key === "feather")!.max).toBe(250); expect(values.quickSize).toBe(30);
    expect(selectionRequest("refine", { ...values, feather: 250 }, context).params.feather).toBe(250); expect(selectionRequest("refine", { ...values, feather: 250.5 }, context).problem).toBe("Enter Feather (px) between 0 and 250.");
    expect(selectionRequest("refine", values, context).params).not.toHaveProperty("quickSize"); expect(selectionRequest("refine", { ...values, quickSize: NaN }, context).problem).toBeNull();
    expect(selectionRequest("refine", values, { ...context, hasSelection: false }).problem).toBe("Make a selection to refine.");
  });
  it("uses native focus fractions and rejects invalid controls", () => {
    expect(selectionRequest("focus", { range: .375, noise: .125, sampleAllLayers: true, mode: "intersect" }, context)).toEqual({ command: "select.focusArea", params: { range: .375, noise: .125, sampleAllLayers: true, mode: "intersect" }, problem: null });
    for (const range of [NaN, Infinity, -1, 2]) expect(selectionRequest("focus", { ...selectionDefaults("focus", "#000000"), range }, context).problem).toContain("Focus range");
  });
  it("keeps sampled native color precision, positive/minus points and localized range", () => {
    const foreground = [.123456, 1.2, -.1, .75] as [number, number, number, number], values = { ...selectionDefaults("color", foreground), points: [[20, 25]], subtractPoints: [[30, 40]], localized: true, range: 25, sampleFuzziness: 150 };
    expect(selectionRequest("color", values, context)).toEqual({ command: "select.colorRange", problem: null, params: { select: "sampledColors", colors: [foreground], points: [[20, 25]], subtractPoints: [[30, 40]], localized: true, range: 25, fuzziness: 150, sampleAllLayers: true, invert: false, mode: "replace" } });
    expect(selectionRequest("color", { ...values, points: [], subtractPoints: [] }, context).problem).toContain("need a sample point");
  });
  it("does not leak sampled-color values into hue/proof/tonal presets", () => {
    const values = { ...selectionDefaults("color", "#ff0000"), sampleFuzziness: NaN, range: NaN, colors: ["bad"], points: [[-1, -1]], localized: true, select: "blues" };
    expect(selectionRequest("color", values, context)).toEqual({ command: "select.colorRange", problem: null, params: { select: "blues", sampleAllLayers: true, invert: false, mode: "replace" } });
    expect(selectionRequest("color", { ...values, select: "midtones", toneFuzziness: 15, midLow: 90, midHigh: 170 }, context).params).toEqual({ select: "midtones", fuzziness: 15, tonalRange: [90, 170], sampleAllLayers: true, invert: false, mode: "replace" });
    expect(selectionRequest("color", { ...values, select: "highlights", highlightLevel: 190 }, context).params.tonalRange).toBe(190);
    expect(selectionRequest("color", { ...values, select: "midtones", midLow: 170, midHigh: 90 }, context).problem).toContain("must not exceed");
  });
  it("refuses missing/invalid/oversized samples before calling native selection", () => {
    const values = selectionDefaults("color", "#ff0000");
    for (const points of [[[800, 1]], [[2, 600]], [[NaN, 5]], [[2]], "bad"]) expect(selectionRequest("color", { ...values, points }, context).problem).not.toBeNull();
    expect(selectionRequest("color", { ...values, colors: Array(65).fill("#ff0000") }, context).problem).toContain("at most 64");
    expect(selectionRequest("color", { ...values, colors: [], points: [], subtractPoints: [] }, context).problem).toContain("Pick a point");
    expect(selectionRequest("color", { ...values, colors: [], subtractPoints: [[20, 30]] }, context).problem).toContain("positive sample");
    expect(selectionRequest("color", { ...values, colors: [[1e300, 0, 0]] }, context).problem).not.toBeNull();
  });
  it("maps contain-fit image clicks to full resolution and ignores letterboxes/invalid bounds", () => {
    const bounds = { left: 10, top: 20, width: 200, height: 200 };
    expect(selectionSamplePoint(60, 95, bounds, 800, 600)).toEqual([200, 200]);
    for (const point of [[10, 20], [50, 40], [210, 95], [60, 195]]) expect(selectionSamplePoint(point[0]!, point[1]!, bounds, 800, 600)).toBeNull();
    expect(selectionSamplePoint(60, 95, { ...bounds, width: 0 }, 800, 600)).toBeNull();
    expect(selectionSamplePoint(Infinity, 95, bounds, 800, 600)).toBeNull();
  });
});
