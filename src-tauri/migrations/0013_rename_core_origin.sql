-- The central agent "Core" was renamed to R.O.S.I.E. Its chat rows were
-- persisted with origin='core'; migrate them to origin='rosie' so the
-- frontend's routing (openChatById + resumeLatest) finds them under the
-- new name. Idempotent — no-op if no 'core' rows exist (fresh installs).

UPDATE chats SET origin = 'rosie' WHERE origin = 'core';
