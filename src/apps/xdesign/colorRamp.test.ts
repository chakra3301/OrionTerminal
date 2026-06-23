import { describe, expect, it } from "vitest";
import { generateRamp, luminance, readableInk } from "./colorRamp";

describe("generateRamp", () => {
  it("reproduces the canonical Ant Design blue ladder bit-for-bit", () => {
    expect(generateRamp("#1677ff")).toEqual([
      "#e6f4ff",
      "#bae0ff",
      "#91caff",
      "#69b1ff",
      "#4096ff",
      "#1677ff",
      "#0958d9",
      "#003eb3",
      "#002c8c",
      "#001d66",
    ]);
  });

  it("returns 10 steps with the seed at index 5", () => {
    const ramp = generateRamp("#52c41a");
    expect(ramp).toHaveLength(10);
    expect(ramp[5]).toBe("#52c41a");
  });

  it("dark mode differs from light and stays 10 steps", () => {
    const light = generateRamp("#1677ff");
    const dark = generateRamp("#1677ff", { mode: "dark", backgroundColor: "#08090a" });
    expect(dark).toHaveLength(10);
    expect(dark).not.toEqual(light);
  });

  it("handles 3-digit hex and missing #", () => {
    expect(generateRamp("#fff")).toHaveLength(10);
    expect(generateRamp("1677ff")[5]).toBe("#1677ff");
  });
});

describe("luminance / readableInk", () => {
  it("white is bright, black is dark", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 2);
    expect(luminance("#000000")).toBeCloseTo(0, 2);
  });
  it("picks dark ink on a light bg and white on a dark bg", () => {
    expect(readableInk("#ffffff")).toBe("#0a0a0a");
    expect(readableInk("#08090a")).toBe("#ffffff");
  });
});
