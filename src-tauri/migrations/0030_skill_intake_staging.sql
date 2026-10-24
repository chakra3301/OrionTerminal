CREATE TABLE skill_intake_candidates (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK(schema_version = 1),
    manifest_hash TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    total_bytes INTEGER NOT NULL CHECK(total_bytes BETWEEN 1 AND 8388608),
    created_at INTEGER NOT NULL
);

CREATE TABLE skill_intake_files (
    candidate_id TEXT NOT NULL REFERENCES skill_intake_candidates(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    contents BLOB NOT NULL,
    PRIMARY KEY(candidate_id, path)
);
