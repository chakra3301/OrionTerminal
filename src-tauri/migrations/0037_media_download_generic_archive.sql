-- Generic extractor IDs may be only a filename, shared by unrelated hosts.
-- Keep the source URL as their identity; do not mutate migration 0036.
INSERT OR IGNORE INTO media_download_archive(source_key,source_url,variant_json,saved_at,asset_id)
SELECT source_url,source_url,variant_json,saved_at,asset_id
FROM media_download_archive
WHERE lower(source_key) LIKE 'generic:%' OR source_key LIKE ':%' OR source_key LIKE '%:';
DELETE FROM media_download_archive
WHERE lower(source_key) LIKE 'generic:%' OR source_key LIKE ':%' OR source_key LIKE '%:';

-- Recover retained completed identities which previously collided on basename.
INSERT OR IGNORE INTO media_download_archive(source_key,source_url,variant_json,saved_at,asset_id)
SELECT url,url,
       json_array(preset,
           coalesce(json_extract(options_json,'$.playable'),1),
           coalesce(json_extract(options_json,'$.audioQuality'),0),
           CAST(json_extract(options_json,'$.startSeconds') AS REAL),
           CAST(json_extract(options_json,'$.endSeconds') AS REAL),
           json_extract(options_json,'$.formatId')),
       created_at,asset_id
FROM media_downloads
WHERE state='completed' AND source_asset_id IS NULL AND asset_id IS NOT NULL
  AND json_valid(metadata_json) AND json_valid(options_json)
  AND (lower(json_extract(metadata_json,'$.sourceId')) LIKE 'generic:%'
       OR json_extract(metadata_json,'$.sourceId') LIKE ':%'
       OR json_extract(metadata_json,'$.sourceId') LIKE '%:');
