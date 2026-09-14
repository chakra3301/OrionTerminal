import { describe, expect, it } from "vitest";
import { cosineSimilarity, objectnessDescriptor, objectnessSimilarity } from "./objectness";
import type { Px } from "./imageMetrics";

function squarePx(size: number, frac: number): Px {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = 255;
  const half = Math.floor((size * frac) / 2);
  const cx = size / 2, cy = size / 2;
  for (let y = cy - half; y < cy + half; y++) {
    for (let x = cx - half; x < cx + half; x++) {
      const i = (Math.floor(y) * size + Math.floor(x)) * 4;
      data[i] = 240; data[i + 1] = 240; data[i + 2] = 240; data[i + 3] = 255;
    }
  }
  return { w: size, h: size, data };
}

function offCenterSquarePx(size: number, frac: number): Px {
  const px = squarePx(size, 0); // blank
  const data = px.data;
  const half = Math.floor((size * frac) / 2);
  const cx = size * 0.3, cy = size * 0.3;
  for (let y = cy - half; y < cy + half; y++) {
    for (let x = cx - half; x < cx + half; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const i = (Math.floor(y) * size + Math.floor(x)) * 4;
      data[i] = 240; data[i + 1] = 240; data[i + 2] = 240; data[i + 3] = 255;
    }
  }
  return px;
}

describe("objectness descriptor", () => {
  it("produces a non-zero, normalized descriptor for a simple shape", () => {
    const desc = objectnessDescriptor(squarePx(96, 0.5));
    expect(desc.length).toBe(8 * 8 * 9);
    expect(desc.some((v) => v > 0)).toBe(true);
  });

  it("is scale/position invariant enough that the same shape scores near 1 with itself off-center", () => {
    const a = objectnessDescriptor(squarePx(96, 0.4));
    const b = objectnessDescriptor(offCenterSquarePx(96, 0.4));
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.5);
  });

  it("scores an identical image as maximally similar", () => {
    const px = squarePx(96, 0.4);
    expect(objectnessSimilarity(px, px)).toBeGreaterThan(0.95);
  });
});
