ALTER TABLE media_downloads ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE media_downloads ADD COLUMN source_asset_id TEXT;
CREATE INDEX media_downloads_source_asset ON media_downloads(source_asset_id);
