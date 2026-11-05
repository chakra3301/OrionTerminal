//! Map Cursor SDK NDJSON bridge lines to the claude:event shapes the UI renders.

use serde_json::{json, Value};

fn obj(line: &str) -> Option<Value> {
    serde_json::from_str::<Value>(line)
        .ok()
        .filter(|v| v.is_object())
}

#[derive(Default)]
pub struct CursorState {
    /// Accumulated assistant text per run_id (stream may send partial snapshots).
    text_by_run: std::collections::HashMap<String, String>,
    usage_sequence: u64,
}

fn assistant_from_text(id: &str, text: &str) -> Value {
    json!({
        "type": "assistant",
        "message": { "id": id, "content": [{ "type": "text", "text": text }] },
    })
}

fn error_events(msg: &str) -> Vec<Value> {
    vec![
        assistant_from_text("cursor-error", msg),
        json!({
            "type": "result",
            "subtype": "error",
            "is_error": true,
            "errors": [msg],
        }),
    ]
}

/// Map one bridge JSONL line to zero or more claude:event payloads.
pub fn cursor_line_to_events(line: &str, st: &mut CursorState) -> Vec<Value> {
    let Some(v) = obj(line) else {
        return vec![];
    };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("stderr") => {
            let text = v.get("text").and_then(|s| s.as_str()).unwrap_or("");
            if text.is_empty() {
                vec![]
            } else {
                vec![json!({ "type": "stderr", "text": text })]
            }
        }
        Some("agent") => {
            let agent_id = v
                .get("agentId")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            vec![json!({
                "type": "system",
                "subtype": "init",
                "session_id": agent_id,
            })]
        }
        Some("sdk") => sdk_message(v.get("message"), st),
        Some("result") => {
            let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("finished");
            vec![json!({
                "type": "result",
                "subtype": if status == "error" { "error" } else { "success" },
                "is_error": status == "error",
            })]
        }
        Some("fatal") => {
            let msg = v
                .get("message")
                .and_then(|s| s.as_str())
                .unwrap_or("Cursor SDK error");
            error_events(msg)
        }
        _ => vec![],
    }
}

fn sdk_message(msg: Option<&Value>, st: &mut CursorState) -> Vec<Value> {
    let Some(m) = msg else {
        return vec![];
    };
    match m.get("type").and_then(|t| t.as_str()) {
        Some("usage") => {
            if !m.get("usage").is_some_and(|usage| usage.is_object()) { return vec![]; }
            st.usage_sequence += 1;
            vec![json!({ "type": "usage", "usage": m.get("usage"), "usage_sequence": st.usage_sequence })]
        }
        Some("system") if m.get("subtype").and_then(|s| s.as_str()) == Some("init") => {
            let agent_id = m
                .get("agent_id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            vec![json!({
                "type": "system",
                "subtype": "init",
                "session_id": agent_id,
            })]
        }
        Some("assistant") => {
            let id = m
                .get("run_id")
                .and_then(|s| s.as_str())
                .unwrap_or("cursor")
                .to_string();
            let content = m
                .pointer("/message/content")
                .cloned()
                .unwrap_or_else(|| json!([]));
            // Merge text blocks for the same run_id so partial stream snapshots
            // accumulate instead of the UI only showing the last (possibly empty) one.
            let mut merged = content.clone();
            if let Some(arr) = content.as_array() {
                let mut text = String::new();
                for b in arr {
                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(t) = b.get("text").and_then(|s| s.as_str()) {
                            text.push_str(t);
                        }
                    }
                }
                if !text.is_empty() {
                    let prev = st.text_by_run.get(&id).cloned().unwrap_or_default();
                    let combined = if text.starts_with(&prev) || prev.is_empty() {
                        text
                    } else if prev.starts_with(&text) {
                        prev
                    } else {
                        format!("{prev}{text}")
                    };
                    st.text_by_run.insert(id.clone(), combined.clone());
                    merged = json!([{ "type": "text", "text": combined }]);
                }
            }
            vec![json!({
                "type": "assistant",
                "message": { "id": id, "content": merged },
            })]
        }
        Some("thinking") => {
            let text = m.get("text").and_then(|s| s.as_str()).unwrap_or("");
            if text.is_empty() {
                return vec![];
            }
            let id = m
                .get("run_id")
                .and_then(|s| s.as_str())
                .unwrap_or("thinking")
                .to_string();
            vec![assistant_from_text(&id, text)]
        }
        Some("task") => {
            let text = m.get("text").and_then(|s| s.as_str()).unwrap_or("");
            if text.is_empty() {
                return vec![];
            }
            vec![assistant_from_text("task", text)]
        }
        Some("tool_call") => {
            let id = m
                .get("call_id")
                .and_then(|s| s.as_str())
                .unwrap_or("tool")
                .to_string();
            let name = m.get("name").and_then(|s| s.as_str()).unwrap_or("tool");
            let input = m.get("args").cloned().unwrap_or_else(|| json!({}));
            let status = m.get("status").and_then(|s| s.as_str()).unwrap_or("");
            if status == "running" {
                return vec![json!({
                    "type": "assistant",
                    "message": { "id": id, "content": [
                        { "type": "tool_use", "id": id, "name": name, "input": input }
                    ]},
                })];
            }
            let is_error = status == "error";
            let content = if is_error {
                m.get("result")
                    .map(|r| r.to_string())
                    .unwrap_or_else(|| "tool error".into())
            } else {
                m.get("result")
                    .map(|r| r.to_string())
                    .unwrap_or_default()
            };
            vec![
                json!({
                    "type": "assistant",
                    "message": { "id": id, "content": [
                        { "type": "tool_use", "id": id, "name": name, "input": input }
                    ]},
                }),
                json!({
                    "type": "user",
                    "message": { "content": [{
                        "type": "tool_result",
                        "tool_use_id": id,
                        "content": content,
                        "is_error": is_error,
                    }]},
                }),
            ]
        }
        Some("status") => {
            let status = m.get("status").and_then(|s| s.as_str()).unwrap_or("");
            if status == "FINISHED" || status == "ERROR" {
                vec![json!({
                    "type": "result",
                    "subtype": if status == "ERROR" { "error" } else { "success" },
                    "is_error": status == "ERROR",
                })]
            } else {
                vec![]
            }
        }
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::{cursor_line_to_events, CursorState};

    #[test]
    fn usage_preserves_counts_and_sequences_independent_sdk_turns() {
        let mut st = CursorState::default();
        let line = r#"{"type":"sdk","message":{"type":"usage","usage":{"inputTokens":20,"outputTokens":10,"cacheReadTokens":40,"cacheWriteTokens":5,"totalTokens":75,"reasoningTokens":8}}}"#;
        let first = cursor_line_to_events(line, &mut st);
        let second = cursor_line_to_events(line, &mut st);
        assert_eq!(first[0]["usage"]["totalTokens"], 75);
        assert_eq!(first[0]["usage_sequence"], 1);
        assert_eq!(second[0]["usage_sequence"], 2);
        assert!(cursor_line_to_events(r#"{"type":"sdk","message":{"type":"usage"}}"#, &mut st).is_empty());
    }

    #[test]
    fn agent_line_emits_session_init() {
        let mut st = CursorState::default();
        let evs = cursor_line_to_events(r#"{"type":"agent","agentId":"ag-1"}"#, &mut st);
        assert_eq!(evs[0]["type"], "system");
        assert_eq!(evs[0]["session_id"], "ag-1");
    }

    #[test]
    fn assistant_text_maps() {
        let mut st = CursorState::default();
        let line = r#"{"type":"sdk","message":{"type":"assistant","run_id":"r1","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}}"#;
        let evs = cursor_line_to_events(line, &mut st);
        assert_eq!(evs[0]["type"], "assistant");
        assert_eq!(evs[0]["message"]["content"][0]["text"], "hi");
    }

    #[test]
    fn fatal_emits_visible_error_text() {
        let mut st = CursorState::default();
        let evs = cursor_line_to_events(r#"{"type":"fatal","message":"bad key"}"#, &mut st);
        assert_eq!(evs[0]["type"], "assistant");
        assert_eq!(evs[0]["message"]["content"][0]["text"], "bad key");
        assert_eq!(evs[1]["is_error"], true);
    }
}
