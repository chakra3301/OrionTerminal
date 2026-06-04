import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  serializeVector,
  deserializeVector,
} from "@/lib/embeddings";

describe("cosineSimilarity", () => {
  it("is 1 for identical normalized vectors", () => {
    const v = new Float32Array([0.6, 0.8]); // unit length
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("is 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("is -1 for opposite vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it("returns 0 on length mismatch instead of throwing", () => {
    expect(cosineSimilarity(new Float32Array([1]), new Float32Array([1, 2]))).toBe(
      0,
    );
  });
});

describe("serialize/deserialize vector", () => {
  it("round-trips f32 values exactly", () => {
    const v = new Float32Array([0.125, -1.5, 42, 0, 0.3333333]);
    const bytes = serializeVector(v);
    const back = deserializeVector(bytes);
    expect(Array.from(back)).toEqual(Array.from(v));
  });

  it("accepts a number[] (sqlite BLOB shape) and aligns it", () => {
    const v = new Float32Array([1.5, 2.5, 3.5]);
    const bytes = Array.from(serializeVector(v)); // number[]
    const back = deserializeVector(bytes);
    expect(Array.from(back)).toEqual([1.5, 2.5, 3.5]);
  });

  it("byte length is 4 per element", () => {
    expect(serializeVector(new Float32Array(384)).byteLength).toBe(1536);
  });
});
