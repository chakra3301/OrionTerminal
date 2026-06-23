import { describe, it, expect } from "vitest";
import { cycleLayout, treeLayout, TREE_NODE_W } from "./visualLayout";
import type { TreeItem } from "./learnTypes";

describe("cycleLayout", () => {
  it("returns null for fewer than 2 nodes", () => {
    expect(cycleLayout(0)).toBeNull();
    expect(cycleLayout(1)).toBeNull();
  });

  it("places n points around a ring with n closing arcs", () => {
    const l = cycleLayout(4)!;
    expect(l.pts).toHaveLength(4);
    expect(l.arcs).toHaveLength(4); // last arc loops back to the first
    // first node sits at the top (y < cy)
    expect(l.pts[0]!.y).toBeLessThan(l.cy);
    // all points lie ~r from center
    for (const p of l.pts) {
      const dist = Math.hypot(p.x - l.cx, p.y - l.cy);
      expect(Math.abs(dist - l.r)).toBeLessThan(0.5);
    }
  });

  it("grows the radius with node count", () => {
    expect(cycleLayout(8)!.r).toBeGreaterThan(cycleLayout(2)!.r);
  });
});

describe("treeLayout", () => {
  const tree: TreeItem[] = [
    { label: "Root", detail: "", parent: null },
    { label: "A", detail: "", parent: 0 },
    { label: "B", detail: "", parent: 0 },
    { label: "A1", detail: "", parent: 1 },
  ];

  it("returns null for an empty list", () => {
    expect(treeLayout([])).toBeNull();
  });

  it("stacks nodes by depth (root highest, grandchild lowest)", () => {
    const l = treeLayout(tree)!;
    const y = (i: number) => l.nodes.find((n) => n.index === i)!.y;
    expect(y(0)).toBeLessThan(y(1)); // root above its child
    expect(y(1)).toBeLessThan(y(3)); // child above grandchild
    expect(y(1)).toBe(y(2));         // siblings on the same row
    expect(l.nodes).toHaveLength(4);
  });

  it("draws one edge per parented node", () => {
    const l = treeLayout(tree)!;
    expect(l.edges).toHaveLength(3); // root has no parent
    expect(l.edges.every((e) => e.d.startsWith("M"))).toBe(true);
  });

  it("is cycle-safe when a node points back at an ancestor", () => {
    const cyclic: TreeItem[] = [
      { label: "X", detail: "", parent: 1 },
      { label: "Y", detail: "", parent: 0 },
    ];
    const l = treeLayout(cyclic)!;
    expect(l.nodes).toHaveLength(2);
    expect(l.width).toBeGreaterThanOrEqual(TREE_NODE_W);
  });
});
