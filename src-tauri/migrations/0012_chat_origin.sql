-- Track which app a chat originated in so `openChatById` can route the
-- conversation back to the right surface (Archives / Orion / XDesign).
-- Pre-existing rows have NULL origin — routing treats NULL the same as
-- 'archives' (the historical default for project_id=NULL chats).

ALTER TABLE chats ADD COLUMN origin TEXT;
