use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

/// The Opus model every subscription Claude surface runs on (chat rails,
/// R.O.S.I.E, XDesign, the Claude Code tab, and the Messages-API default).
/// Single source of truth so a model bump is a one-line change.
pub const OPUS_MODEL: &str = "claude-opus-4-8";

static CHILDREN: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct ClaudeRun { id: String, cancel: Arc<Notify> }
impl ClaudeRun {
    fn start(id: &str) -> Result<Self, String> {
        let mut runs = CHILDREN.lock();
        if runs.contains_key(id) { return Err("A Claude turn is already running or stopping for this chat".into()); }
        let cancel = Arc::new(Notify::new());
        runs.insert(id.into(), cancel.clone());
        Ok(Self { id: id.into(), cancel })
    }
}
impl Drop for ClaudeRun {
    fn drop(&mut self) { CHILDREN.lock().remove(&self.id); }
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
        let builtins: Vec<&str> = tools.iter().map(|t| t.as_str())
            .filter(|t| !t.starts_with("mcp__") && !t.starts_with("orion_") && !matches!(*t, "Edit" | "Write")).collect();
        out.extend(["--tools".into(), builtins.join(","), "--strict-mcp-config".into(), "--setting-sources".into(), "".into()]);
        if !tools.is_empty() {
            out.push("--allowed-tools".into());
            for t in tools {
                out.push(match t.as_str() {
                    "Edit" => "mcp__orion__orion_apply_edit".into(),
                    "Write" => "mcp__orion__orion_write_file".into(),
                    name if name.starts_with("orion_") => format!("mcp__orion__{name}"),
                    name => name.into(),
                });
                if matches!(t.as_str(), "Read" | "Grep" | "Glob") {
                    out.push(format!("mcp__orion__{}", if t == "Read" { "orion_read_file" } else { "orion_search_files" }));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod agent_args_tests {
    use super::agent_args;

    #[tokio::test]
    async fn cancelled_claude_preflight_retains_ownership_until_cleanup() {
        let id = format!("claude-pending-{}", ulid::Ulid::new());
        let run = super::ClaudeRun::start(&id).unwrap();
        super::claude_cancel(id.clone()).unwrap();
        assert!(super::ClaudeRun::start(&id).is_err());
        tokio::time::timeout(std::time::Duration::from_millis(50), run.cancel.notified()).await.unwrap();
        drop(run);
        assert!(super::ClaudeRun::start(&id).is_ok());
    }

    #[test]
    fn none_yields_no_args() {
        assert!(agent_args(&None, &None).is_empty());
        assert_eq!(agent_args(&Some("   ".into()), &Some(vec![])), vec!["--tools", "", "--strict-mcp-config", "--setting-sources", ""]);
    }

    #[test]
    fn builds_system_and_tools() {
        let out = agent_args(&Some("be terse".into()), &Some(vec!["WebSearch".into(), "mcp__playwright".into()]));
        assert_eq!(out, vec!["--append-system-prompt", "be terse", "--tools", "WebSearch", "--strict-mcp-config", "--setting-sources", "", "--allowed-tools", "WebSearch", "mcp__playwright"]);
    }
}

fn image_media_type(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { Ok("image/png") }
    else if bytes.starts_with(&[0xff, 0xd8, 0xff]) { Ok("image/jpeg") }
    else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { Ok("image/gif") }
    else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { Ok("image/webp") }
    else { Err("This image attachment must be PNG, JPEG, GIF, or WebP.".into()) }
}

fn build_user_image_message(prompt: &str, image_path: &str) -> Result<String, String> {
    use std::io::Read;
    const LIMIT: u64 = 20 * 1024 * 1024;
    let metadata = std::fs::metadata(image_path).map_err(|e| format!("read image: {e}"))?;
    if !metadata.is_file() || metadata.len() > LIMIT { return Err("Image attachment must be a regular file of at most 20MB.".into()); }
    let input = std::fs::File::open(image_path).map_err(|e| e.to_string())?;
    if !input.metadata().map_err(|e| e.to_string())?.is_file() { return Err("Image attachment must be a regular file.".into()); }
    let mut bytes = Vec::new();
    input.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT { return Err("Image attachment exceeds 20MB.".into()); }
    let media_type = image_media_type(&bytes)?;
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
                        "media_type": media_type,
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

#[cfg(test)]
mod image_tests {
    use super::*;
    #[test]
    fn detects_supported_signatures_instead_of_claiming_everything_is_png() {
        for (bytes, mime) in [(b"\x89PNG\r\n\x1a\n".as_slice(), "image/png"), (&[0xff, 0xd8, 0xff], "image/jpeg"), (b"GIF89a", "image/gif"), (b"RIFF1234WEBP", "image/webp")] {
            assert_eq!(image_media_type(bytes).unwrap(), mime);
        }
        assert!(image_media_type(b"BMbitmap").is_err());
        assert!(image_media_type(b"RIFF").is_err());
    }
    #[test]
    fn rejects_directory_and_oversized_attachment_before_encoding() {
        let dir = std::env::temp_dir().join(format!("orion-image-{}", ulid::Ulid::new()));
        std::fs::create_dir(&dir).unwrap();
        assert!(build_user_image_message("look", dir.to_str().unwrap()).is_err());
        let path = dir.join("big.png");
        std::fs::File::create(&path).unwrap().set_len(20 * 1024 * 1024 + 1).unwrap();
        assert!(build_user_image_message("look", path.to_str().unwrap()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
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
    ui_run_id: Option<String>,
) -> Result<(), String> {
    crate::ui_bridge::validate_run_id(ui_run_id.as_deref())?;
    let _account = crate::cli_auth::use_account("claude")?;
    let run = ClaudeRun::start(&chat_id)?;
    let cancel = run.cancel.clone();
    let allowed_tools = crate::mcp_grants::normalized(allowed_tools.as_deref())?;
    tokio::select! {
        biased;
        _ = cancel.notified() => return Err("Cancelled before Claude start".into()),
        auth = crate::connector_status::require_claude_subscription() => auth?,
    }
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
    crate::connector_status::subscription_environment(&mut cmd);
    crate::cli_auth::apply_profile(&mut cmd);
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "acceptEdits",
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
    // Each subprocess gets an immutable grant snapshot, retained until exit.
    let _mcp_config = if !allowed_tools.as_ref().is_some_and(|tools| tools.is_empty()) {
        let config = crate::mcp_config::write_scoped(&app, allowed_tools.as_deref(), ui_run_id.as_deref())?;
        cmd.arg("--mcp-config").arg(config.path());
        Some(config)
    } else { None };
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

    tokio::select! {
        biased;
        _ = cancel.notified() => return Err("Cancelled before Claude start".into()),
        _ = std::future::ready(()) => {}
    }
    let (mut child, mut process_group) = crate::process_group::spawn(&mut cmd).map_err(|e| {
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
                    process_group.terminate();
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
                            process_group.disarm();
                            return Ok(status.code());
                        }
                        Err(e) => {
                            process_group.terminate();
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
pub fn claude_cancel(chat_id: String) -> Result<(), String> {
    if let Some(n) = CHILDREN.lock().get(&chat_id) {
        n.notify_one();
    }
    Ok(())
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
        .map(|h| vec![format!("{}/.local/bin", h), format!("{}/.cargo/bin", h), format!("{}/.claude/local", h)])
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
