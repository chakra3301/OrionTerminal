ALTER TABLE chats ADD COLUMN session_id TEXT;
ALTER TABLE chats ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE chats ADD COLUMN total_cost_usd REAL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id, updated_at DESC);
