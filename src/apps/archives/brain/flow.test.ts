import { describe, expect, it } from "vitest";
import { breath, createFlow, ensureFlow, stepFlow } from "./flow";

const cloud = () => Float32Array.from([100, 100, 1, 200, 120, 1, 150, 220, 0.8]);

describe("Brain flow", () => {
  it("never moves a node, so clicks land where the node is drawn", () => {
    const proj = cloud();
    const f = createFlow(3);
    for (let s = 0; s < 30; s++) stepFlow(f, proj, { x: 105, y: 100 }, 200);
    expect(Array.from(proj)).toEqual(Array.from(cloud()));
  });

  it("eases the cursor in, glows nearby nodes, and fades out after it leaves", () => {
    const f = createFlow(3);
    for (let s = 0; s < 60; s++) stepFlow(f, cloud(), { x: 105, y: 100 }, 200);
    expect(f.strength).toBeGreaterThan(0.9);
    expect(f.near[0]!).toBeGreaterThan(f.near[2]!);
    for (let s = 0; s < 400; s++) stepFlow(f, cloud(), null, 200);
    expect(f.strength).toBeLessThan(0.01);
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
