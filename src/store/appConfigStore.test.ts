import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ setAppState: vi.fn() }));

import {
  useAppConfig,
  APP_DEFAULTS,
  appFirstTurnPreamble,
  appAllowedTools,
} from "./appConfigStore";
import { useSkillsStore } from "./skillsStore";
import type { Skill } from "@/features/agents/agentTypes";

function resetStore() {
  useAppConfig.getState().hydrate({});
  // hydrate({}) leaves EMPTY in place — force blanks explicitly.
  useAppConfig.setState({
    configs: {
      orion: { systemPromptEnabled: true, openingLineEnabled: true, chipsEnabled: true, skillIds: [], toolsCustomized: false },
      archives: { systemPromptEnabled: true, openingLineEnabled: true, chipsEnabled: true, skillIds: [], toolsCustomized: false },
      xdesign: { systemPromptEnabled: true, openingLineEnabled: true, chipsEnabled: true, skillIds: [], toolsCustomized: false },
    },
  });
}

describe("appConfigStore", () => {
  beforeEach(resetStore);

  it("resolves to shipped defaults when no overrides", () => {
    const r = useAppConfig.getState().resolved("orion");
    expect(r.name).toBe(APP_DEFAULTS.orion.name);
    expect(r.systemPrompt).toBe(APP_DEFAULTS.orion.systemPrompt);
    expect(r.chips).toEqual(APP_DEFAULTS.orion.suggestionChips);
  });

  it("overrides win, reset restores defaults", () => {
    useAppConfig.getState().patch("orion", { name: "Custom", systemPrompt: "hi" });
    expect(useAppConfig.getState().resolved("orion").name).toBe("Custom");
    useAppConfig.getState().reset("orion");
    expect(useAppConfig.getState().resolved("orion").name).toBe(APP_DEFAULTS.orion.name);
  });

  it("preamble includes system prompt only when enabled", () => {
    expect(appFirstTurnPreamble("archives")).toContain(APP_DEFAULTS.archives.systemPrompt.trim());
    useAppConfig.getState().patch("archives", { systemPromptEnabled: false });
    expect(appFirstTurnPreamble("archives")).toBe("");
  });

  it("tools default to unrestricted (null) and restrict when customized", () => {
    expect(appAllowedTools("xdesign")).toBeNull();
    useAppConfig.getState().patch("xdesign", {
      toolsCustomized: true,
      tools: [{ kind: "builtin", name: "Read" }],
    });
    expect(appAllowedTools("xdesign")).toEqual(["Read"]);
  });

  it("enabled skills inject instructions and grant their tools", () => {
    const skill: Skill = {
      id: "s1", name: "Researcher", icon: "", accent: "",
      instructions: "Always cite sources.",
      tools: [{ kind: "builtin", name: "WebSearch" }],
      builtin: false,
    };
    useSkillsStore.setState({ skills: new Map([[skill.id, skill]]), loaded: true });
    useAppConfig.getState().patch("orion", { skillIds: ["s1"] });

    expect(appFirstTurnPreamble("orion")).toContain("Always cite sources.");
    expect(appAllowedTools("orion")).toEqual(["WebSearch"]);
  });
});
