-- Plaintext columns populated by the TS-side BlockNote walker (notes) and
-- the chat-message text concatenator. Triggers below read these columns
-- directly; never call json_extract from a trigger.
ALTER TABLE notes ADD COLUMN plaintext TEXT NOT NULL DEFAULT '';
ALTER TABLE chats ADD COLUMN searchable_text TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

-- sqlite-vec compatible: embedding is little-endian packed f32, 384 dims = 1536 bytes.
-- source_hash lets the embedding scheduler skip rows whose source text is unchanged.
CREATE TABLE IF NOT EXISTS embeddings (
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  embedding BLOB NOT NULL,
  generated_at INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY (entity_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_type ON embeddings(entity_type);

-- search_index triggers. Use INSERT OR REPLACE so the row is never missing
-- between delete and insert (single-statement atomicity inside the trigger).

CREATE TRIGGER IF NOT EXISTS notes_search_insert AFTER INSERT ON notes
BEGIN
  INSERT OR REPLACE INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'note', NEW.title, NEW.plaintext);
END;

CREATE TRIGGER IF NOT EXISTS notes_search_update AFTER UPDATE ON notes
BEGIN
  INSERT OR REPLACE INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'note', NEW.title, NEW.plaintext);
END;

CREATE TRIGGER IF NOT EXISTS notes_search_delete AFTER DELETE ON notes
BEGIN
  DELETE FROM search_index WHERE entity_id = OLD.id AND entity_type = 'note';
END;

CREATE TRIGGER IF NOT EXISTS assets_search_insert AFTER INSERT ON assets
BEGIN
  INSERT OR REPLACE INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'asset', COALESCE(NEW.title, ''),
          COALESCE(NEW.url, '') || ' ' || COALESCE(NEW.metadata_json, ''));
END;

CREATE TRIGGER IF NOT EXISTS assets_search_update AFTER UPDATE ON assets
BEGIN
  INSERT OR REPLACE INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'asset', COALESCE(NEW.title, ''),
          COALESCE(NEW.url, '') || ' ' || COALESCE(NEW.metadata_json, ''));
END;

CREATE TRIGGER IF NOT EXISTS assets_search_delete AFTER DELETE ON assets
BEGIN
  DELETE FROM search_index WHERE entity_id = OLD.id AND entity_type = 'asset';
END;

CREATE TRIGGER IF NOT EXISTS chats_search_insert AFTER INSERT ON chats
BEGIN
  INSERT OR REPLACE INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'chat', NEW.title, NEW.searchable_text);
END;

CREATE TRIGGER IF NOT EXISTS chats_search_update AFTER UPDATE ON chats
BEGIN
  INSERT OR REPLACE INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'chat', NEW.title, NEW.searchable_text);
END;

CREATE TRIGGER IF NOT EXISTS chats_search_delete AFTER DELETE ON chats
BEGIN
  DELETE FROM search_index WHERE entity_id = OLD.id AND entity_type = 'chat';
END;
