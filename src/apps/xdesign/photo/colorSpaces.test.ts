import { describe, expect, it } from "vitest";
import { cmykFor, cmykToRgb, labFor, labToRgb, rgbToCmyk, rgbToHex, rgbToLab, hexToRgb, type Rgb } from "./colorModel";

describe("Lab (D50)", () => {
  it("matches the known sRGB to D50 Lab values", () => {
    const close = (rgb: Rgb, expected: number[]) => rgbToLab(rgb).forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 1));
    close([255, 255, 255], [100, 0, 0]);
    close([0, 0, 0], [0, 0, 0]);
    close([255, 0, 0], [54.29, 80.8, 69.89]);
    close([0, 255, 0], [87.82, -79.27, 80.99]);
    close([0, 0, 255], [29.57, 68.3, -112.03]);
  });
  it("round-trips every 17th colour through Lab", () => {
    for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) expect(labToRgb(rgbToLab([r, g, b]))).toEqual([r, g, b]);
  });
  it("clamps out-of-gamut Lab", () => {
    expect(labToRgb([50, 128, 127]).every(v => v >= 0 && v <= 255)).toBe(true);
  });
  it("keeps a typed Lab value only while it maps to the same hex", () => {
    const hex = rgbToHex(labToRgb([50, 20, -30]));
    expect(labFor(hex, [50, 20, -30])).toEqual([50, 20, -30]);
    expect(labFor("#ffffff", [50, 20, -30])[0]).toBeCloseTo(100, 1);
  });
});

describe("CMYK approximation", () => {
  it("separates primaries and greys", () => {
    expect(rgbToCmyk([255, 0, 0])).toEqual([0, 100, 100, 0]);
    expect(rgbToCmyk([255, 255, 255])).toEqual([0, 0, 0, 0]);
    expect(rgbToCmyk([0, 0, 0])).toEqual([0, 0, 0, 100]);
    expect(rgbToCmyk([128, 128, 128])[3]).toBeCloseTo(49.8, 1);
  });
  it("round-trips through 8-bit rgb", () => {
    for (const hex of ["#336699", "#ff8000", "#010203", "#fedcba"]) expect(rgbToHex(cmykToRgb(rgbToCmyk(hexToRgb(hex))))).toBe(hex);
  });
  it("remembers C/M/Y under full black", () => {
    expect(cmykFor("#000000", [40, 30, 20, 100])).toEqual([40, 30, 20, 100]);
    expect(cmykFor("#000000")).toEqual([0, 0, 0, 100]);
  });
});
