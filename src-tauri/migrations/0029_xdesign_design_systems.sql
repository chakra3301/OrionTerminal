-- 0029_xdesign_design_systems.sql — XDesign brand contracts (design systems)
-- Persistent, reusable design systems that shape every AI generation/restyle.
CREATE TABLE xd_design_systems (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data_json   TEXT NOT NULL DEFAULT '{}',  -- full DesignSystem blob
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Which design system is active (drives AI prompts). Single-row key/value.
CREATE TABLE xd_active_design_system (
  k       TEXT PRIMARY KEY DEFAULT 'active',
  ds_id   TEXT
);
