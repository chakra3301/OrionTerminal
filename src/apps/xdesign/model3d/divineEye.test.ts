import { describe, expect, it } from "vitest";
import { evaluateDivineEye, IOU_HARD_MIN, SCALE_HARD_MAX } from "./divineEye";
import type { Px } from "./imageMetrics";

function squarePx(size: number, frac: number): Px {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = 255;
  const half = Math.floor((size * frac) / 2);
  const cx = size / 2, cy = size / 2;
  for (let y = cy - half; y < cy + half; y++) {
    for (let x = cx - half; x < cx + half; x++) {
      const i = (Math.floor(y) * size + Math.floor(x)) * 4;
      data[i] = 235; data[i + 1] = 235; data[i + 2] = 235; data[i + 3] = 255;
    }
  }
  return { w: size, h: size, data };
}

describe("evaluateDivineEye", () => {
  it("passes with no hard failures when reference and render are identical", () => {
    const px = squarePx(96, 0.45);
    const result = evaluateDivineEye(px, px);
    expect(result.hardGateFailures).toHaveLength(0);
    expect(result.verdict).toBe("pass");
    expect(result.action).toBe("continue");
    expect(result.fidelity).toBeGreaterThan(0.85);
  });

  it("hard-fails on a large scale delta between reference and render", () => {
    const ref = squarePx(96, 0.6);
    const ren = squarePx(96, 0.1);
    const result = evaluateDivineEye(ref, ren);
    expect(result.signals.scaleDelta).toBeGreaterThan(SCALE_HARD_MAX);
    expect(result.hardGateFailures.length).toBeGreaterThan(0);
    expect(result.verdict).toBe("reject");
    expect(result.action).toBe("refine-code");
  });

  it("reports silhouette IoU below the hard minimum for very different silhouettes", () => {
    const ref = squarePx(96, 0.5);
    const ren = squarePx(96, 0.05);
    const result = evaluateDivineEye(ref, ren);
    expect(result.signals.silhouetteIoU).toBeLessThan(IOU_HARD_MIN);
  });

  it("never grants continue on a hard gate failure regardless of soft signals", () => {
    const ref = squarePx(96, 0.7);
    const ren = squarePx(96, 0.05);
    const result = evaluateDivineEye(ref, ren);
    expect(result.action).not.toBe("continue");
  });
});
