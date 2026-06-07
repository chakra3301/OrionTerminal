-- Per-agent model override for Hermes swarms. Empty string = use the engine
-- default (claude_cli::OPUS_MODEL). Append-only; existing rows default to ''.
ALTER TABLE hermes_agents ADD COLUMN model TEXT NOT NULL DEFAULT '';
