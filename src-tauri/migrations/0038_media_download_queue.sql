CREATE TABLE media_download_queue (
    job_id TEXT PRIMARY KEY NOT NULL REFERENCES media_downloads(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    resume_transfer INTEGER NOT NULL DEFAULT 0 CHECK(resume_transfer IN (0,1))
);
CREATE INDEX media_download_queue_position ON media_download_queue(position,job_id);
