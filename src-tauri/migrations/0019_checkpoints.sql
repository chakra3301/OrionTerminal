-- Agent-edit checkpoints (Phase 1.5): pre-images of every file an agent
-- turn touched, captured BEFORE the first edit landed. Local, independent
-- of git — restoring is "fearless experimentation", and a restore first
-- snapshots the current state so it never destroys history.
CREATE TABLE IF NOT EXISTS checkpoints (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  label      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoint_files (
  checkpoint_id TEXT NOT NULL,
  path          TEXT NOT NULL,
  content       TEXT NOT NULL,
  existed       INTEGER NOT NULL,
  PRIMARY KEY (checkpoint_id, path)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_project
  ON checkpoints(project_id, created_at DESC);
