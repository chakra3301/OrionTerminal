use serde::Deserialize;

/// One conversation turn. `role` is "user" | "assistant".
#[derive(Debug, Clone, Deserialize)]
pub struct Msg {
    pub role: String,
    pub content: String,
}

/// A complete chat request, provider-agnostic. The loop builds this once and
/// hands it to the adapter's `body()`.
pub struct ChatRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<Msg>,
}

/// One parsed unit from a streamed SSE line.
#[derive(Debug, PartialEq)]
pub enum StreamItem {
    TextDelta(String),
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
    use super::make_provider;

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
}
