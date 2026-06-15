import { describe, it, expect } from "vitest";
import { BUILTIN_PROVIDER, STARTER_SKILLS } from "./seedData";

describe("seed data", () => {
  it("ships Anthropic as the builtin provider with the three models", () => {
    expect(BUILTIN_PROVIDER.builtin).toBe(true);
    expect(BUILTIN_PROVIDER.kind).toBe("anthropic");
    expect(BUILTIN_PROVIDER.models.map((m) => m.id)).toContain("claude-opus-4-8");
  });

  it("ships starter skills, all builtin with stable ids", () => {
    expect(STARTER_SKILLS.length).toBeGreaterThanOrEqual(5);
    expect(STARTER_SKILLS.every((s) => s.builtin && s.id.startsWith("builtin:"))).toBe(true);
    expect(new Set(STARTER_SKILLS.map((s) => s.id)).size).toBe(STARTER_SKILLS.length);
  });
});
