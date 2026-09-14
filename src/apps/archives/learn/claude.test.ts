import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/features/agents/textCall", () => ({ runTextModel: vi.fn() }));
import { runTextModel } from "@/features/agents/textCall";
import { generateGraph, gradeAnswer, generateFigure } from "./claude";

beforeEach(() => vi.clearAllMocks());

describe("generateGraph", () => {
  it("parses the selected provider's reply into a GraphSpec", async () => {
    vi.mocked(runTextModel).mockResolvedValue(JSON.stringify({ summary: "s", nodes: [{ key: "a", title: "A", level: "basics" }] }));
    const g = await generateGraph("Photography", "provider:custom/model-x");
    expect(g.nodes).toHaveLength(1);
    expect(runTextModel).toHaveBeenCalledWith(expect.any(String), "provider:custom/model-x");
  });
});

const answer = { question: "q", expected: "e", concept: "c", answer: "a" };
describe("gradeAnswer", () => {
  it("does not penalize the learner for an invalid model reply", async () => {
    vi.mocked(runTextModel).mockResolvedValue("not json");
    await expect(gradeAnswer(answer, "model-x")).rejects.toThrow("mastery was not changed");
  });
  it("rejects string booleans instead of marking false as correct", async () => {
    vi.mocked(runTextModel).mockResolvedValue('{"correct":"false","partial":false,"missed_concepts":[]}');
    await expect(gradeAnswer(answer, "model-x")).rejects.toThrow("invalid grade");
  });
  it("returns a valid structured grade", async () => {
    const grade = { correct: false, partial: true, missed_concepts: ["depth"] };
    vi.mocked(runTextModel).mockResolvedValue(JSON.stringify(grade));
    expect(await gradeAnswer(answer, "model-x")).toEqual(grade);
  });
});

describe("generateFigure", () => {
  it("parses a figure reply", async () => {
    vi.mocked(runTextModel).mockResolvedValue(JSON.stringify({ name: "penguin", outline: [{ x: 0.5, y: 0.1 }], anchors: [{ x: 0.5, y: 0.2 }] }));
    expect((await generateFigure("Linux", 5, "model-x"))?.name).toBe("penguin");
  });
  it("returns null on garbage", async () => {
    vi.mocked(runTextModel).mockResolvedValue("no json");
    expect(await generateFigure("Linux", 5, "model-x")).toBeNull();
  });
});
