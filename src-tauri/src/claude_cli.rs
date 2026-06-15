use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Notify;

/// The Opus model every subscription Claude surface runs on (chat rails,
/// R.O.S.I.E, XDesign, the Claude Code tab, and the Messages-API default).
/// Single source of truth so a model bump is a one-line change.
pub const OPUS_MODEL: &str = "claude-opus-4-8";

static CHILDREN: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
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

/// Standard base64 (RFC 4648, with padding). Inlined to avoid pulling base64
/// in as a direct dependency. Shared with fs_ops (media `data:` URLs).
pub(crate) fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Build the extra agent args appended after the base flags. Returns an empty
/// vec when no agent overrides are present (byte-identical to pre-agent behavior).
fn agent_args(system_append: &Option<String>, allowed_tools: &Option<Vec<String>>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(sys) = system_append.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        out.push("--append-system-prompt".into());
        out.push(sys.to_string());
    }
    if let Some(tools) = allowed_tools {
        let tools: Vec<&String> = tools.iter().filter(|t| !t.trim().is_empty()).collect();
        if !tools.is_empty() {
            out.push("--allowed-tools".into());
            for t in tools {
                out.push(t.clone());
            }
        }
    }
    out
}

#[cfg(test)]
mod agent_args_tests {
    use super::agent_args;

    #[test]
    fn none_yields_no_args() {
        assert!(agent_args(&None, &None).is_empty());
        assert!(agent_args(&Some("   ".into()), &Some(vec![])).is_empty());
    }

    #[test]
    fn builds_system_and_tools() {
        let out = agent_args(&Some("be terse".into()), &Some(vec!["WebSearch".into(), "mcp__playwright".into()]));
        assert_eq!(out, vec!["--append-system-prompt", "be terse", "--allowed-tools", "WebSearch", "mcp__playwright"]);
    }
}

/// Build a single stream-json `user` message line carrying the prompt text
/// plus a base64-encoded PNG, ready to write to claude's stdin.
fn build_user_image_message(prompt: &str, image_path: &str) -> Result<String, String> {
    let bytes = std::fs::read(image_path).map_err(|e| format!("read snapshot: {e}"))?;
    let b64 = base64_encode(&bytes);
    let msg = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [
                { "type": "text", "text": prompt },
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": b64
                    }
                }
            ]
        }
    });
    Ok(format!(
        "{}\n",
        serde_json::to_string(&msg).map_err(|e| e.to_string())?
    ))
}

#[tauri::command]
pub async fn claude_send(
    app: AppHandle,
    chat_id: String,
    prompt: String,
    project_root: Option<String>,
    session_id: Option<String>,
    image_path: Option<String>,
    model: Option<String>,
    system_append: Option<String>,
    allowed_tools: Option<Vec<String>>,
) -> Result<(), String> {
    // Resolve cwd: explicit project_root wins, otherwise fall back to the
    // user's home dir so chat surfaces without a project context (Archives,
    // XDesign) still work. The CLI just needs a valid directory.
    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".to_string());

    // When a snapshot image is attached we CANNOT use the positional `@path`
    // mention: claude silently drops it on `--resume` turns (verified — turn
    // 1 sees it, every resumed turn ignores it). Instead we feed the turn as
    // a stream-json user message on stdin carrying a real base64 image block,
    // which survives resume. Text-only turns keep the simpler positional path.
    let attach_image = image_path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string());

    // Per-surface model override; blank/None falls back to the shared default.
    let model_id = model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or(OPUS_MODEL);

    let mut cmd = Command::new("claude");
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--model",
        model_id,
    ]);
    if attach_image.is_some() {
        cmd.args(["--input-format", "stream-json"]);
    }
    // Route file edits through Orion's reviewable tools (orion_apply_edit /
    // orion_write_file) instead of the built-ins that silently write to disk.
    // This is what gives the chat agent its Cursor-style Accept/Reject diffs.
    cmd.args([
        "--disallowed-tools",
        "Edit",
        "Write",
        "MultiEdit",
        "NotebookEdit",
    ]);
    for a in agent_args(&system_append, &allowed_tools) {
        cmd.arg(a);
    }
    // Hand claude our Orion MCP server so this chat has access to the
    // Orion-aware tools (list_recent_notes, search_archive, etc.) alongside
    // claude-code's built-in Bash/Read/Edit/Write toolset. Failure to write
    // the config is non-fatal — the chat still runs, just without our tools.
    if let Some(mcp_config_path) = crate::mcp_config::write(&app) {
        cmd.args(["--mcp-config", &mcp_config_path]);
    }
    if let Some(sid) = session_id.as_deref() {
        if !sid.is_empty() {
            cmd.args(["--resume", sid]);
        }
    }
    if attach_image.is_none() {
        // `--mcp-config` is variadic (<configs...>) — without this `--`
        // sentinel, clap eats the prompt as an extra MCP config path and
        // claude errors out with "MCP config file not found: <prompt text>".
        cmd.arg("--");
        cmd.arg(&prompt);
    }
    cmd.current_dir(&cwd);
    // Tauri-packaged apps on macOS get a stripped PATH from launchd that
    // omits common install dirs (/opt/homebrew/bin, ~/.local/bin, etc.). We
    // augment it explicitly so `claude` is findable regardless of how the
    // app was started.
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(if attach_image.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child: Child = cmd.spawn().map_err(|e| {
        format!(
            "failed to spawn `claude` — is the CLI installed and on PATH? ({})",
            e
        )
    })?;

    // Stream the prompt + image to stdin as one user message, then close it
    // so claude (in --input-format stream-json) gets EOF and starts working.
    // Spawned as a task so a large base64 payload can't deadlock against the
    // stdout read loop below.
    if let Some(img) = attach_image {
        let payload = build_user_image_message(&prompt, &img)?;
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(payload.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
        }
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout from child".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "no stderr from child".to_string())?;

    let cancel = Arc::new(Notify::new());
    CHILDREN.lock().insert(chat_id.clone(), cancel.clone());

    let app_clone = app.clone();
    let chat_id_clone = chat_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let _ = app_clone.emit(
                        "claude:event",
                        EventPayload {
                            chat_id: chat_id_clone.clone(),
                            event: serde_json::json!({
                                "type": "stderr",
                                "text": line
                            }),
                        },
                    );
                }
                _ => break,
            }
        }
    });

    let app_for_loop = app.clone();
    let chat_id_for_loop = chat_id.clone();
    let cancel_for_loop = cancel.clone();

    let mut stdout_lines = BufReader::new(stdout).lines();

    let result: Result<Option<i32>, String> = async {
        loop {
            tokio::select! {
                _ = cancel_for_loop.notified() => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return Ok(None);
                }
                line = stdout_lines.next_line() => {
                    match line {
                        Ok(Some(text)) => {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                let _ = app_for_loop.emit("claude:event", EventPayload {
                                    chat_id: chat_id_for_loop.clone(),
                                    event: v,
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

    CHILDREN.lock().remove(&chat_id);

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
pub fn claude_cancel(chat_id: String) -> Result<(), String> {
    if let Some(n) = CHILDREN.lock().remove(&chat_id) {
        n.notify_waiters();
    }
    Ok(())
}

/// Vision variant of `claude_oneshot`: attaches an image file via the CLI's
/// `@<path>` syntax so Claude sees the actual pixels (used for asset auto-
/// tagging of images). Falls back to a normal text-only call if the path is
/// empty.
#[tauri::command]
pub async fn claude_oneshot_with_image(
    prompt: String,
    image_path: String,
) -> Result<String, String> {
    use std::process::Stdio;
    if image_path.trim().is_empty() {
        return claude_oneshot(prompt).await;
    }
    let mut cmd = Command::new("claude");
    cmd.args(["--print", "--output-format", "text"]);
    // The CLI reads `@<path>` references inline. Putting it at the END of the
    // prompt keeps the user's instruction first.
    let full_prompt = format!("{prompt}\n\n@{image_path}");
    cmd.arg(&full_prompt);
    if let Some(home) = std::env::var_os("HOME") {
        cmd.current_dir(home);
    }
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("spawn claude: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "claude exited with {} ({})",
            output.status,
            stderr.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Fire-and-forget one-shot CLI call: send a prompt, return the assistant's
/// reply as a single string. Used for background work like asset tagging.
/// No tools, no streaming, no session — just `claude --print` capturing
/// stdout. Runs against the user's subscription auth (same as `claude_send`).
#[tauri::command]
pub async fn claude_oneshot(prompt: String) -> Result<String, String> {
    use std::process::Stdio;
    let mut cmd = Command::new("claude");
    cmd.args(["--print", "--output-format", "text"]);
    cmd.arg(&prompt);
    if let Some(home) = std::env::var_os("HOME") {
        cmd.current_dir(home);
    }
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("spawn claude: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "claude exited with {} ({})",
            output.status,
            stderr.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}


/// Build a PATH that is likely to contain `claude` regardless of how the
/// Tauri app was launched. macOS launchd hands packaged apps a stripped
/// PATH that omits the dirs where most package managers install binaries.
/// We prepend common ones; existing PATH wins thereafter so user-managed
/// paths are not shadowed.
pub(crate) fn augmented_path() -> String {
    let extras = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
    let home_bins = std::env::var("HOME")
        .ok()
        .map(|h| vec![format!("{}/.local/bin", h), format!("{}/.claude/local", h)])
        .unwrap_or_default();
    let existing = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = extras.iter().map(|s| s.to_string()).collect();
    for p in home_bins {
        parts.push(p);
    }
    if !existing.is_empty() {
        parts.push(existing);
    }
    parts.join(":")
}
