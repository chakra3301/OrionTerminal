import { describe, expect, it } from "vitest";
import { seeded, strandCount } from "./filaments";

describe("Brain filaments", () => {
  it("gives every link a stable shape", () => {
    expect(seeded(3, 9)).toBe(seeded(3, 9));
    expect(seeded(3, 9)).not.toBe(seeded(9, 3));
    for (let i = 0; i < 50; i++) {
      const v = seeded(i, i * 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("draws thicker bundles for stronger links and caps big graphs", () => {
    expect(strandCount(1, 10)).toBeGreaterThan(strandCount(0, 10));
    expect(strandCount(1, 10)).toBe(10);
    expect(strandCount(1, 4000)).toBe(2);
  });
});
