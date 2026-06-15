import { describe, it, expect } from "vitest";
import { formatAgentValue, parseSelection } from "./agentValue";

describe("agent value codec", () => {
  it("formats an agent id with the agent: tag", () => {
    expect(formatAgentValue("a1")).toBe("agent:a1");
  });

  it("parses an agent-tagged value", () => {
    expect(parseSelection("agent:a1")).toEqual({ kind: "agent", id: "a1" });
  });

  it("parses a plain model id as a model selection", () => {
    expect(parseSelection("claude-opus-4-8")).toEqual({ kind: "model", id: "claude-opus-4-8" });
  });

  it("treats empty/null as a default model selection", () => {
    expect(parseSelection("")).toEqual({ kind: "model", id: "" });
  });
});
