import { describe, expect, it } from "vitest";
import { adjustmentDefaults } from "./adjustmentSettings";
import {
  ADAPTIVE_WIDE_ANGLE_ACTION,
  LENS_CORRECTION_ACTION,
  LENS_FILTERS,
  validAdaptiveWideAngleSettings,
  type AdaptiveWideAngleSettings,
} from "./lensFilters";

describe("native lens correction filter metadata", () => {
  it("matches pinned Lens Correction defaults and exposes every supported correction", () => {
    expect(LENS_FILTERS.map(action => action.id)).toEqual(["filter.lensCorrection", "filter.adaptiveWideAngle"]);
    expect(LENS_CORRECTION_ACTION.structured).toBe("lens");
    expect(adjustmentDefaults(LENS_CORRECTION_ACTION, "RGB")).toEqual({
      focalLength: 0, distortion: 0, redCyan: 0, blueYellow: 0, vignetteAmount: 0,
      vignetteMidpoint: 50, vertical: 0, horizontal: 0, angle: 0, scale: 100,
      profile: "none", correctDistortion: true, correctVignette: true, correctCA: true,
      autoScale: false, edge: "transparency", edgeColor: "#000000",
    });
    expect(LENS_CORRECTION_ACTION.fields?.map(({ key, min, max }) => [key, min, max])).toEqual([
      ["focalLength", 0, 200], ["distortion", -100, 100], ["redCyan", -100, 100],
      ["blueYellow", -100, 100], ["vignetteAmount", -100, 100], ["vignetteMidpoint", 0, 100],
      ["vertical", -100, 100], ["horizontal", -100, 100], ["angle", -180, 180], ["scale", 50, 150],
    ]);
    expect(LENS_CORRECTION_ACTION.options?.map(option => [option.key, option.value])).toEqual([
      ["profile", "none"], ["correctDistortion", true], ["correctVignette", true],
      ["correctCA", true], ["autoScale", false], ["edge", "transparency"], ["edgeColor", "#000000"],
    ]);
  });

  it("keeps Adaptive Wide Angle settings distinct from image-coordinate constraints", () => {
    expect(ADAPTIVE_WIDE_ANGLE_ACTION.structured).toBe("wide");
    expect(adjustmentDefaults(ADAPTIVE_WIDE_ANGLE_ACTION, "RGB")).toEqual({
      model: "auto", focalLength: 0, cropFactor: 1, scale: 100, interpolation: "bicubic", constraints: [],
    });
    expect(ADAPTIVE_WIDE_ANGLE_ACTION.options?.[0]).toEqual({
      key: "model", label: "Lens model", kind: "enum", value: "auto",
      choices: ["auto", "fisheye", "perspective", "fullSpherical"],
    });
    expect(ADAPTIVE_WIDE_ANGLE_ACTION.options?.[1]).toEqual({
      key: "interpolation", label: "Interpolation", kind: "enum", value: "bicubic",
      choices: ["nearest", "bilinear", "bicubic"],
    });
  });

  it("accepts finite in-canvas line constraints and allows unconstrained scaling and rejects malformed input", () => {
    const valid: AdaptiveWideAngleSettings = {
      model: "fisheye", focalLength: 12, cropFactor: 1.5, scale: 100, interpolation: "bilinear",
      constraints: [
        { a: [10, 20], b: [90, 24], orientation: "horizontal" },
        { a: [15, 10], b: [17, 90], orientation: "vertical" },
      ],
    };
    expect(validAdaptiveWideAngleSettings({ ...valid }, 100, 100)).toBe(true);
    expect(validAdaptiveWideAngleSettings({ ...valid, constraints: [] }, 100, 100)).toBe(true);
    expect(validAdaptiveWideAngleSettings({ ...valid, constraints: [{ a: [10, 10], b: [10, 10], orientation: "free" }] }, 100, 100)).toBe(false);
    expect(validAdaptiveWideAngleSettings({ ...valid, constraints: [{ a: [10, 10], b: [101, 10], orientation: "free" }] }, 100, 100)).toBe(false);
    expect(validAdaptiveWideAngleSettings({ ...valid, constraints: [{ a: [10, 10], b: [20, Number.NaN], orientation: "free" }] }, 100, 100)).toBe(false);
    expect(validAdaptiveWideAngleSettings({ ...valid, focalLength: 201 }, 100, 100)).toBe(false);
    expect(validAdaptiveWideAngleSettings({ ...valid, interpolation: "unknown" as AdaptiveWideAngleSettings["interpolation"] }, 100, 100)).toBe(false);
    expect(validAdaptiveWideAngleSettings({ ...valid, constraints: [null] }, 100, 100)).toBe(false);
    expect(validAdaptiveWideAngleSettings({ ...valid, constraints: Array(129).fill(valid.constraints[0]) }, 100, 100)).toBe(false);
    expect(validAdaptiveWideAngleSettings({ ...valid }, 0, 100)).toBe(false);
  });
});
