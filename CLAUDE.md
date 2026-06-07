# Orion Terminal — Project Log

This file is the rolling source of truth for Orion Terminal so context survives if a chat is lost. Add an entry to the **Session Log** whenever you finish a meaningful chunk of work. Keep the brief sections at top concise — they should still be readable end-to-end in 60 seconds a year from now.

---

## What this is

**Orion Terminal** is a JARVIS-style personal workstation: one desktop OS shell hosting three deeply-integrated apps with Claude embedded inside each as a context-specific collaborator.

- Shell: wallpaper, menubar, dock, in-canvas windows, Spotlight (⌘K)
- App 1 — **Archives 47**: personal Notion (notes, journal, mood boards, media). Green accent.
- App 2 — **Orion**: AI-first code editor (file tree, Monaco, live preview, terminal, inline Claude edits). Cyan accent.
- App 3 — **XDesign**: design studio UI shell (Figma + PS + Illustrator + Unicorn.studio hybrid). Magenta accent. v1 is UI-only.

"Orion Terminal" is the product. "Orion" is the editor app inside it. **Never reuse `OrionTerminal` as a component name.**

---

## Locked architectural decisions

1. **In-canvas windowing**, not Tauri native multi-window. One OS window; apps render as React components positioned absolutely inside an HTML canvas.
2. **Hard cutover on aesthetics.** All surfaces move to new design tokens in one pass — no half-old / half-new state for more than a day.
3. **Unified Spotlight**, replacing the standalone `cmdk` palette. Same command registry underneath. `>` prefix = commands only; otherwise fuzzy match across apps, notes, files, recent chats, commands.

---

## Stack (locked — do not propose alternatives)

- Tauri 2 + React 19 + Vite + TypeScript
- Monaco editor, BlockNote (notes), xterm.js (terminal), cmdk (legacy palette internals), Zustand (state), react-resizable-panels
- SQLite via `tauri-plugin-sql`; migrations are **append-only**
- Subscription Claude path = Claude CLI subprocess (`claude --print --output-format stream-json --verbose --permission-mode acceptEdits`)
- Inline-edit path = Messages API directly (streaming, OS-keychain key)
- Fonts: Space Grotesk (UI) + JetBrains Mono (code, mono labels) via `@fontsource/*`
- Spotlight fuzzy match: `fuse.js`

---

## Design tokens (new — Phase A canon)

```
--bg-0  #03060a   deepest
--bg-1  #060a0f   card / section
--bg-2  #0a1015   raised
--bg-3  #10171d   hover / focused

--neon-green   #39ff88   Archives accent, primary CTA, success, Claude online
--neon-cyan    #00e0ff   Orion accent, info, git markers
--neon-yellow  #e6ff3a   warnings, unsaved-changes dot
--neon-magenta #ff3ea5   XDesign accent, errors, selection handles
--neon-violet  #b14cff   aurora layer, syntax keywords

--t-primary    #e6f4ec
--t-secondary  #9ab0a8
--t-tertiary   #5a706a
--t-faint      #324036

--r-sm 6px   --r-md 10px   --r-lg 16px (windows)   --r-xl 22px (dock)   --r-pill 999px

--shadow-window:       0 30px 80px -20px rgba(0,0,0,0.7), 0 8px 24px -8px rgba(0,0,0,0.5)
--shadow-glow-green:   0 0 24px -4px rgba(57, 255, 136, 0.5)
--shadow-glow-cyan:    0 0 24px -4px rgba(0, 224, 255, 0.5)
--shadow-glow-magenta: 0 0 24px -4px rgba(255, 62, 165, 0.5)
```

Spacing scale: 4 / 8 / 12 / 14 / 18 / 28 / 44. Window padding 14–18px; section padding 28–44px.

**The previously-deprecated `--signal / --void / --obsidian / --graphite / --steel / --ash / --bone / --ember` tokens do not exist in the actual codebase — they were named in the brief but never present.** The existing palette was the Tailwind theme keys (`bg`, `bg-panel`, `accent`, etc.). The migration plan: introduce the new `--*` tokens at the CSS level, then remap the Tailwind theme to point at them so all existing Tailwind classes pick up the new colors. No mass find-replace needed for Tailwind class usage.

---

## Architecture map (Phase A target)

```
src/shell/                 wallpaper, menubar, dock, windowframe, spotlight, useShell, useDraggable
src/apps/orion/            Orion editor — file tree, tabs, editor, preview, terminal, statusbar, claude config
src/apps/archives/         Archives stub (sidebar + main placeholder + ClaudeChat)
src/apps/xdesign/          XDesign stub (no Claude rail in Phase A)
src/components/ClaudeChat  reusable, props-driven chat panel — three instances
src/styles/tokens.css      design tokens (new canon)
src/commands/              global command registry (still global, unchanged shape)
```

Stores:

- `useShell` — windows[], maxZ, focusedWindowId, spotlightOpen
- `useClaude` — conversations keyed by appId
- `useArchives`, `useOrion`, `useXDesign` — per-app state (Phase A may keep them minimal)
- `useCommands` — existing registry singleton, untouched

Window state shape:

```ts
type WindowState = {
  id: string;                          // ULID
  app: 'archives' | 'orion' | 'xdesign';
  x: number; y: number;
  w: number; h: number;
  z: number;
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  preMaximize?: { x: number; y: number; w: number; h: number };
};
```

---

## Current state (where we actually are)

The original Phase A / Phase B / Phase C frame from the brief turned into something more iterative. Here's the honest map:

**Shipped end-to-end**

- Shell, dock, menubar, wallpaper, Spotlight, in-canvas windows (resizable from 8 edges, Mac-style, with min size + responsive content).
- **Orion** (code editor): file tree, Monaco with `orion-neon` theme, xterm.js terminal, inline-edit DiffEditor, preview tab (static), Code Companion claude rail wired to the CLI subprocess.
- **Workspace primitive** (`src/components/workspace/`): per-app dockable tabs/panels with DnD, role-based routing, persistence in `app_state`. Used by Orion; reusable.
- **Archives 47** (full content app):
  - Today dashboard with greeting, today's-journal, recent threads, captured-today, on-this-day, Claude's read of your week (real, cached 24h).
  - Notes (kind=note grid → detail), Journal (kind=journal rail + editor + date/time/location metadata), Projects (kind=project Notion-style nested pages), Mood Boards (first-class boards with masonry tiles, drag-reorder, asset picker), Media (asset grid with filters + previews).
  - Apple-glass `.note-page` scope for the editor surfaces; neo-Tokyo chrome for everything else.
  - Sidebar: real Collections CRUD with color picker, real Tags pulled from DB with click-to-filter, real FTS5 search with route-to-entity.
  - Per-note collection chip + manual tag input on every editor surface.
- **Assets**: drag-drop ingest, clipboard paste, file storage in `$APPDATA/assets/`, `asset://` URL serving, image-vision auto-tagging via CLI `@<path>` attachment.
- **Cross-app**: Spotlight (⌘K) surfaces apps + commands + files + live FTS5 Archive hits. "New Note / Journal Entry / Project / Mood Board" commands deep-link into Archives with the new item open.
- **Archives Claude rail**: subscription CLI auth (same as Orion), session-resumed.
- **Migrations 0001..0012** (notes/chats/assets/search + kind + location + asset metadata + mood boards + collections + embeddings + per-project workspace layouts + chat origin).
- **XDesign Phase C**: design canvas (rect/ellipse/text/image/frame/path), layers tree, inspector with collapsible sections, magenta Claude rail with command DSL, auto-layout, gradients, stroke align, pages, export PNG/SVG, group/ungroup, components (main + instance with sync/detach), drag-reparent in layers, variables + modes (panel + switcher + ColorField var picker).
- **Semantic search**: local embeddings via `@xenova/transformers` (all-MiniLM-L6-v2, quantized), `embeddings` table with hash-aware re-embed, `searchHybrid` blends FTS5 + cosine, backfill on boot + real-time reindex on save (notes/chats/assets including post-autotag).
- **Claude Code tab in Orion**: `view.openClaudeCode` (⌘⇧L) spawns interactive `claude --model claude-opus-4-7` in a pty inside a workspace tab. Persistent tab kind survives tab switches without killing the session.
- **Polish shipped**: window state across launches, aurora drift + mount-in + dock magnify animations, full Settings modal (4 sections), keybindings overlay (⌘/), wallpaper customization, "New X" deep-links into Archives, past-chats view, multi-select (Media + Mood boards), drag-reparent project subpages, live file tree refresh on tool_use, voice waveform menubar slot (visual only).

**Still deferred / not started** (as of 2026-05-28)

Correctness / risk:
- **Test coverage still partial** — 46 unit tests now cover the extracted pure logic (wake phrase, mcp name, speakable text, embeddings, db, registry, plaintext). Still no tests for the stateful R.O.S.I.E tool loop, voice capture, or MCP merge (these need integration harnesses / Tauri mocks).
- **Migration checksum fragility** — past incidents (mig 3, mig 10). Strictly append-only; never edit an applied migration.
- **UI behavior largely human-unverified** — agent can't run the Tauri app; voice/MCP/window flows are verified by the user, not automated.

Rough edges:
- **Voice mic in `tauri dev`** — only works in the bundled .app (parent-process owns the mic grant in dev).
- **Wake word robustness** — VAD thresholds untuned; Whisper-tiny isn't a purpose-built wake model, so false triggers / misses possible. Revisit with Porcupine if annoying.
- **Light theme** — wired but most surfaces are dark-tuned.
- **MCP server headers** — single header pair only (covers Authorization); multi-header / env-var editing not exposed.

Nice-to-have:
- **XDesign "floating Claude over canvas"** (original brief) — currently a docked magenta rail.
- **Accessibility** — custom buttons throughout; keyboard nav incomplete on some surfaces.

---

## Don'ts (carry-forward rules)

- Don't edit prior migrations — append only.
- Don't break any Week 1/2 functionality. If a feature used to work, it works after the refactor.
- Don't propose alternatives to the locked stack.
- Don't reuse `OrionTerminal` as a component name.
- Don't couple ClaudeChat to a specific backend — props-driven, `onSend` callback.
- Don't add comments narrating what code does. Only the why, and only when non-obvious.
- Don't introduce dependencies outside the approved list without asking.
- Don't bring back the old single-window architecture.

---

## Quality bar

- Window drag at 60fps
- Spotlight under 50ms perceived
- Claude streaming feels like claude.ai (visible token-by-token)
- Inline-edit diff within ~500ms of submit
- Copy from the design handoff appears exactly as specified (typos and capitalization included): `Ready when you are.`, `⌘K claude`, `claude · listening`, etc.
- Atomic file saves (.tmp + rename) preserved

---

## Session log

### 2026-06-05 — Hermes usage controls: turn-budget PAUSE/Continue · no recursive fan-out · CLAUDE.md trimmed
- **CLAUDE.md trimmed** (the #1 per-agent token sink): split to **232 lines / ~7k tokens** (was 945 / ~45k); entries from 2026-06-02 and earlier moved to `CLAUDE_LOG_ARCHIVE.md` (not auto-loaded). Durable top sections + recent log stay. ~38k tokens cut from every agent and every Claude Code session.
- **No recursive fan-out:** each Hermes agent now runs with `--disallowed-tools Task Workflow`, so it can't spawn its own sub-agents / multi-agent workflow (the `deep-research` fan-out that devastated usage). Keeps Bash/Read/Edit/Write/WebSearch/etc.
- **Turn budget = PAUSE, not truncate** (per user): agents run with `--max-turns 25`. Hitting it → CLI `result` subtype `error_max_turns`, which the engine now treats as a new **`paused`** status (resumable, amber) instead of a failure, keeping the claude session. New `hermes_continue_agent(agent_id, project_root)` command resumes that agent (`--resume <sid>` + a fresh budget + a "continue" nudge). `maybe_finalize_task`: any paused agent → task → `paused`/review. UI: **Continue** button on the floor card, swarm row, and transcript; paused excluded from Dispatch (use Continue). New `paused` threaded through `HermesStatus` + STATUS_LABEL/CLS/RANK + CSS `.s-paused`. (Known gap: no "Continue all" yet — continue agents individually.)
- ⚠️ **Needs a full `tauri dev` restart** (Rust: new flags + `paused` handling + new command). No migration (`paused` is just a status string). tsc / cargo / **99 tests** / build green.

### 2026-06-05 — Hermes: surface the REAL agent error + usage diagnosis
- **Bug:** every swarm agent showed "agent exited with an error". Root cause: `run_agent` only reported **stderr**, but the CLI delivers run-level failures (usage/rate limits, API errors, max-turns) in the stream-json **`result` event** (with `is_error`/`subtype`/`api_error_status`), not stderr — which is empty, so we always fell back to the generic string. Fixed: capture the result-event error (`result_error`) and treat `is_error || subtype != "success"` as failure regardless of exit code; the UI now shows the actual reason. cargo green.
- **Usage diagnosis (why a swarm devastates the quota, even on Sonnet/Max-5x):** each agent is a full Claude Code subprocess that auto-loads the project context. Measured: a trivial **"ok"** call with the engine's exact flags cost **$0.23** and **~78k tokens** (60,892 cache-creation + 16,836 read) — because cwd=the repo pulls in **CLAUDE.md (~45k tokens / 940 lines)** + the user memory dir (~5k) + skills + MCP schemas, re-read every turn, ×N agents in parallel. Agents also inherit claude-code's full toolset incl. **Workflow/Task/`deep-research`**, so one agent can self-spawn a whole fan-out (the earlier "deep-research workflow running…" was exactly that). Model choice is minor next to this.
- **Mitigations (offered, not yet applied — tradeoffs):** run swarm agents in a clean cwd (drops CLAUDE.md/memory — biggest win, loses project context); `--strict-mcp-config` (drop global MCP servers); `--max-turns N` (bound runaway); restrict tools (`--disallowed-tools Workflow,Task…` so agents can't recursively fan out); smaller swarms / Haiku workers; and trim CLAUDE.md's old log (cuts ~45k tokens from every agent AND every Claude Code session).

### 2026-06-05 — R.O.S.I.E z-index fix · model pickers on every rail · Hermes live tool feed
- **R.O.S.I.E always-on-top:** `.ot-rosie-overlay` was `z-index: 90`, but windows use a growing inline `z` and dock/menubar=1000, companion=1400, spotlight=2000 — so any focused window buried it. Bumped to **2600** (above all shell chrome). Pure CSS.
- **Per-surface model pickers (Archives/Orion/XDesign rails + R.O.S.I.E):** new shared registry `src/lib/models.ts` (`MODELS` = Opus 4.8 / Sonnet 4.6 / Haiku 4.5, ids = CLI `--model` values) + `useModelPrefs` store (per-surface choice, persisted to `app_state` key `"models"`, hydrated in App boot). `claude_send` gained a `model: Option<String>` param (blank → `OPUS_MODEL`); `ipc.claudeSend` + all four send sites pass their surface's model. New `<ModelSelect>` component sits in the `ClaudeChat` header (all 3 rails, keyed on `appId`) and the R.O.S.I.E header. Hermes' `util.ts` now re-exports `MODELS` (DRY; Hermes keeps its separate **per-agent** model from 0016). NOT covered (different code paths, distinct one-shots): inline-edit ⌘K, the Claude Code tab, and `claude_oneshot` background jobs (auto-tag / week-read / proactive) — stay on Opus.
- **Hermes live tool feed:** `run_agent` only forwarded assistant prose, so a backgrounding agent showed just a summary. Now it parses the stream-json: each `tool_use` becomes a live `▸ <tool>  <brief>` line (deduped by id; MCP prefix stripped; input summarized), failed `tool_result`s become `✗ <tool> failed — …`, and the latest prose trails below — composed into the agent's `output` and emitted as it happens. New helpers (`collect_tool_uses`/`collect_tool_errors`/`summarize_tool_input`/`compose_feed`); frontend `logKind` colors the `▸`/`✓`/`✗` glyphs (dispatch/report/error). Cards tail the feed live; the report doc shows process + conclusion.
- ⚠️ **Needs a full `tauri dev` restart** (Rust signature change in `claude_send` + `hermes.rs` rebuild). No new migration this turn. tsc / cargo check / **99 tests** / vite build all green. Runtime/UI human-unverified.

### 2026-06-04 — Hermes: per-agent model selection + board-column polish
- **Per-agent model (migration 0016):** agents were hardwired to `OPUS_MODEL`; now each agent carries a `model` column (`ALTER TABLE hermes_agents ADD COLUMN model TEXT NOT NULL DEFAULT ''`; '' = engine default = Opus, so existing rows + ROSIE's column-listed MCP insert are back-compat). Threaded through `HermesAgentRow` (insert/update), `useHermes` (`HermesAgent.model`, `rowToAgent`, `addAgent(…, model?)`, `updateAgent({model})`), and the engine: `DispatchAgent.model` + `read_dispatch_agents` selects `a.model`; `run_agent` uses `agent.model` (non-blank) else `OPUS_MODEL` for `--model`.
- **UI:** shared `HERMES_MODELS` (Opus 4.8 / Sonnet 4.6 / Haiku 4.5, ids = CLI `--model` values) + `modelLabel`/`modelShort`/`DEFAULT_MODEL_ID` in util. A **per-agent Model `<select>`** sits above the prompt in the detail modal's transcript pane (disabled while running); the modal header meta + Details "Model" row show the selected agent's model; each floor card's role line shows `· <model-short>`. Picker writes the chosen id via `updateAgent`; new agents default to '' (Opus).
- **Board polish (from screenshot):** columns were pinned at `min-width:200px` so the card footer overflowed (Dispatch button clipped). Now `flex: 1 1 260px; min-width: 260px` (board scrolls when 6 don't fit), `.hm-card-foot` is `flex-wrap: wrap; row-gap` (Dispatch drops to its own right-aligned line instead of overflowing), and `.hm-card-act` is `white-space: nowrap`.
- ⚠️ **Requires a full `tauri dev` restart** (new migration 0016 + Rust signature change — frontend hot-reload alone leaves a schema/engine mismatch). tsc / cargo check / **99 tests** / vite build all green. Runtime/UI human-unverified (agent can't run Tauri).

### 2026-06-04 — Hermes: rebuilt Floor to match the ANIMUS//CMD reference (orange+black), real-data mapped
- User supplied a Claude-designed reference (`~/Downloads/animus commandcenter/floor-only`, a Bitwig-skinned "Department Floor" command center) and wanted Hermes to look like it **exactly** but in **orange+black**, keeping our real features + the reference's features. Rewrote `HermesApp.tsx` + `HermesTaskDetail.tsx` and replaced the whole `.hm-*` CSS block.
- **Palette:** self-contained orange+black tokens scoped to `.hm-shell` (near-black greys `#0a0a0b`→`#323239`, hairline `#050506` seams, accent **`#ff8a3d`**, status colors working=orange/done=green/error=red/idle+cancel=grey). Updated the dock icon to the same orange. Mirrors the reference's flat-panel + sharp-corner (3px) + clipped-topbar look.
- **Reference features → real data (no fabrication):** top bar (clipped corner, `HERMES//CMD`, Active/Reports stats, clock, Live/Idle pill) · **floorbar** "01 · Swarm Floor" with **task-as-department filter chips** (distinct floor tasks, colored via `deptColor(id)` hash) + "+ New" · agent cards with **status-left-border, pulsing dot, working scan-line, and a live log tail** (agent.output split into colored `.logline`s via `logKind` heuristic — no fake timestamps) · reports rail (Reports=completed agents → doc, Completed=done tasks) · centered **in-depth modal** (stripe + editable title + action bar; left = live transcript of the selected agent + its editable prompt; right = Details key/values, Swarm list, Goal) replacing the old right-drawer · **report doc modal** rendering a completed agent's output as markdown (ported tiny `md.ts`).
- **Kept all real features:** Floor/Board toggle, kanban drag + dispatch gate + ROSIE badge + agent pips, edit title/prompt/per-agent-prompt, add/remove/stop agent, dispatch/stop/delete task, column move, the approval gate. New helpers `src/apps/hermes/{util.ts,md.ts}`. Dropped the reference's fabricated bits (CPU/mem/ctx bars, fake processes, manager card).
- **Fill-the-window fix (root cause, pre-dated this work):** `.ot-window-body` is a flex **row**; every other shell fills it with `flex: 1`, but `.hm-shell` only had `height: 100%` (stretches the cross axis) and no `flex: 1` (needed to grow the main/width axis) — so Hermes sized to its content and the empty body showed the window behind (the faint Archives + companion bleed-through the user saw). Added `flex: 1; min-height: 0; min-width: 0` (+ explicit `width/height: 100%`). Now fills edge-to-edge at any window size.
- tsc / **99 tests** / vite build all green; HermesApp chunk 13.2→20KB. UI still human-unverified (agent can't run Tauri); frontend-only (no migration/Rust change), so a normal hot-reload picks it up.

### 2026-06-04 — Hermes UI redesign → command-center (Floor/Board, orange+black)
- The first cut read as a cramped kanban (6 columns overflowed/cut off in the window). Rebuilt `HermesApp.tsx` to a command-center modeled on the user's ANIMUS//CMD reference but in the **orange+black** palette (amber accent, not the ref's teal). Top **command bar**: `HERMES//CMD` brand + a **Floor/Board** segmented toggle + live stats (`ACTIVE running/total`, `TASKS n`) + a ticking clock + New task.
- **Floor view** (default): responsive grid (`auto-fill minmax(300px,1fr)`) of **agent cards** — name + task-as-role + outlined status tag (WORKING/ERROR/DONE/IDLE/STOPPED), a `▸ prompt` line, a terminal-style live-output `<pre>` with a status-colored left bar, and a foot (state · stop/view). Floor = agents whose task is staged/in-flight (not backlog/done), sorted running-first. Right **Reports rail**: REPORTS (completed agents) / COMPLETED (done tasks) tabs with an amber underline; click → task detail.
- **Board view**: the kanban, restyled to match (narrower 228px columns, status-colored top borders, horizontal scroll for the 6 columns) — staging only; dispatch still gated.
- CSS fully rewritten (`.hm-*` block in tokens.css, monospace, `--hm-red #ff5e6a` for errors, status-colored card borders + tags + pips). Detail-drawer styles recolored cyan→amber. tsc / 99 tests / build green; HermesApp chunk 13.2KB. UI still human-unverified (agent can't run Tauri).

### 2026-06-04 — Hermes: 4th app — a multi-agent orchestration Kanban (ROSIE orchestrates above it)
- **What it is:** a new in-canvas app `hermes` (amber accent, `Workflow` icon) — a Kanban where each task can fan out to a **parallel swarm** of headless `claude` agents. ROSIE is the meta-orchestrator above it: she plans/creates/arranges cards via MCP tools but **never dispatches** (approval gate — the user clicks Dispatch). NOTE: this is its own project, unrelated to the Nous Research "Hermes" gateway / Animus mac-mini work; the name collision is coincidental. A "Hermes agent" = a `claude --print --output-format stream-json` subprocess (reuses `claude_cli` plumbing: augmented PATH, Opus, Orion MCP config attached so swarm agents get Orion-aware tools). No external dependency, no HTTP endpoint, no mock — real agents on the subscription CLI.
- **Data (migration 0015):** `hermes_tasks` (cards: column backlog|ready|running|review|done|blocked, status, parent_id for sub-tasks, created_by user|rosie) + `hermes_agents` (swarm members: prompt, status, output, session_id, position). db.ts helpers + `useHermes` store (Map-based, like notesStore). Board state lives in orion.db (decision: local SQLite, not a shared backend).
- **Engine (`src-tauri/src/hermes.rs`):** `hermes_dispatch_task` reads dispatchable agents (status idle/failed/cancelled), spawns one subprocess per agent IN PARALLEL, streams each agent's assistant text via `hermes:agent` events + status via `hermes:agentStatus`, and rolls the task up (`maybe_finalize_task`: all completed→review, any failed→blocked, any cancelled→ready) via `hermes:task`. Engine is the sole DB writer during a run (frontend mirrors events; persists results so they survive relaunch). `hermes_stop_agent`/`hermes_stop_task` cancel via a Notify map. Boot `load()` reconciles agents/tasks left 'running' by a previous quit back to re-dispatchable. cache-invalidation uses `refresh()` (not `load()`) so ROSIE's MCP writes don't clobber a live swarm.
- **ROSIE tools (mcp_server.rs):** `orion_hermes_list_tasks` / `get_task` (gather results) / `create_task` / `add_agent` / `update_task` / `move_task` / `decompose` — all DB-only; `move_task`/`create_task` REJECT column='running' (dispatch is user-only). `orion_open_app` now accepts 'hermes'. EventBridge invalidation keyed on `isOrionHermesWriteTool`.
- **UI:** `src/apps/hermes/HermesApp.tsx` (6-column board, drag between columns except running, per-card dispatch/stop + agent pips + ROSIE badge) + `HermesTaskDetail.tsx` (drawer: editable title/prompt, swarm list with per-agent live streaming output + stop, add agent, dispatch all). `.hm-*` CSS in tokens.css, `--neon-amber`/`--hermes-accent` tokens.
- ⚠️ Needs a full **`tauri dev` restart** (new migration 0015 + new Rust module/commands — Rust rebuild, not just frontend hot-reload). All green: cargo check / tsc / **99 tests** (added matcher + store-reducer tests) / vite build. HermesApp is its own 8.3KB lazy chunk. Runtime/UI human-unverified (agent can't run Tauri). Approval-gate is enforced both in the UI (only user Dispatch calls the engine) and in ROSIE's tools (can't set 'running').

### 2026-06-04 — v1 release prep, phase 0+1: git baseline + cleanup
- **Decision:** first version = personal **unsigned** macOS build; scope = everything already built (3 apps + voice/wake-word + R.O.S.I.E companion). iOS companion is its own track (already on TestFlight). Assessment: code is healthy (tsc/cargo/91 tests green, no TODOs, all 3 apps wired end-to-end) — v1 is a *ship-what-exists* problem, not a feature problem.
- **Protect:** backed up live data → `~/orion-data-backup-2026-06-04` (orion.db + assets, 16M). **`git init` + first commit `8de7f06`** — the repo had NO version control before this. Hardened `.gitignore`: added `src-tauri/target` (was 11GB, would've been catastrophic to stage) + Swift/Xcode dirs (`.build`, `DerivedData`, `*.xcodeproj`, `.swiftpm`). 311 files committed, 0 from target/node_modules/dist.
- **Cleanup:** deleted 9 stray empty root files (`#`, `be`, `forces`, `icon`, `on`, `re-embedded`, `rebuild`, `the`, `to` — debris from a botched shell cmd); fixed false "XDesign — stub for now" text in Settings About ([SettingsPanel.tsx](src/features/settings/SettingsPanel.tsx) AboutSection). Version 0.1.0 already consistent across tauri.conf.json / Cargo.toml / package.json.
- **Next (user-run, Tauri can't run headless):** Phase 2 = `npm run tauri build` → unsigned `.app`/`.dmg`, get past Gatekeeper (right-click→Open or `xattr -dr com.apple.quarantine`). This is the FIRST release bundle of current code (prior bundle was May 28) and the only way to exercise voice/wake-word (bundled .app owns the mic grant) + the bundled MCP sidecar (`current_exe() --mcp-serve`). Phase 3 = click-through smoke test of all 3 apps + shell + companion. ⌘K inline-edit is the one feature still needing an API key.

### 2026-06-03 — Archives 47 desktop: right-click context menus + working toolbar (Share/Star/More/New) + Favorites
- **Reusable context-menu system** (`src/components/ContextMenu.tsx`): `useContextMenu()` → `{ openAt(e, items), openFromButton(el, items), menu }`. Portal to `<body>`, viewport clamp + flip, closes on outside-mousedown(capture)/Esc/scroll/blur/resize. `MenuItem` = item (label/icon/onClick/danger/disabled/checked) | separator. Doubles as a button-anchored dropdown. CSS `.ot-ctx-*` in tokens.css.
- **Right-click everywhere** via centralized builders (`src/apps/archives/itemMenus.tsx`): `noteMenuItems` (Open/Rename/Favorite/Export-MD/Delete; `onDelete` override so Projects cascade-delete its subtree, `extra` for "New subpage"), `assetMenuItems` (Preview/Favorite/Add-to-board/Copy-path/Delete), `boardMenuItems` (Open/Rename/Favorite/Delete). Wired into Notes grid, Journal rail, Projects tree, Media tiles, Mood list cards, and Chats rows (Chats inline: Open/Rename/Delete via new `renameChat`/`deleteChat` db helpers).
- **Favorites** — migration **0014** adds `favorite INTEGER NOT NULL DEFAULT 0` to notes/assets/mood_boards (+ indexes; insert helpers now take `Omit<Row,"favorite">` so the DEFAULT applies). `favorite: boolean` threaded through all three stores + `toggleFavorite(id, force?)` + `setNoteFavorite`/`setAssetFavorite`/`setMoodBoardFavorite`. Star badges render on favorited cards/rows; new **Favorites** sidebar view (`Favorites.tsx`) aggregates starred notes/pages + boards + media and routes into each on click.
- **Toolbar wired** (`src/apps/archives/Toolbar.tsx`, replaces the 4 dead buttons): **★** toggles favorite on the view's *active* item (open note/entry/project/board; disabled + tooltip on grids), filled gold when on. **+** = per-view create (note/entry/project/board-via-prompt/import-media-via-open-dialog). **Share** = dropdown (Export open note as Markdown · Export Archives JSON backup · Import notes…). **⋯ More** = contextual (Rename/Favorite/Delete the active item) + Show favorites + Refresh.
- **New primitives:** `PromptModal` (imperative `promptText({...})`, mounted once in Shell) for renames/new-board; `exportImport.ts` (blocks→Markdown serializer, `save`/`open` dialogs via `saveFileAtomic`/`readFile`). Added `dialog:allow-save` to capabilities.
- ⚠️ **Requires a full `tauri dev` restart** (new migration + capability change — Rust rebuild, not just frontend hot-reload). UI human-unverified (agent can't run Tauri). tsc / vite build / **91 tests** / cargo check all green. Note: the iOS companion helper reads orion.db; the new `favorite` column is additive and ignored by its reads/write-back (no Swift change needed).

_Entries from 2026-06-02 and earlier are archived in [CLAUDE_LOG_ARCHIVE.md](CLAUDE_LOG_ARCHIVE.md) — kept out of this file so every Hermes agent and Claude Code session loads a much smaller project context._
