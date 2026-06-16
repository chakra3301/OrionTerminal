# Provider-Agnostic Agent Runtime — Phase 2a (Runtime Core) Design Spec

**Date:** 2026-06-16
**Status:** Approved (brainstorming complete) — ready for implementation planning
**Builds on:** Phase 1 (Control Panel + Agent Forge), branch `feat/control-panel-agent-forge`. Phase 1 ships the provider registry, `composeAgent`, `resolveSend`, `provider_keys` keychain, and the tagged dropdown value.

---

## 1. What this is

The first half of the **provider-agnostic agent runtime**: a Rust streaming chat loop that talks to OpenAI-compatible and Gemini providers and **emits the exact same `claude:event` / `claude:exit` stream** the Claude CLI path emits — so non-Claude models light up on Orion's conversational chat surfaces with **no UI changes**.

**This is Phase 2a of the larger Phase 2.** Scope is deliberately drawn at *conversational replies only*:
- **In 2a:** provider abstraction, two adapters (OpenAI-compatible + Gemini), the streaming turn loop, the `claude:event` emitter, history-based context, rough cost, cancel, and the frontend routing seam.
- **Deferred to 2b (own spec):** the in-process tool-dispatch refactor of the MCP server, function-calling for non-Claude, tool execution, and edit-review (Accept/Reject) parity = full agentic editing.
- **Deferred to Phase 3 (own spec):** literal Brain→Action routing.

### Locked decisions (from brainstorming)

- **Runtime location:** Rust, with tools (in 2b) reached via a shared **in-process** dispatcher. 2a builds the Rust loop; 2b does the tool refactor.
- **Providers first:** one **OpenAI-compatible** adapter (`/v1/chat/completions` — covers OpenAI, OpenRouter, Groq, Together, and local Ollama/LM Studio via base URL) **+ Gemini**. Anthropic stays on the proven CLI path.
- **Scope split:** spec 2a (runtime core) now; 2b (tools + edit parity) later.
- **Sessions:** non-Claude is **history-based** (stateless API); Claude keeps `--resume` sessions.
- **2a boundary:** non-Claude = conversational replies only. Agent persona + skill *instructions* are sent as the system prompt; skill *tools* do not execute until 2b.

---

## 2. The integration contract (what the runtime must honor)

From the Claude path (`src-tauri/src/claude_cli.rs` + `src/app/EventBridge.tsx` + `src/store/chatStore.ts`):

- **Events:** `claude:event { chatId, event }` where `event.type ∈ {system, assistant, user, result, stderr}`, and `claude:exit { chatId, code, error }`.
- **Assistant rendering:** `EventBridge` reads `event.message.content[]` (blocks of `{type:"text",text}` / `{type:"tool_use",…}`) and calls `chatStore.onAssistantBlocks(blocks)`, which **replaces** the pending assistant message's blocks.
- **Turn end:** `event.type:"result"` → `chatStore.addCost(total_cost_usd)` + `finishTurn()`.
- **Session:** `event.type:"system", subtype:"init", session_id` → `chatStore.setSessionId(sid)` (runtime never emits this; harmless).

The runtime emits this contract verbatim, so `EventBridge`/`chatStore` need **zero changes**.

---

## 3. Architecture & routing seam

```
                       ┌─ provider is Anthropic builtin ─→ ipc.claudeSend  (CLI, session-based)   [UNCHANGED]
send site → dispatchSend(chatId, selection, history, prompt) ┤
                       └─ provider is other ─────────────→ ipc.runtimeSend (Rust runtime, history-based)
                                                                   │
                       runtime/ ── Provider trait ──┬─ openai.rs (OpenAI-compatible)
                                                     └─ gemini.rs
                            └── stream deltas → emit claude:event {type:"assistant"…} → {type:"result"} → claude:exit
```

**New Rust module** `src-tauri/src/runtime/`:
- `mod.rs` — `runtime_send` / `runtime_cancel` Tauri commands, the provider-agnostic turn loop, event emission, a `Notify`-based cancel map (mirrors `claude_cancel`).
- `provider.rs` — the `Provider` trait + shared `ChatRequest` / `Msg` / `StreamItem` types + pure SSE-parse helpers.
- `openai.rs`, `gemini.rs` — the two adapters.
- `pricing.rs` — rough usage→cost table.

**Frontend routing** `src/features/agents/dispatchSend.ts`:
1. `resolveSend(selectionValue)` → `{ model, systemAppend, allowedTools }` (Phase 1).
2. Find the owning provider for `model` in `providersStore` (the provider whose `models[]` contains `model`; default Anthropic-builtin).
3. Route:
   - Anthropic-builtin → `ipc.claudeSend(chatId, prompt, projectRoot, sessionId, null, model, systemAppend, allowedTools)` — **identical to today**.
   - else → `ipc.runtimeSend(chatId, provider.kind, provider.baseUrl, provider.keyRef, model, systemAppend ?? "", history)`.

`history` is built from `chatStore` messages → `{ role:"user"|"assistant", content }`, assistant blocks flattened to their text.

---

## 4. Provider abstraction & adapters

`runtime/provider.rs`:

```rust
struct Msg { role: String, content: String }            // role: "user" | "assistant"
struct ChatRequest { model: String, system: String, messages: Vec<Msg> }
enum StreamItem { TextDelta(String), Usage { in_tokens: u64, out_tokens: u64 }, Done }

trait Provider {
    fn endpoint(&self, base_url: &str, model: &str) -> String;
    fn headers(&self, api_key: &str) -> Vec<(String, String)>;
    fn body(&self, req: &ChatRequest) -> serde_json::Value;
    fn parse_sse_line(&self, line: &str) -> Option<StreamItem>;  // pure, unit-tested
}
```

The loop in `mod.rs` is provider-agnostic; only the four trait methods differ. `parse_sse_line` is pure → adapters are fully unit-testable without network.

**OpenAI-compatible** (`openai.rs`):
- Endpoint: `{base_url}/chat/completions`; default base `https://api.openai.com/v1` when blank.
- Auth: `Authorization: Bearer <key>` — **header omitted entirely when `key_ref`/key is empty** (local Ollama/LM Studio works keyless).
- Body: `{ model, stream:true, stream_options:{include_usage:true}, messages:[{role:"system",content:<system>}, …history] }` (system omitted when empty).
- Parse: `data: {…}` → `choices[0].delta.content` → `TextDelta`; final chunk `usage` → `Usage`; `data: [DONE]` → `Done`; non-`data:` / blank lines ignored.

**Gemini** (`gemini.rs`):
- Endpoint: `{base_url}/models/{model}:streamGenerateContent?alt=sse`; default base `https://generativelanguage.googleapis.com/v1beta`.
- Auth: `x-goog-api-key: <key>` header.
- Body: system → `system_instruction:{parts:[{text}]}`; history → `contents:[{role:"user"|"model", parts:[{text}]}]` (map `assistant`→`model`).
- Parse: `data: {…}` → `candidates[0].content.parts[].text` → `TextDelta`; `usageMetadata` → `Usage`.

Keys are read in Rust via `provider_keys::read(key_ref)` — never cross into JS.

---

## 5. The turn loop, events, cost & cancel

**Command:**
```rust
runtime_send(app, chat_id: String, provider_kind: String, base_url: String,
             key_ref: String, model: String, system: String, history: Vec<Msg>) -> Result<(), String>
```

Loop:
1. `provider_keys::read(&key_ref)`; build the adapter for `provider_kind`.
2. Streaming `reqwest` POST (keep-alive client pattern from `autocomplete.rs`); iterate `bytes_stream()`, split into lines, feed each to `parse_sse_line`.
3. On `TextDelta`: **accumulate** text, emit `claude:event { chatId, event:{ type:"assistant", message:{ content:[{ type:"text", text:<accumulated> }] } } }`. `onAssistantBlocks` replaces the pending message blocks → live token-by-token streaming.
4. On `Usage`: stash counts. At end: emit `{ type:"result", total_cost_usd:<est>, session_id:null }`, then `claude:exit { chatId, code:0 }`.
5. On HTTP/parse error: emit `claude:exit { chatId, code:1, error:<msg> }` + optional `{ type:"stderr", text:<body> }`.

**Sessions = history.** No `session_id` produced; `dispatchSend` always passes the full prior `history`. `chat.sessionId` stays `null` for runtime chats (harmless).

**Cost** (`pricing.rs`): if the provider returns usage, `total_cost_usd = in_tokens*price_in + out_tokens*price_out` from a small per-`kind` table; `0` when usage absent (common for local). The monitor widget's Claude-transcript tracking is unchanged.

**Cancel:** `runtime_cancel(chat_id)` mirrors `claude_cancel` via a `Notify` map; `dispatchSend`'s cancel path routes to whichever engine owns the chat.

---

## 6. Frontend routing & the 2a boundary

- **Send sites updated:** Orion rail, Archives rail, XDesign rail, ROSIE swap their direct `claudeSend` call for `dispatchSend`. `ipc` gains `runtimeSend` / `runtimeCancel`.
- **Boundary (shown in UI + honest):**
  - A non-Claude model or non-Claude-brained agent → **conversational replies only**. Persona + skill *instructions* go in the system prompt; skill *tools* do not execute (2b). If an active non-Claude agent has tool-granting skills, the rail shows a subtle "tools run after the next engine update (2b)" hint.
  - Claude selections fully unchanged (tools/edits/sessions as Phase 1).
  - Non-Claude providers lose their Phase-1 "needs runtime" badge once 2a ships → selectable + live for chat; a smaller "no tools yet" marker remains until 2b.
- Out of 2a scope: Learn/RepoLens one-shot `_claude_call` paths; Hermes non-Claude agents.

---

## 7. Testing & non-regression

**Pure-logic TDD (network-free):**
- `parse_sse_line` (OpenAI + Gemini): `TextDelta` / `Usage` / `Done` / ignored / malformed / `[DONE]`.
- `body()` builders: request JSON shape, system placement, role mapping (Gemini `assistant`→`model`), keyless-header omission.
- `pricing.rs`: usage×table → cost; `0` when usage absent.
- `dispatchSend` routing (vitest, mock `ipc`): Claude selection → `claudeSend` with byte-identical args; non-Claude → `runtimeSend` with mapped history.
- History mapping: `chatStore` messages → `{role,content}[]`, assistant blocks flattened.

Target ~20–25 new tests (cargo for adapters/pricing, vitest for routing/history).

**Non-regression (headline):** Claude selections never enter the new path — `dispatchSend` routes them to the unchanged `claudeSend` (asserted by a routing test). `runtime_send` is an entirely additive command; no existing Rust signature changes.

**Gates:** `tsc` clean · full vitest green · `cargo test` + `cargo check` · `npm run build` exit 0. Requires a **`tauri dev` restart** (new Rust module + commands). UI human-verified after restart.

---

## 8. Success criteria (Phase 2a)

1. Register an OpenAI provider (real key) → select one of its models in a chat rail → send → a streaming reply renders token-by-token in the existing chat UI.
2. Point an OpenAI-compatible provider at a local Ollama/LM Studio base URL with no key → it streams keyless.
3. Register a Gemini provider → select a Gemini model → streaming reply renders.
4. A custom agent with a non-Claude brain → persona/instructions apply (system prompt); replies stream; a "no tools yet" hint shows if it has tool skills.
5. Selecting any Claude model/agent behaves byte-identically to Phase 1 (tools, edits, sessions all intact).
6. Cancel works on a streaming non-Claude turn.
7. All gates green; user smoke-tests after restart.

---

## 9. Explicit deferrals

- **Phase 2b (next spec):** MCP in-process tool-dispatch refactor; function-calling for non-Claude; tool execution; edit-review Accept/Reject parity; the "no tools yet" hint goes away.
- **Phase 3:** literal Brain→Action routing.
- **2a out-of-scope:** Learn/RepoLens provider support; Hermes non-Claude agents; provider model auto-discovery.
