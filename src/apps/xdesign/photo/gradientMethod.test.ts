import { describe, expect, it } from "vitest";
import { bakeGradient, gradientMapParams, gradientMapValues } from "./gradientMethod";

const at = (stops: [number, string][], t: number) => parseInt([...stops].sort((a, b) => Math.abs(a[0] - t) - Math.abs(b[0] - t))[0]![1].slice(1, 3), 16);

describe("gradient Method", () => {
  it("blends black to white per method", () => {
    const black: [number, string][] = [[0, "#000000"], [1, "#ffffff"]];
    const [perceptual, linear, classic] = (["perceptual", "linear", "classic"] as const).map(method => bakeGradient(black, method)) as [ReturnType<typeof bakeGradient>, ReturnType<typeof bakeGradient>, ReturnType<typeof bakeGradient>];
    expect(perceptual).toHaveLength(64); expect(perceptual[0]).toEqual([0, "#000000"]); expect(perceptual.at(-1)).toEqual([1, "#ffffff"]);
    // Linear light lifts the middle well above sRGB's 50%; Oklab's middle lightness is darker than it.
    expect(Math.abs(at(classic!, .5) - 128)).toBeLessThan(4); expect(at(linear!, .5)).toBeGreaterThan(180); expect(Math.abs(at(perceptual!, .5) - 99)).toBeLessThan(4);
    // Classic's 100% Smoothness eases the ends.
    expect(at(classic!, .127)).toBeLessThan(.127 * 255);
  });

  it("holds each colour to the middle of its segment for Stripes", () => {
    expect(bakeGradient([[1, "#0000ff"], [0, "#ff0000"]], "stripes")).toEqual([[0, "#ff0000"], [.4999, "#ff0000"], [.5, "#0000ff"], [1, "#0000ff"]]);
    expect(bakeGradient([[0, "#000000"], [.5, "#ff0000"], [1, "#ffffff"]], "stripes")).toEqual([[0, "#000000"], [.2499, "#000000"], [.25, "#ff0000"], [.7499, "#ff0000"], [.75, "#ffffff"], [1, "#ffffff"]]);
  });

  it("bakes a Gradient Map for the engine and reopens it with the stops and Method the user set", () => {
    const stops: [number, string][] = [[0, "#ff0000"], [1, "#0000ff"]];
    expect(gradientMapParams({ stops, method: "classic", reverse: true })).toEqual({ stops, reverse: true });
    const sent = gradientMapParams({ stops, method: "linear", dither: true });
    expect(sent).toEqual({ stops: bakeGradient(stops, "linear"), dither: true });
    // The engine keeps positions as f32, so the stored stops come back slightly off.
    const stored = (sent.stops as [number, string][]).map(([at, color]) => [Math.fround(at), color]);
    expect(gradientMapValues({ stops: stored, dither: true })).toEqual({ stops, method: "linear", dither: true });
    expect(gradientMapValues({ stops: [[0, "#000000"], [1, "#ffffff"]] })).toEqual({ stops: [[0, "#000000"], [1, "#ffffff"]], method: "classic" });
  });
});
