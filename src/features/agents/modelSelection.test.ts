import { describe, it, expect } from "vitest";
import { owningProvider, parseModelValue, providerModelValue, selectedModelValue } from "./modelSelection";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER } from "./seedData";
import { historyWithPrompt } from "./dispatchSend";

const first = { ...CODEX_CLI_PROVIDER, id: "one" };
const second = { ...first, id: "two", kind: "openai" as const };
const model = first.models[0]!.id;

describe("provider-qualified selections", () => {
  it("round-trips punctuation and provider-style model IDs", () => {
    expect(parseModelValue(providerModelValue("builtin:api", "org/model:v1"))).toEqual({ providerId: "builtin:api", modelId: "org/model:v1" });
  });
  it("rejects ambiguous legacy IDs instead of choosing a billing account", () => {
    expect(() => owningProvider([first, second], model)).toThrow("multiple providers");
    expect(owningProvider([first, second], providerModelValue("two", model))).toEqual(second);
  });
  it("never routes a disabled provider", () => {
    expect(owningProvider([{ ...first, enabled: false }], providerModelValue("one", model))).toBeUndefined();
  });
  it("keeps unambiguous saved preferences compatible", () => {
    expect(selectedModelValue([first], model)).toBe(providerModelValue("one", model));
    expect(selectedModelValue([BUILTIN_PROVIDER], "agent:a")).toBe("agent:a");
  });
  it("fails closed on malformed encoded selections", () => {
    expect(() => parseModelValue("provider:%xx/model")).toThrow("Invalid model");
    expect(() => parseModelValue("provider:foo")).toThrow("Invalid model");
  });
});

describe("provider context parity", () => {
  it("replaces only the current user turn with the context-enriched prompt", () => {
    const history = [{ role: "assistant" as const, content: "previous" }, { role: "user" as const, content: "fix it" }];
    expect(historyWithPrompt(history, "file context\nfix it")).toEqual([history[0], { role: "user", content: "file context\nfix it" }]);
    expect(history[1]!.content).toBe("fix it");
  });
  it("adds the prompt when history does not contain the current turn", () => {
    expect(historyWithPrompt([], "hello")).toEqual([{ role: "user", content: "hello" }]);
  });
});
