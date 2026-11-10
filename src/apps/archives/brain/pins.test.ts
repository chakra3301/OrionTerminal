import { describe, expect, it } from "vitest";
import { parsePins, serializePins } from "./pins";

describe("Brain pins", () => {
  it("round-trips positions and drops anything malformed", () => {
    const pins = parsePins({ a: [1.234, -5, 9.99], b: [1, 2], c: "x", d: [1, Number.NaN, 3] });
    expect([...pins.keys()]).toEqual(["a"]);
    expect(serializePins(pins)).toEqual({ a: [1.2, -5, 10] });
    expect(parsePins(serializePins(pins)).get("a")).toEqual([1.2, -5, 10]);
  });

  it("treats a missing or odd value as no pins", () => {
    expect(parsePins(null).size).toBe(0);
    expect(parsePins([1, 2, 3]).size).toBe(0);
  });
});
