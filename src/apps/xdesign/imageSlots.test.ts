import { describe, expect, it } from "vitest";
import {
  hasImageSlots,
  extractImageRequests,
  inlineGeneratedImages,
  fallbackSlotUrl,
  MAX_IMAGE_SLOTS,
} from "./imageSlots";

describe("hasImageSlots", () => {
  it("detects tokens", () => {
    expect(hasImageSlots(`<img src="{{IMG: a fox}}">`)).toBe(true);
    expect(hasImageSlots(`<img src="hero.png">`)).toBe(false);
  });
});

describe("extractImageRequests", () => {
  it("returns unique descriptions in order", () => {
    const html = `
      <img src="{{IMG: a dark mountain}}">
      <div style="background-image:url('{{IMG: a city skyline}}')"></div>
      <img src="{{IMG: a dark mountain}}">`;
    expect(extractImageRequests(html)).toEqual(["a dark mountain", "a city skyline"]);
  });

  it("caps at MAX_IMAGE_SLOTS", () => {
    const html = Array.from({ length: 10 }, (_, i) => `{{IMG: img ${i}}}`).join(" ");
    expect(extractImageRequests(html)).toHaveLength(MAX_IMAGE_SLOTS);
  });

  it("trims whitespace and ignores empties", () => {
    expect(extractImageRequests(`{{IMG:   spacious   }}`)).toEqual(["spacious"]);
    expect(extractImageRequests(`{{IMG: }}`)).toEqual([]);
  });
});

describe("inlineGeneratedImages", () => {
  it("replaces mapped tokens and falls back for the rest", () => {
    const html = `<img src="{{IMG: a fox}}"><img src="{{IMG: a wolf}}">`;
    const map = new Map([["a fox", "data:image/png;base64,AAA"]]);
    const out = inlineGeneratedImages(html, map);
    expect(out).toContain(`src="data:image/png;base64,AAA"`);
    expect(out).toContain(fallbackSlotUrl()); // wolf had no mapping
    expect(out).not.toContain("{{IMG");
  });
});
