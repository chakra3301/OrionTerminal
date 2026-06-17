import { describe, it, expect } from "vitest";
import { hexToRgb } from "./sigil";

describe("hexToRgb", () => {
  it("parses a 6-digit hex", () => {
    expect(hexToRgb("#b14cff")).toBe("177, 76, 255");
    expect(hexToRgb("00e0ff")).toBe("0, 224, 255");
  });
  it("falls back to violet on bad input", () => {
    expect(hexToRgb("")).toBe("177, 76, 255");
    expect(hexToRgb("nope")).toBe("177, 76, 255");
  });
});
