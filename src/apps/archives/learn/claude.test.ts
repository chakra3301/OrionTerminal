import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/ipc", () => ({
  learnClaudeCall: vi.fn(),
}));
import { learnClaudeCall } from "../../../lib/ipc";
import { generateGraph, gradeAnswer } from "./claude";

beforeEach(() => vi.clearAllMocks());

describe("generateGraph", () => {
  it("parses the model reply into a GraphSpec", async () => {
    (learnClaudeCall as any).mockResolvedValue({ result: JSON.stringify({ summary: "s", nodes: [{ key: "a", title: "A", level: "basics" }] }), cost: 0, model: "m" });
    const g = await generateGraph("Photography", "model-x");
    expect(g.nodes).toHaveLength(1);
    expect(learnClaudeCall).toHaveBeenCalledTimes(1);
  });
});

describe("gradeAnswer", () => {
  it("returns a structured grade and defaults to incorrect on garbage", async () => {
    (learnClaudeCall as any).mockResolvedValue({ result: "not json", cost: 0, model: "m" });
    const grade = await gradeAnswer({ question: "q", expected: "e", concept: "c", answer: "a" }, "model-x");
    expect(grade.correct).toBe(false);
    expect(Array.isArray(grade.missed_concepts)).toBe(true);
  });
});
