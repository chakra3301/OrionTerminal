import { describe, expect, it } from "vitest";
import { breath, createFlow, ensureFlow, stepFlow } from "./flow";

const cloud = () => Float32Array.from([100, 100, 1, 200, 120, 1, 150, 220, 0.8]);

describe("Brain flow", () => {
  it("drifts every point a few px and never far", () => {
    const proj = cloud();
    const f = createFlow(3);
    stepFlow(f, proj, 3.2, null, 200);
    const base = cloud();
    for (let i = 0; i < 9; i += 3) {
      const d = Math.hypot(proj[i]! - base[i]!, proj[i + 1]! - base[i + 1]!);
      expect(d).toBeLessThan(20);
    }
  });

  it("pushes points from the cursor and lets them settle back", () => {
    const f = createFlow(3);
    for (let s = 0; s < 6; s++) stepFlow(f, cloud(), 0, { x: 105, y: 100 }, 200);
    expect(Math.hypot(f.ox[0]!, f.oy[0]!)).toBeGreaterThan(1);
    expect(f.near[0]!).toBeGreaterThan(0.5);
    for (let s = 0; s < 600; s++) stepFlow(f, cloud(), 0, null, 200);
    expect(Math.hypot(f.ox[0]!, f.oy[0]!)).toBeLessThan(0.05);
    expect(f.near[0]!).toBeLessThan(0.01);
  });

  it("keeps state while the graph is unchanged", () => {
    const f = createFlow(3);
    expect(ensureFlow(f, 3)).toBe(f);
    expect(ensureFlow(f, 4)).not.toBe(f);
  });

  it("breathes between 0 and 1", () => {
    expect(breath(0)).toBe(0);
    expect(breath(Math.PI / 1.1)).toBeCloseTo(1);
  });
});
