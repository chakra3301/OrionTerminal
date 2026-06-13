import { describe, it, expect } from "vitest";
import { modelFor, defaultModelConfig, PARTS } from "./models";

describe("models", () => {
  it("falls back to default when part unset or 'default'", () => {
    const cfg = {
      default_model: "claude-sonnet-4-6",
      per_part: { deepdive: "default", core: "claude-opus-4-8" },
    };
    expect(modelFor(cfg, "deepdive")).toBe("claude-sonnet-4-6");
    expect(modelFor(cfg, "sktpg")).toBe("claude-sonnet-4-6");
    expect(modelFor(cfg, "core")).toBe("claude-opus-4-8");
  });
  it("default config uses sonnet", () => {
    expect(defaultModelConfig().default_model).toBe("claude-sonnet-4-6");
  });
  it("PARTS covers the routable features", () => {
    expect(PARTS.map((p) => p.id)).toEqual([
      "core",
      "deepdive",
      "sktpg",
      "synergies",
      "versus",
      "lens",
    ]);
  });
});
