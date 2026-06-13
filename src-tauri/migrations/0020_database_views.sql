-- Database layer (Phase 2.3): a collection becomes a Notion-style database.
-- It defines a typed-property SCHEMA; notes filed in it carry values for
-- those properties; and it can be shown through several saved VIEWS.
-- Additive only (the iOS companion reads orion.db directly and ignores these).

-- Per-collection property schema.
CREATE TABLE IF NOT EXISTS collection_properties (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  -- text | number | select | multi_select | status | date | checkbox | url
  type          TEXT NOT NULL,
  -- select/multi_select/status: JSON [{id,name,color}]
  options_json  TEXT NOT NULL DEFAULT '[]',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_properties_coll
  ON collection_properties(collection_id);

-- One value per (note, property). Encoding by type: text/number/date/url as
-- a plain string; checkbox '0'/'1'; select/status = optionId; multi_select =
-- JSON array of optionIds.
CREATE TABLE IF NOT EXISTS note_property_values (
  note_id     TEXT NOT NULL,
  property_id TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (note_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_note_property_values_note
  ON note_property_values(note_id);

-- Saved views over a collection (table/board/gallery/calendar) with their
-- own filters/sorts/grouping in config_json.
CREATE TABLE IF NOT EXISTS collection_views (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  config_json   TEXT NOT NULL DEFAULT '{}',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_views_coll
  ON collection_views(collection_id);
