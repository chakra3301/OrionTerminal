import { describe, expect, it } from "vitest";
import { CURVE_POINTS, curveLut, curveSamples, drawCurve, fitCurve, smoothCurve, toningCurve } from "./curveTools";

const identity = Array.from({ length: 256 }, (_, x) => x);

describe("Curves pencil tools", () => {
  it("draws a straight stroke between two pencil positions in either direction", () => {
    const drawn = drawCurve(identity, [10, 100], [20, 200]);
    expect([drawn[9], drawn[10], drawn[15], drawn[20], drawn[21]]).toEqual([9, 100, 150, 200, 21]);
    expect(drawCurve(identity, [20, 200], [10, 100])).toEqual(drawn);
    expect(drawCurve(identity, null, [40.4, 300])[40]).toBe(255);
    expect(identity[15]).toBe(15);
  });

  it("refits a drawn curve to the engine's points, adding them where the spline strays furthest", () => {
    expect(fitCurve(identity)).toEqual([[0, 0], [255, 255]]);
    const target = curveLut([[0, 0], [128, 192], [255, 255]]), fitted = fitCurve(target);
    expect(fitted.length).toBeLessThanOrEqual(16);
    curveLut(fitted).forEach((output, input) => expect(Math.abs(output - target[input]!)).toBeLessThanOrEqual(1.5));
    const saw = identity.map(x => x % 32 * 8);
    for (const limit of [19, 16]) { const points = fitCurve(saw, limit); expect(points).toHaveLength(limit); expect([points[0], points.at(-1)]).toEqual([[0, 0], [255, 248]]); }
  });

  it("keeps to Photoshop's 16 Curves points when fitting and smoothing", () => {
    const saw = identity.map(x => x % 32 * 8);
    expect(CURVE_POINTS).toBe(16); expect(fitCurve(saw)).toHaveLength(16);
    expect(smoothCurve(fitCurve(saw, 19)).length).toBeLessThanOrEqual(16);
  });

  it("smooths the curve's values a few levels either side", () => {
    const smoothed = smoothCurve([[0, 0], [255, 255]]);
    expect(smoothed[0]![0]).toBe(0); expect(smoothed[0]![1]).toBeGreaterThan(0);
    expect(smoothed.at(-1)![0]).toBe(255); expect(smoothed.at(-1)![1]).toBeLessThan(255);
    expect(Math.abs(curveLut(smoothed)[128]! - 128)).toBeLessThanOrEqual(1.5);
    const sharp = fitCurve(identity.map(x => x < 128 ? 0 : 255)), bend = (points: [number, number][]) => { const lut = curveLut(points); return Math.max(...lut.slice(1, 255).map((y, x) => Math.abs(lut[x]! - 2 * y + lut[x + 2]!))); };
    expect(bend(smoothCurve(sharp))).toBeLessThan(bend(sharp));
  });
});

describe("HDR Toning's Toning Curve", () => {
  it("keeps only a usable curve, two to 16 points rising left to right within 0 to 255", () => {
    expect(toningCurve([[0, 10], [128, 140], [255, 250]])).toEqual([[0, 10], [128, 140], [255, 250]]);
    const fallback = [[0, 0], [255, 255]];
    for (const bad of [null, "curve", [], [[0, 0]], [[0, 0], [255]], [[0, 0], [255, Number.NaN]], [[0, 0], [256, 255]], [[0, -1], [255, 255]], [[128, 0], [128, 255]], [[200, 0], [10, 255]],
      Array.from({ length: CURVE_POINTS + 1 }, (_, i) => [i * 15, i * 15])]) expect(toningCurve(bad)).toEqual(fallback);
  });

  it("samples the drawn spline at every level, since the engine joins the points it gets with straight lines, and sends nothing while the curve is the untouched diagonal", () => {
    expect(curveSamples([[0, 0], [255, 255]])).toBeUndefined();
    const bent: [number, number][] = [[0, 0], [64, 120], [255, 255]], samples = curveSamples(bent)!;
    expect(samples).toHaveLength(256); expect(samples.map(([x]) => x)).toEqual(identity);
    expect(samples.map(([, y]) => y)).toEqual(curveLut(bent).map(y => Math.round(y * 100) / 100));
  });
});
