-- Command Center: a commandable AI org that replaces the Hermes Kanban.
-- "One engine (pi), many profiles." A profile = persona + brain model + skills
-- + its own LLM-Wiki vault + a rank. Ranks: commander (the user) -> general
-- (pure coordinator) -> captain (one per division). No operatives, no swarms;
-- each captain profile works serially in its own pi session. Delegation flows
-- as typed messages (directive/report/handoff) and the channel UI is a view
-- over that log. Additive, append-only. The Hermes tables stay read-only.

CREATE TABLE IF NOT EXISTS cc_profiles (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  rank           TEXT NOT NULL DEFAULT 'captain',   -- commander | general | captain
  division       TEXT NOT NULL DEFAULT '',          -- '' for commander/general
  accent         TEXT NOT NULL DEFAULT '',
  brain_model    TEXT NOT NULL DEFAULT '',          -- '' for the commander (the user)
  skill_ids_json TEXT NOT NULL DEFAULT '[]',
  wiki_root      TEXT NOT NULL DEFAULT '',          -- this profile's LLM-Wiki vault path
  charter        TEXT NOT NULL DEFAULT '',          -- persona / mandate
  autonomy_level INTEGER NOT NULL DEFAULT 1,        -- 0 manual | 1 approve-each | 2 budget | 3 auto
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cc_channels (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'division',      -- command | division | cross | dm
  division   TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cc_messages (
  id              TEXT PRIMARY KEY,
  channel_id      TEXT NOT NULL,
  from_profile_id TEXT NOT NULL DEFAULT '',
  to_profile_id   TEXT,                             -- nullable: directed message target
  kind            TEXT NOT NULL DEFAULT 'chat',     -- chat | directive | report | handoff
  body            TEXT NOT NULL DEFAULT '',
  mission_ref     TEXT NOT NULL DEFAULT '',         -- cc_missions.id this message belongs to
  ts              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cc_missions (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL DEFAULT '',
  brief               TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'draft', -- draft|planned|running|review|done|blocked
  autonomy_level      INTEGER NOT NULL DEFAULT 1,
  assigned_profile_id TEXT,
  origin_profile_id   TEXT,
  ts                  INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cc_profiles_rank ON cc_profiles(rank, position);
CREATE INDEX IF NOT EXISTS idx_cc_channels_kind ON cc_channels(kind, position);
CREATE INDEX IF NOT EXISTS idx_cc_messages_channel ON cc_messages(channel_id, ts);
CREATE INDEX IF NOT EXISTS idx_cc_messages_mission ON cc_messages(mission_ref, ts);
CREATE INDEX IF NOT EXISTS idx_cc_missions_status ON cc_missions(status, updated_at DESC);
