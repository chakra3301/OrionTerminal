-- Ambient activity log: a lightweight, append-only trail of meaningful things
-- done across the terminal (Hermes swarms, Archives edits, Orion saves, XDesign
-- canvas work). R.O.S.I.E reads it on demand via the orion_recent_activity tool
-- so she has a gist of what's been happening without loading full content.
-- Short text only — never full document bodies.
CREATE TABLE IF NOT EXISTS activity_log (
  id      TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,            -- epoch ms
  source  TEXT NOT NULL,               -- hermes | archives | orion | xdesign
  kind    TEXT NOT NULL,               -- e.g. file.save, note.edit, task.dispatch, agent.done
  title   TEXT NOT NULL DEFAULT '',    -- short human label (filename, note title, task title)
  summary TEXT NOT NULL DEFAULT '',    -- one-line gist (research conclusion excerpt, layer count)
  ref_id  TEXT NOT NULL DEFAULT ''     -- entity id for collapse + (future) deep-linking
);

CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_source_ts ON activity_log(source, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_collapse ON activity_log(source, kind, ref_id, ts DESC);
