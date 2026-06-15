import { describe, it, expect } from "vitest";
import { recomputeStatuses, effectiveMastery, needsReview } from "./gating";
import type { NodeRow, EdgeRow } from "./learnTypes";

const node = (id: string, over: Partial<NodeRow> = {}): NodeRow => ({
  id, topic_id: "t", title: id, objective: null, bloom_level: null, level: "basics",
  order_idx: 0, lesson_json: null, lesson_at: null, p_mastery: 0, attempts: 0, last_seen: null, status: "locked", ...over,
});

describe("recomputeStatuses", () => {
  it("marks prereq-free nodes ready and dependents locked", () => {
    const nodes = [node("a"), node("b")];
    const edges: EdgeRow[] = [{ topic_id: "t", from_node: "a", to_node: "b" }];
    const out = recomputeStatuses(nodes, edges);
    expect(out.find((n) => n.id === "a")!.status).toBe("ready");
    expect(out.find((n) => n.id === "b")!.status).toBe("locked");
  });

  it("unlocks a dependent once its prereq is mastered", () => {
    const nodes = [node("a", { p_mastery: 0.9, attempts: 4 }), node("b")];
    const edges: EdgeRow[] = [{ topic_id: "t", from_node: "a", to_node: "b" }];
    const out = recomputeStatuses(nodes, edges);
    expect(out.find((n) => n.id === "a")!.status).toBe("mastered");
    expect(out.find((n) => n.id === "b")!.status).toBe("ready");
  });

  it("does not unlock on a lucky guess (attempts < MIN)", () => {
    const nodes = [node("a", { p_mastery: 0.95, attempts: 1 }), node("b")];
    const edges: EdgeRow[] = [{ topic_id: "t", from_node: "a", to_node: "b" }];
    const out = recomputeStatuses(nodes, edges);
    expect(out.find((n) => n.id === "b")!.status).toBe("locked");
  });

  it("preserves in_progress for a started-but-unmastered node", () => {
    const nodes = [node("a", { p_mastery: 0.4, attempts: 2, status: "in_progress" })];
    const out = recomputeStatuses(nodes, []);
    expect(out[0]!.status).toBe("in_progress");
  });
});

describe("effectiveMastery / needsReview", () => {
  it("decays mastery with age but never below 0", () => {
    const now = 1_000_000_000_000;
    const monthAgo = now - 30 * 86_400_000;
    expect(effectiveMastery(0.9, monthAgo, now)).toBeLessThan(0.9);
    expect(effectiveMastery(0.9, monthAgo, now)).toBeGreaterThanOrEqual(0);
  });

  it("flags a mastered node for review once decayed below the review band", () => {
    const now = 1_000_000_000_000;
    const longAgo = now - 120 * 86_400_000;
    expect(needsReview({ p_mastery: 0.85, last_seen: longAgo } as any, now)).toBe(true);
    expect(needsReview({ p_mastery: 0.85, last_seen: now } as any, now)).toBe(false);
  });
});
