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
                let role = if m.role == "assistant" { "model" } else { "user" };
                json!({ "role": role, "parts": [{ "text": m.content }] })
            })
            .collect();
        let mut b = json!({ "contents": contents });
        if !req.system.trim().is_empty() {
            b["system_instruction"] = json!({ "parts": [{ "text": req.system }] });
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
                .map(|(r, c)| Msg { role: r.into(), content: c.into() })
                .collect(),
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
}
