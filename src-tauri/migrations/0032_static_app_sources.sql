CREATE TABLE static_app_sources (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 26),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  recipe_id TEXT NOT NULL CHECK(recipe_id = '2048-classic-v1'),
  source_hash TEXT NOT NULL CHECK(length(source_hash) = 64),
  capture_hash TEXT NOT NULL CHECK(length(capture_hash) = 64),
  total_bytes INTEGER NOT NULL CHECK(total_bytes > 0 AND total_bytes <= 262144),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  capture_json TEXT NOT NULL CHECK(length(CAST(capture_json AS BLOB)) <= 393216)
);

CREATE TRIGGER static_app_sources_immutable BEFORE UPDATE ON static_app_sources
BEGIN SELECT RAISE(ABORT, 'Static source captures are immutable'); END;
