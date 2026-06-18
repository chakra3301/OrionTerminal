use serde::{Deserialize, Serialize};

/// A model-requested tool call, accumulated across stream fragments.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// Raw JSON string of the arguments object (parsed at dispatch time).
    pub arguments: String,
}

/// One conversation turn. `role` is "user" | "assistant" | "tool".
/// Tool fields are built by the runtime loop within a turn; inbound history
/// from the frontend carries only role+content (the rest default to None).
#[derive(Debug, Clone, Deserialize)]
pub struct Msg {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

/// A complete chat request, provider-agnostic. The loop builds this per round
/// and hands it to the adapter's `body()`.
pub struct ChatRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<Msg>,
    pub tools: Vec<crate::runtime::tools::ToolDef>,
}

/// One parsed unit from a streamed SSE line.
#[derive(Debug, PartialEq)]
pub enum StreamItem {
    TextDelta(String),
    /// A fragment of a tool call. OpenAI dribbles `args` across lines keyed by
    /// `index`; Gemini emits a complete call in one line with `index = -1`
    /// (always a new entry — see `ToolCallAccumulator`).
    ToolCallDelta {
        index: i64,
        id: Option<String>,
        name: Option<String>,
        args: String,
    },
    Usage { in_tokens: u64, out_tokens: u64 },
    Done,
}

/// Each adapter differs only in these four methods; the loop in `mod.rs` is
/// provider-agnostic. `parse_sse_line` is pure (unit-tested, network-free).
pub trait Provider {
    fn endpoint(&self, base_url: &str, model: &str) -> String;
    fn headers(&self, api_key: &str) -> Vec<(String, String)>;
    fn body(&self, req: &ChatRequest) -> serde_json::Value;
    fn parse_sse_line(&self, line: &str) -> Vec<StreamItem>;
}

/// Pick the adapter for a provider kind. "google" → Gemini; every other kind
/// ("openai" | "openai_compat" | "custom" | …) speaks /v1/chat/completions.
pub fn make_provider(kind: &str) -> Box<dyn Provider + Send + Sync> {
    match kind {
        "google" => Box::new(super::gemini::Gemini),
        _ => Box::new(super::openai::OpenAi),
    }
}

#[cfg(test)]
mod tests {
    use super::{make_provider, Msg, ToolCall};

    #[test]
    fn google_kind_routes_to_gemini() {
        let p = make_provider("google");
        assert!(p.endpoint("", "gemini-2.0-flash").contains("streamGenerateContent"));
    }

    #[test]
    fn other_kinds_route_to_openai_compat() {
        for kind in ["openai", "openai_compat", "custom", "anything"] {
            let p = make_provider(kind);
            assert!(p.endpoint("", "gpt-4o").ends_with("/chat/completions"));
        }
    }

    #[test]
    fn msg_deserializes_without_tool_fields() {
        let m: Msg = serde_json::from_str(r#"{"role":"user","content":"hi"}"#).unwrap();
        assert_eq!(m.role, "user");
        assert!(m.tool_calls.is_none());
        assert!(m.tool_call_id.is_none());
        assert!(m.name.is_none());
    }

    #[test]
    fn tool_call_round_trips() {
        let c = ToolCall { id: "call_0".into(), name: "orion_read_file".into(), arguments: "{}".into() };
        let s = serde_json::to_string(&c).unwrap();
        let back: ToolCall = serde_json::from_str(&s).unwrap();
        assert_eq!(back, c);
    }
}
