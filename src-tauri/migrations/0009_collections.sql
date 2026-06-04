-- Collections are user-defined groupings that any note (kind=note, journal,
-- or project) can be assigned to. Used to filter the Projects/Notes/Journal
-- views from the sidebar. Deleting a collection clears the foreign key on
-- its members rather than cascading the delete.

CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collections_updated_at
  ON collections(updated_at DESC);

ALTER TABLE notes
  ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_collection_id ON notes(collection_id);
