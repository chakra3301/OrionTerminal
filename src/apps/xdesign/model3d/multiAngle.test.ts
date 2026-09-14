import { describe, expect, it } from "vitest";
import { diagnoseMultiAngle } from "./multiAngle";
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

describe("diagnoseMultiAngle", () => {
  it("skips the gate with fewer than 2 shots", () => {
    const result = diagnoseMultiAngle([{ angleDeg: 0, px: squarePx(32, 0.4) }]);
    expect(result.ok).toBe(true);
    expect(result.note).toContain("need");
  });

  it("passes when silhouette area holds across angles", () => {
    const shots = [-35, 0, 35].map((angleDeg) => ({ angleDeg, px: squarePx(64, 0.4) }));
    const result = diagnoseMultiAngle(shots);
    expect(result.ok).toBe(true);
    expect(result.degenerateAngles).toHaveLength(0);
  });

  it("flags an angle where the silhouette collapses (flat plane faking volume)", () => {
    // Both shapes stay well above buildForegroundMask's "tiny mask" fallback
    // floor (~3.5% coverage) so this exercises real bbox-area collapse, not
    // the fallback path substituting the whole frame as foreground.
    const shots = [
      { angleDeg: -35, px: squarePx(64, 0.5) },
      { angleDeg: 0, px: squarePx(64, 0.5) },
      { angleDeg: 35, px: squarePx(64, 0.22) }, // much smaller silhouette from this angle
    ];
    const result = diagnoseMultiAngle(shots, 0.3);
    expect(result.ok).toBe(false);
    expect(result.degenerateAngles).toContain(35);
  });
});
