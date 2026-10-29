import { describe, expect, it } from "vitest";
import type { PathData, PathKnot } from "./PathEditOverlay";
import { alignSubpaths, constraintGestureOptions, deleteKnot, insertKnot, nearestKnot, nearestSegment, pathBounds, resizeMatrix, shapeGeometryPath, uniformMove } from "./vectorGeometry";

const corner = (x: number, y: number): PathKnot => ({ anchor: [x, y], in: [x, y], out: [x, y], smooth: false });
const K = 0.5522847498307934;

describe("shape geometry as a path (Path mode)", () => {
  it("draws rectangles clockwise from the top-left, as the engine's live shapes do", () => {
    expect(shapeGeometryPath({ kind: "rect", rect: [10, 20, 30, 40] })).toEqual({ subpaths: [{ closed: true, knots: [corner(10, 20), corner(40, 20), corner(40, 60), corner(10, 60)] }] });
  });
  it("rounds only the corners with a radius and clamps radii to the sides", () => {
    const knots = shapeGeometryPath({ kind: "roundedRect", rect: [0, 0, 100, 50], radii: [10, 0, 0, 0] }).subpaths[0]!.knots;
    expect(knots).toEqual([
      { anchor: [10, 0], in: [10 - K * 10, 0], out: [10, 0], smooth: false }, corner(100, 0), corner(100, 50), corner(0, 50),
      { anchor: [0, 10], in: [0, 10], out: [0, 10 - K * 10], smooth: false },
    ]);
    const pill = shapeGeometryPath({ kind: "roundedRect", rect: [0, 0, 100, 50], radii: 100 }).subpaths[0]!.knots;
    expect(pill.map(knot => knot.anchor)).toEqual([[25, 0], [75, 0], [100, 25], [75, 50], [25, 50], [0, 25]]);
  });
  it("draws ellipses, polygons and line bars", () => {
    const ellipse = shapeGeometryPath({ kind: "ellipse", rect: [0, 0, 20, 10] }).subpaths[0]!.knots;
    expect(ellipse[0]).toEqual({ anchor: [10, 0], in: [10 - 10 * K, 0], out: [10 + 10 * K, 0], smooth: true });
    expect(ellipse.map(knot => knot.anchor)).toEqual([[10, 0], [20, 5], [10, 10], [0, 5]]);
    expect(shapeGeometryPath({ kind: "polygon", rect: [0, 0, 2, 2], sides: 4 }).subpaths[0]!.knots.map(knot => knot.anchor.map(v => Math.round(v * 1000) / 1000))).toEqual([[1, 0], [2, 1], [1, 2], [0, 1]]);
    expect(shapeGeometryPath({ kind: "polygon", rect: [0, 0, 2, 2], sides: 3, starRatio: .5 }).subpaths[0]!.knots).toHaveLength(6);
    expect(shapeGeometryPath({ kind: "line", from: [0, 0], to: [10, 0], weight: 4 }).subpaths[0]!.knots.map(knot => knot.anchor)).toEqual([[0, 2], [10, 2], [10, -2], [0, -2]]);
  });
});

describe("path bounds and resizing", () => {
  it("measures the curve, not its handles", () => {
    expect(pathBounds(shapeGeometryPath({ kind: "ellipse", rect: [5, 5, 20, 10] }))).toEqual({ x: 5, y: 5, width: 20, height: 10 });
    const bulge: PathData = { subpaths: [{ closed: false, knots: [{ anchor: [0, 0], in: [0, 0], out: [0, -40], smooth: false }, { anchor: [10, 0], in: [10, -40], out: [10, 0], smooth: false }] }] };
    expect(pathBounds(bulge)).toEqual({ x: 0, y: -30, width: 10, height: 30 });
    expect(pathBounds({ subpaths: [] })).toBeNull();
  });
  it("scales from the top-left corner to the typed size", () => {
    expect(resizeMatrix({ x: 10, y: 20, width: 50, height: 40 }, 100, 20)).toEqual([2, 0, 0, .5, -10, 10]);
    expect(resizeMatrix({ x: 0, y: 0, width: 0, height: 40 }, 100, 20)).toBeNull();
  });
});

describe("path alignment", () => {
  const two: PathData = { subpaths: [shapeGeometryPath({ kind: "rect", rect: [0, 0, 10, 10] }).subpaths[0]!, shapeGeometryPath({ kind: "rect", rect: [30, 20, 20, 20] }).subpaths[0]!] };
  it("aligns each component to the other components' bounds", () => {
    const { path, moves } = alignSubpaths(two, "right", pathBounds(two)!);
    expect(moves).toEqual([[40, 0], [0, 0]]);
    expect(path.subpaths[0]!.knots[0]!.anchor).toEqual([40, 0]);
    expect(alignSubpaths(two, "vcenter", pathBounds(two)!).moves).toEqual([[0, 15], [0, -10]]);
  });
  it("moves a single component to the canvas as one move that keeps a live shape", () => {
    const one: PathData = { subpaths: [two.subpaths[1]!] };
    const { moves } = alignSubpaths(one, "bottom", { x: 0, y: 0, width: 100, height: 100 });
    expect(uniformMove(moves)).toEqual([0, 60]);
    expect(uniformMove(alignSubpaths(two, "left", pathBounds(two)!).moves)).toBeNull();
  });
});

describe("Auto Add/Delete knot edits", () => {
  const line: PathData = { subpaths: [{ closed: false, knots: [corner(0, 0), corner(100, 0)] }] };
  it("finds the segment under the pointer and splits it there without changing the curve", () => {
    const hit = nearestSegment(line, [40, 2], 4)!;
    expect(hit).toMatchObject({ subpath: 0, segment: 0 }); expect(insertKnot(line, 0, 0, hit.t).subpaths[0]!.knots[1]!.anchor[0]).toBeCloseTo(40, 2);
    expect(nearestSegment(line, [40, 9], 4)).toBeNull();
    const added = insertKnot(line, 0, 0, .5).subpaths[0]!.knots;
    expect(added).toEqual([corner(0, 0), corner(50, 0), corner(100, 0)]);
    const curve: PathData = { subpaths: [{ closed: false, knots: [{ anchor: [0, 0], in: [0, 0], out: [0, 30], smooth: false }, { anchor: [30, 0], in: [30, 30], out: [30, 0], smooth: false }] }] };
    const split = insertKnot(curve, 0, 0, .5).subpaths[0]!.knots;
    expect(split[0]!.out).toEqual([0, 15]); expect(split[1]).toEqual({ anchor: [15, 22.5], in: [7.5, 22.5], out: [22.5, 22.5], smooth: true }); expect(split[2]!.in).toEqual([30, 15]);
  });
  it("splits a closed path's closing segment and deletes a knot under the pointer", () => {
    const square = shapeGeometryPath({ kind: "rect", rect: [0, 0, 10, 10] });
    expect(nearestSegment(square, [0, 5], 2)).toMatchObject({ segment: 3 });
    expect(insertKnot(square, 0, 3, .5).subpaths[0]!.knots.at(-1)!.anchor).toEqual([0, 5]);
    expect(nearestKnot(square, [9, 9], 2)).toEqual({ subpath: 0, knot: 2 });
    expect(deleteKnot(square, 0, 2).subpaths[0]!.knots.map(knot => knot.anchor)).toEqual([[0, 0], [10, 0], [0, 10]]);
    expect(deleteKnot({ subpaths: [{ closed: false, knots: [corner(0, 0)] }, square.subpaths[0]!] }, 0, 0).subpaths).toHaveLength(1);
  });
});

describe("shape gear constraints", () => {
  it("map onto the selection gesture's fixed ratio and fixed size", () => {
    expect(constraintGestureOptions({ kind: "unconstrained", width: 100, height: 50, fromCenter: false })).toEqual({ style: "normal", fromCenter: false });
    expect(constraintGestureOptions({ kind: "square", width: 100, height: 50, fromCenter: true })).toEqual({ style: "fixedRatio", ratioWidth: 1, ratioHeight: 1, fromCenter: true });
    expect(constraintGestureOptions({ kind: "fixedSize", width: 100, height: 50, fromCenter: false })).toEqual({ style: "fixedSize", fixedWidth: 100, fixedHeight: 50, fromCenter: false });
    expect(constraintGestureOptions({ kind: "proportional", width: 16, height: 9, fromCenter: false })).toEqual({ style: "fixedRatio", ratioWidth: 16, ratioHeight: 9, fromCenter: false });
  });
});
