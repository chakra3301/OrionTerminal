-- 0024_learn.sql — Archives "Learn" section
CREATE TABLE learn_topics (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  summary     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE learn_nodes (
  id          TEXT PRIMARY KEY,
  topic_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  objective   TEXT,
  bloom_level TEXT,
  level       TEXT NOT NULL,
  order_idx   INTEGER NOT NULL,
  lesson_json TEXT,
  lesson_at   INTEGER,
  p_mastery   REAL NOT NULL DEFAULT 0.0,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_seen   INTEGER,
  status      TEXT NOT NULL DEFAULT 'locked'
);
CREATE INDEX idx_learn_nodes_topic ON learn_nodes(topic_id);

CREATE TABLE learn_edges (
  topic_id  TEXT NOT NULL,
  from_node TEXT NOT NULL,
  to_node   TEXT NOT NULL,
  PRIMARY KEY (topic_id, from_node, to_node)
);

CREATE TABLE learn_reviews (
  id        TEXT PRIMARY KEY,
  node_id   TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  correct   INTEGER NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'recall'
);
CREATE INDEX idx_learn_reviews_node ON learn_reviews(node_id);
