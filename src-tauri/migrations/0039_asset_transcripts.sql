CREATE TABLE asset_transcripts (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source_revision TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  stream_index INTEGER NOT NULL CHECK (stream_index BETWEEN 0 AND 4095),
  codec TEXT NOT NULL CHECK (length(codec) BETWEEN 1 AND 32),
  language TEXT NOT NULL CHECK (length(language) BETWEEN 1 AND 32),
  plaintext TEXT NOT NULL CHECK (length(CAST(plaintext AS BLOB)) <= 2097152),
  cue_count INTEGER NOT NULL CHECK (cue_count BETWEEN 0 AND 20000),
  indexed_at INTEGER NOT NULL
);

DROP TRIGGER IF EXISTS assets_search_insert;
DROP TRIGGER IF EXISTS assets_search_update;
DROP TRIGGER IF EXISTS assets_search_delete;

CREATE TRIGGER assets_search_insert AFTER INSERT ON assets
BEGIN
  DELETE FROM search_index WHERE entity_id = NEW.id AND entity_type = 'asset';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'asset', COALESCE(NEW.title, ''),
          COALESCE(NEW.url, '') || ' ' || COALESCE(NEW.metadata_json, '') || ' ' ||
          COALESCE((SELECT plaintext FROM asset_transcripts WHERE asset_id = NEW.id), ''));
END;

CREATE TRIGGER assets_search_update AFTER UPDATE ON assets
BEGIN
  DELETE FROM asset_transcripts WHERE asset_id = OLD.id
    AND (OLD.file_path IS NOT NEW.file_path OR OLD.kind IS NOT NEW.kind OR OLD.id IS NOT NEW.id);
  DELETE FROM search_index WHERE entity_id IN (OLD.id, NEW.id) AND entity_type = 'asset';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'asset', COALESCE(NEW.title, ''),
          COALESCE(NEW.url, '') || ' ' || COALESCE(NEW.metadata_json, '') || ' ' ||
          COALESCE((SELECT plaintext FROM asset_transcripts WHERE asset_id = NEW.id), ''));
END;

CREATE TRIGGER assets_search_delete AFTER DELETE ON assets
BEGIN
  DELETE FROM asset_transcripts WHERE asset_id = OLD.id;
  DELETE FROM search_index WHERE entity_id = OLD.id AND entity_type = 'asset';
END;

CREATE TRIGGER asset_transcripts_search_insert AFTER INSERT ON asset_transcripts
BEGIN
  DELETE FROM search_index WHERE entity_id = NEW.asset_id AND entity_type = 'asset';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  SELECT id, 'asset', COALESCE(title, ''),
         COALESCE(url, '') || ' ' || COALESCE(metadata_json, '') || ' ' || NEW.plaintext
  FROM assets WHERE id = NEW.asset_id;
END;

CREATE TRIGGER asset_transcripts_search_update AFTER UPDATE ON asset_transcripts
BEGIN
  DELETE FROM search_index WHERE entity_id IN (OLD.asset_id, NEW.asset_id) AND entity_type = 'asset';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  SELECT id, 'asset', COALESCE(title, ''),
         COALESCE(url, '') || ' ' || COALESCE(metadata_json, '') || ' ' ||
         COALESCE((SELECT plaintext FROM asset_transcripts WHERE asset_id = assets.id), '')
  FROM assets WHERE id IN (OLD.asset_id, NEW.asset_id);
END;

CREATE TRIGGER asset_transcripts_search_delete AFTER DELETE ON asset_transcripts
BEGIN
  DELETE FROM search_index WHERE entity_id = OLD.asset_id AND entity_type = 'asset';
  INSERT INTO search_index(entity_id, entity_type, title, body)
  SELECT id, 'asset', COALESCE(title, ''),
         COALESCE(url, '') || ' ' || COALESCE(metadata_json, '')
  FROM assets WHERE id = OLD.asset_id;
END;
