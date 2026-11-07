import { describe, expect, it } from "vitest";
import { applyDrift, DRIFT_AMPLITUDE, wander } from "./drift";
import type { LayoutNode } from "./forceLayout";

const node = (id: string, pinned = false): LayoutNode => ({
  id, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 4,
  fx: pinned ? 0 : null, fy: pinned ? 0 : null, fz: pinned ? 0 : null,
});

describe("Brain idle drift", () => {
  it("gives every note its own bounded, slow path", () => {
    const a = wander("note:a", 10);
    const b = wander("note:b", 10);
    expect(a).not.toEqual(b);
    for (let t = 0; t < 120; t += 0.7) {
      for (const v of wander("note:a", t)) expect(Math.abs(v)).toBeLessThanOrEqual(DRIFT_AMPLITUDE + 1e-9);
    }
    // Slow: one frame moves a note well under a layout unit.
    const step = wander("note:a", 10 + 1 / 60).map((v, k) => Math.abs(v - a[k]!));
    expect(Math.max(...step)).toBeLessThan(0.2);
  });

  it("moves free notes but never pinned or held ones", () => {
    const nodes = [node("free"), node("pinned", true), node("hovered")];
    for (let k = 0; k < 120; k++) applyDrift(nodes, k / 10, (k + 1) / 10, new Set([2]));
    expect(Math.hypot(nodes[0]!.x, nodes[0]!.y, nodes[0]!.z)).toBeGreaterThan(1);
    expect([nodes[1]!.x, nodes[1]!.y, nodes[1]!.z]).toEqual([0, 0, 0]);
    expect([nodes[2]!.x, nodes[2]!.y, nodes[2]!.z]).toEqual([0, 0, 0]);
  });
});
