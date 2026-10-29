import { describe, expect, it } from "vitest";
import { DEFAULT_SHAPE_STYLE, STROKE_PRESETS, gradientFill, sanitizeShapeStyle, shapeEditParams, setDash, shapeStyleParams, strokePresetOf, styleFromShapeInfo, withPatterns, type ShapeStyle } from "./shapeStyle";

describe("shape style model", () => {
  it("loads a stale four-field style and fills Photoshop's stroke defaults", () => {
    expect(sanitizeShapeStyle({ fill: false, stroke: true, strokeColor: "#112233", strokeWidth: 5 })).toEqual({ ...DEFAULT_SHAPE_STYLE, fill: false, stroke: true, strokeColor: "#112233", strokeWidth: 5 });
    expect(DEFAULT_SHAPE_STYLE).toMatchObject({ fill: true, fillKind: "solid", fillColor: null, stroke: false, strokeKind: "solid", strokeWidth: 3, align: "inside", cap: "butt", join: "miter", dashes: [] });
  });
  it("replaces bad values instead of throwing", () => {
    const style = sanitizeShapeStyle({ fill: "yes", fillKind: "hatch", fillColor: "red", fillPattern: { id: 7, scale: 0, angle: 999 }, strokeColor: "#12", strokeWidth: 9e9, align: "middle", cap: 3, join: "round", dashes: [4, "x", -1, 2, 1, 1, 1, 1], fillGradient: { stops: [[0, "#000000"]], style: "spiral", angle: 999, scale: 0, reverse: "no" } });
    expect(style).toMatchObject({ fill: true, fillKind: "solid", fillColor: null, strokeColor: "#000000", strokeWidth: 1000, align: "inside", cap: "butt", join: "round", dashes: [4, 2, 1, 1, 1, 1] });
    expect(style.fillGradient).toEqual(DEFAULT_SHAPE_STYLE.fillGradient);
    expect(style.fillPattern).toEqual({ id: "", name: "", scale: 100, angle: 0 });
    expect(sanitizeShapeStyle(null)).toEqual(DEFAULT_SHAPE_STYLE);
    expect(sanitizeShapeStyle({ dashes: [3] }).dashes).toEqual([3, 3]);
  });
});

describe("shape style params", () => {
  it("keeps the old create params for a solid fill with no stroke", () => {
    expect(shapeStyleParams(DEFAULT_SHAPE_STYLE, "#ff0000")).toEqual({ fill: "#ff0000" });
    expect(shapeStyleParams({ ...DEFAULT_SHAPE_STYLE, fillColor: "#00ff00" }, "#ff0000")).toEqual({ fill: "#00ff00" });
    expect(shapeStyleParams({ ...DEFAULT_SHAPE_STYLE, fill: false }, "#ff0000")).toEqual({ fill: null });
  });
  it("sends the stroke options, dashes and a gradient stroke in the engine's fill form", () => {
    const style = { ...DEFAULT_SHAPE_STYLE, stroke: true, strokeColor: "#112233", strokeWidth: 5, align: "outside" as const, cap: "round" as const, join: "bevel" as const, dashes: [0, 2] };
    expect(shapeStyleParams(style, "#ff0000").stroke).toEqual({ width: 5, color: "#112233", align: "outside", cap: "round", join: "bevel", dashes: [0, 2] });
    const gradient = shapeStyleParams({ ...style, strokeKind: "gradient" }, "#ff0000").stroke as Record<string, unknown>;
    expect(gradient.color).toBeUndefined(); expect(gradient.fill).toEqual(gradientFill(style.strokeGradient));
  });
  it("converts a gradient with opacity stops to the engine's stops with alpha", () => {
    expect(gradientFill({ stops: [[0, "#000000"], [1, "#ffffff"]], opacity: [[0, 1], [1, 0]], style: "radial", angle: 45, scale: 150, reverse: true }))
      .toEqual({ gradient: { stops: [[0, "#000000ff"], [1, "#ffffff00"]], style: "radial", angle: 45, scale: 150, reverse: true } });
    expect(gradientFill({ stops: [[0, "#000000"], [1, "#ffffff"]], opacity: [[0, 1], [0.5, 0], [1, 1]], style: "linear", angle: 90, scale: 100, reverse: false }).gradient.stops)
      .toEqual([[0, "#000000ff"], [0.5, "#80808000"], [1, "#ffffffff"]]);
  });
  it("sends a pattern fill and stroke as the engine's pattern paint", () => {
    const pattern = { id: "p1", name: "Bubbles", scale: 50, angle: -30 };
    const style: ShapeStyle = { ...DEFAULT_SHAPE_STYLE, fillKind: "pattern", fillPattern: pattern, stroke: true, strokeKind: "pattern", strokePattern: { ...pattern, id: "p2" } };
    expect(shapeStyleParams(style, "#ff0000")).toEqual({ fill: { pattern: "p1", scale: 50, angle: -30 }, stroke: { width: 3, fill: { pattern: "p2", scale: 50, angle: -30 }, align: "inside", cap: "butt", join: "miter", dashes: [] } });
    expect(shapeEditParams(style, { fillPattern: { ...pattern, scale: 200 } }, "#ff0000")).toEqual({ fill: { pattern: "p1", scale: 200, angle: -30 } });
  });
  it("draws a saved pattern whose preset is gone with the first preset, or Solid Color when there are none", () => {
    const style: ShapeStyle = { ...DEFAULT_SHAPE_STYLE, fillKind: "pattern", fillPattern: { id: "gone", name: "Gone", scale: 50, angle: 0 }, strokeKind: "pattern", strokePattern: { id: "p2", name: "Grid", scale: 100, angle: 0 } };
    const presets = [{ id: "p1", name: "Bubbles" }, { id: "p2", name: "Grid" }];
    expect(withPatterns(style, presets)).toMatchObject({ fillKind: "pattern", fillPattern: { id: "p1", name: "Bubbles", scale: 50 }, strokeKind: "pattern", strokePattern: { id: "p2" } });
    expect(withPatterns(style, [])).toMatchObject({ fillKind: "solid", strokeKind: "solid" });
    expect(withPatterns(DEFAULT_SHAPE_STYLE, [])).toBe(DEFAULT_SHAPE_STYLE);
  });
  it("edits only the part a patch touches and turns a stroke off with null", () => {
    const style = { ...DEFAULT_SHAPE_STYLE, stroke: true };
    expect(shapeEditParams(style, { align: "center" }, "#ff0000")).toEqual({ stroke: { width: 3, color: "#000000", align: "center", cap: "butt", join: "miter", dashes: [] } });
    expect(shapeEditParams({ ...style, stroke: false }, { stroke: false }, "#ff0000")).toEqual({ stroke: null });
    expect(shapeEditParams(style, { fillColor: "#00ff00" }, "#ff0000")).toEqual({ fill: "#00ff00" });
    expect(shapeEditParams(style, {}, "#ff0000")).toEqual({});
  });
});

describe("stroke presets", () => {
  it("offers Photoshop's Solid, Dashed and Dotted lines and names the current one", () => {
    expect(STROKE_PRESETS.map(preset => preset.name)).toEqual(["Solid", "Dashed", "Dotted"]);
    expect(strokePresetOf(DEFAULT_SHAPE_STYLE)).toBe("Solid");
    expect(strokePresetOf({ ...DEFAULT_SHAPE_STYLE, ...STROKE_PRESETS[2]!.patch })).toBe("Dotted");
    expect(strokePresetOf({ ...DEFAULT_SHAPE_STYLE, dashes: [6, 1] })).toBe("Custom");
  });
  it("edits More Options' dash and gap pairs, copying a lone dash or gap to its partner", () => {
    expect(setDash([4, 2], 2, 1)).toEqual([4, 2, 1, 1]);
    expect(setDash([4, 2, 1, 1], 3, 3)).toEqual([4, 2, 1, 3]);
    expect(setDash([4, 2, 1, 3], 2, null)).toEqual([4, 2, 3, 3]);
    expect(setDash([4, 2, 1, 3], 0, null)).toEqual([2, 2, 1, 3]);
    expect(setDash([4, 2], 5, 2)).toEqual([4, 2]);
    expect(setDash([0, 2], 1, 0)).toEqual([]);
  });
});

describe("shape layer style", () => {
  it("reads a shape layer's fill and stroke into the bar's style", () => {
    const info = { fill: { gradient: { stops: [[0, "#ff0000"], [1, "#0000ff80"]], angle: 30, scale: 100, style: "linear", reverse: false } }, stroke: { width: 4, fill: "#00ff00", opacity: 100, align: "outside", cap: "square", join: "round", dashes: [4, 2] } };
    expect(styleFromShapeInfo(info, DEFAULT_SHAPE_STYLE)).toMatchObject({ fill: true, fillKind: "gradient", fillGradient: { stops: [[0, "#ff0000"], [1, "#0000ff"]], opacity: [[0, 1], [1, 128 / 255]], angle: 30 }, stroke: true, strokeKind: "solid", strokeColor: "#00ff00", strokeWidth: 4, align: "outside", cap: "square", join: "round", dashes: [4, 2] });
    expect(styleFromShapeInfo({ fill: null, stroke: null }, DEFAULT_SHAPE_STYLE)).toMatchObject({ fill: false, stroke: false });
    expect(styleFromShapeInfo({ fill: "#123456" }, DEFAULT_SHAPE_STYLE)).toMatchObject({ fill: true, fillKind: "solid", fillColor: "#123456" });
    expect(styleFromShapeInfo({ fill: { pattern: "p1", name: "Bubbles", scale: 50, angle: 30 }, stroke: { width: 2, fill: { pattern: "p2", name: "Grid", scale: 100, angle: 0 } } }, DEFAULT_SHAPE_STYLE))
      .toMatchObject({ fill: true, fillKind: "pattern", fillPattern: { id: "p1", name: "Bubbles", scale: 50, angle: 30 }, stroke: true, strokeKind: "pattern", strokePattern: { id: "p2", name: "Grid", scale: 100, angle: 0 } });
  });
});
