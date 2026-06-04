-- Per-project workspace layout persistence. Each row stores the serialized
-- LayoutNode tree + which panel was focused for one project. Replaces the
-- global `workspace.layout` app_state key with project-scoped storage so
-- switching projects no longer carries the prior project's file tabs across.
-- project_id has no FK because the projects table itself uses TEXT ids and
-- we never cascade-delete projects today; a stale row is harmless (it just
-- never matches a live project on lookup).

CREATE TABLE IF NOT EXISTS workspace_layouts (
  project_id        TEXT PRIMARY KEY,
  layout_json       TEXT NOT NULL,
  focused_panel_id  TEXT,
  updated_at        INTEGER NOT NULL
);
