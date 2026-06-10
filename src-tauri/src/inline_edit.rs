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

const ASK_SYSTEM_PROMPT: &str = "You are a concise senior engineer answering a question about the SELECTION region of a file. Answer directly in plain prose (no markdown headings, no code fences unless code is essential). Keep it short — a few sentences unless the question demands more.";

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

fn build_user_message(ctx: &InlineEditCtx, instruction: &str, ask: bool) -> String {
    let path = std::path::Path::new(&ctx.path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| ctx.path.clone());
    let (sel_label, ins_label) = if ask {
        ("SELECTION (for reference)", "QUESTION")
    } else {
        ("SELECTION (replace this)", "INSTRUCTION")
    };
    format!(
        "File: {}\nLanguage: {}\n\n--- CONTEXT BEFORE ---\n{}\n\n--- {} ---\n{}\n\n--- CONTEXT AFTER ---\n{}\n\n--- {} ---\n{}",
        path, ctx.language, ctx.context_before, sel_label, ctx.selection_text, ctx.context_after, ins_label, instruction
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

/// Run an inline edit (or, with mode="ask", a quick question about the
/// selection) on the subscription CLI — no API key, Opus, no `--mcp-config`
/// (pure completion, no tools). `--include-partial-messages` makes the CLI
/// emit `stream_event` deltas, so tokens stream live as `inline:delta`
/// events; when the run ends we emit `inline:final` with the cleaned
/// (fence-stripped) authoritative text, then `inline:done`.
#[tauri::command]
pub async fn inline_edit_run(
    app: AppHandle,
    stream_id: String,
    prompt: String,
    ctx: InlineEditCtx,
    mode: Option<String>,
) -> Result<(), String> {
    let ask = mode.as_deref() == Some("ask");
    let cwd = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let system = if ask { ASK_SYSTEM_PROMPT } else { SYSTEM_PROMPT };
    let full_prompt = format!("{}\n\n{}", system, build_user_message(&ctx, &prompt, ask));

    let mut cmd = Command::new("claude");
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
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

    // Live tokens come from `stream_event` content_block_delta lines; the
    // complete `assistant` snapshot (when present) is authoritative for the
    // final text. Longest-wins keeps us robust across CLI versions.
    let mut best = String::new();
    let mut streamed = String::new();

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
                                match v.get("type").and_then(|t| t.as_str()) {
                                    Some("stream_event") => {
                                        if let Some(delta) = v
                                            .get("event")
                                            .filter(|e| e.get("type").and_then(|t| t.as_str()) == Some("content_block_delta"))
                                            .and_then(|e| e.get("delta"))
                                            .filter(|d| d.get("type").and_then(|t| t.as_str()) == Some("text_delta"))
                                            .and_then(|d| d.get("text"))
                                            .and_then(|t| t.as_str())
                                        {
                                            streamed.push_str(delta);
                                            let _ = app.emit(
                                                "inline:delta",
                                                DeltaPayload {
                                                    stream_id: stream_id.clone(),
                                                    text: delta.to_string(),
                                                },
                                            );
                                        }
                                    }
                                    Some("assistant") => {
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
                                    _ => {}
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
            let raw = if best.len() >= streamed.len() { &best } else { &streamed };
            let cleaned = strip_code_fences(raw);
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
            // The live deltas may have included code fences the model wasn't
            // supposed to emit — `inline:final` is the cleaned authoritative
            // text the frontend swaps in before resolving.
            let _ = app.emit(
                "inline:final",
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
