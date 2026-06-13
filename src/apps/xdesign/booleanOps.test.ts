import { describe, expect, it } from "vitest";
import { shapeToRing, booleanShapes } from "./booleanOps";
import type { Shape } from "./store";

const rect = (over: Partial<Shape> & { id: string }): Shape =>
  ({
    name: over.id,
    kind: "rect",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    radius: 0,
    fill: "#000",
    stroke: "#000",
    strokeWidth: 0,
    ...over,
  }) as Shape;

describe("shapeToRing", () => {
  it("emits the four corners of an axis-aligned rect", () => {
    const r = shapeToRing(rect({ id: "a", x: 10, y: 20, w: 30, h: 40 }));
    expect(r).toEqual([
      [10, 20],
      [40, 20],
      [40, 60],
      [10, 60],
    ]);
  });

  it("honors flipX/flipY (rect corners are symmetric, so bbox is unchanged)", () => {
    const r = shapeToRing(
      rect({ id: "a", x: 0, y: 0, w: 10, h: 10, flipX: true, flipY: true }),
    );
    const xs = r.map((p) => p[0]);
    const ys = r.map((p) => p[1]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(10);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(10);
  });

  it("rotates a rect 90° around its center", () => {
    const r = shapeToRing(
      rect({ id: "a", x: 0, y: 0, w: 20, h: 10, rotation: 90 }),
    );
    // 90° around center (10,5): top-left (0,0) -> (15,-5).
    expect(r[0]![0]).toBeCloseTo(15, 6);
    expect(r[0]![1]).toBeCloseTo(-5, 6);
  });

  it("samples an ellipse into a many-point ring within its bbox", () => {
    const r = shapeToRing(
      rect({ id: "e", kind: "ellipse", x: 0, y: 0, w: 100, h: 50 } as any),
    );
    expect(r.length).toBeGreaterThan(16);
    for (const [px, py] of r) {
      expect(px).toBeGreaterThanOrEqual(-0.001);
      expect(px).toBeLessThanOrEqual(100.001);
      expect(py).toBeGreaterThanOrEqual(-0.001);
      expect(py).toBeLessThanOrEqual(50.001);
    }
  });
});

describe("booleanShapes", () => {
  it("returns null for fewer than two shapes", () => {
    expect(booleanShapes("union", [rect({ id: "a" })])).toBeNull();
  });

  it("union of two overlapping rects spans the combined bbox", () => {
    const a = rect({ id: "a", x: 0, y: 0, w: 100, h: 100 });
    const b = rect({ id: "b", x: 50, y: 50, w: 100, h: 100 });
    const res = booleanShapes("union", [a, b]);
    expect(res).not.toBeNull();
    expect(res!.x).toBeCloseTo(0, 6);
    expect(res!.y).toBeCloseTo(0, 6);
    expect(res!.w).toBeCloseTo(150, 6);
    expect(res!.h).toBeCloseTo(150, 6);
    // L-shape outline = one ring, no holes.
    expect(res!.subpaths.length).toBe(0);
    expect(res!.points.length).toBeGreaterThanOrEqual(6);
  });

  it("intersection of two overlapping rects is the overlap square", () => {
    const a = rect({ id: "a", x: 0, y: 0, w: 100, h: 100 });
    const b = rect({ id: "b", x: 50, y: 50, w: 100, h: 100 });
    const res = booleanShapes("intersect", [a, b]);
    expect(res).not.toBeNull();
    expect(res!.x).toBeCloseTo(50, 6);
    expect(res!.y).toBeCloseTo(50, 6);
    expect(res!.w).toBeCloseTo(50, 6);
    expect(res!.h).toBeCloseTo(50, 6);
  });

  it("intersection of disjoint rects is null", () => {
    const a = rect({ id: "a", x: 0, y: 0, w: 10, h: 10 });
    const b = rect({ id: "b", x: 100, y: 100, w: 10, h: 10 });
    expect(booleanShapes("intersect", [a, b])).toBeNull();
  });

  it("subtract removes the upper shape from the bottom-most one", () => {
    // bottom = full 100x100; top = right half. Result = left half.
    const bottom = rect({ id: "bottom", x: 0, y: 0, w: 100, h: 100 });
    const top = rect({ id: "top", x: 50, y: 0, w: 50, h: 100 });
    const res = booleanShapes("subtract", [bottom, top]);
    expect(res).not.toBeNull();
    expect(res!.x).toBeCloseTo(0, 6);
    expect(res!.w).toBeCloseTo(50, 6);
    expect(res!.h).toBeCloseTo(100, 6);
  });

  it("subtract of a centered hole yields a ring plus one subpath (the hole)", () => {
    const outer = rect({ id: "outer", x: 0, y: 0, w: 100, h: 100 });
    const inner = rect({ id: "inner", x: 25, y: 25, w: 50, h: 50 });
    const res = booleanShapes("subtract", [outer, inner]);
    expect(res).not.toBeNull();
    expect(res!.w).toBeCloseTo(100, 6);
    expect(res!.subpaths.length).toBe(1);
  });

  it("normalizes points into 0..1 unit space", () => {
    const a = rect({ id: "a", x: 0, y: 0, w: 100, h: 100 });
    const b = rect({ id: "b", x: 50, y: 50, w: 100, h: 100 });
    const res = booleanShapes("union", [a, b])!;
    for (const p of res.points) {
      expect(p.x).toBeGreaterThanOrEqual(-0.001);
      expect(p.x).toBeLessThanOrEqual(1.001);
      expect(p.y).toBeGreaterThanOrEqual(-0.001);
      expect(p.y).toBeLessThanOrEqual(1.001);
    }
  });
});
