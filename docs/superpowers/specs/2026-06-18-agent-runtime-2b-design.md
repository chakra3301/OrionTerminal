# Provider-Agnostic Agent Runtime — Phase 2b (Tools + Edit-Review Parity) Design Spec

**Date:** 2026-06-18
**Status:** Approved (brainstorming complete) — ready for implementation planning
**Builds on:** Phase 2a (runtime core), branch `feat/control-panel-agent-forge`. 2a shipped the Rust streaming runtime (`src-tauri/src/runtime/`), the `Provider` trait + OpenAI/Gemini adapters, the `claude:event` emitter, and the `dispatchSend` routing seam. Non-Claude models stream conversational replies today; they have no tools.

---

## 1. What this is

The second half of Phase 2: give the provider-agnostic runtime **tool-calling + edit-review parity**, so non-Claude models (OpenAI-compatible, Gemini) execute the **same Orion tools** the Claude path does — including the reviewable `orion_apply_edit`/`orion_write_file` that surface as Accept/Reject diffs. This retires the Control Panel "no tools yet" badge and makes non-Claude agents fully agentic on Orion's surfaces.

### Locked decisions

- **Architecture: in-process** (chosen in the Phase 2 decomposition — "Rust runtime, tools in-process," not the MCP-client approach). 2b extracts a shared `dispatch_tool()` from the MCP server and adds an in-process path for `send_ui_action`.
- **Toolset: edit-review + essentials.** Expose all existing Orion MCP tools to non-Claude (incl. reviewable edit/write) **plus a new `orion_read_file`**; map skill built-in grants (`Edit`/`Write`/`Read`/`Grep`/`Glob`) to Orion equivalents. **Defer** WebSearch + bash-with-captured-output.
- **Non-regression:** the Claude path and the `--mcp-serve` subprocess path are byte-identical after this work.

---

## 2. Architecture — in-process tool bridge

### 2.1 Shared dispatcher

Extract the inline `match name { … }` in `mcp_server.rs::call_tool` (currently ~lines 717–765) into:

```rust
pub fn dispatch_tool(name: &str, args: &serde_json::Value) -> Result<String, String>
```

Both the stdio serve loop (`call_tool` wraps it into the MCP `{content,isError}` envelope) and the runtime call this. One tool implementation; no duplication. A cargo test calls `dispatch_tool` directly and asserts a known tool routes identically to the prior inline match.

### 2.2 `send_ui_action` in-process

Today `send_ui_action` (mcp_server.rs ~1876–1929) is TCP-only: it reads `ORION_BRIDGE_PORT`/`ORION_BRIDGE_TOKEN` and connects to the UI bridge. The runtime runs in the **main process, alongside the bridge**, so:

- Add a global `OnceCell<AppHandle>` set at startup — `app_handle::set(app)` in `lib.rs` setup, `app_handle::current() -> Option<AppHandle>`.
- `send_ui_action` branches:
  - **`app_handle::current()` is `Some` (main process / runtime):** call the bridge's forward path **directly** — emit `ui:action { kind, payload, request_id }` and block on a sync channel keyed by `request_id` (with the same 5s timeout semantics).
  - **`None` (the `--mcp-serve` subprocess):** today's TCP path, unchanged.
- `ui_bridge_respond` (the Tauri command the frontend already calls on Accept/Reject) resolves **both** the existing tokio-oneshot `PENDING` map (TCP) **and** a new sync-channel `PENDING_SYNC` map (in-process). The subprocess/Claude path is untouched.

Result: a `staged_edit` (or `open_note`, `open_app`, …) emitted by a non-Claude tool call reaches the **same `pendingEditsStore` → DiffReview Accept/Reject** flow. **Edit-review parity is automatic.**

Tool execution runs on `tokio::task::spawn_blocking` so a tool may block on the in-process bridge while it waits for the user's Accept without stalling the async runtime.

---

## 3. The agentic tool-call loop

Replaces 2a's single-shot stream; runs **inside one `runtime_send`** invocation:

1. Build the provider request (messages + tools) → stream the response: accumulate text (emit live) and any tool-calls.
2. If the round ended with tool-calls:
   - Emit the assistant `tool_use` blocks (claude:event `assistant` shape).
   - Execute each tool via `dispatch_tool` on `spawn_blocking`.
   - Emit each `tool_result` (claude:event `user` shape).
   - Append the assistant(tool_calls) + tool(results) messages to the **working** history.
   - Loop to (1).
3. No tool-calls → emit `result` (cost) + `claude:exit`.

A `max_rounds` guard (e.g. 24) prevents runaway loops; hitting it emits a final assistant note + exit.

### Event shapes (reused verbatim — no UI changes)

- Assistant: `{ type:"assistant", message:{ content:[ {type:"text",text}, {type:"tool_use", id, name, input} ] } }` → `chatStore.onAssistantBlocks`.
- Tool result: `{ type:"user", message:{ content:[ {type:"tool_result", tool_use_id, content, is_error} ] } }` → `chatStore.onToolResult`.
- End: `{ type:"result", total_cost_usd, session_id:null }` then `claude:exit`.

`EventBridge`/`chatStore` are unchanged — tool steps stream live in the chat exactly as they do for Claude.

---

## 4. Tool schemas → provider function-calling

New `runtime/tools.rs`:
- Pull `tool_definitions()` (already JSON-Schema per tool), **filter by the agent's `allowedTools`**, and format per provider:
  - **OpenAI:** `tools: [{ type:"function", function:{ name, description, parameters } }]`
  - **Gemini:** `tools: [{ functionDeclarations: [ { name, description, parameters } ] }]`
- `ChatRequest` gains `tools: Vec<ToolDef>`; each adapter's `body()` includes them when non-empty.

### Streaming tool-call accumulation (pure, unit-tested)

- **OpenAI:** `choices[0].delta.tool_calls` arrive fragmented by `index` — `id`/`name` once, `arguments` JSON dribbled across chunks; complete on `finish_reason:"tool_calls"`. Accumulator keyed by index.
- **Gemini:** a whole `functionCall { name, args }` part → one `ToolCall`.
- New `StreamItem::ToolCall { id, name, arguments }` (arguments finalized at round end). `parse_sse_line` stays pure.

---

## 5. The toolset + the new read tool + grant mapping

**Exposed to non-Claude:** all existing Orion MCP tools (notes/archive, search, open, edit/write reviewable, assets, XDesign, Hermes, activity) **plus**:

- **`orion_read_file { path }`** — new MCP tool: reads a file's contents (absolute or project-relative), size-capped (e.g. 64 KB), read-only. Closes the gap that no generic file-read tool exists. Added to `tool_definitions()` + `dispatch_tool`.

**Built-in grant mapping** (runtime path only): a mapping layer translates skill `builtin` tool grants into the tools the runtime exposes —
- `Edit`/`Write` → `orion_apply_edit` / `orion_write_file`
- `Read` → `orion_read_file`
- `Grep`/`Glob` → `orion_search_files`
- `Bash`/`WebSearch` → omitted (deferred); the skill's **instructions still apply**.

This mapping affects **only** the runtime. The Claude path keeps passing literal built-in names (`Edit`, `WebSearch`, …) to the CLI via `--allowed-tools`, unchanged.

---

## 6. Data model — multi-round history

`Msg` extends to carry tool turns:

```rust
struct Msg {
  role: String,            // "user" | "assistant" | "tool"
  content: String,
  tool_calls: Option<Vec<ToolCall>>,   // assistant rounds
  tool_call_id: Option<String>,        // tool-result messages
}
```

The runtime builds these **within** a turn; adapters map them to each provider's shape (OpenAI `role:"tool"` + `assistant.tool_calls`; Gemini `functionCall` / `functionResponse` parts). Existing text-only `Msg`s deserialize unchanged (new fields optional).

**Known v1 limit (deferred):** across *separate* user turns, history still flattens to text — prior tool I/O is not replayed to stateless providers. Same spirit as 2a's history model.

---

## 7. Frontend wiring

- `dispatchSend` (`src/features/agents/dispatchSend.ts`) now passes `r.allowedTools` to `ipc.runtimeSend`.
- `ipc.runtimeSend` + `runtime_send` gain an **additive** `allowed_tools: Vec<String>` (or `tools`) param.
- The grant-mapping (built-in → Orion) lives in a small pure TS helper (or is applied in `composeAgent`'s runtime consumer) so the runtime receives the resolved Orion tool names. Claude routing is unchanged.
- Control Panel: non-Claude provider badge drops "no tools yet" → just "chat ready" / live; the Forge's "tools run after the next engine update" hint is removed.

---

## 8. Testing & non-regression

**Pure-logic TDD (network-free):**
- OpenAI tool-call accumulation (fragmented across chunks; mixed text+tool-call; finish_reason).
- Gemini `functionCall` → `ToolCall`.
- Schema translation (filtered by allowedTools → OpenAI + Gemini shapes; names/params/required preserved).
- Built-in→Orion grant mapping (and Claude path passes literals unchanged).
- `Msg` round-trip with tool_calls + tool-result → each provider body shape.
- `orion_read_file`: contents, size-cap, missing-file error.
- `dispatch_tool` extraction parity (cargo).

Target ~25–30 new tests (cargo for runtime/dispatch/read-file; vitest for grant mapping + dispatchSend tools pass-through).

**Non-regression (headline, test-enforced):**
- Claude path: `dispatchSend` still routes Claude → `claudeSend` byte-identically (existing routing test stays green); literal built-in tool names to the CLI.
- Subprocess/MCP path: `send_ui_action` falls back to TCP when `app_handle::current()` is `None`; `dispatch_tool` behaves identically to the old inline match.
- `runtime_send`'s new param is additive.

**Gates:** tsc · full vitest · `cargo test` + `cargo check` · `npm run build` exit 0. Requires a **`tauri dev` restart** (Rust changes). UI human-verified after restart.

---

## 9. Success criteria

1. A non-Claude agent equipped with editing skills **reads a file** via `orion_read_file`, then proposes an edit via `orion_apply_edit` that lands in the **same Accept/Reject diff UI** as Claude's edits.
2. Tool steps (tool_use + results) **stream live** in the chat rail during a non-Claude turn.
3. A non-Claude agent can drive other Orion tools (create note, search, open app) and they take effect.
4. Selecting any Claude model/agent is **byte-identical** to before (tools, edits, sessions intact).
5. The `--mcp-serve` subprocess (Claude's tools) still works unchanged.
6. The "no tools yet" provider badge / Forge hint is gone.
7. All gates green; user smoke-tests after restart.

---

## 10. Explicit deferrals

- **Later slice:** runtime-native **WebSearch** (needs a search API + key) and **Bash with captured output**; cross-turn replay of tool I/O to stateless providers.
- **Phase 3:** literal **Brain→Action routing** (the Action model finally wires up — a planner/executor split over this tool loop).
- Out of scope: Hermes non-Claude swarm agents; Learn/RepoLens one-shot provider tools.
