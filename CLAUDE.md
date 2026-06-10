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
- **MCP server headers** — single header pair only (covers Authorization); multi-header / env-var editing not exposed.

Nice-to-have:
- **XDesign "floating Claude over canvas"** (original brief) — currently a docked magenta rail.
- **Accessibility** — custom buttons throughout; keyboard nav incomplete on some surfaces.

---

## AAA Rebuild tracker

The "AAA REBUILD · MASTER BRIEF" (started 2026-06-10) drives a multi-session rebuild: Orion ≥ Cursor, Archives ≥ Notion, XDesign ≥ Figma (single-player), shell = real OS. Paste the brief each session; THIS section is the durable progress state — continue from the first unfinished item. Per-phase protocol: research → audit → ranked plan (user approval) → green slices (commit each) → user smoke test → ✅.

**First-session decisions (2026-06-10, locked):**
- Tab autocomplete: APPROVED — Messages API w/ keychain key, model = Haiku 4.5 (`claude-haiku-4-5-20251001`).
- New deps APPROVED: LSP servers (typescript-language-server, pyright, rust-analyzer) + a geometry lib for XDesign boolean ops.
- Light theme: CUT — dark-only; remove toggle + dead palette in Phase 0.3.
- Release target: unsigned personal .app/.dmg (no signing/notarization).

**Phase 0 — Foundation** 🔨
- ✅ 0.1a Tier 2 perf: heavy blur radii cut (40/28/24px → 12-16px) + "Reduce transparency" setting (+ OS accessibility media query)
- ✅ 0.1b Tier 3 perf: embeddings → Web Worker (model load + inference off the main thread)
- ✅ 0.1c Tier 3 perf: ROSIE lazy-mounted → main chunk 858KB → 513KB; Tier 1 verified intact
- ✅ 0.2a Toast/notification queue (toastStore + ToastHost; history ring feeds Phase-4 notification center)
- ✅ 0.2b Per-window error boundaries (already wired pre-rebuild — verified, not rebuilt)
- ✅ 0.2c confirmAction() in-canvas dialog + toast.undo() pattern
- ✅ 0.2d WAL-safe orion.db backup rotation on boot (keep 5)
- ✅ 0.3 Design tightening: global scrollbar + keyboard-focus baselines; light theme verified already-cut; theme-aware accent alphas (284 hardcoded rgba triplets → `var(--neon-*-rgb)` twins, fixing Minimal/Modern drift). EXPLICIT RE-SCOPE: per-surface typography/spacing normalization moves into each app phase's polish + the Phase 4.6 cohesion pass — doing it blind across 9900 lines of CSS without visual verification is regression roulette; surface-by-surface with eyes on it is the AAA way.
- ✅ Phase 0 user smoke test (2026-06-10): user verified post-restart; one finding (BlockNote handles overflowing the note card) fixed `9a5e5df` and confirmed.

**Phase 0 — DONE ✅**

**Phase 1 — Orion ≥ Cursor** 🔨 — ranked plan APPROVED 2026-06-10 (research: [docs/research/cursor-2026.md](docs/research/cursor-2026.md)). Strategy: editor-first (Hermes owns swarms), beat Cursor on trust (context pills, never-silent writes) + integration (@archives-notes).
- 🔨 1.1 AI editing core (~3 sessions): ✅ P2b per-hunk accept/reject + inline decorations + hunk bar (2026-06-10) · ⬜ P2c streaming ⌘K + follow-ups + ⌥Return quick-question · ⬜ P2d @-context picker (file/folder/problems/terminal/git-diff/archives-note) + context pills · ⬜ P2e codebase index on the embeddings worker (function/class chunks, gitignore-aware, incremental)
- ⬜ 1.2 Tab autocomplete (~2): Haiku 4.5 ghost text <300ms p50, accept full/word, recent-edit+diagnostics context; stretch: edit-diffs, next-edit jump
- ⬜ 1.3 Navigation/feel (~1): ⌘P frecency file picker · ⌘⇧O symbols · breadcrumbs · split-editor command · cross-file go-to-def; stretch: terminal ⌘K
- ⬜ 1.4 Git (~2): gutter markers · tree status colors · stage/commit/push UI · AI commit messages (claude_oneshot) · branch switcher · blame — via git binary, no new crate
- ⬜ 1.5 Checkpoints + whole-turn review (~1-2): auto-snapshot before agent turns, restore that never destroys history, consolidated per-turn review
- ⬜ 1.6 Real LSP (~3): ts-language-server/pyright/rust-analyzer via Rust stdio, semantic diagnostics, cross-file refs/rename/actions, graceful degradation
- CUT from Phase 1 (explicit): cloud agents/Slack control, in-editor browser + Design Mode, separate Plan Mode, Bugbot-style PR review, voice agent control, RL autocomplete tuning.

**Phase 2 — Archives ≥ Notion** ⬜ · **Phase 3 — XDesign ≥ Figma** ⬜ · **Phase 4 — One terminal, one brain** ⬜

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

### 2026-06-10 — AAA Rebuild (cont.): Phase 0 ✅ · Phase 1 plan approved · P2b per-hunk review shipped
- **Phase 0 closed:** finished 0.3 with the **theme-aware accent sweep** — Minimal/Modern themes override `--neon-*` but 284 hardcoded `rgba(57,255,136,…)`-style literals stayed neon; new `--neon-*-rgb` twin tokens in :root + both theme blocks (generalizing the existing `--xd-accent-rgb` pattern; XDesign's scoped magenta override keeps its rgb twin via `--neon-magenta-rgb: var(--xd-accent-rgb)`). Identical pixels in the default theme. Stray hexes audited: theme-picker swatches + EventBridge default shape fill are correctly literal; monacoTheme/ptyTerminal can't read CSS vars (theme-following Monaco/xterm = later polish). Typography/spacing normalization EXPLICITLY re-scoped to per-app polish + Phase 4.6 (blind 9900-line CSS edits = regression roulette). User smoke test passed (one finding: BlockNote handles, fixed `9a5e5df`).
- **Phase 1 plan researched + approved:** two web-research passes condensed into [docs/research/cursor-2026.md](docs/research/cursor-2026.md) (Cursor 3.7 feature map + sentiment: Tab/next-edit-jump is THE loved feature; visible red/green review is the trust anchor; top complaints = pricing opacity, 20-100GB bloat, context opacity — "context pills" validated as our differentiator; Cursor's agent-platform pivot alienates editor-first users → Hermes owns swarms, Orion stays editor-first). Approved order: 1.1 AI core (P2b-e) → 1.2 Tab autocomplete → 1.3 ⌘P/nav → 1.4 git → 1.5 checkpoints → 1.6 LSP (~12 sessions). Cuts explicit in tracker.
- **P2b shipped (start of 1.1): per-hunk accept/reject.** `lineDiff.ts` — Myers line diff → hunks + `composeFromHunks` with a **fold model**: accepting folds the hunk into `original`, rejecting folds it out of `updated` (atomic disk write), so the stored pair always represents exactly the remaining undecided diff and file-level Accept/Reject keep working as "the rest" (14 tests; >4000-D guard falls back to one whole-file hunk). `acceptHunk`/`rejectHunk` in pendingEditsActions (last hunk delegates to the file-level path; `isNew` files stay file-level). DiffReview gains a **hunk navigator** (k/n + prev/next with centered reveal + per-hunk Keep/Reject + +/− stats). **Editor.tsx now renders inline trust markers** while a file has an unreviewed agent edit: green line background + gutter bar on changed ranges, magenta gutter bar at deletion points, overview-ruler marks — live-updating via store subscription, cleared on resolve.
- All frontend (hot-reloads, no restart). tsc / **121 tests** (107→121) / vite build green. Commits: `acb1ca3` rgba sweep, `e36a59f`+`220570e` docs/plan, `778b387` P2b core, `cbfffec` decorations.
- **Review readability pass** (user feedback: "clunky, hard to read"): DiffEditor now collapses unchanged regions (expandable bars, 4-line context) so a 10-hunk review reads like a patch; `wordWrap: on` (long lines were clipping off-screen); sticky scope header disabled (the floating black bar); horizontal scroll resets on hunk jump; slimmer gutters; **brand diff colors in orion-neon** (green/magenta insert/remove instead of Monaco's muddy defaults — theme had none defined); hunk Keep/Revert are now color-cued icon buttons inside the nav pill.

### 2026-06-10 — AAA Rebuild session 1: decisions locked, Phase 0 ~90% shipped
- **Master brief started** (see "AAA Rebuild tracker" above). First-session decisions locked: autocomplete = Haiku 4.5 via Messages API ✅, LSP servers + geometry lib both approved ✅, light theme = cut (verified already gone — 3 dark themes, nothing left to remove), release = unsigned .app/.dmg. Committed the outstanding 06-09 work first (`cf2174b`).
- **0.2 Resilience** — `toastStore` (capped visible stack + FIFO queue + dedupe keys + 50-entry history ring for the future notification center; errors sticky; `toast.undo()` do-then-undo helper; 8 tests) + `ToastHost` (bottom-right, kind-colored, hover-pauses, reduced-motion). `confirmAction()` in-canvas confirm (danger variant) replaces the native Tauri dialog in FileTree delete; FileTree rename/delete failures + boot-hydrate failure now toast instead of console-only. Per-window error boundaries were **already wired** (App root + every window + ROSIE + Companion) — verified, not redone. **DB backups**: `db_backup.rs` rotates a snapshot into `<app-config>/backups/` (keep 5) on every boot via SQLite's online backup API (WAL-safe vs the iOS helper's out-of-band writes), synchronously in `setup()` so it lands pre-migration; 4 Rust tests (9 total).
- **0.1 Perf** — Tier 2: heavy backdrop blurs cut 40/28/24px → 12–16px (ROSIE panel is rgba .88 — visual delta nil); `html.ot-reduce-glass` kills all backdrop-filters (Settings → Appearance switch, persisted `reduce_glass`) and the OS "Reduce transparency" preference is honored via media query. Tier 3: embeddings model+inference moved into a dedicated **Web Worker** (`embeddingsWorker.ts`; same `embed`/`warm` API, transferable vectors, self-healing respawn; transformersEnv stays for main-thread Whisper). **ROSIE UI lazy-mounted** (it dragged react-markdown+highlight.js into boot): main chunk **858KB → 513KB** (gzip 267→162KB); mounts on first open, stays mounted (drafts survive close), idle-prefetched at +3s. Tier 1 verified still intact.
- **0.3 partial** — global scrollbar baseline (slim thumb everywhere, not just `.scroll`) + global keyboard `:focus-visible` ring on buttons/links/role-controls (was: 3 controls in the whole app). Remaining: per-surface hardcoded-value/typography/spacing sweep → next session, then the Phase 0 smoke test.
- ⚠️ Needs a **`tauri dev` restart** (Rust: db_backup module + rusqlite `backup` feature). Frontend slices hot-reload. tsc / **107 frontend tests** (was 99) / cargo (9 tests) / vite build all green. Five commits: `97f5f70` toasts+confirm, `448de93` db backup, `9c56bea` blur, `41d6a16` worker, `fc044b0` rosie-lazy, `75727f1` baselines.
- **Smoke-test fix** (`9a5e5df`): BlockNote's +/drag handles hung outside the note card — `.bn-editor`'s gutter was zeroed and the handles render IN that gutter. Restored the library's 54px `padding-inline`, card inline padding 40→12, title/journal-meta +26px to keep alignments. User confirmed the rest of the smoke test looked right.

### 2026-06-09 — Orion → Cursor parity, Phase 2a: agent edits as in-editor Accept/Reject diffs
- **The Cursor "agent" centerpiece:** the Orion chat agent's file edits now apply to disk AND surface in the editor as a **reviewable diff with Accept / Reject**, instead of silently writing and forcing a manual reload.
- **Backend:** two new MCP tools in `mcp_server.rs` — **`orion_apply_edit`** (exact `old_string`→`new_string` replace, same contract as the native Edit tool; unique-match guard + `replace_all`) and **`orion_write_file`** (create/overwrite). Both resolve the path (abs or project-relative via the context snapshot), read the original, write atomically (`write_atomic`, creates parent dirs), then `send_ui_action("staged_edit", {path, original, updated, is_new})`. `claude_cli.rs` `claude_send` now passes **`--disallowed-tools Edit Write MultiEdit NotebookEdit`** so every chat-rail edit routes through the reviewable tools (mirrors Hermes' disallow pattern; interactive Claude Code tab + Hermes keep native tools).
- **Frontend:** `pendingEditsStore` (path → {original, updated, isNew}; multiple edits/file collapse to one review keeping the earliest original). EventBridge `staged_edit` handler stages it, refreshes the open buffer to the new content via `markLoaded` (clean — disk matches), bumps the file tree, and opens a **`diff-review` tab** (`DiffReview.tsx`, Monaco `DiffEditor` original→updated + Accept/Reject). New **`changes` panel** (`ChangesPanel.tsx`) lists all pending files with +/- counts and **Accept all / Reject all**; reachable via `view.changes` command + a yellow **"◆ N changes"** status-bar button. Accept = keep (clear review); Reject = restore original (or delete the file if `is_new`) via `pendingEditsActions.ts`. New tab kinds `changes` + `diff-review` (path).
- **Known v1 limits / next:** review is **per-file** (per-hunk accept/reject = Phase 2b), no inline red/green decorations in the normal editor yet (the DiffEditor review shows the full colored diff), and a multi-file change opens one review tab per file. ⌘K inline-edit (2c), @-context picker (2d), and codebase indexing (2e) still pending.
- ⚠️ Needs a **`tauri dev` restart** (Rust: new MCP tools + `--disallowed-tools`). tsc / cargo check / cargo test (5) / **99 frontend tests** / vite build all green. Runtime/UI human-unverified.

### 2026-06-09 — Archives: drop an image from Finder straight into a note/journal/project page
- **Want:** drag an image file from Finder directly into a BlockNote editor surface (note, journal entry, or project page) → it ingests as an asset and drops in as an image block where the cursor is. Previously a Finder drop anywhere in Archives hit the app-wide `"archives"` drop zone (ingest to library / add to open mood board); the note editor only handled *in-app* `ASSET_DRAG_MIME` DOM drags, not native Finder drops.
- **Fix (`NoteEditor.tsx`, `EditorBody`):** registered the `.note-editor-body` as its own `useFileDropZone` (`note-drop-<ulid>`). The drop orchestrator walks up from the cursor and the **innermost** registered zone wins, so a drop on the editor routes here instead of the outer `"archives"` zone — single ingest, no double-handling. Handler `ingestPaths(paths)` → `insertAssetBlocks(created)` inserts an `image` block per image (or a clickable asset link for non-images) after the cursor block, via the new shared `blockForAsset()` helper (also reused by the existing in-app asset-drag path). Green-dashed outline + "Drop to add to this note" pill on hover (`.note-editor-body.dropping` / `.note-drop-overlay`).
- **Covers all surfaces in one place:** Notes, Journal, Projects, and the Orion `note` tab all render `<NoteEditor>` → `EditorBody`, so the single change lights up everywhere.
- Frontend-only — **hot-reloads, no restart** (uses existing `asset_store_file` IPC + Tauri `onDragDropEvent`). tsc / **99 tests** / vite build green. UI human-unverified.

### 2026-06-09 — Orion → Cursor parity, Phase 1: IDE fundamentals + code intelligence
- **Goal (user):** make Orion (the editor) on par with Cursor — features AND *feel*. Agreed a 6-phase plan (full plan in this turn's todos): P1 fundamentals → P2 AI editing core → P3 composer → P4 full multi-language LSP → P5 git → P6 tab autocomplete (deferred). User chose "full multi-language LSP" depth + autocomplete-later. This entry = **Phase 1, all 7 sub-items, shipped & green.**
- **Code intelligence (1.1):** turned on Monaco's in-browser **TypeScript/JS service** in `monacoTheme.ts`'s single `loader.init` hook — completions, hover, signature help, **go-to-definition** (across open models), document formatting, syntax-error squiggles. Semantic validation is deliberately **OFF** (the browser worker has no node_modules types, so it would wrongly underline every import — feels worse than nothing); accurate semantic diagnostics come in P4 via real `typescript-language-server`. `setEagerModelSync(true)`.
- **Diagnostics + Problems panel (1.2):** new `diagnosticsStore` mirrors `monaco.editor.getModelMarkers` via `onDidChangeMarkers`. New **Problems panel** (`ProblemsPanel.tsx`, tab kind `problems`, ⌘⇧M) groups markers by file, click-to-jump. Status-bar error/warn counts are now **real** (were hardcoded `⨯ 0 / ⚠ 0`) and click-through to Problems.
- **Status bar (1.3):** added Ln:Col, selection char count, language id, indent (spaces/tabs+size) via new `editorStatusStore` (Editor reports on cursor/selection/focus, clears on unmount).
- **Find-in-files (1.4):** new Rust `search_in_files` (native walker, literal + case-insensitive, skips ignored dirs/binary/>2MB, bounded) + **Search panel** (`SearchPanel.tsx`, tab kind `search`, ⌘⇧F) with debounce, case toggle, grouped results, click-to-reveal. (Regex = later; no `regex` crate yet.)
- **File tree ops (1.5):** right-click context menu on every row + empty-area + header buttons — **New File/Folder, Rename, Copy Path, Reveal in Finder, Delete** (confirm dialog). New Rust `create_path`/`rename_path`/`delete_path`/`reveal_in_os` (delete is permanent — no trash crate; UI confirms). Rename/delete remap or close open tabs for the path.
- **Multiple terminals + Claude Code tabs (1.6):** `terminal`/`claude-code` descriptors gained optional `id` (in `descriptorKey`). No-id = singleton primary (⌘`, default layout, ⌘⇧L — preserves the 99 tests); the panel "+" opens a fresh `id: ulid()` each time. Extra terminals **tab into the existing bottom dock** (openTab finds the `terminal`-role panel) instead of stacking strips. `Terminal.tsx` takes an `id` prop → unique pty `term-<id>`.
- **Editor feel (1.7):** bracket-pair colorization, active bracket + indentation guides, **sticky scroll**, folding, smooth caret animation + smooth cursor blink, font ligatures, `renderLineHighlight: all`, linked editing, occurrence highlight, mouse-wheel zoom, `detectIndentation`. New **Format Document** (⇧⌥F) via a focusStore action runner. New `editorNavStore` powers reveal-to-line (used by Problems + Search; reusable for go-to-def later).
- ⚠️ Needs a **`tauri dev` restart** (Rust: `fs_ops` search/file-ops + lib.rs handler reg). Everything else hot-reloads. tsc / cargo check / cargo test (5) / **99 frontend tests** / vite build all green. Runtime/UI human-unverified (agent can't run Tauri). **Next: Phase 2 — AI editing core** (in-editor diff apply w/ per-hunk accept/reject, streaming ⌘K, @-context picker, codebase semantic indexing).

### 2026-06-09 — Fix garbled Claude Code terminal + WebGL crisp rendering
- **Symptom:** the embedded Claude Code tab (and shell terminal) rendered the TUI distorted — stacked duplicate "Welcome back" banners + `�`-garbled glyphs (screenshot). Three root causes, all fixed:
  1. **UTF-8 chunk-boundary corruption (`terminal.rs`):** the pty reader did `String::from_utf8_lossy(&buf[..n])` per 8 KB read. Claude's Ink TUI is full of box-drawing/emoji multi-byte chars; any that straddled the read boundary got mangled into U+FFFD permanently. Fix: a **carry buffer** + new pure `incomplete_tail_len()` holds back an incomplete trailing UTF-8 sequence (≤3 bytes) until the next read. 4 unit tests incl. a round-trip that splits a box-drawing+emoji string at every byte offset and asserts no replacement chars.
  2. **Resize storm + bad initial size → stacked banners:** `fit.fit()` ran immediately on open (before layout/font settled), spawned `claude` at wrong cols/rows, then an undebounced `ResizeObserver` spammed pty resizes — each made Ink repaint mid-layout, landing frames below the last instead of overwriting. Fix: **debounced** fit (80ms), **change-guarded** pty resize (skip identical cols/rows), `await document.fonts.ready` before the first fit, and a **zero-size guard** (`waitForSize`) so we never fit a 0×0 container.
  3. **WebGL renderer** (user-requested, only new feature): added `@xterm/addon-webgl@^0.19.0` for crisp GPU text, with `onContextLoss`→dispose graceful fallback to the DOM renderer.
- **Refactor:** the two near-identical 180-line terminal components (`Terminal.tsx`, `ClaudeCodePanel.tsx`) now share **`src/apps/orion/ptyTerminal.ts`** (`attachPtyTerminal`) — all rendering/resize logic lives in one place. Components are ~40 lines each; `Terminal.tsx` keeps its `setPtyId` store wiring via `onOpened`/`onClosed`.
- ⚠️ Needs a **`tauri dev` restart** (Rust reader-thread change in `terminal.rs`). Frontend hot-reloads. tsc / cargo check / cargo terminal tests (4) / **99 frontend tests** / vite build all green. Runtime/UI human-unverified (agent can't run Tauri).

### 2026-06-08 — ROSIE: show full process in chat + AI can read Archives notes
- **Full process now persists in the ROSIE chat:** `handleEvent`'s `assistant` branch **replaced** the pending message's content with each assistant event, so in an agentic turn the last message (the final text) wiped the thinking + tool steps — they flashed then vanished. Fix: accumulate **segments keyed by claude's `message.id`** (`turnSegments`, reset per turn in `runSubprocessTurn`); the message content = flatten of all segments, so thinking → tool → text → more tool → final answer all stay visible and persist with the thread. (No `--include-partial-messages`, so each assistant event is a distinct complete message; same-id re-arrival replaces just that segment.)
- **AI can edit Archives notes without copy/paste:** there was no read tool, so editing a page/journal made it ask the user to paste the content. New **`orion_read_note`** (mcp_server.rs) returns a note's FULL body, resolved by `id` (from `orion_get_context`'s `open_note`, search, or list) or fuzzy `title`; char-safe 16k cap. `orion_update_note_body` description now points at the read→edit flow. The open-note id was already in the context snapshot — only the read tool was missing.
- ⚠️ Needs a **`tauri dev` restart** (MCP server rebuild). ROSIE accumulation is frontend (hot-reloads). cargo check / tsc / **99 tests** / build green.

### 2026-06-07 — Menubar menus wired up (were inert)
- The menubar buttons (the bold app label + File/Edit/View/Window and the per-app menu sets) did nothing. New **`src/shell/menus.ts`** `buildMenu(app, name)` + `appMenu()` return `MenuItem[]` opened via the existing `ContextMenu`. **Every item maps to a real action** — a registry command (label + shortcut auto-derived from `registry.get(id)`), a `useShell` window action (minimize/zoom/close/focus + open-window list), an app-store action (XDesign undo/redo/group/ungroup/duplicate/delete/select, Hermes `createTask`, Archives `setView`), or a `document.execCommand` for generic Edit/Format. No dead entries; unknown menus fall back to a global View block.
- The bold app-name label became an **application menu** (Settings/Shortcuts/ROSIE/Spotlight). Added `openUnder()` to `ContextMenu` (left-aligned dropdown under a button) and fixed `.ot-menubar-app` CSS specificity now that it's a `<button>`.
- Known limits: Hermes Floor/Board toggle is local component state (not reachable from the bar); `execCommand('paste')` may no-op in the webview (native ⌘V still works). Frontend-only (hot-reloads). tsc / **99 tests** / build green.

### 2026-06-07 — ROSIE Archives fix: markdown→blocks + projects-with-subpages (+ consolidated 6 stray pages)
- **Bug:** ROSIE's Archives notes showed **raw markdown** (`#`/`**`/`---`) and "make a project with subpages" produced **flat separate pages**. Root cause in `mcp_server.rs`: `tool_create_note` dumped the whole body into **one paragraph block** and had **no `parent_id`**.
- **Fix:** new **`md_to_blocks()`** (Rust) converts markdown → BlockNote blocks — headings L1–3, `**bold**`/`*italic*`/`` `code` ``, bullet + numbered lists, paragraphs (joins soft-wrapped lines); `---` dropped (no divider in default schema); trailing empty paragraph. Used by `create_note` + `update_note_body` (unit-tested `md_tests`). `orion_create_note` gains **`parent_id`** (nest as a project subpage). New **`orion_create_project`** tool = root project + ordered subpages in ONE call (the correct path). Tool descriptions rewritten so ROSIE picks the project tool and knows bodies are markdown.
- **Consolidated the existing mess:** the alchemy research was **6 flat `kind=project` pages**. Backed up the DB (`~/orion-db-backup-before-alchemy-fix.db`), then (app closed) reparented the 5 under "Alchemy Research" and **re-rendered all 6 bodies** from their stored markdown plaintext via a faithful Python port of `md_to_blocks` → 18 typed blocks w/ bold, proper nesting. Verified.
- ⚠️ Needs a **`tauri dev` restart** (MCP server rebuild + the consolidated DB is read on boot). cargo test green.

### 2026-06-07 — Perf Tier 1 (idle GPU) · calibratable usage % · monitor restyle
- **Tier 1 perf (no visual change):** (1) **Companion** `CompanionScene` `frameloop` "always"→**"demand"** + a **30fps `FrameThrottle`** (a `useThree().invalidate` ticker) while visible — halves the avatar's always-on GPU; still **"never"** when hidden/doc-hidden (the always-on 60fps WebGL loop was the #1 jank source). (2) **Wallpaper** matrix-rain canvas now **pauses** when `document.hidden` or any maximized non-minimized window covers the desktop (it's invisible then); resumes via `visibilitychange` + `useShell.subscribe`. Full backlog (Tier 2 blur, Tier 3 embeddings-worker/bundle) in user-memory `project_perf_optimization_backlog`.
- **Usage % was bogus (showed 471%):** the default $25 5h budget was way too low. Now **calibratable to reality** — click the % in the widget, enter your true number from Claude, and it back-solves the 5h $ ceiling from the current block cost (`budget = block_cost / (pct/100)`), persisted. (User's real ceiling ≈ $400/5h: $117.70 block = 29%.) Cost remains the proxy basis (best local approximation; no official limit API exists).
- **Monitor restyle** to match app chrome: titlebar-style **cyan** header (gradient + hairline), `--glass-border-bright` + cyan glow, uppercase mono labels, tabular nums, cleaner section dividers; pill matches.
- Frontend-only (hot-reloads — no restart needed). tsc / **99 tests** / vite build green. UI human-unverified.

### 2026-06-07 — Desktop monitor widget · R.O.S.I.E float fix · ROSIE idle watchdog 180s
- **Desktop monitor widget** (`src/shell/MonitorWidget.tsx`, mounted in Shell): a **draggable** floating glass panel (persists pos + collapsed state in `app_state` key `widget.monitor`; collapses to a pill, no external reopen needed). Shows **CPU %** + **RAM** (new Rust `sysstats::system_stats` via the **`sysinfo` 0.33** crate — shared `System` so CPU% is the inter-poll delta; polled 2s) and **Claude token/cost usage** over rolling **5h / 24h** windows (new `sysstats::claude_usage`, polled 30s). Usage is parsed from **claude-code's own transcripts** `~/.claude/projects/**/*.jsonl` (per-message `usage` blocks) — covers ALL claude-code usage on the machine, not just this app; files skipped by mtime, lines pre-filtered on `"usage"`, ISO ts → epoch via hand-rolled `days_from_civil` (cross-checked vs Python incl. leap day). Cost is an **estimate** from a per-model-family pricing table (opus/sonnet/haiku). The 5h bar is gauged against a tunable `FIVE_H_REF_TOKENS` anchor — **not** an official limit (Anthropic publishes none). **Temp/GPU deliberately excluded:** Apple Silicon needs sudo/powermetrics to read them (verified), too fragile for a silent widget.
- **R.O.S.I.E float fix:** `.ot-rosie-overlay` was a full-viewport `pointer-events:auto` layer — while open it ate every click, so no window behind it was usable. Now `pointer-events:none` on the overlay + `auto` on `.ot-rosie-panel` only (and dropped the full-screen backdrop dim). ROSIE still opens in front (z 2600) but you can click/use other windows while it stays open. Removed the now-dead backdrop-click-to-close (Esc + X still close).
- **ROSIE watchdog → 180s idle:** bumped 90s→180s AND re-armed on every `claude:event` so it measures **silence**, not total turn time — a long active tool loop no longer trips a false "hung" error; only genuine stalls (silent API backoff, MCP/PATH failure) do. (Diagnosed the user's "didn't respond after 90s": full stack verified healthy — exact command works in 2.9s, migrations 0016/0017 applied, DB intact — so it was a transient silent backoff, not a regression.)
- ⚠️ Widget + `sysinfo` need a **`tauri dev` restart** (new crate + Rust commands). ROSIE float + watchdog are frontend-only (hot-reload). tsc / cargo check / **99 tests** / vite build all green. Runtime/UI human-unverified.

### 2026-06-07 — R.O.S.I.E ambient memory: cross-app activity log (migration 0017)
- **Goal (user):** R.O.S.I.E should have a *gist* of everything done across the terminal — what a swarm researched, what notes/files/designs were touched through the day — even if not full context. Decision (asked): **on-demand pull** (cheapest — zero per-turn token cost) over always-injected digest; **all four surfaces** instrumented now.
- **Storage — migration 0017** `activity_log` (id, ts, source `hermes|archives|orion|xdesign`, kind, title, summary, ref_id; 3 indexes incl. a collapse index). Append-only, **short text only — never full bodies**.
- **Writers:** frontend helper `logActivity()` in `db.ts` (fire-and-forget, self-swallowing; **collapses** rapid repeats of the same `(source,kind,ref_id)` within 10 min into one rolling row so debounced saves don't flood) + `recentActivity()` reader. Hooked: **Orion** `saveFileBuffer` (file.save), **Archives** `notesStore.saveBlocks` (`<kind>.edit`), **XDesign** `App.tsx` persist flush (design.edit, skips the first post-hydrate flush). **Hermes (Rust)**: new `log_activity()` in `hermes.rs` (own id via `AtomicU64` seq, no collapse — each agent's conclusion is distinct) writes **task.dispatch** (on dispatch, with agent count + prompt) and **agent.done** (on completed, with the agent's conclusion excerpt) — this also closes the "swarm results were never fed back" loop.
- **Reader — R.O.S.I.E MCP tool** `orion_recent_activity` (mcp_server.rs): args `source?` / `since_hours?` / `limit?` (default 30, clamp 200); returns `{count, activity:[{when (humanized age), source, kind, title, summary}]}`, newest first. Read-only (no EventBridge invalidation). She pulls it only when relevant ("what was I working on?", "what did the swarm find?") — no ongoing token cost.
- ⚠️ **Needs a full `tauri dev` restart** (new migration 0017 + Rust changes in `hermes.rs`/`mcp_server.rs`). tsc / cargo check / **99 tests** / vite build all green. Runtime/UI human-unverified (agent can't run Tauri). Possible follow-ups: auto-synthesis of swarm output into the task on `review`/`done`; raise the gather 4000-char cap.

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
