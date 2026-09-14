pub mod gemini;
pub mod openai;
pub mod pricing;
mod policy;
pub mod provider;
pub mod tools;

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use provider::{make_provider, ChatRequest, Msg, StreamItem};

const MAX_ROUNDS: usize = 24;

#[derive(Default)]
struct RunSignal { notify: Notify, cancelled: AtomicBool }

static STREAMS: Lazy<Mutex<HashMap<String, Arc<RunSignal>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct RunGuard { id: String, signal: Arc<RunSignal> }
impl RunGuard {
    fn start(id: &str) -> Result<Self, String> {
        if id.is_empty() || id.len() > 512 || id.chars().any(char::is_control) { return Err("Invalid chat ID".into()); }
        let mut streams = STREAMS.lock();
        if streams.contains_key(id) { return Err("The previous turn is still running or stopping".into()); }
        let signal = Arc::new(RunSignal::default());
        streams.insert(id.into(), signal.clone());
        Ok(Self { id: id.into(), signal })
    }
    fn active(&self) -> bool { !self.signal.cancelled.load(Ordering::Acquire) }
}
impl Drop for RunGuard {
    fn drop(&mut self) { STREAMS.lock().remove(&self.id); }
}

fn http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(120))
        .build()
}

async fn brief_error(response: reqwest::Response) -> String {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(Ok(chunk)) = stream.next().await {
        let take = chunk.len().min(4096 - bytes.len());
        bytes.extend_from_slice(&chunk[..take]);
        if bytes.len() == 4096 { break; }
    }
    String::from_utf8_lossy(&bytes).chars().take(500).collect()
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
                "textMode": "snapshot",
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
    provider_id: String,
    model: String,
    system: String,
    history: Vec<Msg>,
    allowed_tools: Vec<String>,
    ui_run_id: Option<String>,
) -> Result<(), String> {
    crate::ui_bridge::validate_run_id(ui_run_id.as_deref())?;
    let config = policy::load(&app, &provider_id, &model)?;
    let run = RunGuard::start(&chat_id)?;
    let cancel = run.signal.clone();
    let provider_kind = config.kind.as_str();
    let key = if provider_kind == "nous_oauth" {
        match crate::nous_oauth::access_token(&config.key_ref).await {
            Ok(t) => t,
            Err(e) => {
                emit_error_exit(&app, &chat_id, &e);
                return Err(e);
            }
        }
    } else {
        crate::provider_keys::read(&config.key_ref).unwrap_or_default()
    };
    if key.trim().is_empty() && matches!(provider_kind, "openai" | "google" | "nous_oauth") {
        return Err("The selected provider has no saved credential. Reconnect it in Control Panel.".into());
    }
    let prov = make_provider(provider_kind);
    let url = &config.endpoint;
    let tools = crate::runtime::tools::filter_tools(&allowed_tools);
    let client = http_client().map_err(|e| e.to_string())?;
    let mut working: Vec<Msg> = history;
    let mut total_in: u64 = 0;
    let mut total_out: u64 = 0;
    let mut had_usage = false;

    'rounds: for round in 0..MAX_ROUNDS {
        if !run.active() { break 'rounds; }
        if policy::load(&app, &provider_id, &model).as_ref() != Ok(&config) {
            let error = "Provider configuration changed during this turn. Start a new turn.";
            emit_error_exit(&app, &chat_id, error);
            return Err(error.into());
        }
        let req = ChatRequest {
            model: model.clone(),
            system: system.clone(),
            messages: working.clone(),
            tools: tools.clone(),
        };
        let body = prov.body(&req);
        let msg_id = format!("rt-{}-{}", chat_id, round);

        let mut rb = client.post(url).json(&body);
        for (k, v) in prov.headers(&key) {
            rb = rb.header(k, v);
        }
        let response = tokio::select! {
            biased;
            _ = cancel.notify.notified() => { break 'rounds; }
            response = rb.send() => response,
        };
        let resp = match response {
            Ok(r) => r,
            Err(e) => {
                let error = e.without_url().to_string();
                emit_error_exit(&app, &chat_id, &error);
                return Err(error);
            }
        };
        if !resp.status().is_success() {
            let status = resp.status();
            let brief = tokio::select! {
                biased;
                _ = cancel.notify.notified() => { break 'rounds; }
                text = brief_error(resp) => text,
            };
            let brief = if key.trim().is_empty() { brief } else { brief.replace(key.trim(), "[redacted]") };
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
        let mut received = 0usize;

        loop {
            tokio::select! {
                biased;
                _ = cancel.notify.notified() => { cancelled = true; break; }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            received = received.saturating_add(bytes.len());
                            if received > 8 * 1024 * 1024 || buf.len() + bytes.len() > 1024 * 1024 {
                                errored = Some("Provider stream exceeded the response/frame size limit".into());
                                break;
                            }
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
                        Some(Err(e)) => { errored = Some(e.without_url().to_string()); break; }
                        None => break,
                    }
                }
            }
        }

        if cancelled {
            break 'rounds;
        }
        if let Some(e) = errored {
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
            if !run.active() { break 'rounds; }
            let call = c.clone();
            let granted = tools.clone();
            let snapshot = config.clone();
            let (tool_app, tool_provider, tool_model) = (app.clone(), provider_id.clone(), model.clone());
            let signal = cancel.clone();
            let tool_ui_run = ui_run_id.clone();
            let dispatched = tokio::task::spawn_blocking(move || {
                if signal.cancelled.load(Ordering::Acquire) { return Err("Turn cancelled".into()); }
                if policy::load(&tool_app, &tool_provider, &tool_model)? != snapshot {
                    return Err("Provider configuration changed; tool execution denied".into());
                }
                crate::ui_bridge::with_sync_run(tool_ui_run, || {
                    policy::dispatch_authorized(&call, &granted, crate::mcp_server::dispatch_tool)
                })
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
    if let Some(signal) = STREAMS.lock().get(&chat_id) {
        signal.cancelled.store(true, Ordering::Release);
        signal.notify.notify_one();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{take_lines, tool_result_event, tool_use_blocks};

    #[tokio::test]
    async fn cancel_prevents_replacement_until_the_old_turn_retires() {
        let id = format!("runtime-test-{}", ulid::Ulid::new());
        let run = super::RunGuard::start(&id).unwrap();
        assert!(run.active());
        assert!(super::RunGuard::start(&id).is_err());
        super::runtime_cancel(id.clone()).unwrap();
        assert!(!run.active());
        assert!(super::RunGuard::start(&id).is_err());
        tokio::time::timeout(std::time::Duration::from_millis(100), run.signal.notify.notified()).await.unwrap();
        drop(run);
        assert!(super::RunGuard::start(&id).is_ok());
    }

    #[tokio::test]
    async fn http_client_never_follows_a_credential_bearing_redirect() {
        use tokio::{net::TcpListener, io::{AsyncReadExt, AsyncWriteExt}};
        let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let from = origin.local_addr().unwrap();
        let to = target.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = origin.accept().await.unwrap();
            let mut buffer = [0u8; 4096];
            let n = socket.read(&mut buffer).await.unwrap();
            assert!(String::from_utf8_lossy(&buffer[..n]).contains("x-goog-api-key: test-only-not-a-secret"));
            socket.write_all(format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://{to}/capture\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
        });
        let response = tokio::time::timeout(std::time::Duration::from_secs(2), super::http_client().unwrap()
            .post(format!("http://{from}/start")).header("x-goog-api-key", "test-only-not-a-secret").send()).await.unwrap().unwrap();
        assert_eq!(response.status(), 307);
        assert!(tokio::time::timeout(std::time::Duration::from_millis(50), target.accept()).await.is_err());
        server.await.unwrap();
    }
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
