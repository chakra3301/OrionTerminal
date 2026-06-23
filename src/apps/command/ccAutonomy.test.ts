import { describe, it, expect } from "vitest";
import {
  autoDispatches,
  directiveBudget,
  applyBudget,
  L2_DIRECTIVE_BUDGET,
  AUTONOMY_LEVELS,
} from "./ccAutonomy";

describe("ccAutonomy", () => {
  it("only L2/L3 auto-dispatch", () => {
    expect(autoDispatches(0)).toBe(false);
    expect(autoDispatches(1)).toBe(false);
    expect(autoDispatches(2)).toBe(true);
    expect(autoDispatches(3)).toBe(true);
  });

  it("budget caps L2, unlimited L3", () => {
    expect(directiveBudget(2)).toBe(L2_DIRECTIVE_BUDGET);
    expect(directiveBudget(3)).toBe(Infinity);
    expect(directiveBudget(1)).toBe(Infinity);
  });

  it("applyBudget trims to the L2 cap and reports held-back", () => {
    const five = [1, 2, 3, 4, 5];
    const r = applyBudget(five, 2);
    expect(r.kept).toEqual([1, 2, 3]);
    expect(r.heldBack).toBe(2);
  });

  it("applyBudget keeps everything under budget / at L3", () => {
    expect(applyBudget([1, 2], 2)).toEqual({ kept: [1, 2], heldBack: 0 });
    expect(applyBudget([1, 2, 3, 4, 5], 3)).toEqual({
      kept: [1, 2, 3, 4, 5],
      heldBack: 0,
    });
  });

  it("exposes 4 ladder levels", () => {
    expect(AUTONOMY_LEVELS.map((l) => l.level)).toEqual([0, 1, 2, 3]);
  });
});
