import { expect, it } from "vitest";
import { decodeVectorBytes, encodeVectorBytes } from "./vectorStorage";
import { deserializeVector } from "./embeddings";

it("round-trips real float vectors through SQL plugin JSON text", () => {
  const floats = new Float32Array([0.25, -0.5, 0.75]);
  const bytes = new Uint8Array(floats.buffer);
  const stored = encodeVectorBytes(bytes);
  expect(typeof stored).toBe("string");
  expect(Array.from(deserializeVector(decodeVectorBytes(stored)!))).toEqual(Array.from(floats));
});

it("accepts legacy binary and numeric-array values", () => {
  expect(decodeVectorBytes(new Uint8Array([0, 0, 128, 63]))).toEqual(new Uint8Array([0, 0, 128, 63]));
  expect(decodeVectorBytes([0, 0, 128, 63])).toEqual(new Uint8Array([0, 0, 128, 63]));
});

it("rejects malformed, oversized, non-byte, and unaligned stored values", () => {
  for (const value of [null, "bad json", "{}", "[]", [0], [-1, 0, 0, 0], [256, 0, 0, 0], [0.1, 0, 0, 0], ["0", 0, 0, 0], new Uint8Array(65_540)]) {
    expect(decodeVectorBytes(value)).toBeNull();
  }
  expect(() => encodeVectorBytes(new Uint8Array(3))).toThrow("Invalid embedding");
});
