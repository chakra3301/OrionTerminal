-- Fix for v3: FTS5 virtual tables don't honor INSERT OR REPLACE against
-- UNINDEXED columns (no unique constraint to conflict on), so the v3
-- update triggers were creating duplicate rows in search_index instead
-- of replacing. Drop the broken triggers and recreate with DELETE + INSERT
-- inside BEGIN/END (atomic at trigger level, no missing window).

DROP TRIGGER IF EXISTS notes_search_insert;
DROP TRIGGER IF EXISTS notes_search_update;
DROP TRIGGER IF EXISTS assets_search_insert;
DROP TRIGGER IF EXISTS assets_search_update;
DROP TRIGGER IF EXISTS chats_search_insert;
DROP TRIGGER IF EXISTS chats_search_update;

-- One-time cleanup: any duplicate rows already inserted by the broken
-- triggers. Keep only the lowest rowid per (entity_id, entity_type).
DELETE FROM search_index
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM search_index
  GROUP BY entity_id, entity_type
);

CREATE TRIGGER IF NOT EXISTS notes_search_insert AFTER INSERT ON notes
BEGIN
  DELETE FROM search_index WHERE entity_id = NEW.id AND entity_type = 'note';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'note', NEW.title, NEW.plaintext);
END;

CREATE TRIGGER IF NOT EXISTS notes_search_update AFTER UPDATE ON notes
BEGIN
  DELETE FROM search_index WHERE entity_id = OLD.id AND entity_type = 'note';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'note', NEW.title, NEW.plaintext);
END;

CREATE TRIGGER IF NOT EXISTS assets_search_insert AFTER INSERT ON assets
BEGIN
  DELETE FROM search_index WHERE entity_id = NEW.id AND entity_type = 'asset';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'asset', COALESCE(NEW.title, ''),
          COALESCE(NEW.url, '') || ' ' || COALESCE(NEW.metadata_json, ''));
END;

CREATE TRIGGER IF NOT EXISTS assets_search_update AFTER UPDATE ON assets
BEGIN
  DELETE FROM search_index WHERE entity_id = OLD.id AND entity_type = 'asset';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'asset', COALESCE(NEW.title, ''),
          COALESCE(NEW.url, '') || ' ' || COALESCE(NEW.metadata_json, ''));
END;

CREATE TRIGGER IF NOT EXISTS chats_search_insert AFTER INSERT ON chats
BEGIN
  DELETE FROM search_index WHERE entity_id = NEW.id AND entity_type = 'chat';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'chat', NEW.title, NEW.searchable_text);
END;

CREATE TRIGGER IF NOT EXISTS chats_search_update AFTER UPDATE ON chats
BEGIN
  DELETE FROM search_index WHERE entity_id = OLD.id AND entity_type = 'chat';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'chat', NEW.title, NEW.searchable_text);
END;
