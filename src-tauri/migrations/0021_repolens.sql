CREATE TABLE IF NOT EXISTS repolens_scans (
  repo_id       TEXT PRIMARY KEY,
  platform      TEXT NOT NULL,
  model         TEXT NOT NULL DEFAULT '',
  tone          TEXT NOT NULL DEFAULT 'neutral',
  analysis_json TEXT NOT NULL,
  lenses_json   TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repolens_updated ON repolens_scans(updated_at DESC);
