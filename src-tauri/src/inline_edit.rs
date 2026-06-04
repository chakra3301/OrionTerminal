use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Notify;

use crate::claude_cli::{augmented_path, OPUS_MODEL};

static STREAMS: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const SYSTEM_PROMPT: &str = "You are a precise code-editing assistant. Output ONLY the replacement code for the SELECTION region. No explanations, no markdown fences, no surrounding text. The output must be a drop-in substitute for the selection — preserve indentation style and trailing newline behavior of the surrounding file.";

#[derive(Deserialize)]
pub struct InlineEditCtx {
    pub path: String,
    pub language: String,
    #[serde(rename = "selectionText")]
    pub selection_text: String,
    #[serde(rename = "contextBefore")]
    pub context_before: String,
    #[serde(rename = "contextAfter")]
    pub context_after: String,
}

#[derive(Serialize, Clone)]
struct DeltaPayload {
    #[serde(rename = "streamId")]
    stream_id: String,
    text: String,
}

#[derive(Serialize, Clone)]
struct DonePayload {
    #[serde(rename = "streamId")]
    stream_id: String,
}

#[derive(Serialize, Clone)]
struct ErrorPayload {
    #[serde(rename = "streamId")]
    stream_id: String,
    message: String,
}

fn build_user_message(ctx: &InlineEditCtx, instruction: &str) -> String {
    let path = std::path::Path::new(&ctx.path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| ctx.path.clone());
    format!(
        "File: {}\nLanguage: {}\n\n--- CONTEXT BEFORE ---\n{}\n\n--- SELECTION (replace this) ---\n{}\n\n--- CONTEXT AFTER ---\n{}\n\n--- INSTRUCTION ---\n{}",
        path, ctx.language, ctx.context_before, ctx.selection_text, ctx.context_after, instruction
    )
}

/// Defensive: the system prompt forbids fences, but claude-code occasionally
/// wraps output in a ``` block. Strip a single surrounding fence so the diff
/// stays clean. Un-fenced output (and its indentation) is left untouched.
fn strip_code_fences(s: &str) -> String {
    let lead = s.trim_start_matches(['\n', '\r']);
    if let Some(rest) = lead.strip_prefix("```") {
        if let Some(nl) = rest.find('\n') {
            let body = rest[nl + 1..].trim_end_matches(['\n', '\r']);
            if let Some(inner) = body.strip_suffix("```") {
                return inner.trim_end_matches(['\n', '\r']).to_string();
            }
        }
    }
    s.to_string()
}

/// Run an inline edit on the subscription CLI (no API key required) on Opus
/// 4.8, same as every other Claude surface. Spawns `claude --print
/// --output-format stream-json` with the edit prompt — no `--mcp-config`,
/// since this is a pure completion that needs no tools (keeps it lean).
/// `--print` returns the reply in one assistant event, so we
/// emit the cleaned result as a single `inline:delta` then `inline:done` (the
/// diff populates when ready rather than token-streaming).
#[tauri::command]
pub async fn inline_edit_run(
    app: AppHandle,
    stream_id: String,
    prompt: String,
    ctx: InlineEditCtx,
) -> Result<(), String> {
    let cwd = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let full_prompt = format!("{}\n\n{}", SYSTEM_PROMPT, build_user_message(&ctx, &prompt));

    let mut cmd = Command::new("claude");
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--model",
        OPUS_MODEL,
    ]);
    cmd.arg("--");
    cmd.arg(&full_prompt);
    cmd.current_dir(&cwd);
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let cancel = Arc::new(Notify::new());
    STREAMS.lock().insert(stream_id.clone(), cancel.clone());

    let mut child: Child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            STREAMS.lock().remove(&stream_id);
            let msg = format!("failed to spawn `claude` — is the CLI on PATH? ({})", e);
            let _ = app.emit(
                "inline:error",
                ErrorPayload {
                    stream_id: stream_id.clone(),
                    message: msg.clone(),
                },
            );
            return Err(msg);
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            STREAMS.lock().remove(&stream_id);
            let _ = app.emit(
                "inline:error",
                ErrorPayload {
                    stream_id: stream_id.clone(),
                    message: "no stdout from claude".into(),
                },
            );
            return Err("no stdout from claude".into());
        }
    };
    let mut stderr_handle = child.stderr.take();
    let mut lines = BufReader::new(stdout).lines();

    // Longest assistant text wins — robust whether the CLI emits one event
    // (current behavior) or growing snapshots.
    let mut best = String::new();

    let result: Result<(), String> = async {
        loop {
            tokio::select! {
                _ = cancel.notified() => {
                    let _ = child.kill().await;
                    return Ok(());
                }
                line = lines.next_line() => {
                    match line {
                        Ok(Some(text)) => {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
                                    if let Some(content) = v
                                        .get("message")
                                        .and_then(|m| m.get("content"))
                                        .and_then(|c| c.as_array())
                                    {
                                        let mut joined = String::new();
                                        for b in content {
                                            if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                                                if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                                                    joined.push_str(t);
                                                }
                                            }
                                        }
                                        if joined.len() > best.len() {
                                            best = joined;
                                        }
                                    }
                                }
                            }
                        }
                        Ok(None) => return Ok(()),
                        Err(e) => return Err(e.to_string()),
                    }
                }
            }
        }
    }
    .await;

    // stderr is tiny for a tool-less one-shot; drain it after stdout EOF for
    // error reporting.
    let mut errbuf = String::new();
    if let Some(mut se) = stderr_handle.take() {
        let _ = se.read_to_string(&mut errbuf).await;
    }
    let _ = child.wait().await;

    match result {
        Ok(()) => {
            // Cancelled runs already removed themselves — stay silent then.
            if STREAMS.lock().remove(&stream_id).is_none() {
                return Ok(());
            }
            let cleaned = strip_code_fences(&best);
            if cleaned.is_empty() {
                let msg = if errbuf.trim().is_empty() {
                    "claude returned no output".to_string()
                } else {
                    errbuf.trim().to_string()
                };
                let _ = app.emit(
                    "inline:error",
                    ErrorPayload {
                        stream_id: stream_id.clone(),
                        message: msg.clone(),
                    },
                );
                return Err(msg);
            }
            let _ = app.emit(
                "inline:delta",
                DeltaPayload {
                    stream_id: stream_id.clone(),
                    text: cleaned,
                },
            );
            let _ = app.emit("inline:done", DonePayload { stream_id });
            Ok(())
        }
        Err(e) => {
            STREAMS.lock().remove(&stream_id);
            let _ = app.emit(
                "inline:error",
                ErrorPayload {
                    stream_id: stream_id.clone(),
                    message: e.clone(),
                },
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub fn inline_edit_cancel(stream_id: String) -> Result<(), String> {
    if let Some(n) = STREAMS.lock().remove(&stream_id) {
        n.notify_waiters();
    }
    Ok(())
}
