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

**Phase 1 — Orion ≥ Cursor** ✅ COMPLETE 2026-06-13 — ranked plan APPROVED 2026-06-10 (research: [docs/research/cursor-2026.md](docs/research/cursor-2026.md)). Strategy: editor-first (Hermes owns swarms), beat Cursor on trust (context pills, never-silent writes) + integration (@archives-notes).
- ✅ 1.1 AI editing core — COMPLETE 2026-06-10: P2b per-hunk accept/reject + inline decorations · P2c in-editor streaming ⌘K + follow-ups + ⌥↵ ask · P2d @-context picker + context pills · P2e codebase semantic index (migration 0018, decl-aware chunker, hash-incremental, worker-embedded; auto-injects into chat with pills + ⌘K related-code)
- ✅ 1.2 Tab autocomplete — core shipped 2026-06-13: Haiku 4.5 ghost text (Messages API, single-flight, keep-alive), 180ms debounce + LRU, diagnostics + recent-edit-ring context, Tab/⌘→ accept, toggle command + persisted flag. DEFERRED (explicit): diff-style edit suggestions + next-edit jump → revisit after 1.6 (need richer signals); latency p50 unmeasured until user runs it
- ✅ 1.3 Navigation/feel — shipped 2026-06-13: ⌘P frecency quick-open (editor-scoped; Spotlight stays ⌘K) · ⌘⇧O Go to Symbol (quickOutline; **Switch Project moved ⌘⇧O→⌘T**) · ⌘\ split editor right (file tabs only) · breadcrumbs + enclosing TS symbol · ⌘F12 project-wide go-to-def (import resolution + declaration search; real LSP in 1.6). DEFERRED: terminal ⌘K (stretch) → with 1.6
- ✅ 1.4 Git — core shipped 2026-06-13: structured status plumbing · live gutter markers (HEAD vs buffer on the P2b Myers engine) · tree status colors+letters · Changes panel = real source control (stage/unstage/discard/commit/push + AI commit messages via claude_oneshot) · status-bar branch switcher with checkout menu. DEFERRED (explicit): inline blame → rides with 1.5
- ✅ 1.5 Checkpoints + review + blame — shipped 2026-06-13: migration 0019 pre-image checkpoints per agent burst (close on turn end / 90s silence, prune 20), one-click restore that snapshots current state first ("before restore"), Checkpoints section in Changes panel; inline blame on the cursor line (1.4's deferred item). NOTE: "consolidated turn review" = Changes panel (all files, bulk actions) + per-file hunk tabs; a single scrolling multi-file diff doc stays a possible polish item
- ✅ 1.6 Real LSP — COMPLETE 2026-06-13: (1.6a) Rust stdio pipe + JSON-RPC client + manager (probe/launch ts-language-server/pyright/rust-analyzer per root, initialize, auto doc-sync, semantic diagnostics→Problems, hover, LSP-first ⌘F12, browser-TS muted when live, project-switch teardown, status-bar ⚙ indicator). (1.6b) cross-file workspace-edit applier (open via Monaco+save / closed via disk splice; workspace/applyEdit round-trip) · completion · signature help · rename (F2, cross-file) · code actions/quick-fixes (lightbulb) · organize imports · find-all-references (⇧F12) + editor-opener routing peek/jump into our tabs. Graceful no-server degradation throughout. **User must install servers**: `npm i -g typescript-language-server typescript pyright`, `rustup component add rust-analyzer`.

**🎉 PHASE 1 — Orion ≥ Cursor — COMPLETE (2026-06-13).** All six items shipped: AI editing core (P2b-e), Tab autocomplete, navigation/feel, git, checkpoints+blame, real LSP. Next: **Phase 2 — Archives ≥ Notion** (needs research + ranked plan + user approval before building).
- CUT from Phase 1 (explicit): cloud agents/Slack control, in-editor browser + Design Mode, separate Plan Mode, Bugbot-style PR review, voice agent control, RL autocomplete tuning.

**Phase 2 — Archives ≥ Notion** ✅ COMPLETE 2026-06-13 — ranked plan APPROVED 2026-06-13 (research: [docs/research/notion-2026.md](docs/research/notion-2026.md)). Thesis: Notion's top complaints (capture latency, half-baked offline, weak+paywalled "ask-your-notes" AI, lossy export) are our structural moats (local SQLite, offline-default, embeddings already built). Win lane = "Notion's structure + Apple Notes capture speed + Obsidian local trust." Archives AI = subscription CLI (claude_oneshot, no per-token cost).
- ✅ 2.1 Capture & ritual — shipped 2026-06-13: quick-capture overlay ⌘⇧N → auto-created Inbox collection (↵/⌘↵/⇧↵) · daily-note ⌘⇧D (date-keyed find-or-create journal entry) · 4 note templates (⌘K "New from Template…") with {{date}}/{{weekday}}/{{time}}/etc. expansion. Capture-speed moat = Notion's #1 weakness.
- ✅ 2.2 AI-native Archives — shipped 2026-06-13: note auto-tagging (settle-triggered, zero-tag-only) · "Ask your Archive" RAG ⌘⇧A (hybrid-search retrieval → cited answer, clickable citations jump to source) · inline editor AI (toolbar ✨AI: improve/fix/shorter/longer/summarize on selection; /continue-writing + /summarize-note slash items). All subscription CLI (no per-token cost). Beats Notion's weakest+paywalled Q&A; matches its inline AI.
- ✅ 2.3 Database views — COMPLETE 2026-06-13: 2.3a data model (migration 0020) · 2.3b table view (editable typed cells, 8 property types) · 2.3c board (drag-grouped by select/status) / gallery / calendar (date-placed, month nav) views + add-view menu · 2.3d filters (chips) + sorts across all views. A collection IS a Notion-class database. ~20 tests across the slices.
- ✅ 2.4 Linking & graph — shipped 2026-06-13: `[[`wikilink autocomplete (BlockNote `[` SuggestionMenuController → inserts orion://note link) · backlinks panel on every note editor (Links-to-this-page + Unlinked-mentions, live from in-memory notes) · `setNoteNavigator` routes orion://note clicks within Archives by kind (fixes the audit's unreachable-in-app gap). noteLinks helpers (extractNoteLinks/computeBacklinks) 6 tests.
- ✅ 2.5 Editor power — shipped 2026-06-13: callout custom block (createReactBlockSpec, 5 colors, schema additive) · toggles + highlighted code blocks (ALREADY in default BlockNote schema — just surfaced) · PDF export (print-to-PDF via hidden iframe + blocksToFullHTML, no dep). CUT from 2.5: columns (needs @blocknote/xl-multi-column dep — deferrable) · better md-paste (default is adequate).
- CUT (explicit): formulas/rollups/relations depth · timeline/chart/feed/map/form views · synced blocks · web clipper / cross-app AI connectors · multiplayer.

**🎉 PHASE 2 — Archives ≥ Notion — COMPLETE (2026-06-13).** 2.1 capture/ritual · 2.2 AI-native · 2.3 databases · 2.4 linking · 2.5 editor power. Next: **Phase 3 — XDesign ≥ Figma** (needs research + ranked plan + user approval).

**Phase 3 — XDesign ≥ Figma** 🔨 — ranked plan APPROVED 2026-06-13 (research: [docs/research/figma-2026.md](docs/research/figma-2026.md)). Thesis: design→code is THE wedge — Figma's own MCP docs admit their code output is "not production-ready" (emulates CSS, absolute-positioned inline-style React, external agent that doesn't know your repo). XDesign wins: real React + Orion's own tokens as a reviewable staged edit into the repo next door, local-first, AI edits Accept/Reject-reversible. Multiplayer explicitly NOT contested. Export styling = inline styles + CSS-var tokens (locked).
- 🔨 3.1 Design→code (the wedge): ✅ generator (designToReact.ts, frame-tree→.tsx, auto-layout→flex, token mapping, 8 tests) + ✅ export→staged edit (reuses Phase-1 pendingEdits+DiffReview; Inspector "React" btn + command). ⬜ DEFERRED 3.1c screenshot→editable-layers (own slice — vision prompt + model-quality-dependent).
- ✅ 3.2 Canvas feel — shipped 2026-06-13: progressive selection (plain click → top-level frame; click-again drills; ⌘/double-click → exact leaf) · ⌘A select-all · editable multi-select inspector (batch move/fill/opacity) · viewport culling >120 nodes (intersect visible rect + 1-screen margin, selected always render). DEFERRED: alt-hover measurement (own slice — needs proper shape hit-testing).
- ✅ 3.3 Vector depth — COMPLETE: **3.3a boolean ops** (union/subtract/intersect/exclude via `polygon-clipping`; pure `booleanOps.ts`; PathShape gains additive `subpaths?`+`fillRule?` for holes; `store.booleanOp`; Inspector multi-select Boolean row) `3d68d58` · **3.3b post-hoc path/anchor editing** (double-click a path → anchor-edit mode; drag anchors w/ handles riding along + drag bezier control points; `worldToUnit` inverse correct under rotation/flip; magenta overlay; one undo step/drag) `3943df6`. Known v1 limits: anchor editing = primary contour only (boolean-result holes not draggable yet); bbox doesn't reflow mid-edit.
- ✅ 3.4 Layout systems — COMPLETE 2026-06-14: **constraints** (pure `applyConstraints` left/right/left-right/center/scale per axis + recursive `reflowConstraints` wired into frame resize, Inspector pin-box + H/V dropdowns) `5793fc4`/`24ba600` · **non-lossy overrides** (`linkedNodeId`+`overrides` on root, pure `overrides.ts` capture/apply, override-preserving `recloneInstance`, Inspector "Reset overrides") `1148d22`/`d9b0b45` · **variants** (`isVariantSet`/`variantProps`/`variantSelection`, pure `variants.ts` resolve, `setVariantSelection` swap, Inspector variant-set toggle + props editor + per-prop dropdown) `8bee045`/`c444209`. Known v1 limits: capture fires on `updateShape` only (canvas drag / `patchMany` don't record overrides); overrides don't carry across a variant swap (keyed by member node ids).
- ✅ 3.5 Prototyping lite — COMPLETE 2026-06-14: **hotspot links** (`prototype` link on any shape → navigate to a screen / back, Inspector "Prototype" section) · **present mode** (full-cover overlay rendering the active top-level frame via `buildExportSVG` fitted to the stage + transparent clickable hotspots; Play button + `xdesign.present` command; Esc/← nav) · **transitions** (instant/dissolve/slide on an inner wrapper so they compose with the fit scale; reduced-motion guard). Pure `prototype.ts` (11 tests) + `presentStore`. Commits `3fa92ac`/`fb6e5aa`/`f060f38`/`003527f`.
- CUT (explicit): vector networks · Figma Draw brush/illustration · multiplayer · variable scoping depth · WebGL renderer rewrite (cull instead) · Code-Connect mapping.

**🎉 PHASE 3 — XDesign ≥ Figma — COMPLETE (2026-06-14).** 3.1 design→code · 3.2 canvas feel · 3.3 vector depth · 3.4 layout systems · 3.5 prototyping lite. (Deferred within phase: 3.1c screenshot→layers · 3.2 alt-hover measurement — both noted as own-slice follow-ups.) Next: **Phase 4 — One terminal, one brain**.

**Phase 4 — One terminal, one brain** 🔨 — no kickoff brief existed; audit (2026-06-14) found the cross-app *plumbing* already largely built (ROSIE MCP reach across all 4 apps + terminal + activity_log; `activity_log` shared memory; `toastStore` history ring tagged "Phase 4"). So Phase 4 = cohesion + surfacing. User approved direction ("what do u suggest" → notification center first, then memory, then ROSIE; cohesion last + user-driven).
- ✅ 4.1 Notification center — menubar Bell + unread badge + dropdown panel over the toastStore history ring (every app's toasts in one place); pure `unreadCount` + `lastReadAt`/`markAllRead` (3 tests). `37f8f0c`
- ✅ 4.2 Unified cross-app memory — `activity_log` surfaced as a "Recent" section in Spotlight (⌘K), shown by default + fuzzy-searchable; click jumps back (Orion edits reopen the file, others surface the app). `82e4e92`
- ✅ 4.3 ROSIE awareness — "Catch me up on my day" chip in ROSIE's empty state → on-demand cross-app summary via her existing `orion_recent_activity` tool (respects the locked no-always-inject decision; zero per-turn cost). `567fc48`
- ⬜ 4.6 Cohesion pass (per-surface typography/spacing/radii normalization) — DEFERRED, needs **user-driven visual verification** (agent can't run Tauri; tracker flags it as "regression roulette" done blind). Best done surface-by-surface with the user watching.

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

### 2026-06-18 — Provider-agnostic agent runtime — Phase 2c (subscription CLI engines) — BUILT (Codex CLI + Gemini CLI as subprocess engines)
- **Shipped the full 15-task Phase-2c plan** ([docs/superpowers/plans/2026-06-18-agent-runtime-2c.md](docs/superpowers/plans/2026-06-18-agent-runtime-2c.md), spec [docs/superpowers/specs/2026-06-18-agent-runtime-2c-design.md](docs/superpowers/specs/2026-06-18-agent-runtime-2c-design.md)) via **inline executing-plans** (not subagent-driven, per user). Adds **OpenAI Codex CLI** + **Google Gemini CLI** as **subscription-aware subprocess engines** — the Claude-CLI pattern, NOT the 2a/2b HTTP runtime. A logged-in ChatGPT/Google user now gets the same no-API-key chat + tools as Claude users, via the existing `claude:event`/`claude:exit` contract and the same `orion --mcp-serve` MCP server (tools "for free", same TCP-bridge → DiffReview path Claude uses). Branch **`feat/control-panel-agent-forge`** (continues 2a/2b).
- **Task 0 capability spike (interactive, recorded):** [docs/superpowers/specs/2026-06-18-agent-runtime-2c-spike-findings.md](docs/superpowers/specs/2026-06-18-agent-runtime-2c-spike-findings.md). Installed `codex 0.141.0` + `gemini 0.47.0` and confirmed ON THE MACHINE: **Codex** `codex exec --json -m <m> -a never -s workspace-write --skip-git-repo-check -C <cwd>` (prompt on stdin; JSONL on stdout, stderr noise ignored), events `thread.started{thread_id}`/`turn.started`/`item.completed{item}`/`turn.completed{usage}`, isolated via `CODEX_HOME` (**relocates auth.json → must bridge the user's `~/.codex/auth.json` in**), auth probe `codex login status` (exit 1 = not logged in), config `[mcp_servers.orion]`; **Gemini** `gemini -p <prompt> -o stream-json -m <m> --skip-trust --approval-mode yolo` (**`--skip-trust` mandatory or MCP servers stay disabled in an untrusted folder** — verified live), isolated NON-invasively via `GEMINI_CLI_SYSTEM_SETTINGS_PATH` (leave `GEMINI_DIR` default so login is found), settings `mcpServers.orion{trust:true}` + `excludeTools:["write_file","replace","edit"]`, persona via `GEMINI_SYSTEM_MD`, auth = `~/.gemini/oauth_creds.json` presence. Codex/Gemini MCP config schemas were **derived live** (ran each CLI's `mcp add` into an isolated home and read the result). Success-path output-line shapes are **doc-grounded** (Codex from the codex repo `exec_events.rs`/SDK `items.ts`; Gemini event types `init/message/tool_use/tool_result/error/result` from `headless.md`) — **[P-AUTH]** marked for validation against the user's first logged-in run (the user has **no subscription yet**, so live success-path fixtures could not be captured).
- **Rust `src-tauri/src/cli_engine/`** (TDD, +20 cargo tests): `config.rs` (pure `codex_mcp_config` TOML + `gemini_mcp_config` JSON writers over a shared `OrionServer`) · `transcode.rs` (pure `codex_line_to_events`/`gemini_line_to_events` → the exact `assistant`/`tool_use`/`tool_result`/`system:init`/`result` shapes EventBridge reads; cost 0 → UI shows "subscription"; thread/init id → `session_id`) · `codex.rs`/`gemini.rs` (pure arg-builders + side-effectful `prepare` writing the isolated config + auth bridge / system-settings + persona md) · `mod.rs` (`CliEngine` enum, `SpawnSpec`, `cli_status`, and the shared `cli_send`/`cli_cancel` spawn+stream loop mirroring `claude_cli` verbatim — `Notify` cancel map, transcode-per-line, `claude:exit` on close). `mcp_config::orion_server` accessor added (decomposes the same server `write()` emits). All **additive** — no existing Rust signature changed; registered in lib.rs.
- **Frontend seam:** `ProviderKind` gains `codex_cli`/`gemini_cli`; two **built-in providers** seeded at runtime (no migration) in `seedData.ts` + `providersStore.load()` (idempotent) → their models appear in `ModelSelect`/Agent-Forge like Claude's. `dispatchSend.routeFor` gains a third outcome `{engine}` → `ipc.cliSend(engine, …)`; `dispatchCancel` → `ipc.cliCancel`. **Non-regression headline (test-enforced):** the routing test asserts a Claude selection still calls `claudeSend` **byte-identical** and never `cliSend`/`runtimeSend`, an OpenAI key model still routes to `runtimeSend`, and the two new kinds route to `cliSend` and never to `claudeSend`/`runtimeSend`. Control Panel Providers shows each CLI engine's live **installed / login-needed / ready** status (lucide icons, glass `cp-badge`, no emoji) with a Re-check button + exact install/login copy.
- **§6 edit-review:** Gemini → **parity target** (`excludeTools` routes writes to `orion_apply_edit` → Accept/Reject DiffReview); Codex → **fallback** (no `--disallowed-tools`; edits hit the working tree → Changes panel) — Control Panel copy states the truth per engine. Both to be confirmed at login.
- **Gates all green:** tsc clean · **vitest 489** (+7) · **cargo test 91** (lib; +20 cli_engine) · cargo check clean (1 pre-existing `pick_thumbnail` warning) · `npm run build` exit 0.
- ⚠️ **Needs a `tauri dev` restart** (new `cli_engine` module + `cli_send`/`cli_cancel`/`cli_status` commands). **UI + live CLI behavior human-unverified** (agent can't run Tauri or drive the external CLIs). **Smoke checklist (spec §10 / plan Task 15):** restart → Control Panel shows both engines (install/login hints) → `codex login` + `gemini` Login-with-Google → re-check shows "ready" → **[P-AUTH] capture one real `--json`/`stream-json` run and diff against the transcoder fixtures (Tasks 8/9), patch + re-run `cargo test` if fields differ** → select a Codex/Gemini model in any rail → streams + Orion tools take effect → editing turn lands in DiffReview (Gemini) / Changes panel (Codex) → Claude selection byte-identical → cancel halts.
- **Deferrals (spec §11):** per-tool grant filtering for CLI engines (full MCP toolset for now); cost accounting where the CLI reports none; Codex/Gemini in Hermes swarms + Learn/RepoLens one-shots; Phase 3 Brain→Action routing.

### 2026-06-16 — Provider-agnostic agent runtime — Phase 2a (runtime core) — BUILT (OpenAI + Gemini streaming, claude:event parity, dispatchSend routing)
- **Shipped the full 15-task Phase-2a plan** ([docs/superpowers/plans/2026-06-16-agent-runtime-2a.md](docs/superpowers/plans/2026-06-16-agent-runtime-2a.md), spec [docs/superpowers/specs/2026-06-16-agent-runtime-2a-design.md](docs/superpowers/specs/2026-06-16-agent-runtime-2a-design.md)) via subagent-driven-development on branch **`feat/control-panel-agent-forge`** (continues Phase 1). A **Rust streaming chat runtime** (OpenAI-compatible `/v1/chat/completions` + Gemini `streamGenerateContent`) that emits the **exact same `claude:event`/`claude:exit` stream the Claude CLI emits**, so non-Claude models stream replies on every chat rail (Orion/Archives/XDesign/ROSIE) with **zero EventBridge/chatStore changes**. **Conversational replies only — no tools in 2a** (tools + edit-review parity = 2b; Brain→Action routing = Phase 3).
- **Rust `src-tauri/src/runtime/`** (TDD, 21 unit tests): `provider.rs` (`Provider` trait + `Msg`/`ChatRequest`/`StreamItem` + `make_provider`: "google"→Gemini, else→OpenAI-compat) · `openai.rs` (endpoint w/ default base, **auth header omitted when key empty** for keyless Ollama/LM Studio, `stream_options.include_usage`, `parse_sse_line`) · `gemini.rs` (`x-goog-api-key`, `assistant`→`model` role map, `system_instruction`, parse handles text+`usageMetadata` on one line) · `pricing.rs` (rough per-MTok cost by kind+model) · `mod.rs` (`runtime_send`/`runtime_cancel` commands, `reqwest` `bytes_stream` loop mirroring `messages_chat.rs`, `Notify`-keyed cancel map, `take_lines` partial-line buffering, **accumulates** text per delta → emits assistant snapshot → `result {total_cost_usd, session_id:null}` → `exit`). **`parse_sse_line` returns `Vec<StreamItem>`** (one Gemini line can carry text+usage). Registered in lib.rs — **purely additive, no existing Rust signature changed.**
- **Frontend seam** `src/features/agents/dispatchSend.ts` (9 tests): `routeFor(providers, model)` → owning provider; Anthropic-builtin or unknown → `ipc.claudeSend` (**byte-identical to Phase 1**), else → `ipc.runtimeSend(chatId, kind, baseUrl, keyRef, model, system, history)`. `toRuntimeHistory` flattens all three store shapes (chatStore blocks / appChat string / rosie string|blocks), drops pending/empty. `dispatchCancel` routes cancel to the owning engine. **Non-Claude is stateless** — full history passed each turn, no session_id. Keys stay in Rust (`provider_keys::read`).
- **Wired all four rails** (Orion/Archives/XDesign/ROSIE) from `claudeSend`→`dispatchSend` and cancels→`dispatchCancel` (ROSIE had two cancel sites — user + watchdog — both converted). `ModelSelect` now lists **enabled** non-builtin provider models as selectable (was disabled "needs runtime"); Control Panel badge → **"chat ready · no tools yet"**.
- **Non-regression headline (verified by test):** `dispatchSend.routing.test.ts` asserts a Claude selection calls `claudeSend` with **byte-identical args** (`chatId, prompt, projectRoot, sessionId, imagePath, model, systemAppend, allowedTools`) and never `runtimeSend`; a provider model calls `runtimeSend` and never `claudeSend`. Final adversarial review: **ship** — no Critical/Important issues (event contract exact, key stays in Rust, no leaked/stuck STREAMS state on any exit path, UTF-8-safe line buffering).
- **Known 2a limits (documented):** non-Claude = chat only (no tools); runtime path ignores `imagePath` (XDesign snapshot won't reach a non-Claude model — vision is 2b+); Archives/XDesign/ROSIE bake their app-behavior system prompt into the first user turn (reaches Claude, not the stateless runtime — only the agent persona `systemAppend` is the runtime `system`); Orion @-context injection is Claude-only.
- **Gates all green:** tsc clean · **vitest 467** (+9) · **cargo test 43** (lib; +21 runtime) · cargo check clean (1 pre-existing `pick_thumbnail` warning) · `npm run build` exit 0.
- ⚠️ **Needs a `tauri dev` restart** (new Rust `runtime` module + `runtime_send`/`runtime_cancel` commands) before smoke-testing. **UI is human-unverified** (agent can't run Tauri). **Manual smoke checklist:** (1) Control Panel → Providers → add OpenAI (real key) → its models now appear **enabled** in any rail's dropdown → select one → send → reply streams token-by-token. (2) Add an OpenAI-compatible provider at `http://localhost:11434/v1` (Ollama) with **no key** → streams keyless. (3) Add a Google provider + Gemini key → select a Gemini model → reply streams. (4) Forge an agent with a non-Claude brain → persona/instructions apply; "no tools yet" copy shows. (5) Select any **Claude** model/agent → byte-identical to Phase 1 (tools, edit Accept/Reject, sessions intact). (6) Cancel a streaming non-Claude turn → halts.
- **Next: Phase 2b** (own spec) — MCP in-process tool-dispatch refactor + function-calling for non-Claude + tool execution + edit-review Accept/Reject parity (the "no tools yet" marker goes away). Then **Phase 3** — literal Brain→Action routing.

### 2026-06-16 — Control Panel + Agent Forge (Phase 1) — BUILT (provider registry · skill library · game-inventory agent forge)
- **Shipped the full 18-task Phase-1 plan** ([docs/superpowers/plans/2026-06-16-control-panel-agent-forge.md](docs/superpowers/plans/2026-06-16-control-panel-agent-forge.md), spec [docs/superpowers/specs/2026-06-16-control-panel-agent-forge-design.md](docs/superpowers/specs/2026-06-16-control-panel-agent-forge-design.md)) via subagent-driven-development (fresh implementer + spec & quality review per task). On branch **`feat/control-panel-agent-forge`**. New dedicated **Control Panel** surface (full-surface modal, ⌘, / dock `SlidersHorizontal` tile / app-menu / Spotlight "Open Control Panel") hosting a **Provider Registry**, a **Skill Library**, and a game-inventory **Agent Forge** — and the existing Settings sections fold in (API Keys/Appearance/Wallpaper/MCP/Shortcuts/About). Saved agents become selectable in **every** model dropdown (`ModelSelect`) under a "Your Agents" group; selecting one runs Claude on the agent's **brain** model with its skills' instructions (`--append-system-prompt`) + tools (`--allowed-tools`). **All Claude-backed; non-regression is the headline guarantee** — a plain Claude selection produces byte-identical CLI args.
- **Pure-logic core `src/features/agents/`** (TDD): `agentTypes.ts` (fail-soft `parseProvider`/`parseSkill`/`parseAgent`, 6 tests) · `agentValue.ts` (tagged dropdown codec — plain model id vs `agent:<id>`, 4) · `toolCatalog.ts` (builtin tools + MCP-server grants, 3) · `composeAgent.ts` (agent+skills → `{model, appendSystemPrompt, allowedTools}`, 4) · `seedData.ts` (builtin Anthropic provider from `MODELS` + 6 starter skills, 2) · `resolveSend.ts` (send-site resolver: plain model → `{model, null, null}`; agent → expanded; missing agent → raw value, 3). DB: `agentsDb.ts` (providers/skills/agents CRUD). Stores: `providersStore`/`skillsStore`/`agentsStore` (idempotent seed-on-empty + boot hydrate in App.tsx). ~24 new frontend tests + 2 Rust.
- **Backend (Rust):** **migration 0026** (`providers`/`skills`/`agents` tables, append-only) · `provider_keys.rs` (keychain CRUD for per-provider API keys, `provider:<ref>` accounts) · `claude_send` gained OPTIONAL `system_append` + `allowed_tools` via a pure `agent_args` helper inserted AFTER the untouched `--disallowed-tools` block (2 unit tests prove `agent_args(None,None)` is empty → byte-identical). ipc wrappers added (`providerKeySet/Clear/Status`, `claudeSend` +2 optional params).
- **UI** `src/features/controlpanel/`: `ControlPanel.tsx` (violet rail + body) · `ProvidersPanel` (list + add-provider form, key → keychain, non-builtin badged "needs runtime") · `SkillLibraryPanel` + `SkillEditor` (grid; built-ins duplicate-to-customize; instructions + tool-grant checkboxes over builtins + enabled MCP) · `AgentForge` (Equipment column [Brain/Action selects] · center character [portrait picker via `convertFileSrc`, name/role/accent, equipped-skill chips] · Skill Inventory grid · Forge/Edit/Delete). `ModelSelect` rewritten as a grouped `<optgroup>` picker (builtin models selectable; non-builtin disabled; agents under "Your Agents").
- **Send sites wired** (resolve `agent:<id>` → CLI params): Orion rail, XDesign rail, ROSIE (`rosieStore`), Archives rail. **Learn's `TutorPanel` left as-is** (uses `ipc.claudeSend` but agent-expansion there is a deferred Phase-1 follow-on — selecting an agent on the Learn surface won't expand in v1).
- **Phases 2 & 3 deferred to their own future specs:** the provider-agnostic runtime (actually calling OpenAI/Google/etc. — Phase 1 ships the framework only, Claude is the one live provider; non-builtin provider models show disabled) and literal Brain→Action two-model routing (the Action model is stored + shown but Phase 1 runs on Brain only).
- ⚠️ **Branch-hygiene incident (fixed):** an early implementer subagent ran `git checkout`, so the first 12 task commits landed on `feat/archives-learn-section`. Recovered by cherry-picking the clean 12-commit chain onto `feat/control-panel-agent-forge` (conflict-free — touched files were identical at both tips) and resetting `feat/archives-learn-section` back to its pristine session-start HEAD `ae0c537`. All later subagents were given an explicit "no branch-changing git commands" guard. (Recoverable: the polluted tip was `effe4e4` if ever needed.)
- **Gates all green:** tsc clean · **vitest 458** · **cargo test 22** (incl. both `agent_args` non-regression tests) · cargo check clean (1 pre-existing unrelated `pick_thumbnail` warning) · `npm run build` exit 0.
- ⚠️ **Needs a `tauri dev` restart** (migration 0026 + new `provider_keys` commands + `claude_send` signature change) before smoke-testing. **UI is human-unverified** (agent can't run Tauri). **Manual smoke checklist:**
  1. Restart `tauri dev`. Open the Control Panel (⌘, / dock sliders tile / app-menu "Control Panel…" / Spotlight "Open Control Panel"). All prior Settings sections (API Keys/Appearance/Wallpaper/MCP/Shortcuts/About) present and working.
  2. Providers → Add provider (e.g. OpenAI, a fake key) → appears badged "needs runtime"; its models show greyed/disabled in any `ModelSelect`.
  3. Skill Library → 6 seeded skills present → New skill (instructions + a couple tool grants) → Save → appears; click a built-in → opens a customizable copy.
  4. Agent Forge → pick a portrait, name it, choose a Brain model, equip 1–2 skills → ⚒ Forge Agent → appears under "Your Agents". (Portrait note: renders only if the picked path is within the Tauri asset-protocol scope; otherwise the `＋ image` fallback shows — known Phase-1 limitation.)
  5. Open any chat rail (Orion/Archives/XDesign/ROSIE) → model dropdown shows "Your Agents" → select the agent → send → it runs on the brain model with the skill instructions + tools in effect.
  6. Select a plain Claude model → behaves exactly as before (non-regression).

### 2026-06-16 — Learn upgrade — DESIGN + PLAN ONLY (topic-shaped constellations + achievements/badges)
- **Brainstorm → spec → 13-task plan complete; NO app code written yet.** Two upgrades to Archives **Learn**: (1) **topic-shaped constellations** — the force graph forms a silhouette of the subject (Linux → penguin) via a shared AI-generated **"topic figure"**; (2) **achievements & badges** — mastering a node turns it **gold + shimmers** + a node achievement, mastering every node awards a **mil-spec topic mastery badge** (digital-ghost/military wireframe-grain aesthetic, user-approved via visual companion). The figure is the shared spine: drives both the constellation shape AND the badge's centered wireframe glyph. Constellation approach = **shape-biased physics** (anchor-pull, not literal-pin), fail-soft to today's physics.
- **Spec:** [docs/superpowers/specs/2026-06-16-learn-constellation-shapes-achievements-design.md](docs/superpowers/specs/2026-06-16-learn-constellation-shapes-achievements-design.md) · **Plan:** [docs/superpowers/plans/2026-06-16-learn-constellation-shapes-achievements.md](docs/superpowers/plans/2026-06-16-learn-constellation-shapes-achievements.md) (Tasks 1–7 pure-logic TDD w/ full code; 8–13 UI ending at smoke-test gates).
- **Architecture:** migration **0025** (additive: `learn_topics.figure_json` + `learn_achievements` table); pure TDD modules `figure.ts` (parse + `assignAnchors`) / `achievements.ts` (idempotent detection — decay→re-master never re-awards) / `forceLayout` anchor-pull; **no new Rust/IPC** (figure gen reuses `learn_claude_call`); new components `MasteryBadge`/`MasteryCelebration`/`TrophyShelf` + rail medallion. Only migration 0025 needs a `tauri dev` restart.
- **For the build session:** on branch `feat/archives-learn-section` (0025 is the next number — don't edit 0024; user DB has 0024 applied). Use subagent-driven-development. Approved badge SVG mock at `.superpowers/brainstorm/*/content/badge-final.html`. Scope cuts (v1): only the 2 achievement types, no AI-drawn glyphs (reuse figure outline), no figure re-roll, order-based anchor zip.

### 2026-06-15 — Archives "Learn" section — BUILT (AI tutor + constellation + BKT mastery engine)
- **Shipped the full 15-task plan** ([docs/superpowers/plans/2026-06-15-archives-learn-section.md](docs/superpowers/plans/2026-06-15-archives-learn-section.md)) via subagent-driven-development (fresh implementer + two-stage review per task). New Archives section **Learn** (violet accent): name a topic → AI generates a prerequisite graph (basics→pro) → **Obsidian-style force-directed constellation** (hand-rolled SVG physics, no graph dep) → click a node → on-demand cached **lesson page (spine) + scoped Socratic tutor (right panel)** → recall checks → LLM grades → **code-owned BKT mastery** updates `p_mastery` → gating unlocks dependents → forgetting-decay resurfaces "ready to review" nodes. On branch **`feat/archives-learn-section`** (cut off the design-md HEAD, NOT main, so migration **0024** is correctly the next number — local main only had 0021; the user's DB already has 0022/0023 applied; basing off main would have collided). The unrelated in-flight XDesign working-tree edits were **stashed** (`stash@{0}`), not swept in.
- **Module `src/apps/archives/learn/`** (mirrors `repolens/`): pure TDD logic — `learnTypes.ts` (fail-soft `parseGraphSpec`/`parseLesson`, 5 tests) · `bkt.ts` (Bayesian Knowledge Tracing update, 4) · `gating.ts` (`recomputeStatuses` unlock + `effectiveMastery`/`needsReview` decay, 6) · `forceLayout.ts` (charge/spring/center physics step, 4) · `claude.ts` (serialized 1.2s-gap queue → graph/lesson/grade/find-links, 2) · `useLearn.ts` (store: create→graph→gate, answer→BKT→gate, 2). UI — `LearnView` (topic rail + router) · `Constellation.tsx` (rAF loop w/ settle-stop + `document.hidden` pause + reduced-motion static-settle; drag/zoom/pan; node states scale w/ mastery; review pulse) · `LessonView.tsx` (objective banner + segmented progress + chunk-by-chunk reveal + worked example w/ per-step why + key-term chips + suggested resources + **"Find real links"** web-search button + answer-first recall grading w/ mastery delta; markdown via the existing react-markdown/remark-gfm/rehype-highlight) · `TutorPanel.tsx` (scoped streaming Socratic tutor over the lower-level `claudeSend`+`claude:event` primitive — first-turn system prompt + `sessionId` resume; Hint/Explain-back/Simpler/Deeper quick actions; `ModelSelect surface="learn"`).
- **Pedagogy engine** (`pedagogy.ts`, `PEDAGOGY_VERSION = "1.0.0"`): versioned master-teacher prompt builders, **GitHub/community-surveyed first** (backward design / Knowledge Space Theory / Bloom / Mager ABCD / cognitive-load chunking / dual coding / worked-example effect / retrieval practice / Dweck process-praise / Feynman / gradual release — ideas adapted, no verbatim text, license notes in the file header). Each generation prompt ends with a strict JSON-shape contract matching the parsers; the tutor prompt enforces the Socratic contract (one question first, escalating hints, withhold answer until attempts/explicit ask).
- **Rust** `learn.rs` `learn_claude_call` (mirror of `repolens_claude_call`: stdin-piped prompt, 180s, envelope parse; `allow_web` swaps `--strict-mcp-config` → `--allowedTools WebSearch`) + ipc wrapper + **migration 0024** (`learn_topics`/`learn_nodes`/`learn_edges`/`learn_reviews`, append-only — no prior migration touched). `useModelPrefs` gained a `"learn"` surface (2-line additive).
- **Holistic review** (Task 15) found no blockers; applied the fixes (`df49e29`): closed a concurrent-recall-submit race in `submitAnswer` (synchronous in-memory read-modify-write, DB persist moved after `set`), dropped dead casts in `claude.ts`, surfaced `findLinks`/`claudeCancel` errors. **Deferred (minor):** reduced-motion constellation seeds against initial `dims`.
- **Gates all green:** tsc clean · **vitest 416 (+23 learn)** · cargo check clean (1 pre-existing unrelated warning) · `npm run build` exit 0.
- ⚠️ **Needs a `tauri dev` restart** (migration 0024 + the new Rust `learn_claude_call`) before smoke-testing. **UI is human-unverified** (agent can't run Tauri) — Tasks 11–14 end at user smoke-test gates (batched). **v2 deferrals:** flashcard deck, mixed-practice, skillometer dashboard, cross-topic linking, export-to-note, screenshot→layers.

_Older session-log entries (2026-06-15 and earlier) are archived in [CLAUDE_LOG_ARCHIVE.md](CLAUDE_LOG_ARCHIVE.md) — kept out of this file so every Hermes agent and Claude Code session loads a much smaller project context._
