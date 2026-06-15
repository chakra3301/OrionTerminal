import { useEffect, useRef, useState } from "react";
import { GraduationCap, Plus, Loader2, Trash2 } from "lucide-react";
import { useLearn } from "./useLearn";
import { Constellation } from "./Constellation";
import { LessonView } from "./LessonView";
import { TutorPanel } from "./TutorPanel";

export function LearnView() {
  const loadTopics = useLearn((s) => s.loadTopics);
  const topics = useLearn((s) => s.topics);
  const openTopicId = useLearn((s) => s.openTopicId);
  const openNodeId = useLearn((s) => s.openNodeId);
  const nodes = useLearn((s) => s.nodes);
  const generatingGraph = useLearn((s) => s.generatingGraph);
  const createTopic = useLearn((s) => s.createTopic);
  const openTopic = useLearn((s) => s.openTopic);
  const deleteTopic = useLearn((s) => s.deleteTopic);

  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  const handleCreate = async () => {
    const title = input.trim();
    if (!title || generatingGraph) return;
    setInput("");
    setError(null);
    try {
      await createTopic(title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate graph");
    }
  };

  const topicList = Object.values(topics).sort((a, b) => b.created_at - a.created_at);
  const openTopicData = openTopicId ? topics[openTopicId] : null;
  const nodeCount = Object.keys(nodes).length;

  return (
    <div className="learn-view">
      <div className="learn-rail">
        <div className="learn-rail-header">
          <GraduationCap size={14} className="learn-rail-icon" />
          <span className="learn-rail-title">Topics</span>
        </div>

        <div className="learn-create-wrap">
          <div className={`learn-create-field${generatingGraph ? " learn-create-field--busy" : ""}`}>
            <Plus size={13} className="learn-create-icon" />
            <input
              ref={inputRef}
              className="learn-create-input"
              placeholder="Learn something new…"
              value={input}
              disabled={generatingGraph}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
            />
          </div>
          {generatingGraph && (
            <div className="learn-generating">
              <Loader2 size={11} className="learn-spinner" />
              <span>Generating constellation…</span>
            </div>
          )}
          {error && <div className="learn-error">{error}</div>}
        </div>

        <div className="learn-topic-list">
          {topicList.length === 0 && !generatingGraph && (
            <div className="learn-rail-empty">No topics yet</div>
          )}
          {topicList.map((topic) => (
            <div
              key={topic.id}
              className={`learn-topic-item${openTopicId === topic.id ? " learn-topic-item--active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => void openTopic(topic.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") void openTopic(topic.id);
              }}
            >
              <span className="learn-topic-title">{topic.title}</span>
              <button
                className="learn-topic-delete"
                title="Delete topic"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteTopic(topic.id);
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="learn-body">
        {!openTopicId ? (
          <div className="learn-empty-state">
            <div className="learn-empty-glyph">
              <GraduationCap size={36} />
            </div>
            <div className="learn-empty-heading">Name something you want to learn</div>
            <div className="learn-empty-sub">
              Type a topic in the rail — Claude builds a constellation of concepts,
              ordered by prerequisites, and teaches each one with spaced recall.
            </div>
          </div>
        ) : openNodeId ? (
          <div className="learn-lesson-wrap">
            <LessonView />
            <TutorPanel />
          </div>
        ) : (
          <div className="learn-constellation-wrap">
            <div className="learn-constellation-header">
              <span className="learn-ph-topic">{openTopicData?.title ?? ""}</span>
              <span className="learn-ph-count">{nodeCount} {nodeCount === 1 ? "node" : "nodes"}</span>
            </div>
            <Constellation />
          </div>
        )}
      </div>
    </div>
  );
}
