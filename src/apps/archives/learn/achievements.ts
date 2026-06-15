// src/apps/archives/learn/achievements.ts
import type { NodeRow } from "./learnTypes";

export type AchievementKind = "node" | "topic";

export function achievementKey(kind: AchievementKind, nodeId?: string): string {
  return kind === "node" ? `node:${nodeId}` : "topic";
}

export function topicFullyMastered(nodes: NodeRow[]): boolean {
  return nodes.length > 0 && nodes.every((n) => n.status === "mastered");
}

/**
 * Pure diff of node-status records. Returns the node ids that newly became
 * mastered (and aren't already earned), and whether the topic badge is newly
 * earned. Idempotent via the `earned` key set — decay then re-master never
 * re-awards.
 */
export function detectNewAchievements(
  prev: Record<string, NodeRow>,
  next: Record<string, NodeRow>,
  earned: Set<string>,
): { nodeIds: string[]; topicEarned: boolean } {
  const nodeIds: string[] = [];
  for (const id of Object.keys(next)) {
    const before = prev[id];
    const after = next[id]!;
    const becameMastered = after.status === "mastered" && (!before || before.status !== "mastered");
    if (becameMastered && !earned.has(achievementKey("node", id))) nodeIds.push(id);
  }
  const topicEarned = topicFullyMastered(Object.values(next)) && !earned.has(achievementKey("topic"));
  return { nodeIds, topicEarned };
}
