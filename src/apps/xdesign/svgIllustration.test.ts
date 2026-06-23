import { describe, it, expect } from "vitest";
import {
  extractSvg,
  svgToDataUrl,
  svgAspect,
  illustrationBox,
  buildIllustrationPrompt,
} from "./svgIllustration";
import { BUILTIN_DESIGN_SYSTEMS } from "./designSystem";

describe("extractSvg", () => {
  it("extracts a fenced svg block", () => {
    const reply = "Here you go.\n\n```svg\n<svg viewBox=\"0 0 100 50\"><rect/></svg>\n```";
    expect(extractSvg(reply)).toBe('<svg viewBox="0 0 100 50"><rect/></svg>');
  });
  it("falls back to a bare svg", () => {
    expect(extractSvg("prose <svg><circle/></svg> end")).toBe("<svg><circle/></svg>");
  });
  it("returns null when none", () => {
    expect(extractSvg("no svg")).toBeNull();
  });
});

describe("svgToDataUrl", () => {
  it("encodes as an svg data url", () => {
    const url = svgToDataUrl("<svg></svg>");
    expect(url.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(url.split(",")[1]!)).toBe("<svg></svg>");
  });
});

describe("svgAspect / illustrationBox", () => {
  it("reads viewBox ratio", () => {
    expect(svgAspect('<svg viewBox="0 0 200 100">')).toBeCloseTo(2);
  });
  it("reads width/height when no viewBox", () => {
    expect(svgAspect('<svg width="300" height="100">')).toBeCloseTo(3);
  });
  it("defaults to 4:3", () => {
    expect(svgAspect("<svg>")).toBeCloseTo(4 / 3);
  });
  it("illustrationBox preserves aspect", () => {
    const box = illustrationBox('<svg viewBox="0 0 200 100">', 400);
    expect(box).toEqual({ w: 400, h: 200 });
  });
});

describe("buildIllustrationPrompt", () => {
  it("includes the description and brand palette", () => {
    const p = buildIllustrationPrompt("a rocket", BUILTIN_DESIGN_SYSTEMS[0]!);
    expect(p).toContain("a rocket");
    expect(p).toContain("brand colors");
    expect(p).toContain("```svg");
  });
});
