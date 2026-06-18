//! Output transcoders: map each engine's JSONL stream to the Claude event
//! shapes the frontend already renders (`{type:"system",subtype:"init"}`,
//! `{type:"assistant",...}`, `{type:"user",...tool_result}`, `{type:"result"}`).
//! Pure + unit-tested. Non-JSON / unknown lines yield no events.
//!
//! [P-AUTH] The success-path fixtures are doc-grounded (Codex from the codex
//! repo `exec_events.rs`/SDK `items.ts`; Gemini event types from headless.md).
//! Validate against the user's first logged-in run before treating these as
//! final — see the plan's Task 8/9 VALIDATE checkpoints.

use serde_json::{json, Value};

fn obj(line: &str) -> Option<Value> {
    serde_json::from_str::<Value>(line)
        .ok()
        .filter(|v| v.is_object())
}

// ───────────────────────────────────────── Codex ──────────────────────────

#[derive(Default)]
pub struct CodexState {
    pub thread_id: Option<String>,
}

/// Map one Codex `exec --json` JSONL line to claude:event values.
pub fn codex_line_to_events(line: &str, st: &mut CodexState) -> Vec<Value> {
    let Some(v) = obj(line) else { return vec![] };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("thread.started") => {
            let tid = v
                .get("thread_id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            st.thread_id = Some(tid.clone());
            vec![json!({ "type": "system", "subtype": "init", "session_id": tid })]
        }
        Some("item.completed") => {
            let item = match v.get("item") {
                Some(i) => i,
                None => return vec![],
            };
            let id = item
                .get("id")
                .and_then(|s| s.as_str())
                .unwrap_or("item")
                .to_string();
            match item.get("type").and_then(|t| t.as_str()) {
                Some("agent_message") => {
                    let text = item.get("text").and_then(|s| s.as_str()).unwrap_or("");
                    vec![json!({ "type": "assistant", "message": {
                        "id": id, "content": [{ "type": "text", "text": text }] } })]
                }
                Some("mcp_tool_call") => {
                    let tool = item.get("tool").and_then(|s| s.as_str()).unwrap_or("tool");
                    let input = item.get("arguments").cloned().unwrap_or_else(|| json!({}));
                    let is_error = item.get("error").is_some()
                        || item
                            .get("status")
                            .and_then(|s| s.as_str())
                            .map(|s| s != "completed")
                            .unwrap_or(false);
                    let content = if let Some(err) = item
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        err.to_string()
                    } else {
                        item.get("result").map(|r| r.to_string()).unwrap_or_default()
                    };
                    vec![
                        json!({ "type": "assistant", "message": { "id": id, "content": [
                            { "type": "tool_use", "id": id, "name": tool, "input": input } ] } }),
                        json!({ "type": "user", "message": { "content": [
                            { "type": "tool_result", "tool_use_id": id, "content": content, "is_error": is_error } ] } }),
                    ]
                }
                Some("command_execution") => {
                    let command = item.get("command").and_then(|s| s.as_str()).unwrap_or("");
                    let exit = item.get("exit_code").and_then(|e| e.as_i64()).unwrap_or(0);
                    vec![
                        json!({ "type": "assistant", "message": { "id": id, "content": [
                            { "type": "tool_use", "id": id, "name": "shell", "input": { "command": command } } ] } }),
                        json!({ "type": "user", "message": { "content": [
                            { "type": "tool_result", "tool_use_id": id, "content": format!("exit {exit}"), "is_error": exit != 0 } ] } }),
                    ]
                }
                Some("error") => {
                    let msg = item.get("message").and_then(|m| m.as_str()).unwrap_or("error");
                    vec![json!({ "type": "stderr", "text": msg })]
                }
                // reasoning / file_change / web_search / todo_list: ignored in v1
                _ => vec![],
            }
        }
        Some("turn.completed") => {
            vec![json!({ "type": "result", "total_cost_usd": 0,
                "session_id": st.thread_id.clone().unwrap_or_default() })]
        }
        Some("turn.failed") => {
            let msg = v
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("turn failed");
            vec![json!({ "type": "stderr", "text": msg })]
        }
        Some("error") => {
            let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or("error");
            vec![json!({ "type": "stderr", "text": msg })]
        }
        _ => vec![],
    }
}

// ──────────────────────────────────────── Gemini ──────────────────────────

#[derive(Default)]
pub struct GeminiState {
    pub session_id: Option<String>,
}

/// Best-effort extraction of assistant text from a gemini `message` event,
/// tolerant of a few plausible shapes (validate against a real run).
fn gemini_message_text(v: &Value) -> String {
    if let Some(arr) = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    {
        let mut s = String::new();
        for b in arr {
            if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                s.push_str(t);
            }
        }
        if !s.is_empty() {
            return s;
        }
    }
    if let Some(t) = v.get("content").and_then(|c| c.as_str()) {
        return t.to_string();
    }
    if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
        return t.to_string();
    }
    String::new()
}

pub fn gemini_line_to_events(line: &str, st: &mut GeminiState) -> Vec<Value> {
    let Some(v) = obj(line) else { return vec![] };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("init") => {
            let sid = v
                .get("session_id")
                .and_then(|s| s.as_str())
                .or_else(|| v.get("sessionId").and_then(|s| s.as_str()))
                .unwrap_or("")
                .to_string();
            st.session_id = Some(sid.clone());
            vec![json!({ "type": "system", "subtype": "init", "session_id": sid })]
        }
        Some("message") => {
            // assistant chunks only; ignore echoed user messages
            let role = v
                .get("role")
                .and_then(|r| r.as_str())
                .or_else(|| {
                    v.get("message")
                        .and_then(|m| m.get("role"))
                        .and_then(|r| r.as_str())
                })
                .unwrap_or("assistant");
            if role == "user" {
                return vec![];
            }
            let text = gemini_message_text(&v);
            if text.is_empty() {
                return vec![];
            }
            let id = v.get("id").and_then(|s| s.as_str()).unwrap_or("g_msg").to_string();
            vec![json!({ "type": "assistant", "message": { "id": id, "content": [
                { "type": "text", "text": text } ] } })]
        }
        Some("tool_use") => {
            let id = v.get("id").and_then(|s| s.as_str()).unwrap_or("g_tool").to_string();
            let name = v.get("name").and_then(|s| s.as_str()).unwrap_or("tool");
            let input = v
                .get("input")
                .cloned()
                .or_else(|| v.get("arguments").cloned())
                .unwrap_or_else(|| json!({}));
            vec![json!({ "type": "assistant", "message": { "id": id, "content": [
                { "type": "tool_use", "id": id, "name": name, "input": input } ] } })]
        }
        Some("tool_result") => {
            let id = v
                .get("tool_use_id")
                .and_then(|s| s.as_str())
                .or_else(|| v.get("id").and_then(|s| s.as_str()))
                .unwrap_or("g_tool")
                .to_string();
            let content = v
                .get("content")
                .map(|c| match c.as_str() {
                    Some(s) => s.to_string(),
                    None => c.to_string(),
                })
                .unwrap_or_default();
            let is_error = v.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);
            vec![json!({ "type": "user", "message": { "content": [
                { "type": "tool_result", "tool_use_id": id, "content": content, "is_error": is_error } ] } })]
        }
        Some("error") => {
            let msg = v
                .get("message")
                .and_then(|m| m.as_str())
                .or_else(|| v.get("error").and_then(|e| e.as_str()))
                .unwrap_or("error");
            vec![json!({ "type": "stderr", "text": msg })]
        }
        Some("result") => {
            vec![json!({ "type": "result", "total_cost_usd": 0,
                "session_id": st.session_id.clone().unwrap_or_default() })]
        }
        _ => vec![],
    }
}

#[cfg(test)]
mod codex_transcode_tests {
    use super::*;
    #[test]
    fn thread_started_emits_init_and_sets_session() {
        let mut st = CodexState::default();
        let ev = codex_line_to_events("{\"type\":\"thread.started\",\"thread_id\":\"019abc\"}", &mut st);
        assert_eq!(ev[0]["type"], "system");
        assert_eq!(ev[0]["subtype"], "init");
        assert_eq!(ev[0]["session_id"], "019abc");
        assert_eq!(st.thread_id.as_deref(), Some("019abc"));
    }
    #[test]
    fn agent_message_emits_assistant_text() {
        let mut st = CodexState::default();
        let ev = codex_line_to_events(
            "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"Hi\"}}",
            &mut st,
        );
        assert_eq!(ev[0]["type"], "assistant");
        assert_eq!(ev[0]["message"]["content"][0]["text"], "Hi");
    }
    #[test]
    fn mcp_tool_call_emits_use_and_result_pair() {
        let mut st = CodexState::default();
        let line = "{\"type\":\"item.completed\",\"item\":{\"id\":\"it1\",\"type\":\"mcp_tool_call\",\"server\":\"orion\",\"tool\":\"orion_read_file\",\"arguments\":{\"path\":\"a.ts\"},\"status\":\"completed\",\"result\":{\"content\":[]}}}";
        let ev = codex_line_to_events(line, &mut st);
        assert_eq!(ev.len(), 2);
        assert_eq!(ev[0]["message"]["content"][0]["type"], "tool_use");
        assert_eq!(ev[0]["message"]["content"][0]["name"], "orion_read_file");
        assert_eq!(ev[0]["message"]["content"][0]["input"]["path"], "a.ts");
        assert_eq!(ev[1]["message"]["content"][0]["type"], "tool_result");
        assert_eq!(ev[1]["message"]["content"][0]["tool_use_id"], "it1");
        assert_eq!(ev[1]["message"]["content"][0]["is_error"], false);
    }
    #[test]
    fn failed_tool_call_marks_error() {
        let mut st = CodexState::default();
        let line = "{\"type\":\"item.completed\",\"item\":{\"id\":\"it2\",\"type\":\"mcp_tool_call\",\"tool\":\"x\",\"status\":\"failed\",\"error\":{\"message\":\"boom\"}}}";
        let ev = codex_line_to_events(line, &mut st);
        assert_eq!(ev[1]["message"]["content"][0]["is_error"], true);
        assert_eq!(ev[1]["message"]["content"][0]["content"], "boom");
    }
    #[test]
    fn turn_completed_emits_result_with_session() {
        let mut st = CodexState { thread_id: Some("019abc".into()) };
        let ev = codex_line_to_events("{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":5}}", &mut st);
        assert_eq!(ev[0]["type"], "result");
        assert_eq!(ev[0]["total_cost_usd"], 0);
        assert_eq!(ev[0]["session_id"], "019abc");
    }
    #[test]
    fn non_json_and_unknown_yield_nothing() {
        let mut st = CodexState::default();
        assert!(codex_line_to_events("2026 ERROR codex_api::foo", &mut st).is_empty());
        assert!(codex_line_to_events("{\"type\":\"turn.started\"}", &mut st).is_empty());
    }
}

#[cfg(test)]
mod gemini_transcode_tests {
    use super::*;
    #[test]
    fn init_sets_session_and_emits_init() {
        let mut st = GeminiState::default();
        let ev = gemini_line_to_events("{\"type\":\"init\",\"session_id\":\"s1\",\"model\":\"gemini-2.5-pro\"}", &mut st);
        assert_eq!(ev[0]["subtype"], "init");
        assert_eq!(ev[0]["session_id"], "s1");
        assert_eq!(st.session_id.as_deref(), Some("s1"));
    }
    #[test]
    fn assistant_message_array_shape() {
        let mut st = GeminiState::default();
        let ev = gemini_line_to_events("{\"type\":\"message\",\"role\":\"assistant\",\"message\":{\"content\":[{\"text\":\"hello\"}]}}", &mut st);
        assert_eq!(ev[0]["type"], "assistant");
        assert_eq!(ev[0]["message"]["content"][0]["text"], "hello");
    }
    #[test]
    fn assistant_message_string_shape() {
        let mut st = GeminiState::default();
        let ev = gemini_line_to_events("{\"type\":\"message\",\"content\":\"hi there\"}", &mut st);
        assert_eq!(ev[0]["message"]["content"][0]["text"], "hi there");
    }
    #[test]
    fn user_message_ignored() {
        let mut st = GeminiState::default();
        assert!(gemini_line_to_events("{\"type\":\"message\",\"role\":\"user\",\"content\":\"q\"}", &mut st).is_empty());
    }
    #[test]
    fn tool_use_and_result() {
        let mut st = GeminiState::default();
        let u = gemini_line_to_events("{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"orion_search\",\"input\":{\"q\":\"x\"}}", &mut st);
        assert_eq!(u[0]["message"]["content"][0]["name"], "orion_search");
        let r = gemini_line_to_events("{\"type\":\"tool_result\",\"tool_use_id\":\"t1\",\"content\":\"ok\",\"is_error\":false}", &mut st);
        assert_eq!(r[0]["message"]["content"][0]["tool_use_id"], "t1");
        assert_eq!(r[0]["message"]["content"][0]["content"], "ok");
    }
    #[test]
    fn result_emits_session_zero_cost() {
        let mut st = GeminiState { session_id: Some("s1".into()) };
        let ev = gemini_line_to_events("{\"type\":\"result\",\"stats\":{\"total_tokens\":9}}", &mut st);
        assert_eq!(ev[0]["type"], "result");
        assert_eq!(ev[0]["session_id"], "s1");
        assert_eq!(ev[0]["total_cost_usd"], 0);
    }
}
