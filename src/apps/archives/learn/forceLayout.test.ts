import { describe, it, expect } from "vitest";
import { stepForces, initialPositions, type SimNode, type SimEdge } from "./forceLayout";

describe("initialPositions", () => {
  it("places n nodes deterministically on a circle around the center", () => {
    const pos = initialPositions(["a", "b", "c"], 100, 100);
    expect(Object.keys(pos)).toHaveLength(3);
    expect(pos.a).toHaveProperty("x");
    // deterministic: same call -> same coords
    expect(initialPositions(["a", "b", "c"], 100, 100)).toEqual(pos);
  });
});

describe("stepForces", () => {
  it("pushes two overlapping unconnected nodes apart", () => {
    const nodes: SimNode[] = [
      { id: "a", x: 100, y: 100, vx: 0, vy: 0 },
      { id: "b", x: 101, y: 100, vx: 0, vy: 0 },
    ];
    const before = Math.hypot(nodes[0]!.x - nodes[1]!.x, nodes[0]!.y - nodes[1]!.y);
    let n = nodes;
    for (let i = 0; i < 20; i++) n = stepForces(n, [], 200, 200);
    const after = Math.hypot(n[0]!.x - n[1]!.x, n[0]!.y - n[1]!.y);
    expect(after).toBeGreaterThan(before);
  });

  it("pulls two far-apart connected nodes closer", () => {
    const nodes: SimNode[] = [
      { id: "a", x: 20, y: 100, vx: 0, vy: 0 },
      { id: "b", x: 380, y: 100, vx: 0, vy: 0 },
    ];
    const edges: SimEdge[] = [{ from: "a", to: "b" }];
    const before = Math.abs(nodes[0]!.x - nodes[1]!.x);
    let n = nodes;
    for (let i = 0; i < 40; i++) n = stepForces(n, edges, 400, 200);
    const after = Math.abs(n[0]!.x - n[1]!.x);
    expect(after).toBeLessThan(before);
  });

  it("keeps coordinates finite", () => {
    let n: SimNode[] = [{ id: "a", x: 50, y: 50, vx: 0, vy: 0 }, { id: "b", x: 50, y: 50, vx: 0, vy: 0 }];
    for (let i = 0; i < 50; i++) n = stepForces(n, [], 100, 100);
    for (const node of n) { expect(Number.isFinite(node.x)).toBe(true); expect(Number.isFinite(node.y)).toBe(true); }
  });
});
