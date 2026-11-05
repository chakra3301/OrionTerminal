// @vitest-environment node
import { expect, it } from 'vitest';
import { nativeMaskAlphaPath, nativeMaskPath } from './nativeMaskPath';
const pixels = (rows: number[][]) => new Uint8Array(rows.flatMap(row => row.flatMap(alpha => [0, 0, 0, alpha])));
it('merges identical adjacent spans and preserves transparent holes, nonzero soft edges and local coordinates', () => {
  expect(nativeMaskPath(pixels([[0, 1, 255, 0], [0, 127, 255, 0], [1, 0, 0, 1]]), 4, 3, 2, -3, 5)).toBe('M-2.5,5h1v1h-1ZM-3,6h0.5v0.5h-0.5ZM-1.5,6h0.5v0.5h-0.5Z');
  expect(nativeMaskPath(pixels([[0, 0], [0, 0]]), 2, 2, 1, 0, 0)).toBe('');
});
it.each([
  [new Uint8Array(3), 1, 1, 1, 0, 0],
  [new Uint8Array(4), 1.5, 1, 1, 0, 0],
  [new Uint8Array(4), 1, 1, 0, 0, 0],
  [new Uint8Array(4), 1, 1, 1, Infinity, 0],
] as const)('rejects malformed alpha geometry before producing a path (%#)', (...args) => expect(() => nativeMaskPath(...args as Parameters<typeof nativeMaskPath>)).toThrow('invalid native hit-region'));
it('bounds fragmented paths and refuses overflowing coordinate conversion', () => {
  const width = 1024, height = 1024, rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = y % 2; x < width; x += 2) rgba[(y * width + x) * 4 + 3] = 255;
  expect(() => nativeMaskPath(rgba, width, height, 1, 0, 0)).toThrow('4 MB');
  expect(() => nativeMaskPath(pixels([[255, 255]]), 2, 1, Number.MIN_VALUE, 0, 0)).toThrow('coordinates');
});

const rgbaFromAlpha = (alpha: Uint8Array) => new Uint8Array(Array.from(alpha).flatMap(value => [0, 0, 0, value]));

it('matches RGBA path output exactly for every alpha value', () => {
  const alpha = Uint8Array.from({ length: 256 }, (_, value) => value), rgba = rgbaFromAlpha(alpha);
  expect(nativeMaskAlphaPath(alpha, 256, 1, 1.5, -3.25, 8.5)).toBe(nativeMaskPath(rgba, 256, 1, 1.5, -3.25, 8.5));
});

it('preserves merged spans, transparent holes, soft edges, negative origins and fractional scale', () => {
  const alpha = new Uint8Array([0, 1, 255, 0, 0, 127, 255, 0, 1, 0, 0, 1]);
  expect(nativeMaskAlphaPath(alpha, 4, 3, 2, -3, 5)).toBe('M-2.5,5h1v1h-1ZM-3,6h0.5v0.5h-0.5ZM-1.5,6h0.5v0.5h-0.5Z');
  expect(nativeMaskAlphaPath(new Uint8Array(4), 2, 2, 1, 0, 0)).toBe('');
});

it.each([
  [new Uint8Array(3), 1, 1, 1, 0, 0],
  [new Uint8Array(4), 1.5, 1, 1, 0, 0],
  [new Uint8Array(4), 1, 1, 0, 0, 0],
  [new Uint8Array(4), 1, 1, 1, Infinity, 0],
  [new Uint8Array(0), 4 * 1024 * 1024 + 1, 1, 1, 0, 0],
] as const)('rejects malformed or oversized alpha planes before producing a path (%#)', (...args) => expect(() => nativeMaskAlphaPath(...args as Parameters<typeof nativeMaskAlphaPath>)).toThrow('invalid native hit-region'));

it('bounds fragmented alpha paths and refuses overflowing coordinate conversion', () => {
  const width = 1024, height = 1024, alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = y % 2; x < width; x += 2) alpha[y * width + x] = 255;
  expect(() => nativeMaskAlphaPath(alpha, width, height, 1, 0, 0)).toThrow('4 MB');
  expect(() => nativeMaskAlphaPath(new Uint8Array([255, 255]), 2, 1, Number.MIN_VALUE, 0, 0)).toThrow('coordinates');
});
