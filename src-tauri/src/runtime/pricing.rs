//! Rough per-MTok (USD) input/output rates by provider kind + model name.
//! Heuristic only (mirrors messages_chat.rs's approach) — used for the
//! monitor estimate, never authoritative. Local/unknown models fall back low.

/// Returns (input_rate, output_rate) in USD per 1,000,000 tokens.
pub fn rate(kind: &str, model: &str) -> (f64, f64) {
    let m = model.to_lowercase();
    match kind {
        "google" => {
            if m.contains("flash") {
                (0.075, 0.30)
            } else {
                (1.25, 5.0) // gemini pro tier
            }
        }
        _ => {
            // OpenAI-compatible family heuristics.
            if m.contains("mini") || m.contains("haiku") {
                (0.15, 0.60)
            } else if m.contains("o1") || m.contains("o3") {
                (15.0, 60.0)
            } else if m.contains("gpt-4") {
                (2.5, 10.0)
            } else {
                (0.5, 1.5) // local / unknown
            }
        }
    }
}

pub fn estimate_cost(kind: &str, model: &str, in_tokens: u64, out_tokens: u64) -> f64 {
    let (in_rate, out_rate) = rate(kind, model);
    (in_tokens as f64) * in_rate / 1_000_000.0 + (out_tokens as f64) * out_rate / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::estimate_cost;

    #[test]
    fn computes_from_usage() {
        // gpt-4o: 2.5 in / 10 out per MTok → 1M in + 1M out = 2.5 + 10 = 12.5
        let c = estimate_cost("openai", "gpt-4o", 1_000_000, 1_000_000);
        assert!((c - 12.5).abs() < 1e-9);
    }

    #[test]
    fn gemini_flash_is_cheap() {
        let c = estimate_cost("google", "gemini-2.0-flash", 1_000_000, 0);
        assert!((c - 0.075).abs() < 1e-9);
    }

    #[test]
    fn zero_tokens_zero_cost() {
        assert_eq!(estimate_cost("openai", "anything", 0, 0), 0.0);
    }
}
