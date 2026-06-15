// src/apps/archives/learn/TrophyShelf.tsx
import { useLearn } from "./useLearn";
import { MasteryBadge } from "./MasteryBadge";
import type { Figure } from "./figure";

export function TrophyShelf() {
  const topics = useLearn((s) => s.topics);
  const progress = useLearn((s) => s.progress);
  const achievements = useLearn((s) => s.allAchievements);

  const topicList = Object.values(topics).sort((a, b) => b.created_at - a.created_at);
  const earnedTopicIds = new Set(achievements.filter((a) => a.kind === "topic").map((a) => a.topic_id));
  const nodeCountByTopic = (id: string) => achievements.filter((a) => a.kind === "node" && a.topic_id === id).length;

  const outlineOf = (figJson: string | null): Figure["outline"] | null => {
    try { return figJson ? (JSON.parse(figJson) as Figure).outline : null; } catch { return null; }
  };

  return (
    <div className="learn-trophy-shelf">
      <h2 className="learn-trophy-heading">Trophies</h2>
      {topicList.length === 0 && <div className="learn-rail-empty">Nothing earned yet — master some concepts.</div>}
      {topicList.map((t) => {
        const p = progress[t.id] ?? { total: 0, mastered: 0 };
        const earned = earnedTopicIds.has(t.id);
        return (
          <div key={t.id}>
            <div className="learn-trophy-topic">{t.title} · {nodeCountByTopic(t.id)} nodes · {p.mastered}/{p.total}</div>
            <div className="learn-trophy-grid">
              <div className={earned ? "" : "learn-trophy-locked"}>
                <MasteryBadge topicTitle={t.title} outline={outlineOf(t.figure_json)} masteredCount={p.mastered} total={p.total} size={150} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
