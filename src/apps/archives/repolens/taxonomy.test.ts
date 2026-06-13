import { describe, it, expect } from "vitest";
import { isValidTag, layersAdjacent, layerOf, normalizeCapabilities, deriveCapabilities } from "./taxonomy";

describe("taxonomy", () => {
  it("validates known tags", () => {
    expect(isValidTag("rag")).toBe(true);
    expect(isValidTag("nonsense")).toBe(false);
    expect(isValidTag("other")).toBe(true);
  });
  it("layerOf", () => {
    expect(layerOf("rag")).toBe("ml");
    expect(layerOf("nope")).toBe("other");
  });
  it("layersAdjacent symmetric + same-layer", () => {
    expect(layersAdjacent("ml", "ml")).toBe(true);
    expect(layersAdjacent("ml", "compute")).toBe(true);
    expect(layersAdjacent("ui", "storage")).toBe(false);
  });
  it("normalizeCapabilities filters + caps + lowercases", () => {
    expect(normalizeCapabilities(["RAG", "rag", "bogus", "embeddings"])).toEqual(["rag", "embeddings"]);
    expect(normalizeCapabilities(["a", "b", "c", "d", "e", "f", "g"]).length).toBeLessThanOrEqual(5);
  });
  it("deriveCapabilities keyword fallback", () => {
    const caps = deriveCapabilities({
      category: "CLI Tool",
      tech_stack: { built_with: [] },
      tags: [],
      eli5: "a command-line tool",
    });
    expect(caps).toContain("cli");
  });
});
