import { describe, it, expect } from "vitest";
import { composeAgent } from "./composeAgent";
import type { Agent, Skill } from "./agentTypes";

const agent: Agent = {
  id: "a1", name: "Atlas", role: "Research analyst", accent: "#b14cff",
  avatarAssetId: null, avatarUrl: null,
  brainModel: "claude-sonnet-4-6", actionModel: "claude-haiku-4-5-20251001",
  skillIds: ["web", "cite"],
};

const skills: Skill[] = [
  { id: "web", name: "Web Research", icon: "", accent: "", instructions: "Search the web for primary sources.", tools: [{ kind: "builtin", name: "WebSearch" }], builtin: true },
  { id: "cite", name: "Cite Sources", icon: "", accent: "", instructions: "Always cite with [n] markers.", tools: [{ kind: "mcp", server: "playwright" }], builtin: true },
];

describe("composeAgent", () => {
  it("runs on the brain model in Phase 1", () => {
    expect(composeAgent(agent, skills).model).toBe("claude-sonnet-4-6");
  });

  it("carries the agent's actionModel through", () => {
    expect(composeAgent(agent, skills).actionModel).toBe("claude-haiku-4-5-20251001");
  });

  it("actionModel is empty string when the agent has none", () => {
    const solo: Agent = {
      id: "a2", name: "Solo", role: "", accent: "#fff",
      avatarAssetId: null, avatarUrl: null,
      brainModel: "claude-opus-4-8", actionModel: "", skillIds: [],
    };
    expect(composeAgent(solo, []).actionModel).toBe("");
  });

  it("concatenates equipped skill instructions (in skillIds order) with a role header", () => {
    const out = composeAgent(agent, skills).appendSystemPrompt;
    expect(out).toContain("Research analyst");
    expect(out.indexOf("Search the web")).toBeLessThan(out.indexOf("Always cite"));
  });

  it("unions tool grants into a flat allowed-tools list (mcp as mcp__<server>)", () => {
    expect(composeAgent(agent, skills).allowedTools.sort()).toEqual(["WebSearch", "mcp__playwright"].sort());
  });

  it("ignores skill ids that resolve to no skill", () => {
    const out = composeAgent({ ...agent, skillIds: ["web", "ghost"] }, skills);
    expect(out.allowedTools).toEqual(["WebSearch"]);
  });
});
