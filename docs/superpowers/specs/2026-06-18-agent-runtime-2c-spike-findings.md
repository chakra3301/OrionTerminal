# Phase 2c Capability Spike — Findings (Task 0)

**Date:** 2026-06-18 · **Machine:** macOS 26.2 arm64
**Installed for the spike:** `codex-cli 0.141.0` (`/opt/homebrew/bin/codex`), `gemini 0.47.0` (`/opt/homebrew/bin/gemini`) — both via `npm i -g` (landed under Homebrew's node prefix).

**Confidence legend:**
- **[M]** machine-confirmed on this box (ran the command, saw the output).
- **[D]** documented / authoritative source (vendor repo, context7) — not yet seen live here.
- **[P-AUTH]** PROVISIONAL — needs a real **logged-in** run to lock (the user has **no ChatGPT/Google subscription yet**, so success-path output lines could not be captured live). These are the transcoder-fixture validation checkpoints.

> The user has **neither** subscription configured. Flags, config schemas, isolation envs, and auth probes are all **[M]**. The **success-path output lines** (assistant text / tool_use / tool_result / usage) are **[D]** for Codex (authoritative repo schema) and **[D]/[P-AUTH]** for Gemini (event type names confirmed, exact field nesting provisional). Transcoder tasks ship against these fixtures and carry a "validate against first logged-in run" gate.

---

## A. OpenAI Codex CLI (`codex`)

### A1. Headless invocation + machine-readable output **[M]**
- `codex exec [OPTIONS] [PROMPT]` (alias `codex e`). Prompt as positional **or** piped on **stdin** (if `-` used, or stdin piped; if both, stdin appended as a `<stdin>` block).
- **`--json`** → "Print events to stdout as JSONL" (alias `--experimental-json`). This is the transcoder input stream. **JSONL is on stdout; diagnostic `… ERROR codex_api::…` lines go to stderr** — the transcoder reads stdout only and skips any non-JSON line.
- `--skip-git-repo-check` → run outside a git repo (Orion projects may not be repos — pass it).
- `--ephemeral` → don't persist session files. (We want resume, so do **not** pass this; capture `thread_id` instead.)
- `-o, --output-last-message <FILE>` → final message to a file (optional convenience; we parse the stream).
- `-C, --cd <DIR>` → working root (= project_root).

### A2. Model flag + ids **[M] flag / [P-AUTH] ids**
- **`-m, --model <MODEL>`** **[M]**.
- A mktemp-home `codex exec -m gpt-5` printed `item.completed … "Model metadata for 'gpt-5' not found. Defaulting to fallback"` **[M]** → `gpt-5` is **not** a valid id for 0.141. The app-server docs example uses **`gpt-5.1-codex`** **[D]**. **Subscription model ids to confirm post-login** (likely `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5.1`) — seed provisional, confirm via the model picker / first run **[P-AUTH]**.

### A3. Auto-approval / non-interactive tool execution **[M]**
- `-a, --ask-for-approval <never|on-request|untrusted|on-failure>` — **`never`** = never ask (non-interactive).
- `-s, --sandbox <read-only|workspace-write|danger-full-access>`.
- `--dangerously-bypass-approvals-and-sandbox` = skip all prompts **and** sandboxing (analogue of Claude's `bypassPermissions`).
- **Recommended for Orion headless runs:** `-a never -s workspace-write` (lets MCP tool calls + writes proceed without a TTY prompt, keeps a sandbox). Use `danger-full-access` only if a tool needs it. (Final choice = an implementation decision; the fallback-edit story in §C depends on sandbox mode.)

### A4. MCP attachment + isolated config **[M]**
- Config schema (derived live via `codex mcp add … && cat config.toml` in an isolated `CODEX_HOME`):
  ```toml
  [mcp_servers.orion]
  command = "/abs/path/to/orion"
  args = ["--mcp-serve"]

  [mcp_servers.orion.env]
  ORION_DB_PATH = "..."
  ORION_BRIDGE_PORT = "..."
  ORION_BRIDGE_TOKEN = "..."
  ORION_CONTEXT_PATH = "..."
  ```
  (Confirmed canonical via `codex mcp get orion --json`: `transport.type="stdio"`, `command`, `args`, `env`.)
- **Isolation = `CODEX_HOME` env** pointing at an Orion-generated dir holding our `config.toml`. **[M]**
- **AUTH WRINKLE [M]:** `CODEX_HOME` relocates **everything incl. `auth.json`**. A mktemp `CODEX_HOME` run got `401 Unauthorized` even though the user would be logged in at `~/.codex` → an isolated home has **no credentials**. **Therefore: before spawn, copy (or symlink) the user's `~/.codex/auth.json` into the isolated `CODEX_HOME`.** (Refresh each spawn so token rotation is picked up.) This keeps the pure `codex_mcp_config` TOML writer (writes `config.toml` into the isolated home) while preserving subscription auth.
  - *Alternative considered:* inject MCP purely via repeated `-c 'mcp_servers.orion.command="…"'` overrides on the default `CODEX_HOME` (auth auto-preserved, zero files written). Cleaner for auth, but the spec mandates the isolated-home + pure-TOML-writer design and TOML arrays/nested-env via `-c` are fiddly. **Decision: isolated `CODEX_HOME` + auth.json bridge** (matches spec §4); note the `-c` route in the plan as a fallback if auth-bridging proves flaky.
- `--ignore-user-config` exists (don't load `$CODEX_HOME/config.toml`; auth still from `CODEX_HOME`) — *not* used (we want our config.toml).

### A5. Output transcoding → claude:event **[D], authoritative]**
Top-level events (`codex-rs/exec/src/exec_events.rs`, `#[serde(tag="type")]`):
- `thread.started` `{ thread_id }` → **session_id** (thread `019…` uuid form seen live **[M]**).
- `turn.started` / `turn.completed` `{ usage: { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens } }` / `turn.failed` `{ error }`.
- `item.started` / `item.updated` / `item.completed` `{ item: ThreadItemDetails }`.
- `error` `{ message }` (unrecoverable) **[M]** (saw the 401 path).

`ThreadItemDetails` (`#[serde(tag="type", rename_all="snake_case")]`), key item shapes (`sdk/typescript/src/items.ts`):
- `agent_message` `{ id, type, text }` → **assistant text**.
- `reasoning` `{ id, type, … }` → map to assistant thinking (or drop; Claude shows thinking).
- `mcp_tool_call` `{ id, type, server, tool, arguments, status, result?: { content[], structured_content }, error?: { message } }` → **emit BOTH** a `tool_use` (id, name=`tool`, input=`arguments`) **and** a `tool_result` (tool_use_id=id, content from `result`/`error`, is_error from `status`/`error`). Codex reports a completed call in one item, so synthesize the pair.
- `command_execution` `{ id, type, command, exit_code, … }` → map to a `tool_use`/`tool_result` pair (name e.g. `shell`).
- `file_change`, `web_search`, `todo_list`, `error` → map or ignore per transcoder task.

**Cost:** Codex reports **token usage, no $** → emit `total_cost_usd: 0` → UI shows "subscription" (§8).
**Sessions:** `thread_id` from `thread.started`; resume via `codex exec resume <id>` / `--last` **[M help]**. Thread → `session_id` in the `result` event.

> **[P-AUTH] fixtures:** capture one real `codex exec --json` run after `codex login` for: an `agent_message`, an `mcp_tool_call` (point at orion), a `command_execution`, and `turn.completed`. Validate the transcoder against them before marking the Codex transcoder task done.

### A6. Native edit tools disable-able? (§6) **[D] — confirm [P-AUTH]**
- Codex edits via a sandboxed `apply_patch`/`file_change` mechanism, not a disableable named "Edit" tool like Claude. There is **no `--disallowed-tools`**. `codex apply` applies the agent's diff as `git apply`.
- **Likely outcome = §6 FALLBACK** for Codex: edits land in the working tree (under `-s workspace-write`), reviewable via the **git gutter + Changes panel**, *not* the pending-edit DiffReview overlay. Control Panel copy must say so ("edits land in the working tree; review them in Changes").
- Confirm at login whether config (`[tools]` / sandbox) can suppress native patching so writes route through `orion_apply_edit` instead **[P-AUTH]**. Ship fallback; upgrade to parity only if confirmed.

### A7. Auth-state artifact (cli_status) **[M]**
- `codex login status` → `Not logged in` + **exit 1** (logged-in → account info + exit 0). **Primary probe.**
- Artifact file: `$CODEX_HOME/auth.json` (absent here) — secondary signal.
- `codex login` = the login command to surface when not logged in.
- Installed probe: `codex --version` → `codex-cli 0.141.0` (reuse `lsp_probe` pattern).

---

## B. Google Gemini CLI (`gemini`)

### B1. Headless invocation + machine-readable output **[M]**
- `gemini -p "<prompt>"` (`--prompt`) = non-interactive headless. Prompt also appendable via stdin.
- **`-o, --output-format <text|json|stream-json>`** → **`stream-json`** = newline-delimited JSONL events (the transcoder stream); `json` = one final object.
- `-m, --model <id>` **[M]**.
- `-C`? No — workspace via cwd + `--include-directories` / `-w` worktree. Use cwd = project_root.

### B2. TRUST + auto-approve (critical) **[M]**
- Live test: with our `orion` server in system settings, `gemini mcp list` showed it **"Disabled"** with *"MCP servers are configured but disabled because this folder is untrusted. User-level servers are also suppressed in untrusted folders."* → **MCP will not load unless the workspace is trusted.**
- **`--skip-trust`** = "Trust the current workspace for this session" **[M help]** → required so the orion MCP server loads headless.
- **`--approval-mode yolo`** (or `-y, --yolo`) = auto-approve all tool calls; `auto_edit` = auto-approve edits only; `plan` = read-only. **[M help]**
- **Recommended headless flags:** `--skip-trust --approval-mode yolo` (+ per-server `"trust": true` in settings, see B4).

### B3. Model ids **[M] flag / [P-AUTH] ids**
- `-m` flag confirmed. Subscription (personal Google) models **[D]:** `gemini-2.5-pro`, `gemini-2.5-flash` (+ `-flash-lite`). Confirm exact selectable ids post-login **[P-AUTH]**. Seed `gemini-2.5-pro` / `gemini-2.5-flash`.

### B4. MCP attachment + isolated, non-invasive config **[M]**
- Settings schema (derived live via `gemini mcp add … && cat .gemini/settings.json`):
  ```json
  { "mcpServers": { "orion": {
      "command": "/abs/path/orion",
      "args": ["--mcp-serve"],
      "env": { "ORION_DB_PATH": "...", "ORION_BRIDGE_PORT": "..." },
      "trust": true
  } } }
  ```
  `"trust": true` per-server bypasses that server's tool-call confirmations.
- **Isolation = `GEMINI_CLI_SYSTEM_SETTINGS_PATH` env** → point at an Orion-generated settings.json. **Confirmed live [M]:** with an isolated `GEMINI_DIR` and **no** project `.gemini`, the `orion` server WAS picked up from this file (showed up in `mcp mcp list`, only gated by trust). This is the **non-invasive** path — the user's real `~/.gemini/settings.json` and project dirs are untouched.
- **AUTH [M]:** auth (oauth creds) lives under `GEMINI_DIR` (default `~/.gemini`). **Leave `GEMINI_DIR` at its default** so the user's login is found; inject MCP only via `GEMINI_CLI_SYSTEM_SETTINGS_PATH`. (Do **not** isolate `GEMINI_DIR`, or you'd lose auth — same trap as Codex's `CODEX_HOME`, but here we have a *settings-only* env so no auth bridge is needed.)

### B5. Output transcoding → claude:event **[D] types / [P-AUTH] fields**
- stream-json event `type`s (Gemini `docs/cli/headless.md`): **`init`** (session id, model), **`message`** (user/assistant chunks), **`tool_use`** (call + arguments), **`tool_result`** (tool output), **`error`** (non-fatal), **`result`** (final + aggregated stats). Claude-adjacent naming.
- Final stats (`StreamStats`, `packages/core/src/output/types.ts`): `{ total_tokens, input_tokens, output_tokens, cached, input, duration_ms, tool_calls, models: {…} }`. **No $ cost** → `total_cost_usd: 0` → "subscription".
- **Exact per-event field nesting (e.g. does `message` carry `{content}` vs `{message:{content:[…]}}`, tool_use field names) is NOT documented verbatim and must be captured from a real run [P-AUTH].** Transcoder maps `init.session_id`→session, `message`(assistant)→assistant text, `tool_use`→tool_use, `tool_result`→tool_result, `result`→result+exit.

> **[P-AUTH] fixtures:** capture one real `gemini -p "…" -o stream-json --skip-trust --approval-mode yolo` run (with orion MCP attached) covering init / assistant message / tool_use / tool_result / result. Lock the transcoder fields against them.

### B6. Native edit tools disable-able? (§6) **[D]**
- Gemini native tools (registry names, docs): `write_file`, `replace`, `edit`, `run_shell_command`, `read_file`, `read_many_files`, `glob`, `search_file_content`, `web_fetch`, `google_web_search`, `save_memory`, `list_directory`.
- **`excludeTools` settings key** (and `coreTools`) can suppress built-ins → set `"excludeTools": ["write_file","replace","edit"]` in our system settings so file writes route through the Orion MCP `orion_apply_edit`/`orion_write_file` → **§6 PARITY (target)**: edits land in the Accept/Reject DiffReview.
- Confirm `excludeTools` actually removes those tools at login **[P-AUTH]**; if not, fall back to the working-tree/Changes-panel story like Codex.

### B7. Auth-state artifact (cli_status) **[M]/[D]**
- **No `gemini login` subcommand** and **no login-status subcommand**. Unauth headless run printed a plain-text error: *"Please set an Auth method in your ~/.gemini/settings.json or specify one of: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA"* **[M]** (so cli_status cannot rely on stream-json when unauth — it errors first).
- **Probe = artifact presence:** `~/.gemini/oauth_creds.json` (and/or `google_accounts.json`) after the user signs in via an interactive `gemini` run (browser OAuth) **[D]** → confirm exact filename post-login **[P-AUTH]**.
- Installed probe: `gemini --version` → `0.47.0`.
- Login instruction to surface when not logged in: run `gemini` once interactively and pick "Login with Google".

---

## C. Section-6 edit-review outcome (summary)

| Engine | Native edit disable mechanism | Likely §6 outcome |
|---|---|---|
| Codex | none / sandbox `apply_patch` (no `--disallowed-tools`) | **Fallback** (working tree → Changes panel); confirm parity option at login |
| Gemini | `excludeTools: ["write_file","replace","edit"]` in settings | **Parity target** (route to `orion_apply_edit` → DiffReview); confirm at login |

Control Panel status copy must reflect the *actual* outcome per engine — no silent pretense (spec §6).

---

## D. What the plan can implement with full confidence NOW (all [M])
- `cli_status` (codex: `codex login status` exit code + `$CODEX_HOME/auth.json`; gemini: `gemini --version` + `~/.gemini/oauth_creds.json` presence) — reuses `lsp_probe`.
- `codex_mcp_config(server) -> String` **TOML** writer (exact schema in A4) — pure, unit-tested.
- `gemini_mcp_config(server) -> String` **JSON** writer (exact schema in B4, incl. `trust:true` + `excludeTools`) — pure, unit-tested.
- Spawn flags: Codex `exec --json -m … -a never -s workspace-write --skip-git-repo-check -C <root>` + `CODEX_HOME`=isolated (auth.json bridged). Gemini `-p <prompt> -o stream-json -m … --skip-trust --approval-mode yolo` + `GEMINI_CLI_SYSTEM_SETTINGS_PATH`=generated, cwd=root.
- `dispatchSend` routing branch + seed of the two built-in providers.

## E. What is gated on the user's first logged-in run ([P-AUTH])
- Exact subscription **model ids** (both).
- **Success-path output-line fixtures** (both) → validate `codex_line_to_events` / `gemini_line_to_events`.
- Gemini stream-json **exact field nesting**.
- Codex native-edit suppression option; Gemini `excludeTools` effectiveness → final §6 outcome per engine.
- Gemini auth artifact exact filename.
