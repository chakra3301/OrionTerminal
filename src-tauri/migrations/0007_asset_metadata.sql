-- Round out the assets schema for the Phase B media ingest pipeline.
-- Rows already exist with kind/title/file_path/url/metadata_json from
-- migration 0001 — these columns surface the bits the grid needs without
-- forcing every reader to parse metadata_json.

ALTER TABLE assets ADD COLUMN mime_type     TEXT NOT NULL DEFAULT '';
ALTER TABLE assets ADD COLUMN size_bytes    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN original_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_kind       ON assets(kind);
