import { describe, it, expect } from "vitest";
import {
  availableRepoLensModel,
  modelFor,
  defaultModelConfig,
  PARTS,
  repoLensModelGroups,
  websiteModelSelection,
} from "./models";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER } from "@/features/agents/seedData";
import { providerModelValue } from "@/features/agents/modelSelection";
import type { Provider } from "@/features/agents/agentTypes";

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
      "combinator",
      "retag",
    ]);
  });

  it("offers enabled GPT providers for repository analysis", () => {
    const groups = repoLensModelGroups([BUILTIN_PROVIDER, CODEX_CLI_PROVIDER]);
    expect(groups.map((group) => group.id)).toEqual([
      "builtin:anthropic",
      "builtin:codex-cli",
    ]);
    expect(groups.flatMap((group) => group.models).map((model) => model.id)).toContain(
      providerModelValue(CODEX_CLI_PROVIDER.id, "gpt-5.6-sol"),
    );
  });

  it("preserves unavailable choices instead of switching provider or billing", () => {
    expect(availableRepoLensModel([BUILTIN_PROVIDER], "removed-model")).toBe("removed-model");
    expect(() => websiteModelSelection([BUILTIN_PROVIDER], "removed-model")).toThrow("unavailable");
  });

  it("requires explicit identity for duplicate models and rejects API website routes", () => {
    const api: Provider = { ...CODEX_CLI_PROVIDER, id: "api", kind: "openai" };
    const providers = [CODEX_CLI_PROVIDER, api];
    expect(() => websiteModelSelection(providers, "gpt-5.6-sol")).toThrow("multiple");
    expect(() => websiteModelSelection(providers, providerModelValue(api.id, "gpt-5.6-sol"))).toThrow("requires Claude or Codex");
    const selected = providerModelValue(CODEX_CLI_PROVIDER.id, "gpt-5.6-sol");
    expect(websiteModelSelection(providers, selected)).toBe(selected);
    expect(availableRepoLensModel(providers, "gpt-5.6-sol", "website-agent")).toBe("gpt-5.6-sol");
  });

  it("offers Claude and GPT subscription agents for website cloning", () => {
    const providers = [BUILTIN_PROVIDER, CODEX_CLI_PROVIDER];
    expect(repoLensModelGroups(providers, "website-agent")).toHaveLength(2);
    expect(
      availableRepoLensModel(providers, "gpt-5.6-sol", "website-agent"),
    ).toBe(providerModelValue(CODEX_CLI_PROVIDER.id, "gpt-5.6-sol"));
  });
});
