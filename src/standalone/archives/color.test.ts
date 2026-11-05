import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, isDark, isHex } from "./color";

describe("colour maths", () => {
  it("round-trips hex through HSV", () => {
    for (const hex of ["#0053fd", "#ffffff", "#000000", "#1f2328", "#cf222e", "#8250df"]) {
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
    }
  });

  it("reads hue, saturation and value", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#00ff00")?.h).toBe(120);
    expect(hexToHsv("#808080")).toMatchObject({ s: 0 });
    expect(hexToHsv("nope")).toBeNull();
  });

  it("tells dark backgrounds from light ones", () => {
    expect(isDark("#fefefe")).toBe(false);
    expect(isDark("#1f2328")).toBe(true);
    expect(isDark("#0d1117")).toBe(true);
    expect(isDark("#f6f8fa")).toBe(false);
    expect(isHex("#abc")).toBe(false);
  });
});
