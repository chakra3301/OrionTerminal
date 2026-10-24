CREATE TABLE media_downloads (
    id TEXT PRIMARY KEY NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL,
    preset TEXT NOT NULL DEFAULT 'video-1080',
    metadata_json TEXT,
    error TEXT,
    asset_id TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX media_downloads_created ON media_downloads(created_at DESC);
