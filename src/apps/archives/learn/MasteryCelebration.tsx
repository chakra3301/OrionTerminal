// src/apps/archives/learn/MasteryCelebration.tsx
import { useLearn } from "./useLearn";
import { MasteryBadge } from "./MasteryBadge";
import type { Figure } from "./figure";

export function MasteryCelebration() {
  const topicId = useLearn((s) => s.celebrateTopicId);
  const topics = useLearn((s) => s.topics);
  const progress = useLearn((s) => s.progress);
  const dismiss = useLearn((s) => s.dismissCelebration);
  if (!topicId) return null;
  const topic = topics[topicId];
  if (!topic) return null;
  let outline: Figure["outline"] | null = null;
  try { outline = topic.figure_json ? (JSON.parse(topic.figure_json) as Figure).outline : null; } catch { outline = null; }
  const p = progress[topicId] ?? { total: 0, mastered: 0 };

  return (
    <div className="learn-celebrate" role="dialog" aria-label="Topic mastered" onClick={dismiss}>
      <div className="learn-celebrate-badge">
        <MasteryBadge topicTitle={topic.title} outline={outline} masteredCount={p.mastered} total={p.total} size={260} />
      </div>
      <div className="learn-celebrate-stamp">TOPIC MASTERED</div>
      <button className="learn-shape-btn" onClick={dismiss}>Dismiss</button>
    </div>
  );
}
