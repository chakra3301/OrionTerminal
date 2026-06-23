//! Transcode the `pi --mode json` NDJSON stream into flat Command-Center
//! events the frontend store reduces: `{kind:"init"|"assistant"|"tool_use"|
//! "tool_result"|"result"}`. Pure + unit-tested. Non-JSON / unknown lines
//! yield nothing. Fixtures grounded in a captured `pi --mode json --print` run.

use serde_json::{json, Value};

fn obj(line: &str) -> Option<Value> {
    serde_json::from_str::<Value>(line)
        .ok()
        .filter(|v| v.is_object())
}

#[derive(Default)]
pub struct PiState {
    pub session_id: Option<String>,
    /// Accumulated assistant text for the current message (text_delta stream).
    pub text: String,
    pub cost: f64,
}

/// Map one pi `--mode json` line to zero or more cc events.
pub fn pi_line_to_events(line: &str, st: &mut PiState) -> Vec<Value> {
    let Some(v) = obj(line) else { return vec![] };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("session") => {
            let id = v
                .get("id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            st.session_id = Some(id.clone());
            vec![json!({ "kind": "init", "sessionId": id })]
        }
        Some("message_update") => {
            let ame = match v.get("assistantMessageEvent") {
                Some(a) => a,
                None => return vec![],
            };
            match ame.get("type").and_then(|t| t.as_str()) {
                Some("text_delta") => {
                    let delta = ame.get("delta").and_then(|d| d.as_str()).unwrap_or("");
                    st.text.push_str(delta);
                    vec![json!({ "kind": "assistant", "text": st.text })]
                }
                // text_start/text_end/thinking_* carry no new renderable text.
                _ => vec![],
            }
        }
        Some("tool_execution_start") => {
            let id = v
                .get("toolCallId")
                .and_then(|s| s.as_str())
                .unwrap_or("tool")
                .to_string();
            let name = v
                .get("toolName")
                .and_then(|s| s.as_str())
                .unwrap_or("tool")
                .to_string();
            let input = v.get("args").cloned().unwrap_or_else(|| json!({}));
            vec![json!({ "kind": "tool_use", "id": id, "name": name, "input": input })]
        }
        Some("tool_execution_end") => {
            let id = v
                .get("toolCallId")
                .and_then(|s| s.as_str())
                .unwrap_or("tool")
                .to_string();
            let is_error = v.get("isError").and_then(|b| b.as_bool()).unwrap_or(false);
            let content = match v.get("result") {
                Some(Value::String(s)) => s.clone(),
                Some(other) => other.to_string(),
                None => String::new(),
            };
            vec![json!({ "kind": "tool_result", "id": id, "content": content, "isError": is_error })]
        }
        Some("turn_end") => {
            if let Some(total) = v
                .get("message")
                .and_then(|m| m.get("usage"))
                .and_then(|u| u.get("cost"))
                .and_then(|c| c.get("total"))
                .and_then(|t| t.as_f64())
            {
                st.cost += total;
            }
            vec![]
        }
        Some("agent_end") => {
            vec![json!({
                "kind": "result",
                "sessionId": st.session_id.clone().unwrap_or_default(),
                "cost": st.cost,
            })]
        }
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_non_json_and_unknown() {
        let mut st = PiState::default();
        assert!(pi_line_to_events("not json", &mut st).is_empty());
        assert!(pi_line_to_events("{\"type\":\"agent_start\"}", &mut st).is_empty());
        assert!(pi_line_to_events("[1,2,3]", &mut st).is_empty());
    }

    #[test]
    fn session_line_yields_init_and_stores_id() {
        let mut st = PiState::default();
        let evs = pi_line_to_events(
            r#"{"type":"session","version":3,"id":"abc-123","cwd":"/x"}"#,
            &mut st,
        );
        assert_eq!(evs[0]["kind"], "init");
        assert_eq!(evs[0]["sessionId"], "abc-123");
        assert_eq!(st.session_id.as_deref(), Some("abc-123"));
    }

    #[test]
    fn text_deltas_accumulate() {
        let mut st = PiState::default();
        let a = pi_line_to_events(
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello "}}"#,
            &mut st,
        );
        assert_eq!(a[0]["kind"], "assistant");
        assert_eq!(a[0]["text"], "hello ");
        let b = pi_line_to_events(
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"world"}}"#,
            &mut st,
        );
        assert_eq!(b[0]["text"], "hello world");
    }

    #[test]
    fn thinking_and_custom_notice_yield_nothing() {
        let mut st = PiState::default();
        assert!(pi_line_to_events(
            r#"{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"hmm"}}"#,
            &mut st,
        )
        .is_empty());
        assert!(pi_line_to_events(
            r#"{"type":"message_start","message":{"role":"custom","customType":"wiki-session-notice","content":"x"}}"#,
            &mut st,
        )
        .is_empty());
        assert_eq!(st.text, "");
    }

    #[test]
    fn tool_use_and_result() {
        let mut st = PiState::default();
        let u = pi_line_to_events(
            r#"{"type":"tool_execution_start","toolCallId":"t1","toolName":"write","args":{"path":"a.md"}}"#,
            &mut st,
        );
        assert_eq!(u[0]["kind"], "tool_use");
        assert_eq!(u[0]["name"], "write");
        assert_eq!(u[0]["input"]["path"], "a.md");
        let r = pi_line_to_events(
            r#"{"type":"tool_execution_end","toolCallId":"t1","toolName":"write","result":"ok","isError":false}"#,
            &mut st,
        );
        assert_eq!(r[0]["kind"], "tool_result");
        assert_eq!(r[0]["content"], "ok");
        assert_eq!(r[0]["isError"], false);
    }

    #[test]
    fn turn_end_accrues_cost_then_agent_end_results() {
        let mut st = PiState::default();
        pi_line_to_events(r#"{"type":"session","id":"s1"}"#, &mut st);
        pi_line_to_events(
            r#"{"type":"turn_end","message":{"usage":{"cost":{"total":0.5}}},"toolResults":[]}"#,
            &mut st,
        );
        let end = pi_line_to_events(r#"{"type":"agent_end","messages":[]}"#, &mut st);
        assert_eq!(end[0]["kind"], "result");
        assert_eq!(end[0]["sessionId"], "s1");
        assert_eq!(end[0]["cost"], 0.5);
    }
}
