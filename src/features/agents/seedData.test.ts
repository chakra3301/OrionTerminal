import { describe, it, expect } from "vitest";
import { BUILTIN_PROVIDER, STARTER_SKILLS, CODEX_CLI_PROVIDER, CURSOR_SDK_PROVIDER, GEMINI_CLI_PROVIDER } from "./seedData";

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

describe("CLI engine built-in providers", () => {
  it("codex provider is a builtin codex_cli with models and no key", () => {
    expect(CODEX_CLI_PROVIDER.id).toBe("builtin:codex-cli");
    expect(CODEX_CLI_PROVIDER.kind).toBe("codex_cli");
    expect(CODEX_CLI_PROVIDER.builtin).toBe(true);
    expect(CODEX_CLI_PROVIDER.keyRef).toBe("");
    expect(CODEX_CLI_PROVIDER.name).toContain("ChatGPT subscription");
    expect(CODEX_CLI_PROVIDER.models.some((m) => m.id === "gpt-5.6-sol")).toBe(true);
  });
  it("gemini provider is a builtin gemini_cli with models", () => {
    expect(GEMINI_CLI_PROVIDER.id).toBe("builtin:gemini-cli");
    expect(GEMINI_CLI_PROVIDER.kind).toBe("gemini_cli");
    expect(GEMINI_CLI_PROVIDER.builtin).toBe(true);
    expect(GEMINI_CLI_PROVIDER.models.some((m) => m.id === "gemini-2.5-pro")).toBe(true);
  });
  it("cursor provider is a builtin cursor_sdk with composer-2.5", () => {
    expect(CURSOR_SDK_PROVIDER.id).toBe("builtin:cursor-sdk");
    expect(CURSOR_SDK_PROVIDER.kind).toBe("cursor_sdk");
    expect(CURSOR_SDK_PROVIDER.keyRef).toBe("builtin:cursor-sdk");
    expect(CURSOR_SDK_PROVIDER.models.some((m) => m.id === "composer-2.5")).toBe(true);
  });
});
