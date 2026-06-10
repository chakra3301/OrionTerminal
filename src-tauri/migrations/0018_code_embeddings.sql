-- Per-project semantic index over source code (Phase 1.1 / P2e).
-- One row per chunk; `hash` is the WHOLE-FILE content hash repeated on each
-- of its chunks, so unchanged files skip re-embedding with one lookup.
CREATE TABLE IF NOT EXISTS code_embeddings (
  project_id  TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  chunk_idx   INTEGER NOT NULL,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  hash        TEXT    NOT NULL,
  vector      BLOB    NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (project_id, path, chunk_idx)
);

CREATE INDEX IF NOT EXISTS idx_code_embeddings_project
  ON code_embeddings(project_id);
