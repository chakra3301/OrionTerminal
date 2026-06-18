use super::provider::{ChatRequest, Provider, StreamItem};
use serde_json::{json, Value};

pub struct OpenAi;

impl Provider for OpenAi {
    fn endpoint(&self, base_url: &str, _model: &str) -> String {
        let base = base_url.trim().trim_end_matches('/');
        let base = if base.is_empty() {
            "https://api.openai.com/v1"
        } else {
            base
        };
        format!("{base}/chat/completions")
    }

    fn headers(&self, api_key: &str) -> Vec<(String, String)> {
        let mut h = vec![("content-type".to_string(), "application/json".to_string())];
        // Auth header omitted entirely when no key — local Ollama / LM Studio
        // are keyless.
        if !api_key.trim().is_empty() {
            h.push((
                "authorization".to_string(),
                format!("Bearer {}", api_key.trim()),
            ));
        }
        h
    }

    fn body(&self, req: &ChatRequest) -> Value {
        let mut messages: Vec<Value> = Vec::new();
        if !req.system.trim().is_empty() {
            messages.push(json!({ "role": "system", "content": req.system }));
        }
        for m in &req.messages {
            if m.role == "assistant" {
                if let Some(calls) = &m.tool_calls {
                    let tcs: Vec<Value> = calls
                        .iter()
                        .map(|c| {
                            json!({
                                "id": c.id,
                                "type": "function",
                                "function": { "name": c.name, "arguments": c.arguments },
                            })
                        })
                        .collect();
                    messages.push(json!({
                        "role": "assistant",
                        "content": m.content,
                        "tool_calls": tcs,
                    }));
                    continue;
                }
            }
            if m.role == "tool" {
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": m.tool_call_id.clone().unwrap_or_default(),
                    "content": m.content,
                }));
                continue;
            }
            messages.push(json!({ "role": m.role, "content": m.content }));
        }
        let mut body = json!({
            "model": req.model,
            "stream": true,
            "stream_options": { "include_usage": true },
            "messages": messages,
        });
        if !req.tools.is_empty() {
            body["tools"] = crate::runtime::tools::openai_tools(&req.tools);
        }
        body
    }

    fn parse_sse_line(&self, line: &str) -> Vec<StreamItem> {
        let line = line.trim();
        let Some(data) = line.strip_prefix("data:") else {
            return Vec::new();
        };
        let data = data.trim();
        if data.is_empty() {
            return Vec::new();
        }
        if data == "[DONE]" {
            return vec![StreamItem::Done];
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if let Some(text) = v
            .pointer("/choices/0/delta/content")
            .and_then(|x| x.as_str())
        {
            if !text.is_empty() {
                out.push(StreamItem::TextDelta(text.to_string()));
            }
        }
        if let Some(tcs) = v
            .pointer("/choices/0/delta/tool_calls")
            .and_then(|x| x.as_array())
        {
            for tc in tcs {
                let index = tc.get("index").and_then(|x| x.as_i64()).unwrap_or(0);
                let id = tc.get("id").and_then(|x| x.as_str());
                let name = tc.pointer("/function/name").and_then(|x| x.as_str());
                let args = tc
                    .pointer("/function/arguments")
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                out.push(StreamItem::ToolCallDelta {
                    index,
                    id: id.map(|s| s.to_string()),
                    name: name.map(|s| s.to_string()),
                    args: args.to_string(),
                });
            }
        }
        if let Some(usage) = v.get("usage").filter(|u| u.is_object()) {
            let in_tokens = usage.get("prompt_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
            let out_tokens = usage
                .get("completion_tokens")
                .and_then(|x| x.as_u64())
                .unwrap_or(0);
            out.push(StreamItem::Usage { in_tokens, out_tokens });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::OpenAi;
    use crate::runtime::provider::{ChatRequest, Msg, Provider, StreamItem};

    fn req(system: &str, msgs: Vec<(&str, &str)>) -> ChatRequest {
        ChatRequest {
            model: "gpt-4o".into(),
            system: system.into(),
            messages: msgs
                .into_iter()
                .map(|(r, c)| Msg {
                    role: r.into(),
                    content: c.into(),
                    tool_calls: None,
                    tool_call_id: None,
                    name: None,
                })
                .collect(),
            tools: vec![],
        }
    }

    #[test]
    fn endpoint_defaults_when_base_blank() {
        assert_eq!(
            OpenAi.endpoint("", "gpt-4o"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            OpenAi.endpoint("http://localhost:11434/v1/", "x"),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn headers_omit_auth_when_key_blank() {
        let h = OpenAi.headers("   ");
        assert!(h.iter().all(|(k, _)| k != "authorization"));
        let h2 = OpenAi.headers("sk-abc");
        assert!(h2
            .iter()
            .any(|(k, v)| k == "authorization" && v == "Bearer sk-abc"));
    }

    #[test]
    fn body_places_system_first_and_streams_with_usage() {
        let b = OpenAi.body(&req("be terse", vec![("user", "hi")]));
        assert_eq!(b["stream"], true);
        assert_eq!(b["stream_options"]["include_usage"], true);
        assert_eq!(b["messages"][0]["role"], "system");
        assert_eq!(b["messages"][0]["content"], "be terse");
        assert_eq!(b["messages"][1]["role"], "user");
        assert_eq!(b["messages"][1]["content"], "hi");
    }

    #[test]
    fn body_omits_system_when_blank() {
        let b = OpenAi.body(&req("", vec![("user", "hi")]));
        assert_eq!(b["messages"][0]["role"], "user");
    }

    #[test]
    fn parses_text_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"Hel"}}]}"#;
        assert_eq!(OpenAi.parse_sse_line(line), vec![StreamItem::TextDelta("Hel".into())]);
    }

    #[test]
    fn role_only_delta_is_ignored() {
        let line = r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#;
        assert!(OpenAi.parse_sse_line(line).is_empty());
    }

    #[test]
    fn parses_final_usage_chunk() {
        let line = r#"data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}"#;
        assert_eq!(
            OpenAi.parse_sse_line(line),
            vec![StreamItem::Usage { in_tokens: 10, out_tokens: 5 }]
        );
    }

    #[test]
    fn done_and_noise() {
        assert_eq!(OpenAi.parse_sse_line("data: [DONE]"), vec![StreamItem::Done]);
        assert!(OpenAi.parse_sse_line("").is_empty());
        assert!(OpenAi.parse_sse_line(": keep-alive comment").is_empty());
        assert!(OpenAi.parse_sse_line("data: {not json").is_empty());
    }

    #[test]
    fn parses_tool_call_fragments() {
        let l1 = r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"orion_read_file","arguments":""}}]}}]}"#;
        let l2 = r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":\"/x\"}"}}]}}]}"#;
        assert_eq!(
            OpenAi.parse_sse_line(l1),
            vec![StreamItem::ToolCallDelta {
                index: 0,
                id: Some("call_1".into()),
                name: Some("orion_read_file".into()),
                args: "".into()
            }]
        );
        assert_eq!(
            OpenAi.parse_sse_line(l2),
            vec![StreamItem::ToolCallDelta {
                index: 0,
                id: None,
                name: None,
                args: "{\"path\":\"/x\"}".into()
            }]
        );
    }

    #[test]
    fn body_includes_tools_when_present() {
        let mut r = req("", vec![("user", "hi")]);
        r.tools = vec![crate::runtime::tools::ToolDef {
            name: "orion_read_file".into(),
            description: "d".into(),
            parameters: serde_json::json!({"type":"object","properties":{}}),
        }];
        let b = OpenAi.body(&r);
        assert_eq!(b["tools"][0]["function"]["name"], "orion_read_file");
    }

    #[test]
    fn body_serializes_assistant_tool_calls_and_tool_result() {
        let mut r = req("", vec![]);
        r.messages = vec![
            Msg { role: "user".into(), content: "go".into(), tool_calls: None, tool_call_id: None, name: None },
            Msg {
                role: "assistant".into(),
                content: "".into(),
                tool_calls: Some(vec![crate::runtime::provider::ToolCall {
                    id: "call_1".into(), name: "orion_read_file".into(), arguments: "{\"path\":\"/x\"}".into(),
                }]),
                tool_call_id: None,
                name: None,
            },
            Msg { role: "tool".into(), content: "file body".into(), tool_calls: None, tool_call_id: Some("call_1".into()), name: Some("orion_read_file".into()) },
        ];
        let b = OpenAi.body(&r);
        let msgs = b["messages"].as_array().unwrap();
        assert_eq!(msgs[1]["tool_calls"][0]["id"], "call_1");
        assert_eq!(msgs[1]["tool_calls"][0]["type"], "function");
        assert_eq!(msgs[1]["tool_calls"][0]["function"]["arguments"], "{\"path\":\"/x\"}");
        assert_eq!(msgs[2]["role"], "tool");
        assert_eq!(msgs[2]["tool_call_id"], "call_1");
        assert_eq!(msgs[2]["content"], "file body");
    }
}
