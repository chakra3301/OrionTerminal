import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  beginTwoPass,
  twoPassPhase,
  twoPassValue,
  clearTwoPass,
  onPassExit,
} from "./twoPassCoordinator";

beforeEach(() => {
  clearTwoPass("c1");
});

describe("twoPassCoordinator", () => {
  it("onPassExit returns false when no entry exists", () => {
    expect(onPassExit("nope", null)).toBe(false);
  });

  it("plan-phase success captures plan, fires execute, flips to execute, consumes the exit", () => {
    const capturePlan = vi.fn(() => "PLAN");
    const fireExecute = vi.fn();
    beginTwoPass("c1", { phase: "plan", value: "agent:a", capturePlan, fireExecute });
    expect(twoPassPhase("c1")).toBe("plan");
    expect(twoPassValue("c1")).toBe("agent:a");

    const consumed = onPassExit("c1", null);
    expect(consumed).toBe(true);
    expect(capturePlan).toHaveBeenCalledTimes(1);
    expect(fireExecute).toHaveBeenCalledWith("PLAN");
    expect(twoPassPhase("c1")).toBe("execute");
  });

  it("execute-phase exit clears the entry and does NOT consume (caller finalizes)", () => {
    beginTwoPass("c1", { phase: "execute", value: "agent:a", capturePlan: () => "", fireExecute: vi.fn() });
    const consumed = onPassExit("c1", null);
    expect(consumed).toBe(false);
    expect(twoPassPhase("c1")).toBeNull();
  });

  it("plan-phase error clears the entry, does NOT fire execute, does NOT consume", () => {
    const fireExecute = vi.fn();
    beginTwoPass("c1", { phase: "plan", value: "agent:a", capturePlan: () => "PLAN", fireExecute });
    const consumed = onPassExit("c1", "boom");
    expect(consumed).toBe(false);
    expect(fireExecute).not.toHaveBeenCalled();
    expect(twoPassPhase("c1")).toBeNull();
  });

  it("clearTwoPass removes the entry", () => {
    beginTwoPass("c1", { phase: "plan", value: "v", capturePlan: () => "", fireExecute: vi.fn() });
    clearTwoPass("c1");
    expect(twoPassPhase("c1")).toBeNull();
    expect(twoPassValue("c1")).toBeNull();
  });
});
