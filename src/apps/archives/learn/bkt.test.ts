import { describe, it, expect } from "vitest";
import { bktUpdate, BKT_DEFAULTS, MASTERY_THRESHOLD } from "./bkt";

describe("bktUpdate", () => {
  it("raises mastery on a correct answer", () => {
    const next = bktUpdate(0.3, true);
    expect(next).toBeGreaterThan(0.3);
    expect(next).toBeLessThanOrEqual(1);
  });

  it("lowers the posterior on an incorrect answer", () => {
    // After an incorrect answer the transit can nudge up slightly, but the
    // evidence component must pull the posterior below the no-evidence value.
    const correct = bktUpdate(0.5, true);
    const incorrect = bktUpdate(0.5, false);
    expect(incorrect).toBeLessThan(correct);
  });

  it("stays within [0,1]", () => {
    expect(bktUpdate(0.99, true)).toBeLessThanOrEqual(1);
    expect(bktUpdate(0.01, false)).toBeGreaterThanOrEqual(0);
  });

  it("converges above threshold after repeated correct answers", () => {
    let p = BKT_DEFAULTS.pInit;
    for (let i = 0; i < 5; i++) p = bktUpdate(p, true);
    expect(p).toBeGreaterThanOrEqual(MASTERY_THRESHOLD);
  });
});
