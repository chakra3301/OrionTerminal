// src/apps/archives/learn/gating.ts
import type { NodeRow, EdgeRow } from "./learnTypes";
import { MASTERY_THRESHOLD, MIN_ATTEMPTS } from "./bkt";

const DECAY_PER_DAY = 0.004;       // slow cooling of mastery
const REVIEW_BAND = 0.7;            // mastered node drops below this -> review
const DAY = 86_400_000;

export function isMastered(n: Pick<NodeRow, "p_mastery" | "attempts">): boolean {
  return n.p_mastery >= MASTERY_THRESHOLD && n.attempts >= MIN_ATTEMPTS;
}

/** Recompute every node's status from mastery + prerequisite edges. Pure; returns new rows. */
export function recomputeStatuses(nodes: NodeRow[], edges: EdgeRow[]): NodeRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const prereqs = new Map<string, string[]>();
  for (const e of edges) {
    const list = prereqs.get(e.to_node) ?? [];
    list.push(e.from_node);
    prereqs.set(e.to_node, list);
  }
  return nodes.map((n) => {
    if (isMastered(n)) return { ...n, status: "mastered" as const };
    if (n.status === "in_progress") return n;
    const reqs = prereqs.get(n.id) ?? [];
    const unlocked = reqs.every((id) => {
      const p = byId.get(id);
      return p ? isMastered(p) : false;
    });
    return { ...n, status: unlocked ? ("ready" as const) : ("locked" as const) };
  });
}

/** Time-decayed mastery used for review surfacing (does NOT mutate the stored p_mastery). */
export function effectiveMastery(pMastery: number, lastSeen: number | null, now: number): number {
  if (lastSeen == null) return pMastery;
  const days = Math.max(0, (now - lastSeen) / DAY);
  return Math.max(0, pMastery - days * DECAY_PER_DAY);
}

export function needsReview(n: Pick<NodeRow, "p_mastery" | "last_seen">, now: number): boolean {
  if (n.p_mastery < MASTERY_THRESHOLD) return false;
  return effectiveMastery(n.p_mastery, n.last_seen ?? null, now) < REVIEW_BAND;
}
