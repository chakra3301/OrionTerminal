// Streaming Messages-API chat used by the Archives and XDesign Claude rails.
// Different shape from `inline_edit.rs` (which sends a single rewrite prompt
// and emits replacement text) — this one takes a full message history and
// streams the assistant reply token-by-token. No agent tools, no acceptEdits.

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::api_key;

static STREAMS: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Single message input. `content` is free-form per the Anthropic schema:
/// either a string (legacy path) or an array of content blocks (used when
/// echoing tool_result back to the API). Both accepted; we relay verbatim.
#[derive(Deserialize)]
pub struct ChatMessageInput {
    pub role: String,
    pub content: serde_json::Value,
}

#[derive(Serialize, Clone)]
struct DeltaPayload {
    #[serde(rename = "chatId")]
    chat_id: String,
    text: String,
}

#[derive(Serialize, Clone)]
struct ToolUsePayload {
    #[serde(rename = "chatId")]
    chat_id: String,
    /// Tool-use id from the API; needed when echoing the matching
    /// tool_result back next turn.
    id: String,
    name: String,
    input: serde_json::Value,
}

#[derive(Serialize, Clone)]
struct DonePayload {
    #[serde(rename = "chatId")]
    chat_id: String,
    #[serde(rename = "totalCostUsd")]
    total_cost_usd: Option<f64>,
    /// "end_turn" | "tool_use" | "max_tokens" | ... — frontend uses this to
    /// decide whether to loop (execute tools + send tool_result) or stop.
    #[serde(rename = "stopReason")]
    stop_reason: Option<String>,
}

#[derive(Serialize, Clone)]
struct ErrorPayload {
    #[serde(rename = "chatId")]
    chat_id: String,
    message: String,
}

fn parse_sse_event(block: &str) -> (Option<&str>, String) {
    let mut event_name: Option<&str> = None;
    let mut data_lines: Vec<&str> = Vec::new();
    for line in block.split('\n') {
        let line = line.trim_end_matches('\r');
        if let Some(v) = line.strip_prefix("event:") {
            event_name = Some(v.trim());
        } else if let Some(v) = line.strip_prefix("data:") {
            data_lines.push(v.strip_prefix(' ').unwrap_or(v));
        }
    }
    (event_name, data_lines.join("\n"))
}

/// Run a streaming Messages API turn. `tools` is passed through to Anthropic
/// as-is (caller defines names + input_schema). `model` defaults to opus 4.7;
/// legacy callers can pass a different model.
#[tauri::command]
pub async fn messages_chat_run(
    app: AppHandle,
    chat_id: String,
    system: String,
    messages: Vec<ChatMessageInput>,
    tools: Option<serde_json::Value>,
    model: Option<String>,
) -> Result<(), String> {
    let key = match api_key::read()? {
        Some(k) => k,
        None => {
            let msg = "no Anthropic API key set — open Settings".to_string();
            let _ = app.emit(
                "chat:error",
                ErrorPayload {
                    chat_id: chat_id.clone(),
                    message: msg.clone(),
                },
            );
            return Err(msg);
        }
    };

    let cancel = Arc::new(Notify::new());
    STREAMS.lock().insert(chat_id.clone(), cancel.clone());

    let body_messages: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let chosen_model = model
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(crate::claude_cli::OPUS_MODEL);
    let mut body = serde_json::json!({
        "model": chosen_model,
        "max_tokens": 4096,
        "stream": true,
        "system": system,
        "messages": body_messages,
    });
    if let Some(t) = tools {
        body["tools"] = t;
    }

    let client = reqwest::Client::new();
    let resp = match client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            STREAMS.lock().remove(&chat_id);
            let _ = app.emit(
                "chat:error",
                ErrorPayload {
                    chat_id: chat_id.clone(),
                    message: e.to_string(),
                },
            );
            return Err(e.to_string());
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        STREAMS.lock().remove(&chat_id);
        let msg = format!("HTTP {}: {}", status, text);
        let _ = app.emit(
            "chat:error",
            ErrorPayload {
                chat_id: chat_id.clone(),
                message: msg.clone(),
            },
        );
        return Err(msg);
    }

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut total_cost: Option<f64> = None;
    let mut stop_reason: Option<String> = None;
    // Per-content-block accumulator. Anthropic streams tool_use input as
    // `input_json_delta` chunks; we concatenate them per block and parse on
    // content_block_stop. Keyed by block index from content_block_start.
    let mut tool_state: HashMap<usize, ToolBlockAccum> = HashMap::new();

    loop {
        tokio::select! {
            _ = cancel.notified() => {
                break;
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buf.extend_from_slice(&bytes);
                        process_buffered(
                            &mut buf,
                            &app,
                            &chat_id,
                            &mut total_cost,
                            &mut stop_reason,
                            &mut tool_state,
                            chosen_model,
                        );
                    }
                    Some(Err(e)) => {
                        STREAMS.lock().remove(&chat_id);
                        let _ = app.emit("chat:error", ErrorPayload {
                            chat_id: chat_id.clone(),
                            message: e.to_string(),
                        });
                        return Err(e.to_string());
                    }
                    None => break,
                }
            }
        }
    }

    STREAMS.lock().remove(&chat_id);
    let _ = app.emit(
        "chat:done",
        DonePayload {
            chat_id,
            total_cost_usd: total_cost,
            stop_reason,
        },
    );
    Ok(())
}

struct ToolBlockAccum {
    id: String,
    name: String,
    partial_input: String,
}

fn process_buffered(
    buf: &mut Vec<u8>,
    app: &AppHandle,
    chat_id: &str,
    total_cost: &mut Option<f64>,
    stop_reason: &mut Option<String>,
    tool_state: &mut HashMap<usize, ToolBlockAccum>,
    model: &str,
) {
    while let Some(idx) = find_double_newline(buf) {
        let raw = buf.drain(..idx + 2).collect::<Vec<u8>>();
        let s = match std::str::from_utf8(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let block = s.trim_end_matches(['\r', '\n']);
        if block.is_empty() {
            continue;
        }
        let (event_name, data) = parse_sse_event(block);
        if let Some(name) = event_name {
            if name == "ping" {
                continue;
            }
        }
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) else {
            continue;
        };
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match t {
            "content_block_start" => {
                // If this block is a tool_use, start accumulating its
                // partial input JSON until content_block_stop.
                let block_index = v
                    .get("index")
                    .and_then(|x| x.as_u64())
                    .map(|x| x as usize);
                let block_type = v
                    .get("content_block")
                    .and_then(|c| c.get("type"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                if let (Some(idx), "tool_use") = (block_index, block_type) {
                    let id = v
                        .get("content_block")
                        .and_then(|c| c.get("id"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = v
                        .get("content_block")
                        .and_then(|c| c.get("name"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    tool_state.insert(
                        idx,
                        ToolBlockAccum {
                            id,
                            name,
                            partial_input: String::new(),
                        },
                    );
                }
            }
            "content_block_delta" => {
                if let Some(text) = v
                    .get("delta")
                    .and_then(|d| d.get("text"))
                    .and_then(|t| t.as_str())
                {
                    let _ = app.emit(
                        "chat:delta",
                        DeltaPayload {
                            chat_id: chat_id.to_string(),
                            text: text.to_string(),
                        },
                    );
                } else if let Some(partial) = v
                    .get("delta")
                    .and_then(|d| d.get("partial_json"))
                    .and_then(|x| x.as_str())
                {
                    let block_index = v
                        .get("index")
                        .and_then(|x| x.as_u64())
                        .map(|x| x as usize);
                    if let Some(idx) = block_index {
                        if let Some(acc) = tool_state.get_mut(&idx) {
                            acc.partial_input.push_str(partial);
                        }
                    }
                }
            }
            "content_block_stop" => {
                let block_index = v
                    .get("index")
                    .and_then(|x| x.as_u64())
                    .map(|x| x as usize);
                if let Some(idx) = block_index {
                    if let Some(acc) = tool_state.remove(&idx) {
                        // Empty partial_input means the tool was called with
                        // no args — accept {} as the parsed value.
                        let input_value = if acc.partial_input.is_empty() {
                            serde_json::json!({})
                        } else {
                            serde_json::from_str::<serde_json::Value>(
                                &acc.partial_input,
                            )
                            .unwrap_or(serde_json::Value::Null)
                        };
                        let _ = app.emit(
                            "chat:tool_use",
                            ToolUsePayload {
                                chat_id: chat_id.to_string(),
                                id: acc.id,
                                name: acc.name,
                                input: input_value,
                            },
                        );
                    }
                }
            }
            "message_delta" => {
                if let Some(usage) = v.get("usage") {
                    let input_tokens = usage
                        .get("input_tokens")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    let output_tokens = usage
                        .get("output_tokens")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    // Per-MTok pricing. Opus 4.x is ~$15 in / $75 out;
                    // Sonnet 4.x is $3 in / $15 out. Heuristic, not
                    // authoritative.
                    let (in_rate, out_rate) = if model.starts_with("claude-opus") {
                        (15.0, 75.0)
                    } else {
                        (3.0, 15.0)
                    };
                    let cost = (input_tokens as f64) * in_rate / 1_000_000.0
                        + (output_tokens as f64) * out_rate / 1_000_000.0;
                    *total_cost = Some(total_cost.unwrap_or(0.0) + cost);
                }
                if let Some(sr) = v
                    .get("delta")
                    .and_then(|d| d.get("stop_reason"))
                    .and_then(|x| x.as_str())
                {
                    *stop_reason = Some(sr.to_string());
                }
            }
            _ => {}
        }
    }
}

fn find_double_newline(buf: &[u8]) -> Option<usize> {
    if buf.len() < 2 {
        return None;
    }
    for i in 0..buf.len() - 1 {
        if buf[i] == b'\n' && buf[i + 1] == b'\n' {
            return Some(i);
        }
    }
    None
}

#[tauri::command]
pub fn messages_chat_cancel(chat_id: String) -> Result<(), String> {
    if let Some(n) = STREAMS.lock().remove(&chat_id) {
        n.notify_waiters();
    }
    Ok(())
}
