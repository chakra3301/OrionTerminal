# Provider-Agnostic Agent Runtime — Phase 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Rust provider-agnostic streaming chat runtime (OpenAI-compatible + Gemini) that emits the exact same `claude:event`/`claude:exit` stream the Claude CLI emits, plus a frontend `dispatchSend` routing seam, so non-Claude models stream replies on the existing chat rails with zero changes to EventBridge/chatStore.

**Architecture:** New Rust module `src-tauri/src/runtime/` (`provider.rs` trait + types + `make_provider`, `openai.rs`, `gemini.rs`, `pricing.rs`, `mod.rs` loop + `runtime_send`/`runtime_cancel` commands). The streaming loop mirrors `messages_chat.rs` (reqwest `bytes_stream`, `Notify`-keyed cancel map) but emits the Claude event contract verbatim. Frontend `src/features/agents/dispatchSend.ts` picks the engine by the resolved model's owning provider — Anthropic-builtin → unchanged `ipc.claudeSend`; else → new `ipc.runtimeSend` with history. Non-Claude is stateless (history-based, no session). Keys stay in Rust via `provider_keys::read`.

**Tech Stack:** Rust (Tauri 2, reqwest streaming already enabled with `stream`/`json`, `futures-util`, `serde_json`, `tokio`, `once_cell`, `parking_lot`), TypeScript/React, Zustand, Vitest.

---

## Design notes the implementer must honor

**The event contract (emit verbatim — read from `src/app/EventBridge.tsx`):**
- Per text delta: `claude:event { chatId, event: { type:"assistant", message:{ content:[{ type:"text", text:<ACCUMULATED text so far> }] } } }`. The accumulated (not incremental) text is required — `chatStore.onAssistantBlocks` / `appChat.setAssistantContent` / rosie's handler all **replace** the pending message with this snapshot.
- Turn end: `claude:event { chatId, event: { type:"result", total_cost_usd:<f64>, session_id: null } }`, then `claude:exit { chatId, code: 0, error: null }`.
- On error: `claude:event { chatId, event:{ type:"stderr", text:<msg> } }`, then `claude:exit { chatId, code: 1, error:<msg> }`.

**Non-regression (headline):** A plain Claude model selection must call `ipc.claudeSend(chatId, prompt, projectRoot, sessionId, imagePath, model, systemAppend, allowedTools)` with byte-identical args to today (verified by Task 10's routing test). `runtime_send` is purely additive — no existing Rust signature changes.

**Routing rule:** owning provider = the provider whose `models[]` contains the resolved `model`. Route to Claude when the owner is `undefined` (default) OR `owner.kind === "anthropic"`. Otherwise route to the runtime; `owner.kind === "google"` → Gemini adapter, everything else → OpenAI-compatible adapter.

**Two deliberate refinements over the spec's `provider.rs` sketch (note in commits):**
1. `parse_sse_line` returns `Vec<StreamItem>` (not `Option<StreamItem>`) — a single Gemini SSE line can carry BOTH a text delta and `usageMetadata`; a Vec keeps the function pure and lossless. Empty vec = ignored line.
2. The OpenAI-compat adapter is the fallback for every non-`google` kind (`openai`/`openai_compat`/`custom`/anything), since they all speak `/v1/chat/completions`.

**Known 2a limitations (acceptable, documented):** non-Claude is conversational replies only (no tools — Phase 2b); the runtime path ignores `imagePath` (XDesign snapshot won't reach a non-Claude model — vision is out of 2a scope); Archives/XDesign/ROSIE bake their app-behavior system prompt into the first user turn (reaches Claude, not the stateless runtime — only the agent persona `systemAppend` is sent as the runtime `system`); Orion's injected @-context block is Claude-only (the runtime gets the visible conversation text).

**Reference files (read before starting):** `src-tauri/src/messages_chat.rs` (streaming-loop template), `src-tauri/src/claude_cli.rs` (event payload structs + cancel map + `OPUS_MODEL`), `src-tauri/src/provider_keys.rs` (`read`), `src/features/agents/resolveSend.ts`, `src/store/chatStore.ts` + `src/store/appChatStore.ts` + `src/features/rosie/rosieStore.ts` (history shapes), `src/lib/ipc.ts` (`claudeSend` arg order).

---

### Task 1: Module scaffold — `provider.rs` types + trait, empty adapter modules

This task compiles and commits on its own. `make_provider` (which references the adapter structs) is added in Task 6, after both adapters exist, so every task in between links cleanly.

**Files:**
- Create: `src-tauri/src/runtime/provider.rs`
- Create: `src-tauri/src/runtime/mod.rs`
- Create: `src-tauri/src/runtime/openai.rs` (empty stub)
- Create: `src-tauri/src/runtime/gemini.rs` (empty stub)
- Create: `src-tauri/src/runtime/pricing.rs` (empty stub)
- Modify: `src-tauri/src/lib.rs` (add `mod runtime;` after `mod repolens_website;`)

- [ ] **Step 1: Create `provider.rs` with the types + trait (no `make_provider` yet)**

`src-tauri/src/runtime/provider.rs`:

```rust
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
```

- [ ] **Step 2: Create `mod.rs` declaring the four submodules**

`src-tauri/src/runtime/mod.rs` (the loop + commands are added in Task 7):

```rust
pub mod gemini;
pub mod openai;
pub mod pricing;
pub mod provider;
```

- [ ] **Step 3: Create the three adapter files as empty (valid) modules**

`src-tauri/src/runtime/openai.rs`, `src-tauri/src/runtime/gemini.rs`, `src-tauri/src/runtime/pricing.rs` — each just:

```rust
// Implemented in a later task.
```

- [ ] **Step 4: Register the module in `lib.rs`**

In `src-tauri/src/lib.rs`, add after line 18 (`mod repolens_website;`):

```rust
mod runtime;
```

- [ ] **Step 5: Compile + commit**

Run: `cd src-tauri && cargo check 2>&1 | tail -8`
Expected: clean (empty modules are valid; one pre-existing `pick_thumbnail` warning is OK).

```bash
git add src-tauri/src/runtime/ src-tauri/src/lib.rs
git commit -m "feat(runtime): module scaffold — Provider trait + types"
```

---

### Task 2: OpenAI adapter — `endpoint`, `headers`, `body`

**Files:**
- Modify: `src-tauri/src/runtime/openai.rs`

- [ ] **Step 1: Write the OpenAI adapter struct with endpoint/headers/body + tests**

Replace the contents of `src-tauri/src/runtime/openai.rs`:

```rust
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
            messages.push(json!({ "role": m.role, "content": m.content }));
        }
        json!({
            "model": req.model,
            "stream": true,
            "stream_options": { "include_usage": true },
            "messages": messages,
        })
    }

    fn parse_sse_line(&self, _line: &str) -> Vec<StreamItem> {
        // Implemented in Task 3.
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::OpenAi;
    use crate::runtime::provider::{ChatRequest, Msg, Provider};

    fn req(system: &str, msgs: Vec<(&str, &str)>) -> ChatRequest {
        ChatRequest {
            model: "gpt-4o".into(),
            system: system.into(),
            messages: msgs
                .into_iter()
                .map(|(r, c)| Msg { role: r.into(), content: c.into() })
                .collect(),
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
}
```

- [ ] **Step 2: Run the OpenAI body/header/endpoint tests**

Run: `cd src-tauri && cargo test runtime::openai 2>&1 | tail -20`
Expected: the four `tests::*` pass (this file links on its own — `parse_sse_line` is a stub returning `Vec::new()` for now).

---

### Task 3: OpenAI adapter — `parse_sse_line`

**Files:**
- Modify: `src-tauri/src/runtime/openai.rs`

- [ ] **Step 1: Replace the stub `parse_sse_line` with the real parser**

In `src-tauri/src/runtime/openai.rs`, replace the `parse_sse_line` method body:

```rust
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
```

- [ ] **Step 2: Add parse tests to the `tests` mod in openai.rs**

Append inside the `#[cfg(test)] mod tests`:

```rust
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
```

Add the `StreamItem` import to the test mod's `use`:

```rust
    use crate::runtime::provider::{ChatRequest, Msg, Provider, StreamItem};
```

- [ ] **Step 3: Run the parser tests**

Run: `cd src-tauri && cargo test runtime::openai 2>&1 | tail -20`
Expected: all OpenAI tests pass.

- [ ] **Step 4: Commit the OpenAI adapter**

```bash
git add src-tauri/src/runtime/openai.rs
git commit -m "feat(runtime): OpenAI-compatible adapter (endpoint/headers/body/parse, TDD)"
```

---

### Task 4: Gemini adapter — `endpoint`, `headers`, `body`

**Files:**
- Modify: `src-tauri/src/runtime/gemini.rs`

- [ ] **Step 1: Write the Gemini adapter struct + tests (parse stubbed)**

Replace the contents of `src-tauri/src/runtime/gemini.rs`:

```rust
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

    fn parse_sse_line(&self, _line: &str) -> Vec<StreamItem> {
        // Implemented in Task 5.
        Vec::new()
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
        let _ = StreamItem::Done; // keep the import used until Task 5
    }
}
```

- [ ] **Step 2: Run the Gemini body/header/endpoint tests**

Run: `cd src-tauri && cargo test runtime::gemini 2>&1 | tail -20`
Expected: the three `tests::*` pass (this file links on its own — `parse_sse_line` is a stub for now).

---

### Task 5: Gemini adapter — `parse_sse_line`

**Files:**
- Modify: `src-tauri/src/runtime/gemini.rs`

- [ ] **Step 1: Replace the stub `parse_sse_line`**

```rust
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
```

- [ ] **Step 2: Add parse tests (a line can carry text AND usage)**

Append inside the gemini `tests` mod, and delete the `let _ = StreamItem::Done;` line from Task 4's test (no longer needed):

```rust
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
```

- [ ] **Step 3: Run the Gemini parser tests**

Run: `cd src-tauri && cargo test runtime::gemini 2>&1 | tail -20`
Expected: all Gemini tests pass.

- [ ] **Step 3: Commit the Gemini adapter**

```bash
git add src-tauri/src/runtime/gemini.rs
git commit -m "feat(runtime): Gemini adapter (endpoint/headers/body/parse, TDD)"
```

---

### Task 6: Pricing table + `make_provider` dispatcher

**Files:**
- Modify: `src-tauri/src/runtime/pricing.rs`
- Modify: `src-tauri/src/runtime/provider.rs` (add `make_provider` + its test, now that both adapter structs exist)

- [ ] **Step 1: Write `pricing.rs` with rates + `estimate_cost` + tests**

Replace the contents of `src-tauri/src/runtime/pricing.rs`:

```rust
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
```

- [ ] **Step 2: Add `make_provider` + its test to `provider.rs`**

Append to `src-tauri/src/runtime/provider.rs`:

```rust
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
```

- [ ] **Step 3: Run the whole runtime module's tests + full Rust gate**

Run: `cd src-tauri && cargo test runtime:: 2>&1 | tail -30`
Expected: PASS — `runtime::provider` (incl. the 2 `make_provider` tests), `runtime::openai`, `runtime::gemini`, `runtime::pricing` all green.

Run: `cd src-tauri && cargo test 2>&1 | tail -10 && cargo check 2>&1 | tail -5`
Expected: all tests pass; `cargo check` clean (the pre-existing `pick_thumbnail` warning is unrelated).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/runtime/pricing.rs src-tauri/src/runtime/provider.rs
git commit -m "feat(runtime): pricing table + make_provider dispatcher (TDD)"
```

---

### Task 7: Streaming loop + `runtime_send`/`runtime_cancel` commands

**Files:**
- Modify: `src-tauri/src/runtime/mod.rs` (replace the Task-1 stub)
- Modify: `src-tauri/src/lib.rs` (register the two commands in `generate_handler!`)

- [ ] **Step 1: Write the loop, the `take_lines` helper + its test, and the commands**

Replace the contents of `src-tauri/src/runtime/mod.rs`:

```rust
pub mod gemini;
pub mod openai;
pub mod pricing;
pub mod provider;

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use provider::{make_provider, ChatRequest, Msg, StreamItem};

static STREAMS: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

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

fn emit_assistant(app: &AppHandle, chat_id: &str, text: &str) {
    let _ = app.emit(
        "claude:event",
        EventPayload {
            chat_id: chat_id.to_string(),
            event: serde_json::json!({
                "type": "assistant",
                "message": { "content": [{ "type": "text", "text": text }] }
            }),
        },
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

/// Provider-agnostic streaming chat turn. Emits the Claude event contract
/// (`claude:event` assistant snapshots → result → `claude:exit`) so the
/// existing EventBridge/chatStore render it with zero changes. History-based
/// (stateless): no session id is produced.
#[tauri::command]
pub async fn runtime_send(
    app: AppHandle,
    chat_id: String,
    provider_kind: String,
    base_url: String,
    key_ref: String,
    model: String,
    system: String,
    history: Vec<Msg>,
) -> Result<(), String> {
    let key = crate::provider_keys::read(&key_ref).unwrap_or_default();
    let prov = make_provider(&provider_kind);
    let url = prov.endpoint(&base_url, &model);
    let req = ChatRequest {
        model: model.clone(),
        system,
        messages: history,
    };
    let body = prov.body(&req);

    let cancel = Arc::new(Notify::new());
    STREAMS.lock().insert(chat_id.clone(), cancel.clone());

    let client = reqwest::Client::new();
    let mut rb = client.post(&url).json(&body);
    for (k, v) in prov.headers(&key) {
        rb = rb.header(k, v);
    }

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            STREAMS.lock().remove(&chat_id);
            emit_error_exit(&app, &chat_id, &e.to_string());
            return Err(e.to_string());
        }
    };
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        STREAMS.lock().remove(&chat_id);
        let brief: String = text.chars().take(500).collect();
        let msg = format!("HTTP {}: {}", status, brief);
        emit_error_exit(&app, &chat_id, &msg);
        return Err(msg);
    }

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut acc = String::new();
    let mut in_tokens: u64 = 0;
    let mut out_tokens: u64 = 0;
    let mut had_usage = false;
    let mut errored: Option<String> = None;

    loop {
        tokio::select! {
            _ = cancel.notified() => break,
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buf.extend_from_slice(&bytes);
                        for line in take_lines(&mut buf) {
                            for item in prov.parse_sse_line(&line) {
                                match item {
                                    StreamItem::TextDelta(t) => {
                                        acc.push_str(&t);
                                        emit_assistant(&app, &chat_id, &acc);
                                    }
                                    StreamItem::Usage { in_tokens: i, out_tokens: o } => {
                                        in_tokens = i;
                                        out_tokens = o;
                                        had_usage = true;
                                    }
                                    StreamItem::Done => {}
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        errored = Some(e.to_string());
                        break;
                    }
                    None => break,
                }
            }
        }
    }

    STREAMS.lock().remove(&chat_id);

    if let Some(e) = errored {
        emit_error_exit(&app, &chat_id, &e);
        return Err(e);
    }

    let cost = if had_usage {
        pricing::estimate_cost(&provider_kind, &model, in_tokens, out_tokens)
    } else {
        0.0
    };
    let _ = app.emit(
        "claude:event",
        EventPayload {
            chat_id: chat_id.clone(),
            event: serde_json::json!({
                "type": "result",
                "total_cost_usd": cost,
                "session_id": serde_json::Value::Null
            }),
        },
    );
    let _ = app.emit(
        "claude:exit",
        ExitPayload {
            chat_id,
            code: Some(0),
            error: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn runtime_cancel(chat_id: String) -> Result<(), String> {
    if let Some(n) = STREAMS.lock().remove(&chat_id) {
        n.notify_waiters();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::take_lines;

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
}
```

- [ ] **Step 2: Register the commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `claude_cli::claude_send` / `claude_cli::claude_cancel` lines in the `generate_handler!` block (around line 265-266) and add directly after them:

```rust
            runtime::runtime_send,
            runtime::runtime_cancel,
```

- [ ] **Step 3: Run the loop helper tests + full Rust gate**

Run: `cd src-tauri && cargo test runtime:: 2>&1 | tail -20`
Expected: PASS including the two `take_lines` tests.

Run: `cd src-tauri && cargo test 2>&1 | tail -10 && cargo check 2>&1 | tail -5`
Expected: all tests pass; check clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/runtime/mod.rs src-tauri/src/lib.rs
git commit -m "feat(runtime): streaming turn loop + runtime_send/runtime_cancel commands"
```

---

### Task 8: Frontend IPC wrappers

**Files:**
- Modify: `src/lib/ipc.ts` (add `runtimeSend` / `runtimeCancel` after the `claudeCancel` entry, ~line 186)

- [ ] **Step 1: Add the two wrappers**

In `src/lib/ipc.ts`, immediately after the `claudeCancel:` entry (line ~185-186), add:

```ts
  runtimeSend: (
    chatId: string,
    providerKind: string,
    baseUrl: string,
    keyRef: string,
    model: string,
    system: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void> =>
    invoke("runtime_send", {
      chatId,
      providerKind,
      baseUrl,
      keyRef,
      model,
      system,
      history,
    }),
  runtimeCancel: (chatId: string): Promise<void> =>
    invoke("runtime_cancel", { chatId }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: clean (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat(runtime): ipc.runtimeSend / runtimeCancel wrappers"
```

---

### Task 9: `dispatchSend` pure helpers — routing + history mapping

**Files:**
- Create: `src/features/agents/dispatchSend.ts`
- Create: `src/features/agents/dispatchSend.test.ts`

- [ ] **Step 1: Write the failing test for the pure helpers**

`src/features/agents/dispatchSend.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findOwningProvider, routeFor, toRuntimeHistory } from "./dispatchSend";
import { BUILTIN_PROVIDER } from "./seedData";
import type { Provider } from "./agentTypes";

const openai: Provider = {
  id: "p1",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  models: [{ id: "gpt-4o", label: "GPT-4o" }],
  keyRef: "p1",
  enabled: true,
  builtin: false,
};

describe("routing", () => {
  it("routes claude models to the claude engine", () => {
    expect(routeFor([BUILTIN_PROVIDER, openai], "claude-opus-4-8")).toBe("claude");
  });
  it("routes unknown models to claude (default)", () => {
    expect(routeFor([BUILTIN_PROVIDER, openai], "mystery")).toBe("claude");
  });
  it("routes a provider-owned model to that provider", () => {
    expect(routeFor([BUILTIN_PROVIDER, openai], "gpt-4o")).toEqual(openai);
  });
  it("findOwningProvider finds by model id", () => {
    expect(findOwningProvider([BUILTIN_PROVIDER, openai], "gpt-4o")).toEqual(openai);
    expect(findOwningProvider([BUILTIN_PROVIDER, openai], "nope")).toBeUndefined();
  });
});

describe("toRuntimeHistory", () => {
  it("flattens chatStore-style blocks and drops pending/empties", () => {
    const msgs = [
      { role: "user", blocks: [{ type: "text", text: "hi" }] },
      { role: "assistant", blocks: [{ type: "text", text: "hello " }, { type: "tool_use", id: "t", name: "x", input: {} }, { type: "text", text: "there" }] },
      { role: "assistant", blocks: [], pending: true },
      { role: "system", blocks: [{ type: "text", text: "ignore" }] },
    ];
    expect(toRuntimeHistory(msgs)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there" },
    ]);
  });
  it("passes through appChat/rosie string content", () => {
    const msgs = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b", pending: true },
      { role: "assistant", content: "c" },
    ];
    expect(toRuntimeHistory(msgs)).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "c" },
    ]);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/features/agents/dispatchSend.test.ts 2>&1 | tail -15`
Expected: FAIL — `./dispatchSend` not found.

- [ ] **Step 3: Write `dispatchSend.ts` (pure helpers only for now)**

`src/features/agents/dispatchSend.ts`:

```ts
import { ipc } from "@/lib/ipc";
import { resolveSendFromStores } from "@/features/agents/resolveSend";
import type { Provider } from "@/features/agents/agentTypes";
import { useProvidersStore } from "@/store/providersStore";

export type RuntimeMsg = { role: "user" | "assistant"; content: string };

export function findOwningProvider(
  providers: Provider[],
  model: string,
): Provider | undefined {
  return providers.find((p) => p.models.some((m) => m.id === model));
}

/** "claude" → unchanged CLI path; otherwise the runtime Provider to use. */
export function routeFor(providers: Provider[], model: string): "claude" | Provider {
  const owner = findOwningProvider(providers, model);
  if (!owner || owner.kind === "anthropic") return "claude";
  return owner;
}

type AnyMsg = {
  role: string;
  content?: unknown;
  blocks?: unknown;
  pending?: boolean;
};

function flattenTextBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter(
      (b): b is { type: "text"; text: string } =>
        !!b && typeof b === "object" && (b as { type?: string }).type === "text",
    )
    .map((b) => b.text)
    .join("");
}

/** Map any of the three store message shapes (chatStore blocks /
 *  appChat string content / rosie string|blocks) to runtime history.
 *  Drops pending, non user/assistant, and empty messages. */
export function toRuntimeHistory(msgs: AnyMsg[]): RuntimeMsg[] {
  const out: RuntimeMsg[] = [];
  for (const m of msgs) {
    if (m.pending) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    let content = "";
    if (typeof m.content === "string") content = m.content;
    else if (Array.isArray(m.blocks)) content = flattenTextBlocks(m.blocks);
    else if (Array.isArray(m.content)) content = flattenTextBlocks(m.content);
    if (!content.trim()) continue;
    out.push({ role: m.role, content });
  }
  return out;
}
```

> NOTE: `ipc`, `resolveSendFromStores`, and `useProvidersStore` are imported now but used by `dispatchSend`/`dispatchCancel` added in Task 10. If the linter flags unused imports before Task 10, add the two functions in this same task (they are listed in Task 10 Step 3) — but keep their dedicated test in Task 10.

- [ ] **Step 4: Run the pure-helper test, expect pass**

Run: `npx vitest run src/features/agents/dispatchSend.test.ts 2>&1 | tail -15`
Expected: PASS (both describe blocks).

---

### Task 10: `dispatchSend` / `dispatchCancel` + byte-identical-args routing test

**Files:**
- Modify: `src/features/agents/dispatchSend.ts` (add the two functions)
- Create: `src/features/agents/dispatchSend.routing.test.ts`

- [ ] **Step 1: Write the failing routing test (mock ipc + seed providers)**

`src/features/agents/dispatchSend.routing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    claudeSend: vi.fn().mockResolvedValue(undefined),
    runtimeSend: vi.fn().mockResolvedValue(undefined),
    claudeCancel: vi.fn().mockResolvedValue(undefined),
    runtimeCancel: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ipc } from "@/lib/ipc";
import { dispatchSend, dispatchCancel } from "./dispatchSend";
import { useProvidersStore } from "@/store/providersStore";
import { BUILTIN_PROVIDER } from "./seedData";
import type { Provider } from "./agentTypes";

const openai: Provider = {
  id: "p1",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  models: [{ id: "gpt-4o", label: "GPT-4o" }],
  keyRef: "p1",
  enabled: true,
  builtin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useProvidersStore.setState({ providers: [BUILTIN_PROVIDER, openai], loaded: true });
});

describe("dispatchSend routing", () => {
  it("a Claude model calls claudeSend with byte-identical args and never runtimeSend", async () => {
    await dispatchSend({
      chatId: "c1",
      value: "claude-opus-4-8",
      prompt: "PROMPT",
      history: [{ role: "user", content: "hi" }],
      projectRoot: "/proj",
      sessionId: "sess",
      imagePath: "/snap.png",
    });
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1);
    expect(ipc.claudeSend).toHaveBeenCalledWith(
      "c1",
      "PROMPT",
      "/proj",
      "sess",
      "/snap.png",
      "claude-opus-4-8",
      null,
      null,
    );
    expect(ipc.runtimeSend).not.toHaveBeenCalled();
  });

  it("a provider model calls runtimeSend with mapped args and never claudeSend", async () => {
    await dispatchSend({
      chatId: "c2",
      value: "gpt-4o",
      prompt: "PROMPT",
      history: [{ role: "user", content: "hi" }],
    });
    expect(ipc.runtimeSend).toHaveBeenCalledTimes(1);
    expect(ipc.runtimeSend).toHaveBeenCalledWith(
      "c2",
      "openai",
      "https://api.openai.com/v1",
      "p1",
      "gpt-4o",
      "",
      [{ role: "user", content: "hi" }],
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
  });

  it("cancel routes to the owning engine", async () => {
    await dispatchCancel("c1", "claude-opus-4-8");
    expect(ipc.claudeCancel).toHaveBeenCalledWith("c1");
    await dispatchCancel("c2", "gpt-4o");
    expect(ipc.runtimeCancel).toHaveBeenCalledWith("c2");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/features/agents/dispatchSend.routing.test.ts 2>&1 | tail -15`
Expected: FAIL — `dispatchSend` / `dispatchCancel` not exported.

- [ ] **Step 3: Add `dispatchSend` + `dispatchCancel` to `dispatchSend.ts`**

Append to `src/features/agents/dispatchSend.ts`:

```ts
export type DispatchSendArgs = {
  chatId: string;
  /** Raw model-prefs selection value (plain model id or `agent:<id>`). */
  value: string;
  /** Prompt for the Claude CLI path (already context-injected by the caller). */
  prompt: string;
  /** Full prior history for the stateless runtime path. */
  history: RuntimeMsg[];
  projectRoot?: string | null;
  sessionId?: string | null;
  imagePath?: string | null;
};

export async function dispatchSend(args: DispatchSendArgs): Promise<void> {
  const r = resolveSendFromStores(args.value);
  const providers = useProvidersStore.getState().providers;
  const route = routeFor(providers, r.model);
  if (route === "claude") {
    return ipc.claudeSend(
      args.chatId,
      args.prompt,
      args.projectRoot ?? null,
      args.sessionId ?? null,
      args.imagePath ?? null,
      r.model,
      r.systemAppend,
      r.allowedTools,
    );
  }
  return ipc.runtimeSend(
    args.chatId,
    route.kind,
    route.baseUrl,
    route.keyRef,
    r.model,
    r.systemAppend ?? "",
    args.history,
  );
}

export async function dispatchCancel(chatId: string, value: string): Promise<void> {
  const r = resolveSendFromStores(value);
  const providers = useProvidersStore.getState().providers;
  const route = routeFor(providers, r.model);
  if (route === "claude") return ipc.claudeCancel(chatId);
  return ipc.runtimeCancel(chatId);
}
```

- [ ] **Step 4: Run both dispatchSend test files, expect pass**

Run: `npx vitest run src/features/agents/dispatchSend 2>&1 | tail -20`
Expected: PASS (pure-helper test + routing test).

- [ ] **Step 5: Full frontend gate + commit**

Run: `npx tsc --noEmit 2>&1 | tail -10 && npx vitest run 2>&1 | tail -8`
Expected: tsc clean; full suite green (existing + new).

```bash
git add src/features/agents/dispatchSend.ts src/features/agents/dispatchSend.test.ts src/features/agents/dispatchSend.routing.test.ts
git commit -m "feat(runtime): dispatchSend routing seam (claude vs runtime) + byte-identical-args test"
```

---

### Task 11: Wire the Orion rail to `dispatchSend`

> Tasks 11–15 are UI/wiring; they have no automated UI test (agent can't run Tauri). They end at the user smoke checklist. Gate each with tsc + full vitest + `npm run build`.

**Files:**
- Modify: `src/apps/orion/OrionClaudeRail.tsx` (the `claudeSend` call ~line 135-145 and the `cancel` ~line 152-155)

- [ ] **Step 1: Replace the send call**

In `src/apps/orion/OrionClaudeRail.tsx`, replace:

```ts
      const r = resolveSendFromStores(useModelPrefs.getState().modelFor("orion"));
      await ipc.claudeSend(
        chat.id,
        prompt,
        project.root_path,
        chat.sessionId,
        null,
        r.model,
        r.systemAppend,
        r.allowedTools,
      );
```

with:

```ts
      await dispatchSend({
        chatId: chat.id,
        value: useModelPrefs.getState().modelFor("orion"),
        prompt,
        history: toRuntimeHistory(useChatStore.getState().active?.messages ?? []),
        projectRoot: project.root_path,
        sessionId: chat.sessionId,
        imagePath: null,
      });
```

- [ ] **Step 2: Replace the cancel call**

Replace:

```ts
  const cancel = () => {
    if (!active) return;
    void ipc.claudeCancel(active.id);
  };
```

with:

```ts
  const cancel = () => {
    if (!active) return;
    void dispatchCancel(active.id, useModelPrefs.getState().modelFor("orion"));
  };
```

- [ ] **Step 3: Update imports**

In the imports at the top, replace the line:

```ts
import { resolveSendFromStores } from "@/features/agents/resolveSend";
```

with:

```ts
import { dispatchSend, dispatchCancel, toRuntimeHistory } from "@/features/agents/dispatchSend";
```

Ensure `useChatStore` is imported (it almost certainly already is — the rail uses it; if not, add `import { useChatStore } from "@/store/chatStore";`). Leave the `ipc` import as-is (still used elsewhere in the file; if tsc reports it unused, remove it).

- [ ] **Step 4: Gate + commit**

Run: `npx tsc --noEmit 2>&1 | tail -10 && npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -5`
Expected: tsc clean; vitest green; build exit 0.

```bash
git add src/apps/orion/OrionClaudeRail.tsx
git commit -m "feat(runtime): route Orion rail send/cancel through dispatchSend"
```

---

### Task 12: Wire the Archives rail to `dispatchSend`

**Files:**
- Modify: `src/apps/archives/ArchivesApp.tsx` (the `claudeSend` ~line 232-242 and `handleCancel` ~line 250-252)

- [ ] **Step 1: Replace the send call**

Replace:

```ts
      const r = resolveSendFromStores(useModelPrefs.getState().modelFor("archives"));
      await ipc.claudeSend(
        chatId,
        prompt,
        null,
        thread.sessionId,
        null,
        r.model,
        r.systemAppend,
        r.allowedTools,
      );
```

with:

```ts
      await dispatchSend({
        chatId,
        value: useModelPrefs.getState().modelFor("archives"),
        prompt,
        history: toRuntimeHistory(useAppChat.getState().threads.archives.messages),
        projectRoot: null,
        sessionId: thread.sessionId,
        imagePath: null,
      });
```

- [ ] **Step 2: Replace the cancel**

Replace:

```ts
  const handleCancel = () => {
    void ipc.claudeCancel(thread.threadId);
  };
```

with:

```ts
  const handleCancel = () => {
    void dispatchCancel(thread.threadId, useModelPrefs.getState().modelFor("archives"));
  };
```

- [ ] **Step 3: Update imports**

Replace:

```ts
import { resolveSendFromStores } from "@/features/agents/resolveSend";
```

with:

```ts
import { dispatchSend, dispatchCancel, toRuntimeHistory } from "@/features/agents/dispatchSend";
```

`useAppChat` is already imported in this file (the rail uses `appendUser`/`beginAssistant`/`registerStream`). If tsc reports `ipc` unused after this change, remove its import.

- [ ] **Step 4: Gate + commit**

Run: `npx tsc --noEmit 2>&1 | tail -10 && npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -5`
Expected: tsc clean; vitest green; build exit 0.

```bash
git add src/apps/archives/ArchivesApp.tsx
git commit -m "feat(runtime): route Archives rail send/cancel through dispatchSend"
```

---

### Task 13: Wire the XDesign rail to `dispatchSend`

**Files:**
- Modify: `src/apps/xdesign/XDesignClaudeRail.tsx` (the `claudeSend` ~line 251-261; and the cancel handler — locate it via `claudeCancel`)

- [ ] **Step 1: Replace the send call**

Replace:

```ts
      const r = resolveSendFromStores(useModelPrefs.getState().modelFor("xdesign"));
      await ipc.claudeSend(
        chatId,
        prompt,
        null,
        thread.sessionId,
        snapshotPath,
        r.model,
        r.systemAppend,
        r.allowedTools,
      );
```

with:

```ts
      await dispatchSend({
        chatId,
        value: useModelPrefs.getState().modelFor("xdesign"),
        prompt,
        history: toRuntimeHistory(useAppChat.getState().threads.xdesign.messages),
        projectRoot: null,
        sessionId: thread.sessionId,
        imagePath: snapshotPath,
      });
```

(The `snapshotPath` is honored on the Claude path; ignored by the runtime path — non-Claude vision is out of 2a scope.)

- [ ] **Step 2: Replace the cancel call**

Find the cancel handler in this file (search for `ipc.claudeCancel`). Replace `void ipc.claudeCancel(<id>);` with `void dispatchCancel(<id>, useModelPrefs.getState().modelFor("xdesign"));` using the same id expression that was there.

- [ ] **Step 3: Update imports**

Replace:

```ts
import { resolveSendFromStores } from "@/features/agents/resolveSend";
```

with:

```ts
import { dispatchSend, dispatchCancel, toRuntimeHistory } from "@/features/agents/dispatchSend";
```

`useAppChat` is already imported in this file. Remove the `ipc` import only if tsc reports it unused.

- [ ] **Step 4: Gate + commit**

Run: `npx tsc --noEmit 2>&1 | tail -10 && npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -5`
Expected: tsc clean; vitest green; build exit 0.

```bash
git add src/apps/xdesign/XDesignClaudeRail.tsx
git commit -m "feat(runtime): route XDesign rail send/cancel through dispatchSend"
```

---

### Task 14: Wire R.O.S.I.E to `dispatchSend`

**Files:**
- Modify: `src/features/rosie/rosieStore.ts` (the `claudeSend` ~line 436-446; and the cancel path — search for `claudeCancel`)

- [ ] **Step 1: Replace the send call**

In `runSubprocessTurn`, replace:

```ts
        const sid = store.getState().sessionId;
        const r = resolveSendFromStores(useModelPrefs.getState().modelFor("rosie"));
        await ipc.claudeSend(
          chatId,
          fullPrompt,
          null,
          sid && sid.length > 0 ? sid : null,
          null,
          r.model,
          r.systemAppend,
          r.allowedTools,
        );
```

with:

```ts
        const sid = store.getState().sessionId;
        await dispatchSend({
          chatId,
          value: useModelPrefs.getState().modelFor("rosie"),
          prompt: fullPrompt,
          history: toRuntimeHistory(store.getState().messages),
          projectRoot: null,
          sessionId: sid && sid.length > 0 ? sid : null,
          imagePath: null,
        });
```

- [ ] **Step 2: Replace the cancel call**

Search this file for `ipc.claudeCancel`. Replace the call `void ipc.claudeCancel(<id>);` (or `await ipc.claudeCancel(<id>)`) with `void dispatchCancel(<id>, useModelPrefs.getState().modelFor("rosie"));`, preserving the id expression. If there is no `claudeCancel` in this file, skip this step (ROSIE may cancel elsewhere) and note it.

- [ ] **Step 3: Update imports**

Replace:

```ts
import { resolveSendFromStores } from "@/features/agents/resolveSend";
```

with:

```ts
import { dispatchSend, dispatchCancel, toRuntimeHistory } from "@/features/agents/dispatchSend";
```

Keep the `ipc` import (still used for other ROSIE calls); remove only if tsc reports unused.

- [ ] **Step 4: Gate + commit**

Run: `npx tsc --noEmit 2>&1 | tail -10 && npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -5`
Expected: tsc clean; vitest green; build exit 0.

```bash
git add src/features/rosie/rosieStore.ts
git commit -m "feat(runtime): route R.O.S.I.E send/cancel through dispatchSend"
```

---

### Task 15: Make non-Claude provider models selectable + badge updates

**Files:**
- Modify: `src/components/ModelSelect.tsx`
- Modify: `src/features/controlpanel/ProvidersPanel.tsx` (drop/soften the "needs runtime" badge for enabled providers)

- [ ] **Step 1: Enable non-builtin provider models in the dropdown**

In `src/components/ModelSelect.tsx`, replace the providers `optgroup`/`option` block:

```tsx
      {providers.map((p) => (
        <optgroup key={p.id} label={p.builtin ? p.name : `${p.name} — needs runtime`}>
          {p.models.map((m) => (
            <option key={`${p.id}/${m.id}`} value={m.id} disabled={!p.builtin}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
```

with:

```tsx
      {providers
        .filter((p) => p.enabled)
        .map((p) => (
          <optgroup key={p.id} label={p.builtin ? p.name : p.name}>
            {p.models.map((m) => (
              <option key={`${p.id}/${m.id}`} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
```

(Non-Claude models are now selectable + live for chat. Tools still don't run for non-Claude until Phase 2b — that boundary is communicated in the ProvidersPanel, Step 2.)

- [ ] **Step 2: Soften the ProvidersPanel "needs runtime" copy**

Open `src/features/controlpanel/ProvidersPanel.tsx`. Find where non-builtin providers are labeled "needs runtime" (search for `needs runtime`). Replace that badge text with `chat ready · no tools yet` (conveying the accurate 2a state: a non-Claude provider streams chat replies but tools land in 2b). If the panel computes this from `!provider.builtin`, keep that condition — the copy change is the only edit. If `needs runtime` does not appear here, skip and note it.

- [ ] **Step 3: Gate + commit**

Run: `npx tsc --noEmit 2>&1 | tail -10 && npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -5`
Expected: tsc clean; vitest green; build exit 0.

```bash
git add src/components/ModelSelect.tsx src/features/controlpanel/ProvidersPanel.tsx
git commit -m "feat(runtime): make non-Claude provider models selectable; update Control Panel copy"
```

---

## Final verification (all gates)

- [ ] **Run every gate from a clean state:**

```bash
npx tsc --noEmit
npx vitest run
cd src-tauri && cargo test && cargo check && cd ..
npm run build
```

Expected: tsc clean · full vitest green (≈ +20 new tests: 4 provider/dispatch routing + history, OpenAI ~7, Gemini ~6, pricing 3, take_lines 2) · cargo test green (new `runtime::*` tests; the pre-existing `pick_thumbnail` warning is unrelated) · `npm run build` exit 0.

- [ ] **Update the project log:** add a Session-Log entry to `CLAUDE.md` summarizing Phase 2a (runtime module, two adapters, dispatchSend seam, send-site wiring, non-regression test), noting the **`tauri dev` restart requirement** (new Rust module + commands) and that **UI is human-unverified**.

```bash
git add CLAUDE.md
git commit -m "docs: Phase 2a agent runtime session log"
```

---

## User smoke checklist (after a `tauri dev` restart)

Maps to spec §8 success criteria. The agent cannot run Tauri — the user verifies:

1. **OpenAI streaming:** Control Panel → Providers → add an OpenAI provider with a real key → in any chat rail's model dropdown, the provider's models now appear **enabled** (no "needs runtime" disable) → select one → send → a reply streams **token-by-token** in the existing chat UI.
2. **Keyless local:** add an OpenAI-compatible provider with base URL `http://localhost:11434/v1` (Ollama) or LM Studio and **no key** → select a local model → it streams keyless.
3. **Gemini:** add a Google provider (kind `google`) with a Gemini key → select a Gemini model → reply streams.
4. **Agent persona:** forge an agent whose Brain is a non-Claude model + a skill or two → select it → persona/instructions apply (system prompt); replies stream. (Tools do not run — the "no tools yet" copy reflects this.)
5. **Non-regression:** select any Claude model/agent → behaves exactly as Phase 1 (tools, edit Accept/Reject, sessions all intact).
6. **Cancel:** start a long non-Claude reply → hit Stop → it halts.
```
