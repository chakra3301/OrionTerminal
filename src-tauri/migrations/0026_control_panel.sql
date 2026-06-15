-- 0026_control_panel.sql — provider registry, skill library, custom agents
CREATE TABLE providers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- 'anthropic' | 'openai' | 'google' | 'openai_compat' | 'custom'
  base_url    TEXT NOT NULL DEFAULT '',
  models_json TEXT NOT NULL DEFAULT '[]',
  key_ref     TEXT NOT NULL DEFAULT '', -- keychain account name; '' = keyless/local
  enabled     INTEGER NOT NULL DEFAULT 1,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE skills (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  icon         TEXT NOT NULL DEFAULT '',
  accent       TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  tools_json   TEXT NOT NULL DEFAULT '[]',
  builtin      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE agents (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT '',
  accent         TEXT NOT NULL DEFAULT '',
  avatar_asset_id TEXT,
  avatar_url     TEXT,
  brain_model    TEXT NOT NULL,
  action_model   TEXT NOT NULL DEFAULT '',
  skill_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
