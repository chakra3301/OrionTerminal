-- Hermes: a Kanban-driven multi-agent orchestration layer inside Orion.
-- Tasks are cards on a board; each task can fan out to a PARALLEL SWARM of
-- agents, where each agent is a headless `claude` run. ROSIE plans the board
-- (approval-gated — she creates/arranges cards but never dispatches); the user
-- clicks Dispatch, which spawns a task's agents. Additive, append-only.

CREATE TABLE IF NOT EXISTS hermes_tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  prompt        TEXT NOT NULL DEFAULT '',
  column_id     TEXT NOT NULL DEFAULT 'backlog',  -- backlog|ready|running|review|done|blocked
  position      INTEGER NOT NULL DEFAULT 0,        -- ordering within a column
  status        TEXT NOT NULL DEFAULT 'idle',      -- idle|running|completed|failed|cancelled
  parent_id     TEXT,                              -- sub-task decomposition (nullable)
  created_by    TEXT NOT NULL DEFAULT 'user',      -- user|rosie (provenance)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  dispatched_at INTEGER
);

CREATE TABLE IF NOT EXISTS hermes_agents (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',            -- e.g. "agent 1" or a role
  prompt      TEXT NOT NULL DEFAULT '',            -- the specific instruction this agent runs
  status      TEXT NOT NULL DEFAULT 'idle',        -- idle|running|completed|failed|cancelled
  output      TEXT NOT NULL DEFAULT '',            -- final assistant text
  error       TEXT NOT NULL DEFAULT '',
  session_id  TEXT,                                -- claude session id (for resume)
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  started_at  INTEGER,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_hermes_tasks_column ON hermes_tasks(column_id, position);
CREATE INDEX IF NOT EXISTS idx_hermes_tasks_parent ON hermes_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_hermes_agents_task ON hermes_agents(task_id, position);
