import { describe, expect, it } from "vitest";
import { parseDeckSlides, isDeckHtml, deckColors } from "./deckToPptx";
import { BUILTIN_DESIGN_SYSTEMS } from "./designSystem";

const deck = `<!doctype html><html><body>
  <section class="slide title"><h1>Acme</h1><p>The future of widgets</p></section>
  <section class="slide"><h2>Problem</h2><ul><li>Widgets are slow</li><li>And expensive</li></ul></section>
  <section class="slide"><h2>Solution</h2><p>We make them fast.</p><p>And cheap.</p></section>
  </body></html>`;

describe("isDeckHtml", () => {
  it("detects slide sections", () => {
    expect(isDeckHtml(deck)).toBe(true);
    expect(isDeckHtml(`<section class="hero">x</section>`)).toBe(false);
  });
});

describe("parseDeckSlides", () => {
  it("extracts title + bullets per slide", () => {
    const slides = parseDeckSlides(deck);
    expect(slides).toHaveLength(3);
    expect(slides[0]!.title).toBe("Acme");
    expect(slides[0]!.bullets).toEqual(["The future of widgets"]);
    expect(slides[1]!.title).toBe("Problem");
    expect(slides[1]!.bullets).toEqual(["Widgets are slow", "And expensive"]);
    // paragraph fallback skips the title, keeps the rest
    expect(slides[2]!.bullets).toEqual(["We make them fast.", "And cheap."]);
  });

  it("strips nested tags and entities", () => {
    const s = parseDeckSlides(`<section class="slide"><h2>A &amp; B</h2><li>x <strong>y</strong></li></section>`);
    expect(s[0]!.title).toBe("A & B");
    expect(s[0]!.bullets).toEqual(["x y"]);
  });

  it("returns [] when there are no slides", () => {
    expect(parseDeckSlides(`<html><body><p>hi</p></body></html>`)).toEqual([]);
  });
});

describe("deckColors", () => {
  it("returns bare RRGGBB and falls back without a brand", () => {
    const none = deckColors(null);
    expect(none.bg).toMatch(/^[0-9A-F]{6}$/);
    const c = deckColors(BUILTIN_DESIGN_SYSTEMS.find((d) => d.id === "ds-builtin-neo-tokyo")!);
    expect(c.bg).toMatch(/^[0-9A-F]{6}$/);
    expect(c.accent).toMatch(/^[0-9A-F]{6}$/);
  });
});
