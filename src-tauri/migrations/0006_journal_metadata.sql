-- Journal entries get a free-text location field (Apple-Journal-style).
-- Stored on the shared notes table so the column also exists for kind='note'
-- but is only surfaced in the Journal UI. NOT NULL with empty-string default
-- so older rows just read as "no location set".

ALTER TABLE notes ADD COLUMN location TEXT NOT NULL DEFAULT '';
