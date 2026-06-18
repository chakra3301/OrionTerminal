pub mod gemini;
pub mod openai;
pub mod pricing;
pub mod provider;
pub mod tools;

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use provider::{make_provider, ChatRequest, Msg, StreamItem, ToolCall};

const MAX_ROUNDS: usize = 24;

static STREAMS: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
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

/// Drain every complete `\n`-terminated line from `buf`, leaving any trailing
/// partial line in place. UTF-8 decoded lossily; CR/LF trimmed.
fn take_lines(buf: &mut Vec<u8>) -> Vec<String> {
    let mut lines = Vec::new();
    while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
        let raw: Vec<u8> = buf.drain(..=pos).collect();
        lines.push(
            String::from_utf8_lossy(&raw)
                .trim_end_matches(['\r', '\n'])
                .to_string(),
        );
    }
    lines
}

/// Build the assistant content blocks for a round that ended with tool calls:
/// an optional leading text block, then one `tool_use` block per call. `input`
/// is the parsed arguments object (empty object on parse failure).
fn tool_use_blocks(text: &str, calls: &[provider::ToolCall]) -> serde_json::Value {
    let mut blocks: Vec<serde_json::Value> = Vec::new();
    if !text.trim().is_empty() {
        blocks.push(serde_json::json!({ "type": "text", "text": text }));
    }
    for c in calls {
        let input: serde_json::Value =
            serde_json::from_str(&c.arguments).unwrap_or_else(|_| serde_json::json!({}));
        blocks.push(serde_json::json!({
            "type": "tool_use",
            "id": c.id,
            "name": c.name,
            "input": input,
        }));
    }
    serde_json::Value::Array(blocks)
}

/// Build the `user` event carrying one `tool_result` (Claude shape).
fn tool_result_event(tool_use_id: &str, content: &str, is_error: bool) -> serde_json::Value {
    serde_json::json!({
        "type": "user",
        "message": { "content": [{
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": content,
            "is_error": is_error,
        }]}
    })
}

fn emit_assistant_round(app: &AppHandle, chat_id: &str, msg_id: &str, content: serde_json::Value) {
    let _ = app.emit(
        "claude:event",
        EventPayload {
            chat_id: chat_id.to_string(),
            event: serde_json::json!({
                "type": "assistant",
                "message": { "id": msg_id, "content": content }
            }),
        },
    );
}

fn emit_event(app: &AppHandle, chat_id: &str, event: serde_json::Value) {
    let _ = app.emit(
        "claude:event",
        EventPayload { chat_id: chat_id.to_string(), event },
    );
}

fn emit_error_exit(app: &AppHandle, chat_id: &str, msg: &str) {
    let _ = app.emit(
        "claude:event",
        EventPayload {
            chat_id: chat_id.to_string(),
            event: serde_json::json!({ "type": "stderr", "text": msg }),
        },
    );
    let _ = app.emit(
        "claude:exit",
        ExitPayload {
            chat_id: chat_id.to_string(),
            code: Some(1),
            error: Some(msg.to_string()),
        },
    );
}

/// Provider-agnostic streaming agentic loop. Emits the Claude event contract
/// (`claude:event` assistant snapshots → result → `claude:exit`) so the
/// existing EventBridge/chatStore render it with zero changes. History-based
/// (stateless): no session id is produced. Runs up to MAX_ROUNDS tool-call
/// rounds before terminating.
#[tauri::command]
pub async fn runtime_send(
    app: AppHandle,
    chat_id: String,
    provider_kind: String,
    base_url: String,
    key_ref: String,
    model: String,
    system: String,
    history: Vec<Msg>,
    allowed_tools: Vec<String>,
) -> Result<(), String> {
    let key = crate::provider_keys::read(&key_ref).unwrap_or_default();
    let prov = make_provider(&provider_kind);
    let url = prov.endpoint(&base_url, &model);
    let tools = crate::runtime::tools::filter_tools(&allowed_tools);

    let cancel = Arc::new(Notify::new());
    STREAMS.lock().insert(chat_id.clone(), cancel.clone());

    let client = reqwest::Client::new();
    let mut working: Vec<Msg> = history;
    let mut total_in: u64 = 0;
    let mut total_out: u64 = 0;
    let mut had_usage = false;

    'rounds: for round in 0..MAX_ROUNDS {
        let req = ChatRequest {
            model: model.clone(),
            system: system.clone(),
            messages: working.clone(),
            tools: tools.clone(),
        };
        let body = prov.body(&req);
        let msg_id = format!("rt-{}-{}", chat_id, round);

        let mut rb = client.post(&url).json(&body);
        for (k, v) in prov.headers(&key) {
            rb = rb.header(k, v);
        }
        let resp = match rb.send().await {
            Ok(r) => r,
            Err(e) => {
                STREAMS.lock().remove(&chat_id);
                emit_error_exit(&app, &chat_id, &e.to_string());
                return Err(e.to_string());
            }
        };
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            STREAMS.lock().remove(&chat_id);
            let brief: String = text.chars().take(500).collect();
            let msg = format!("HTTP {}: {}", status, brief);
            emit_error_exit(&app, &chat_id, &msg);
            return Err(msg);
        }

        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::with_capacity(4096);
        let mut acc = String::new();
        let mut acc_tools = crate::runtime::tools::ToolCallAccumulator::default();
        let mut cancelled = false;
        let mut errored: Option<String> = None;

        loop {
            tokio::select! {
                _ = cancel.notified() => { cancelled = true; break; }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            buf.extend_from_slice(&bytes);
                            for line in take_lines(&mut buf) {
                                for item in prov.parse_sse_line(&line) {
                                    match item {
                                        StreamItem::TextDelta(t) => {
                                            acc.push_str(&t);
                                            emit_assistant_round(
                                                &app, &chat_id, &msg_id,
                                                serde_json::json!([{ "type": "text", "text": acc }]),
                                            );
                                        }
                                        StreamItem::ToolCallDelta { index, id, name, args } => {
                                            acc_tools.push(index, id.as_deref(), name.as_deref(), &args);
                                        }
                                        StreamItem::Usage { in_tokens, out_tokens } => {
                                            total_in += in_tokens;
                                            total_out += out_tokens;
                                            had_usage = true;
                                        }
                                        StreamItem::Done => {}
                                    }
                                }
                            }
                        }
                        Some(Err(e)) => { errored = Some(e.to_string()); break; }
                        None => break,
                    }
                }
            }
        }

        if cancelled {
            break 'rounds;
        }
        if let Some(e) = errored {
            STREAMS.lock().remove(&chat_id);
            emit_error_exit(&app, &chat_id, &e);
            return Err(e);
        }

        if acc_tools.is_empty() {
            // No tools this round → the accumulated text is the final answer.
            break 'rounds;
        }

        // Tool round: surface the tool_use blocks, run each tool, surface
        // results, and append both to the working history for the next round.
        let calls = acc_tools.finish();
        emit_assistant_round(&app, &chat_id, &msg_id, tool_use_blocks(&acc, &calls));
        working.push(Msg {
            role: "assistant".into(),
            content: acc.clone(),
            tool_calls: Some(calls.clone()),
            tool_call_id: None,
            name: None,
        });

        for c in &calls {
            let name = c.name.clone();
            let args: serde_json::Value =
                serde_json::from_str(&c.arguments).unwrap_or_else(|_| serde_json::json!({}));
            let dispatched = tokio::task::spawn_blocking(move || {
                crate::mcp_server::dispatch_tool(&name, &args)
            })
            .await
            .unwrap_or_else(|e| Err(format!("tool task panicked: {}", e)));

            let (content, is_error) = match dispatched {
                Ok(text) => (text, false),
                Err(msg) => (format!("error: {}", msg), true),
            };
            emit_event(&app, &chat_id, tool_result_event(&c.id, &content, is_error));
            working.push(Msg {
                role: "tool".into(),
                content,
                tool_calls: None,
                tool_call_id: Some(c.id.clone()),
                name: Some(c.name.clone()),
            });
        }
        // loop to next round
    }

    STREAMS.lock().remove(&chat_id);

    let cost = if had_usage {
        pricing::estimate_cost(&provider_kind, &model, total_in, total_out)
    } else {
        0.0
    };
    emit_event(
        &app,
        &chat_id,
        serde_json::json!({
            "type": "result",
            "total_cost_usd": cost,
            "session_id": serde_json::Value::Null
        }),
    );
    let _ = app.emit(
        "claude:exit",
        ExitPayload { chat_id, code: Some(0), error: None },
    );
    Ok(())
}

#[tauri::command]
pub fn runtime_cancel(chat_id: String) -> Result<(), String> {
    if let Some(n) = STREAMS.lock().remove(&chat_id) {
        n.notify_waiters();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{take_lines, tool_result_event, tool_use_blocks};
    use crate::runtime::provider::ToolCall;

    #[test]
    fn take_lines_drains_complete_lines_and_keeps_partial() {
        let mut buf = b"data: a\ndata: b\ndata: par".to_vec();
        let lines = take_lines(&mut buf);
        assert_eq!(lines, vec!["data: a".to_string(), "data: b".to_string()]);
        assert_eq!(buf, b"data: par".to_vec());
    }

    #[test]
    fn take_lines_handles_crlf_and_blank() {
        let mut buf = b"x\r\n\ny\n".to_vec();
        let lines = take_lines(&mut buf);
        assert_eq!(lines, vec!["x".to_string(), "".to_string(), "y".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn tool_use_blocks_shape() {
        let calls = vec![ToolCall {
            id: "call_0".into(),
            name: "orion_read_file".into(),
            arguments: "{\"path\":\"/x\"}".into(),
        }];
        let v = tool_use_blocks("here goes", &calls);
        assert_eq!(v[0]["type"], "text");
        assert_eq!(v[0]["text"], "here goes");
        assert_eq!(v[1]["type"], "tool_use");
        assert_eq!(v[1]["id"], "call_0");
        assert_eq!(v[1]["name"], "orion_read_file");
        assert_eq!(v[1]["input"]["path"], "/x");
    }

    #[test]
    fn tool_use_blocks_omits_empty_text() {
        let calls = vec![ToolCall { id: "c".into(), name: "t".into(), arguments: "{}".into() }];
        let v = tool_use_blocks("", &calls);
        assert_eq!(v[0]["type"], "tool_use");
    }

    #[test]
    fn tool_result_event_shape() {
        let v = tool_result_event("call_0", "file body", false);
        assert_eq!(v["type"], "user");
        assert_eq!(v["message"]["content"][0]["type"], "tool_result");
        assert_eq!(v["message"]["content"][0]["tool_use_id"], "call_0");
        assert_eq!(v["message"]["content"][0]["content"], "file body");
        assert_eq!(v["message"]["content"][0]["is_error"], false);
    }
}
