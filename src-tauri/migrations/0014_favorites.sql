-- Favorites: a per-row star flag on the content tables that surface in
-- Archives. Additive, append-only — defaults to 0 so every existing row is
-- "not favorited" without a backfill.
ALTER TABLE notes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mood_boards ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_notes_favorite ON notes(favorite);
CREATE INDEX IF NOT EXISTS idx_assets_favorite ON assets(favorite);
CREATE INDEX IF NOT EXISTS idx_mood_boards_favorite ON mood_boards(favorite);
