CREATE TABLE static_app_candidates (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 26),
  source_id TEXT NOT NULL REFERENCES static_app_sources(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  output_hash TEXT NOT NULL CHECK(length(output_hash) = 64),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  candidate_json TEXT NOT NULL CHECK(length(CAST(candidate_json AS BLOB)) <= 3145728)
);
CREATE TRIGGER static_app_candidates_immutable BEFORE UPDATE ON static_app_candidates
BEGIN SELECT RAISE(ABORT, 'Prepared candidates are immutable'); END;
