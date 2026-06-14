CREATE TABLE IF NOT EXISTS repolens_websites (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  hostname        TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL,           -- queued|running|done|error|cancelled|paused
  phase           TEXT NOT NULL DEFAULT '',
  project_path    TEXT NOT NULL,
  thumbnail_path  TEXT,
  log             TEXT NOT NULL DEFAULT '',
  session_id      TEXT,
  error           TEXT,
  model           TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repolens_websites_updated ON repolens_websites(updated_at DESC);
