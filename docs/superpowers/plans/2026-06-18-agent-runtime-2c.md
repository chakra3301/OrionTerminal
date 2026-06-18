# Agent Runtime Phase 2c — Subscription CLI Engines (Codex + Gemini) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, batch execution with review checkpoints — the user chose inline, NOT subagent-driven). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI Codex CLI and Google Gemini CLI as subscription-aware subprocess engines so a logged-in ChatGPT/Google user gets the same no-API-key chat + tools experience as Claude users, via the existing `claude:event`/`claude:exit` contract and the `orion --mcp-serve` MCP server.

**Architecture:** This is the **Claude-CLI subprocess pattern** ([claude_cli.rs](../../../src-tauri/src/claude_cli.rs)), NOT the Phase 2a/2b HTTP runtime. A new Rust module `src-tauri/src/cli_engine/` spawns `codex exec --json` / `gemini -p -o stream-json`, attaches the Orion MCP server via an **isolated** config (Codex `CODEX_HOME`+`config.toml`; Gemini `GEMINI_CLI_SYSTEM_SETTINGS_PATH`+settings.json), and transcodes each engine's output stream into the Claude event shapes the frontend already renders. Tools (including reviewable edits) come "for free" through the same MCP server + TCP bridge → DiffReview that Claude uses. `dispatchSend` gains a third routing branch (`codex_cli`/`gemini_cli` → `ipc.cliSend`). The Claude path, HTTP-runtime path, and `--mcp-serve` path are byte-identical after this work.

**Tech Stack:** Rust (tokio process/stream, serde_json), Tauri commands, TypeScript/React (Zustand stores, vitest), the installed `codex-cli 0.141.0` + `gemini 0.47.0`.

**Spike findings (READ FIRST):** [2026-06-18-agent-runtime-2c-spike-findings.md](../specs/2026-06-18-agent-runtime-2c-spike-findings.md). Spec: [2026-06-18-agent-runtime-2c-design.md](../specs/2026-06-18-agent-runtime-2c-design.md).

## Global Constraints

- **No emoji, ever.** Match Orion styling for any Control Panel UI (glass `cp-card`, mono eyebrows, `rgba(var(--*-rgb))`, lucide icons).
- **Non-regression (test-enforced):** `dispatchSend` routes `kind === "anthropic"` → `claudeSend` byte-identical (existing routing test stays green); `runtime_send` and the `--mcp-serve` subprocess path are untouched; `claude_send` flags unchanged. New `ProviderKind` members, `cli_send`/`cli_cancel`/`cli_status`, and provider seeds are purely additive.
- **Pure transcoders + config writers fully unit-tested, network-free, no subprocess spawned in tests.**
- **Built-in CLI providers seed at runtime (no DB migration), like `builtin:anthropic`.**
- **Provisional fixtures:** success-path output lines for both engines are doc-grounded (Codex from the codex repo schema; Gemini event-type-level). They MUST be validated against the user's first logged-in run before the transcoder tasks are considered fully done. Each transcoder task carries a `[P-AUTH] VALIDATE` checkpoint.
- **Detection reuses the `lsp_probe` pattern** (`<bin> --version` on `augmented_path()`).
- **Gates every task:** `npx tsc --noEmit` · `npx vitest run` · `cargo test && cargo check` (run in `src-tauri/`) · `npm run build` (exit 0).
- **Commit only the files each task names.** End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- A `tauri dev` restart is required before smoke-testing (new Rust module + commands). Engine wiring tasks end at the user smoke checklist (spec §10) — the agent cannot run Tauri or the external CLIs.

## Confirmed engine facts (from the spike — use verbatim)

**Codex:** `codex exec --json -m <model> -a never -s workspace-write --skip-git-repo-check -C <cwd>`; prompt on stdin. `CODEX_HOME=<isolated dir>` holds our `config.toml` AND a copy of the user's `~/.codex/auth.json` (CODEX_HOME relocates auth). Events (stdout JSONL): `thread.started{thread_id}`, `turn.started`, `item.completed{item:{id,type,...}}`, `turn.completed{usage}`, `turn.failed{error}`, `error{message}`. Item types: `agent_message{id,text}`, `mcp_tool_call{id,server,tool,arguments,status,result?,error?}`, `command_execution{id,command,exit_code}`, `reasoning`, `file_change`, `web_search`, `todo_list`, `error`. No `--disallowed-tools` → §6 **fallback** (edits → working tree → Changes panel). Auth probe: `codex login status` (exit 0 = logged in). Installed probe: `codex --version`.

**Gemini:** `gemini -p <prompt> -o stream-json -m <model> --skip-trust --approval-mode yolo` (cwd = project root). `GEMINI_CLI_SYSTEM_SETTINGS_PATH=<our settings.json>` injects MCP non-invasively; leave `GEMINI_DIR` default so the user's login is found. settings.json: `{mcpServers:{orion:{command,args,env,trust:true}}, excludeTools:["write_file","replace","edit"]}` → §6 **parity** (edits route to `orion_apply_edit` → DiffReview). stream-json event types: `init`, `message`, `tool_use`, `tool_result`, `error`, `result`. Auth probe: presence of `~/.gemini/oauth_creds.json`. Installed probe: `gemini --version`.

**Frontend event contract (confirmed in [EventBridge.tsx](../../../src/app/EventBridge.tsx)):** session id read from `{type:"system",subtype:"init",session_id}` and `{type:"result",total_cost_usd,session_id}`. Assistant snapshot: `{type:"assistant",message:{id,content:[blocks]}}` with `{type:"text",text}` / `{type:"tool_use",id,name,input}`. Tool result: `{type:"user",message:{content:[{type:"tool_result",tool_use_id,content,is_error}]}}`.

---

### Task 1: Extend ProviderKind + seed two built-in CLI providers

**Files:**
- Modify: `src/features/agents/agentTypes.ts:1`
- Modify: `src/features/agents/seedData.ts`
- Test: `src/features/agents/seedData.test.ts`

**Interfaces:**
- Produces: `ProviderKind` now includes `"codex_cli" | "gemini_cli"`; `CODEX_CLI_PROVIDER` and `GEMINI_CLI_PROVIDER` exported `Provider` constants (`id: "builtin:codex-cli"` / `"builtin:gemini-cli"`, `builtin: true`, `enabled: true`, `keyRef: ""`, `baseUrl: ""`).

- [ ] **Step 1: Write the failing test**

Add to `src/features/agents/seedData.test.ts`:

```ts
import { CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER } from "./seedData";

describe("CLI engine built-in providers", () => {
  it("codex provider is a builtin codex_cli with models and no key", () => {
    expect(CODEX_CLI_PROVIDER.id).toBe("builtin:codex-cli");
    expect(CODEX_CLI_PROVIDER.kind).toBe("codex_cli");
    expect(CODEX_CLI_PROVIDER.builtin).toBe(true);
    expect(CODEX_CLI_PROVIDER.keyRef).toBe("");
    expect(CODEX_CLI_PROVIDER.models.length).toBeGreaterThan(0);
  });
  it("gemini provider is a builtin gemini_cli with models", () => {
    expect(GEMINI_CLI_PROVIDER.id).toBe("builtin:gemini-cli");
    expect(GEMINI_CLI_PROVIDER.kind).toBe("gemini_cli");
    expect(GEMINI_CLI_PROVIDER.builtin).toBe(true);
    expect(GEMINI_CLI_PROVIDER.models.some((m) => m.id === "gemini-2.5-pro")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agents/seedData.test.ts`
Expected: FAIL — `CODEX_CLI_PROVIDER`/`GEMINI_CLI_PROVIDER` not exported.

- [ ] **Step 3: Implement**

In `agentTypes.ts:1` extend the union:

```ts
export type ProviderKind =
  | "anthropic" | "openai" | "google" | "openai_compat" | "custom"
  | "codex_cli" | "gemini_cli";
```

Append to `seedData.ts` (provisional model ids — `[P-AUTH]` confirm post-login):

```ts
// Subscription CLI engines (Phase 2c). Models are provisional pending a
// logged-in run; ids match the engines' -m/--model flag values.
export const CODEX_CLI_PROVIDER: Provider = {
  id: "builtin:codex-cli",
  name: "OpenAI Codex (CLI)",
  kind: "codex_cli",
  baseUrl: "",
  models: [
    { id: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
    { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
  ],
  keyRef: "",
  enabled: true,
  builtin: true,
};

export const GEMINI_CLI_PROVIDER: Provider = {
  id: "builtin:gemini-cli",
  name: "Google Gemini (CLI)",
  kind: "gemini_cli",
  baseUrl: "",
  models: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  keyRef: "",
  enabled: true,
  builtin: true,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/agents/seedData.test.ts` → PASS.

- [ ] **Step 5: Gates + commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/features/agents/agentTypes.ts src/features/agents/seedData.ts src/features/agents/seedData.test.ts
git commit -m "feat(runtime-2c): add codex_cli/gemini_cli provider kinds + builtin seeds"
```

---

### Task 2: Idempotently seed both CLI providers in providersStore.load()

**Files:**
- Modify: `src/store/providersStore.ts`
- Test: `src/store/providersStore.test.ts` (create)

**Interfaces:**
- Consumes: `CODEX_CLI_PROVIDER`, `GEMINI_CLI_PROVIDER` (Task 1).
- Produces: after `load()`, all three built-in providers (anthropic + 2 CLI) are present exactly once.

- [ ] **Step 1: Write the failing test**

Create `src/store/providersStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
vi.mock("@/lib/agentsDb", () => ({
  listProviders: vi.fn(async () => rows.slice()),
  upsertProvider: vi.fn(async (p: any) => { if (!rows.some((r) => r.id === p.id)) rows.push(p); }),
  deleteProvider: vi.fn(async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); }),
}));

import { useProvidersStore } from "./providersStore";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER } from "@/features/agents/seedData";

beforeEach(() => { rows.length = 0; useProvidersStore.setState({ providers: [], loaded: false }); });

describe("providersStore seeding", () => {
  it("seeds anthropic + both CLI engines when DB is empty", async () => {
    await useProvidersStore.getState().load();
    const ids = useProvidersStore.getState().providers.map((p) => p.id);
    expect(ids).toContain(BUILTIN_PROVIDER.id);
    expect(ids).toContain(CODEX_CLI_PROVIDER.id);
    expect(ids).toContain(GEMINI_CLI_PROVIDER.id);
  });
  it("is idempotent — second load does not duplicate", async () => {
    await useProvidersStore.getState().load();
    await useProvidersStore.getState().load();
    const codex = useProvidersStore.getState().providers.filter((p) => p.id === CODEX_CLI_PROVIDER.id);
    expect(codex.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/providersStore.test.ts`
Expected: FAIL — CLI providers not seeded.

- [ ] **Step 3: Implement**

In `providersStore.ts` update the import and `load()`:

```ts
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER } from "@/features/agents/seedData";
```

Replace the seed block inside `load()`:

```ts
  load: async () => {
    try {
      let rows = await listProviders();
      const seeds = [BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER];
      let seeded = false;
      for (const s of seeds) {
        if (!rows.some((p) => p.id === s.id)) { await upsertProvider(s); seeded = true; }
      }
      if (seeded) rows = await listProviders();
      set({ providers: rows, loaded: true });
    } catch (e) {
      log.warn("providers load failed", e);
      set({ loaded: true });
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/providersStore.test.ts` → PASS.

- [ ] **Step 5: Gates + commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/store/providersStore.ts src/store/providersStore.test.ts
git commit -m "feat(runtime-2c): seed codex/gemini CLI providers idempotently on load"
```

---

### Task 3: ipc wrappers — cliSend / cliCancel / cliStatus

**Files:**
- Modify: `src/lib/ipc.ts` (after the `runtimeCancel` wrapper, ~line 208)

**Interfaces:**
- Produces: `ipc.cliSend(engine, chatId, prompt, projectRoot, sessionId, model, systemAppend)`, `ipc.cliCancel(chatId)`, `ipc.cliStatus(engine) → Promise<CliStatus>` where `CliStatus = { installed: boolean; loggedIn: boolean; version: string | null; detail: string }`.

- [ ] **Step 1: Implement (thin invoke wrappers — covered by Task 4's routing test mock + Rust tests)**

Add to `ipc.ts` after `runtimeCancel`:

```ts
  cliSend: (
    engine: "codex_cli" | "gemini_cli",
    chatId: string,
    prompt: string,
    projectRoot: string | null,
    sessionId: string | null,
    model: string,
    systemAppend: string,
  ): Promise<void> =>
    invoke("cli_send", {
      engine,
      chatId,
      prompt,
      projectRoot,
      sessionId,
      model,
      systemAppend,
    }),
  cliCancel: (chatId: string): Promise<void> => invoke("cli_cancel", { chatId }),
  cliStatus: (
    engine: "codex_cli" | "gemini_cli",
  ): Promise<{ installed: boolean; loggedIn: boolean; version: string | null; detail: string }> =>
    invoke("cli_status", { engine }),
```

- [ ] **Step 2: Gate + commit**

Run: `npx tsc --noEmit`
Expected: PASS (no usage yet; types compile).

```bash
git add src/lib/ipc.ts
git commit -m "feat(runtime-2c): add cliSend/cliCancel/cliStatus ipc wrappers"
```

---

### Task 4: dispatchSend routing branch for CLI engines + extend routing test

**Files:**
- Modify: `src/features/agents/dispatchSend.ts`
- Test: `src/features/agents/dispatchSend.routing.test.ts`

**Interfaces:**
- Consumes: `ipc.cliSend`/`ipc.cliCancel` (Task 3).
- Produces: `routeFor` returns `{ engine: "codex_cli" | "gemini_cli" }` for CLI provider kinds; `dispatchSend`/`dispatchCancel` route those to `cliSend`/`cliCancel`. Anthropic + HTTP-runtime branches unchanged.

- [ ] **Step 1: Write the failing test**

Add to `dispatchSend.routing.test.ts`. First extend the ipc mock (top of file) to include the new fns:

```ts
vi.mock("@/lib/ipc", () => ({
  ipc: {
    claudeSend: vi.fn().mockResolvedValue(undefined),
    runtimeSend: vi.fn().mockResolvedValue(undefined),
    claudeCancel: vi.fn().mockResolvedValue(undefined),
    runtimeCancel: vi.fn().mockResolvedValue(undefined),
    cliSend: vi.fn().mockResolvedValue(undefined),
    cliCancel: vi.fn().mockResolvedValue(undefined),
  },
}));
```

Add the two CLI providers to the `beforeEach` providers list and add tests:

```ts
import { CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER } from "./seedData";

// in beforeEach:
useProvidersStore.setState({
  providers: [BUILTIN_PROVIDER, openai, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER],
  loaded: true,
});

describe("dispatchSend CLI routing (Phase 2c)", () => {
  it("a codex model routes to cliSend and never claudeSend/runtimeSend", async () => {
    await dispatchSend({
      chatId: "c3", value: "gpt-5.1-codex", prompt: "PROMPT",
      history: [], projectRoot: "/proj", sessionId: "t1",
    });
    expect(ipc.cliSend).toHaveBeenCalledTimes(1);
    expect(ipc.cliSend).toHaveBeenCalledWith(
      "codex_cli", "c3", "PROMPT", "/proj", "t1", "gpt-5.1-codex", "",
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
    expect(ipc.runtimeSend).not.toHaveBeenCalled();
  });
  it("a gemini model routes to cliSend with the gemini_cli engine", async () => {
    await dispatchSend({ chatId: "c4", value: "gemini-2.5-pro", prompt: "P", history: [] });
    expect(ipc.cliSend).toHaveBeenCalledWith(
      "gemini_cli", "c4", "P", null, null, "gemini-2.5-pro", "",
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
  });
  it("cancel routes a CLI selection to cliCancel", async () => {
    await dispatchCancel("c3", "gpt-5.1-codex");
    expect(ipc.cliCancel).toHaveBeenCalledWith("c3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agents/dispatchSend.routing.test.ts`
Expected: FAIL — `routeFor` still returns a Provider for CLI kinds; `cliSend` never called.

- [ ] **Step 3: Implement**

In `dispatchSend.ts`, change `routeFor` and the dispatch/cancel functions:

```ts
export type CliEngine = "codex_cli" | "gemini_cli";
export type Route = "claude" | { engine: CliEngine } | Provider;

export function routeFor(providers: Provider[], model: string): Route {
  const owner = findOwningProvider(providers, model);
  if (!owner || owner.kind === "anthropic") return "claude";
  if (owner.kind === "codex_cli" || owner.kind === "gemini_cli") return { engine: owner.kind };
  return owner;
}
```

In `dispatchSend`, after computing `route`:

```ts
  if (route === "claude") {
    return ipc.claudeSend(/* unchanged */
      args.chatId, args.prompt, args.projectRoot ?? null, args.sessionId ?? null,
      args.imagePath ?? null, r.model, r.systemAppend, r.allowedTools,
    );
  }
  if (typeof route === "object" && "engine" in route) {
    return ipc.cliSend(
      route.engine, args.chatId, args.prompt,
      args.projectRoot ?? null, args.sessionId ?? null,
      r.model, r.systemAppend ?? "",
    );
  }
  return ipc.runtimeSend(/* unchanged */
    args.chatId, route.kind, route.baseUrl, route.keyRef, r.model,
    r.systemAppend ?? "", args.history, mapToRuntimeTools(r.allowedTools),
  );
```

In `dispatchCancel`:

```ts
  if (route === "claude") return ipc.claudeCancel(chatId);
  if (typeof route === "object" && "engine" in route) return ipc.cliCancel(chatId);
  return ipc.runtimeCancel(chatId);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/agents/dispatchSend.routing.test.ts`
Expected: PASS — including the **unchanged** Task-0 anthropic byte-identical + runtime tests.

- [ ] **Step 5: Gates + commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/features/agents/dispatchSend.ts src/features/agents/dispatchSend.routing.test.ts
git commit -m "feat(runtime-2c): route codex_cli/gemini_cli to cliSend (non-regression preserved)"
```

---

### Task 5: Rust cli_engine module scaffold + lib.rs registration

**Files:**
- Create: `src-tauri/src/cli_engine/mod.rs`
- Modify: `src-tauri/src/lib.rs:24` (add `mod cli_engine;`)

**Interfaces:**
- Produces: `pub enum CliEngine { Codex, Gemini }` with `pub fn from_str(&str) -> Option<CliEngine>`; empty submodule wiring so later tasks compile. No Tauri commands yet.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/cli_engine/mod.rs`:

```rust
//! Subscription-CLI subprocess engines (Phase 2c): OpenAI Codex CLI + Google
//! Gemini CLI. Mirrors `claude_cli`'s spawn/stream/cancel lifecycle and the
//! Orion MCP attachment, transcoding each engine's output into the
//! `claude:event`/`claude:exit` contract. Additive — no existing path changes.

pub mod config;
pub mod transcode;
pub mod codex;
pub mod gemini;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliEngine {
    Codex,
    Gemini,
}

impl CliEngine {
    pub fn from_str(s: &str) -> Option<CliEngine> {
        match s {
            "codex_cli" => Some(CliEngine::Codex),
            "gemini_cli" => Some(CliEngine::Gemini),
            _ => None,
        }
    }
}

#[cfg(test)]
mod engine_tests {
    use super::CliEngine;
    #[test]
    fn parses_known_engines() {
        assert_eq!(CliEngine::from_str("codex_cli"), Some(CliEngine::Codex));
        assert_eq!(CliEngine::from_str("gemini_cli"), Some(CliEngine::Gemini));
        assert_eq!(CliEngine::from_str("anthropic"), None);
    }
}
```

Create the four empty submodule files so it compiles:
- `src-tauri/src/cli_engine/config.rs` → `//! MCP config writers (Task 6/7).`
- `src-tauri/src/cli_engine/transcode.rs` → `//! Output transcoders (Task 8/9).`
- `src-tauri/src/cli_engine/codex.rs` → `//! Codex spawn spec (Task 11).`
- `src-tauri/src/cli_engine/gemini.rs` → `//! Gemini spawn spec (Task 12).`

In `lib.rs` after `mod claude_cli;` (line ~7) or alphabetically near top, add:

```rust
mod cli_engine;
```

- [ ] **Step 2: Run test to verify it fails then passes**

Run (in `src-tauri/`): `cargo test cli_engine::engine_tests`
Expected: PASS after the files exist (the test is trivially green once it compiles; the point is the scaffold compiles cleanly).

- [ ] **Step 3: Gates + commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/cli_engine/ src-tauri/src/lib.rs
git commit -m "feat(runtime-2c): cli_engine module scaffold + CliEngine enum"
```

---

### Task 6: codex_mcp_config — TOML writer (pure, TDD)

**Files:**
- Modify: `src-tauri/src/cli_engine/config.rs`
- Modify: `src-tauri/src/mcp_config.rs` (add `pub` accessor for the Orion server pieces)

**Interfaces:**
- Produces: `pub struct OrionServer { pub command: String, pub args: Vec<String>, pub env: Vec<(String, String)> }`; `pub fn codex_mcp_config(s: &OrionServer) -> String` returns a `config.toml` body with `[mcp_servers.orion]` (command/args) + `[mcp_servers.orion.env]`. `env` is rendered sorted for determinism.

- [ ] **Step 1: Write the failing test**

In `config.rs`:

```rust
use std::fmt::Write as _;

/// The Orion MCP server definition, decomposed for serialization into each
/// CLI's config schema. Mirrors the `orion` server `mcp_config::write` emits.
#[derive(Debug, Clone)]
pub struct OrionServer {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

fn toml_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Render a Codex `config.toml` body attaching the Orion MCP server.
/// Schema confirmed live: `[mcp_servers.orion]` command/args + nested env table.
pub fn codex_mcp_config(s: &OrionServer) -> String {
    let mut env = s.env.clone();
    env.sort_by(|a, b| a.0.cmp(&b.0));
    let mut out = String::new();
    let _ = writeln!(out, "[mcp_servers.orion]");
    let _ = writeln!(out, "command = \"{}\"", toml_escape(&s.command));
    let args: Vec<String> = s.args.iter().map(|a| format!("\"{}\"", toml_escape(a))).collect();
    let _ = writeln!(out, "args = [{}]", args.join(", "));
    let _ = writeln!(out);
    let _ = writeln!(out, "[mcp_servers.orion.env]");
    for (k, v) in &env {
        let _ = writeln!(out, "{} = \"{}\"", k, toml_escape(v));
    }
    out
}

#[cfg(test)]
mod codex_config_tests {
    use super::*;
    fn sample() -> OrionServer {
        OrionServer {
            command: "/Apps/Orion.app/Contents/MacOS/orion".into(),
            args: vec!["--mcp-serve".into()],
            env: vec![
                ("ORION_DB_PATH".into(), "/x/orion.db".into()),
                ("ORION_BRIDGE_PORT".into(), "7777".into()),
            ],
        }
    }
    #[test]
    fn writes_codex_toml_with_sorted_env() {
        let t = codex_mcp_config(&sample());
        assert!(t.contains("[mcp_servers.orion]"));
        assert!(t.contains("command = \"/Apps/Orion.app/Contents/MacOS/orion\""));
        assert!(t.contains("args = [\"--mcp-serve\"]"));
        assert!(t.contains("[mcp_servers.orion.env]"));
        // sorted: BRIDGE_PORT before DB_PATH
        let bp = t.find("ORION_BRIDGE_PORT").unwrap();
        let db = t.find("ORION_DB_PATH").unwrap();
        assert!(bp < db);
    }
    #[test]
    fn escapes_quotes_and_backslashes() {
        let mut s = sample();
        s.command = "/weird\"path".into();
        assert!(codex_mcp_config(&s).contains("command = \"/weird\\\"path\""));
    }
}
```

In `mcp_config.rs` add a pure accessor (reuse the existing `write()` logic without writing a file). Add at the end of the file:

```rust
/// Decompose the Orion MCP server into command/args/env for the CLI-engine
/// config writers (Phase 2c). Mirrors the `orion` server `write()` emits.
/// Returns None if the current exe / config dir can't be resolved.
pub fn orion_server(app: &AppHandle) -> Option<crate::cli_engine::config::OrionServer> {
    let exe = std::env::current_exe().ok()?;
    let config_dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&config_dir);
    let db_path = config_dir.join("orion.db");
    let context_path = config_dir.join("orion-context.json");
    let mut env: Vec<(String, String)> = vec![
        ("ORION_DB_PATH".into(), db_path.to_string_lossy().into_owned()),
        ("ORION_CONTEXT_PATH".into(), context_path.to_string_lossy().into_owned()),
    ];
    if let Some(bridge) = crate::ui_bridge::current() {
        env.push(("ORION_BRIDGE_PORT".into(), bridge.port.to_string()));
        env.push(("ORION_BRIDGE_TOKEN".into(), bridge.token.clone()));
    }
    Some(crate::cli_engine::config::OrionServer {
        command: exe.to_string_lossy().into_owned(),
        args: vec!["--mcp-serve".into()],
        env,
    })
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `src-tauri/`): `cargo test codex_config_tests`
Expected: initially FAILS to compile until both edits land; then PASS.

- [ ] **Step 3: Run + gates**

Run: `cargo test codex_config_tests && cargo check` → PASS.

- [ ] **Step 4: Commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/cli_engine/config.rs src-tauri/src/mcp_config.rs
git commit -m "feat(runtime-2c): codex config.toml MCP writer + orion_server accessor"
```

---

### Task 7: gemini_mcp_config — JSON writer (pure, TDD)

**Files:**
- Modify: `src-tauri/src/cli_engine/config.rs`

**Interfaces:**
- Consumes: `OrionServer` (Task 6).
- Produces: `pub fn gemini_mcp_config(s: &OrionServer) -> String` returning JSON: `{ "mcpServers": { "orion": { command, args, env, trust: true } }, "excludeTools": ["write_file","replace","edit"] }`.

- [ ] **Step 1: Write the failing test**

Append to `config.rs`:

```rust
/// Render a Gemini `settings.json` body attaching the Orion MCP server with
/// `trust:true` (auto-approve its tool calls) and excluding the native edit
/// tools so writes route through the Orion MCP edit tools (§6 parity).
pub fn gemini_mcp_config(s: &OrionServer) -> String {
    let env: serde_json::Map<String, serde_json::Value> = s
        .env
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
        .collect();
    let v = serde_json::json!({
        "mcpServers": {
            "orion": {
                "command": s.command,
                "args": s.args,
                "env": env,
                "trust": true,
            }
        },
        "excludeTools": ["write_file", "replace", "edit"],
    });
    serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".into())
}

#[cfg(test)]
mod gemini_config_tests {
    use super::*;
    #[test]
    fn writes_gemini_settings_json() {
        let s = OrionServer {
            command: "/orion".into(),
            args: vec!["--mcp-serve".into()],
            env: vec![("ORION_DB_PATH".into(), "/x/orion.db".into())],
        };
        let json = gemini_mcp_config(&s);
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["mcpServers"]["orion"]["command"], "/orion");
        assert_eq!(v["mcpServers"]["orion"]["args"][0], "--mcp-serve");
        assert_eq!(v["mcpServers"]["orion"]["trust"], true);
        assert_eq!(v["mcpServers"]["orion"]["env"]["ORION_DB_PATH"], "/x/orion.db");
        let ex = v["excludeTools"].as_array().unwrap();
        assert!(ex.iter().any(|t| t == "write_file"));
        assert!(ex.iter().any(|t| t == "replace"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test gemini_config_tests` → FAIL (fn missing), then implement (above) → re-run.

- [ ] **Step 3: Run + gates + commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/cli_engine/config.rs
git commit -m "feat(runtime-2c): gemini settings.json MCP writer (trust + excludeTools)"
```

---

### Task 8: codex_line_to_events — transcoder (pure, TDD, [P-AUTH] fixtures)

**Files:**
- Modify: `src-tauri/src/cli_engine/transcode.rs`

**Interfaces:**
- Produces: `pub struct CodexState { pub thread_id: Option<String> }` (default empty) and `pub fn codex_line_to_events(line: &str, st: &mut CodexState) -> Vec<serde_json::Value>` mapping one Codex JSONL line to zero+ `claude:event` values. Non-JSON / unknown lines → `vec![]`.

> **[P-AUTH] VALIDATE:** fixtures below are built from the codex repo schema (`exec_events.rs`, `sdk/typescript/src/items.ts`). After the user runs `codex login` + one `codex exec --json` turn against the Orion MCP server, diff a real `agent_message` / `mcp_tool_call` / `turn.completed` line against these and patch if fields differ. Do NOT mark the engine "done" until validated.

- [ ] **Step 1: Write the failing test**

In `transcode.rs`:

```rust
use serde_json::{json, Value};

#[derive(Default)]
pub struct CodexState {
    pub thread_id: Option<String>,
}

fn obj(line: &str) -> Option<Value> {
    serde_json::from_str::<Value>(line).ok().filter(|v| v.is_object())
}

/// Map one Codex `exec --json` JSONL line to claude:event values.
pub fn codex_line_to_events(line: &str, st: &mut CodexState) -> Vec<Value> {
    let Some(v) = obj(line) else { return vec![] };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("thread.started") => {
            let tid = v.get("thread_id").and_then(|s| s.as_str()).unwrap_or("").to_string();
            st.thread_id = Some(tid.clone());
            vec![json!({ "type": "system", "subtype": "init", "session_id": tid })]
        }
        Some("item.completed") => {
            let item = match v.get("item") { Some(i) => i, None => return vec![] };
            let id = item.get("id").and_then(|s| s.as_str()).unwrap_or("item").to_string();
            match item.get("type").and_then(|t| t.as_str()) {
                Some("agent_message") => {
                    let text = item.get("text").and_then(|s| s.as_str()).unwrap_or("");
                    vec![json!({ "type": "assistant", "message": {
                        "id": id, "content": [{ "type": "text", "text": text }] } })]
                }
                Some("mcp_tool_call") => {
                    let tool = item.get("tool").and_then(|s| s.as_str()).unwrap_or("tool");
                    let input = item.get("arguments").cloned().unwrap_or_else(|| json!({}));
                    let is_error = item.get("error").is_some()
                        || item.get("status").and_then(|s| s.as_str()).map(|s| s != "completed").unwrap_or(false);
                    let content = if let Some(err) = item.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
                        err.to_string()
                    } else {
                        item.get("result").map(|r| r.to_string()).unwrap_or_default()
                    };
                    vec![
                        json!({ "type": "assistant", "message": { "id": id, "content": [
                            { "type": "tool_use", "id": id, "name": tool, "input": input } ] } }),
                        json!({ "type": "user", "message": { "content": [
                            { "type": "tool_result", "tool_use_id": id, "content": content, "is_error": is_error } ] } }),
                    ]
                }
                Some("command_execution") => {
                    let command = item.get("command").and_then(|s| s.as_str()).unwrap_or("");
                    let exit = item.get("exit_code").and_then(|e| e.as_i64()).unwrap_or(0);
                    vec![
                        json!({ "type": "assistant", "message": { "id": id, "content": [
                            { "type": "tool_use", "id": id, "name": "shell", "input": { "command": command } } ] } }),
                        json!({ "type": "user", "message": { "content": [
                            { "type": "tool_result", "tool_use_id": id, "content": format!("exit {exit}"), "is_error": exit != 0 } ] } }),
                    ]
                }
                Some("error") => {
                    let msg = item.get("message").and_then(|m| m.as_str()).unwrap_or("error");
                    vec![json!({ "type": "stderr", "text": msg })]
                }
                _ => vec![], // reasoning / file_change / web_search / todo_list: ignored in v1
            }
        }
        Some("turn.completed") => {
            vec![json!({ "type": "result", "total_cost_usd": 0,
                "session_id": st.thread_id.clone().unwrap_or_default() })]
        }
        Some("turn.failed") => {
            let msg = v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).unwrap_or("turn failed");
            vec![json!({ "type": "stderr", "text": msg })]
        }
        Some("error") => {
            let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or("error");
            vec![json!({ "type": "stderr", "text": msg })]
        }
        _ => vec![],
    }
}

#[cfg(test)]
mod codex_transcode_tests {
    use super::*;
    #[test]
    fn thread_started_emits_init_and_sets_session() {
        let mut st = CodexState::default();
        let ev = codex_line_to_events("{\"type\":\"thread.started\",\"thread_id\":\"019abc\"}", &mut st);
        assert_eq!(ev[0]["type"], "system");
        assert_eq!(ev[0]["subtype"], "init");
        assert_eq!(ev[0]["session_id"], "019abc");
        assert_eq!(st.thread_id.as_deref(), Some("019abc"));
    }
    #[test]
    fn agent_message_emits_assistant_text() {
        let mut st = CodexState::default();
        let ev = codex_line_to_events(
            "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"Hi\"}}",
            &mut st);
        assert_eq!(ev[0]["type"], "assistant");
        assert_eq!(ev[0]["message"]["content"][0]["text"], "Hi");
    }
    #[test]
    fn mcp_tool_call_emits_use_and_result_pair() {
        let mut st = CodexState::default();
        let line = "{\"type\":\"item.completed\",\"item\":{\"id\":\"it1\",\"type\":\"mcp_tool_call\",\"server\":\"orion\",\"tool\":\"orion_read_file\",\"arguments\":{\"path\":\"a.ts\"},\"status\":\"completed\",\"result\":{\"content\":[]}}}";
        let ev = codex_line_to_events(line, &mut st);
        assert_eq!(ev.len(), 2);
        assert_eq!(ev[0]["message"]["content"][0]["type"], "tool_use");
        assert_eq!(ev[0]["message"]["content"][0]["name"], "orion_read_file");
        assert_eq!(ev[0]["message"]["content"][0]["input"]["path"], "a.ts");
        assert_eq!(ev[1]["message"]["content"][0]["type"], "tool_result");
        assert_eq!(ev[1]["message"]["content"][0]["tool_use_id"], "it1");
        assert_eq!(ev[1]["message"]["content"][0]["is_error"], false);
    }
    #[test]
    fn failed_tool_call_marks_error() {
        let mut st = CodexState::default();
        let line = "{\"type\":\"item.completed\",\"item\":{\"id\":\"it2\",\"type\":\"mcp_tool_call\",\"tool\":\"x\",\"status\":\"failed\",\"error\":{\"message\":\"boom\"}}}";
        let ev = codex_line_to_events(line, &mut st);
        assert_eq!(ev[1]["message"]["content"][0]["is_error"], true);
        assert_eq!(ev[1]["message"]["content"][0]["content"], "boom");
    }
    #[test]
    fn turn_completed_emits_result_with_session() {
        let mut st = CodexState { thread_id: Some("019abc".into()) };
        let ev = codex_line_to_events("{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":5}}", &mut st);
        assert_eq!(ev[0]["type"], "result");
        assert_eq!(ev[0]["total_cost_usd"], 0);
        assert_eq!(ev[0]["session_id"], "019abc");
    }
    #[test]
    fn non_json_and_unknown_yield_nothing() {
        let mut st = CodexState::default();
        assert!(codex_line_to_events("2026 ERROR codex_api::foo", &mut st).is_empty());
        assert!(codex_line_to_events("{\"type\":\"turn.started\"}", &mut st).is_empty());
    }
}
```

- [ ] **Step 2: Run test to verify it fails then passes**

Run: `cargo test codex_transcode_tests` → implement → PASS.

- [ ] **Step 3: Gates + commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/cli_engine/transcode.rs
git commit -m "feat(runtime-2c): codex_line_to_events transcoder (provisional fixtures, validate at login)"
```

---

### Task 9: gemini_line_to_events — transcoder (pure, TDD, [P-AUTH] fixtures)

**Files:**
- Modify: `src-tauri/src/cli_engine/transcode.rs`

**Interfaces:**
- Produces: `pub struct GeminiState { pub session_id: Option<String> }` and `pub fn gemini_line_to_events(line: &str, st: &mut GeminiState) -> Vec<serde_json::Value>`. Defensive over optional fields (event field nesting is `[P-AUTH]`).

> **[P-AUTH] VALIDATE:** Gemini stream-json *type names* (`init`/`message`/`tool_use`/`tool_result`/`error`/`result`) are confirmed; exact field nesting is provisional. After the user logs in (interactive `gemini`, "Login with Google") and runs `gemini -p "..." -o stream-json --skip-trust --approval-mode yolo`, capture one of each event line and patch the field accessors below. The transcoder is written defensively (tries `message.content` array, then `content` string, then `text`) to survive minor shape differences, but VALIDATE before "done".

- [ ] **Step 1: Write the failing test**

Append to `transcode.rs`:

```rust
#[derive(Default)]
pub struct GeminiState {
    pub session_id: Option<String>,
}

/// Best-effort extraction of assistant text from a gemini `message` event,
/// tolerant of a few plausible shapes (validate against a real run).
fn gemini_message_text(v: &Value) -> String {
    if let Some(arr) = v.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array()) {
        let mut s = String::new();
        for b in arr {
            if let Some(t) = b.get("text").and_then(|t| t.as_str()) { s.push_str(t); }
        }
        if !s.is_empty() { return s; }
    }
    if let Some(t) = v.get("content").and_then(|c| c.as_str()) { return t.to_string(); }
    if let Some(t) = v.get("text").and_then(|t| t.as_str()) { return t.to_string(); }
    String::new()
}

pub fn gemini_line_to_events(line: &str, st: &mut GeminiState) -> Vec<Value> {
    let Some(v) = obj(line) else { return vec![] };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("init") => {
            let sid = v.get("session_id").and_then(|s| s.as_str())
                .or_else(|| v.get("sessionId").and_then(|s| s.as_str()))
                .unwrap_or("").to_string();
            st.session_id = Some(sid.clone());
            vec![json!({ "type": "system", "subtype": "init", "session_id": sid })]
        }
        Some("message") => {
            // assistant chunks only; ignore echoed user messages
            let role = v.get("role").and_then(|r| r.as_str())
                .or_else(|| v.get("message").and_then(|m| m.get("role")).and_then(|r| r.as_str()))
                .unwrap_or("assistant");
            if role == "user" { return vec![]; }
            let text = gemini_message_text(&v);
            if text.is_empty() { return vec![]; }
            let id = v.get("id").and_then(|s| s.as_str()).unwrap_or("g_msg").to_string();
            vec![json!({ "type": "assistant", "message": { "id": id, "content": [
                { "type": "text", "text": text } ] } })]
        }
        Some("tool_use") => {
            let id = v.get("id").and_then(|s| s.as_str()).unwrap_or("g_tool").to_string();
            let name = v.get("name").and_then(|s| s.as_str()).unwrap_or("tool");
            let input = v.get("input").cloned()
                .or_else(|| v.get("arguments").cloned())
                .unwrap_or_else(|| json!({}));
            vec![json!({ "type": "assistant", "message": { "id": id, "content": [
                { "type": "tool_use", "id": id, "name": name, "input": input } ] } })]
        }
        Some("tool_result") => {
            let id = v.get("tool_use_id").and_then(|s| s.as_str())
                .or_else(|| v.get("id").and_then(|s| s.as_str())).unwrap_or("g_tool").to_string();
            let content = v.get("content").map(|c| match c.as_str() {
                Some(s) => s.to_string(), None => c.to_string() }).unwrap_or_default();
            let is_error = v.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);
            vec![json!({ "type": "user", "message": { "content": [
                { "type": "tool_result", "tool_use_id": id, "content": content, "is_error": is_error } ] } })]
        }
        Some("error") => {
            let msg = v.get("message").and_then(|m| m.as_str())
                .or_else(|| v.get("error").and_then(|e| e.as_str())).unwrap_or("error");
            vec![json!({ "type": "stderr", "text": msg })]
        }
        Some("result") => {
            vec![json!({ "type": "result", "total_cost_usd": 0,
                "session_id": st.session_id.clone().unwrap_or_default() })]
        }
        _ => vec![],
    }
}

#[cfg(test)]
mod gemini_transcode_tests {
    use super::*;
    #[test]
    fn init_sets_session_and_emits_init() {
        let mut st = GeminiState::default();
        let ev = gemini_line_to_events("{\"type\":\"init\",\"session_id\":\"s1\",\"model\":\"gemini-2.5-pro\"}", &mut st);
        assert_eq!(ev[0]["subtype"], "init");
        assert_eq!(ev[0]["session_id"], "s1");
        assert_eq!(st.session_id.as_deref(), Some("s1"));
    }
    #[test]
    fn assistant_message_array_shape() {
        let mut st = GeminiState::default();
        let ev = gemini_line_to_events("{\"type\":\"message\",\"role\":\"assistant\",\"message\":{\"content\":[{\"text\":\"hello\"}]}}", &mut st);
        assert_eq!(ev[0]["type"], "assistant");
        assert_eq!(ev[0]["message"]["content"][0]["text"], "hello");
    }
    #[test]
    fn assistant_message_string_shape() {
        let mut st = GeminiState::default();
        let ev = gemini_line_to_events("{\"type\":\"message\",\"content\":\"hi there\"}", &mut st);
        assert_eq!(ev[0]["message"]["content"][0]["text"], "hi there");
    }
    #[test]
    fn user_message_ignored() {
        let mut st = GeminiState::default();
        assert!(gemini_line_to_events("{\"type\":\"message\",\"role\":\"user\",\"content\":\"q\"}", &mut st).is_empty());
    }
    #[test]
    fn tool_use_and_result() {
        let mut st = GeminiState::default();
        let u = gemini_line_to_events("{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"orion_search\",\"input\":{\"q\":\"x\"}}", &mut st);
        assert_eq!(u[0]["message"]["content"][0]["name"], "orion_search");
        let r = gemini_line_to_events("{\"type\":\"tool_result\",\"tool_use_id\":\"t1\",\"content\":\"ok\",\"is_error\":false}", &mut st);
        assert_eq!(r[0]["message"]["content"][0]["tool_use_id"], "t1");
        assert_eq!(r[0]["message"]["content"][0]["content"], "ok");
    }
    #[test]
    fn result_emits_session_zero_cost() {
        let mut st = GeminiState { session_id: Some("s1".into()) };
        let ev = gemini_line_to_events("{\"type\":\"result\",\"stats\":{\"total_tokens\":9}}", &mut st);
        assert_eq!(ev[0]["type"], "result");
        assert_eq!(ev[0]["session_id"], "s1");
        assert_eq!(ev[0]["total_cost_usd"], 0);
    }
}
```

- [ ] **Step 2: Run test to verify it fails then passes**

Run: `cargo test gemini_transcode_tests` → implement → PASS.

- [ ] **Step 3: Gates + commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/cli_engine/transcode.rs
git commit -m "feat(runtime-2c): gemini_line_to_events transcoder (defensive, validate at login)"
```

---

### Task 10: cli_status — detection command (TDD on pure parts)

**Files:**
- Modify: `src-tauri/src/cli_engine/mod.rs`

**Interfaces:**
- Produces: `#[derive(Serialize)] pub struct CliStatus { installed, logged_in, version, detail }` (serde camelCase) and `#[tauri::command] pub async fn cli_status(engine: String) -> CliStatus`. Pure helper `fn codex_logged_in_from(status_exit_ok: bool) -> bool` and `fn gemini_logged_in_from(creds_exists: bool) -> bool` for testing the auth-decision logic without spawning.

- [ ] **Step 1: Write the failing test**

In `mod.rs` add (above the `engine_tests` mod):

```rust
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    pub detail: String,
}

fn codex_logged_in_from(status_exit_ok: bool) -> bool {
    status_exit_ok
}
fn gemini_logged_in_from(creds_exists: bool) -> bool {
    creds_exists
}

fn detail_for(engine: CliEngine, installed: bool, logged_in: bool) -> String {
    match (installed, logged_in) {
        (false, _) => match engine {
            CliEngine::Codex => "Codex CLI not found. Install: npm i -g @openai/codex".into(),
            CliEngine::Gemini => "Gemini CLI not found. Install: npm i -g @google/gemini-cli".into(),
        },
        (true, false) => match engine {
            CliEngine::Codex => "Installed. Run `codex login` to sign in to ChatGPT.".into(),
            CliEngine::Gemini => "Installed. Run `gemini` once and choose Login with Google.".into(),
        },
        (true, true) => "Ready.".into(),
    }
}
```

Add to `engine_tests`:

```rust
    #[test]
    fn auth_decisions_and_detail_copy() {
        use super::{codex_logged_in_from, gemini_logged_in_from, detail_for, CliEngine};
        assert!(codex_logged_in_from(true));
        assert!(!codex_logged_in_from(false));
        assert!(gemini_logged_in_from(true));
        assert_eq!(detail_for(CliEngine::Codex, false, false).contains("npm i -g @openai/codex"), true);
        assert_eq!(detail_for(CliEngine::Gemini, true, false).contains("Login with Google"), true);
        assert_eq!(detail_for(CliEngine::Codex, true, true), "Ready.");
    }
```

- [ ] **Step 2: Run test to verify it fails then passes**

Run: `cargo test engine_tests` → add helpers → PASS.

- [ ] **Step 3: Implement the command (not unit-tested — spawns/reads files)**

Append to `mod.rs`:

```rust
use std::process::Stdio;
use tokio::process::Command;

async fn probe_version(bin: &str) -> Option<String> {
    let out = Command::new(bin)
        .arg("--version")
        .env("PATH", crate::claude_cli::augmented_path())
        .stdin(Stdio::null())
        .output()
        .await
        .ok()?;
    if !out.status.success() { return None; }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn cli_status(engine: String) -> CliStatus {
    let eng = match CliEngine::from_str(&engine) {
        Some(e) => e,
        None => return CliStatus { installed: false, logged_in: false, version: None, detail: "unknown engine".into() },
    };
    match eng {
        CliEngine::Codex => {
            let version = probe_version("codex").await;
            let installed = version.is_some();
            let logged_in = if installed {
                codex_logged_in_from(
                    Command::new("codex").args(["login", "status"])
                        .env("PATH", crate::claude_cli::augmented_path())
                        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                        .status().await.map(|s| s.success()).unwrap_or(false),
                )
            } else { false };
            let detail = detail_for(eng, installed, logged_in);
            CliStatus { installed, logged_in, version, detail }
        }
        CliEngine::Gemini => {
            let version = probe_version("gemini").await;
            let installed = version.is_some();
            let creds = std::env::var("HOME").ok()
                .map(|h| std::path::Path::new(&h).join(".gemini").join("oauth_creds.json").exists())
                .unwrap_or(false);
            let logged_in = installed && gemini_logged_in_from(creds);
            let detail = detail_for(eng, installed, logged_in);
            CliStatus { installed, logged_in, version, detail }
        }
    }
}
```

Register in `lib.rs` invoke_handler (after `runtime::runtime_cancel,` line ~282):

```rust
            cli_engine::cli_status,
```

- [ ] **Step 4: Gates + commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/cli_engine/mod.rs src-tauri/src/lib.rs
git commit -m "feat(runtime-2c): cli_status detection (codex login status + gemini creds artifact)"
```

---

### Task 11: codex.rs — spawn spec (pure arg-builder TDD + side-effect prep)

**Files:**
- Modify: `src-tauri/src/cli_engine/codex.rs`

**Interfaces:**
- Produces: `pub struct SpawnSpec { pub program: String, pub args: Vec<String>, pub envs: Vec<(String,String)>, pub cwd: String, pub stdin_data: Option<String> }`; `pub fn codex_args(model: &str, codex_home: &str, cwd: &str) -> Vec<String>` (pure, testable); `pub fn prepare(app, chat_id, prompt, project_root, session_id, model, system_append) -> Result<SpawnSpec, String>` (writes isolated CODEX_HOME config.toml + bridges auth.json). `SpawnSpec` is defined here and re-used by gemini.rs (Task 12) via `super::codex::SpawnSpec` — or hoist to mod.rs; this plan hoists it to `mod.rs` (see note).

> **Note:** to avoid a circular/duplicate definition, define `SpawnSpec` in `mod.rs` (Task 5 already created mod.rs). Add it there now; codex.rs/gemini.rs use `crate::cli_engine::SpawnSpec`.

- [ ] **Step 1: Add SpawnSpec to mod.rs**

In `mod.rs`:

```rust
#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub program: String,
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
    pub cwd: String,
    /// Data to write to the child's stdin (prompt for engines that read stdin),
    /// then close. None = stdin null.
    pub stdin_data: Option<String>,
}
```

- [ ] **Step 2: Write the failing test (pure arg builder)**

In `codex.rs`:

```rust
use crate::cli_engine::SpawnSpec;

/// Build the `codex exec` argv (model + headless + sandbox + non-interactive).
/// Prompt is fed on stdin (not argv), so it is not included here.
pub fn codex_args(model: &str, cwd: &str) -> Vec<String> {
    vec![
        "exec".into(),
        "--json".into(),
        "-m".into(), model.into(),
        "-a".into(), "never".into(),
        "-s".into(), "workspace-write".into(),
        "--skip-git-repo-check".into(),
        "-C".into(), cwd.into(),
    ]
}

#[cfg(test)]
mod codex_args_tests {
    use super::codex_args;
    #[test]
    fn builds_headless_argv() {
        let a = codex_args("gpt-5.1-codex", "/proj");
        assert_eq!(a[0], "exec");
        assert!(a.contains(&"--json".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "-m" && w[1] == "gpt-5.1-codex"));
        assert!(a.windows(2).any(|w| w[0] == "-a" && w[1] == "never"));
        assert!(a.windows(2).any(|w| w[0] == "-s" && w[1] == "workspace-write"));
        assert!(a.contains(&"--skip-git-repo-check".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "-C" && w[1] == "/proj"));
    }
}
```

- [ ] **Step 3: Run test to verify it fails then passes**

Run: `cargo test codex_args_tests` → PASS.

- [ ] **Step 4: Implement `prepare` (side effects; not unit-tested)**

Append to `codex.rs`:

```rust
use tauri::{AppHandle, Manager};

/// Write the isolated CODEX_HOME (config.toml with the Orion MCP server) and
/// bridge the user's auth.json into it, then build the SpawnSpec.
pub fn prepare(
    app: &AppHandle,
    prompt: &str,
    project_root: Option<&str>,
    session_id: Option<&str>,
    model: &str,
    _system_append: &str, // Codex persona: prepend into prompt (best-effort; see below)
) -> Result<SpawnSpec, String> {
    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .map(|p| p.to_string())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".into());

    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let codex_home = config_dir.join("cli-engines").join("codex-home");
    std::fs::create_dir_all(&codex_home).map_err(|e| e.to_string())?;

    // Write config.toml (best-effort — without it, the engine runs sans MCP).
    if let Some(server) = crate::mcp_config::orion_server(app) {
        let toml = crate::cli_engine::config::codex_mcp_config(&server);
        let _ = std::fs::write(codex_home.join("config.toml"), toml);
    }
    // Bridge auth: CODEX_HOME relocates auth.json, so copy the user's creds in.
    if let Some(home) = std::env::var_os("HOME") {
        let src = std::path::Path::new(&home).join(".codex").join("auth.json");
        if src.exists() {
            let _ = std::fs::copy(&src, codex_home.join("auth.json"));
        }
    }

    let mut args = codex_args(model, &cwd);
    if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
        // resume a prior thread (subcommand form: `codex exec resume <id>`)
        args.insert(1, "resume".into());
        args.insert(2, sid.to_string());
    }

    // Persona: Codex has no append-system-prompt flag; prepend instructions.
    let full_prompt = if _system_append.trim().is_empty() {
        prompt.to_string()
    } else {
        format!("[System instructions]\n{}\n\n{}", _system_append.trim(), prompt)
    };

    Ok(SpawnSpec {
        program: "codex".into(),
        args,
        envs: vec![("CODEX_HOME".into(), codex_home.to_string_lossy().into_owned())],
        cwd,
        stdin_data: Some(format!("{}\n", full_prompt)),
    })
}
```

- [ ] **Step 5: Gates + commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/cli_engine/mod.rs src-tauri/src/cli_engine/codex.rs
git commit -m "feat(runtime-2c): codex spawn spec (isolated CODEX_HOME + auth bridge + resume)"
```

---

### Task 12: gemini.rs — spawn spec (pure arg-builder TDD + side-effect prep)

**Files:**
- Modify: `src-tauri/src/cli_engine/gemini.rs`

**Interfaces:**
- Consumes: `SpawnSpec` (mod.rs), `gemini_mcp_config` (Task 7).
- Produces: `pub fn gemini_args(model: &str, prompt: &str, session_id: Option<&str>) -> Vec<String>` (pure); `pub fn prepare(app, prompt, project_root, session_id, model, system_append) -> Result<SpawnSpec, String>` (writes the isolated system-settings JSON; sets `GEMINI_CLI_SYSTEM_SETTINGS_PATH` + `GEMINI_SYSTEM_MD` for persona).

- [ ] **Step 1: Write the failing test (pure arg builder)**

In `gemini.rs`:

```rust
use crate::cli_engine::SpawnSpec;

/// Build the `gemini` headless argv. Prompt passed via -p (Gemini reads it as
/// an arg in non-interactive mode). Trust + yolo are required for MCP tools.
pub fn gemini_args(model: &str, prompt: &str, session_id: Option<&str>) -> Vec<String> {
    let mut a = vec![
        "-p".into(), prompt.into(),
        "-o".into(), "stream-json".into(),
        "-m".into(), model.into(),
        "--skip-trust".into(),
        "--approval-mode".into(), "yolo".into(),
    ];
    if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
        a.push("--resume".into());
        a.push(sid.to_string());
    }
    a
}

#[cfg(test)]
mod gemini_args_tests {
    use super::gemini_args;
    #[test]
    fn builds_headless_argv() {
        let a = gemini_args("gemini-2.5-pro", "hello", None);
        assert!(a.windows(2).any(|w| w[0] == "-p" && w[1] == "hello"));
        assert!(a.windows(2).any(|w| w[0] == "-o" && w[1] == "stream-json"));
        assert!(a.windows(2).any(|w| w[0] == "-m" && w[1] == "gemini-2.5-pro"));
        assert!(a.contains(&"--skip-trust".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "--approval-mode" && w[1] == "yolo"));
    }
    #[test]
    fn appends_resume_when_session_present() {
        let a = gemini_args("gemini-2.5-pro", "hi", Some("sess9"));
        assert!(a.windows(2).any(|w| w[0] == "--resume" && w[1] == "sess9"));
    }
}
```

- [ ] **Step 2: Run test → fail → implement → pass**

Run: `cargo test gemini_args_tests` → PASS.

- [ ] **Step 3: Implement `prepare` (side effects)**

Append to `gemini.rs`:

```rust
use tauri::{AppHandle, Manager};

pub fn prepare(
    app: &AppHandle,
    prompt: &str,
    project_root: Option<&str>,
    session_id: Option<&str>,
    model: &str,
    system_append: &str,
) -> Result<SpawnSpec, String> {
    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .map(|p| p.to_string())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".into());

    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let gem_dir = config_dir.join("cli-engines");
    std::fs::create_dir_all(&gem_dir).map_err(|e| e.to_string())?;

    let mut envs: Vec<(String, String)> = Vec::new();
    if let Some(server) = crate::mcp_config::orion_server(app) {
        let json = crate::cli_engine::config::gemini_mcp_config(&server);
        let settings_path = gem_dir.join("gemini-settings.json");
        if std::fs::write(&settings_path, json).is_ok() {
            envs.push((
                "GEMINI_CLI_SYSTEM_SETTINGS_PATH".into(),
                settings_path.to_string_lossy().into_owned(),
            ));
        }
    }
    // Persona via system-prompt override file (GEMINI_SYSTEM_MD).
    if !system_append.trim().is_empty() {
        let md_path = gem_dir.join("gemini-system.md");
        if std::fs::write(&md_path, system_append).is_ok() {
            envs.push(("GEMINI_SYSTEM_MD".into(), md_path.to_string_lossy().into_owned()));
        }
    }

    Ok(SpawnSpec {
        program: "gemini".into(),
        args: gemini_args(model, prompt, session_id),
        envs,
        cwd,
        stdin_data: None,
    })
}
```

> **[P-AUTH] note:** `GEMINI_SYSTEM_MD` persona + `--resume <id>` semantics are confirmed at the flag level only; verify at login that the system-md fully replaces vs. appends the base prompt, and adjust if it clobbers tool behavior.

- [ ] **Step 4: Gates + commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/cli_engine/gemini.rs
git commit -m "feat(runtime-2c): gemini spawn spec (system-settings MCP + persona md)"
```

---

### Task 13: cli_send / cli_cancel — shared spawn+stream loop + lib.rs registration

**Files:**
- Modify: `src-tauri/src/cli_engine/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register `cli_send`, `cli_cancel`)

**Interfaces:**
- Consumes: `codex::prepare`/`gemini::prepare`, `transcode::{codex_line_to_events,gemini_line_to_events}`, `CliEngine`, `SpawnSpec`.
- Produces: `#[tauri::command] pub async fn cli_send(app, engine, chat_id, prompt, project_root, session_id, model, system_append) -> Result<(), String>` and `#[tauri::command] pub fn cli_cancel(chat_id: String) -> Result<(), String>`. Emits `claude:event` per transcoded value + `claude:exit` on close. Cancel via a `Notify` map (mirrors `claude_cli::CHILDREN`).

> Wiring task — the spawn/stream loop mirrors [claude_cli.rs:258-349](../../../src-tauri/src/claude_cli.rs) verbatim in shape. Not unit-tested (spawns a subprocess); covered by the pure arg/transcode/config tests + the user smoke checklist.

- [ ] **Step 1: Implement the lifecycle**

Add to `mod.rs` (imports + statics + commands):

```rust
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command as TokioCommand};
use tokio::sync::Notify;

static CLI_CHILDREN: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
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

#[tauri::command]
pub async fn cli_send(
    app: AppHandle,
    engine: String,
    chat_id: String,
    prompt: String,
    project_root: Option<String>,
    session_id: Option<String>,
    model: String,
    system_append: String,
) -> Result<(), String> {
    let eng = CliEngine::from_str(&engine).ok_or_else(|| format!("unknown engine: {engine}"))?;
    let spec = match eng {
        CliEngine::Codex => codex::prepare(&app, &prompt, project_root.as_deref(), session_id.as_deref(), &model, &system_append)?,
        CliEngine::Gemini => gemini::prepare(&app, &prompt, project_root.as_deref(), session_id.as_deref(), &model, &system_append)?,
    };

    let mut cmd = TokioCommand::new(&spec.program);
    cmd.args(&spec.args);
    cmd.current_dir(&spec.cwd);
    cmd.env("PATH", crate::claude_cli::augmented_path());
    for (k, v) in &spec.envs {
        cmd.env(k, v);
    }
    cmd.stdin(if spec.stdin_data.is_some() { std::process::Stdio::piped() } else { std::process::Stdio::null() });
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child: Child = cmd.spawn().map_err(|e| format!(
        "failed to spawn `{}` — is the CLI installed and on PATH? ({})", spec.program, e))?;

    if let Some(data) = spec.stdin_data {
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                let _ = stdin.write_all(data.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
        }
    }

    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let cancel = Arc::new(Notify::new());
    CLI_CHILDREN.lock().insert(chat_id.clone(), cancel.clone());

    let app_loop = app.clone();
    let chat_loop = chat_id.clone();
    let mut lines = BufReader::new(stdout).lines();
    let mut codex_state = transcode::CodexState::default();
    let mut gemini_state = transcode::GeminiState::default();

    let result: Result<Option<i32>, String> = async {
        loop {
            tokio::select! {
                _ = cancel.notified() => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return Ok(None);
                }
                line = lines.next_line() => {
                    match line {
                        Ok(Some(text)) => {
                            let events = match eng {
                                CliEngine::Codex => transcode::codex_line_to_events(&text, &mut codex_state),
                                CliEngine::Gemini => transcode::gemini_line_to_events(&text, &mut gemini_state),
                            };
                            for ev in events {
                                let _ = app_loop.emit("claude:event", EventPayload {
                                    chat_id: chat_loop.clone(), event: ev });
                            }
                        }
                        Ok(None) => {
                            let status = child.wait().await.map_err(|e| e.to_string())?;
                            return Ok(status.code());
                        }
                        Err(e) => { let _ = child.kill().await; return Err(e.to_string()); }
                    }
                }
            }
        }
    }.await;

    CLI_CHILDREN.lock().remove(&chat_id);
    match result {
        Ok(code) => { let _ = app.emit("claude:exit", ExitPayload { chat_id, code, error: None }); Ok(()) }
        Err(e) => { let _ = app.emit("claude:exit", ExitPayload { chat_id, code: None, error: Some(e.clone()) }); Err(e) }
    }
}

#[tauri::command]
pub fn cli_cancel(chat_id: String) -> Result<(), String> {
    if let Some(n) = CLI_CHILDREN.lock().remove(&chat_id) {
        n.notify_waiters();
    }
    Ok(())
}
```

Register in `lib.rs` invoke_handler (next to `cli_engine::cli_status,`):

```rust
            cli_engine::cli_send,
            cli_engine::cli_cancel,
```

- [ ] **Step 2: Gates**

Run (in `src-tauri/`): `cargo test && cargo check`
Expected: PASS (no new unit tests; existing ones green, compiles clean).

- [ ] **Step 3: Commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/cli_engine/mod.rs src-tauri/src/lib.rs
git commit -m "feat(runtime-2c): cli_send/cli_cancel spawn+stream lifecycle (engine-dispatched)"
```

---

### Task 14: Control Panel — CLI engine status row

**Files:**
- Modify: `src/features/controlpanel/ProvidersPanel.tsx`
- Modify: `src/features/controlpanel/controlpanel.css` (add `.cp-cli-*` if needed; reuse `cp-card`/`cp-badge`)

**Interfaces:**
- Consumes: `ipc.cliStatus` (Task 3), `CODEX_CLI_PROVIDER`/`GEMINI_CLI_PROVIDER` ids.
- Produces: each built-in CLI provider card shows a live status line (Ready / not-logged-in with the login command / not-found with install hint), with a "Re-check" button. No emoji; lucide icons + `cp-badge` classes.

- [ ] **Step 1: Implement**

In `ProvidersPanel.tsx`, add a status hook + render for CLI providers. After the imports:

```tsx
import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, LogIn, Download } from "lucide-react";

type CliStat = { installed: boolean; loggedIn: boolean; version: string | null; detail: string };

function CliEngineStatus({ engine }: { engine: "codex_cli" | "gemini_cli" }) {
  const [stat, setStat] = useState<CliStat | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try { setStat(await ipc.cliStatus(engine)); } finally { setBusy(false); }
  };
  useEffect(() => { void check(); /* eslint-disable-next-line */ }, [engine]);
  const Icon = !stat ? RefreshCw : !stat.installed ? Download : !stat.loggedIn ? LogIn : CheckCircle2;
  const cls = stat?.loggedIn ? "live" : "wait";
  return (
    <div className="cp-cli-status">
      <span className={`cp-badge ${cls}`}>
        <Icon size={12} /> {!stat ? "checking" : stat.loggedIn ? "ready" : stat.installed ? "login needed" : "not found"}
      </span>
      <span className="cp-card-sub">{stat?.detail ?? ""}</span>
      <button className="cp-link" disabled={busy} onClick={() => void check()}>Re-check</button>
    </div>
  );
}
```

In the provider list `.map`, detect CLI providers and render the status row inside their card:

```tsx
{providers.map((p) => {
  const isCli = p.kind === "codex_cli" || p.kind === "gemini_cli";
  return (
    <div key={p.id} className="cp-card">
      <div className="cp-card-main">
        <div className="cp-card-title">{p.name}</div>
        <div className="cp-card-sub">{p.kind}{p.models.length ? ` · ${p.models.length} models` : ""}</div>
        {isCli && <CliEngineStatus engine={p.kind as "codex_cli" | "gemini_cli"} />}
      </div>
      {p.builtin
        ? <span className="cp-badge live">built-in</span>
        : <span className="cp-badge wait">chat ready</span>}
      {!p.builtin && <button className="cp-link-danger" onClick={() => remove(p.id)}>Remove</button>}
    </div>
  );
})}
```

Add minimal CSS to `controlpanel.css`:

```css
.cp-cli-status { display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.cp-cli-status .cp-badge { display: inline-flex; align-items: center; gap: 4px; }
```

- [ ] **Step 2: Gates + commit**

```bash
npx tsc --noEmit && npx vitest run && npm run build
git add src/features/controlpanel/ProvidersPanel.tsx src/features/controlpanel/controlpanel.css
git commit -m "feat(runtime-2c): Control Panel CLI-engine status (installed/login/ready)"
```

---

### Task 15: Full-suite gate + session log + smoke checklist

**Files:**
- Modify: `CLAUDE.md` (append a Session Log entry)

- [ ] **Step 1: Run every gate**

```bash
npx tsc --noEmit
npx vitest run
cd src-tauri && cargo test && cargo check && cd ..
npm run build
```

Expected: all exit 0. Record the vitest + cargo counts.

- [ ] **Step 2: Append the Session Log entry to CLAUDE.md** (no emoji), summarizing: spike findings, the additive engines, the non-regression guarantees, the `[P-AUTH]` fixture-validation gates, and the `tauri dev` restart requirement.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(runtime-2c): session log — subscription CLI engines (Codex + Gemini)"
```

- [ ] **Step 4: User smoke checklist (after `tauri dev` restart — requires the user to log in)**

1. Restart `tauri dev`. Control Panel → Providers: "OpenAI Codex (CLI)" and "Google Gemini (CLI)" appear; each shows "not found" → install, or "login needed" → the exact login command.
2. `npm i -g @openai/codex @google/gemini-cli` if not present; `codex login` (ChatGPT) and run `gemini` once → Login with Google. Re-check → both show "ready".
3. **[P-AUTH] capture fixtures:** run `codex exec --json -m gpt-5.1-codex -a never -s workspace-write --skip-git-repo-check -C <repo> "read README.md and summarize"` and `gemini -p "summarize the repo" -o stream-json --skip-trust --approval-mode yolo` — save one `agent_message`/`mcp_tool_call`/`turn.completed` (Codex) and `init`/`message`/`tool_use`/`tool_result`/`result` (Gemini). Diff against the transcoder fixtures (Tasks 8/9); patch + re-run `cargo test` if fields differ.
4. In any rail (Orion/Archives/XDesign/ROSIE) select a Codex model → send → reply streams token-by-token; an Orion tool (read file/search) takes effect and shows as a tool step.
5. Same for a Gemini model.
6. Editing turn: Gemini → lands in Accept/Reject DiffReview (parity); Codex → lands in the Changes panel (working tree). Confirm the Control Panel copy matches.
7. Select any **Claude** model/agent → byte-identical to before (tools, edits, sessions). API-key providers (2a/2b) + the `--mcp-serve` subprocess still work.
8. Cancel a streaming CLI turn → it halts.

---

## Self-Review

**Spec coverage:** §2.1 provider kinds+seeds → Tasks 1-2. §2.2 routing seam → Task 4. §2.3 `cli_send` + module → Tasks 5,11,12,13. §4 MCP isolated config → Tasks 6,7 (+ prepare in 11,12). §5 transcoding → Tasks 8,9. §6 edit-review (Gemini parity via excludeTools, Codex fallback) → Task 7 (excludeTools) + Task 14 copy + smoke step 6. §7 detection/status → Tasks 10,14. §8 persona/cost/sessions → codex/gemini `prepare` (system prompt prepend / GEMINI_SYSTEM_MD; resume; cost 0 in transcoders). §9 testing/non-regression → Tasks 4,6-12 + Task 15 gates. §10 success criteria → smoke checklist. §11 deferrals (per-tool grant filtering, cost accounting, Hermes, Phase 3) → not built, noted.

**Placeholder scan:** every code step shows real code. `[P-AUTH]` markers are explicit validation gates, not placeholders.

**Type consistency:** `CliStatus` (Rust serde camelCase) ↔ `ipc.cliStatus` return type ↔ `CliStat` (Task 14) all use `installed/loggedIn/version/detail`. `SpawnSpec` defined once in mod.rs (Task 11 Step 1), used by codex.rs/gemini.rs. `cliSend(engine, chatId, prompt, projectRoot, sessionId, model, systemAppend)` matches `cli_send` Rust params (snake_case via Tauri) and the routing test assertion in Task 4.
