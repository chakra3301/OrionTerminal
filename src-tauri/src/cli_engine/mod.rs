//! Subscription-CLI subprocess engines (Phase 2c): OpenAI Codex CLI + Google
//! Gemini CLI. Mirrors `claude_cli`'s spawn/stream/cancel lifecycle and the
//! Orion MCP attachment, transcoding each engine's output into the
//! `claude:event`/`claude:exit` contract. Additive — no existing path changes.

pub mod codex;
pub mod config;
pub mod gemini;
pub mod transcode;

use serde::Serialize;
use std::process::Stdio;
use tokio::process::Command as TokioCommand;

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

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    pub detail: String,
}

fn codex_logged_in_from(status_exit_ok: bool) -> bool {
    status_exit_ok
}
fn gemini_logged_in_from(creds_exists: bool) -> bool {
    creds_exists
}

fn detail_for(engine: CliEngine, installed: bool, logged_in: bool) -> String {
    match (installed, logged_in) {
        (false, _) => match engine {
            CliEngine::Codex => "Codex CLI not found. Install: npm i -g @openai/codex".into(),
            CliEngine::Gemini => "Gemini CLI not found. Install: npm i -g @google/gemini-cli".into(),
        },
        (true, false) => match engine {
            CliEngine::Codex => "Installed. Run `codex login` to sign in to ChatGPT.".into(),
            CliEngine::Gemini => "Installed. Run `gemini` once and choose Login with Google.".into(),
        },
        (true, true) => "Ready.".into(),
    }
}

async fn probe_version(bin: &str) -> Option<String> {
    let out = TokioCommand::new(bin)
        .arg("--version")
        .env("PATH", crate::claude_cli::augmented_path())
        .stdin(Stdio::null())
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn cli_status(engine: String) -> CliStatus {
    let eng = match CliEngine::from_str(&engine) {
        Some(e) => e,
        None => {
            return CliStatus {
                installed: false,
                logged_in: false,
                version: None,
                detail: "unknown engine".into(),
            }
        }
    };
    match eng {
        CliEngine::Codex => {
            let version = probe_version("codex").await;
            let installed = version.is_some();
            let logged_in = if installed {
                codex_logged_in_from(
                    TokioCommand::new("codex")
                        .args(["login", "status"])
                        .env("PATH", crate::claude_cli::augmented_path())
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .await
                        .map(|s| s.success())
                        .unwrap_or(false),
                )
            } else {
                false
            };
            let detail = detail_for(eng, installed, logged_in);
            CliStatus { installed, logged_in, version, detail }
        }
        CliEngine::Gemini => {
            let version = probe_version("gemini").await;
            let installed = version.is_some();
            let creds = std::env::var("HOME")
                .ok()
                .map(|h| {
                    std::path::Path::new(&h)
                        .join(".gemini")
                        .join("oauth_creds.json")
                        .exists()
                })
                .unwrap_or(false);
            let logged_in = installed && gemini_logged_in_from(creds);
            let detail = detail_for(eng, installed, logged_in);
            CliStatus { installed, logged_in, version, detail }
        }
    }
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
    #[test]
    fn auth_decisions_and_detail_copy() {
        use super::{codex_logged_in_from, detail_for, gemini_logged_in_from, CliEngine};
        assert!(codex_logged_in_from(true));
        assert!(!codex_logged_in_from(false));
        assert!(gemini_logged_in_from(true));
        assert!(detail_for(CliEngine::Codex, false, false).contains("npm i -g @openai/codex"));
        assert!(detail_for(CliEngine::Gemini, true, false).contains("Login with Google"));
        assert_eq!(detail_for(CliEngine::Codex, true, true), "Ready.");
    }
}
