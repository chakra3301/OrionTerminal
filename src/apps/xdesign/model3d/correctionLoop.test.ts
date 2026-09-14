import { describe, expect, it } from "vitest";
import { decideLoop } from "./correctionLoop";

describe("decideLoop", () => {
  it("is in-progress with no history", () => {
    expect(decideLoop([]).reason).toBe("in-progress");
  });

  it("declares success on a continue at/above target fidelity", () => {
    const d = decideLoop([{ fidelity: 0.9, action: "continue" }]);
    expect(d).toEqual({ done: true, reason: "success", requestInput: false });
  });

  it("stops immediately on an explicit request-input", () => {
    const d = decideLoop([{ fidelity: 0.4, action: "request-input" }]);
    expect(d.done).toBe(true);
    expect(d.requestInput).toBe(true);
  });

  it("detects a repeated-defect after the same mismatch signature 3x", () => {
    const history = Array.from({ length: 3 }, () => ({ fidelity: 0.5, action: "refine-code", mismatchSignature: "wrong-leg-count" }));
    const d = decideLoop(history);
    expect(d.reason).toBe("repeated-defect");
    expect(d.requestInput).toBe(true);
  });

  it("does not flag repeated-defect when mismatches differ each pass", () => {
    const history = [
      { fidelity: 0.4, action: "refine-code", mismatchSignature: "a" },
      { fidelity: 0.45, action: "refine-code", mismatchSignature: "b" },
      { fidelity: 0.5, action: "refine-code", mismatchSignature: "c" },
    ];
    expect(decideLoop(history).reason).toBe("in-progress");
  });

  it("detects a plateau when fidelity stalls below target over 3 passes", () => {
    const history = [
      { fidelity: 0.5, action: "refine-code" },
      { fidelity: 0.505, action: "refine-code" },
      { fidelity: 0.51, action: "refine-code" },
    ];
    const d = decideLoop(history);
    expect(d.reason).toBe("plateau");
  });

  it("hits the hard ceiling at maxIter without success", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ fidelity: 0.3 + i * 0.001, action: "refine-code" }));
    const d = decideLoop(history);
    expect(["plateau", "hard-ceiling"]).toContain(d.reason);
    expect(d.done).toBe(true);
  });

  it("keeps going when fidelity is climbing steadily toward target", () => {
    const history = [
      { fidelity: 0.4, action: "refine-code" },
      { fidelity: 0.55, action: "refine-code" },
    ];
    expect(decideLoop(history).reason).toBe("in-progress");
  });
});
