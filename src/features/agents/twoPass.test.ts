import { describe, it, expect } from "vitest";
import { shouldTwoPass, planningSystem, executionPrompt } from "./twoPass";
import type { ResolvedSend } from "./resolveSend";

function r(model: string, actionModel: string | null): ResolvedSend {
  return { model, actionModel, systemAppend: null, allowedTools: null };
}

describe("shouldTwoPass", () => {
  it("true when action is non-empty and distinct from brain", () => {
    expect(shouldTwoPass(r("opus", "haiku"))).toBe(true);
  });
  it("false when action equals brain", () => {
    expect(shouldTwoPass(r("opus", "opus"))).toBe(false);
  });
  it("false when action is empty string", () => {
    expect(shouldTwoPass(r("opus", ""))).toBe(false);
  });
  it("false when action is null (plain model)", () => {
    expect(shouldTwoPass(r("opus", null))).toBe(false);
  });
});

describe("planningSystem", () => {
  it("wraps a non-null agent system with the plan-only directive", () => {
    const out = planningSystem("You are Pilot.");
    expect(out).toContain("You are Pilot.");
    expect(out.toLowerCase()).toContain("plan");
    expect(out.toLowerCase()).toContain("do not");
  });
  it("handles a null agent system (directive only)", () => {
    const out = planningSystem(null);
    expect(out.length).toBeGreaterThan(0);
    expect(out.toLowerCase()).toContain("plan");
  });
});

describe("executionPrompt", () => {
  it("composes plan + original request in the documented shape", () => {
    expect(executionPrompt("Add a button", "1. open file\n2. edit")).toBe(
      "Execute this plan:\n1. open file\n2. edit\n\nOriginal request:\nAdd a button",
    );
  });
});
