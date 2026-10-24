import { describe, expect, it } from "vitest";
import { clamp, grayHex, grayPercent, hexToRgb, hsbPreserving, hsbToRgb, isWebSafe, nearestWebSafe, normalizeHex, rgbToHex, rgbToHsb, spectrumColor } from "./colorModel";

describe("hex and rgb", () => {
  it("parses and formats lowercase", () => {
    expect(hexToRgb("#FF8000")).toEqual([255, 128, 0]);
    expect(rgbToHex([255, 128, 0])).toBe("#ff8000");
    expect(rgbToHex([-5, 300.4, 15.6])).toBe("#00ff10");
  });
  it("normalizes user input", () => {
    expect(normalizeHex(" #ABC ")).toBe("#aabbcc");
    expect(normalizeHex("12ef90")).toBe("#12ef90");
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("gg0000")).toBeNull();
    expect(clamp(5, 0, 3)).toBe(3);
  });
});

describe("hsb", () => {
  it("handles black, white and pure hues", () => {
    expect(rgbToHsb([0, 0, 0])).toEqual([0, 0, 0]);
    expect(rgbToHsb([255, 255, 255])).toEqual([0, 0, 100]);
    expect(rgbToHsb([255, 0, 0])).toEqual([0, 100, 100]);
    expect(rgbToHsb([0, 255, 0])).toEqual([120, 100, 100]);
    expect(rgbToHsb([0, 0, 255])).toEqual([240, 100, 100]);
    expect(hsbToRgb([60, 100, 100])).toEqual([255, 255, 0]);
    expect(hsbToRgb([360, 100, 100])).toEqual([255, 0, 0]);
    expect(hsbToRgb([180, 0, 50])).toEqual([128, 128, 128]);
    expect(hsbToRgb([200, 80, 0])).toEqual([0, 0, 0]);
  });
  it("round-trips every sampled colour exactly", () => {
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 13) {
      expect(hsbToRgb(rgbToHsb([r, g, b]))).toEqual([r, g, b]);
    }
  });
  it("keeps the caller's hue and saturation where hex has none", () => {
    expect(hsbPreserving([0, 0, 0], [210, 60, 40])).toEqual([210, 60, 0]);
    expect(hsbPreserving([128, 128, 128], [210, 60, 40])).toEqual([210, 0, expect.closeTo(50.2, 1)]);
    expect(hsbPreserving([255, 0, 0], [210, 60, 40])).toEqual([0, 100, 100]);
  });
});

describe("grayscale", () => {
  it("maps black to 100 and white to 0", () => {
    expect(grayPercent("#000000")).toBe(100);
    expect(grayPercent("#ffffff")).toBe(0);
    expect(grayPercent("#808080")).toBe(50);
    expect(grayHex(100)).toBe("#000000");
    expect(grayHex(0)).toBe("#ffffff");
    expect(grayHex(50)).toBe("#808080");
    expect(grayHex(150)).toBe("#000000");
  });
  it("round-trips gray values", () => {
    for (const k of [0, 10, 25, 50, 75, 100]) expect(grayPercent(grayHex(k))).toBe(k);
  });
});

describe("web safe", () => {
  it("detects and snaps to multiples of 0x33", () => {
    expect(isWebSafe("#003399")).toBe(true);
    expect(isWebSafe("#003498")).toBe(false);
    expect(isWebSafe("#000000")).toBe(true);
    expect(isWebSafe("#ffffff")).toBe(true);
    expect(nearestWebSafe("#1a8cf0")).toBe("#3399ff");
    expect(nearestWebSafe("#19b2e6")).toBe("#0099ff");
  });
});

describe("spectrum", () => {
  it("is white on top, black at the bottom and the pure hue in the middle", () => {
    expect(spectrumColor(0.5, 0)).toBe("#ffffff");
    expect(spectrumColor(0.5, 1)).toBe("#000000");
    expect(spectrumColor(0, 0.5)).toBe("#ff0000");
    expect(spectrumColor(1 / 3, 0.5)).toBe("#00ff00");
    expect(spectrumColor(2, -1)).toBe("#ffffff");
  });
});
