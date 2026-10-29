import { describe, expect, it } from "vitest";
import { identityTransform, perspectiveQuad, pivotTransform, resizeTransform, rotateQuad, scaleQuad, skewQuad, transformHandle, transformMatrix, type Quad, type TransformSettings } from "./transformMath";

const bounds: [number, number, number, number] = [20, 30, 100, 60];
const initial: TransformSettings = identityTransform(bounds);

describe("free transform math", () => {
  it("starts as the identity about the layer centre", () => {
    expect(initial).toMatchObject({ x: 70, y: 60, width: 100, height: 100, angle: 0, skewX: 0, skewY: 0 });
    expect(transformMatrix(bounds, initial)).toEqual([1, 0, -0, 1, 0, 0]);
  });
  it("composes centre rotation and flips without moving the pivot", () => {
    const matrix = transformMatrix(bounds, { ...initial, angle: 90, flipX: true, width: 200 });
    expect(matrix[0] * 70 + matrix[2] * 60 + matrix[4]).toBeCloseTo(70);
    expect(matrix[1] * 70 + matrix[3] * 60 + matrix[5]).toBeCloseTo(60);
    expect(matrix[1]).toBeCloseTo(-2); expect(matrix[2]).toBeCloseTo(-1);
  });
  it("expresses horizontal and vertical skew in the matrix", () => {
    const [a, b, c, d] = transformMatrix(bounds, { ...initial, skewX: 45 });
    expect([a, b, c, d].map(value => Math.round(value * 1000) / 1000)).toEqual([1, 0, 1, 1]);
    const [, b2, , d2] = transformMatrix(bounds, { ...initial, skewY: 45 });
    expect([b2, d2].map(value => Math.round(value * 1000) / 1000)).toEqual([1, 1]);
  });
  it("keeps the opposite corner fixed when resizing a rotated flipped object", () => {
    const rotated = { ...initial, angle: 90, flipX: true }, opposite = transformHandle(bounds, rotated, -1, -1), handle = transformHandle(bounds, rotated, 1, 1);
    const resized = resizeTransform(bounds, rotated, 1, 1, [handle[0] - 30, handle[1] - 100], false);
    expect(resized.width).toBeCloseTo(200); expect(resized.height).toBeCloseTo(150);
    const after = transformHandle(bounds, resized, -1, -1);
    expect(after[0]).toBeCloseTo(opposite[0]); expect(after[1]).toBeCloseTo(opposite[1]);
    const limited = resizeTransform(bounds, { ...initial, height: 200 }, 1, 1, [10000, 10000], true);
    expect(limited.width).toBe(500); expect(limited.height).toBe(1000);
  });
  it("keeps the opposite corner fixed on a skewed box and scales about the centre with Alt", () => {
    const skewed = { ...initial, angle: 20, skewX: 15 }, opposite = transformHandle(bounds, skewed, -1, -1), handle = transformHandle(bounds, skewed, 1, 1);
    const resized = resizeTransform(bounds, skewed, 1, 1, [handle[0] + 40, handle[1] + 10], false), after = transformHandle(bounds, resized, -1, -1);
    expect(after[0]).toBeCloseTo(opposite[0]); expect(after[1]).toBeCloseTo(opposite[1]);
    const centred = resizeTransform(bounds, initial, 1, 1, [170, 120], false, true);
    expect(centred).toMatchObject({ x: 70, y: 60, width: 200, height: 200 });
  });
});

describe("quad transform modes", () => {
  const box: Quad = [[0, 0], [100, 0], [100, 50], [0, 50]];
  it("skews a side along its own line and a corner along the adjacent side it follows", () => {
    expect(skewQuad(box, 0, -1, [30, 20])).toEqual([[30, 0], [130, 0], [100, 50], [0, 50]]);
    expect(skewQuad(box, 1, 0, [20, 30])).toEqual([[0, 0], [100, 30], [100, 80], [0, 50]]);
    expect(skewQuad(box, 1, -1, [30, 5])).toEqual([[0, 0], [130, 0], [100, 50], [0, 50]]);
    expect(skewQuad(box, 1, -1, [4, 30])).toEqual([[0, 0], [100, 30], [100, 50], [0, 50]]);
  });
  it("mirrors the neighbouring corner for perspective and skews on a side handle", () => {
    expect(perspectiveQuad(box, 1, -1, [-20, 4])).toEqual([[20, 0], [80, 0], [100, 50], [0, 50]]);
    expect(perspectiveQuad(box, -1, 1, [3, -20])).toEqual([[0, 20], [100, 0], [100, 50], [0, 30]]);
    expect(perspectiveQuad(box, 0, -1, [30, 20])).toEqual(skewQuad(box, 0, -1, [30, 20]));
  });
  it("scales a distorted quad about the opposite corner or only along a side axis", () => {
    expect(scaleQuad(box, 1, 1, [200, 100])).toEqual([[0, 0], [200, 0], [200, 100], [0, 100]]);
    expect(scaleQuad(box, 1, 0, [150, 25])).toEqual([[0, 0], [150, 0], [150, 50], [0, 50]]);
  });
  it("rotates a quad about a centre", () => {
    const turned = rotateQuad(box, [0, 0], Math.PI / 2);
    expect(turned[1]!.map(Math.round)).toEqual([0, 100]);
  });
  it("scales, rotates and skews about the reference point, which stays put; the centre reference changes nothing", () => {
    for (const change of [{ width: 200 }, { angle: 90, height: 50 }, { skewX: 30, flipY: true }]) {
      const pivoted = pivotTransform(bounds, initial, { ...initial, ...change }, [-1, -1]);
      expect(transformHandle(bounds, pivoted, -1, -1).map(value => Math.round(value * 1000) / 1000)).toEqual([20, 30]);
      expect(pivotTransform(bounds, initial, { ...initial, ...change }, [0, 0])).toEqual({ ...initial, ...change });
    }
    expect(pivotTransform(bounds, initial, { ...initial, width: 200 }, [1, 0])).toMatchObject({ x: 20, y: 60 });
  });
});
