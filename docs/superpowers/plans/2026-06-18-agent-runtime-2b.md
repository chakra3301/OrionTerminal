# Agent Runtime Phase 2b — Tools + Edit-Review Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the provider-agnostic runtime (OpenAI-compatible + Gemini) tool-calling and edit-review parity, so non-Claude models execute the same Orion tools the Claude path does — including the reviewable `orion_apply_edit`/`orion_write_file` that land in the existing Accept/Reject DiffReview.

**Architecture:** In-process tool bridge. Extract a shared `dispatch_tool()` from the MCP server's inline match; add an in-process `send_ui_action` path (global `AppHandle` + a sync-channel pending map) that emits the same `ui:action` events the subprocess bridge does. The runtime gains a multi-round agentic loop that emits the existing `claude:event` `tool_use`/`tool_result` shapes (zero UI change), dispatching each tool on `spawn_blocking`.

**Tech Stack:** Rust (Tauri 2, reqwest, serde_json, tokio, once_cell, parking_lot) · TypeScript/React (vitest) · spec `docs/superpowers/specs/2026-06-18-agent-runtime-2b-design.md`.

## Global Constraints

- **Branch:** `feat/control-panel-agent-forge` (continues Phase 1 + 2a) — or a `feat/agent-runtime-2b` cut off it. Do NOT run branch-changing git commands inside subagents.
- **Non-regression (test-enforced):** the Claude path stays byte-identical — `dispatchSend` routes Claude → `ipc.claudeSend` with literal built-in tool names; the existing `dispatchSend.routing.test.ts` Claude assertion stays green. The `--mcp-serve` subprocess path is unchanged: `send_ui_action` uses TCP when `app_handle::current()` is `None`; `dispatch_tool` behaves identically to the old inline match.
- **Additive signatures only:** `runtime_send` / `ipc.runtimeSend` gain a new trailing `allowed_tools` param; existing callers/tests updated in the same task that introduces it.
- **Keys stay in Rust** (`provider_keys::read`). Never log or return keys.
- **Pure parsers/translators** (tool-call accumulation, schema translation, grant mapping) are fully unit-tested and network-free.
- **Render parity facts** (do NOT "fix" chatStore/rosieStore — out of scope): `chatStore.onAssistantBlocks` writes one pending message per turn (latest round's blocks win — same as Claude in Orion/Archives/XDesign rails); `rosieStore` segments by `message.id`. Therefore every runtime assistant emit MUST carry a stable per-round `message.id` (same id for all streaming snapshots within a round; new id per round).
- **Gates, every task, real exit codes:** `npx tsc --noEmit` · `npx vitest run` · `cd src-tauri && cargo test && cargo check` · `npm run build`. Never mask exit codes through a pipe.
- **Commit only the files each task names.** A `tauri dev` restart is required before smoke-testing (Rust changes); UI is agent-unverifiable, so tool/edit behavior ends at the user smoke checklist (spec §9).

---

## File Structure

**Rust — `src-tauri/src/`**
- `app_handle.rs` *(new)* — global `OnceCell<AppHandle>` (`set`/`current`) so the in-process bridge can emit events.
- `ui_bridge.rs` *(modify)* — add `PENDING_SYNC` sync-channel map + `dispatch_sync()`; `ui_bridge_respond` resolves both maps.
- `mcp_server.rs` *(modify)* — `pub fn dispatch_tool`, `pub fn tool_definitions`, in-process branch in `send_ui_action`, new `orion_read_file` tool.
- `runtime/provider.rs` *(modify)* — extend `Msg`, add `ToolCall`, `StreamItem::ToolCallDelta`, `ChatRequest.tools`.
- `runtime/tools.rs` *(new)* — `ToolCallAccumulator`, `ToolDef`, `filter_tools`, `openai_tools`, `gemini_tools`.
- `runtime/openai.rs` *(modify)* — parse `delta.tool_calls`, emit tool schemas + tool/assistant messages in `body()`.
- `runtime/gemini.rs` *(modify)* — parse `functionCall`, emit `functionDeclarations` + `functionCall`/`functionResponse` parts.
- `runtime/mod.rs` *(modify)* — agentic loop, `allowed_tools` param, per-round emits, `spawn_blocking` dispatch.
- `lib.rs` *(modify)* — `app_handle::set` + main-process env vars in `setup()`; register `app_handle` module.

**TypeScript — `src/`**
- `features/agents/runtimeTools.ts` *(new)* — pure built-in→Orion grant mapping for the runtime path.
- `features/agents/dispatchSend.ts` *(modify)* — pass mapped `allowed_tools` to `ipc.runtimeSend`.
- `lib/ipc.ts` *(modify)* — `runtimeSend` gains trailing `allowedTools` arg.
- `features/agents/dispatchSend.routing.test.ts` *(modify)* — runtime assertion includes the tools arg.
- `features/controlpanel/*` *(modify)* — drop "no tools yet" badge + Forge hint.

---

## Task 1: Rust runtime types — tool-call data model

**Files:**
- Modify: `src-tauri/src/runtime/provider.rs`
- Modify: `src-tauri/src/runtime/mod.rs` (add a no-op match arm so the loop still compiles)

**Interfaces:**
- Produces: `ToolCall { id: String, name: String, arguments: String }`; `Msg` extended with `tool_calls: Option<Vec<ToolCall>>`, `tool_call_id: Option<String>`, `name: Option<String>` (all `#[serde(default)]`); `StreamItem::ToolCallDelta { index: i64, id: Option<String>, name: Option<String>, args: String }`; `ChatRequest { … tools: Vec<crate::runtime::tools::ToolDef> }`.
- Note: `ChatRequest.tools` references `tools::ToolDef`, created in Task 3. To keep Task 1 self-contained and green, define `ToolDef` minimally in Task 1 inside a new `tools` module stub, then flesh it out in Task 3. (See Step 3.)

- [ ] **Step 1: Write the failing test** — append to the `tests` module in `src-tauri/src/runtime/provider.rs`:

```rust
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test runtime::provider 2>&1 | tail -20`
Expected: compile error / FAIL (`ToolCall` undefined, `Msg` has no `tool_calls`).

- [ ] **Step 3: Implement** — replace the `Msg`, `ChatRequest`, and `StreamItem` definitions at the top of `src-tauri/src/runtime/provider.rs` with:

```rust
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
```

Then create a stub module file `src-tauri/src/runtime/tools.rs` (fleshed out in Task 3):

```rust
//! Runtime toolset: filtering + provider schema formatting + streamed
//! tool-call accumulation. Pure (network-free), unit-tested.

/// One tool exposed to a non-Claude provider.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}
```

Register the module + (no-op for now) keep the loop compiling. In `src-tauri/src/runtime/mod.rs`, add `pub mod tools;` near the other `pub mod` lines, and add a `ToolCallDelta` arm to the `match item` block inside `runtime_send` (the loop is replaced wholesale in Task 9, this just keeps it green meanwhile):

```rust
                                    StreamItem::ToolCallDelta { .. } => {}
```

- [ ] **Step 4: Run tests + gates**

Run: `cd src-tauri && cargo test runtime:: 2>&1 | tail -20 && cargo check 2>&1 | tail -5`
Expected: PASS; check clean.
Run (repo root): `npx tsc --noEmit && npm run build 2>&1 | tail -3`
Expected: exit 0 (no TS touched, but verify the gate harness).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/runtime/provider.rs src-tauri/src/runtime/tools.rs src-tauri/src/runtime/mod.rs
git commit -m "feat(runtime-2b): tool-call data model (ToolCall, Msg tool fields, StreamItem::ToolCallDelta, ToolDef stub)"
```

---

## Task 2: Tool-call accumulator (pure)

**Files:**
- Modify: `src-tauri/src/runtime/tools.rs`

**Interfaces:**
- Consumes: `ToolCall` (Task 1).
- Produces: `ToolCallAccumulator` with `push(index: i64, id: Option<&str>, name: Option<&str>, args_fragment: &str)`, `is_empty() -> bool`, `finish(self) -> Vec<ToolCall>`.

- [ ] **Step 1: Write the failing test** — append to `src-tauri/src/runtime/tools.rs`:

```rust
#[cfg(test)]
mod acc_tests {
    use super::ToolCallAccumulator;

    #[test]
    fn openai_fragments_assemble_by_index() {
        let mut a = ToolCallAccumulator::default();
        a.push(0, Some("call_a"), Some("orion_read_file"), "");
        a.push(0, None, None, "{\"path\":");
        a.push(0, None, None, "\"/x\"}");
        let calls = a.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_a");
        assert_eq!(calls[0].name, "orion_read_file");
        assert_eq!(calls[0].arguments, "{\"path\":\"/x\"}");
    }

    #[test]
    fn two_indices_two_calls() {
        let mut a = ToolCallAccumulator::default();
        a.push(0, Some("c0"), Some("t0"), "{}");
        a.push(1, Some("c1"), Some("t1"), "{}");
        assert_eq!(a.finish().len(), 2);
    }

    #[test]
    fn negative_index_always_new_and_id_synthesized() {
        let mut a = ToolCallAccumulator::default();
        a.push(-1, None, Some("gemini_call"), "{\"a\":1}");
        a.push(-1, None, Some("gemini_call2"), "{\"b\":2}");
        let calls = a.finish();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].id, "call_0");
        assert_eq!(calls[1].id, "call_1");
    }

    #[test]
    fn empty_args_become_empty_object() {
        let mut a = ToolCallAccumulator::default();
        a.push(0, Some("c"), Some("t"), "");
        assert_eq!(a.finish()[0].arguments, "{}");
    }

    #[test]
    fn is_empty_reflects_pushes() {
        let mut a = ToolCallAccumulator::default();
        assert!(a.is_empty());
        a.push(0, Some("c"), Some("t"), "{}");
        assert!(!a.is_empty());
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test runtime::tools::acc 2>&1 | tail -20`
Expected: compile error (`ToolCallAccumulator` undefined).

- [ ] **Step 3: Implement** — add to `src-tauri/src/runtime/tools.rs` (above the test module):

```rust
use crate::runtime::provider::ToolCall;

struct PartialCall {
    index: i64,
    id: Option<String>,
    name: Option<String>,
    args: String,
}

/// Assembles streamed tool-call fragments into complete `ToolCall`s.
/// `index >= 0` merges fragments (OpenAI); `index < 0` always starts a new
/// entry (Gemini, which delivers a whole call per fragment).
#[derive(Default)]
pub struct ToolCallAccumulator {
    calls: Vec<PartialCall>,
}

impl ToolCallAccumulator {
    pub fn push(&mut self, index: i64, id: Option<&str>, name: Option<&str>, args_fragment: &str) {
        let slot = if index >= 0 {
            if let Some(pos) = self.calls.iter().position(|c| c.index == index) {
                &mut self.calls[pos]
            } else {
                self.calls.push(PartialCall { index, id: None, name: None, args: String::new() });
                self.calls.last_mut().unwrap()
            }
        } else {
            self.calls.push(PartialCall { index, id: None, name: None, args: String::new() });
            self.calls.last_mut().unwrap()
        };
        if let Some(i) = id {
            if !i.is_empty() {
                slot.id = Some(i.to_string());
            }
        }
        if let Some(n) = name {
            if !n.is_empty() {
                slot.name = Some(n.to_string());
            }
        }
        slot.args.push_str(args_fragment);
    }

    pub fn is_empty(&self) -> bool {
        self.calls.is_empty()
    }

    pub fn finish(self) -> Vec<ToolCall> {
        self.calls
            .into_iter()
            .enumerate()
            .map(|(i, c)| ToolCall {
                id: c.id.unwrap_or_else(|| format!("call_{}", i)),
                name: c.name.unwrap_or_default(),
                arguments: if c.args.trim().is_empty() { "{}".to_string() } else { c.args },
            })
            .collect()
    }
}
```

- [ ] **Step 4: Run tests + gates**

Run: `cd src-tauri && cargo test runtime::tools::acc 2>&1 | tail -15`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/runtime/tools.rs
git commit -m "feat(runtime-2b): ToolCallAccumulator (pure, fragment assembly)"
```

---

## Task 3: Tool filtering + provider schema formatting (pure)

**Files:**
- Modify: `src-tauri/src/runtime/tools.rs`
- Modify: `src-tauri/src/mcp_server.rs` (make `tool_definitions` public)

**Interfaces:**
- Consumes: `crate::mcp_server::tool_definitions() -> serde_json::Value` (a JSON array of `{ name, description, inputSchema }`).
- Produces: `filter_tools(allowed: &[String]) -> Vec<ToolDef>` (`"mcp__orion"` → all Orion tools; otherwise names that match); `openai_tools(&[ToolDef]) -> serde_json::Value`; `gemini_tools(&[ToolDef]) -> serde_json::Value`.

- [ ] **Step 1: Make `tool_definitions` public** — in `src-tauri/src/mcp_server.rs` line 104 change `fn tool_definitions() -> Value {` to `pub fn tool_definitions() -> Value {`.

- [ ] **Step 2: Write the failing test** — append to `src-tauri/src/runtime/tools.rs`:

```rust
#[cfg(test)]
mod schema_tests {
    use super::{filter_tools, gemini_tools, openai_tools, ToolDef};
    use serde_json::json;

    #[test]
    fn filter_by_name_subset() {
        let got = filter_tools(&["orion_read_file".to_string(), "orion_apply_edit".to_string()]);
        let names: Vec<&str> = got.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"orion_read_file"));
        assert!(names.contains(&"orion_apply_edit"));
        assert!(!names.contains(&"orion_delete_note"));
    }

    #[test]
    fn mcp_orion_means_all() {
        let all = filter_tools(&["mcp__orion".to_string()]);
        // Catalog has 30+ tools; "all" must be much larger than a 1-name filter.
        assert!(all.len() > 10);
        assert!(all.iter().any(|t| t.name == "orion_read_file"));
    }

    #[test]
    fn empty_allowed_means_no_tools() {
        assert!(filter_tools(&[]).is_empty());
    }

    #[test]
    fn openai_shape() {
        let defs = vec![ToolDef {
            name: "t".into(),
            description: "d".into(),
            parameters: json!({"type":"object","properties":{"x":{"type":"string"}},"required":["x"]}),
        }];
        let v = openai_tools(&defs);
        assert_eq!(v[0]["type"], "function");
        assert_eq!(v[0]["function"]["name"], "t");
        assert_eq!(v[0]["function"]["parameters"]["required"][0], "x");
    }

    #[test]
    fn gemini_shape_wraps_declarations() {
        let defs = vec![ToolDef {
            name: "t".into(),
            description: "d".into(),
            parameters: json!({"type":"object","properties":{"x":{"type":"string"}}}),
        }];
        let v = gemini_tools(&defs);
        assert_eq!(v[0]["functionDeclarations"][0]["name"], "t");
    }

    #[test]
    fn gemini_omits_empty_parameters() {
        let defs = vec![ToolDef {
            name: "noargs".into(),
            description: "d".into(),
            parameters: json!({"type":"object","properties":{}}),
        }];
        let v = gemini_tools(&defs);
        assert!(v[0]["functionDeclarations"][0].get("parameters").is_none());
    }
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd src-tauri && cargo test runtime::tools::schema 2>&1 | tail -20`
Expected: compile error (`filter_tools` etc. undefined).

- [ ] **Step 4: Implement** — add to `src-tauri/src/runtime/tools.rs`:

```rust
use serde_json::{json, Value};

/// Build the runtime toolset from the agent's resolved allow-list. The list
/// contains Orion tool names (e.g. "orion_read_file"); the sentinel
/// "mcp__orion" means "expose the entire Orion catalog".
pub fn filter_tools(allowed: &[String]) -> Vec<ToolDef> {
    let defs = crate::mcp_server::tool_definitions();
    let all = allowed.iter().any(|t| t == "mcp__orion");
    let mut out = Vec::new();
    if let Some(arr) = defs.as_array() {
        for d in arr {
            let name = d.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() {
                continue;
            }
            if all || allowed.iter().any(|t| t == name) {
                out.push(ToolDef {
                    name: name.to_string(),
                    description: d.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    parameters: d
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                });
            }
        }
    }
    out
}

/// OpenAI `tools: [{ type:"function", function:{ name, description, parameters } }]`.
pub fn openai_tools(defs: &[ToolDef]) -> Value {
    Value::Array(
        defs.iter()
            .map(|d| {
                json!({
                    "type": "function",
                    "function": {
                        "name": d.name,
                        "description": d.description,
                        "parameters": d.parameters,
                    }
                })
            })
            .collect(),
    )
}

fn params_are_empty(p: &Value) -> bool {
    p.get("properties")
        .and_then(|x| x.as_object())
        .map(|o| o.is_empty())
        .unwrap_or(true)
}

/// Gemini `tools: [{ functionDeclarations: [ { name, description, parameters? } ] }]`.
/// `parameters` is omitted for no-arg tools — some Gemini versions reject an
/// empty `properties` object.
pub fn gemini_tools(defs: &[ToolDef]) -> Value {
    let decls: Vec<Value> = defs
        .iter()
        .map(|d| {
            let mut decl = json!({ "name": d.name, "description": d.description });
            if !params_are_empty(&d.parameters) {
                decl["parameters"] = d.parameters.clone();
            }
            decl
        })
        .collect();
    json!([{ "functionDeclarations": decls }])
}
```

- [ ] **Step 5: Run tests + gates**

Run: `cd src-tauri && cargo test runtime::tools 2>&1 | tail -15 && cargo check 2>&1 | tail -3`
Expected: all PASS; check clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/runtime/tools.rs src-tauri/src/mcp_server.rs
git commit -m "feat(runtime-2b): tool filtering + OpenAI/Gemini schema formatting"
```

---

## Task 4: OpenAI adapter — tool-call parsing + tool-aware body

**Files:**
- Modify: `src-tauri/src/runtime/openai.rs`

**Interfaces:**
- Consumes: `ChatRequest.tools` (Task 1), `StreamItem::ToolCallDelta` (Task 1), `openai_tools` (Task 3), `Msg` tool fields (Task 1).
- Produces: `OpenAi::parse_sse_line` emits `ToolCallDelta`; `OpenAi::body` includes `tools` (when non-empty) and serializes assistant `tool_calls` + `role:"tool"` messages.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module in `src-tauri/src/runtime/openai.rs`:

```rust
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
```

Also update the `req` test helper in that module to set `tools: Vec::new()` (the helper currently builds `ChatRequest` without `tools`). Change it to:

```rust
    fn req(system: &str, msgs: Vec<(&str, &str)>) -> ChatRequest {
        ChatRequest {
            model: "gpt-4o".into(),
            system: system.into(),
            messages: msgs
                .into_iter()
                .map(|(r, c)| Msg { role: r.into(), content: c.into(), tool_calls: None, tool_call_id: None, name: None })
                .collect(),
            tools: Vec::new(),
        }
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test runtime::openai 2>&1 | tail -25`
Expected: compile error / FAIL.

- [ ] **Step 3: Implement** — in `src-tauri/src/runtime/openai.rs`:

Replace `body()` with:

```rust
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
```

In `parse_sse_line`, after the text-delta block and before the usage block, add:

```rust
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
```

- [ ] **Step 4: Run tests + gates**

Run: `cd src-tauri && cargo test runtime::openai 2>&1 | tail -20`
Expected: all PASS (existing 8 + new 3).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/runtime/openai.rs
git commit -m "feat(runtime-2b): OpenAI tool-call parsing + tool-aware body"
```

---

## Task 5: Gemini adapter — functionCall parsing + tool-aware body

**Files:**
- Modify: `src-tauri/src/runtime/gemini.rs`

**Interfaces:**
- Consumes: same as Task 4 plus `gemini_tools` (Task 3).
- Produces: `Gemini::parse_sse_line` emits `ToolCallDelta { index: -1, … }` per `functionCall`; `Gemini::body` includes `tools` + maps assistant `tool_calls` → `functionCall` parts and `role:"tool"` → `functionResponse` parts.

- [ ] **Step 1: Update the `req` helper** in the `tests` module of `src-tauri/src/runtime/gemini.rs` exactly as in Task 4 Step 1 (add `tool_calls/tool_call_id/name: None` to each `Msg` and `tools: Vec::new()` to the `ChatRequest`).

- [ ] **Step 2: Write the failing tests** — append to the `tests` module:

```rust
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd src-tauri && cargo test runtime::gemini 2>&1 | tail -25`
Expected: compile error / FAIL.

- [ ] **Step 4: Implement** — in `src-tauri/src/runtime/gemini.rs`:

Replace `body()` with:

```rust
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
```

In `parse_sse_line`, inside the `if let Some(parts) = …` block, after computing `text`, also scan for function calls. Replace the existing parts-handling block with:

```rust
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
```

- [ ] **Step 5: Run tests + gates**

Run: `cd src-tauri && cargo test runtime::gemini 2>&1 | tail -20 && cargo check 2>&1 | tail -3`
Expected: all PASS (existing 6 + new 3); check clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/runtime/gemini.rs
git commit -m "feat(runtime-2b): Gemini functionCall parsing + functionResponse body"
```

---

## Task 6: Extract shared `dispatch_tool` (non-regression)

**Files:**
- Modify: `src-tauri/src/mcp_server.rs`

**Interfaces:**
- Produces: `pub fn dispatch_tool(name: &str, args: &serde_json::Value) -> Result<String, String>` — the inline match body. `call_tool` calls it and wraps the result.

- [ ] **Step 1: Write the failing test** — in the `tests` module at the bottom of `src-tauri/src/mcp_server.rs` (line ~2317), add:

```rust
    #[test]
    fn dispatch_tool_unknown_name_errors_like_inline_match() {
        let err = super::dispatch_tool("nope_not_a_tool", &serde_json::json!({}));
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("unknown tool"));
    }

    #[test]
    fn call_tool_wraps_dispatch_result_in_envelope() {
        let out = super::call_tool(&serde_json::json!({ "name": "nope", "arguments": {} })).unwrap();
        assert_eq!(out["isError"], true);
        assert!(out["content"][0]["text"].as_str().unwrap().contains("unknown tool"));
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test mcp_server::tests::dispatch 2>&1 | tail -15`
Expected: compile error (`dispatch_tool` undefined).

- [ ] **Step 3: Implement** — in `src-tauri/src/mcp_server.rs`, replace the body of `call_tool` (lines 717–777) so the match becomes a standalone `dispatch_tool` and `call_tool` delegates:

```rust
fn call_tool(params: &Value) -> Result<Value, RpcError> {
    let name = params
        .get("name")
        .and_then(|n| n.as_str())
        .ok_or_else(|| RpcError {
            code: -32602,
            message: "tools/call missing `name`".into(),
        })?;
    let args = params.get("arguments").cloned().unwrap_or(json!({}));

    match dispatch_tool(name, &args) {
        Ok(text) => Ok(json!({
            "content": [{ "type": "text", "text": text }],
            "isError": false,
        })),
        Err(msg) => Ok(json!({
            "content": [{ "type": "text", "text": format!("error: {}", msg) }],
            "isError": true,
        })),
    }
}

/// Shared tool dispatcher. The stdio serve loop (`call_tool`) and the
/// in-process runtime both call this — one implementation, no duplication.
pub fn dispatch_tool(name: &str, args: &Value) -> Result<String, String> {
    match name {
        "orion_list_recent_notes" => tool_list_recent_notes(args),
        "orion_search_archive" => tool_search_archive(args),
        "orion_list_projects" => tool_list_projects(args),
        "orion_create_note" => tool_create_note(args),
        "orion_create_project" => tool_create_project(args),
        "orion_update_note_body" => tool_update_note_body(args),
        "orion_read_note" => tool_read_note(args),
        "orion_open_app" => tool_open_app(args),
        "orion_switch_project" => tool_switch_project(args),
        "orion_open_file" => tool_open_file(args),
        "orion_apply_edit" => tool_apply_edit(args),
        "orion_write_file" => tool_write_file(args),
        "orion_get_context" => tool_get_context(args),
        "orion_search_files" => tool_search_files(args),
        "orion_list_assets" => tool_list_assets(args),
        "orion_search_assets" => tool_search_assets(args),
        "orion_run_in_terminal" => tool_run_in_terminal(args),
        "orion_xdesign_add_rect" => tool_xdesign_add_rect(args),
        "orion_xdesign_add_text" => tool_xdesign_add_text(args),
        "orion_xdesign_add_ellipse" => tool_xdesign_add_ellipse(args),
        "orion_xdesign_add_frame" => tool_xdesign_add_frame(args),
        "orion_xdesign_get_canvas" => tool_xdesign_get_canvas(args),
        "orion_xdesign_get_selection" => tool_xdesign_get_selection(args),
        "orion_xdesign_apply" => tool_xdesign_apply(args),
        "orion_create_mood_board" => tool_create_mood_board(args),
        "orion_add_to_mood_board" => tool_add_to_mood_board(args),
        "orion_attach_tag" => tool_attach_tag(args),
        "orion_delete_note" => tool_delete_note(args),
        "orion_hermes_list_tasks" => tool_hermes_list_tasks(args),
        "orion_hermes_get_task" => tool_hermes_get_task(args),
        "orion_hermes_create_task" => tool_hermes_create_task(args),
        "orion_hermes_add_agent" => tool_hermes_add_agent(args),
        "orion_hermes_update_task" => tool_hermes_update_task(args),
        "orion_hermes_move_task" => tool_hermes_move_task(args),
        "orion_hermes_decompose" => tool_hermes_decompose(args),
        "orion_recent_activity" => tool_recent_activity(args),
        other => Err(format!("unknown tool: {}", other)),
    }
}
```

Note: if `call_tool` is currently private and the new test calls `super::call_tool`, that works from the in-file `tests` module regardless of visibility.

- [ ] **Step 4: Run tests + gates**

Run: `cd src-tauri && cargo test mcp_server 2>&1 | tail -15 && cargo check 2>&1 | tail -3`
Expected: PASS; check clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mcp_server.rs
git commit -m "refactor(mcp): extract shared pub dispatch_tool (non-regression, call_tool delegates)"
```

---

## Task 7: New `orion_read_file` tool

**Files:**
- Modify: `src-tauri/src/mcp_server.rs`

**Interfaces:**
- Produces: `tool_read_file(args: &Value) -> Result<String, String>` (reads a file, abs or project-relative, 64 KB char-cap, read-only); registered in `tool_definitions()` + `dispatch_tool`.

- [ ] **Step 1: Write the failing test** — in the `tests` module of `src-tauri/src/mcp_server.rs`, add (uses a temp file; no project context needed because the path is absolute):

```rust
    #[test]
    fn read_file_returns_contents_and_errors_on_missing() {
        let dir = std::env::temp_dir();
        let p = dir.join("orion_read_file_test.txt");
        std::fs::write(&p, "hello world").unwrap();
        let ok = super::tool_read_file(&serde_json::json!({ "path": p.to_string_lossy() })).unwrap();
        assert!(ok.contains("hello world"));
        let _ = std::fs::remove_file(&p);

        let missing = super::tool_read_file(&serde_json::json!({ "path": "/no/such/orion/file.xyz" }));
        assert!(missing.is_err());
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test mcp_server::tests::read_file 2>&1 | tail -15`
Expected: compile error (`tool_read_file` undefined).

- [ ] **Step 3: Implement** — add the handler near `tool_write_file` in `src-tauri/src/mcp_server.rs`:

```rust
/// Read a file's contents (absolute or project-relative). Read-only,
/// char-capped at 64 KB so a large file can't blow the model's context.
fn tool_read_file(args: &Value) -> Result<String, String> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "path required".to_string())?
        .trim();
    if path.is_empty() {
        return Err("path cannot be blank".to_string());
    }
    let abs = resolve_path(path)?;
    let body = std::fs::read_to_string(&abs)
        .map_err(|e| format!("read {}: {}", abs.display(), e))?;
    let truncated = body.chars().count() > 65536;
    let body: String = if truncated {
        body.chars().take(65536).collect::<String>() + "\n…[truncated]"
    } else {
        body
    };
    Ok(body)
}
```

Add the dispatch arm in `dispatch_tool` (right after `"orion_write_file" => tool_write_file(args),`):

```rust
        "orion_read_file" => tool_read_file(args),
```

Add the tool definition inside `tool_definitions()` — insert this object right after the `orion_write_file` definition object (before `orion_get_context`):

```rust
        {
            "name": "orion_read_file",
            "description": "Read the full contents of a file in the user's \
                project (absolute path or relative to the active project \
                root). Read-only; capped at 64 KB. Use before editing a file \
                with orion_apply_edit so old_string matches exactly.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"]
            }
        },
```

- [ ] **Step 4: Run tests + gates**

Run: `cd src-tauri && cargo test mcp_server 2>&1 | tail -15 && cargo check 2>&1 | tail -3`
Expected: PASS; check clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mcp_server.rs
git commit -m "feat(mcp): orion_read_file tool (read-only, 64KB cap)"
```

---

## Task 8: `app_handle` module + in-process bridge sync channel

**Files:**
- Create: `src-tauri/src/app_handle.rs`
- Modify: `src-tauri/src/ui_bridge.rs`
- Modify: `src-tauri/src/lib.rs` (register module)

**Interfaces:**
- Produces: `app_handle::set(AppHandle)`, `app_handle::current() -> Option<AppHandle>`; `ui_bridge::dispatch_sync(app: &AppHandle, kind: &str, payload: Value) -> Result<Value, String>`; `ui_bridge_respond` resolves both `PENDING` (tokio oneshot, TCP) and `PENDING_SYNC` (std mpsc, in-process).

- [ ] **Step 1: Write the failing test** — append to `src-tauri/src/ui_bridge.rs` a `tests` module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn respond_resolves_sync_pending_map() {
        let (tx, rx) = mpsc::channel::<BridgeResult>();
        PENDING_SYNC.lock().insert("req-sync-test".to_string(), tx);
        ui_bridge_respond(
            "req-sync-test".to_string(),
            true,
            Some(serde_json::json!({ "ok": 1 })),
            None,
        );
        let got = rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        assert!(got.ok);
        assert_eq!(got.data.unwrap()["ok"], 1);
    }

    #[test]
    fn respond_unknown_id_is_noop() {
        // Must not panic when the id is in neither map.
        ui_bridge_respond("nope".to_string(), true, None, None);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test ui_bridge 2>&1 | tail -15`
Expected: compile error (`PENDING_SYNC` undefined).

- [ ] **Step 3: Implement**

Create `src-tauri/src/app_handle.rs`:

```rust
//! Process-global handle to the running Tauri app, set once at startup so
//! in-process callers (the runtime's tool dispatch) can emit `ui:action`
//! events without the TCP bridge. The `--mcp-serve` subprocess never sets
//! this, so `current()` returns `None` there and callers fall back to TCP.

use once_cell::sync::OnceCell;
use tauri::AppHandle;

static APP: OnceCell<AppHandle> = OnceCell::new();

pub fn set(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn current() -> Option<AppHandle> {
    APP.get().cloned()
}
```

In `src-tauri/src/lib.rs`, add the module declaration near the top (with the other `mod` lines, before `mod asset;`):

```rust
mod app_handle;
```

In `src-tauri/src/ui_bridge.rs`:

Add a `std::sync::mpsc` pending map next to `PENDING` (after line 39):

```rust
/// In-process equivalent of `PENDING`: the runtime's `dispatch_sync` blocks a
/// `spawn_blocking` thread on a std sync channel (not a tokio oneshot) because
/// it runs synchronously. `ui_bridge_respond` resolves whichever map holds the
/// request id.
static PENDING_SYNC: Lazy<Mutex<HashMap<String, std::sync::mpsc::Sender<BridgeResult>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
```

Add `dispatch_sync` (place after `start`):

```rust
/// Emit a `ui:action` event and block (synchronously) for the frontend's
/// `ui_bridge_respond`. Used by the in-process runtime tool dispatch, which
/// runs on `spawn_blocking`. Same 5s bound + request shape as the TCP path.
pub fn dispatch_sync(app: &AppHandle, kind: &str, payload: Value) -> Result<Value, String> {
    use serde_json::json;
    let request_id = format!("req-{}", REQ_COUNTER.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = std::sync::mpsc::channel::<BridgeResult>();
    PENDING_SYNC.lock().insert(request_id.clone(), tx);

    let emitted = app.emit(
        "ui:action",
        UiActionEvent {
            kind: kind.to_string(),
            payload,
            request_id: request_id.clone(),
        },
    );
    if emitted.is_err() {
        PENDING_SYNC.lock().remove(&request_id);
        return Err("failed to emit ui:action".into());
    }

    match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(result) => {
            if result.ok {
                Ok(result.data.unwrap_or_else(|| json!({})))
            } else {
                Err(result.error.unwrap_or_else(|| "ui action failed".into()))
            }
        }
        Err(_) => {
            PENDING_SYNC.lock().remove(&request_id);
            Err("ui action timed out (is the target app open?)".into())
        }
    }
}
```

Replace `ui_bridge_respond` so it resolves both maps:

```rust
#[tauri::command]
pub fn ui_bridge_respond(
    request_id: String,
    ok: bool,
    data: Option<Value>,
    error: Option<String>,
) {
    let result = BridgeResult { ok, data, error };
    if let Some(tx) = PENDING.lock().remove(&request_id) {
        let _ = tx.send(result);
        return;
    }
    if let Some(tx) = PENDING_SYNC.lock().remove(&request_id) {
        let _ = tx.send(result);
    }
}
```

(`BridgeResult` already derives `Clone`; the single-send-per-id design means no clone is needed here.)

- [ ] **Step 4: Run tests + gates**

Run: `cd src-tauri && cargo test ui_bridge 2>&1 | tail -15 && cargo check 2>&1 | tail -3`
Expected: 2 PASS; check clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/app_handle.rs src-tauri/src/ui_bridge.rs src-tauri/src/lib.rs
git commit -m "feat(runtime-2b): app_handle global + in-process ui_bridge dispatch_sync (both pending maps)"
```

---

## Task 9: `send_ui_action` in-process branch + main-process env setup

**Files:**
- Modify: `src-tauri/src/mcp_server.rs` (`send_ui_action`)
- Modify: `src-tauri/src/lib.rs` (`setup` closure)

**Interfaces:**
- Consumes: `app_handle::current` + `ui_bridge::dispatch_sync` (Task 8).
- Produces: `send_ui_action` uses the in-process path when `app_handle::current()` is `Some`, else the unchanged TCP path. The main process exports `ORION_DB_PATH`/`ORION_CONTEXT_PATH` so in-process tool handlers can open the DB / read context.

- [ ] **Step 1: Write the failing test** — in the `tests` module of `src-tauri/src/mcp_server.rs`, assert the subprocess (no app handle, no bridge env) path is unchanged:

```rust
    #[test]
    fn send_ui_action_without_handle_or_env_reports_bridge_unavailable() {
        // No app_handle set (test bin) and clear bridge env → TCP path,
        // which must surface the "not set" error exactly as before.
        std::env::remove_var("ORION_BRIDGE_PORT");
        let err = super::send_ui_action("open_app", serde_json::json!({})).unwrap_err();
        assert!(err.contains("ORION_BRIDGE_PORT not set"));
    }
```

- [ ] **Step 2: Run it to verify it fails or passes-trivially** — before the change this passes (TCP path already returns that error). That's fine: this test is a **non-regression guard** for the `None` branch. Run it to confirm green now, then keep it green after Step 3.

Run: `cd src-tauri && cargo test mcp_server::tests::send_ui_action 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 3: Implement** — in `src-tauri/src/mcp_server.rs`, change the top of `send_ui_action` (line 1882) to branch on the app handle before the TCP code:

```rust
fn send_ui_action(kind: &str, payload: Value) -> Result<Value, String> {
    // In the main process (runtime tool dispatch) the app handle is set, so
    // we emit directly and block on the in-process channel. The `--mcp-serve`
    // subprocess never sets it, so it falls through to the TCP path below
    // (byte-identical to before).
    if let Some(app) = crate::app_handle::current() {
        return crate::ui_bridge::dispatch_sync(&app, kind, payload);
    }

    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpStream;
    use std::time::Duration;
    // … rest of the existing TCP body unchanged …
```

In `src-tauri/src/lib.rs`, add `use tauri::Manager;` near the top imports (after `use tauri_plugin_sql::…;`), then extend the `setup` closure (after `repolens_website::reconcile_on_boot(&app.handle());`, before the bridge spawn):

```rust
            // Make the runtime's in-process tool dispatch self-sufficient:
            // record the app handle so send_ui_action can emit directly, and
            // export the same paths the MCP subprocess gets via its config so
            // in-process tool handlers can open the DB / read context.
            crate::app_handle::set(app.handle().clone());
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&dir);
                std::env::set_var("ORION_DB_PATH", dir.join("orion.db"));
                std::env::set_var("ORION_CONTEXT_PATH", dir.join("orion-context.json"));
            }
```

(Edition 2021 → `std::env::set_var` is safe. This runs once at startup before any tool can fire.)

- [ ] **Step 4: Run tests + gates**

Run: `cd src-tauri && cargo test mcp_server 2>&1 | tail -15 && cargo check 2>&1 | tail -3`
Expected: PASS; check clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mcp_server.rs src-tauri/src/lib.rs
git commit -m "feat(runtime-2b): in-process send_ui_action branch + main-process DB/context env"
```

---

## Task 10: Agentic tool-call loop in `runtime_send`

**Files:**
- Modify: `src-tauri/src/runtime/mod.rs`

**Interfaces:**
- Consumes: everything from Tasks 1–9 (`tools::filter_tools`, `ToolCallAccumulator`, `dispatch_tool`, `Msg` tool fields, `StreamItem::ToolCallDelta`).
- Produces: `runtime_send` gains a trailing `allowed_tools: Vec<String>` param; runs a multi-round loop (max 24 rounds) that streams text, accumulates tool calls, emits `claude:event` assistant `tool_use` blocks + `user` `tool_result` blocks (each round under a stable `message.id`), dispatches each tool on `spawn_blocking`, and ends with `result` + `claude:exit`.

- [ ] **Step 1: Write the failing test** — append to the `tests` module in `src-tauri/src/runtime/mod.rs` (pure helpers that build the emitted JSON shapes; the async loop itself is verified at smoke test):

```rust
    use super::{tool_result_event, tool_use_blocks};
    use crate::runtime::provider::ToolCall;

    #[test]
    fn tool_use_blocks_shape() {
        let calls = vec![ToolCall {
            id: "call_0".into(),
            name: "orion_read_file".into(),
            arguments: "{\"path\":\"/x\"}".into(),
        }];
        let v = tool_use_blocks("here goes", &calls);
        assert_eq!(v[0]["type"], "text");
        assert_eq!(v[0]["text"], "here goes");
        assert_eq!(v[1]["type"], "tool_use");
        assert_eq!(v[1]["id"], "call_0");
        assert_eq!(v[1]["name"], "orion_read_file");
        assert_eq!(v[1]["input"]["path"], "/x");
    }

    #[test]
    fn tool_use_blocks_omits_empty_text() {
        let calls = vec![ToolCall { id: "c".into(), name: "t".into(), arguments: "{}".into() }];
        let v = tool_use_blocks("", &calls);
        assert_eq!(v[0]["type"], "tool_use");
    }

    #[test]
    fn tool_result_event_shape() {
        let v = tool_result_event("call_0", "file body", false);
        assert_eq!(v["type"], "user");
        assert_eq!(v["message"]["content"][0]["type"], "tool_result");
        assert_eq!(v["message"]["content"][0]["tool_use_id"], "call_0");
        assert_eq!(v["message"]["content"][0]["content"], "file body");
        assert_eq!(v["message"]["content"][0]["is_error"], false);
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test runtime::tests 2>&1 | tail -20`
Expected: compile error (`tool_use_blocks` / `tool_result_event` undefined).

- [ ] **Step 3: Implement** — in `src-tauri/src/runtime/mod.rs`:

Add the pure helpers (near `emit_assistant`):

```rust
/// Build the assistant content blocks for a round that ended with tool calls:
/// an optional leading text block, then one `tool_use` block per call. `input`
/// is the parsed arguments object (empty object on parse failure).
fn tool_use_blocks(text: &str, calls: &[provider::ToolCall]) -> serde_json::Value {
    let mut blocks: Vec<serde_json::Value> = Vec::new();
    if !text.trim().is_empty() {
        blocks.push(serde_json::json!({ "type": "text", "text": text }));
    }
    for c in calls {
        let input: serde_json::Value =
            serde_json::from_str(&c.arguments).unwrap_or_else(|_| serde_json::json!({}));
        blocks.push(serde_json::json!({
            "type": "tool_use",
            "id": c.id,
            "name": c.name,
            "input": input,
        }));
    }
    serde_json::Value::Array(blocks)
}

/// Build the `user` event carrying one `tool_result` (Claude shape).
fn tool_result_event(tool_use_id: &str, content: &str, is_error: bool) -> serde_json::Value {
    serde_json::json!({
        "type": "user",
        "message": { "content": [{
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": content,
            "is_error": is_error,
        }]}
    })
}
```

Add an id-carrying assistant snapshot emitter + the blocks/tool-result emitters:

```rust
fn emit_assistant_round(app: &AppHandle, chat_id: &str, msg_id: &str, content: serde_json::Value) {
    let _ = app.emit(
        "claude:event",
        EventPayload {
            chat_id: chat_id.to_string(),
            event: serde_json::json!({
                "type": "assistant",
                "message": { "id": msg_id, "content": content }
            }),
        },
    );
}

fn emit_event(app: &AppHandle, chat_id: &str, event: serde_json::Value) {
    let _ = app.emit(
        "claude:event",
        EventPayload { chat_id: chat_id.to_string(), event },
    );
}
```

Replace `runtime_send` (signature + body) with the agentic loop. Note the new trailing param and `use` of the new types:

```rust
use provider::{make_provider, ChatRequest, Msg, StreamItem, ToolCall};

const MAX_ROUNDS: usize = 24;

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
    allowed_tools: Vec<String>,
) -> Result<(), String> {
    let key = crate::provider_keys::read(&key_ref).unwrap_or_default();
    let prov = make_provider(&provider_kind);
    let url = prov.endpoint(&base_url, &model);
    let tools = crate::runtime::tools::filter_tools(&allowed_tools);

    let cancel = Arc::new(Notify::new());
    STREAMS.lock().insert(chat_id.clone(), cancel.clone());

    let client = reqwest::Client::new();
    let mut working: Vec<Msg> = history;
    let mut total_in: u64 = 0;
    let mut total_out: u64 = 0;
    let mut had_usage = false;

    'rounds: for round in 0..MAX_ROUNDS {
        let req = ChatRequest {
            model: model.clone(),
            system: system.clone(),
            messages: working.clone(),
            tools: tools.clone(),
        };
        let body = prov.body(&req);
        let msg_id = format!("rt-{}-{}", chat_id, round);

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
        let mut acc_tools = crate::runtime::tools::ToolCallAccumulator::default();
        let mut cancelled = false;
        let mut errored: Option<String> = None;

        loop {
            tokio::select! {
                _ = cancel.notified() => { cancelled = true; break; }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            buf.extend_from_slice(&bytes);
                            for line in take_lines(&mut buf) {
                                for item in prov.parse_sse_line(&line) {
                                    match item {
                                        StreamItem::TextDelta(t) => {
                                            acc.push_str(&t);
                                            emit_assistant_round(
                                                &app, &chat_id, &msg_id,
                                                serde_json::json!([{ "type": "text", "text": acc }]),
                                            );
                                        }
                                        StreamItem::ToolCallDelta { index, id, name, args } => {
                                            acc_tools.push(index, id.as_deref(), name.as_deref(), &args);
                                        }
                                        StreamItem::Usage { in_tokens, out_tokens } => {
                                            total_in += in_tokens;
                                            total_out += out_tokens;
                                            had_usage = true;
                                        }
                                        StreamItem::Done => {}
                                    }
                                }
                            }
                        }
                        Some(Err(e)) => { errored = Some(e.to_string()); break; }
                        None => break,
                    }
                }
            }
        }

        if cancelled {
            break 'rounds;
        }
        if let Some(e) = errored {
            STREAMS.lock().remove(&chat_id);
            emit_error_exit(&app, &chat_id, &e);
            return Err(e);
        }

        if acc_tools.is_empty() {
            // No tools this round → the accumulated text is the final answer.
            break 'rounds;
        }

        // Tool round: surface the tool_use blocks, run each tool, surface
        // results, and append both to the working history for the next round.
        let calls = acc_tools.finish();
        emit_assistant_round(&app, &chat_id, &msg_id, tool_use_blocks(&acc, &calls));
        working.push(Msg {
            role: "assistant".into(),
            content: acc.clone(),
            tool_calls: Some(calls.clone()),
            tool_call_id: None,
            name: None,
        });

        for c in &calls {
            let name = c.name.clone();
            let args: serde_json::Value =
                serde_json::from_str(&c.arguments).unwrap_or_else(|_| serde_json::json!({}));
            let dispatched = tokio::task::spawn_blocking(move || {
                crate::mcp_server::dispatch_tool(&name, &args)
            })
            .await
            .unwrap_or_else(|e| Err(format!("tool task panicked: {}", e)));

            let (content, is_error) = match dispatched {
                Ok(text) => (text, false),
                Err(msg) => (format!("error: {}", msg), true),
            };
            emit_event(&app, &chat_id, tool_result_event(&c.id, &content, is_error));
            working.push(Msg {
                role: "tool".into(),
                content,
                tool_calls: None,
                tool_call_id: Some(c.id.clone()),
                name: Some(c.name.clone()),
            });
        }
        // loop to next round
    }

    STREAMS.lock().remove(&chat_id);

    let cost = if had_usage {
        pricing::estimate_cost(&provider_kind, &model, total_in, total_out)
    } else {
        0.0
    };
    emit_event(
        &app,
        &chat_id,
        serde_json::json!({
            "type": "result",
            "total_cost_usd": cost,
            "session_id": serde_json::Value::Null
        }),
    );
    let _ = app.emit(
        "claude:exit",
        ExitPayload { chat_id, code: Some(0), error: None },
    );
    Ok(())
}
```

Remove the temporary no-op `StreamItem::ToolCallDelta { .. } => {}` arm added in Task 1 (it's now handled in the loop above). The old single-shot `emit_assistant` helper may be left in place (unused) or removed — remove it to avoid a dead-code warning if Rust flags it.

- [ ] **Step 4: Run tests + gates**

Run: `cd src-tauri && cargo test runtime 2>&1 | tail -20 && cargo check 2>&1 | tail -5`
Expected: PASS; check clean (no unused-import/dead-code errors).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/runtime/mod.rs
git commit -m "feat(runtime-2b): agentic tool-call loop (allowed_tools, per-round message id, spawn_blocking dispatch)"
```

---

## Task 11: Frontend grant mapping (built-in → Orion runtime tools)

**Files:**
- Create: `src/features/agents/runtimeTools.ts`
- Create: `src/features/agents/runtimeTools.test.ts`

**Interfaces:**
- Produces: `mapToRuntimeTools(allowedTools: string[] | null): string[]` — built-in `Edit`/`Write`/`Read`/`Grep`/`Glob` → Orion tool names; `Bash`/`WebSearch` dropped; `mcp__orion` kept verbatim; any `orion_*` kept; other `mcp__*` dropped.

- [ ] **Step 1: Write the failing test** — `src/features/agents/runtimeTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapToRuntimeTools } from "./runtimeTools";

describe("mapToRuntimeTools", () => {
  it("maps built-in edit grants to Orion tools", () => {
    const out = mapToRuntimeTools(["Edit", "Write", "Read", "Grep", "Glob"]);
    expect(out).toContain("orion_apply_edit");
    expect(out).toContain("orion_write_file");
    expect(out).toContain("orion_read_file");
    expect(out).toContain("orion_search_files");
  });

  it("drops Bash and WebSearch", () => {
    const out = mapToRuntimeTools(["Bash", "WebSearch", "Read"]);
    expect(out).toEqual(["orion_read_file"]);
  });

  it("keeps mcp__orion verbatim and drops other mcp servers", () => {
    const out = mapToRuntimeTools(["mcp__orion", "mcp__other"]);
    expect(out).toEqual(["mcp__orion"]);
  });

  it("keeps explicit orion_* tool names", () => {
    expect(mapToRuntimeTools(["orion_create_note"])).toEqual(["orion_create_note"]);
  });

  it("null or empty → empty list", () => {
    expect(mapToRuntimeTools(null)).toEqual([]);
    expect(mapToRuntimeTools([])).toEqual([]);
  });

  it("dedupes (Grep+Glob both → orion_search_files once)", () => {
    expect(mapToRuntimeTools(["Grep", "Glob"])).toEqual(["orion_search_files"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/agents/runtimeTools.test.ts 2>&1 | tail -20`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/features/agents/runtimeTools.ts`:

```ts
/**
 * Translate an agent's composed allow-list (Claude built-in names + `mcp__*`
 * refs) into the Orion tool names the provider-agnostic runtime exposes.
 * Runtime path only — the Claude path keeps passing literal built-in names.
 */
const BUILTIN_TO_ORION: Record<string, string[]> = {
  Edit: ["orion_apply_edit"],
  Write: ["orion_write_file"],
  Read: ["orion_read_file"],
  Grep: ["orion_search_files"],
  Glob: ["orion_search_files"],
  // Bash, WebSearch: intentionally omitted (deferred — instructions still apply).
};

export function mapToRuntimeTools(allowedTools: string[] | null): string[] {
  if (!allowedTools) return [];
  const out = new Set<string>();
  for (const t of allowedTools) {
    if (t === "mcp__orion") {
      out.add("mcp__orion");
      continue;
    }
    if (t.startsWith("mcp__")) continue; // non-Orion MCP not dispatched in-process
    if (t.startsWith("orion_")) {
      out.add(t);
      continue;
    }
    const mapped = BUILTIN_TO_ORION[t];
    if (mapped) mapped.forEach((m) => out.add(m));
  }
  return [...out];
}
```

- [ ] **Step 4: Run tests + gates**

Run: `npx vitest run src/features/agents/runtimeTools.test.ts 2>&1 | tail -15 && npx tsc --noEmit 2>&1 | tail -5`
Expected: 6 PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/runtimeTools.ts src/features/agents/runtimeTools.test.ts
git commit -m "feat(runtime-2b): pure built-in→Orion runtime tool mapping"
```

---

## Task 12: Wire tools through `ipc.runtimeSend` + `dispatchSend` + routing test

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/features/agents/dispatchSend.ts`
- Modify: `src/features/agents/dispatchSend.routing.test.ts`

**Interfaces:**
- Consumes: `mapToRuntimeTools` (Task 11), `runtime_send`'s new `allowed_tools` param (Task 10).
- Produces: `ipc.runtimeSend(..., allowedTools: string[])`; `dispatchSend` passes `mapToRuntimeTools(r.allowedTools)`.

- [ ] **Step 1: Update the routing test** — in `src/features/agents/dispatchSend.routing.test.ts`, change the provider-model assertion to expect the trailing tools array (a bare `gpt-4o` model selection has no agent/skills → empty tools):

```ts
    expect(ipc.runtimeSend).toHaveBeenCalledWith(
      "c2",
      "openai",
      "https://api.openai.com/v1",
      "p1",
      "gpt-4o",
      "",
      [{ role: "user", content: "hi" }],
      [],
    );
```

(The Claude assertion stays byte-identical — do not change it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/agents/dispatchSend.routing.test.ts 2>&1 | tail -20`
Expected: FAIL (runtimeSend called with 7 args, expected 8).

- [ ] **Step 3: Implement**

In `src/lib/ipc.ts`, extend `runtimeSend` (lines 187–204):

```ts
  runtimeSend: (
    chatId: string,
    providerKind: string,
    baseUrl: string,
    keyRef: string,
    model: string,
    system: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    allowedTools: string[],
  ): Promise<void> =>
    invoke("runtime_send", {
      chatId,
      providerKind,
      baseUrl,
      keyRef,
      model,
      system,
      history,
      allowedTools,
    }),
```

In `src/features/agents/dispatchSend.ts`, import the mapper and pass it:

```ts
import { mapToRuntimeTools } from "@/features/agents/runtimeTools";
```

Change the `ipc.runtimeSend(...)` call in `dispatchSend`:

```ts
  return ipc.runtimeSend(
    args.chatId,
    route.kind,
    route.baseUrl,
    route.keyRef,
    r.model,
    r.systemAppend ?? "",
    args.history,
    mapToRuntimeTools(r.allowedTools),
  );
```

- [ ] **Step 4: Run tests + gates**

Run: `npx vitest run src/features/agents 2>&1 | tail -20 && npx tsc --noEmit 2>&1 | tail -5 && npm run build 2>&1 | tail -3`
Expected: routing + all agents tests PASS; tsc clean; build exit 0.

- [ ] **Step 5: Run the FULL Rust + JS gate (the Rust signature change must line up with the IPC change)**

Run: `cd src-tauri && cargo test 2>&1 | tail -5 && cargo check 2>&1 | tail -3`
Expected: PASS; check clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ipc.ts src/features/agents/dispatchSend.ts src/features/agents/dispatchSend.routing.test.ts
git commit -m "feat(runtime-2b): pass mapped allowed_tools through ipc.runtimeSend + dispatchSend"
```

---

## Task 13: Retire the "no tools yet" badge + Forge hint

**Files:**
- Modify: `src/features/controlpanel/*` (the provider badge + Agent Forge hint — locate with grep)

**Interfaces:**
- Produces: non-Claude providers no longer show "no tools yet" / "chat ready · no tools yet"; the Forge "tools run after the next engine update" hint is removed.

- [ ] **Step 1: Locate the copy**

Run: `grep -rn "no tools yet\|chat ready\|next engine update\|needs runtime" src/features/controlpanel src/features/agents 2>/dev/null`
Expected: one or more matches (the 2a badge text + Forge hint).

- [ ] **Step 2: Edit the copy** — for each match:
  - A provider/runtime badge reading `"chat ready · no tools yet"` (or similar) → change to `"chat ready"`.
  - Any Forge hint sentence about tools arriving "after the next engine update" / "tools run after…" → delete that sentence/line.
  - Leave the `"needs runtime"` badge for **non-enabled** providers as-is if it gates on enablement (that's a separate state); only remove the *tools-not-supported* messaging. Use judgement per the surrounding code; the goal (spec §9.6) is that nothing claims non-Claude agents lack tools.

- [ ] **Step 3: Gates** (UI is agent-unverifiable; rely on type+build)

Run: `npx tsc --noEmit 2>&1 | tail -5 && npx vitest run 2>&1 | tail -5 && npm run build 2>&1 | tail -3`
Expected: tsc clean; full vitest green; build exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/controlpanel
git commit -m "feat(runtime-2b): retire 'no tools yet' badge + Forge tools hint"
```

---

## Final verification (all gates, real exit codes)

- [ ] **Run the complete gate suite from repo root:**

```bash
npx tsc --noEmit && echo "TSC_OK"
npx vitest run 2>&1 | tail -5
( cd src-tauri && cargo test 2>&1 | tail -5 && cargo check 2>&1 | tail -3 )
npm run build 2>&1 | tail -3
```
Expected: `TSC_OK`; vitest all pass (≈ +6 frontend tests: runtimeTools + the updated routing test); cargo all pass (≈ +20 runtime/tools/mcp/ui_bridge tests); build exit 0.

- [ ] **Confirm non-regression assertions are still green:**
  - `dispatchSend.routing.test.ts` — Claude path calls `claudeSend` byte-identically; provider path calls `runtimeSend` with the tools array; cancel routes correctly.
  - `mcp_server` `dispatch_tool` parity + `call_tool` envelope tests.
  - `send_ui_action` `None`-branch (subprocess) test still reports `ORION_BRIDGE_PORT not set`.

---

## User smoke checklist (after `tauri dev` restart — spec §9)

Hand this to the user; the agent cannot run Tauri.

1. **Restart `tauri dev`** (new Rust modules + `runtime_send` signature + env setup).
2. Control Panel → add an OpenAI provider (real key) → forge an agent with the **Edit/Write/Read** skill grants, brain = an OpenAI model.
3. In the Orion rail, select that agent → ask it to **read a file** → confirm an `orion_read_file` tool step streams live in the chat.
4. Ask it to **make an edit** → confirm the change lands in the **same Accept/Reject DiffReview** as Claude's edits; Accept keeps it, Reject reverts.
5. Confirm tool_use + tool_result steps stream live during the turn.
6. Drive a non-edit tool (e.g. "create a note titled X") → confirm it takes effect.
7. Select a **Claude** model/agent → confirm tools, edits, and sessions behave exactly as before (non-regression).
8. Confirm the Claude Code tab / `--mcp-serve` subprocess tools still work (open the Claude Code tab, run an Orion tool).
9. Confirm the "no tools yet" badge / Forge hint is gone.

---

## Self-Review notes (author check against spec)

- **§2.1 shared dispatcher** → Task 6. **§2.2 in-process send_ui_action** → Tasks 8–9 (OnceCell app handle, PENDING_SYNC, both maps, spawn_blocking in Task 10). **§3 agentic loop + event shapes** → Task 10 (assistant `tool_use`, user `tool_result`, result+exit, MAX_ROUNDS). **§4 schemas + accumulation** → Tasks 2–5. **§5 toolset + read tool + grant map** → Tasks 7 (read_file) + 11 (grant map). **§6 Msg multi-round** → Task 1. **§7 frontend wiring** → Tasks 11–13. **§8 tests + non-regression** → covered per task + final verification. **§9 success criteria** → smoke checklist. **§10 deferrals** (WebSearch/Bash/Phase-3 routing) → not in scope, grant map drops Bash/WebSearch.
- **Type consistency check:** `ToolDef`/`ToolCall`/`StreamItem::ToolCallDelta`/`Msg` fields are defined in Task 1 and used verbatim in Tasks 2–10; `filter_tools`/`openai_tools`/`gemini_tools` names match between Task 3 and Tasks 4–5/10; `mapToRuntimeTools` matches between Task 11 and 12; `runtime_send` trailing `allowed_tools` (Rust) ↔ `allowedTools` (ipc) ↔ `mapToRuntimeTools(r.allowedTools)` (dispatchSend) line up.
- **Known render parity (documented, not a bug):** in Orion/Archives/XDesign rails (`chatStore`) intermediate tool rounds are replaced by later rounds (one pending message per turn) — identical to Claude there; ROSIE keeps every round via `message.id` segmentation, which is why each round emits a stable `rt-<chatId>-<round>` id.
