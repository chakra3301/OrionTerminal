use super::provider::{ChatRequest, Provider, StreamItem};
use serde_json::{json, Value};

pub struct Gemini;

impl Provider for Gemini {
    fn endpoint(&self, base_url: &str, model: &str) -> String {
        let base = base_url.trim().trim_end_matches('/');
        let base = if base.is_empty() {
            "https://generativelanguage.googleapis.com/v1beta"
        } else {
            base
        };
        format!("{base}/models/{model}:streamGenerateContent?alt=sse")
    }

    fn headers(&self, api_key: &str) -> Vec<(String, String)> {
        let mut h = vec![("content-type".to_string(), "application/json".to_string())];
        if !api_key.trim().is_empty() {
            h.push(("x-goog-api-key".to_string(), api_key.trim().to_string()));
        }
        h
    }

    fn body(&self, req: &ChatRequest) -> Value {
        let contents: Vec<Value> = req
            .messages
            .iter()
            .map(|m| {
                if m.role == "assistant" {
                    if let Some(calls) = &m.tool_calls {
                        let mut parts: Vec<Value> = Vec::new();
                        if !m.content.trim().is_empty() {
                            parts.push(json!({ "text": m.content }));
                        }
                        for c in calls {
                            let args: Value = serde_json::from_str(&c.arguments).unwrap_or_else(|_| json!({}));
                            parts.push(json!({ "functionCall": { "name": c.name, "args": args } }));
                        }
                        return json!({ "role": "model", "parts": parts });
                    }
                }
                if m.role == "tool" {
                    let name = m.name.clone().unwrap_or_default();
                    return json!({
                        "role": "user",
                        "parts": [{
                            "functionResponse": {
                                "name": name,
                                "response": { "result": m.content },
                            }
                        }],
                    });
                }
                let role = if m.role == "assistant" { "model" } else { "user" };
                json!({ "role": role, "parts": [{ "text": m.content }] })
            })
            .collect();
        let mut b = json!({ "contents": contents });
        if !req.system.trim().is_empty() {
            b["system_instruction"] = json!({ "parts": [{ "text": req.system }] });
        }
        if !req.tools.is_empty() {
            b["tools"] = crate::runtime::tools::gemini_tools(&req.tools);
        }
        b
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
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if let Some(parts) = v
            .pointer("/candidates/0/content/parts")
            .and_then(|x| x.as_array())
        {
            let text: String = parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect();
            if !text.is_empty() {
                out.push(StreamItem::TextDelta(text));
            }
            for p in parts {
                if let Some(fc) = p.get("functionCall") {
                    let name = fc.get("name").and_then(|x| x.as_str()).map(|s| s.to_string());
                    let args = fc
                        .get("args")
                        .map(|a| a.to_string())
                        .unwrap_or_else(|| "{}".to_string());
                    out.push(StreamItem::ToolCallDelta { index: -1, id: None, name, args });
                }
            }
        }
        if let Some(usage) = v.get("usageMetadata").filter(|u| u.is_object()) {
            let in_tokens = usage
                .get("promptTokenCount")
                .and_then(|x| x.as_u64())
                .unwrap_or(0);
            let out_tokens = usage
                .get("candidatesTokenCount")
                .and_then(|x| x.as_u64())
                .unwrap_or(0);
            out.push(StreamItem::Usage { in_tokens, out_tokens });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::Gemini;
    use crate::runtime::provider::{ChatRequest, Msg, Provider, StreamItem};

    fn req(system: &str, msgs: Vec<(&str, &str)>) -> ChatRequest {
        ChatRequest {
            model: "gemini-2.0-flash".into(),
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
    fn endpoint_defaults_and_targets_sse() {
        assert_eq!(
            Gemini.endpoint("", "gemini-2.0-flash"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn headers_use_goog_key_and_omit_when_blank() {
        assert!(Gemini.headers("").iter().all(|(k, _)| k != "x-goog-api-key"));
        assert!(Gemini
            .headers("AIza123")
            .iter()
            .any(|(k, v)| k == "x-goog-api-key" && v == "AIza123"));
    }

    #[test]
    fn body_maps_assistant_to_model_and_sets_system_instruction() {
        let b = Gemini.body(&req("persona", vec![("user", "hi"), ("assistant", "yo")]));
        assert_eq!(b["system_instruction"]["parts"][0]["text"], "persona");
        assert_eq!(b["contents"][0]["role"], "user");
        assert_eq!(b["contents"][0]["parts"][0]["text"], "hi");
        assert_eq!(b["contents"][1]["role"], "model");
    }

    #[test]
    fn parses_text_delta() {
        let line = r#"data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"}}]}"#;
        assert_eq!(Gemini.parse_sse_line(line), vec![StreamItem::TextDelta("Hello".into())]);
    }

    #[test]
    fn parses_text_and_usage_on_same_line() {
        let line = r#"data: {"candidates":[{"content":{"parts":[{"text":"!"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":3}}"#;
        assert_eq!(
            Gemini.parse_sse_line(line),
            vec![
                StreamItem::TextDelta("!".into()),
                StreamItem::Usage { in_tokens: 7, out_tokens: 3 }
            ]
        );
    }

    #[test]
    fn ignores_noise() {
        assert!(Gemini.parse_sse_line("").is_empty());
        assert!(Gemini.parse_sse_line("data:").is_empty());
        assert!(Gemini.parse_sse_line("data: {bad").is_empty());
    }

    #[test]
    fn parses_function_call_as_negative_index() {
        let line = r#"data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"orion_read_file","args":{"path":"/x"}}}]}}]}"#;
        let items = Gemini.parse_sse_line(line);
        assert_eq!(items.len(), 1);
        match &items[0] {
            StreamItem::ToolCallDelta { index, name, args, .. } => {
                assert_eq!(*index, -1);
                assert_eq!(name.as_deref(), Some("orion_read_file"));
                let v: serde_json::Value = serde_json::from_str(args).unwrap();
                assert_eq!(v["path"], "/x");
            }
            other => panic!("expected ToolCallDelta, got {:?}", other),
        }
    }

    #[test]
    fn body_includes_function_declarations() {
        let mut r = req("", vec![("user", "hi")]);
        r.tools = vec![crate::runtime::tools::ToolDef {
            name: "orion_read_file".into(),
            description: "d".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string"}}}),
        }];
        let b = Gemini.body(&r);
        assert_eq!(b["tools"][0]["functionDeclarations"][0]["name"], "orion_read_file");
    }

    #[test]
    fn body_maps_tool_calls_and_results() {
        let mut r = req("", vec![]);
        r.messages = vec![
            Msg {
                role: "assistant".into(),
                content: "".into(),
                tool_calls: Some(vec![crate::runtime::provider::ToolCall {
                    id: "call_0".into(), name: "orion_read_file".into(), arguments: "{\"path\":\"/x\"}".into(),
                }]),
                tool_call_id: None, name: None,
            },
            Msg { role: "tool".into(), content: "body".into(), tool_calls: None, tool_call_id: Some("call_0".into()), name: Some("orion_read_file".into()) },
        ];
        let b = Gemini.body(&r);
        assert_eq!(b["contents"][0]["role"], "model");
        assert_eq!(b["contents"][0]["parts"][0]["functionCall"]["name"], "orion_read_file");
        assert_eq!(b["contents"][0]["parts"][0]["functionCall"]["args"]["path"], "/x");
        assert_eq!(b["contents"][1]["role"], "user");
        assert_eq!(b["contents"][1]["parts"][0]["functionResponse"]["name"], "orion_read_file");
        assert_eq!(b["contents"][1]["parts"][0]["functionResponse"]["response"]["result"], "body");
    }
}
