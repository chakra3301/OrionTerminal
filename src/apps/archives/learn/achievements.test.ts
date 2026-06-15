// src/apps/archives/learn/achievements.test.ts
import { describe, it, expect } from "vitest";
import { achievementKey, topicFullyMastered, detectNewAchievements } from "./achievements";
import type { NodeRow } from "./learnTypes";

const node = (id: string, status: NodeRow["status"]): NodeRow => ({
  id, topic_id: "t", title: id.toUpperCase(), objective: null, bloom_level: null,
  level: "basics", order_idx: 0, lesson_json: null, lesson_at: null,
  p_mastery: status === "mastered" ? 0.9 : 0.1, attempts: status === "mastered" ? 3 : 0,
  last_seen: null, status,
});
const rec = (...ns: NodeRow[]) => Object.fromEntries(ns.map((n) => [n.id, n]));

describe("achievementKey", () => {
  it("namespaces node vs topic", () => {
    expect(achievementKey("node", "a")).toBe("node:a");
    expect(achievementKey("topic")).toBe("topic");
  });
});

describe("topicFullyMastered", () => {
  it("is true only when every node is mastered", () => {
    expect(topicFullyMastered([node("a", "mastered"), node("b", "mastered")])).toBe(true);
    expect(topicFullyMastered([node("a", "mastered"), node("b", "ready")])).toBe(false);
    expect(topicFullyMastered([])).toBe(false);
  });
});

describe("detectNewAchievements", () => {
  it("detects a node that just became mastered", () => {
    const prev = rec(node("a", "in_progress"), node("b", "locked"));
    const next = rec(node("a", "mastered"), node("b", "locked"));
    const out = detectNewAchievements(prev, next, new Set());
    expect(out.nodeIds).toEqual(["a"]);
    expect(out.topicEarned).toBe(false);
  });

  it("does not re-award an already-earned node (decay then re-master)", () => {
    const prev = rec(node("a", "ready"));
    const next = rec(node("a", "mastered"));
    const out = detectNewAchievements(prev, next, new Set(["node:a"]));
    expect(out.nodeIds).toEqual([]);
  });

  it("awards the topic when the last node flips and topic not yet earned", () => {
    const prev = rec(node("a", "mastered"), node("b", "in_progress"));
    const next = rec(node("a", "mastered"), node("b", "mastered"));
    const out = detectNewAchievements(prev, next, new Set(["node:a"]));
    expect(out.nodeIds).toEqual(["b"]);
    expect(out.topicEarned).toBe(true);
  });

  it("does not re-award an already-earned topic", () => {
    const prev = rec(node("a", "mastered"));
    const next = rec(node("a", "mastered"));
    const out = detectNewAchievements(prev, next, new Set(["node:a", "topic"]));
    expect(out.topicEarned).toBe(false);
  });
});
