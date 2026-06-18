# Provider-Agnostic Agent Runtime — Phase 2c (Subscription CLI Engines) Design Spec

**Date:** 2026-06-18
**Status:** Approved (brainstorming complete) — ready for implementation planning
**Builds on:** Phase 2a (HTTP runtime core) + Phase 2b (tools + edit-review parity for non-Claude), branch `feat/control-panel-agent-forge`. 2a/2b gave API-key providers streaming + tools via an in-process runtime. 2c adds a *different* integration style for two providers that ship their own subscription-aware CLIs.

---

## 1. What this is

Today, non-Claude users can only connect by **API key** (pay-per-token, via the Phase 2a/2b HTTP runtime). **Claude** is special: it runs on the user's **subscription** because Anthropic ships the `claude` CLI, which Orion drives as a subprocess (see [claude_cli.rs](../../../src-tauri/src/claude_cli.rs)).

Phase 2c extends that same **subscription-CLI subprocess pattern** to the two other vendors that ship subscription-aware CLIs:

- **OpenAI Codex CLI** — ChatGPT Plus/Pro/Team sign-in.
- **Google Gemini CLI** — personal Google-account login (generous free tier, no card).

After 2c, a user with a ChatGPT or Google subscription gets the same **no-API-key** experience Claude users have today, including tools and (where the engine permits) the Accept/Reject edit-review flow.

### Why this is the Claude pattern, not the HTTP runtime

Both CLIs support **headless execution** and **MCP servers**. So architecturally they mirror the Claude CLI engine — spawn a subprocess, attach the Orion MCP server, transcode the CLI's output stream into the existing `claude:event`/`claude:exit` contract — **not** the Phase 2a/2b HTTP runtime (which calls vendor HTTP endpoints with a key and runs its own in-process tool loop). Tools therefore come "for free" via the same `orion --mcp-serve` server Claude uses; there is no new tool loop in 2c.

### Locked decisions

- **Scope:** build **both** Codex CLI and Gemini CLI engines this phase.
- **Setup model:** **user-managed login + detect** — same as the Claude CLI today. Orion assumes the user installed the CLI and ran its login once; Orion *detects* presence + auth status and surfaces it. No OAuth code in Orion.
- **Tools:** **full parity via MCP** — attach the Orion MCP server to both CLIs so they get the same tool surface as Claude, including reviewable edit/write (subject to the Section 6 edit wrinkle).
- **Non-regression:** the Claude path, the HTTP runtime path, and the `--mcp-serve` subprocess path are all byte-identical after this work.

---

## 2. Architecture — two more CLI engines

### 2.1 Provider kinds + built-in providers

- Extend `ProviderKind` in [agentTypes.ts](../../../src/features/agents/agentTypes.ts):
  ```ts
  type ProviderKind =
    | "anthropic" | "openai" | "google" | "openai_compat" | "custom"
    | "codex_cli" | "gemini_cli";
  ```
- Seed **two built-in providers** in [seedData.ts](../../../src/features/agents/seedData.ts), alongside `BUILTIN_PROVIDER` (anthropic). Each: `builtin: true`, `enabled: true`, `keyRef: ""`, `baseUrl: ""`, a small `models` list (confirmed in the spike — e.g. Codex `gpt-5-codex`/`gpt-5`; Gemini `gemini-2.5-pro`/`gemini-2.5-flash`). [providersStore.ts](../../../src/store/providersStore.ts) `load()` already self-seeds the builtin anthropic provider when missing; extend the same idempotent seed to ensure both CLI providers exist.
- Result: their models appear in `ModelSelect` and the Agent Forge brain picker automatically (same path as Claude models). No migration — runtime seed, like `builtin:anthropic`.

### 2.2 Routing seam

[dispatchSend.ts](../../../src/features/agents/dispatchSend.ts) `routeFor(providers, model)` today returns `"claude"` for `kind === "anthropic"` else the `Provider` (HTTP runtime). Add a third outcome for CLI engines:

```ts
// "claude" → ipc.claudeSend (unchanged)
// { engine: "codex_cli" | "gemini_cli", ... } → ipc.cliSend(...)
// other Provider → ipc.runtimeSend (HTTP, unchanged)
```

`dispatchSend` routes `codex_cli`/`gemini_cli` to a new `ipc.cliSend(engine, …)`. **The `anthropic` branch and the HTTP-runtime branch are untouched** — the existing routing test stays green and is extended to assert the two new kinds route to `cliSend` and never to `claudeSend`/`runtimeSend`.

### 2.3 Rust engine command

New Tauri command (mirrors `claude_send`'s lifecycle in [claude_cli.rs](../../../src-tauri/src/claude_cli.rs)):

```rust
#[tauri::command]
pub async fn cli_send(
    app: AppHandle,
    engine: String,            // "codex_cli" | "gemini_cli"
    chat_id: String,
    prompt: String,
    project_root: Option<String>,
    session_id: Option<String>,
    model: Option<String>,
    system_append: Option<String>,
) -> Result<(), String>
```

Lives in a new module `src-tauri/src/cli_engine/` (`mod.rs` + `codex.rs` + `gemini.rs` + `transcode.rs`). It:

1. Resolves the engine's binary + flags (Section 3), augmenting `PATH` via the existing `augmented_path()` helper.
2. Writes an **isolated MCP config** pointing at `orion --mcp-serve` (Section 4).
3. Spawns the subprocess; pipes the prompt per the engine's headless convention.
4. Reads stdout line-by-line; runs the engine's **transcoder** (Section 5) to emit `claude:event`; emits `claude:exit` on close.
5. Supports cancel via the same global `Notify` map pattern Claude uses (`cli_cancel(chat_id)`).

No existing Rust signature changes; `cli_send`/`cli_cancel`/`cli_status` are additive, registered in `lib.rs`.

---

## 3. Task 0 — mandatory capability spike (before any parser)

These are external CLIs whose exact flags, output format, and MCP-attachment mechanism must be **confirmed on the user's machine**, not assumed. **Task 0 of the plan is a spike**, run interactively with the user:

For **each** of `codex` and `gemini`, capture and record:
- The exact **headless** invocation (`codex exec …` / `gemini -p …`), including the machine-readable **output flag** (e.g. `--json` / `--output-format json`).
- A few **recorded sample output lines** for: a plain text reply, a tool call, a tool result, and the final/usage line. These become fixtures for the transcoder unit tests.
- The **model-selection** flag (`-m`/`--model`) and the built-in model ids available under the subscription.
- The **MCP-attachment** mechanism and config schema (Codex: `~/.codex/config.toml` `[mcp_servers.*]`; Gemini: `.gemini/settings.json` `mcpServers`) and how to point the CLI at an **isolated** config without mutating the user's real config (e.g. `CODEX_HOME` env for Codex; a generated project/temp settings file or scoped env for Gemini).
- **Auto-approval / non-interactive tool execution** flag (so MCP tool calls don't block on a TTY prompt — analogous to Claude's `--permission-mode bypassPermissions`).
- Whether the engine's **native file-edit tools can be disabled** (Section 6).
- The **auth-state** indicator: which file/command reveals logged-in vs not (`~/.codex/auth.json`, `~/.gemini/` creds, or a `… login status` subcommand).

The spike's findings are written into the plan's per-engine task before the transcoder/config tasks are implemented. **No transcoder code is written against guessed formats.**

---

## 4. MCP attachment — isolated, non-invasive

The Orion MCP server definition is already produced by [mcp_config.rs](../../../src-tauri/src/mcp_config.rs) `write()` (the `orion` server: `command = current_exe`, `args = ["--mcp-serve"]`, env `ORION_DB_PATH`/`ORION_CONTEXT_PATH`/`ORION_BRIDGE_PORT`/`ORION_BRIDGE_TOKEN`). 2c reuses the **same server definition** but serializes it into each CLI's config schema, in an **isolated location** so the user's real CLI config is never mutated:

- **Codex:** generate a temp/app-config dir containing `config.toml` with `[mcp_servers.orion]` (command/args/env), and launch with `CODEX_HOME` pointed at it (exact mechanism confirmed in the spike).
- **Gemini:** generate a settings file with `mcpServers.orion` (JSON, close to Claude's `--mcp-config` shape) and point the CLI at it (project/temp settings or scoped env, confirmed in the spike).

Two small **pure writer functions** (`codex_mcp_config(server) -> String` TOML, `gemini_mcp_config(server) -> String` JSON) are unit-tested against the known Orion server shape. Config-write failures are non-fatal (the engine proceeds without MCP, matching Claude's behavior), but then tools are unavailable and the status reflects it.

Because the CLI runs `orion --mcp-serve` as its own subprocess, that server hits the **existing TCP bridge path** in `send_ui_action` (`app_handle::current()` is `None` inside the subprocess) → `ui_bridge_respond` → the same `pendingEditsStore` → DiffReview. **This is the original Claude subprocess MCP path, reused verbatim — the Phase 2b in-process bridge is not involved.**

---

## 5. Output transcoding → claude:event

Each engine emits its own event stream; a per-engine **transcoder** maps it to the claude:event shapes the frontend already consumes (no UI change). Target shapes (identical to Claude/runtime):

- Assistant text: `{ type:"assistant", message:{ id, content:[{ type:"text", text }] } }`
- Tool call: `{ type:"assistant", message:{ content:[{ type:"tool_use", id, name, input }] } }`
- Tool result: `{ type:"user", message:{ content:[{ type:"tool_result", tool_use_id, content, is_error }] } }`
- End: `{ type:"result", total_cost_usd, session_id }` then `claude:exit`.

`transcode.rs` exposes pure functions — `codex_line_to_events(line: &str, state) -> Vec<Value>` and `gemini_line_to_events(line: &str, state) -> Vec<Value>` — fed the spike's recorded fixtures. Partial-line buffering reuses the `BufReader::lines()` approach Claude uses. Cost: if the CLI reports usage/cost, pass it through; if a subscription CLI reports none, emit `total_cost_usd: 0` and the UI shows "subscription" rather than a dollar figure (Section 8).

`EventBridge`/`chatStore` are unchanged — tool steps and text stream live in the chat rail exactly as for Claude.

---

## 6. Edit-review parity — the one honest wrinkle

Non-edit MCP tools (`orion_read_file`, search, create-note, open-app, XDesign, Hermes, activity) are clean parity for both engines — they round-trip through the Orion MCP server like Claude's.

**Edits need the spike's answer.** Codex and Gemini ship their own native file-edit/apply-patch tools. To land an edit in the Orion Accept/Reject **DiffReview**, the write must route through `orion_apply_edit`/`orion_write_file` instead of the CLI's native editor — the way Claude does via `--disallowed-tools Edit Write MultiEdit NotebookEdit`. Two outcomes, both shipped acceptably:

- **Native edits disable-able (parity):** disable the CLI's native edit tools so it uses the Orion MCP edit tools → edits land in the **same staged DiffReview** as Claude. This is the target.
- **Not disable-able (fallback):** the CLI edits the working tree directly under its own sandbox/auto-approve. The change is still **reviewable via the existing git gutter + Changes panel** (HEAD-vs-buffer diff, stage/discard) — just not the pending-edit overlay. The Control Panel status states this honestly ("edits land in the working tree; review them in Changes") rather than faking the staged flow.

The plan implements the target; if the spike shows a CLI can't disable native edits, that engine ships the fallback and the copy reflects it. No silent pretense either way.

---

## 7. Detection + status (Control Panel)

Reuse the probe pattern from [lsp.rs](../../../src-tauri/src/lsp.rs) `lsp_probe` (spawn `<bin> --version` on `augmented_path()`, success = installed). New command:

```rust
#[tauri::command]
pub async fn cli_status(engine: String) -> CliStatus
// { installed: bool, logged_in: bool, version: Option<String>, detail: String }
```

`logged_in` is read from the engine's auth artifact (confirmed in the spike — auth file presence or a `… login status` probe). The Control Panel Providers section renders each CLI engine's state:

- *Installed + logged in* → ready (models selectable).
- *Installed, not logged in* → show the exact login command (`codex login` / `gemini`), with a "re-check" button.
- *Not found* → show the install hint.

A built-in CLI provider whose engine is not installed/logged-in still appears, but its models are shown disabled with the reason (mirrors how unconfigured API-key providers surface today).

---

## 8. Agent persona, cost, and scope edges

- **Persona:** a forged agent's skill **instructions** map to the engine's system-prompt mechanism (best-effort, confirmed in the spike — e.g. a prepended system message or a config field). The agent's **brain model** maps to the engine's `-m`/`--model`.
- **Tool-grant filtering deferred** for CLI engines: in 2c they receive the **full Orion MCP toolset**; the skill's tool grants don't yet prune which MCP tools are exposed (the instructions still steer behavior). Noted as a deferral; parity with the runtime's grant mapping is a later slice.
- **Cost:** subscription CLIs may report no per-turn cost; the rail shows "subscription" instead of a dollar amount when `total_cost_usd` is 0/absent for a CLI engine.
- **Sessions:** if an engine supports resume (session id in its output), thread it like Claude's `--resume`; otherwise the engine is stateless per turn (history is the CLI's own, or flattened — confirmed in the spike). Cross-turn behavior documented per engine.

---

## 9. Testing & non-regression

**Pure-logic TDD (network-free, no subprocess):**
- `codex_line_to_events` / `gemini_line_to_events` transcoders against recorded spike fixtures (text, tool_use, tool_result, final/usage; partial-line buffering).
- `codex_mcp_config` (TOML) / `gemini_mcp_config` (JSON) writers against the known Orion server shape.
- `cli_status` parsing (installed/not, logged-in/not from auth artifact).
- `dispatchSend` routing: `codex_cli`/`gemini_cli` → `cliSend`; never `claudeSend`/`runtimeSend`.
- Built-in CLI provider seeding (idempotent; both providers present after `load()`).

**Non-regression (headline, test-enforced):**
- Claude path: `dispatchSend` still routes `kind === "anthropic"` → `claudeSend` **byte-identical** (existing routing test green); `claude_send` flags unchanged.
- HTTP runtime path (`runtime_send`) and `--mcp-serve` subprocess path: unchanged.
- New `ProviderKind` members, `cli_send`/`cli_cancel`/`cli_status`, and the seed additions are purely additive.

**Gates:** `npx tsc --noEmit` · full `npx vitest run` · `cargo test && cargo check` · `npm run build` exit 0.

Requires a **`tauri dev` restart** (new Rust module + commands). The UI and live CLI behavior are **human-verified** after restart — the agent cannot run Tauri or drive the external CLIs; spike + transcoder fixtures are the automated coverage, and engine tasks end at a user smoke checklist (Section 10).

---

## 10. Success criteria

1. A user logged into **Codex CLI** selects a Codex model/agent in any rail and gets a streaming reply on their **ChatGPT subscription**, no API key.
2. Same for **Gemini CLI** on a Google account.
3. Both engines drive Orion **MCP tools** (read file, search, create note, open app) and they take effect, streaming live in the chat rail.
4. An editing turn lands in the **Accept/Reject DiffReview** (target) or the **Changes panel** (fallback), per the Section 6 outcome — and the Control Panel copy matches what actually happens.
5. The Control Panel shows accurate **installed / logged-in** status for each engine, with the right next-step copy when not.
6. Selecting any **Claude** model/agent is **byte-identical** to before (tools, edits, sessions intact); API-key providers (2a/2b) and the `--mcp-serve` subprocess still work unchanged.
7. All gates green; user smoke-tests after restart.

---

## 11. Explicit deferrals

- **Per-tool grant filtering** for CLI engines (full MCP toolset for now).
- **Cost accounting** where a subscription CLI reports none (shows "subscription").
- **Codex/Gemini CLI in Hermes swarms**; Learn/RepoLens one-shot provider calls.
- Any vendor whose CLI lacks subscription login (stays API-key via 2a/2b).
- **Phase 3:** literal **Brain→Action routing** (planner/executor split) over any of these engines.
