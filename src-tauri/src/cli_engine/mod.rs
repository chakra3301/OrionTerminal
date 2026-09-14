//! Subscription-CLI subprocess engines (Phase 2c): OpenAI Codex CLI + Google
//! Gemini CLI. Mirrors `claude_cli`'s spawn/stream/cancel lifecycle and the
//! Orion MCP attachment, transcoding each engine's output into the
//! `claude:event`/`claude:exit` contract. Additive — no existing path changes.

pub mod codex;
pub mod config;
pub mod gemini;
pub mod transcode;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
#[cfg(not(target_os = "macos"))]
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::sync::Notify;

static CLI_CHILDREN: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct CliRun { id: String, cancel: Arc<Notify> }
impl CliRun {
    fn start(id: &str) -> Result<Self, String> {
        let mut runs = CLI_CHILDREN.lock();
        if runs.contains_key(id) { return Err("A CLI turn is already running or stopping for this chat".into()); }
        let cancel = Arc::new(Notify::new());
        runs.insert(id.into(), cancel.clone());
        Ok(Self { id: id.into(), cancel })
    }
}
impl Drop for CliRun {
    fn drop(&mut self) { CLI_CHILDREN.lock().remove(&self.id); }
}

fn reviewed_restricted_version(engine: CliEngine, output: &str) -> bool {
    let version = output.trim().strip_prefix("codex-cli ").unwrap_or(output.trim());
    let prefix = match engine { CliEngine::Codex => "0.154.", CliEngine::Gemini => "0.47." };
    version.strip_prefix(prefix).is_some_and(|patch| !patch.is_empty() && patch.bytes().all(|b| b.is_ascii_digit()))
}

#[derive(Serialize, Clone)]
struct EventPayload {
    #[serde(rename = "chatId")]
    chat_id: String,
    event: serde_json::Value,
}
#[derive(Serialize, Clone)]
struct ExitPayload {
    #[serde(rename = "chatId")]
    chat_id: String,
    code: Option<i32>,
    error: Option<String>,
}

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
    pub _configs: Vec<crate::mcp_config::ScopedConfig>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    pub detail: String,
    pub auth_mode: Option<String>,
    pub subscription_ready: bool,
    pub image_ready: bool,
}

fn codex_logged_in_from(status_exit_ok: bool) -> bool {
    status_exit_ok
}
fn gemini_logged_in_from(creds_exists: bool) -> bool {
    creds_exists
}

fn protocol_diagnostic(event: &serde_json::Value) -> Option<String> {
    if event.get("type")?.as_str()? != "stderr" { return None; }
    let text = event.get("text")?.as_str()?;
    let parsed = serde_json::from_str::<serde_json::Value>(text).ok();
    let detail = parsed.as_ref().and_then(|value| value.pointer("/error/message"))
        .and_then(|value| value.as_str()).unwrap_or(text);
    Some(detail.chars().take(2048).collect())
}

fn cli_exit_error(engine: CliEngine, code: Option<i32>, stderr: &str) -> Option<String> {
    let code = code.filter(|code| *code != 0)?;
    let label = match engine {
        CliEngine::Codex => "Codex",
        CliEngine::Gemini => "Gemini",
    };
    let detail = stderr.trim();
    Some(if detail.is_empty() {
        format!("{label} CLI exited with code {code}")
    } else {
        format!("{label} CLI exited with code {code}: {detail}")
    })
}

fn detail_for(engine: CliEngine, installed: bool, logged_in: bool) -> String {
    match (installed, logged_in) {
        (false, _) => match engine {
            CliEngine::Codex => "Codex CLI not found. Install: npm i -g @openai/codex".into(),
            CliEngine::Gemini => {
                "Gemini CLI not found. Install: npm i -g @google/gemini-cli".into()
            }
        },
        (true, false) => match engine {
            CliEngine::Codex => "Installed. Run `codex login` to sign in to ChatGPT.".into(),
            CliEngine::Gemini => {
                "Installed. Run `gemini` once and choose Login with Google.".into()
            }
        },
        (true, true) => "Ready.".into(),
    }
}

fn applescript_string(s: &str) -> String {
    let mut out = String::from("\"");
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

async fn probe_version(bin: &str) -> Option<String> {
    let out = crate::connector_status::probe(bin, &["--version"]).await?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn cli_login(engine: String) -> Result<(), String> {
    let _account = crate::cli_auth::change_account(&engine)?;
    let (bin, label) = match engine.as_str() {
        "claude" => ("claude", "Claude subscription login"),
        "codex_cli" => ("codex", "Codex ChatGPT login"),
        "gemini_cli" => ("gemini", "Gemini Google login"),
        _ => return Err("Unknown subscription connector".into()),
    };
    if probe_version(bin).await.is_none() {
        return Err(format!("{bin} CLI not found. Install it before connecting."));
    }
    crate::cli_auth::validate_login(&engine).await?;
    let script = crate::cli_auth::terminal_script(&engine)?;
    let _ = label;
    #[cfg(target_os = "macos")]
    {
        let mut command = TokioCommand::new("osascript");
        command            .args([
                "-e",
                "tell application \"Terminal\" to activate",
                "-e",
                &format!(
                    "tell application \"Terminal\" to do script {}",
                    applescript_string(&script)
                ),
            ]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true);
        let status = tokio::time::timeout(std::time::Duration::from_secs(30), command.status()).await
            .map_err(|_| "Opening Terminal timed out. Check macOS automation permissions.".to_string())?
            .map_err(|_| "Could not open the login terminal.".to_string())?;
        if !status.success() { return Err("Could not open Terminal. Allow Orion to control Terminal in macOS Privacy & Security → Automation, then retry.".into()); }
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", label, "cmd", "/K", &script])
            .spawn()
            .map_err(|e| format!("failed to open login terminal: {e}"))?;
        return Ok(());
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let terminals: &[(&str, &[&str])] = &[
            ("x-terminal-emulator", &["-e", "sh", "-lc"]),
            ("gnome-terminal", &["--", "sh", "-lc"]),
            ("konsole", &["-e", "sh", "-lc"]),
            ("xterm", &["-e", "sh", "-lc"]),
        ];
        let mut last_err = String::new();
        for (program, args) in terminals {
            let mut cmd = Command::new(program);
            cmd.args(*args).arg(&script);
            match cmd.spawn() {
                Ok(_) => return Ok(()),
                Err(e) => last_err = e.to_string(),
            }
        }
        Err(format!("failed to open a login terminal: {last_err}"))
    }
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
                auth_mode: None,
                subscription_ready: false,
                image_ready: false,
            }
        }
    };
    match eng {
        CliEngine::Codex => {
            let version = probe_version("codex").await;
            let installed = version.is_some();
            let logged_in = if installed {
                codex_logged_in_from(
                    crate::connector_status::probe("codex", &["login", "status"])
                        .await
                        .map(|out| out.status.success())
                        .unwrap_or(false),
                )
            } else {
                false
            };
            let subscription = if logged_in {
                Some(crate::codex_subscription::status())
            } else {
                None
            };
            let detail = subscription
                .as_ref()
                .map(|status| status.detail.clone())
                .unwrap_or_else(|| detail_for(eng, installed, logged_in));
            CliStatus {
                installed,
                logged_in,
                version,
                detail,
                auth_mode: subscription
                    .as_ref()
                    .and_then(|status| status.auth_mode.clone()),
                subscription_ready: subscription
                    .as_ref()
                    .is_some_and(|status| status.subscription_ready),
                image_ready: subscription
                    .as_ref()
                    .is_some_and(|status| status.image_ready),
            }
        }
        CliEngine::Gemini => {
            let version = probe_version("gemini").await;
            let installed = version.is_some();
            let creds = crate::cli_auth::cli_auth_scope("gemini_cli".into()).ok()
                .is_some_and(|scope| std::path::Path::new(&scope.directory).join("oauth_creds.json").is_file());
            let logged_in = installed && gemini_logged_in_from(creds);
            let detail = detail_for(eng, installed, logged_in);
            CliStatus {
                installed,
                logged_in,
                version,
                detail,
                auth_mode: None,
                subscription_ready: false,
                image_ready: false,
            }
        }
    }
}

#[tauri::command]
pub async fn cli_send(
    app: AppHandle,
    engine: String,
    chat_id: String,
    prompt: String,
    project_root: Option<String>,
    session_id: Option<String>,
    model: String,
    system_append: String,
    image_path: Option<String>,
    allowed_tools: Option<Vec<String>>,
    ui_run_id: Option<String>,
) -> Result<(), String> {
    crate::ui_bridge::validate_run_id(ui_run_id.as_deref())?;
    let eng = CliEngine::from_str(&engine).ok_or_else(|| format!("unknown engine: {engine}"))?;
    let _account = crate::cli_auth::use_account(&engine)?;
    let run = CliRun::start(&chat_id)?;
    let cancel = run.cancel.clone();
    let allowed_tools = crate::mcp_grants::normalized(allowed_tools.as_deref())?;
    if allowed_tools.is_some() {
        let program = match eng { CliEngine::Codex => "codex", CliEngine::Gemini => "gemini" };
        let output = tokio::select! {
            biased;
            _ = cancel.notified() => return Err("Cancelled before CLI start".into()),
            output = crate::connector_status::probe(program, &["--version"]) => output,
        };
        if !output.filter(|out| out.status.success()).is_some_and(|out| reviewed_restricted_version(eng, &String::from_utf8_lossy(&out.stdout))) {
            return Err("Restricted tool grants require a reviewed CLI version: Codex 0.154.x or Gemini 0.47.x. No model request was started.".into());
        }
    }
    if eng == CliEngine::Codex && !crate::codex_subscription::status().subscription_ready {
        return Err("ChatGPT subscription login is required. Connect in Providers; API-key authentication will not be used for this subscription connector.".into());
    }
    let mut spec = match eng {
        CliEngine::Codex => codex::prepare(
            &app, &prompt, project_root.as_deref(), session_id.as_deref(),
            &model, &system_append, allowed_tools.as_deref(), ui_run_id.as_deref(),
        )?,
        CliEngine::Gemini => gemini::prepare(
            &app, &prompt, project_root.as_deref(), session_id.as_deref(),
            &model, &system_append, allowed_tools.as_deref(), ui_run_id.as_deref(),
        )?,
    };

    if let Some(path) = image_path.filter(|p| !p.trim().is_empty()) {
        if eng != CliEngine::Codex {
            return Err("Image attachments are not supported by this CLI connector yet.".into());
        }
        let meta = std::fs::metadata(&path).map_err(|e| format!("read attachment: {e}"))?;
        if !meta.is_file() || meta.len() > 20 * 1024 * 1024 {
            return Err("Image attachment must be a file smaller than 20 MB.".into());
        }
        let at = spec.args.len() - 1;
        spec.args.splice(at..at, ["--image".into(), path, "--".into()]);
    }
    tokio::select! {
        biased;
        _ = cancel.notified() => return Err("Cancelled before CLI start".into()),
        _ = std::future::ready(()) => {}
    }
    let mut cmd = TokioCommand::new(&spec.program);
    cmd.args(&spec.args);
    cmd.current_dir(&spec.cwd);
    cmd.env("PATH", crate::claude_cli::augmented_path());
    subscription_environment(eng, &mut cmd);
    for (k, v) in &spec.envs {
        cmd.env(k, v);
    }
    crate::cli_auth::apply_profile(&mut cmd);
    cmd.stdin(if spec.stdin_data.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let (mut child, mut process_group) = crate::process_group::spawn(&mut cmd).map_err(|e| {
        format!(
            "failed to spawn `{}` — is the CLI installed and on PATH? ({})",
            spec.program, e
        )
    })?;

    if let Some(data) = spec.stdin_data {
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                let _ = stdin.write_all(data.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
        }
    }

    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

    let app_loop = app.clone();
    let chat_loop = chat_id.clone();
    let app_stderr = app.clone();
    let chat_stderr = chat_id.clone();
    let stderr_task = tokio::spawn(async move {
        let mut captured = String::new();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(text)) = lines.next_line().await {
            let _ = app_stderr.emit(
                "claude:event",
                EventPayload {
                    chat_id: chat_stderr.clone(),
                    event: serde_json::json!({ "type": "stderr", "text": text }),
                },
            );
            if captured.len() < 16 * 1024 {
                if !captured.is_empty() {
                    captured.push('\n');
                }
                let remaining = 16 * 1024 - captured.len();
                captured.extend(text.chars().take(remaining));
            }
        }
        captured
    });
    let mut lines = BufReader::new(stdout).lines();
    let mut codex_state = transcode::CodexState::default();
    let mut gemini_state = transcode::GeminiState::default();
    let mut protocol_error = String::new();

    let result: Result<Option<i32>, String> = async {
        loop {
            tokio::select! {
                _ = cancel.notified() => {
                    process_group.terminate();
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return Ok(None);
                }
                line = lines.next_line() => {
                    match line {
                        Ok(Some(text)) => {
                            let events = match eng {
                                CliEngine::Codex => transcode::codex_line_to_events(&text, &mut codex_state),
                                CliEngine::Gemini => transcode::gemini_line_to_events(&text, &mut gemini_state),
                            };
                            for ev in events {
                                if let Some(detail) = protocol_diagnostic(&ev) { protocol_error = detail; }
                                let _ = app_loop.emit("claude:event", EventPayload {
                                    chat_id: chat_loop.clone(), event: ev });
                            }
                        }
                        Ok(None) => {
                            let status = child.wait().await.map_err(|e| e.to_string())?;
                            process_group.disarm();
                            return Ok(status.code());
                        }
                        Err(e) => { process_group.terminate(); let _ = child.kill().await; return Err(e.to_string()); }
                    }
                }
            }
        }
    }
    .await;
    let stderr_text = stderr_task.await.unwrap_or_default();

    match result {
        Ok(code) => {
            let detail = if protocol_error.is_empty() { &stderr_text } else { &protocol_error };
            let error = cli_exit_error(eng, code, detail);
            let _ = app.emit(
                "claude:exit",
                ExitPayload {
                    chat_id,
                    code,
                    error: error.clone(),
                },
            );
            error.map_or(Ok(()), Err)
        }
        Err(e) => {
            let _ = app.emit(
                "claude:exit",
                ExitPayload {
                    chat_id,
                    code: None,
                    error: Some(e.clone()),
                },
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub fn cli_cancel(chat_id: String) -> Result<(), String> {
    if let Some(n) = CLI_CHILDREN.lock().get(&chat_id) {
        n.notify_one();
    }
    Ok(())
}

pub(crate) fn subscription_environment(engine: CliEngine, cmd: &mut TokioCommand) {
    cmd.env_remove("NODE_OPTIONS").env_remove("NODE_PATH");
    let keys: &[&str] = match engine {
        CliEngine::Codex => &["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"],
        CliEngine::Gemini => &["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "CODE_ASSIST_ENDPOINT"],
    };
    for key in keys { cmd.env_remove(key); }
}

#[cfg(test)]
mod engine_tests {
    use super::CliEngine;

    #[test]
    fn subscription_environment_preserves_auth_homes_not_api_overrides() {
        for (engine, keys) in [
            (CliEngine::Codex, vec!["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"]),
            (CliEngine::Gemini, vec!["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "CODE_ASSIST_ENDPOINT"]),
        ] {
            let mut cmd = super::TokioCommand::new("fixture");
            cmd.env("CODEX_HOME", "/isolated");
            super::subscription_environment(engine, &mut cmd);
            let env: std::collections::HashMap<_, _> = cmd.as_std().get_envs().collect();
            for key in keys.into_iter().chain(["NODE_OPTIONS", "NODE_PATH"]) {
                assert_eq!(env.get(std::ffi::OsStr::new(key)), Some(&None));
            }
            assert_eq!(env.get(std::ffi::OsStr::new("CODEX_HOME")), Some(&Some(std::ffi::OsStr::new("/isolated"))));
        }
    }

    #[test]
    fn unknown_cli_revisions_do_not_inherit_reviewed_permissions() {
        use super::reviewed_restricted_version as reviewed;
        assert!(reviewed(CliEngine::Codex, "codex-cli 0.154.0\n"));
        assert!(reviewed(CliEngine::Gemini, "0.47.0\n"));
        assert!(!reviewed(CliEngine::Codex, "codex-cli 0.155.0"));
        assert!(!reviewed(CliEngine::Gemini, "0.47.0-nightly"));
        assert!(!reviewed(CliEngine::Gemini, ""));
    }

    #[tokio::test]
    async fn cancellation_during_preflight_is_retained_and_blocks_replacement() {
        let id = format!("preflight-test-{}", ulid::Ulid::new());
        let run = super::CliRun::start(&id).unwrap();
        super::cli_cancel(id.clone()).unwrap();
        assert!(super::CliRun::start(&id).is_err());
        tokio::time::timeout(std::time::Duration::from_millis(100), run.cancel.notified()).await.unwrap();
        drop(run);
        assert!(super::CliRun::start(&id).is_ok());
    }
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
    #[test]
    fn protocol_errors_reach_the_exit_error_without_raw_json_wrapping() {
        let event = serde_json::json!({"type":"stderr", "text": "{\"error\":{\"message\":\"This model is not supported with a ChatGPT account\"}}"});
        let detail = super::protocol_diagnostic(&event).unwrap();
        assert_eq!(detail, "This model is not supported with a ChatGPT account");
        assert!(super::cli_exit_error(super::CliEngine::Codex, Some(1), &detail).unwrap().contains(&detail));
        assert!(super::protocol_diagnostic(&serde_json::json!({"type":"assistant"})).is_none());
        let large = serde_json::json!({"type":"stderr", "text":"é".repeat(5000)});
        assert_eq!(super::protocol_diagnostic(&large).unwrap().chars().count(), 2048);
    }

    #[test]
    fn nonzero_cli_exit_surfaces_stderr() {
        use super::{cli_exit_error, CliEngine};
        assert_eq!(cli_exit_error(CliEngine::Codex, Some(0), "warning"), None);
        assert_eq!(cli_exit_error(CliEngine::Codex, None, "cancelled"), None);
        assert_eq!(
            cli_exit_error(CliEngine::Codex, Some(2), "unexpected argument '-a'"),
            Some("Codex CLI exited with code 2: unexpected argument '-a'".into())
        );
    }
}
