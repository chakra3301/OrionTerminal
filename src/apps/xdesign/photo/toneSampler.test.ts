import { beforeEach, describe, expect, it } from "vitest";
import { AUTO_DEFAULTS, autoPatch, curvePointFor, readAutoOptions, samplePatch, type AutoColors, type AutoOptions } from "./toneSampler";

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

  it("adds no point past Photoshop's 16 with the gray eyedropper or the on-image tool", () => {
    const full = Array.from({ length: 16 }, (_, index) => [index * 17, index * 17] as [number, number]);
    expect(samplePatch("curves", "gray", [110, 110, 110], { points: full }, true)).toEqual({ points: full });
    expect(curvePointFor(full, 110)).toBeNull(); expect(curvePointFor(full.slice(0, 15), 110)!.points).toHaveLength(16);
  });

  it("uses the one gray channel in a grayscale image", () => {
    expect(samplePatch("levels", "black", [50, 50, 50], levels, true)).toEqual({ ...levels, inBlack: 50 });
    expect(samplePatch("curves", "white", [200, 200, 200], { points: [[0, 0], [255, 255]] }, true)).toEqual({ points: [[0, 0], [200, 255]] });
  });
});

describe("Auto with Photoshop's algorithms", () => {
  const bins = [flat(20, 230), flat(30, 200), flat(10, 240), flat(0, 255)], mono: AutoOptions = { ...AUTO_DEFAULTS, algorithm: "monochromatic" };
  const mean = (counts: number[]) => counts.reduce((sum, count, level) => sum + count * level, 0) / counts.reduce((sum, count) => sum + count, 0);
  it("stretches the composite for monochromatic contrast and each channel for per-channel contrast", () => {
    expect(autoPatch("levels", bins, false, mono)).toMatchObject({ inBlack: 20, inWhite: 230, gamma: 1, red: levels, blue: levels });
    expect(autoPatch("levels", bins, false, { ...AUTO_DEFAULTS, algorithm: "perChannel", shadows: [10, 10, 10] })).toMatchObject({ inBlack: 0, inWhite: 255, red: { inBlack: 30, inWhite: 200, outBlack: 10 }, green: { inBlack: 10, inWhite: 240 } });
    expect(autoPatch("curves", bins, false, { ...AUTO_DEFAULTS, algorithm: "perChannel" })).toEqual({ points: [[0, 0], [255, 255]], red: [[30, 0], [200, 255]], green: [[10, 0], [240, 255]], blue: [[0, 0], [255, 255]] });
    expect(autoPatch("curves", bins, true, mono)).toEqual({ points: [[20, 0], [230, 255]] });
  });
  it("defaults to Enhance Brightness and Contrast, which also brings the average to mid-gray", () => {
    expect(AUTO_DEFAULTS).toEqual({ algorithm: "brightnessContrast", snap: false, shadows: [0, 0, 0], midtones: [128, 128, 128], highlights: [255, 255, 255], shadowClip: .1, highlightClip: .1 });
    const dark = Array.from({ length: 256 }, (_, level) => level >= 20 && level < 70 ? 30 : level >= 70 && level <= 220 ? 10 : 0), average = mean(dark);
    const patch = autoPatch("levels", [dark, dark, dark, dark], false) as Record<string, number>;
    expect(patch).toMatchObject({ inBlack: 20, inWhite: 220, red: levels, green: levels, blue: levels }); expect(patch.gamma).toBeGreaterThan(1);
    expect(255 * ((average - 20) / 200) ** (1 / patch.gamma!)).toBeCloseTo(127.5, 0);
    expect(autoPatch("curves", [dark, dark, dark, dark], false)).toEqual({ points: [[20, 0], [Math.round(average), 128], [220, 255]], red: [[0, 0], [255, 255]], green: [[0, 0], [255, 255]], blue: [[0, 0], [255, 255]] });
    expect(autoPatch("curves", [dark], true)).toEqual({ points: [[20, 0], [Math.round(average), 128], [220, 255]] });
    // An even histogram is already centred, so the stretch alone puts its average at mid-gray.
    expect(autoPatch("levels", bins, false)).toMatchObject({ inBlack: 20, inWhite: 230, gamma: 1 }); expect(autoPatch("curves", bins, true)).toEqual({ points: [[20, 0], [230, 255]] });
  });
  it("finds each channel's average darkest and lightest levels, clipping less than per-channel contrast", () => {
    const tones = [flat(0, 119), flat(0, 99), flat(10, 109), flat(20, 119)], options: AutoOptions = { ...AUTO_DEFAULTS, algorithm: "darkLight", shadowClip: 5, highlightClip: 5 };
    expect(autoPatch("levels", tones, false, options)).toMatchObject({ inBlack: 0, inWhite: 255, gamma: 1, red: { inBlack: 2, inWhite: 97 }, green: { inBlack: 12, inWhite: 107 }, blue: { inBlack: 22, inWhite: 117 } });
    expect(autoPatch("levels", tones, false, { ...options, algorithm: "perChannel" })).toMatchObject({ red: { inBlack: 5, inWhite: 94 } });
    expect(autoPatch("curves", tones, false, { ...options, shadows: [10, 20, 30] })).toEqual({ points: [[0, 0], [255, 255]], red: [[2, 10], [97, 255]], green: [[12, 20], [107, 255]], blue: [[22, 30], [117, 255]] });
    expect(autoPatch("levels", tones, true, options)).toEqual({ ...levels, inBlack: 3, inWhite: 117 });
  });
  it("snaps a nearly neutral average to gray at its own brightness, after the composite, and leaves a colourful one", () => {
    const tones = [flat(0, 255), flat(0, 230), flat(0, 255), flat(25, 255)], snap: AutoOptions = { ...mono, snap: true };
    const patch = autoPatch("levels", tones, false, snap) as Record<string, Record<string, number>>, brightness = (mean(tones[1]!) + mean(tones[2]!) + mean(tones[3]!)) / 3;
    expect(patch.green!.gamma).toBe(1); expect(patch.red!.gamma).toBeGreaterThan(1); expect(patch.blue!.gamma).toBeLessThan(1);
    for (const [index, key] of ["red", "green", "blue"].entries()) expect(Math.abs(255 * (mean(tones[index + 1]!) / 255) ** (1 / patch[key]!.gamma!) - brightness)).toBeLessThan(1);
    expect(autoPatch("curves", tones, false, snap)).toEqual({ points: [[0, 0], [255, 255]], red: [[0, 0], [115, 128], [255, 255]], green: [[0, 0], [255, 255]], blue: [[0, 0], [140, 128], [255, 255]] });
    const colourful = [flat(0, 255), flat(0, 100), flat(0, 255), flat(100, 255)];
    expect(autoPatch("levels", colourful, false, snap)).toMatchObject({ red: { gamma: 1 }, blue: { gamma: 1 } });
    expect(autoPatch("levels", tones, true, snap)).toEqual({ ...levels });
  });
  it("takes Find Dark & Light Colors and the neutral to snap from the colours the host found in the pixels", () => {
    const tones = [flat(0, 255), flat(0, 230), flat(0, 255), flat(25, 255)], colors: AutoColors = { dark: [12.4, 40, 8], light: [230, 210.6, 250], neutral: [100, 120, 140] }, snap: AutoOptions = { ...mono, snap: true };
    expect(autoPatch("levels", tones, false, { ...AUTO_DEFAULTS, algorithm: "darkLight" }, colors)).toMatchObject({ inBlack: 0, inWhite: 255, red: { inBlack: 12, inWhite: 230, gamma: 1 }, green: { inBlack: 40, inWhite: 211 }, blue: { inBlack: 8, inWhite: 250 } });
    expect(autoPatch("curves", tones, false, snap, colors)).toEqual({ points: [[0, 0], [255, 255]], red: [[0, 0], [100, 120], [255, 255]], green: [[0, 0], [255, 255]], blue: [[0, 0], [140, 120], [255, 255]] });
    // With no nearly neutral pixels there is nothing to snap, though the channel averages are close to gray.
    expect(autoPatch("curves", tones, false, snap, { ...colors, neutral: null })).toEqual({ points: [[0, 0], [255, 255]], red: [[0, 0], [255, 255]], green: [[0, 0], [255, 255]], blue: [[0, 0], [255, 255]] });
  });
  describe("saved options", () => {
    beforeEach(() => localStorage.clear());
    it("keeps valid saved options and replaces anything else with Photoshop's defaults", () => {
      localStorage.setItem("xdesign.photo.autoColorOptions", JSON.stringify({ algorithm: "darkLight", snap: true, shadows: [10, 20, 30], midtones: [120, 128, 136], highlights: [250, 251, 252], shadowClip: .5, highlightClip: 2 }));
      expect(readAutoOptions()).toEqual({ algorithm: "darkLight", snap: true, shadows: [10, 20, 30], midtones: [120, 128, 136], highlights: [250, 251, 252], shadowClip: .5, highlightClip: 2 });
      localStorage.setItem("xdesign.photo.autoColorOptions", JSON.stringify({ algorithm: "bogus", snap: "yes", shadows: [0, 300, -5.4], midtones: [1, 2], highlights: [255, "x", 255], shadowClip: 50, highlightClip: -1, extra: 1 }));
      expect(readAutoOptions()).toEqual({ ...AUTO_DEFAULTS, shadows: [0, 255, 0], shadowClip: 9.99, highlightClip: 0 });
      for (const stored of ["[1,2]", "null", "{oops", "7"]) { localStorage.setItem("xdesign.photo.autoColorOptions", stored); expect(readAutoOptions()).toEqual(AUTO_DEFAULTS); }
    });
  });
  it("clips the chosen percentage at each end", () => {
    const spread = Array.from({ length: 256 }, () => 10);
    expect(autoPatch("levels", [spread, spread, spread, spread], true, { ...AUTO_DEFAULTS, shadowClip: 5, highlightClip: 0 })).toMatchObject({ inBlack: 12, inWhite: 255 });
    expect(autoPatch("levels", [new Array(256).fill(0)], false)).toBeNull();
  });
});
