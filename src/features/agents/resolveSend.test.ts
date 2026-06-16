import { describe, it, expect } from "vitest";
import { resolveSend } from "./resolveSend";
import type { Agent, Skill } from "./agentTypes";

const agents: Agent[] = [{ id: "a1", name: "Atlas", role: "analyst", accent: "", avatarAssetId: null, avatarUrl: null, brainModel: "claude-sonnet-4-6", actionModel: "", skillIds: ["web"] }];
const skills: Skill[] = [{ id: "web", name: "Web Research", icon: "", accent: "", instructions: "search", tools: [{ kind: "builtin", name: "WebSearch" }], builtin: true }];

describe("resolveSend", () => {
  it("passes a plain model through with no agent params", () => {
    expect(resolveSend("claude-opus-4-8", agents, skills)).toEqual({ model: "claude-opus-4-8", systemAppend: null, allowedTools: null });
  });

  it("expands an agent value into model + system + tools", () => {
    const r = resolveSend("agent:a1", agents, skills);
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.systemAppend).toContain("analyst");
    expect(r.allowedTools).toEqual(["WebSearch"]);
  });

  it("falls back to the value as a model if the agent is missing", () => {
    expect(resolveSend("agent:ghost", agents, skills)).toEqual({ model: "agent:ghost", systemAppend: null, allowedTools: null });
  });
});
