import { describe, it, expect } from "vitest";
import { findOwningProvider, routeFor, toRuntimeHistory } from "./dispatchSend";
import { BUILTIN_PROVIDER } from "./seedData";
import type { Provider } from "./agentTypes";

const openai: Provider = {
  id: "p1",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  models: [{ id: "gpt-4o", label: "GPT-4o" }],
  keyRef: "p1",
  enabled: true,
  builtin: false,
};

describe("routing", () => {
  it("routes claude models to the claude engine", () => {
    expect(routeFor([BUILTIN_PROVIDER, openai], "claude-opus-4-8")).toBe("claude");
  });
  it("routes unknown models to claude (default)", () => {
    expect(routeFor([BUILTIN_PROVIDER, openai], "mystery")).toBe("claude");
  });
  it("routes a provider-owned model to that provider", () => {
    expect(routeFor([BUILTIN_PROVIDER, openai], "gpt-4o")).toEqual(openai);
  });
  it("findOwningProvider finds by model id", () => {
    expect(findOwningProvider([BUILTIN_PROVIDER, openai], "gpt-4o")).toEqual(openai);
    expect(findOwningProvider([BUILTIN_PROVIDER, openai], "nope")).toBeUndefined();
  });
});

describe("toRuntimeHistory", () => {
  it("flattens chatStore-style blocks and drops pending/empties", () => {
    const msgs = [
      { role: "user", blocks: [{ type: "text", text: "hi" }] },
      { role: "assistant", blocks: [{ type: "text", text: "hello " }, { type: "tool_use", id: "t", name: "x", input: {} }, { type: "text", text: "there" }] },
      { role: "assistant", blocks: [], pending: true },
      { role: "system", blocks: [{ type: "text", text: "ignore" }] },
    ];
    expect(toRuntimeHistory(msgs)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there" },
    ]);
  });
  it("passes through appChat/rosie string content", () => {
    const msgs = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b", pending: true },
      { role: "assistant", content: "c" },
    ];
    expect(toRuntimeHistory(msgs)).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "c" },
    ]);
  });
});
