# RepoLens → Archives — Design Spec

**Date:** 2026-06-13
**Status:** approved-for-planning
**Scope of v1:** Core scan + 3 AI lenses (Deep Dive, SKTPG, Synergies). No Versus, no connections graph, no diagrams, no combinator/re-tag, no systems/ideate/prioritize framework lenses.

---

## 0. What this is

RepoLens is a GitHub/GitLab/npm/PyPI repo scanner (originally a Chrome extension at
`/Users/lucaorion/Downloads/repolens-main`). It explains any repo via an LLM:
a "should I adopt this?" briefing plus optional deeper "lenses". We are bringing it
into Orion Terminal as **a new section inside the Archives app**, called **RepoLens**,
sitting in the sidebar Library list alongside Today / Journal / Projects / Notes / etc.

The original extension authenticated a Claude Max subscription via OAuth — a path
Anthropic banned (2026-02-20) for everything except Claude Code and claude.ai. The
sanctioned way to use the Max quota programmatically is to **drive the local `claude`
CLI**, which Orion already does everywhere (`claude_oneshot`, `claude_send`, hermes).
So RepoLens shells out to `claude` for every AI call — no API key, no per-token bill.

## 1. Key architectural decision — TS logic, thin Rust

The handoff spec assumed a Rust/TUI port. Orion is **Tauri + React + TypeScript**, and
the friend's RepoLens is **already JavaScript**. Therefore:

- **Port the pure-logic modules JS → TS, nearly verbatim**, as testable Vitest units:
  `detect`, core `prompt`, core `parser`, `taxonomy`, `verdict`, `tone`, the lens
  prompt-builders + parsers, and `export` (markdown). These are the bulk of the work
  and contain no I/O.
- **Rust gains only three thin commands** (new module `src-tauri/src/repolens.rs`):
  1. `repolens_claude_call(prompt, model) -> { result, cost, model }` — the verified
     subprocess invocation (§2).
  2. `repolens_fetch_repo(platform, repo_id) -> RepoData` — public registry APIs via
     `reqwest` (§3).
  3. `repolens_fetch_source(repo_id) -> { tree, files, degraded }` — GitHub file tree
     + key files, for Deep Dive / SKTPG (§3).
- Plus a GitHub-token secret (`keyring`, mirroring `api_key.rs`) and migration `0021`.

Rationale: keeps every prompt/parser tweak a hot-reload instead of a recompile; matches
the codebase's existing subprocess + `reqwest` patterns; fetching in Rust sidesteps
webview CORS/CSP entirely and lets us attach a GitHub token.

## 2. The Claude call (verified invocation — copy exactly)

Every AI feature funnels through one operation: send Claude a prompt, get text back.

```bash
printf '%s' "$PROMPT" | claude -p --output-format json --model sonnet
```

- `-p` / `--print` — non-interactive. **Prompt fed via stdin** (NOT argv — Deep Dive
  prompts reach ~25 KB).
- `--output-format json` — single JSON envelope: read `.result` for the model text,
  check `.is_error` (and a non-`success` `.subtype`) for failure, `.total_cost_usd` is
  informational (drawn from the Max quota, not billed).
- `--model` — accepts an alias (`sonnet`/`opus`/`haiku`) or full id
  (`claude-sonnet-4-6`).

**Rust** (`repolens.rs`), modeled on `claude_cli::claude_oneshot`:

```rust
#[tauri::command]
pub async fn repolens_claude_call(prompt: String, model: String) -> Result<RepoLensReply, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;
    let mut cmd = Command::new("claude");
    cmd.args(["-p", "--output-format", "json", "--model", &model]);
    if let Some(home) = std::env::var_os("HOME") { cmd.current_dir(home); }
    cmd.env("PATH", crate::claude_cli::augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        stdin.write_all(prompt.as_bytes()).await.map_err(|e| e.to_string())?;
    } // stdin dropped → EOF
    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("claude exited {}: {}", out.status,
            String::from_utf8_lossy(&out.stderr).trim()));
    }
    let env: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    if env.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Err(format!("claude returned error: {}", env));
    }
    let result = env.get("result").and_then(|v| v.as_str())
        .ok_or("no .result in claude envelope")?.to_string();
    let cost = env.get("total_cost_usd").and_then(|v| v.as_f64()).unwrap_or(0.0);
    Ok(RepoLensReply { result, cost, model })
}
```

`augmented_path()` is already `pub(crate)` in `claude_cli.rs`.

**Serialized queue (port the extension's `aiChain` behavior).** All AI calls go through
one TS async queue with a configurable minimum gap (default **1200 ms**), single-flight —
so a 3-call Deep Dive never spawns parallel `claude` processes. Lives in
`repolens/claude.ts` as `enqueueClaude(part, prompt) -> Promise<string>`, resolving the
model via the model config (§7) and calling `ipc.repolensClaudeCall`.

## 3. Network fetching (Rust `reqwest`, no auth required)

Ports `fetcher.js` + `url-detector.js`. `detect.ts` (pure TS) parses URLs/`owner/repo`;
`repolens_fetch_repo` / `repolens_fetch_source` (Rust) do the network.

`RepoData` (normalized, returned from `repolens_fetch_repo`):

| field | type |
|---|---|
| platform | "github"\|"gitlab"\|"npm"\|"pypi" |
| repo_id | String |
| description, language, license | String |
| stars | u64 |
| readme | String (sliced ~6–8k before prompting) |
| languages | Vec<{ name, pct }> (top-5) |
| dependencies | Vec<{ name, version }> (npm/pypi, ≤30) |

Endpoints (all public JSON, mirror `fetcher.js`):

| platform | endpoints | notes |
|---|---|---|
| github | `/repos/{id}`, `/repos/{id}/readme` (base64), `/repos/{id}/languages` | langs = bytes→top-5 %; **send `Authorization: Bearer <token>` when set** |
| gitlab | `/api/v4/projects/{urlenc id}` (+ `…/files/README.md/raw`, `…/languages`) | langs already %; url-encode id |
| npm | `registry.npmjs.org/{pkg}` | deps from `versions[latest].dependencies` |
| pypi | `pypi.org/pypi/{pkg}/json` | parse `requires_dist` |

`repolens_fetch_source(repo_id)` (GitHub only; others return `degraded: true`): default
branch → `git/trees/{branch}?recursive=1` (cap 200 paths) → fetch up to 8 "key files"
(priority list in `deepdive.js` `selectKeyFiles`, base64-decoded, ≤2500 chars each).
Returns `{ tree: Vec<String>, files: Vec<{ path, content }>, degraded: bool }`.

**GitHub token (added now, per request).** Optional Personal Access Token stored in the
OS keychain (`keyring`, `SERVICE="personal-workstation"`, `ACCOUNT="github-token"`),
exactly mirroring `api_key.rs`. New commands `github_token_set/clear/status`. The two
fetch commands read it and attach `Authorization: Bearer <token>` to GitHub requests,
lifting the unauthenticated 60 req/h limit to 5000 req/h. A read-only/no-scope classic
PAT or fine-grained "public repositories (read-only)" token is sufficient. Surfaced as a
field in Settings (§6).

## 4. Data model — `RepoAnalysis` (core scan output)

Produced by `parser.ts` (ported from `parser.js`). Shape (TS):

```ts
type RepoAnalysis = {
  eli5: string;
  bottom_line: string;
  analogies: string[];
  technical: string;
  use_cases: { core_fit: string; good_fit: string; works_well: string; long_term: string };
  skip_if: { overkill: string; wrong_tool: string; needs_care: string; consider: string };
  enables: string;
  pros: string[];                       // ≤6
  cons: string[];                       // ≤6
  alternatives: { name: string; when: string }[];
  health: { score: number; commit_activity: number; issue_response: number;
            pr_merge_rate: number; maintainer_count: number; summary: string };
  red_flags: { title: string; text: string; severity: "warning" | "ok" }[];
  start_here: { icon: string; title: string; desc: string; tag: string }[];
  compare_hooks: string;
  tech_stack: { built_with: string[]; key_dependencies: { name: string; purpose: string }[] };
  tags: string[];
  category: string;
  capabilities: string[];               // 2–5 from the controlled taxonomy
  highlights: { text: string; why: string; severity: "risk"|"insight"|"opportunity"; tab: string }[];
};
```

**Parsing robustness (port verbatim):** trim, strip a leading ```` ```json ````/trailing
```` ``` ````, slice from first `{` to last `}`, then `JSON.parse`. Validate
`highlights.tab` against `HL_SECTIONS` and `red_flags`/`highlights.severity` against the
fixed allow-lists. `capabilities` falls back to `deriveCapabilities()` (keyword hints)
when the model omits them. The **core prompt is `buildPrompt()` in `prompt.js`** — copy
it verbatim, wrap with `withTone()`.

**Lens result types** (ported from each lens parser):
- **Deep Dive** — `{ atoms: {id,name,kind,purpose,files[]}[], lineage: {links:{from,to,relation,why}[], roots[], leaves[]}, feynman: {explanation, gaps[], assumptions[], questions:{q,a}[], confidence:{claim,level,note}[]} }` (3 sequential calls: atoms → lineage → feynman; prompts/parsers in `deepdive.js`).
- **SKTPG** — the forecast struct in `sktpg.js` `parseSktpg` (thesis / score+band / base_rate / weak_signals / hype_vs_motion / bottleneck / forecast / becomes_obvious / actions / premortem / tracking). 1 call.
- **Synergies** — `{ synergies: { repoId, category, synergy, in_library }[] }`. 1 call; candidate pool = the user's other saved scans (§5).

**Verdict** (pure, no AI) — `deriveFit(analysis)` → `{ level: strong|solid|care|risky, label, why }` from health score + red-flag count + pros/cons. Ported from `verdict.js`. Drives the chip on every library card and the report header.

## 5. Persistence — migration `0021_repolens.sql`

One table is both the library and the instant-reopen cache:

```sql
CREATE TABLE IF NOT EXISTS repolens_scans (
  repo_id     TEXT PRIMARY KEY,          -- "owner/repo" | npm/pypi pkg name
  platform    TEXT NOT NULL,
  model       TEXT NOT NULL DEFAULT '',  -- model used for the core scan
  tone        TEXT NOT NULL DEFAULT 'neutral',
  analysis_json TEXT NOT NULL,           -- the RepoAnalysis
  lenses_json   TEXT NOT NULL DEFAULT '{}', -- { deepdive?, sktpg?, synergies? } results, filled on demand
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repolens_updated ON repolens_scans(updated_at DESC);
```

`repolensDb.ts` (mirrors `database/databaseDb.ts`): `saveScan`, `getScan(repoId)`,
`listScans(limit)`, `deleteScan(repoId)`, `updateLenses(repoId, partial)`. Opening a
library card reads `analysis_json` → instant render (no network/AI). Re-scanning
overwrites. Synergies reads `listScans` rows (their `eli5`/`category`) as candidates.

No separate nodes/edges/cache tables (connections graph out of scope). Append-only
migration rule honored.

## 6. UI — the `repolens` Archives view

**Wiring:** add `"repolens"` to the `ArchivesView` union (`useArchives.ts`), a nav item
to the `LIBRARY` array in `ArchivesApp.tsx` (slotted under Projects, icon `ScanSearch`),
and `{view === "repolens" && <RepoLensView />}` in the view host.

**`RepoLensView.tsx`** — two modes:

- **Scan bar** (always on top): repo input ("Paste a GitHub/GitLab/npm/PyPI URL or
  owner/repo…"), global **model picker**, **tone picker**, **Scan** button. A live
  detected-platform hint. Errors (bad URL, fetch failure, claude error) surface inline.
- **Library mode** (no scan open): grid of `listScans()` cards — repo id, category,
  verdict chip (color by level), stars, age. Click → open report (instant). Card menu:
  Open / Re-scan / Export / Delete (reuse `ContextMenu`).
- **Report mode** (scan open): `RepoLensReport.tsx` renders every core section —
  header (repo id + verdict chip + bottom_line), ELI5, analogies, technical, use-cases,
  skip-if, enables, pros/cons, alternatives, health (bars), red-flags, start-here,
  tech-stack (language bars + key deps), tags, capabilities, highlights. Plus a
  **lens rail**: Deep Dive / SKTPG / Synergies buttons — each runs on demand (spinner),
  renders its panel, and persists into `lenses_json`. A **⌘-style "Export Markdown"**
  action (ported `exporter.js`, markdown only; HTML export out of scope).

**Accent:** RepoLens uses a **slightly darker green** than Archives' `--neon-green`
(`#39ff88`). New token `--repolens-green: #1fb85f` (tunable) + an `-rgb` twin for
alpha use, scoped to `.rl-*` classes. Everything else inherits Archives chrome.

**Settings:** add a small **GitHub token** field **below the Anthropic API key in the
existing `APIKeySection`** (the "key" tab — no new Settings nav entry), using
`github_token_set/clear/status`. Shows masked status ("token set" / "not set"), Save,
Clear — mirroring the API-key field directly above it.

**Store** `useRepoLens.ts` (zustand): `currentRepoId`, `library` (cached list),
`running` (which part is in flight), `model config`, `tone`, plus actions `scan(input)`,
`openFromLibrary(repoId)`, `runLens(part)`, `exportMarkdown()`, `closeReport()`.

## 7. Model + tone switching (explicit requirement)

`models.ts` (ported, Anthropic-only): `PARTS = [core, deepdive, sktpg, synergies]`;
catalog = Sonnet 4.6 (default/recommended), Opus 4.8, Haiku 4.5 (ids = CLI `--model`
values, reuse `src/lib/models.ts` `MODELS` where possible).

```ts
type RepoLensModelConfig = { default_model: string; per_part: Record<string, string> };
function modelFor(cfg, part) {
  const m = cfg.per_part[part];
  return m && m !== "default" ? m : cfg.default_model;
}
```

Persisted in `app_state` (key `"repolens"` → `{ model: RepoLensModelConfig, tone }`),
hydrated on boot like the other prefs. Global model picker in the scan bar sets
`default_model`; an optional per-lens override on each lens panel sets `per_part[part]`.
Tone picker = the 6 `TONES` (default `neutral` → empty preamble), applied via
`withTone()` to every prompt.

## 8. Module layout

```
src/apps/archives/repolens/
  RepoLensView.tsx          # the Archives view (scan bar + library/report switch)
  RepoLensReport.tsx        # renders a RepoAnalysis (all core sections)
  RepoLensLibrary.tsx       # library grid of saved scans
  lens/DeepDivePanel.tsx
  lens/SktpgPanel.tsx
  lens/SynergiesPanel.tsx
  useRepoLens.ts            # zustand store
  repolensDb.ts             # migration 0021 CRUD
  detect.ts   prompt.ts   parser.ts   taxonomy.ts   verdict.ts
  tone.ts     models.ts    lenses.ts   export.ts     types.ts
  claude.ts                # serialized call queue → ipc.repolensClaudeCall
  fetch.ts                 # wraps ipc.repolensFetchRepo / fetchSource
  *.test.ts                # vitest for the pure modules

src-tauri/src/repolens.rs  # 3 commands + RepoLensReply/RepoData/Source structs + token read
src-tauri/src/github_token.rs (or fold into api_key.rs) # keyring set/clear/status
src-tauri/migrations/0021_repolens.sql
```

`lib.rs`: register the migration + the new commands. `ipc.ts`: `repolensClaudeCall`,
`repolensFetchRepo`, `repolensFetchSource`, `githubTokenSet/Clear/Status`.

## 9. Build order (green, committed slices)

1. **Walking skeleton** — Rust 3 commands + migration 0021 + token keyring; TS `detect`
   / `fetch` / core `prompt` / `parser` / `taxonomy` / `verdict`; `RepoLensView` +
   `RepoLensReport`; nav wiring + accent token. Paste a **GitHub** repo → full core
   report renders. (Restart required here.)
2. **Model + tone pickers** + `app_state` persistence.
3. **Library** save/list/open/delete + **Markdown export**. ← shippable after this.
4. **Deep Dive** (3-call chain + `fetch_source`, GitHub-only/degraded).
5. **SKTPG**.
6. **Synergies** (library-grounded candidates).
7. **gitlab / npm / pypi** platforms in `repolens_fetch_repo`.
8. **Settings** GitHub-token field (can land with slice 1's token plumbing or here).

## 10. Testing

Vitest units for every pure module (mirrors the codebase's per-feature test habit):
`detect` (each platform + owner/repo + junk), `parser` (fence/prose salvage, allow-list
clamping, capability fallback), `taxonomy` (`normalizeCapabilities`/`deriveCapabilities`/
`layersAdjacent`), `verdict` (`deriveFit` thresholds), `tone` (`withTone` neutral=empty),
`models` (`modelFor`), each lens parser (well-formed + malformed), `export` (markdown
shape). Rust: a unit test for the JSON-envelope `.result`/`.is_error` extraction and for
`selectKeyFiles` priority. UI is human-verified (agent can't run Tauri).

## 11. Gotchas / risks

- **Latency** — each call is multi-second; Deep Dive is 3 sequential. Never block the
  UI; show per-part spinners. Serialize via the queue (no parallel `claude`).
- **JSON salvage** — always fence-strip + `{…}` slice before parse; models add prose.
- **GitHub rate limit** — 60/h unauth; the token raises it to 5000/h. Surface a clear
  "rate limited — add a GitHub token in Settings" error.
- **Deep Dive / SKTPG source** — GitHub only; npm/pypi/gitlab degrade to README-only
  (prompts already handle the empty-source case).
- **Restart** — slice 1 adds a Rust module + migration 0021 → one `tauri dev` restart;
  later TS-only slices hot-reload.
- **`claude` envelope drift** — pin to `.result`/`.is_error`/`.total_cost_usd`; ignore
  the rest.

## 12. Out of scope (v1)

Versus, Synergies/Combinator ranking math beyond candidate listing, Combinator synthesis,
Re-tag library, Systems/Ideate/Prioritize framework lenses, Connections ego-graph,
lineage/feedback **SVG diagrams** (Deep Dive renders its lineage as a structured list,
not an SVG, in v1), HTML export, themes import, and the old `velesdb` migration.
