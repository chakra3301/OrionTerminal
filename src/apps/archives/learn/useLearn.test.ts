import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./learnDb", () => ({
  listTopics: vi.fn().mockResolvedValue([]),
  insertTopic: vi.fn().mockResolvedValue(undefined),
  insertNode: vi.fn().mockResolvedValue(undefined),
  insertEdge: vi.fn().mockResolvedValue(undefined),
  listNodes: vi.fn().mockResolvedValue([]),
  listEdges: vi.fn().mockResolvedValue([]),
  updateNode: vi.fn().mockResolvedValue(undefined),
  insertReview: vi.fn().mockResolvedValue(undefined),
  deleteTopic: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./claude", () => ({
  generateGraph: vi.fn().mockResolvedValue({ summary: "s", nodes: [
    { key: "a", title: "A", objective: "o", bloom_level: "remember", level: "basics", prereqs: [] },
    { key: "b", title: "B", objective: "o", bloom_level: "apply", level: "intermediate", prereqs: ["a"] },
  ]}),
  generateLesson: vi.fn().mockResolvedValue({ objective: "o", concept_chunks: [], worked_example: null, key_terms: [], suggested_resources: [], recall_check: [] }),
  gradeAnswer: vi.fn().mockResolvedValue({ correct: true, partial: false, missed_concepts: [] }),
  findRealLinks: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../lib/models", () => ({ MODELS: [], DEFAULT_MODEL_ID: "claude-opus-4-8" }));

import { useLearn } from "./useLearn";

beforeEach(() => { useLearn.setState(useLearn.getInitialState ? useLearn.getInitialState() : {} as any, true); });

describe("createTopic", () => {
  it("generates a graph, persists nodes+edges, and gates the dependent node locked", async () => {
    await useLearn.getState().createTopic("Photography");
    const s = useLearn.getState();
    const nodes = Object.values(s.nodes);
    expect(nodes).toHaveLength(2);
    const a = nodes.find((n: any) => n.title === "A")!;
    const b = nodes.find((n: any) => n.title === "B")!;
    expect(a.status).toBe("ready");
    expect(b.status).toBe("locked");
  });
});

describe("submitAnswer", () => {
  it("raises mastery and eventually unlocks the dependent after enough correct attempts", async () => {
    await useLearn.getState().createTopic("Photography");
    const a = Object.values(useLearn.getState().nodes).find((n: any) => n.title === "A")! as any;
    for (let i = 0; i < 4; i++) {
      await useLearn.getState().submitAnswer(a.id, { question: "q", expected: "e", concept: "c", answer: "yes" });
    }
    const nodes = Object.values(useLearn.getState().nodes) as any[];
    expect(nodes.find((n) => n.title === "A")!.status).toBe("mastered");
    expect(nodes.find((n) => n.title === "B")!.status).toBe("ready");
  });
});
