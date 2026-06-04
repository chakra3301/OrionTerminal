-- Vector embeddings for semantic search across notes / chats / assets. Each
-- row stores a Float32Array as a packed BLOB (little-endian f32 bytes). The
-- text_hash field lets the indexer skip re-embedding when the underlying
-- entity text hasn't changed. Primary key is composite so the same id can
-- coexist across entity kinds.
--
-- Note: migration 3 created a vestigial `embeddings` table with a different
-- shape (entity_type / embedding / generated_at / source_hash) that was
-- never written to. We drop it here so the new schema can land cleanly. No
-- data loss — that legacy table never had rows; the runtime code that
-- actually does the embedding (Xenova/all-MiniLM-L6-v2) only landed in 0010.

DROP TABLE IF EXISTS embeddings;

CREATE TABLE embeddings (
  entity_kind TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  vector      BLOB NOT NULL,
  text_hash   TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_kind, entity_id)
);

CREATE INDEX idx_embeddings_kind ON embeddings(entity_kind);
