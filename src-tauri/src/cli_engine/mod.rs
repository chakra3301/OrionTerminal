//! Subscription-CLI subprocess engines (Phase 2c): OpenAI Codex CLI + Google
//! Gemini CLI. Mirrors `claude_cli`'s spawn/stream/cancel lifecycle and the
//! Orion MCP attachment, transcoding each engine's output into the
//! `claude:event`/`claude:exit` contract. Additive — no existing path changes.

pub mod codex;
pub mod config;
pub mod gemini;
pub mod transcode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliEngine {
    Codex,
    Gemini,
}

impl CliEngine {
    pub fn from_str(s: &str) -> Option<CliEngine> {
        match s {
            "codex_cli" => Some(CliEngine::Codex),
            "gemini_cli" => Some(CliEngine::Gemini),
            _ => None,
        }
    }
}

/// Spawn parameters built by each engine's `prepare`, consumed by the shared
/// spawn+stream loop (`cli_send`).
#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub program: String,
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
    pub cwd: String,
    /// Data to write to the child's stdin (prompt for engines that read stdin),
    /// then close. None = stdin null.
    pub stdin_data: Option<String>,
}

#[cfg(test)]
mod engine_tests {
    use super::CliEngine;
    #[test]
    fn parses_known_engines() {
        assert_eq!(CliEngine::from_str("codex_cli"), Some(CliEngine::Codex));
        assert_eq!(CliEngine::from_str("gemini_cli"), Some(CliEngine::Gemini));
        assert_eq!(CliEngine::from_str("anthropic"), None);
    }
}
