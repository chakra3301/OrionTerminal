//! Cursor SDK engine — drives `scripts/cursor-agent.mjs` via Node, transcoding
//! NDJSON into the shared `claude:event` / `claude:exit` contract.

pub mod transcode;

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
    /// Node + bridge script + key all ready to run.
    pub ready: bool,
    pub version: Option<String>,
    pub detail: String,
}

fn detail(installed: bool, sdk_ok: bool, key_saved: bool) -> String {
    if !installed {
        return if key_saved {
            "API key saved. Install Node 22+ (e.g. brew install node) and npm install in the project to enable runs.".into()
        } else {
            "Node.js not found and no API key saved. Install Node 22+, run npm install, then add your key.".into()
        };
    }
    if !sdk_ok {
        return "Node found, but @cursor/sdk isn't resolvable from the bridge script — run npm install in the Orion Terminal project (the app loads the SDK from the project's node_modules).".into();
    }
    if !key_saved {
        return "Add your Cursor API key below (cursor.com/dashboard → Integrations).".into();
    }
    "Ready.".into()
}

async fn probe_node_version() -> Option<String> {
    let out = TokioCommand::new("node")
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

fn resolve_script(app: &AppHandle) -> Option<PathBuf> {
    // Prefer the project copy: Node resolves the script's bare `@cursor/sdk`
    // import by walking up from the *script's* directory, so only a copy that
    // lives next to node_modules can actually load the SDK. The bundled
    // resource copy is a last resort (it only works if some ancestor of the
    // .app happens to have the SDK installed).
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/cursor-agent.mjs");
    if dev.exists() {
        return dev.canonicalize().ok().or(Some(dev));
    }
    if let Ok(res) = app.path().resource_dir() {
        for candidate in [res.join("cursor-agent.mjs"), res.join("scripts/cursor-agent.mjs")] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Mirrors Node's ESM resolution for the script's `import "@cursor/sdk"`:
/// walk up from the script's directory looking for node_modules/@cursor/sdk.
fn sdk_resolvable_from(script: &Path) -> bool {
    let mut dir = script.parent();
    while let Some(d) = dir {
        if d.join("node_modules/@cursor/sdk/package.json").exists() {
            return true;
        }
        dir = d.parent();
    }
    false
}

fn resolve_modules_root() -> PathBuf {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    if project.join("node_modules/@cursor/sdk/package.json").exists() {
        return project;
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[tauri::command]
pub async fn cursor_status(app: AppHandle) -> CursorStatus {
    let version = probe_node_version().await;
    let script = resolve_script(&app);
    let sdk_ok = script.as_deref().map(sdk_resolvable_from).unwrap_or(false);
    let installed = version.is_some() && script.is_some();
    let key_saved = crate::api_key::cursor_api_key().is_some();
    let ready = installed && sdk_ok && key_saved;
    CursorStatus {
        installed,
        key_saved,
        ready,
        version,
        detail: detail(installed, sdk_ok, key_saved),
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
    #[allow(unused_variables)]
    key_ref: String,
) -> Result<(), String> {
    let script = resolve_script(&app).ok_or_else(|| {
        "cursor-agent.mjs not found - rebuild the app or run from the project root".to_string()
    })?;
    // Fail fast with a clear message instead of a cryptic module-not-found
    // from the child process.
    if !sdk_resolvable_from(&script) {
        return Err(
            "@cursor/sdk not found next to the bridge script — run npm install in the Orion Terminal project (the app loads the SDK from the project's node_modules)".to_string(),
        );
    }
    let api_key = crate::api_key::cursor_api_key()
        .ok_or_else(|| "Cursor API key not set - add one in Control Panel -> Providers".to_string())?;

    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .map(|p| p.to_string())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".into());

    let config = serde_json::json!({
        "apiKey": api_key,
        "model": model,
        "prompt": prompt,
        "cwd": cwd,
        "systemAppend": system_append,
        "agentId": session_id.filter(|s| !s.is_empty()),
    });

    let modules_root = resolve_modules_root();
    let mut cmd = TokioCommand::new("node");
    cmd.arg(&script);
    cmd.current_dir(&modules_root);
    cmd.env("PATH", crate::claude_cli::augmented_path());
    cmd.env("NODE_NO_WARNINGS", "1");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

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
    let cancel = Arc::new(Notify::new());
    CURSOR_CHILDREN
        .lock()
        .insert(chat_id.clone(), cancel.clone());

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

    CURSOR_CHILDREN.lock().remove(&chat_id);
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
    if let Some(n) = CURSOR_CHILDREN.lock().remove(&chat_id) {
        n.notify_waiters();
    }
    Ok(())
}
