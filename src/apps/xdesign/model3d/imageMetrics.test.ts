import { describe, expect, it } from "vitest";
import {
  bboxOf, bilateralSymmetryError, buildForegroundMask, colorDistance, globalSsim, hamming,
  kmeansPalette, lumaGrid, normalizedSimilarity, phashFromImage, proportionDelta, resizeMask,
  rgbToHex, silhouetteIoU, srgbLuma, type Px,
} from "./imageMetrics";

/** A black-background canvas with a filled white square, `frac` of the
 * frame's shorter side, centered. Stand-in for a "reference photo on a
 * plain background" without touching real Canvas/DOM APIs. */
function squarePx(size: number, frac: number): Px {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = 255; // opaque
  const half = Math.floor((size * frac) / 2);
  const cx = size / 2, cy = size / 2;
  for (let y = cy - half; y < cy + half; y++) {
    for (let x = cx - half; x < cx + half; x++) {
      const i = (Math.floor(y) * size + Math.floor(x)) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
    }
  }
  return { w: size, h: size, data };
}

describe("basic color math", () => {
  it("srgbLuma is 0 for black and 1 for white", () => {
    expect(srgbLuma(0, 0, 0)).toBe(0);
    expect(srgbLuma(255, 255, 255)).toBeCloseTo(1, 5);
  });
  it("colorDistance is 0 for identical colors", () => {
    expect(colorDistance([10, 20, 30], [10, 20, 30])).toBe(0);
  });
  it("rgbToHex round-trips a known color", () => {
    expect(rgbToHex([255, 0, 128])).toBe("#FF0080");
  });
});

describe("buildForegroundMask", () => {
  it("isolates a centered square from a black background", () => {
    const px = squarePx(64, 0.5);
    const { mask, coverage } = buildForegroundMask(px);
    expect(coverage).toBeGreaterThan(0.15);
    expect(coverage).toBeLessThan(0.5);
    const center = 32 * 64 + 32;
    expect(mask[center]).toBe(1);
    expect(mask[1]).toBe(0); // corner is background
  });
});

describe("silhouette IoU + bbox", () => {
  it("is 1.0 for identical masks", () => {
    const px = squarePx(64, 0.4);
    const { mask } = buildForegroundMask(px);
    const resized = resizeMask(px, mask, 64);
    expect(silhouetteIoU(resized, resized)).toBeCloseTo(1, 5);
  });

  it("drops when the render's square is much smaller than the reference's", () => {
    const ref = squarePx(64, 0.5);
    const ren = squarePx(64, 0.15);
    const refMask = resizeMask(ref, buildForegroundMask(ref).mask, 64);
    const renMask = resizeMask(ren, buildForegroundMask(ren).mask, 64);
    expect(silhouetteIoU(refMask, renMask)).toBeLessThan(0.5);
  });

  it("proportionDelta is ~0 for two identical boxes, large for very different scale", () => {
    const same = proportionDelta([0, 0, 20, 20], [0, 0, 20, 20]);
    expect(same.scaleDelta).toBeCloseTo(0, 5);
    expect(same.aspectRatioDelta).toBeCloseTo(0, 5);
    const different = proportionDelta([0, 0, 40, 40], [0, 0, 10, 10]);
    expect(different.scaleDelta).toBeGreaterThan(0.5);
  });
});

describe("bilateralSymmetryError", () => {
  it("is 0 for a perfectly left-right symmetric mask", () => {
    const px = squarePx(64, 0.5);
    const mask = resizeMask(px, buildForegroundMask(px).mask, 64);
    expect(bilateralSymmetryError(mask, 64)).toBeCloseTo(0, 5);
  });
});

describe("bboxOf", () => {
  it("finds the tight bounding box of a mask", () => {
    const px = squarePx(64, 0.5);
    const mask = resizeMask(px, buildForegroundMask(px).mask, 64);
    const [, , w, h] = bboxOf(mask, 64);
    expect(w).toBeGreaterThan(20);
    expect(h).toBeGreaterThan(20);
  });
});

describe("globalSsim", () => {
  it("is high for identical luma grids and lower for very different ones", () => {
    const px = squarePx(48, 0.5);
    const luma = lumaGrid(px, 24);
    expect(globalSsim(luma, luma)).toBeGreaterThan(0.9);
    const other = lumaGrid(squarePx(48, 0.05), 24);
    expect(globalSsim(luma, other)).toBeLessThan(globalSsim(luma, luma));
  });
});

describe("perceptual hash", () => {
  it("hamming distance is 0 for the identical image", () => {
    const px = squarePx(32, 0.4);
    const h1 = phashFromImage(px);
    const h2 = phashFromImage(px);
    expect(hamming(h1, h2)).toBe(0);
    expect(normalizedSimilarity(h1, h2)).toBe(1);
  });
  it("differs for a visually different image", () => {
    const a = phashFromImage(squarePx(32, 0.5));
    const b = phashFromImage(squarePx(32, 0.05));
    expect(normalizedSimilarity(a, b)).toBeLessThan(1);
  });
});

describe("kmeansPalette", () => {
  it("returns hex colors even for a tiny sample set", () => {
    const palette = kmeansPalette([[255, 0, 0], [0, 255, 0], [0, 0, 255]], 3);
    expect(palette.length).toBeGreaterThan(0);
    for (const c of palette) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });
  it("falls back to a default swatch for an empty sample set", () => {
    expect(kmeansPalette([], 5)).toEqual(["#8A7A5F"]);
  });
});
