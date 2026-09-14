//! Cursor SDK engine — drives `scripts/cursor-agent.mjs` via Node, transcoding
//! NDJSON into the shared `claude:event` / `claude:exit` contract.

pub mod transcode;
pub mod install;

static SDK_LIFECYCLE: tokio::sync::RwLock<()> = tokio::sync::RwLock::const_new(());

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command as TokioCommand};
use tokio::sync::Notify;

static CURSOR_CHILDREN: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct CursorRun { id: String, cancel: Arc<Notify> }
impl CursorRun {
    fn start(id: &str) -> Result<Self, String> {
        let mut runs = CURSOR_CHILDREN.lock();
        if runs.contains_key(id) { return Err("A Cursor turn is already running or stopping for this chat".into()); }
        let cancel = Arc::new(Notify::new());
        runs.insert(id.into(), cancel.clone());
        Ok(Self { id: id.into(), cancel })
    }
}
impl Drop for CursorRun {
    fn drop(&mut self) { CURSOR_CHILDREN.lock().remove(&self.id); }
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

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CursorStatus {
    pub installed: bool,
    /// API key present in keychain (independent of Node/script readiness).
    pub key_saved: bool,
    pub sdk_ready: bool,
    /// Node + bridge script + key all ready to run.
    pub ready: bool,
    pub version: Option<String>,
    pub detail: String,
}

fn detail(installed: bool, sdk_ok: bool, key_saved: bool) -> String {
    if !installed {
        return if key_saved {
            "API key saved. Install Node 22.13+ and npm, then use Install SDK below.".into()
        } else {
            "Node.js or the bridge is unavailable. Install Node 22.13+ and npm, restart the app, then install the SDK and add your key.".into()
        };
    }
    if !sdk_ok {
        return "Install the optional Cursor SDK below. It uses a separate application-data directory, not the Orion source checkout.".into();
    }
    if !key_saved {
        return "Add your Cursor API key below (cursor.com/dashboard → Integrations).".into();
    }
    "Setup ready: SDK loaded and key saved. Live model access is checked when you send.".into()
}

fn supported_node(version: &str) -> bool {
    let mut parts = version.trim().trim_start_matches('v').split('.');
    let major = parts.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    major > 22 || (major == 22 && minor >= 13)
}

async fn probe_node_version() -> Option<String> {
    let out = crate::connector_status::probe("node", &["--version"]).await?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn resolve_script(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/cursor-agent.mjs");
        if dev.exists() { return dev.canonicalize().ok(); }
    }
    if let Ok(res) = app.path().resource_dir() {
        // Tauri maps resources declared with `../` under `_up_/` in the bundle.
        for candidate in [
            res.join("_up_/scripts/cursor-agent.mjs"),
            res.join("scripts/cursor-agent.mjs"),
            res.join("cursor-agent.mjs"),
        ] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("cursor-runtime"))
}

fn selected_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = runtime_root(app)?;
    #[cfg(debug_assertions)]
    if !root.join("node_modules/@cursor/sdk/package.json").is_file() {
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        if project.join("node_modules/@cursor/sdk/package.json").is_file() { return Ok(project); }
    }
    Ok(root)
}

async fn check_sdk(script: &Path, root: &Path) -> bool {
    if !root.join("node_modules/@cursor/sdk/package.json").is_file() { return false; }
    let mut command = TokioCommand::new("node");
    command.arg(script).arg("--check-sdk")
        .env("ORION_CURSOR_SDK_ROOT", root).env("PATH", crate::claude_cli::augmented_path())
        .env("NODE_NO_WARNINGS", "1").env_remove("NODE_OPTIONS").env_remove("NODE_PATH").env_remove("CURSOR_API_KEY").env_remove("CURSOR_AGENT_API_KEY")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    match tokio::time::timeout(std::time::Duration::from_secs(10), command.output()).await {
        Ok(Ok(output)) if output.status.success() => String::from_utf8_lossy(&output.stdout).lines().last()
            .and_then(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .is_some_and(|v| v["ready"] == true && v["version"] == "1.0.31"),
        _ => false,
    }
}

#[tauri::command]
pub async fn cursor_status(app: AppHandle) -> CursorStatus {
    let Ok(_lease) = SDK_LIFECYCLE.try_read() else {
        return CursorStatus { installed: false, key_saved: crate::api_key::cursor_api_key().is_some(), sdk_ready: false, ready: false, version: None, detail: "Cursor SDK installation is in progress.".into() };
    };
    let version = probe_node_version().await;
    let script = resolve_script(&app);
    let sdk_ok = if let (Some(script), Ok(root)) = (script.as_deref(), selected_runtime_root(&app)) {
        check_sdk(script, &root).await
    } else { false };
    let installed = version.is_some() && script.is_some();
    let key_saved = crate::api_key::cursor_api_key().is_some();
    let supported = version.as_deref().map(supported_node).unwrap_or(false);
    let ready = installed && supported && sdk_ok && key_saved;
    let detail = if version.is_some() && !supported {
        "Cursor SDK requires Node 22.13 or newer. Upgrade Node and restart Orion Terminal.".into()
    } else { detail(installed, sdk_ok, key_saved) };
    CursorStatus {
        installed,
        key_saved,
        sdk_ready: sdk_ok,
        ready,
        version,
        detail,
    }
}

#[tauri::command]
pub async fn cursor_send(
    app: AppHandle,
    chat_id: String,
    prompt: String,
    project_root: Option<String>,
    session_id: Option<String>,
    model: String,
    system_append: String,
    key_ref: String,
    allowed_tools: Option<Vec<String>>,
    ui_run_id: Option<String>,
) -> Result<(), String> {
    crate::ui_bridge::validate_run_id(ui_run_id.as_deref())?;
    if key_ref != "builtin:cursor-sdk" {
        return Err("Cursor SDK currently supports the built-in Cursor account only. A different credential reference will not fall back to that account.".into());
    }
    let run = CursorRun::start(&chat_id)?;
    let cancel = run.cancel.clone();
    let allowed_tools = crate::mcp_grants::normalized(allowed_tools.as_deref())?;
    crate::mcp_grants::orion_only(allowed_tools.as_deref())?;
    if allowed_tools.is_some() && session_id.as_ref().is_some_and(|id| !id.is_empty()) {
        return Err("Restricted Cursor turns must start fresh with text history, not restore older SDK tool state.".into());
    }
    let _lease = SDK_LIFECYCLE.try_read().map_err(|_| "Cursor SDK is being installed; wait for setup to finish")?;
    let node_version = tokio::select! {
        biased;
        _ = cancel.notified() => return Err("Cancelled before Cursor start".into()),
        version = probe_node_version() => version,
    };
    if !node_version.as_deref().map(supported_node).unwrap_or(false) {
        return Err("Cursor SDK requires Node 22.13 or newer. Upgrade Node and restart Orion Terminal.".into());
    }
    let script = resolve_script(&app).ok_or_else(|| {
        "cursor-agent.mjs not found - rebuild the app or run from the project root".to_string()
    })?;
    let sdk_root = selected_runtime_root(&app)?;
    let sdk_ready = tokio::select! {
        biased;
        _ = cancel.notified() => return Err("Cancelled before Cursor start".into()),
        ready = check_sdk(&script, &sdk_root) => ready,
    };
    if !sdk_ready {
        return Err("Cursor SDK is unavailable. Use Install SDK in Control Panel → Providers.".into());
    }
    let api_key = crate::api_key::cursor_api_key()
        .ok_or_else(|| "Cursor API key not set - add one in Control Panel -> Providers".to_string())?;

    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .map(|p| p.to_string())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".into());

    let server = crate::mcp_config::scoped_server(&app, allowed_tools.as_deref(), ui_run_id.as_deref())?;
    let env: serde_json::Map<String, serde_json::Value> = server.env.into_iter()
        .map(|(key, value)| (key, serde_json::Value::String(value))).collect();
    let config = serde_json::json!({
        "apiKey": api_key,
        "allowedTools": allowed_tools,
        "mcpServers": { "orion": { "command": server.command, "args": server.args, "env": env } },
        "model": model,
        "prompt": prompt,
        "cwd": cwd,
        "systemAppend": system_append,
        "agentId": session_id.filter(|s| !s.is_empty()),
    });

    let mut cmd = TokioCommand::new("node");
    cmd.arg(&script);
    cmd.current_dir(&sdk_root);
    cmd.env("ORION_CURSOR_SDK_ROOT", &sdk_root);
    cmd.env_remove("CURSOR_API_KEY").env_remove("CURSOR_AGENT_API_KEY");
    cmd.env("PATH", crate::claude_cli::augmented_path());
    cmd.env("NODE_NO_WARNINGS", "1");
    cmd.env_remove("NODE_OPTIONS").env_remove("NODE_PATH");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    tokio::select! {
        biased;
        _ = cancel.notified() => return Err("Cancelled before Cursor start".into()),
        _ = std::future::ready(()) => {}
    }
    let mut child: Child = cmd.spawn().map_err(|e| {
        format!("failed to spawn cursor-agent via node ({e})")
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let payload = config.to_string();
        tokio::spawn(async move {
            let _ = stdin.write_all(payload.as_bytes()).await;
            let _ = stdin.shutdown().await;
        });
    }

    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

    let app_err = app.clone();
    let chat_err = chat_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app_err.emit(
                "claude:event",
                EventPayload {
                    chat_id: chat_err.clone(),
                    event: json!({ "type": "stderr", "text": line }),
                },
            );
        }
    });

    let app_loop = app.clone();
    let chat_loop = chat_id.clone();
    let mut lines = BufReader::new(stdout).lines();
    let mut cursor_state = transcode::CursorState::default();

    let result: Result<Option<i32>, String> = async {
        loop {
            tokio::select! {
                _ = cancel.notified() => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return Ok(None);
                }
                line = lines.next_line() => {
                    match line {
                        Ok(Some(text)) => {
                            for ev in transcode::cursor_line_to_events(&text, &mut cursor_state) {
                                let _ = app_loop.emit("claude:event", EventPayload {
                                    chat_id: chat_loop.clone(),
                                    event: ev,
                                });
                            }
                        }
                        Ok(None) => {
                            let status = child.wait().await.map_err(|e| e.to_string())?;
                            return Ok(status.code());
                        }
                        Err(e) => {
                            let _ = child.kill().await;
                            return Err(e.to_string());
                        }
                    }
                }
            }
        }
    }
    .await;

    match result {
        Ok(code) => {
            let _ = app.emit(
                "claude:exit",
                ExitPayload {
                    chat_id,
                    code,
                    error: None,
                },
            );
            Ok(())
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
pub fn cursor_cancel(chat_id: String) -> Result<(), String> {
    if let Some(n) = CURSOR_CHILDREN.lock().get(&chat_id) {
        n.notify_one();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn cancelled_preflight_stays_registered_until_cleanup() {
        let id = format!("cursor-preflight-{}", ulid::Ulid::new());
        let run = super::CursorRun::start(&id).unwrap();
        super::cursor_cancel(id.clone()).unwrap();
        assert!(super::CursorRun::start(&id).is_err());
        tokio::time::timeout(std::time::Duration::from_millis(100), run.cancel.notified()).await.unwrap();
        drop(run);
        assert!(super::CursorRun::start(&id).is_ok());
    }
    use super::supported_node;

    #[test]
    fn enforces_sdk_node_minimum() {
        assert!(!supported_node("v20.19.0"));
        assert!(!supported_node("v22.12.0"));
        assert!(supported_node("v22.13.0"));
        assert!(supported_node("v24.1.0"));
        assert!(!supported_node("unknown"));
    }
}
