import { describe, it, expect } from "vitest";
import {
  pictogramFor,
  PICTOGRAM_WORD_COUNT,
} from "@/features/notes/visualizer/pictograms";

describe("pictogramFor", () => {
  it("matches direct words", () => {
    expect(pictogramFor("tree")).toBeTruthy();
    expect(pictogramFor("rocket")).toBeTruthy();
    expect(pictogramFor("coffee")).toBeTruthy();
  });

  it("matches plurals via stemming", () => {
    expect(pictogramFor("trees")).toBe(pictogramFor("tree"));
    expect(pictogramFor("mountains")).toBe(pictogramFor("mountain"));
    expect(pictogramFor("boxes")).toBeNull(); // 'box' isn't in the library
  });

  it("matches synonyms to the same drawing", () => {
    expect(pictogramFor("forest")).toBe(pictogramFor("tree"));
    expect(pictogramFor("ocean")).toBe(pictogramFor("beach"));
    expect(pictogramFor("coding")).toBe(pictogramFor("laptop"));
  });

  it("matches multi-word entities on the head noun", () => {
    expect(pictogramFor("golden gate bridge")).toBe(pictogramFor("bridge"));
    expect(pictogramFor("central park tree")).toBe(pictogramFor("tree"));
  });

  it("falls back through words right-to-left", () => {
    // 'trip' matches (plane) even though 'zanzibar' doesn't.
    expect(pictogramFor("zanzibar trip")).toBe(pictogramFor("plane"));
  });

  it("returns null for unknown terms", () => {
    expect(pictogramFor("qzxzyq")).toBeNull();
    expect(pictogramFor("")).toBeNull();
  });

  it("has a substantial vocabulary", () => {
    expect(PICTOGRAM_WORD_COUNT).toBeGreaterThan(150);
  });
});
