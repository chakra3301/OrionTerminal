-- 0025_learn_figures_achievements.sql — topic figures + mastery achievements
ALTER TABLE learn_topics ADD COLUMN figure_json TEXT;

CREATE TABLE learn_achievements (
  id        TEXT PRIMARY KEY,
  topic_id  TEXT NOT NULL,
  kind      TEXT NOT NULL,   -- 'node' | 'topic'
  node_id   TEXT,            -- null for topic badges
  title     TEXT NOT NULL,
  earned_at INTEGER NOT NULL
);
CREATE INDEX idx_learn_achv_topic ON learn_achievements(topic_id);
