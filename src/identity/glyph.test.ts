import { expect, it } from "vitest";
import { appGlyph } from "./appGlyph";
import { generateGlyph } from "./glyph";

it("keeps approved app artwork and generates an icon for an unknown plugin", () => {
  expect(appGlyph("archives")).toContain("glyph-archives.png");
  expect(appGlyph("orion")).toContain("glyph-orion.png");
  expect(appGlyph("xdesign")).toContain("glyph-xdesign.png");
  expect(appGlyph("incubator")).toContain("glyph-rosie.png");
  expect(appGlyph("community:music")).toMatch(/^data:image\/svg\+xml,/);
});

it("produces repeatable marks, without embedding untrusted identity text", () => {
  const id = '<script>alert("x")</script>';
  const a = generateGlyph(id);
  expect(generateGlyph(id)).toEqual(a);
  expect(a.svg).not.toContain("script");
  expect(a.svg).not.toContain("NaN");
  expect(a.svg).not.toContain("undefined");
  expect(decodeURIComponent(a.uri.split(",").slice(1).join(","))).toBe(a.svg);
});

it("gives a large library distinct silhouettes across all six shape families", () => {
  const marks = Array.from({ length: 1000 }, (_, i) => generateGlyph(`skill:fixture-${i}`));
  expect(new Set(marks.map((g) => g.path)).size).toBe(1000);
  expect(new Set(marks.map((g) => g.family)).size).toBe(6);
});

it("normalizes equivalent Unicode IDs and keeps app and skill namespaces separate", () => {
  expect(generateGlyph("café")).toEqual(generateGlyph("cafe\u0301"));
  expect(generateGlyph("app:example").path).not.toBe(generateGlyph("skill:example").path);
});

it("gives the six starter skills different silhouettes even in one colour", () => {
  const ids = ["web-research", "cite-sources", "code-reviewer", "summarizer", "data-analyst", "note-taker"];
  expect(new Set(ids.map((id) => generateGlyph(`skill:builtin:${id}`).family)).size).toBe(6);
});
