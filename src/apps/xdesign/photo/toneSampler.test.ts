import { describe, expect, it } from "vitest";
import { AUTO_DEFAULTS, autoPatch, samplePatch } from "./toneSampler";

const levels = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
const rgbLevels = { ...levels, red: { ...levels }, green: { ...levels }, blue: { ...levels, inWhite: 100 } };
const flat = (lo: number, hi: number) => Array.from({ length: 256 }, (_, level) => level >= lo && level <= hi ? 10 : 0);

describe("Levels and Curves eyedropper math", () => {
  it("moves each channel's input black or white to the sample and keeps two levels between them", () => {
    expect(samplePatch("levels", "black", [40, 60, 120], rgbLevels, false)).toEqual({ red: { ...levels, inBlack: 40 }, green: { ...levels, inBlack: 60 }, blue: { ...levels, inWhite: 100, inBlack: 98 } });
    expect(samplePatch("levels", "white", [200, 1, 250], rgbLevels, false, { ...AUTO_DEFAULTS, highlights: [250, 240, 230] })).toMatchObject({ red: { inWhite: 200, outWhite: 250 }, green: { inWhite: 2, outWhite: 240 }, blue: { inWhite: 250, outWhite: 230 } });
  });

  it("neutralises a gray sample at its own brightness with each channel's gamma", () => {
    const patch = samplePatch("levels", "gray", [100, 128, 156], { red: levels, green: levels, blue: levels }, false) as Record<string, { gamma: number }>;
    expect(patch.green!.gamma).toBe(1);
    // Each channel then maps its sample to the mean, 128.
    expect(255 * (100 / 255) ** (1 / patch.red!.gamma)).toBeCloseTo(128, 0);
    expect(patch.red!.gamma).toBeGreaterThan(1); expect(patch.blue!.gamma).toBeLessThan(1);
  });

  it("moves Curves end points and adds a gray point, leaving the end points alone", () => {
    const curves = { points: [[0, 0], [255, 255]], red: [[0, 0], [128, 140], [255, 255]], green: [[0, 0], [255, 255]], blue: [[0, 0], [255, 255]] };
    expect(samplePatch("curves", "black", [130, 20, 255], curves, false)).toEqual({ red: [[130, 0], [255, 255]], green: [[20, 0], [255, 255]], blue: [[253, 0], [255, 255]] });
    expect(samplePatch("curves", "white", [126, 0, 200], curves, false)).toEqual({ red: [[0, 0], [126, 255]], green: [[0, 0], [2, 255]], blue: [[0, 0], [200, 255]] });
    expect(samplePatch("curves", "gray", [126, 60, 255], curves, false)).toEqual({ red: [[0, 0], [126, 147], [255, 255]], green: [[0, 0], [60, 147], [255, 255]], blue: [[0, 0], [255, 255]] });
  });

  it("uses the one gray channel in a grayscale image", () => {
    expect(samplePatch("levels", "black", [50, 50, 50], levels, true)).toEqual({ ...levels, inBlack: 50 });
    expect(samplePatch("curves", "white", [200, 200, 200], { points: [[0, 0], [255, 255]] }, true)).toEqual({ points: [[0, 0], [200, 255]] });
  });
});

describe("Auto with Photoshop's algorithms", () => {
  const bins = [flat(20, 230), flat(30, 200), flat(10, 240), flat(0, 255)];
  it("stretches the composite for monochromatic contrast and each channel for per-channel contrast", () => {
    expect(autoPatch("levels", bins, false)).toMatchObject({ inBlack: 20, inWhite: 230, gamma: 1, red: levels, blue: levels });
    expect(autoPatch("levels", bins, false, { ...AUTO_DEFAULTS, algorithm: "perChannel", shadows: [10, 10, 10] })).toMatchObject({ inBlack: 0, inWhite: 255, red: { inBlack: 30, inWhite: 200, outBlack: 10 }, green: { inBlack: 10, inWhite: 240 } });
    expect(autoPatch("curves", bins, false, { ...AUTO_DEFAULTS, algorithm: "perChannel" })).toEqual({ points: [[0, 0], [255, 255]], red: [[30, 0], [200, 255]], green: [[10, 0], [240, 255]], blue: [[0, 0], [255, 255]] });
    expect(autoPatch("curves", bins, true)).toEqual({ points: [[20, 0], [230, 255]] });
  });
  it("clips the chosen percentage at each end", () => {
    const spread = Array.from({ length: 256 }, () => 10);
    expect(autoPatch("levels", [spread, spread, spread, spread], true, { ...AUTO_DEFAULTS, shadowClip: 5, highlightClip: 0 })).toMatchObject({ inBlack: 12, inWhite: 255 });
    expect(autoPatch("levels", [new Array(256).fill(0)], false)).toBeNull();
  });
});
