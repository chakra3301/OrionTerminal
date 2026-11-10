import { expect, it } from 'vitest';
import { interpolateNativeGeometryCommands } from './nativeReactMotionPaths';

function blob(commands: Array<[number, number[]]>) {
  const bytes = new Uint8Array(commands.reduce((size, [_, values]) => size + 1 + values.length * 4, 0));
  const view = new DataView(bytes.buffer); let offset = 0;
  for (const [command, values] of commands) {
    bytes[offset++] = command;
    for (const value of values) { view.setFloat32(offset, value, true); offset += 4; }
  }
  return bytes;
}

function values(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result: number[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const command = bytes[offset++]!, count = command === 0 ? 0 : command <= 2 ? 2 : command === 3 ? 4 : 6;
    for (let index = 0; index < count; index++, offset += 4) result.push(view.getFloat32(offset, true));
  }
  return result;
}

it('interpolates every pinned path command using little-endian float32 coordinate pairs', () => {
  const from = blob([[1, [0, 2]], [2, [4, 6]], [3, [8, 10, 12, 14]], [4, [16, 18, 20, 22, 24, 26]], [0, []]]);
  const to = blob([[1, [4, 6]], [2, [8, 10]], [3, [12, 14, 16, 18]], [4, [20, 22, 24, 26, 28, 30]], [0, []]]);
  expect(values(interpolateNativeGeometryCommands(from, to, .5)!)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
});

it('preserves endpoint bytes and inputs, returns fresh buffers, and keeps finite overshoot', () => {
  const from = blob([[1, [-0, 2]], [2, [4, 6]]]), to = blob([[1, [8, 10]], [2, [12, 14]]]);
  const originalFrom = from.slice(), originalTo = to.slice();
  const atStart = interpolateNativeGeometryCommands(from, to, 0)!, atEnd = interpolateNativeGeometryCommands(from, to, 1)!;
  expect(atStart).not.toBe(from); expect(atEnd).not.toBe(to);
  expect(atStart).toEqual(originalFrom); expect(atEnd).toEqual(originalTo);
  expect(Object.is(new DataView(atStart.buffer).getFloat32(1, true), -0)).toBe(true);
  expect(values(interpolateNativeGeometryCommands(from, to, 1.5)!)).toEqual([12, 14, 16, 18]);
  expect(values(interpolateNativeGeometryCommands(from, to, -.25)!)).toEqual([-2, 0, 2, 4]);
  expect(from).toEqual(originalFrom); expect(to).toEqual(originalTo);
});

it('respects typed-array byte offsets and rejects malformed, incompatible, or non-finite blobs', () => {
  const a = blob([[1, [0, 2]], [4, [4, 6, 8, 10, 12, 14]]]);
  const b = blob([[1, [2, 4]], [4, [6, 8, 10, 12, 14, 16]]]);
  const aBacking = new Uint8Array(a.byteLength + 6), bBacking = new Uint8Array(b.byteLength + 6);
  aBacking.fill(255); bBacking.fill(127); aBacking.set(a, 3); bBacking.set(b, 2);
  const aSlice = aBacking.subarray(3, 3 + a.byteLength), bSlice = bBacking.subarray(2, 2 + b.byteLength);
  expect(values(interpolateNativeGeometryCommands(aSlice, bSlice, .5)!)).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
  expect(interpolateNativeGeometryCommands(blob([[1, [0, 0]]]), blob([[2, [0, 0]]]), .5)).toBeUndefined();
  expect(interpolateNativeGeometryCommands(new Uint8Array([4, 0, 0]), new Uint8Array([4, 0, 0]), .5)).toBeUndefined();
  expect(interpolateNativeGeometryCommands(new Uint8Array([8]), new Uint8Array([8]), .5)).toBeUndefined();
  expect(interpolateNativeGeometryCommands(blob([[1, [Number.NaN, 0]]]), blob([[1, [0, 0]]]), .5)).toBeUndefined();
  expect(interpolateNativeGeometryCommands(blob([[1, [0, 0]]]), blob([[1, [Infinity, 0]]]), .5)).toBeUndefined();
  expect(interpolateNativeGeometryCommands(a, new Uint8Array(a.byteLength + 1), .5)).toBeUndefined();
  expect(interpolateNativeGeometryCommands(a, b, 100.01)).toBeUndefined();
  expect(interpolateNativeGeometryCommands(a, b, Number.POSITIVE_INFINITY)).toBeUndefined();
  const extremes = blob([[1, [-3.4028234663852886e38, 0]]]), high = blob([[1, [3.4028234663852886e38, 0]]]);
  expect(interpolateNativeGeometryCommands(extremes, high, 100)).toBeUndefined();
});

it('enforces the 8 MiB blob and one-million decoded point limits before output allocation', () => {
  const overBytes = new Uint8Array(8 * 1024 * 1024 + 1);
  expect(interpolateNativeGeometryCommands(overBytes, overBytes, .5)).toBeUndefined();
  const manyPoints = new Uint8Array(25 * 333_334);
  for (let offset = 0; offset < manyPoints.length; offset += 25) manyPoints[offset] = 4;
  expect(manyPoints.byteLength).toBeLessThan(8 * 1024 * 1024);
  expect(interpolateNativeGeometryCommands(manyPoints, manyPoints, .5)).toBeUndefined();
});
