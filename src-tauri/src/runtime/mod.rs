pub mod gemini;
pub mod openai;
pub mod pricing;
pub mod provider;

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use provider::{make_provider, ChatRequest, Msg, StreamItem};

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

fn emit_assistant(app: &AppHandle, chat_id: &str, text: &str) {
    let _ = app.emit(
        "claude:event",
        EventPayload {
            chat_id: chat_id.to_string(),
            event: serde_json::json!({
                "type": "assistant",
                "message": { "content": [{ "type": "text", "text": text }] }
            }),
        },
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

/// Provider-agnostic streaming chat turn. Emits the Claude event contract
/// (`claude:event` assistant snapshots → result → `claude:exit`) so the
/// existing EventBridge/chatStore render it with zero changes. History-based
/// (stateless): no session id is produced.
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
) -> Result<(), String> {
    let key = crate::provider_keys::read(&key_ref).unwrap_or_default();
    let prov = make_provider(&provider_kind);
    let url = prov.endpoint(&base_url, &model);
    let req = ChatRequest {
        model: model.clone(),
        system,
        messages: history,
    };
    let body = prov.body(&req);

    let cancel = Arc::new(Notify::new());
    STREAMS.lock().insert(chat_id.clone(), cancel.clone());

    let client = reqwest::Client::new();
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
    let mut in_tokens: u64 = 0;
    let mut out_tokens: u64 = 0;
    let mut had_usage = false;
    let mut errored: Option<String> = None;

    loop {
        tokio::select! {
            _ = cancel.notified() => break,
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buf.extend_from_slice(&bytes);
                        for line in take_lines(&mut buf) {
                            for item in prov.parse_sse_line(&line) {
                                match item {
                                    StreamItem::TextDelta(t) => {
                                        acc.push_str(&t);
                                        emit_assistant(&app, &chat_id, &acc);
                                    }
                                    StreamItem::Usage { in_tokens: i, out_tokens: o } => {
                                        in_tokens = i;
                                        out_tokens = o;
                                        had_usage = true;
                                    }
                                    StreamItem::Done => {}
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        errored = Some(e.to_string());
                        break;
                    }
                    None => break,
                }
            }
        }
    }

    STREAMS.lock().remove(&chat_id);

    if let Some(e) = errored {
        emit_error_exit(&app, &chat_id, &e);
        return Err(e);
    }

    let cost = if had_usage {
        pricing::estimate_cost(&provider_kind, &model, in_tokens, out_tokens)
    } else {
        0.0
    };
    let _ = app.emit(
        "claude:event",
        EventPayload {
            chat_id: chat_id.clone(),
            event: serde_json::json!({
                "type": "result",
                "total_cost_usd": cost,
                "session_id": serde_json::Value::Null
            }),
        },
    );
    let _ = app.emit(
        "claude:exit",
        ExitPayload {
            chat_id,
            code: Some(0),
            error: None,
        },
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
    use super::take_lines;

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
}
