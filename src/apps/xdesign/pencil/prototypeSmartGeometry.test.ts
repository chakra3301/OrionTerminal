import { expect, it } from 'vitest';
import { smartCss, smartGeometryCompatible, smartIdentity, smartInverse, smartLocalAt, smartMultiply, smartPoint, smartWorldAt, type SmartMatrix, type SmartPose } from './prototypeSmartGeometry';
const pose = (matrix: SmartMatrix, width = 100, height = 100): SmartPose => ({ matrix, width, height, opacity: 1 });
function affine(x: number, y: number, degrees: number, sx = 1, sy = 1): SmartMatrix { const angle = degrees * Math.PI / 180; return [Math.cos(angle) * sx, Math.sin(angle) * sx, -Math.sin(angle) * sy, Math.cos(angle) * sy, x, y]; }
function near(actual: SmartMatrix, expected: SmartMatrix) { actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 8)); }
it('inverts translated/rotated/sheared/flipped matrices and maps corners in their actual coordinate system', () => {
  for (const matrix of [affine(30, 50, 35, 2, 0.5), affine(-20, 80, -70, 1, -1), affine(30, 50, 35, 0.000001, 0.000001), [1, 0.4, 0.7, 2, 90, -80] as SmartMatrix]) {
    near(smartMultiply(matrix, smartInverse(matrix)), smartIdentity()); near(smartMultiply(smartInverse(matrix), matrix), smartIdentity());
    const point = smartPoint(matrix, 12.5, -9.25), original = smartPoint(smartInverse(matrix), ...point); expect(original[0]).toBeCloseTo(12.5, 8); expect(original[1]).toBeCloseTo(-9.25, 8);
  }
});
it('places destination-domain corners exactly on both endpoint rectangles including rotation, flips and resize', () => {
  const from = pose(affine(10, 20, 35, 0.5, -0.5), 50, 150), to = pose(affine(80, -20, 80, 0.75, -0.75), 200, 100);
  for (const [x, y] of [[0, 0], [200, 0], [0, 100], [200, 100]]) {
    const a = smartPoint(smartWorldAt(from, to, 0), x!, y!), expected = smartPoint(from.matrix, x! * from.width / to.width, y! * from.height / to.height); expect(a[0]).toBeCloseTo(expected[0], 8); expect(a[1]).toBeCloseTo(expected[1], 8);
    expect(smartPoint(smartWorldAt(from, to, 1), x!, y!)).toEqual(smartPoint(to.matrix, x!, y!));
  }
});
it('preserves a rigid rotation instead of shrinking it through a matrix average and takes the short turn across 360°', () => {
  const a = pose(affine(0, 0, 0)), b = pose(affine(100, 200, 90)); near(smartWorldAt(a, b, 0.5), affine(50, 100, 45));
  near(smartWorldAt(pose(affine(0, 0, 350)), pose(affine(0, 0, 10)), 0.5), smartIdentity());
  near(smartWorldAt(a, b, 1.2), affine(120, 240, 108));
});
it('compensates nested moving/resizing/rotating parents so a child follows its independently authored world trajectory', () => {
  const parent = { from: pose(affine(20, 30, 20), 100, 80), to: pose(affine(150, 200, 80), 240, 120) }, layout: SmartMatrix = [1, 0, 0, 1, 15, 25];
  const from = pose(smartMultiply(parent.from.matrix, affine(40, 10, -10)), 20, 30), to = pose(smartMultiply(parent.to.matrix, smartMultiply(layout, affine(0, 0, 15))), 40, 50);
  for (const progress of [0, 0.1, 0.5, 0.9, 1, 1.05]) {
    const local = smartLocalAt(from, to, progress, layout, parent), actual = smartMultiply(smartWorldAt(parent.from, parent.to, progress), smartMultiply(layout, local)); near(actual, smartWorldAt(from, to, progress));
  }
  near(smartLocalAt(from, to, 1, layout, parent), affine(0, 0, 15));
});
it('refuses singular/non-finite/zero-size/reflection-changing interpolation and limits negative overshoot dimensions', () => {
  const from = pose(smartIdentity()), to = pose(affine(100, 100, 0), 1, 1);
  for (const invalid of [pose([0, 0, 0, 0, 0, 0]), pose([NaN, 0, 0, 1, 0, 0]), pose(smartIdentity(), 0), pose(affine(0, 0, 0, -1, 1))]) { expect(smartGeometryCompatible(from, invalid)).toBe(false); expect(() => smartWorldAt(from, invalid, 0.5)).toThrow('dissolve'); }
  expect(() => smartInverse([1, 2, 2, 4, 0, 0])).toThrow('singular'); expect(() => smartWorldAt(from, to, Infinity)).toThrow();
  expect(smartWorldAt(from, to, 2).every(Number.isFinite)).toBe(true); expect(smartWorldAt(from, to, 2)[0]).toBeGreaterThan(0);
  expect(smartCss([1, 0.000000000001, 0, 1, 12.345678901, -0])).toBe('matrix(1,0,0,1,12.3456789,0)');
});
