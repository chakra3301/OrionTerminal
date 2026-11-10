CREATE TABLE media_download_preferences (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    settings_json TEXT NOT NULL
);

CREATE TABLE media_download_archive (
    source_key TEXT NOT NULL,
    source_url TEXT NOT NULL,
    variant_json TEXT NOT NULL,
    saved_at INTEGER NOT NULL,
    asset_id TEXT NOT NULL,
    PRIMARY KEY(source_key, variant_json)
);
CREATE INDEX media_download_archive_url ON media_download_archive(source_url);

-- History cleanup must not erase successful-download identities. No asset FK:
-- intentionally forgetting an asset is distinct from redownloading a source.
INSERT OR IGNORE INTO media_download_archive(source_key,source_url,variant_json,saved_at,asset_id)
SELECT CASE WHEN length(json_extract(metadata_json,'$.sourceId')) > 1
            THEN json_extract(metadata_json,'$.sourceId') ELSE url END,
       url,
       json_array(preset,
           coalesce(json_extract(options_json,'$.playable'),1),
           coalesce(json_extract(options_json,'$.audioQuality'),0),
           CAST(json_extract(options_json,'$.startSeconds') AS REAL),
           CAST(json_extract(options_json,'$.endSeconds') AS REAL),
           json_extract(options_json,'$.formatId')),
       created_at,asset_id
FROM media_downloads
WHERE state='completed' AND source_asset_id IS NULL AND asset_id IS NOT NULL
  AND json_valid(metadata_json) AND json_valid(options_json);
