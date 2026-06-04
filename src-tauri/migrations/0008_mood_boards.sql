-- Mood Boards are first-class containers for assets — Pinterest/Are.na style.
-- An asset can appear on any number of boards (or none); deleting a board
-- removes its memberships but leaves the underlying assets intact.

CREATE TABLE IF NOT EXISTS mood_boards (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  cover_asset_id TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mood_board_assets (
  board_id  TEXT NOT NULL REFERENCES mood_boards(id) ON DELETE CASCADE,
  asset_id  TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (board_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_mood_board_assets_board
  ON mood_board_assets(board_id, position);

CREATE INDEX IF NOT EXISTS idx_mood_boards_updated_at
  ON mood_boards(updated_at DESC);
