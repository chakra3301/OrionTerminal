CREATE TABLE skill_package_versions (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL CHECK(schema_version = 1),
    manifest_hash TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    total_bytes INTEGER NOT NULL CHECK(total_bytes BETWEEN 1 AND 8388608),
    created_at INTEGER NOT NULL
);
CREATE TABLE skill_package_files (
    candidate_id TEXT NOT NULL REFERENCES skill_package_versions(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    contents BLOB NOT NULL,
    PRIMARY KEY(candidate_id, path)
);
CREATE TABLE skill_package_links (
    skill_id TEXT PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
    active_version TEXT NOT NULL REFERENCES skill_package_versions(id),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
);
CREATE TABLE skill_package_receipts (
    candidate_id TEXT PRIMARY KEY,
    manifest_hash TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1))
);
CREATE INDEX skill_package_versions_owner ON skill_package_versions(skill_id);
