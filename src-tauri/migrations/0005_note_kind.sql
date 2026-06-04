-- Distinguish journal entries from topic-organized notes. Both share the
-- notes table (same shape: title + blocks_json + plaintext) but the kind
-- decides which Archives view a row appears in. Default 'note' so any
-- previously-created rows surface in the Notes grid, not the Journal.

ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';
CREATE INDEX IF NOT EXISTS idx_notes_kind ON notes(kind);
