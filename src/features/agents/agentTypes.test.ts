import { describe, it, expect } from "vitest";
import { parseSkill, parseAgent, parseProvider } from "./agentTypes";

describe("parseSkill", () => {
  it("salvages a partial skill and defaults missing fields", () => {
    const s = parseSkill({ id: "s1", name: "Web Research" });
    expect(s).toEqual({
      id: "s1",
      name: "Web Research",
      icon: "",
      accent: "",
      instructions: "",
      tools: [],
      builtin: false,
    });
  });

  it("coerces a non-array tools field to []", () => {
    expect(parseSkill({ id: "s1", name: "x", tools: "nope" as never })!.tools).toEqual([]);
  });

  it("returns null when id or name is missing", () => {
    expect(parseSkill({ name: "x" })).toBeNull();
    expect(parseSkill({ id: "s1" })).toBeNull();
  });
});

describe("parseAgent", () => {
  it("defaults action_model and skills", () => {
    const a = parseAgent({ id: "a1", name: "Atlas", brain_model: "claude-opus-4-8" });
    expect(a).toMatchObject({ id: "a1", name: "Atlas", brainModel: "claude-opus-4-8", actionModel: "", skillIds: [] });
  });

  it("returns null without a brain model", () => {
    expect(parseAgent({ id: "a1", name: "Atlas" })).toBeNull();
  });
});

describe("parseProvider", () => {
  it("coerces models to [] and defaults flags", () => {
    const p = parseProvider({ id: "p1", name: "OpenAI", kind: "openai", models: "x" as never });
    expect(p).toMatchObject({ id: "p1", name: "OpenAI", kind: "openai", baseUrl: "", models: [], enabled: true, builtin: false });
  });
});
