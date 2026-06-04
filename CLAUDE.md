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

### 2026-06-03 — Archives 47 desktop: right-click context menus + working toolbar (Share/Star/More/New) + Favorites
- **Reusable context-menu system** (`src/components/ContextMenu.tsx`): `useContextMenu()` → `{ openAt(e, items), openFromButton(el, items), menu }`. Portal to `<body>`, viewport clamp + flip, closes on outside-mousedown(capture)/Esc/scroll/blur/resize. `MenuItem` = item (label/icon/onClick/danger/disabled/checked) | separator. Doubles as a button-anchored dropdown. CSS `.ot-ctx-*` in tokens.css.
- **Right-click everywhere** via centralized builders (`src/apps/archives/itemMenus.tsx`): `noteMenuItems` (Open/Rename/Favorite/Export-MD/Delete; `onDelete` override so Projects cascade-delete its subtree, `extra` for "New subpage"), `assetMenuItems` (Preview/Favorite/Add-to-board/Copy-path/Delete), `boardMenuItems` (Open/Rename/Favorite/Delete). Wired into Notes grid, Journal rail, Projects tree, Media tiles, Mood list cards, and Chats rows (Chats inline: Open/Rename/Delete via new `renameChat`/`deleteChat` db helpers).
- **Favorites** — migration **0014** adds `favorite INTEGER NOT NULL DEFAULT 0` to notes/assets/mood_boards (+ indexes; insert helpers now take `Omit<Row,"favorite">` so the DEFAULT applies). `favorite: boolean` threaded through all three stores + `toggleFavorite(id, force?)` + `setNoteFavorite`/`setAssetFavorite`/`setMoodBoardFavorite`. Star badges render on favorited cards/rows; new **Favorites** sidebar view (`Favorites.tsx`) aggregates starred notes/pages + boards + media and routes into each on click.
- **Toolbar wired** (`src/apps/archives/Toolbar.tsx`, replaces the 4 dead buttons): **★** toggles favorite on the view's *active* item (open note/entry/project/board; disabled + tooltip on grids), filled gold when on. **+** = per-view create (note/entry/project/board-via-prompt/import-media-via-open-dialog). **Share** = dropdown (Export open note as Markdown · Export Archives JSON backup · Import notes…). **⋯ More** = contextual (Rename/Favorite/Delete the active item) + Show favorites + Refresh.
- **New primitives:** `PromptModal` (imperative `promptText({...})`, mounted once in Shell) for renames/new-board; `exportImport.ts` (blocks→Markdown serializer, `save`/`open` dialogs via `saveFileAtomic`/`readFile`). Added `dialog:allow-save` to capabilities.
- ⚠️ **Requires a full `tauri dev` restart** (new migration + capability change — Rust rebuild, not just frontend hot-reload). UI human-unverified (agent can't run Tauri). tsc / vite build / **91 tests** / cargo check all green. Note: the iOS companion helper reads orion.db; the new `favorite` column is additive and ignored by its reads/write-back (no Swift change needed).

### 2026-06-02 — Archives companion: iOS app icon + TestFlight prep
- iOS AppIcon from repo-root `app-icon.png` (red Orion sphere): `magick … -resize 1024x1024 -background "#03060a" -flatten -alpha off` → **opaque** 1024² (iOS rejects alpha), in `ArchivesiOS/Assets.xcassets/AppIcon.appiconset` (single-size; Xcode generates the rest). `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon` set; verified the icon PNGs bake into the built `.app`.
- Added `ITSAppUsesNonExemptEncryption: false` to the iOS Info.plist (Multipeer = standard encryption) to skip the per-upload export-compliance prompt. **Distribution decision: TestFlight (internal) only** — it's personal infra, inert without the user's Mac; the public App Store would likely be rejected (reviewers can't reproduce the paired setup). User has a dev account; still must set `DEVELOPMENT_TEAM` in project.yml (persists across `xcodegen generate`, unlike setting it in Xcode). App Store Connect listing name must be globally unique (e.g. "Orion Archives"); home-screen name stays "Archives".
- First upload failed validation: universal app (device family "1,2") needs `UISupportedInterfaceOrientations` declared. Fixed in project.yml info.properties: iPhone = Portrait; `UISupportedInterfaceOrientations~ipad` = all four (iPad multitasking requirement). Also set `CFBundleShortVersionString`/`CFBundleVersion` explicitly in the plist (xcodegen's `CURRENT_PROJECT_VERSION` setting doesn't drive `CFBundleVersion` when GENERATE_INFOPLIST_FILE=NO + a hand-provided Info.plist) → now 0.1 (build 2) so re-upload has a fresh build number.

### 2026-06-02 — Archives companion: push phone photos/boards to the Mac (media sync now closed-loop)
- Final piece — phone-created photos + mood boards now reach the desktop. `ArchivesStore.applyIncomingMedia(remote, assetsDirPath)`: inserts NEW assets (create-once; writes `file_path` on orion.db / `file_name` on the phone schema, detected via `db.columns(in:)`), LWW-upserts mood_boards, unions mood_board_assets, applies moodBoard/moodBoardAsset tombstone deletes — one deferred-FK transaction, only-insert-new, never overwriting existing rows. orion.db's assets FTS triggers keep search current.
- Bytes both directions: helper reports `haveAssetIDs` by **file existence** (not row) so a just-written phone-asset row whose bytes haven't arrived still gets its file sent; helper `onAssetFile` writes incoming images into the Mac assets dir (never overwriting); phone `receive()` sends cached image files the Mac lacks. New files only.
- **14/14 tests** (new `applyIncomingMedia` round-trip: insert + idempotent re-apply + board tombstone), iOS + helper builds green.
- **The companion is now fully closed-loop in BOTH directions** for notes/journal/projects/media/boards. ⚠️ runtime unverified (no device); writes the real orion.db + assets dir → re-back-up before testing. Brief row-before-file window (image lands seconds after the row; desktop shows it on the focus-refresh).

### 2026-06-02 — Archives companion: photo capture + mood-board editing (phone-side)
- Store CRUD: `createAsset` (image → assets row), `createMoodBoard`, `addAssetToBoard` (auto-sets cover + next position), `removeAssetFromBoard` (+ `moodBoardAsset` tombstone), `deleteMoodBoard` (+ `moodBoard` tombstone). Tombstones so deletes stick across the next Mac→phone merge (which would otherwise re-union them).
- Phone UI: Media `+` → Menu (Take Photo via `CameraPicker`/UIImagePickerController when available · Choose Photos via `.photosPicker`) → `AppModel.importImage` writes bytes to `asset-cache/` + inserts the row → appears instantly via AsyncImage. Mood: `+` alert creates a board; BoardDetail `+` → `AddAssetsSheet` (grid of assets not yet on the board, tap-to-add) + per-tile context-menu Remove + an ellipsis-menu Delete-board (pops back). project.yml already had the camera/photo Info.plist usage strings.
- All phone-local + safe (never touches the real orion.db); created content persists and survives sync via the merge (union assets / LWW boards / tombstoned deletes). **13/13 tests** (new mood-board CRUD round-trip), iOS build green.
- **Last remaining piece:** push phone-created photos/boards TO the Mac — a phone→Mac asset-byte send (reverse of the existing flow) + extending the helper write-back to insert asset/board rows into orion.db and write the image files. Deferred to its own careful pass (writes real DB + filesystem). Until then, phone-created media/boards live on the phone only.

### 2026-06-02 — Archives companion: streaming + multi-turn R.O.S.I.E + Multipeer hardening (from audit)
- **Streaming + multi-turn:** `WireMessage` envelope extended (kinds sync/chatRequest/chatChunk/chatDone/chatError + `sessionID`). Helper runs `claude --print --output-format stream-json --verbose [--resume <sid>] -- <prompt>` and parses each JSON line ON THE MAIN ACTOR (stdout forwarded via `Task { @MainActor }`, so all stream state is single-threaded — no concurrency hazards), sends each assistant snapshot as a `chatChunk` (full-text replace), captures `session_id`, and on exit sends `chatDone(finalText, sessionID)`. Phone stores the sessionID and passes it next turn (conversation memory); the bubble streams text live (spinner only until the first chunk).
- **Hardening from the `multipeer-stability-audit` (25 agents, 8 confirmed):** (1) `sendAssetFiles` now sends ONE file at a time via a DispatchGroup completion chain, re-reading live `connectedPeers` per file — kills the "Not in connected state … channel [3]" bursts (the audit's confirmed cause). (2) new `MultipeerSync.onDisconnected` fires when peers drop → phone fails a pending R.O.S.I.E request instead of hanging. (3) phone sets `isIdleTimerDisabled` while a turn runs (screen won't auto-lock → app won't suspend → link won't drop mid-wait) + a 90s timeout that fails the pending bubble; a bad/expired session id is cleared on error so it can't poison future turns.
- All green: 12/12 package tests, iOS + helper builds. ⚠️ runtime/streaming-fidelity unverified (no device); depends on `claude … stream-json` emitting incremental assistant snapshots. Remaining nice-to-have: mood-board editing + phone photo capture (needs phone-side asset/board creation + write-back beyond notes).

### 2026-06-02 — Archives companion: on-device search
- New `SearchView` (sheet from a magnifying-glass button on Today, next to Sync): in-memory search across all notes/journal/projects by title + body, title-hits ranked first, with a context snippet + kind icon/color; tap a hit → opens it in the editor. In-memory is instant at personal scale; a SQLite FTS5 table is the upgrade if the library grows huge. iOS build green.
- Sequencing the remaining nice-to-haves: search ✅ → next **streaming + multi-turn R.O.S.I.E** (will fold in the connection-stability audit's hardening) → then **mood-board editing + phone photo capture** (needs extending write-back to assets/boards). A background Multipeer stability audit (`multipeer-stability-audit`) is running to harden the resource-channel send + add disconnect→fail-pending (so a dropped link mid-wait fails the chat with a message instead of hanging).

### 2026-06-02 — Archives companion: fix R.O.S.I.E "stuck on thinking" (helper claude stdin hang)
- Symptom: phone connected, asked R.O.S.I.E, stuck on "thinking…" forever (no reply, no error). Bisected on the Mac: `claude --print "…"` hangs when its stdin never reaches EOF, but returns in ~2.5s with `< /dev/null`. The helper's `Process` inherited the GUI app's (never-closing) stdin, so `claude --print` blocked indefinitely → no `chatReply`/`chatError` ever sent.
- Fix: `proc.standardInput = FileHandle.nullDevice` (immediate EOF) + `proc.currentDirectoryURL = home` in the helper's `runClaude`. `claude` is at `~/.local/bin/claude` (already covered by the augmented PATH). Helper rebuilds; re-run it (frontend unchanged). Lesson for any future CLI spawn from a GUI/agent process: always set stdin to nullDevice unless you're feeding it.

### 2026-06-02 — Archives companion: R.O.S.I.E rail (Claude routed through the Mac)
- User chose **route-through-Mac** (uses the subscription CLI, no extra cost). Generalized the transport: every message now rides in a `WireMessage` envelope (`kind: sync|chatRequest|chatReply|chatError`), so one channel carries DB sync + a chat RPC. `MultipeerSync` gained `sendChatRequest/Reply/Error` + `onChatRequest/Reply/Error`; `didReceive` decodes the envelope and routes by kind.
- Helper: `onChatRequest` spawns `/usr/bin/env claude --print <prompt>` off-thread with an augmented PATH (homebrew / /usr/local / ~/.local/bin / ~/.claude/local — a launchd agent gets a stripped PATH), captures stdout, sends `chatReply` (or `chatError` with stderr). Oneshot full-reply for v1 (no streaming, no multi-turn `--resume` yet).
- Phone: new **R.O.S.I.E tab** (`RosieView`) — themed chat (green orb empty state, user/assistant bubbles, thinking spinner, fail state in magenta); `AppModel.askRosie` appends a pending assistant msg + sends the request; `onChatReply/Error` fills it. Disconnected → tells the user to connect (she runs on the Mac).
- **Tab reorg:** Today / Notes / Journal / Library / R.O.S.I.E (5 tabs). Sync moved off the tab bar to a toolbar button on Today (opens `SyncView` as a sheet) so R.O.S.I.E stays prominent.
- All green: 12/12 package tests, iOS + helper builds. ⚠️ runtime unverified (no device); needs the helper running with `claude` on PATH. **Completes the "do them all" batch** (asset images, collections/tags, live desktop refresh, Claude rail).

### 2026-06-02 — Archives companion: asset images + collections/tags filter + live desktop refresh
- **Asset bytes / thumbnails:** `SyncPayload.haveAssetIDs` (optional → back-compat). `MultipeerSync` split into `sendSnapshot()` (JSON) + `sendAssetFiles()` (sendResource). Helper, after write-back, streams image files the phone lacks (kind=image, ≤8MB) from `~/Library/Application Support/com.lucaorion.orion-terminal/assets/`. Phone caches received files in `asset-cache/`, `provideSnapshot` reports cached ids so the Mac skips re-sending, and `AssetTile` renders via `AsyncImage` (gradient fallback). `assetRevision` bump re-renders on arrival.
- **Collections + Tags filtering** on the Notes view: AppModel exposes `tags` + `noteTagMap` + `collectionColor` (maps `var(--neon-*)` → Theme color); horizontal chip rows filter the grid (collections color-dotted, tags violet).
- **Live desktop refresh** (first change to the desktop app, frontend-only): `useArchivesLiveRefresh` in App.tsx — on `getCurrentWindow().onFocusChanged(focused)` it reloads notes/collections/assets stores (debounced 250ms) so iOS write-backs show without a relaunch. Doesn't disturb an open BlockNote editor (content lives in-memory, not re-seeded from the store). Desktop `tsc` + vite build green.
- All green: package **12/12** tests, iOS + helper builds, desktop build. ⚠️ rendering/runtime unverified (no device). Remaining: the **Claude rail** (decision pending — Messages-API-with-key vs route-prompts-through-the-Mac), mood-board editing + phone-side asset creation.

### 2026-06-02 — Archives companion: phone→Mac write-back (sync is now two-way)
- Helper now opens `orion.db` **read/write** and on receiving the phone's payload calls `applyIncomingNotes` — conditional LWW upserts on `notes` only (rows the phone has newer/new) + tombstone deletes, in ONE `PRAGMA defer_foreign_keys` transaction. Deliberately NOT a wholesale replace: a dangling/bad row fails the commit and rolls back rather than touching real data; orion.db's FTS triggers keep `search_index` consistent. Then the helper sends its fresh snapshot back so one phone "Sync now" tap converges both devices (no loop — only the Mac auto-responds).
- Scoped to notes (incl. journal/projects) + note deletions — all the phone can edit today. Assets/collections/tags/mood write-back deferred until the phone can create them. Safe against the running desktop via SQLite multi-process locking + 5s busy timeout; on "database is locked" it just reports a failed sync (rolled back, no corruption).
- 2 new write-back XCTests (LWW upsert + stale-skip + insert-new; tombstone delete) → **12/12 green**; helper builds.
- ⚠️ The desktop app caches notes in memory, so it reflects phone changes on next **relaunch/reload** (no live orion.db watcher yet). Phone-edited notes re-embed on the desktop's next boot. Recommend backing up orion.db before the first real-data test. Next: asset bytes (real thumbnails), Collections/Tags filtering, Claude-rail decision.

### 2026-06-02 — Archives companion: Projects + Mood Boards + Library hub (UI parity)
- Phone IA: the desktop's 6 sidebar views don't fit a tab bar, so the browse surfaces are grouped under a **Library** tab. Tabs now: Today / Notes / Journal / **Library** / Sync. Library is a NavigationStack hub → Projects, Mood Boards, Media (heterogeneous `NavigationPath` with `LibraryDest` + `Note` destinations).
- **Projects**: nested page tree (kind=project via parent_id) — recursive `ProjectNodeRows` *named struct* (avoids the "opaque type defined in terms of itself" error a recursive @ViewBuilder method hits), expand/collapse, tap → the BlockNote editor, `+` new root + per-row `+` subpage, context-menu delete that cascades to subpages and writes tombstones. Cyan accent.
- **Mood Boards**: board list (cards + item count) → detail grid of member assets, magenta accent. Read-only browse for now (board create/edit is a later editing pass). **Media** moved into the hub.
- Store/model: `createNote(parentID:)`, `deleteNotes(ids:)` (+ tombstones), AppModel `projectRoots`/`projectChildren`, `moodBoards` + `boardMembers` (built from the snapshot join), cascade `deleteNote`. Image thumbnails still await asset-byte transfer (tiles show kind gradients).
- iOS-sim build green. ⚠️ rendering unverified (no device). Next per user: **phone→Mac write-back**, then asset bytes (real thumbnails), Collections/Tags sidebar filtering, Claude-rail decision.

### 2026-06-02 — Archives companion: real BlockNote editor (WKWebView) for editing parity
- Built `archives-companion/editor-web/` — a standalone Vite project that bundles the REAL BlockNote (`@blocknote/mantine`+`react` ^0.39.1, same as desktop) into ONE self-contained `editor.html` via `vite-plugin-singlefile` (2.2MB, all JS/CSS inlined, no network). Rebuild: `cd editor-web && npm run build`, then copy `dist/index.html` → `ArchivesiOS/EditorWeb/editor.html`.
- Native bridge: web→native `postMessage({type:"ready"|"change", blocks, plaintext})`; native→web `window.archivesLoad(blocksJSON, editable)`. Plaintext is a 1:1 port of the desktop `plaintext.ts` walker so FTS bodies match. `.note-page` CSS ported; body transparent so the native gradient/glass shows through; BlockNote dark theme.
- Swift: `BlockNoteEditorView` (UIViewRepresentable over a transparent WKWebView; message-handler coordinator injects initial blocks on "ready", debounced change → save) + `NoteEditorScreen` (native title TextField + journal meta over `NotePageGradient`, editor fills the body). Store gained `updateNoteBody`/`updateNoteTitle`/`createNote`; AppModel persists without a full reload (list refreshes on editor dismiss). Notes/Journal/Today push the editor (value-based nav, `Note: Hashable`); Notes/Journal have a `+` new-note button.
- Verified: 10/10 swift tests; iOS-sim build green; `editor.html` + both TTFs confirmed in the built `.app`. ⚠️ Runtime rendering unverified (no device). Edits save to the phone DB now; they reach the Mac once **phone→Mac write-back** lands (still deferred). Next: write-back, asset bytes, Projects/Mood views, Claude-rail decision.

### 2026-06-02 — Archives companion: Archives-47 visual skin (design system + 5 themed screens)
- User directive: the iOS app must LOOK like desktop Archives 47 with the same features. Mined the real design from the codebase (tokens.css + the `.ar-*` chrome CSS + each view's structure, via an Explore agent) and ported it.
- **Design system** (`Theme.swift`): exact neon tokens (bg-0..3, all `--neon-*`, text tiers, glass borders, radii) + Space Grotesk / JetBrains Mono. Repo only ships woff/woff2 (iOS can't register those), so fetched the OFL **variable TTFs** from Google Fonts, verified their CoreText family names ("Space Grotesk" / "JetBrains Mono"), bundled them + `UIAppFonts` (confirmed present in the built `.app`). Reusable chrome in `Components.swift`: `DashCard`, `NoteCard`, `JournalRow`, `NotePage` (the `.note-page` Apple-glass surface with the radial-gradient bg), `AssetTile`, `FilterChip`; plus `Pill`/`SectionLabel`/`ArchivesBackground` in `Theme.swift`.
- **Layout adapted for iPhone**: desktop's 3-column shell (sidebar│main│Claude rail) → a bottom **TabView** (Today / Notes / Journal / Media / Sync) with dark bar appearances, green tint, forced dark mode. Same visual identity, phone-shaped nav.
- **5 themed screens** over the local store: Today (greeting + today's-journal + recent-notes cards + stats), Notes (card grid + `.searchable`), Journal (entry list → glass note-page with date/time/location meta banner), Media (kind-filter chips + gradient tiles), Sync (themed). Note bodies are read-only plaintext on the glass surface for now.
- iOS-sim build green; fonts confirmed bundled. ⚠️ Pixel fidelity not agent-verifiable (no device). **Still to port for full parity:** Projects tree + Mood boards (2 more tabs or a Library grouping), sidebar Collections/Tags filtering, FTS search routing, the **WKWebView BlockNote editor** (real editing), asset-byte transfer, and the **Claude rail** (decision pending — mobile can't spawn the CLI subprocess; needs Messages-API-with-key or route-via-Mac).

### 2026-06-02 — Archives companion Phase 1: GRDB data layer + real iOS UI + helper reads orion.db
- Added **GRDB 6.29** as a separate `ArchivesStore` target in the ArchivesCore package (ArchivesCore stays pure/dependency-free; GRDB layer is isolated). `ArchivesStore` mirrors the desktop Archives schema (notes/assets/tags/joins/collections/mood_boards + a phone-only `tombstones` table) and converts DB ⇄ `SyncPayload`: `snapshot()` reads all tables, `apply()` wholesale-replaces with the merged state (so tombstoned rows drop). Row mapping is defensive — reads both the phone schema (`file_name`) and orion.db (`file_path`). 2 round-trip XCTests (seed→snapshot→merge→apply→tombstone; collections/tags) → **10/10 green** via `swift test`.
- **iOS app is now real**: `AppModel` owns the phone DB (`App Support/archives.sqlite`, seeded with a welcome note) + `MultipeerSync`; `provideSnapshot`/`onPayload` wired so a received payload merges into the local DB and persists across relaunch. UI = `TabView` — Library (Journal/Notes/Projects sections + read-only note detail) and Sync (peers/status/summary). BlockNote shown as plaintext for now; full WKWebView editor is the next phase.
- **Helper reads the real `orion.db`** read-only (`~/Library/Application Support/com.lucaorion.orion-terminal/orion.db`) and serves it as its snapshot, so the phone pulls actual Archives. Menu shows "reading orion.db · N notes". **Phone→Mac write-back is DEFERRED** (concurrent-write safety vs the live DB) — helper `onPayload` only logs. So v1 sync is one-way **Mac→phone**.
- Both targets build (`xcodebuild` iOS-sim + macOS). Possible snag to watch: read-only open of orion.db if it's ever in WAL mode (orion.db looks like rollback-journal, so likely fine). Next: WKWebView BlockNote editor; phone→Mac write-back; asset bytes via `sendResource`.

### 2026-06-02 — Archives companion: first on-device test + helper advertising fix
- User ran `ArchivesiOS` on a real iPhone — Phase 0 screen correct (advertising + "Searching for your Mac…") but no connection. Ran a 16-agent adversarial audit workflow (5 dimensions, each finding verified by a skeptic): 6 confirmed, all one root cause + its fallout.
- **Root cause:** the macOS helper's `sync.start()` sat in a `.task` on the `MenuBarExtra` content, which SwiftUI realizes only when the status item is first CLICKED → the Mac never advertised at launch (phone searches forever). iOS works because `RootView` starts in `.onAppear`. Correctly dismissed: App Sandbox entitlements (not sandboxed), different Wi-Fi, Wi-Fi off.
- **Fix:** moved `start()` to an `NSApplicationDelegateAdaptor` (`HelperController.applicationDidFinishLaunching`) owning the single `MultipeerSync`; menu UI binds to that SAME instance (verifier flagged the separate-instance trap); menu-bar icon now reflects connection. Rebuilds clean (`xcodebuild`, Swift 6, no concurrency warnings). Remaining user prereqs: grant macOS **Local Network** privacy to the helper (run the built `.app` from Finder if the prompt won't surface under Xcode for an LSUIElement agent), set `DEVELOPMENT_TEAM` for a stable code identity so the grant sticks.

### 2026-06-02 — Archives iOS companion: scaffold + sync merge engine (Phase 0)
- Kicked off a **native iOS companion for Archives**, separate from the Tauri app. User decisions: native SwiftUI client, **no cloud** — two independent local DBs that sync **peer-to-peer via MultipeerConnectivity** when near each other, full editing parity. Desktop participates via a small **macOS menu-bar helper** (Swift) that speaks Multipeer and reads/writes the existing `orion.db` out-of-band, so the Tauri app stays untouched. (This is the "separate + plug-in transfer" path; the earlier Turso/libSQL idea is shelved.)
- New top-level `archives-companion/` (xcodegen, 3 targets): `ArchivesCore` SwiftPM package (dependency-free shared core), `ArchivesiOS` (SwiftUI), `ArchivesSyncHelper` (macOS `MenuBarExtra` agent, `LSUIElement`). Regenerate the `.xcodeproj` with `xcodegen generate`; don't hand-edit it. See `archives-companion/README.md`.
- **Merge engine shipped + tested** — `MergeEngine.merge(a,b)` over full snapshots, deterministic + commutative so a single two-way exchange converges both devices: LWW-by-`updated_at` for notes/collections/mood_boards; union-by-id for create-once assets; **tag dedup by lowercased name + id remap** (since `tags.name` is UNIQUE, independent devices collide); tombstones so deletes propagate (a delete wins only if it post-dates the last edit). 8 XCTest cases green via `swift test`.
- **Multipeer transport** (`MultipeerSync`, `serviceType="archives-sync"`, auto-accept since single-user). Critical Info.plist keys (`NSLocalNetworkUsageDescription`, `NSBonjourServices` `_archives-sync._tcp`/`._udp`) wired in `project.yml` — the #1 silent-fail gotcha. App shells discover/connect; `provideSnapshot`/`onPayload` stubbed with empty payloads. macOS helper builds clean via `xcodebuild` (validates package + SwiftUI integration).
- **Next:** SQLite store on both ends (phone-local + helper reading `orion.db`) wired through `MergeEngine`; asset bytes via `sendResource`; then the SwiftUI Archives UI + WKWebView BlockNote editor for parity. User prereqs: set `DEVELOPMENT_TEAM` in `project.yml`, test discovery on **two real devices** (Multipeer needs hardware, not the simulator).

### 2026-05-31 — Companion: context-aware proactive + chat replies in the head bubble
- **Context-aware proactive.** `useProactiveCompanion` generates each check-in via `ipc.claudeOneshot`. `gatherContext` now feeds a rich, defensive snapshot: **time of day, active project, focused app, open file + other open file tabs (`allTabs`), the 3 most-recent note titles, and the last thing the user asked R.O.S.I.E** (for follow-ups). A rotating **`ANGLES`** list (current work / a recent note / general check-in / follow-up / time-of-day / a useful offer) varies each question so it's not repetitive. Cleaned (first non-empty line, strip quotes, len 4–160) with a static `FALLBACK` list if it fails/junks. Conditions re-checked after the async gen. Scheduling unchanged (≈90s first, 3–6 min, retry 30s when busy).
- **Chat replies → bubble above her head.** Second effect subscribes to `useRosie`; on turn completion (`prev.running && !running`) with the panel CLOSED (and no error, visible), it pulls the last assistant text via newly-exported `extractSpeakableText`, caps at 180 chars, and `say()`s it into the same bubble — so she "talks" above her head, ideal hands-free/voice. Panel-open turns stay in the panel. New `say()` action (bubble, no gesture) vs `ask()` (bubble + gesture).
- tsc / build / 91 tests green. ⚠️ unverified (needs live Claude + Tauri). Tunables in `useProactiveCompanion.ts` (gaps, BUBBLE_CAP, prompt). Skipped a review workflow — logic verified + tsc/tests green; question quality is a live-run judgment.

### 2026-05-31 — Companion: proactive "asks a question" + fidget cadence fix
- **Proactive check-ins.** New `companionProactiveStore` ({prompt, gestureNonce, ask, dismiss}) + `useProactiveCompanion()` scheduler hook (mounted in Shell): every ~3–6 min (first at ~90s), if she's idle & unobtrusive (visible, panel closed, not running, not being dragged, mic idle, no prompt up), she picks a random check-in from a 12-question curated list, shows it, plays a gesture, and speaks it if TTS is on. Non-intrusive: if busy, retries in 30s.
- **Surfacing:** `ask()` bumps `gestureNonce` → `RosieModel` queues `Agree_Gesture` (`GESTURE_CLIP`). `CompanionAvatar` renders a cyan speech bubble (`.ot-companion-bubble`) above her head; click → opens the ROSIE panel, X / 14s timeout → dismiss. `data-no-drag` + stopPropagation so the bubble doesn't drag/toggle her.
- **Fidget cadence fix** (user: too frequent/distracting): random idle fidgets `FIDGET_MIN/MAX_GAP` 9–22s → **120–300s** (every ~2–5 min); first fidget pushed from 5s → 75s so it doesn't fire right after the spawn entrance. She mostly just idles in Idle_15 now.
- tsc / build / 91 tests green. ⚠️ unverified visually. **Next/tuning:** clip-mapping feel (Fall4 spawn, look-around axis, ragdoll pivot), optional context-aware questions (Claude-generated), Mixamo retargets.

### 2026-05-31 — Companion: drag ragdoll (procedural limp & sway)
- Dragging her now makes her ragdoll (user picked the no-dep procedural route over a physics engine). New `dragState.ts` — a plain mutable singleton (NOT a store; drag is ~60Hz, no React renders) holding `{dragging, vx, vy}`. `CompanionAvatar` drag handlers write it (onStart/onDrag set dragging+velocity, onEnd clears dragging).
- `RosieModel` reads it each frame and drives a **damped-spring pendulum swing** of the whole body toward the drag motion: target tilt ∝ drag velocity (clamped ±0.7/±0.5 rad), semi-implicit Euler spring (K=95, C=11 → underdamped so she overshoots/flops), velocity decays when held still so she settles upright; release → spring keeps momentum and flops back to 0. Applied as a parent `swingRef` group rotation (rig-axis-independent → no T-pose risk). Secondary floppiness: Spine/Head get extra lag (∝ swingZ) + a forward slump while actually held, layered after the mixer so she reads limp, not rigid. Idle keeps playing underneath (full weight) to avoid the bind-pose bleed.
- tsc / build / 91 tests green. ⚠️ Visual/tuning unverified (agent can't run Tauri). Tunable knobs: swing gain 0.22, clamps, K/C, secondary magnitudes, and the pivot (currently her mid-body — could raise toward the head for more of a "dangling" feel). Skipped a review workflow — logic (spring stability, signal flow) verified analytically; the rest is look-and-feel for the user to tune. **Next:** proactive "asks a question" gesture.
- **T-pose bug fixed (root cause confirmed in three.js source).** When a fidget ended, the idle was revived with a bare `r.idle.fadeIn(0.4)`. But `AnimationAction._updateWeight` sets `enabled=false` once an action fades to weight 0, after which `_update` early-returns and `fadeIn`/`_scheduleFading` never re-enable it → idle never came back → bones fell to bind pose (T-pose), which also made the randoms appear to stop. Fix: set `r.idle.enabled = true` **before** `fadeIn`. (Idle time is frozen while disabled, so it resumes seamlessly.)
- **User clip→event mapping wired** (`RosieModel`): idle = **Idle_15** loop (unchanged) + random fidgets keep firing; **spawn-in = Fall4** one-shot when she appears (`companionVisible` false→true incl. first mount; note: if Fall4 ends prone we can chain `Arise`); **error/frustrated = Angry_To_Tantrum_Sit** one-shot on a failed turn (`rosie.error` onset); **thinking/working/listening = procedural look-around** (organic head/neck yaw+pitch layered on Idle_15 via post-multiply, eased by mode). New rig fields: `queue` (priority one-shots, play in any mode, via `startClipOnce`), `head`/`neck` bones, `lookW`, `lastVisible`/`lastErr` transition trackers.
- **Proactive "asks a question" = a gesture** — still TODO (needs the proactive trigger system; next). Look-around axis (assumed local Y=yaw / X=pitch) is human-unverified — may need axis tweak. tsc / build / 91 tests green. (Skipped a 5th review workflow — verified the one correctness-critical fix directly at the three.js source level; the rest is visual/tunable.)

### 2026-05-30 — Companion: Idle_15 base loop + 19 clips + clip-test mode (B)
- **Re-merged** from the user's updated Meshy export (zip 3, removed from `public/`): `companion.glb` now **13.9MB / 19 clips** — adds Confident_Walk, Formal_Bow, Ground_Flip_and_Sweep_Up (flip/cartwheel), Idle_10, **Idle_15**, Fall2/3/4/Fall_Down.
- **Rig restructured** (dropped the procedural-breathing/`pw` overlay): now a standard idle-loop + crossfade machine. `Idle_15` plays as the looping home action; fidgets crossfade in (fadeIn 0.3 / idle fadeOut), play LoopOnce+clamp, then crossfade back (action fadeOut 0.4 / idle fadeIn). 13-clip random pool (excludes Idle_15/Arise/Falls — falls end prone). Hips X/Z still locked each frame (locomotion plays in place); Y free. Leaving idle mode aborts the fidget.
- **(B) clip-test mode**: `companionDebugStore` (testMode/index/names) + `CompanionClipTester` bottom-center overlay (◀ name ▶, auto-advance, exit) + `companion.clipTest` command (⌥⇧R, also summons her). RosieModel registers all clip names on load; in testMode it loops the selected clip (crossfade on change), overriding idle/fidgets, and restores the idle loop on exit. Lets the user eyeball all 19 and pick event mappings.
- **Review (12 agents) → 3 confirmed (all clip-test-only).** Most important was real & visible: `clipAction` returns a CACHED action per clip, so selecting `Idle_15` (or any fidget clip) in test mode meant the code faded out the very action it just faded in → blank/frozen. Also weight-0 actions accumulated on cycle, and the entry-mid-fidget left a dangling action. **Fixed all three** by hard-resetting with `m.stopAllAction()` before starting each test clip (test mode overrides everything), and `stop()`ing on exit. tsc / build / 91 tests green.
- GLB → dist. ⚠️ Visuals human-unverified. **Next:** user maps clips → events (spawn=Arise, proactive=dance/flip, frustrated=Angry, greet=Formal_Bow, trip=Fall, etc.); then proactive "asks questions"; optional Mixamo retarget for more; head-look/cursor-track.

### 2026-05-30 — Companion: procedural idle rig + random fidgets + bigger frame
- **Framing.** Widget 200×300 → 300×460 and `FIT_HEIGHT` 2.4 → 1.7 so limbs/twin-tails stop clipping the canvas edges while she moves. (Model confirmed: 24-bone humanoid rig Hips→Spine→Spine01→Spine02→neck→Head + limbs; **0 morph targets** → no facial/lip-sync without added blendshapes.)
- **Procedural idle rig** (`RosieModel` in CompanionScene): own `THREE.AnimationMixer`; captures each bone's rest quat/pos on load. Each frame applies a gentle breathing (Spine/Spine02 pitch) + slow head look-around (neck/Head yaw/pitch) + sway, scaled by `pw = 1 - action.getEffectiveWeight()` — i.e. the procedural overlay fills exactly whatever the active mocap clip isn't driving, so idle↔clip transitions blend for free. Non-controlled bones slerp back to rest by `pw` (clean settle). Hips X/Z locked to rest every frame (Walking/Running/Crawl play **in place**), Y eased to rest by `pw` (Sit can still lower her).
- **Random fidgets.** While `mode==='idle'`, every 9–22s (jittered) she plays a random clip from a 9-clip pool (Agree_Gesture, both dances, sit, crawl/sneak, depressed-turn, walk, run, stomp; no immediate repeat), LoopOnce + fade, then eases back to the procedural idle. Leaving idle (listening/thinking/working) aborts the fidget. dt clamped to 0.05 to avoid post-frameloop-pause spikes. `Arise` reserved for a future spawn-in.
- **Not in the export:** jump / sleep / cartwheel — addable later via Mixamo retargeting onto this skeleton. tsc / build / 91 tests green. ⚠️ Visuals human-unverified — tuning likely (breathe magnitude, fidget cadence, per-clip feel). **Next: (B) clip-test cycle UI** so the user can pick event mappings.

### 2026-05-30 — ROSIE companion: real model integrated + throw-to-dismiss
- **Asset pipeline.** User's Meshy export was 11 separate ~12MB GLBs (base + 10 animations, each redundantly carrying the full skinned mesh + texture) — 131MB, and the 106MB zip was sitting in `public/` (would've bundled). All 11 share the IDENTICAL 26-node skeleton, so `scripts/build-companion-glb.mjs` (uses `@gltf-transform/core`, a **build-time-only devDep**) merges the base mesh ONCE + every clip's channels (retargeted to base nodes by name) into **`public/companion/companion.glb` — 13.1MB, 10 clips** (Agree_Gesture, All_Night_Dance, Angry_Ground_Stomp_1, Angry_To_Tantrum_Sit, Arise, Crawl_and_Look_Back, Depressed_Full_Turn_Left, FunnyDancing_02, Running, Walking). No runtime decoder needed. Removed the zip from `public/`. (Dropped `KHR_materials_specular/ior` — minor PBR refinements three.js renders fine without.) Re-run: `node scripts/build-companion-glb.mjs <srcDir>`.
- **Model wired in** `CompanionScene`: `useGLTF("/companion/companion.glb")` (preloaded), auto-centered + scaled to `FIT_HEIGHT`, loops `IDLE_CLIP` (default Agree_Gesture). A `ModeLight` (mode-colored point light, intensity eases to per-mode energy + live mic amplitude) conveys state (cyan idle / green listening / violet thinking / yellow working) without swapping mocap. `MODEL_FACING`/`FIT_HEIGHT`/`IDLE_CLIP` are tuning consts (human-unverified — agent can't run Tauri).
- **Throw-to-dismiss.** `CompanionAvatar` no longer clamps during drag (so she can go off-screen); on release, a fast outward flick (>1.3px/ms, stale-velocity guarded) OR center past an edge → `dismissCompanion()` (unmounts the Canvas, freeing WebGL); otherwise she snaps back (CSS transition, disabled mid-drag). Click-without-drag still toggles the panel. New `useRosie.companionVisible` (session-only, default true) + `spawnCompanion`/`dismissCompanion`; **`companion.spawn` command "Summon R.O.S.I.E Companion" (⌥R)** brings her back.
- tsc / build / 91 tests green; GLB ships to `dist/companion/`.
- **Adversarial review (25 agents) → 3 confirmed perf/lifecycle findings, top 2 fixed with one change:** the Canvas now **never unmounts** — dismiss just adds `.hidden` (visibility+pointer-events) and sets `frameloop="never"`. So there's exactly ONE WebGL context for the app's lifetime (kills the dismiss/respawn context-leak that could blank the avatar near the ~16-context cap), and the render loop parks when dismissed OR the window is hidden/minimized (`visibilitychange`) — no 60fps drain when she's not on screen. (Still 60fps while visible+idle since the idle clip animates — a true fps-cap stays a future item. The low-sev 13MB eager-preload left as-is.) `CompanionScene` takes a `frameloop` prop; summon resets her to the default position.
- **Next:** map clips → modes/events (need user's eyes on which clip reads as idle/think/etc.), spawn-in "Arise" one-shot, proactive "asks questions", lip-sync, idle-fps throttle.

### 2026-05-30 — ROSIE 3D companion: foundation (floating draggable avatar, state-reactive)
- Kicking off turning R.O.S.I.E into a Cortana-style **floating 3D companion**. User decisions: model = **glTF/GLB**, placement = **floating desktop companion**, renderer = **three.js + @react-three/fiber + drei** (approved — added to the locked stack: `three@0.184`, `@react-three/fiber@9` (React 19), `@react-three/drei@10`, `-D @types/three`), v1 behaviors = idle presence + react-to-ROSIE-states + voice-reactive + **proactively asks questions** (no lip-sync for v1).
- **Foundation shipped this turn** (model not yet integrated — awaiting the user's `.glb`):
  - `src/features/rosie/avatar/companionMode.ts` — derives a `CompanionMode` (idle/listening/thinking/working/speaking) from `currentActivity(useRosie)` + `useVoice.status`. Voice (you addressing her) wins over her own turn state.
  - `CompanionScene.tsx` — R3F `<Canvas>` (transparent, dpr 1–2). Renders a **holographic placeholder** (emissive icosahedron core + wireframe shell + point light) that animates toward a per-mode "energy" and adds live mic amplitude (read via `useVoice.getState()` in `useFrame`, NOT props, to avoid 60Hz re-renders). `MODEL_URL` const (currently `null`) + a `useGLTF`/`useAnimations` `Model` path behind a `ModelBoundary` (class) → falls back to the placeholder on load failure.
  - `CompanionAvatar.tsx` — draggable transparent widget (200×300, default bottom-right above the dock) via `useShell/useDraggable`; click-without-drag toggles the ROSIE panel; re-clamps on window resize.
  - Mounted in `Shell` **lazily** → three/r3f code-split into their own 890KB (240KB gzip) chunk, main bundle unchanged. CSS `.ot-companion*` in tokens.css. tsc / build / 91 tests green.
- **To activate her model:** drop the rigged `.glb` at `public/companion/rosie.glb` and set `MODEL_URL`. **Deferred:** model integration + camera/scale/clip-name tuning, proactive "asks questions" system, lip-sync, position persistence, idle-fps/battery throttle.

### 2026-05-30 — New app icon (red Orion sphere)
- Replaced the placeholder Tauri icon with the red glossy Orion sphere (fleur-de-lis). Canonical source saved at repo root as **`app-icon.png`** (1048×1048, alpha); regenerate everything with `npm run tauri icon -- app-icon.png`. That refreshed all `src-tauri/icons/*` (32/64/128/128@2x png, icon.icns, icon.ico, Square*/StoreLogo, plus new ios/ + android/ sets). `bundle.icon` in tauri.conf.json already referenced these paths — no config change. ⚠️ Icon only appears after a **rebuild** (`tauri dev`/`build`); macOS caches dock/Finder icons, so a Dock restart (`killall Dock`) may be needed to see it on an existing build.

### 2026-05-30 — Media viewer in Orion (images/video/audio render instead of the UTF-8 error)
- **Clicking an image in the file tree opened it in Monaco** → `read_file`'s `read_to_string` failed with "stream did not contain valid UTF-8" (a blank pane with an error string). Now media files render in a proper viewer.
- **New Rust `read_file_base64(path)`** (`fs_ops.rs`): validates exists/not-dir, caps at 20MB (`TOO_LARGE:<bytes>` sentinel past it), returns base64 (reuses `claude_cli::base64_encode`, made `pub(crate)`). Registered in `lib.rs`; `ipc.readFileBase64`. Frontend builds a `data:<mime>;base64,…` URL — works for ANY project path without widening the `asset://` scope (the scope is `$APPDATA/assets/**`).
- **`lib/mediaTypes.ts`** (pure, 9 tests): `extensionOf` (basename + `lastIndexOf('.')>0` so dotfiles → "") + `mediaTypeForPath` → `{kind,mime}|null` over an extension map (png/jpg/gif/webp/bmp/ico/avif/apng, mp4/m4v/webm/mov/ogv, mp3/wav/ogg/oga/opus/m4a/aac/flac, pdf). **`OrionMediaViewer`**: checkerboard backdrop, Fit/1:1 toggle, name·kind·dims·size toolbar, media-aware tab icons. `OrionApp` registry routes `case "file"` to the viewer when `mediaTypeForPath` is non-null, else `OrionEditor`. Editor's UTF-8 error path now shows a friendly "Can't show this as text — binary file" for non-media binaries.
- **Ran a 4-dimension adversarial review** (16 agents). 12 raised → 3 confirmed, all fixed:
  1. **SVG regression** — SVG was routed to the read-only image viewer, but it's valid UTF-8 and routinely hand-edited. Dropped `svg` from the media map → stays editable XML in Monaco (`lang.ts` maps it to xml). It never hit the UTF-8 error, so it was a pure loss of capability.
  2. **PDF blanked silently** — `data:` PDFs in an `<iframe>` render as an empty white pane on macOS WKWebView (the exact silent-white-pane class the WebPreview tab fixed earlier). PDFs now render an **"Open externally" card** (via `openPath`, no iframe, no byte read) — reliable. Added `opener:allow-open-path` to capabilities.
  3. **Silent media-load failures** — corrupt/unsupported-codec files (HEVC `.mov`, truncated png) left a blank stage forever. Added `onError` to img/video/audio → friendly message + an "Open externally" button.
- **Deferred:** inline PDF rendering (would need pdf.js or a verified path); large media rides a 20MB data-URL cap (a streamed custom protocol is the upgrade if big video matters). tsc / cargo / build / 91 tests green. ⚠️ capabilities + Rust changed → needs a full `tauri dev` restart to exercise.

### 2026-05-30 — Terminal docks at the bottom (Cursor-style) + adversarial-review fixes
- **Terminal now opens at the bottom of the whole workspace, full width**, like Cursor's integrated terminal — regardless of which panel's "+" was clicked (or ⌘\`, palette, or MCP `run_in_terminal`). New `dockTabAtBottom(root, tab, role, fraction=30)` in `workspaceStore`: wraps the layout in a vertical split (or flat-appends if the root is already vertical, re-scaling sizes to sum 100). `openTab` special-cases `descriptor.kind === "terminal"` (ignoring `opts.panelId`) before the normal routing. Closing the terminal collapses the split back via the existing `extractTab` one-child collapse. The bottom dock's "+" is empty (terminal-only, like the explorer).
- **Ran a 4-dimension adversarial review workflow** (correctness / regressions / edge-ux / tests; 23 agents, each finding verified by a skeptic). 19 raised → 9 confirmed → 3 real issues (rest were test-gaps or self-dismissed). Fixes:
  1. **Claude Code was getting pulled into the bottom terminal dock.** Root cause: `defaultRoleForDescriptor("claude-code")` was `"terminal"`, so once a role-`"terminal"` dock existed, ⌘⇧L (and the focus-fallback) routed Claude Code into the slim 30% strip; closing the terminal then orphaned it there. Fix: claude-code's default role is now **`"editor"`** (it's a full TUI — belongs in the editor area, resolved deterministically via `findPanelByRole("editor")`, never the dock), and the bottom dock's addMenu returns `[]` (was `[Claude Code]`).
  2. **Legacy layouts mis-roled.** `inferPanelRole` checked `terminal` before editor content, so a pre-role editor panel that merely held a stray terminal tab (the old terminal-as-a-tab behavior) hydrated as role `"terminal"` → lost its "+" menu / became a routing target. Fix: editor-content check now precedes the bare-terminal check; only console-only panels infer `"terminal"`.
  - **Deferred (out of scope):** ⌘\` is open-only, not a true toggle. A real toggle needs a hide-without-unmount path (plain `closeTab` would kill the pty/scrollback) — pre-existing, not worth the risk this turn.
- Tests 80→84: flat-append branch + size-sum math, claude-code-stays-out-of-dock (fresh + with-dock-focused), legacy inferRole keeps editor. tsc / build / 84 tests green.

### 2026-05-30 — Panel "+" buttons now open a real dropdown; role-scoped per panel
- The "+" on each workspace panel's tab strip was a dead button (no `onClick`) — the only way to open Preview/Terminal/Orix47/Claude Code was the keyboard shortcuts. Now it opens a dropdown of openable panes. Things land in the panel the "+" was clicked on (`openTab(descriptor, {panelId: panel.id})`); singleton kinds like `claude-code` still just activate an existing instance if already open.
- **Role-scoped menus** (driven by a new optional `addMenu?: (panel) => AddMenuItem[]` on `ContentRegistry`, implemented in `OrionApp`): **explorer** (left) returns `[]` → no "+" button at all, just the file tree; **claude** (right) is AI-only → Orix47 + Claude Code; **editor** (middle) and any role-less fanned-out panel get everything → Orix47, Claude Code, Terminal, Preview, Explorer.
- Menu is a `createPortal`-to-`<body>` fixed-positioned popover (the tab strip is `overflow-x: auto`, which would clip a downward in-flow popover). Right-aligned to the button via `translateX(-100%)`; closes on outside-mousedown / Escape; honors `prefers-reduced-motion`. `Workspace.tsx` stays generic — all Orion-specific kinds live in `OrionApp`'s `addMenu`. tsc / build / 76 tests green.

### 2026-05-30 — Preview tab: surface unreachable URLs + fix the silent-no-op reload button
- **Web preview was leaving a white pane** when the dev server wasn't reachable — no error, no signal. Now `WebPreview` tracks an `onLoad` event (which fires for any HTTP response, including 4xx/5xx); if 5s pass with no load, it surfaces a clear "Couldn't reach <url> — is your dev server running on this port?" overlay with a Retry button. (Tauri CSP is `null`, so CSP isn't the blocker; the silent failure mode was just bad UX for the common case of "I haven't started npm run dev yet" or "wrong port".)
- **Reload button did nothing**: it called `setUrl(url)` with the unchanged value → Zustand value-equality short-circuited → no re-render → iframe key (memoized on `[url]` with `Date.now()` at first render) never recomputed → no remount. Fix: added `reloadNonce` + a `reload()` action to the preview store; iframe key derives from `[url, reloadNonce]`. Toolbar reload button + retry-overlay button both call it. The unreachable timeout also resets on `reloadNonce` change so retry actually re-arms the 5s window.

### 2026-05-30 — Two more Finder drop zones: R.O.S.I.E + XDesign canvas
- **R.O.S.I.E input**: drop a file from Finder onto the input area → `@<abspath>` appended to the pending message (same pattern as the chat rails). Cyan fill on hover.
- **XDesign canvas**: drop image files onto the canvas-stage → ingested into the Archives asset library (so they live under the allowed `asset://` scope and survive the original being moved/deleted), then placed as `image` shapes near the documented default-zoom viewport center (≈500, 350) at natural dims capped to 600px (with multi-drop 30px stagger so they don't stack). Non-image extensions are ignored (XDesign is image-focused, dropping a `.tsx` here would be confusing). Cyan inset on hover.
- Same orchestrator + `useFileDropZone` hook as the other zones — each is ~15 lines + a touch of CSS, as predicted. cargo / tsc / build / 76 tests still green.

### 2026-05-30 — Cursor parity: fs watcher (external changes) + central Finder drag-drop orchestrator
- **Rust filesystem watcher** for true Cursor-like tree updates on ANY external change (VS Code save, git pull, Finder rename, downloads). New `src-tauri/src/fs_watch.rs` owns a single active `notify` watcher (RecommendedWatcher → FSEvents/inotify/ReadDirectoryChangesW) wrapped in `notify-debouncer-mini` (~300ms batches). Replaced atomically when the active project changes via `fs_watch_set_root(path)`. Ignore-list at event time skips heavy generated dirs (`/node_modules/`, `/.git/`, `/target/`, `/dist/`, `/build/`, `/.next/`, `/.cache/`, `/.turbo/`, `/.vite/`) — notify still buffers them, but they don't trigger refreshes.
- Wiring: new `ipc.fsWatchSetRoot`, `useFsWatcher()` hook in App.tsx subscribed to `useProjectStore.active`, EventBridge listens for the `fs:changed` event and routes it through the **same 750ms throttle** as `terminal:data` so overlapping bursts coalesce to one refresh. Two new Rust deps: **`notify = "6"`** and **`notify-debouncer-mini = "0.4"`** (both standard, MIT, ~2MB compiled — flagged before adding per project rule).
- **Central Finder drag-drop orchestrator** (`src/lib/fileDrop.ts`): one webview-level `onDragDropEvent` listener, hit-tests the position against `data-drop-zone` attributes (walks up from `elementFromPoint`, divided by DPR since Tauri sends physical pixels), dispatches `enter`/`leave`/`drop` events to the matching zone's handler. Nested zones win over shells (drop into the chat input *inside* Archives → chat handler, not Archives ingest).
- New `useFileDropZone(ref, name, handler)` hook makes opting in trivial. Wired three zones in this pass:
  - **Archives** (migrated off its own per-app listener): drops ingest assets and route into the open mood board if Mood detail is visible — identical behavior to before, just routed through the orchestrator.
  - **ClaudeChat input** (every rail, keyed by `appId`): Finder file drop appends `@<abspath>` for each file, mirroring the existing internal-asset DnD; both paths coexist (internal MIME via React DOM events, Finder via the orchestrator).
  - **Orion file tree** (`or-files-panel`, new zone "orion-files"): drop opens each path as an editor tab (matches VS Code dragging-into-tabs — no copy). Cyan outline + faint tint on hover.
- Rosie and XDesign canvas not migrated yet (low-cost follow-ups whenever wanted). cargo / tsc / build / 76 tests all green.

### 2026-05-30 — Two real bugs hit while dogfooding: Claude Code session loss on tab switch + missing file-tree auto-refresh
- **Claude Code tab kept dying on every tab switch** despite the `persistent` opt-in. Root cause was structural: the workspace renderer put the active tab in a *different* DOM parent (`.ot-panel-tab-slot.active`) than the persistent-inactive ones (`.ot-panel-tab-slot`). When the user switched away, React couldn't reconcile the Claude Code component across that parent boundary — it **unmounted** the outgoing instance (cleanup → `terminalKill` → pty dies, fresh `ulid` ptyId on next mount) before remounting it as a hidden sibling. Fix: render every mounted tab (active + other persistent) as **siblings in one keyed list** in `.ot-panel-tabs-layer`; `.active` becomes a pure CSS toggle. Pty stays alive across switches now.
- **File tree never reflected Claude Code's edits** (user had to relaunch the app to see them). The existing `useFileTreeRefresh` bump only fires on `claude:event` tool_results — fine for the chat rails, useless for the Claude Code tab since its tool calls happen *inside* the interactive pty (no stream-json hits the frontend). Fix: throttled global listener on `terminal:data` → leading-edge `useFileTreeRefresh.bump()` every 750ms during continuous output, with a final bump 750ms after output settles. No new deps. Bonus: also catches raw shell commands (`npm i`, `mv`, etc.) that touch project files.
- **Still missing** (deliberate): external-editor changes don't refresh the tree (would need a real `notify`-based file watcher; new Rust dep — flagged for if/when you want it).

### 2026-05-29 — Per-page undo stacks + multi-theme system (neon/minimal/modern)
- **Per-page undo** (fixes the latent cross-page corruption): `Page` now owns `past`/`future`; `switchPage`/`newPage`/`deletePage` save the active page's stacks back into `pages` and load the target's. Top-level `past`/`future`/`shapes` = the active page's working copy (unchanged for pushHistory/undo/redo). Stacks are transient: hydrate re-inits them `[]`, persistence (App.tsx) strips them. Undoing on one page never touches another. Test added (undo isolation across pages). The runner's coalesce.pageId guard still covers agent multi-page turns.
- **Theme system** — replaced the dead dark/light toggle with named themes overriding the `:root` tokens via `data-theme` on <html>. `themeStore` now: `theme: "neon"|"minimal"|"modern"`, `THEMES` list, `toggle()` cycles, `hydrate()` maps legacy "dark"/"light"/unknown → "neon". `styles/themes.css` defines `[data-theme="minimal"]` (calm monochrome, no glow, flatter radii) + `[data-theme="modern"]` (slate + soft Tailwind-ish accents); neon = the `:root` default. Settings → Appearance is now a theme-card picker (per-theme swatches); `view.toggleTheme` command relabeled "Cycle Theme". App.tsx always hydrates (null → neon) so `data-theme` is set on boot.
- All themes are **dark-base** by design: token overrides reskin everything that uses `var(--token)`, but a true LIGHT theme needs a pass over hardcoded `rgba(255,255,255,…)`/`rgba(0,0,0,…)` literals that assume a dark canvas — deferred. Adding a new theme = one `THEMES` entry + one `[data-theme="…"]` block. UI itself human-unverified (agent can't run Tauri) — theme color values are tasteful starting points to refine. tsc / build / 76 tests green.

### 2026-05-29 — Finish XDesign: pages + z-order + duplicate ops (apply runner)
- Added the last canvas ops to `orion_xdesign_apply`: **pages** (`addPage`→id+switches, `switchPage`, `renamePage`, `deletePage`), **z-order** (`bringToFront`, `sendToBack`), and **`duplicate`** (→ new ids). All thin wrappers over existing store actions. The Design Partner now reaches essentially everything the manual UI can.
- **Solved the pages-vs-undo conflict** that got pages deferred: `switchPage`/`newPage` swap the active `shapes` array but share one undo stack, so a cross-page batch could collapse one page's shapes onto another. Fix: tag the coalesce baseline with `pageId` (`coalesce.pageId`), and the runner now **skips the shape-undo rewrite when `activePageId` changed vs the baseline** (only clears redo). Page nav is treated as a hard undo boundary, not a shape-undo step — no manual `switchPage` behavior changed. Documented the pattern for the agent: create a page in one call, add its content in a follow-up call.
- Tests 72→75: duplicate returns/adds ids; addPage switches without leaking page-1's shapes onto the new page (and page 1 stays intact on switch-back); a page-changing batch writes no shape-undo entry. Test `beforeEach` now resets to a clean single-page doc. tsc / cargo / build green; `tools/list` apply description updated.
- **MCP canvas arc COMPLETE:** read-back (Phase 1) → batched id-returning mutations (Phase 2) → structure/components/variables (Phase 3) → pages/z-order/duplicate, all one-turn-one-undo. Remaining XDesign deferrals are non-MCP: per-page undo stacks (current model clears nothing on manual switch — latent cross-page undo quirk untouched), light theme.

### 2026-05-29 — Opus 4.8 sweep + inline edits moved off the API onto the subscription CLI
- **All subscription Claude surfaces → Opus 4.8.** New single source of truth `claude_cli::OPUS_MODEL = "claude-opus-4-8"`, referenced by the chat rails/R.O.S.I.E/XDesign (`claude_send`), the Claude Code tab (`terminal.rs`), and the Messages-API default (`messages_chat.rs`). Future bumps = one line. (Pricing `starts_with("claude-opus")` heuristic still matches.)
- **Inline edits no longer use the Anthropic API / OS-keychain key.** Rewrote `inline_edit_run` to spawn the subscription CLI (`claude --print --output-format stream-json`, NO `--mcp-config` — pure tool-less completion, leaner). `augmented_path()` made `pub(crate)`. Orion now needs **zero API key** for any Claude feature — fully subscription. (Inline runs on **Opus 4.8** too, via `OPUS_MODEL` — uniform with the other surfaces now that it's CLI-based, not the latency-bound API path; the brief speed bump from Opus is moot since `--print` already populates the diff in one shot rather than streaming. The transient `SONNET_MODEL` const was removed.)
- Frontend unchanged: same `inline:delta`/`inline:done`/`inline:error` event contract, so the DiffEditor + overlay work as-is. The old "no API key — open Settings" failure path is gone.
- **Tradeoff:** `--print` returns the reply in ONE assistant event (verified via CLI probe — no token streaming), so the diff now populates when ready instead of typing in live. `strip_code_fences` guards against claude-code wrapping output in ```; stderr is drained for error surfacing. cargo / tsc / build / 72 tests all green.
- **Self-updating Orion (answered, not built):** in `tauri dev` Claude Code can already edit Orion's own source (point the project at the repo) — frontend hot-reloads, Rust rebuilds+restarts; caveat: a broken build takes the live app down. A shipped app can't recompile itself live — the real path is `tauri-plugin-updater` pulling signed releases (deferred until wanted).

### 2026-05-28 — Fix: moving a frame orphaned its children (frames now carry contents)
- **Bug surfaced testing Phase 3 components:** after `createInstance`, repositioning a frame via `update {x}` (or the inspector) left its accent/title behind — agent saw "children that didn't move with their instance" / strays at x=414. Root cause: positions are absolute and `updateShape` was a flat single-shape patch — only the canvas DRAG path moved descendants (via `patchMany` + `collectDescendantIds`).
- **Fix:** `updateShape` now, when x and/or y change, translates the shape's descendants by the same delta (frames carry their contents). Matches the drag path; fixes BOTH the inspector and agent `update`. Non-position patches don't cascade. Drag is unaffected (it uses `patchMany` directly, not `updateShape`).
- `createInstance` gained an optional `at:{x,y}` (op: `createInstance {mainId, x?, y?}`) so the agent can place instances directly instead of all stacking at `main.x + w + 40` (the cause of the "rogue duplicate frames at 390,200" pileup). Also removed the no-op `s.id===mainId ? s.x+dx : s.x+dx` ternary (always shifted whole subtree anyway — clone was fine; the stray children came from the later `update`, not the clone).
- Tests 70→72: move-frame-carries-child (child x 20→320 with a +300 frame move); createInstance-at places the whole subtree (child at 510, not left behind). tsc / cargo / build green.

### 2026-05-28 — MCP Phase 3: structure / components / variables ops (apply runner)
- Extended the `orion_xdesign_apply` op vocabulary (all flow through the same `runCanvasCommands` runner → batched, one-undo, id-returning):
  - **Structure:** `group {ids}` (→ frame id), `ungroup {ids}`, `reparent {id, parentId|null}` (nest into a frame / move to root).
  - **Components:** `makeComponent {id}`, `createInstance {mainId}` (→ instance id), `syncInstance {id}`, `detachInstance {id}`.
  - **Variables/modes:** `addVariable {name,value,varType?}` (→ id), `setVariableValue {id,modeId,value}`, `addMode {name}` (→ id), `setActiveMode {id}`. Use on a shape via `update {id, fill:"var:<id>"}`.
  - **Auto-layout & image fill:** no new ops — documented as `update` props (`layoutMode`/`itemSpacing`/`padding*`/`primaryAxisAlign`/`layoutSizingH|V`; `fillImage:{filePath,assetId,fit}` with paths from `orion_list_assets`/`search_assets`).
- Runner handles id provenance: shape-creating ops (group/createInstance) push to `newIds` (→ selected + result id); non-shape ops (addVariable/addMode) report their id in `results` only (kept out of selection). Each maps to an existing store action.
- **Pages deferred** from the apply tool on purpose: `switchPage` swaps the active `shapes` array, which fights the shape-undo collapse and needs special-casing — not worth it for v1.
- Variable/mode changes are config, NOT in shape undo (consistent with the manual UI). Tests 67→70 (group→frame, reparent nesting, addVariable returns non-shape id w/o selecting it). tsc / cargo / build green; MCP `tools/list` description updated. ⚠️ `tauri dev` restart to exercise (Rust description changed).

### 2026-05-28 — One agent turn = one undo (turn-level coalescing + prompt nudge)
- After the per-batch fix, a turn could still be 2 undos when the agent split an edit into 2 `apply` calls (my prompt encouraged "addFrame then follow-up call by id"). Now: **a whole agent message collapses to a single undo step regardless of how many apply calls it makes.**
- **Store** gained transient `coalesce: {shapes, past} | null` + `beginHistoryCoalesce()` / `endHistoryCoalesce()`. When coalescing, `runCanvasCommands` collapses history back to the TURN baseline (not the per-batch one), so N apply calls in a turn stay one entry. Not persisted; reset in `hydrate`.
- **Rail** calls `beginHistoryCoalesce()` in `handleSend` and `endHistoryCoalesce()` via a `thread.running`-watch effect (covers normal finish + error + cancel, since all flip running off). Manual edits between turns get normal per-action undo.
- **Prompt** reworded: put ALL ops for one request in a SINGLE apply call (you choose coords, so place frame + children together); only make a 2nd call when you need an id the first returned. Cuts needless round-trips on top of the coalescing guarantee.
- Tests 65→67: multi-batch coalesced turn → `past.length===1` + one undo empties canvas; post-turn batch → per-batch undo restored. tsc / build green.

### 2026-05-28 — Fix: canvas batch was N undo steps, not 1
- **Bug:** ⌘Z needed multiple presses to undo one agent edit. Root cause: the store's individual actions (`addShape` store.ts:531, `deleteShapes` :559) each call `pushHistory()` internally, so `runCanvasCommands`' single top-level `pushHistory()` was defeated — every add/delete in a batch made its own history entry. (The DSL's "one pushHistory per batch" comment was never actually true.)
- **Fix:** `runCanvasCommands` no longer pushes up front. It snapshots `past`/`future`/`shapes` before the batch, lets the ops run (and self-push), then **rewrites history to a single entry** = pre-batch shapes (`setState({ past:[...priorPast, shapesBefore], future:[] })`). One ⌘Z now reverts the whole batch; redo restores it. No-op/select-only batches restore the original history (no stray entry). `selectMany` runs before the rewrite so it can't leave an entry behind.
- Fixes BOTH paths (apply tool + legacy `<canvas-command>` DSL) since both go through `runCanvasCommands`. New `claudeCommands.test.ts` (5 tests) locks it in: multi-op batch → `past.length === 1`, one undo empties the canvas, add ops return ids, unknown action reports `ok:false` without dropping the rest. Suite 60→65 green; build green.

### 2026-05-28 — MCP Phase 2: batched canvas mutation tool (`orion_xdesign_apply`)
- **New tool `orion_xdesign_apply(ops[])`** — the preferred way for the Design Partner to mutate the canvas. Takes an array of the same op shapes as the `<canvas-command>` DSL (addRect/addEllipse/addText/addFrame/addStar/addPath/update/delete/select/clearCanvas), applies the whole array as **ONE undo step**, and **returns the new shape ids** + per-op status: `{ applied, results:[{action, ok, id?, error?}] }`. The id return is the payoff — Claude can addFrame then position children by the returned id in a follow-up call.
- **Reused the DSL runner.** `runCanvasCommands` (claudeCommands.ts) refactored from `=> number` to `=> { applied, newIds, results }` — wrapped the loop with before/after tracking so per-op results (incl. new id) are captured without touching any case body. Single existing caller (rail's useEffect) updated to destructure `{ applied }`. EventBridge `xdesign_apply` handler casts `ops` → CanvasCommand[] and runs it, returning `{applied, results}` through the round-trip bridge.
- **System prompt** now leads with the apply tool (returns ids, one undo step, read `results` to confirm), and demotes the `<canvas-command>` tags to a documented fallback with an explicit "don't pair both for the same edit" warning (would apply twice).
- Verified: `tsc` / `cargo check` / build green; MCP `tools/list` now lists 24 tools incl. `orion_xdesign_apply`. ⚠️ Needs a full `tauri dev` restart (Rust changed) to exercise in-app. Test: "add a glass card with a title centered inside" → should be one undo (⌘Z removes the whole card), and a follow-up like "nudge the title down 10px" should target the title by the id the tool returned.
- Decision taken (per discussion): array-of-ops batching over per-call undo or stateful begin/commit — one tool, one undo step, no pairing for the model to remember.

### 2026-05-28 — MCP Phase 1: bridge round-trip + XDesign canvas read-back tools
- **`ui_bridge` is now request→response, not fire-and-forget.** `handle_request` (async) generates a `requestId`, registers a `oneshot` in a `PENDING` map, emits `ui:action` with the id, then awaits the frontend reply with a 5s `timeout`. New `ui_bridge_respond(requestId, ok, data, error)` Tauri command delivers the result; `Response` gained an optional `data` field. This unlocks tools that *read state back*, not just fire UI actions.
- **Frontend always replies.** `EventBridge`'s `ui:action` listener reads `requestId`, runs `handleUiAction` (now returns `unknown` — data for queries, void for actions), and calls `ipc.uiBridgeRespond` on both success and throw — so the bridge never waits out its timeout. Existing kinds (open_app/switch_project/xdesign_add_*) respond `{ok:true}` unchanged.
- **`send_ui_action` (mcp_server) now returns `Result<Value,String>`** — parses the bridge reply, returns `data` on ok / `Err(error)` otherwise. Read timeout bumped 2s→8s (must exceed the bridge's 5s wait). Existing `send_ui_action(...)?;` callers still compile (Ok value discarded).
- **Two read-back tools (23 total):** `orion_xdesign_get_canvas` (every layer on the active page w/ full props + selection + pages) and `orion_xdesign_get_selection` (full props of selected shapes). Frontend reads `useXDesign.getState()`. XDesign system prompt now tells Claude to call these for precise state ("double its size", "match that blue") instead of guessing from the truncated text summary.
- Verified: `tsc` / `cargo check` / build green; MCP `tools/list` lists both new tools. ⚠️ Full round-trip needs the running app (bridge ↔ frontend) — **requires a full `tauri dev` restart** (Rust changed; hot-reload leaves a mismatched main-app/MCP-binary state that times out — symptom is the agent "eyeballing" from the image + offering to "retry the read").
- **CONFIRMED WORKING in-app** (user-verified after a clean restart): asked "what's selected and its exact fill?" → got exact `#e6ff3a` fill + `rgba(255,62,165,0.75)` 1.5px stroke pulled from shape data (stroke alpha/width aren't recoverable from the image, proving it's reading real state, not eyeballing). The bridge round-trip RPC + read-back tools are functional end to end.
- Next (Phase 2, deferred): id-returning mutations (`update`/`delete`/`select` + add_* returning the new id) so Claude can target what it just made; decide undo-batching (per-tool vs array/begin-commit) first.

### 2026-05-28 — Vision loop fix: `@path` is dropped on `--resume`; switch to stream-json stdin image block
- **Bug found by direct CLI bisection** (ran the user's real snapshot through claude with the app's exact flags): `claude … -- "…@/abs/path.png"` attaches the image on turn 1 but **silently drops it on every `--resume` turn**. Since the XDesign thread resumes a session, the model never saw the canvas → it guessed colors ("violet/cyan" for a cyan/yellow canvas). The frontend render + file write were both perfect; the attachment mechanism was the fault.
- **Fix:** when an image is attached, `claude_send` now feeds the turn as a `--input-format stream-json` **user message on stdin** with a real base64 image content block, instead of an `@path` mention. Verified across the full shipped combo (stdin image + `--mcp-config` + `--resume`) — reads colors correctly every time. Text-only turns keep the simpler positional `-- <prompt>` path untouched, so the other rails (Archives/Orion/Rosie) are unaffected.
- `claude_send` gained an `image_path: Option<String>` param + a small inlined `base64_encode` (avoided adding a base64 crate dep) + `build_user_image_message`. stdin write is spawned as a task so a large payload can't deadlock the stdout reader. `ipc.claudeSend` gained an optional 5th `imagePath` arg (defaults null). `XDesignClaudeRail` now passes `snapshotPath` through instead of appending `@path`.
- ⚠️ Requires a **full `tauri dev` restart** to pick up the changed Rust command signature (frontend hot-reloads, Rust doesn't). `tsc` / `cargo check` / build all green.
- **CONFIRMED WORKING in-app** (user-verified after restart): the Design Partner now reads shape colors/positions correctly from the render AND can act on what it sees (e.g. "fix the spacing"). The vision loop is fully functional end-to-end. Debug `log.info` removed; the failure-path `log.warn` in `captureCanvasSnapshot` stays.

### 2026-05-28 — XDesign Claude vision loop (it can SEE the canvas now)
- **The XDesign design partner is no longer blind.** Each turn the rail rasterizes the whole visible canvas to a PNG and attaches it so Opus 4.7 judges layout/spacing/color/overlap from real pixels, then iterates against the next turn's render. Biggest single jump in design quality; plumbing reused existing pieces.
- Transport unchanged: still the **claude-code CLI subprocess** (`claude --print … --model claude-opus-4-7`, subscription auth, MCP attached). Canvas edits still flow through the `<canvas-command>` text DSL — the image is an *input*, not a new tool path. The image rides in via the CLI's `@<abs-path>` attachment syntax (same mechanism as image auto-tagging).
- New `exportXD.renderPngBytes(bounds, maxDim=1600)` factors out a shared `rasterizePNG` (paints the editor's dark `#0a1015` backdrop so translucent glass/neon shapes don't wash out on alpha; downscales large docs). New Rust `asset::xdesign_snapshot_write(bytes)` overwrites a single throwaway `xdesign-snapshot.png` in the app config dir (kept OUT of the asset library) and returns its abs path; `ipc.xdesignSnapshotWrite`.
- `XDesignClaudeRail.handleSend` now: capture snapshot (full design via `computeExportBounds(shapes, new Set())`) → write file → append `@<path>` + a "treat the image as ground truth" note to the prompt. Non-fatal: empty canvas / render failure just sends text-only. System prompt gained a "Seeing the canvas" section. `SHAPE_SUMMARY_LIMIT` 6 → 40 (image carries visual detail; the list now exists mainly to hand Claude layer ids to target).
- `tsc` / `cargo check` / build all green (~4.7s). UI human-unverified (agent can't run Tauri). **Next discussed: promoting canvas ops to real MCP tools** (typed, validated, can read back state) — deferred to a follow-up per user.

### 2026-05-28 — XDesign: soft-grey accent + draggable/resizable Claude panel
- **Accent magenta → soft grey, XDesign-only.** New `:root` tokens `--xd-accent-rgb: 205, 214, 222` + `--xd-accent: rgb(var(--xd-accent-rgb))`. `.xd-shell` scopes a `--neon-magenta: var(--xd-accent)` override so every `var(--neon-magenta)` inside XDesign (canvas selection handles/guides, layer markers, inspector, Claude rail) cascades to grey without touching the global token — error states / syntax / Archives video icons / collections palette stay magenta. No XDesign surface portals out of `.xd-shell`, so the cascade reaches all of them.
- The ~50 hardcoded `rgba(255,62,165,X)` literals **inside the XDesign CSS ranges only** (stub block + everything from the "Phase C" section to EOF) were converted to `rgba(var(--xd-accent-rgb),X)` via a line-range sed; the other 38 magenta literals elsewhere were left untouched (verified: 88 → 38 remaining).
- **Claude panel is now draggable + resizable.** `XDesignClaudeRail` uses `useShell/useDraggable` twice — header = move, bottom-right grip = resize — tracking a stage-relative `Box {left,top,w,h}` in component state (null = CSS bottom-right default; placement survives close/reopen since the rail is always mounted). Clamped to the canvas-stage bounds, min 300×280. Close button marked `data-no-drag`. New CSS: `.xd-claude-rail-head{cursor:move}` + `.xd-claude-resize` corner grip.
- `claude.ts` subtitle "magenta · over the canvas" → "over the canvas"; accentColor → `var(--xd-accent)`. `tsc` clean, build green (~4.6s). UI itself human-unverified (agent can't run Tauri).

### 2026-05-28 — Hardening cont.: extract + harden the MCP tool-name seams
- Pulled the two spots that have actually bitten us into pure, unit-tested modules. `src/lib/orionToolMatch.ts` holds the cache-invalidation matchers (`isOrionNoteWriteTool` / `MoodWriteTool` / `AssetWriteTool`); `src/lib/toolFormat.ts` holds `prettyToolName` + `formatToolResult`. Inline copies removed from `EventBridge.tsx` and `Rosie.tsx`, now imported.
- Matchers are now **stricter** than the old loose `endsWith(s)`: `name === s || name.endsWith("__"+s)`. So `mcp__orion__orion_create_note` matches (the real form claude emits) but `xorion_create_note` does not — the prefix bug that bit us before is now pinned by a test.
- New tests: `orionToolMatch.test.ts` (5) + `toolFormat.test.ts` (9). Full suite **60/60 green**; `tsc --noEmit` clean, `cargo check` clean, `npm run build` succeeds (~4.6s).

### 2026-05-28 — Hardening pass: error isolation, tests, bundle split, MCP headers, chips
- **Per-surface error boundaries**: the root `ErrorBoundary` already wrapped the whole app, but a crash in one app white-screened everything. Reworked `ErrorBoundary` to be reusable (`label` + `compact` props + a reset button) and wrapped each app window (`AppBody`) and the R.O.S.I.E panel in their own boundaries — a crash now shows a contained "X hit an error · Reload" fallback while the rest of the shell keeps running.
- **Test coverage 19 → 46**: extracted pure helpers into standalone, dependency-free modules — `lib/wakePhrase.ts` (TRIGGERS + matchTrigger, pulled out of wakeWord.ts) and `lib/mcpName.ts` (safeMcpName, pulled out of mcpServersStore) — and exported `speakableText` from voiceSpeak. New test files: wakePhrase (trigger matching incl. mid-sentence rejection), mcpName (normalization), voiceSpeak (markdown stripping), embeddings (cosine sim identities + serialize/deserialize round-trip + 4-bytes-per-elem).
- **Bundle code-split**: the 3 apps (Orion/Archives/XDesign) are now `React.lazy` + `Suspense` (orb spinner fallback). Main chunk dropped **2.5MB → 807KB** (gzip 252KB); Monaco rides in the 361KB OrionApp chunk, loaded only when Orion's window opens. XDesign 85KB, Archives 74KB, each on demand.
- **MCP HTTP auth headers**: the Settings MCP form's http branch now takes an optional header name/value pair (defaults to `Authorization`), wired through the existing `addHttp(name, url, headers)`. Auth'd HTTP MCP servers now fully configurable.
- **Prettier tool-result chips**: new `formatToolResult` normalizes claude's string|array tool_result content, re-pretty-prints embedded JSON (no more escaped `{\"ok\":true}`), caps at 2000 chars.

### 2026-05-28 — MCP server management UI (Orion-scoped extra servers)
- New Settings → "MCP Servers" section. Add/toggle/remove extra MCP servers (Linear, GitHub, Sentry, etc.) that R.O.S.I.E + the rails + Claude Code tab can call. stdio (command line, naïvely split into command + args) or http (url) transports. Header/env editing deferred.
- `mcpServersStore` (zustand) persists the list to `app_state.mcp.servers` as `[{id, name, enabled, config}]` where `config` is the verbatim claude `mcpServers[name]` object (stdio: command/args/env; http: {type:"http",url,headers}). Names normalized claude-safe (lowercase, non-alnum→`_`).
- Rust `mcp_config::write` now opens orion.db via rusqlite, reads `app_state.mcp.servers`, and merges enabled entries into the generated config alongside the built-in `orion` server (which can't be shadowed). Best-effort — a malformed entry never breaks the whole config. Applies on the next R.O.S.I.E turn (fresh subprocess reads the regenerated file).
- Key insight reaffirmed: we spawn claude WITHOUT `--strict-mcp-config`, so the user's globally-configured claude MCP servers are ALSO available to R.O.S.I.E already; this UI adds an Orion-scoped layer on top without touching `~/.claude.json`.

### 2026-05-28 — Background task surface for R.O.S.I.E
- New floating `RosieTaskChip` (bottom-right, above the dock) appears whenever a turn is running AND the panel is closed — so dismissing the panel mid-task no longer hides all progress. Shows live activity + elapsed timer, click to re-open, stop button to cancel.
- `rosieStore` gained `turnStartedAt` (set on turn start, cleared in all four exit paths: exit event, watchdog, error, cancel) for the elapsed clock. New exported `currentActivity(state)` helper derives a human label: `running <tool>` (pretty-printed, mcp prefix stripped) when a tool is mid-flight, else `responding…` / `thinking…` based on whether the pending assistant message has text yet.
- In-panel `DiagnosticStrip` "working…" replaced with the same live `currentActivity` label so the panel and the chip agree on what R.O.S.I.E is doing.
- Both surfaces subscribe to `toolCalls` + `messages` slices to stay reactive, then call `currentActivity(getState())` for the label.

### 2026-05-28 — Wake-word feedback: earcons + screen-edge glow
- New `lib/earcon.ts` — synthesizes short tones via Web Audio (no bundled audio asset). `earconArmed()` (single 660Hz tone) when wake mode turns on, `earconDisarmed()` (440Hz) when off, `earconWake()` (880→1320Hz ascending blip) the instant a trigger phrase is recognized. Singleton AudioContext, resumed on demand, peak gain ≤0.13 (confirmation not alarm).
- `voiceStore` gained `wakePulse` (monotonic counter) + `pulse()`. `wakeWord.ts` calls `earconWake()` + `pulse()` immediately on a matched trigger, before the response streams — so hands-free use gets instant acknowledgement.
- New `WakeFlash` overlay mounted in Shell: keys a green inset screen-edge glow off `wakePulse` (fresh element per pulse so back-to-back triggers re-fire). 900ms ease-out, honors `prefers-reduced-motion`. Matches the listening-mode green accent.
- `toggleListening` now plays armed/disarmed earcons too, so arming wake mode (⌘⇧J) has audible confirmation independent of any later trigger.

### 2026-05-28 — Full internal rename Core → R.O.S.I.E (complete)
The agent is now `rosie` end-to-end, not just in display text. All steps done + verified (tsc / cargo / build / 19 tests green):
- Files: `src/features/coreClaude/` → `src/features/rosie/`; `coreClaudeStore.ts` → `rosieStore.ts`; `CoreClaude.tsx` → `Rosie.tsx`.
- Identifiers: `useCoreClaude`→`useRosie`, component `CoreClaude`→`Rosie`, `CoreClaudeState`→`RosieState`, `CoreMessage`→`RosieMessage`, `CoreContentBlock`→`RosieContentBlock`, `CoreEvent`→`RosieEvent`, `CoreUserBlock`→`RosieUserBlock`. Import paths updated in all 7 consumers (App/Shell/Dock/builtins/voiceStore/wakeWord/searchNav).
- CSS: `ot-core-*` → `ot-rosie-*` (tokens.css + Rosie.tsx). Left `ot-claude-orb` alone (shared orb used by the dock too).
- Command id `core.toggle` → `rosie.toggle`. app_state keys `core.ttsEnabled` → `rosie.ttsEnabled` (existing TTS pref resets to off once — acceptable).
- **Migration 0013** `UPDATE chats SET origin='rosie' WHERE origin='core'` so previously-persisted agent conversations resume under the new name. `ChatOrigin` union now `"archives"|"orion"|"xdesign"|"rosie"`; the 3 origin reads/writes updated (rosieStore persist + resumeLatest, searchNav openChatById).
- BSD sed gotcha worth remembering: no `\b` word boundaries, and `\{ \}` in a pattern errors out the whole `-e` batch. Used plain literal substitutions instead.
- Migrations now 0001..0013.

Append a dated entry whenever a logical chunk of work lands. Keep entries short (3–6 lines). Newest at the top.

### 2026-05-28 — Wake word: ambient VAD listener → trigger phrase → auto-send
- **Approach**: energy-based VAD on raw PCM (no continuous Whisper). `lib/wakeWord.ts` opens the mic, runs a `ScriptProcessorNode` (4096-frame chunks) through a silence/speech state machine, buffers PCM only during a detected burst (with a 2-chunk pre-roll so word onsets aren't clipped), and on end-of-utterance (650ms trailing silence, or 12s hard cap) hands the segment to Whisper. Idle cost ≈ the analyser loop only; Whisper fires solely on speech. No new deps, no API key, no commercial wake-word model.
- Captures PCM directly → resamples → Whisper, **skipping the Opus encode/decode round-trip** the push-to-talk path uses. Refactored `voiceTranscribe.ts` to expose `resampleTo16k()` + `transcribeSamples(samples, quiet?)` for this.
- **Trigger matching**: transcript lowercased, leading punctuation stripped, matched against `["hey core","okay core","ok core","core","jarvis"]`. On match → strip the phrase → if there's a remainder, `useCoreClaude.send()` it (hands-free auto-send); if it's a bare trigger, just open the panel. Non-trigger bursts are silently dropped (the whole point — ambient audio that isn't addressed to Core is ignored).
- **Mutual exclusion**: push-to-talk (⌘⇧V) and ambient listening (⌘⇧J) can't both hold the mic — toggling PTT pauses the listener and resumes it after, if it was on.
- **UI**: menubar mic gets a third state — green "listening" (vs magenta "recording" vs cyan idle), bars driven by live amplitude in both live modes. Right-click the mic OR ⌘⇧J toggles wake mode. `voice.listenMode` persists to app_state but is intentionally NOT auto-restored on launch (silently opening the mic on boot + triggering an OS prompt would be hostile). New `"listening"` VoiceStatus.
- Tradeoffs noted in-code: main-thread ScriptProcessorNode (deprecated but universal in WKWebView; AudioWorklet needs a separate file) + Whisper-tiny rather than a purpose-built wake model. Revisit with Porcupine only if false-trigger rate becomes annoying.

### 2026-05-28 — TTS + 6 more MCP tools (21 total); wake word deferred
- **TTS for Core responses**: new `lib/voiceSpeak.ts` wraps `window.speechSynthesis`. Picks a "premium / Samantha / Alex / Ava / Evan / Nathan / Joelle" English voice when available, falls back to OS default. Strips markdown/code fences from the text so the synthesizer doesn't read raw syntax aloud. Rate 1.05 (slightly brisk, JARVIS-y). `stopSpeaking()` cancels any in-flight utterance so consecutive turns don't queue.
- Core's store gained `ttsEnabled` (persisted to `app_state.core.ttsEnabled`) and a `setTtsEnabled` action. On every `claude:exit` after a successful turn, if TTS is on, the new `extractSpeakableText` helper pulls just text blocks (skipping tool_use/thinking) and feeds them to `speak()`. Toggle button (volume icon) lives in the Core panel header next to the new-conversation + close buttons; cyan tint when on.
- App.tsx hydrate now reads `core.ttsEnabled` and calls `warmTts()` so voices are enumerated before first use (macOS WKWebView lazy-loads them).
- **6 new MCP tools** (21 total now):
  - `orion_create_mood_board(title, asset_ids?)` — DB insert + bulk membership; first added asset auto-becomes the cover.
  - `orion_add_to_mood_board(board_id, asset_id)` — idempotent insert, next-position auto-computed.
  - `orion_attach_tag(target_kind, target_id, tag)` — upsert tag row (lowercased, id = `tag-<name>`), insert into asset_tags/note_tags join table. Idempotent.
  - `orion_delete_note(id)` — straight DELETE; FTS5 triggers cascade automatically.
  - `orion_xdesign_add_ellipse(x, y, w, h, fill?)` — opens XDesign + adds ellipse shape.
  - `orion_xdesign_add_frame(x, y, w, h, fill?)` — adds layout-container frame with default border.
- **Cache invalidation extended**: new write-tool suffix lists `ORION_MOOD_WRITE_TOOL_SUFFIXES` and `ORION_ASSET_WRITE_TOOL_SUFFIXES` in EventBridge plus debounced scheduleMoodRefresh / scheduleAssetsRefresh that lazy-load the respective stores and trigger their `load()`. Notes refresh also catches `orion_delete_note` now.
- **Wake word deferred**: real wake-word detection means always-on mic + VAD + trigger-phrase model (Porcupine or similar). Half-baking it is worse than nothing. Saving for a dedicated turn with thought about CPU/battery tradeoffs.

### 2026-05-28 — Voice STT fixes: transformers env + bundled DevTools
- **Root cause was transformers' local-model probe**: `@xenova/transformers` defaults to `env.allowLocalModels = true`, which makes it try to fetch model files from paths relative to the page URL first. In Tauri's webview that lands on the custom protocol's catch-all → returns `index.html` → `JSON.parse('<!DOCTYPE...')` throws `Unrecognized token '<'`. Fixed by `env.allowLocalModels = false` so the library goes straight to the Hugging Face CDN.
- New shared `lib/transformersEnv.ts` configures the env once (memoized) and both `embeddings.ts` (semantic search) + `voiceTranscribe.ts` (Whisper STT) `await` it before their first pipeline load. Same fix benefits both surfaces — the embeddings backfill was almost certainly hitting the same bug silently on the bundled app.
- **DevTools enabled in production builds**: added `devtools` feature to the tauri Cargo dep so right-click → Inspect Element works in the bundled .app, not just `npm run tauri dev`. Critical for diagnosing webview-specific issues like the one above.
- **Defensive diagnostics added during debugging stay**: per-second peak-RMS log, full transformers stage timings, audio-track muted/label detection, blob-size sanity check. Stays in the codebase because the same kind of silent-fail can recur (codec mismatches, OS privacy resets, etc.) and now there's a clear paper trail.

### 2026-05-24 — Voice STT: menubar mic → Whisper → Core input
- **Voice store** (`src/store/voiceStore.ts`): state machine `idle | loading_model | requesting_mic | recording | transcribing | error`, live amplitude (0..1) for the menubar waveform, `toggle()` action. Lazy-imports the capture module so Whisper's chunk doesn't load until first use.
- **Audio capture** (`src/lib/voiceCapture.ts`): `navigator.mediaDevices.getUserMedia` for mic (with echoCancellation/noiseSuppression/autoGainControl), MediaRecorder for the audio blob, AnalyserNode driven from a `getByteTimeDomainData` RMS at 60Hz with exponential smoothing into the store's `amplitude`. Permission-denied surface clear text directing the user to System Settings → Privacy & Security → Microphone.
- **Whisper transcription** (`src/lib/voiceTranscribe.ts`): lazy-loads `Xenova/whisper-tiny.en` (quantized, ~40MB) via the existing `@xenova/transformers` dep. Decodes blob → 16kHz mono Float32Array via `AudioContext.decodeAudioData` and channel-mixdown, then runs through the ASR pipeline. Short clips (<100ms) treated as misfires and dropped.
- **Menubar waveform interactive**: was decorative-only, now a real button. Bars driven from real RMS amplitude during recording (via `--peak` CSS var), idle goes back to the ambient pseudo-random animation. State colors: cyan idle, magenta recording, dimmed during transcribe/model-load with a spinning mic icon. Tooltip explains current state.
- **`voice.toggle` command** + **⌘⇧V hotkey**. Click the waveform OR hit the chord — same flow.
- **Transcript routing**: on stop, opens Core (if not open), drops the text into the panel's input via a new `pendingInput` field on `coreClaudeStore` (input component watches + appends instead of replacing, so a half-typed message isn't clobbered). User reviews and hits Enter — no auto-send.
- **No new deps** — Whisper rides along on the transformers chunk already loaded by the semantic-search indexer. Bundle delta is ~25KB of glue code.

### 2026-05-24 — Tool blitz: context, search, assets, terminal, XDesign shapes (15 MCP tools)
- **Auto-expand tool chips while running**: chip stays open showing input + status during the agent's work, collapses to a compact pill once finished. Manual click toggle thereafter. Also strips `mcp__orion__` prefix in chip labels so they read as `orion_list_recent_notes`, not the full claude-side namespaced name.
- **Context snapshot pipeline**: new `mcp_config::context_snapshot_write` Tauri command + new `ORION_CONTEXT_PATH` env injected into the MCP subprocess. Frontend `lib/contextSnapshot.ts` subscribes to shell/project/workspace/archives stores and (300ms debounced) writes a JSON snapshot of "what the user is looking at" — focused app, active project, current Archives view, open file/note, list of open file tabs. Started in App.tsx hydrate.
- **`orion_get_context`** reads the snapshot file. Cheap, always-fresh enough — agent calls it before acting on phrases like "this file", "what I'm looking at", "summarize this note".
- **`orion_search_files`**: reads project root from the snapshot, walks the tree via `walkdir` (skips .git/node_modules/target/dist/build/.next/etc.), returns up to 30 case-insensitive substring hits relative to root.
- **`orion_list_assets`** + **`orion_search_assets`**: direct sqlite reads of `assets` (+ `asset_tags` join for tag search). Optional kind filter on list; query matches title, original_name, OR tag name for search.
- **`orion_run_in_terminal`**: bridge action → frontend opens Orion + Terminal tab → polls `useTerminalStore.ptyId` for up to 3s → `ipc.terminalWrite(ptyId, command + "\n")`. The user SEES the command run in their visible pty (differs from claude-code's Bash which is invisible).
- **`orion_xdesign_add_rect`** + **`orion_xdesign_add_text`**: bridge actions → frontend opens XDesign + calls `useXDesign.addShape(...)` with sensible defaults (neon-cyan fill, text shape auto-sized to content). XDesign opens automatically if not already.
- **15 MCP tools total now**: 6 read (recent_notes, search_archive, list_projects, get_context, search_files, list_assets, search_assets — that's 7 actually) + 6 write/UI (create_note, update_note, open_app, switch_project, open_file, run_in_terminal, xdesign_add_rect, xdesign_add_text — 8). All running on subscription via claude-code subprocess.

### 2026-05-24 — Core persistence + orion_open_file (8 MCP tools total)
- **Core conversations persist** to the `chats` table with `origin='core'`. Store gained `threadId`, `title` (auto-derived from first user message, capped at 80 chars), `createdAt`, `updatedAt`. `persistThread()` runs in the `claude:exit` handler after each completed turn — idempotent upsert on `chats.id` so multi-turn threads accumulate into one row, not many. Empty conversations (no user message yet) are skipped so Past Chats stays clean.
- **Boot resume**: `useCoreClaude.resumeLatest()` runs in App.tsx hydrate (lazy-imported). Pulls the newest `origin='core'` chat from `listAllChats(20)`, loads it via `loadThread()`. Rebuilds `toolCalls` map from persisted `tool_use` blocks so chips render with "ok" state (results aren't separately persisted — they're inline in the assistant content).
- **openChatById** routes `origin='core'` rows to `useCoreClaude.loadThread()` + `openPanel()` so Spotlight / Archives sidebar can resume a specific past Core conversation.
- **New `orion_open_file` MCP tool** + frontend handler. Resolves project-relative paths against the active project's root, opens Orion if not focused, calls `useWorkspace.openTab({kind:"file", path})`. 8 MCP tools total now (list_recent_notes / search_archive / list_projects / create_note / update_note_body / open_app / switch_project / open_file).
- **`newConversation` button** still creates a fresh threadId so the user can intentionally start over without losing the prior thread (which stays in DB, accessible via Spotlight).

### 2026-05-24 — Path B Phase 4.5: auto-navigate to the new note
- `orion_create_note` and `orion_update_note_body` now each send a follow-up `open_note` UI action (via the TCP bridge) immediately after the DB write. The agent doesn't have to chain a separate tool — one create call is enough for "create + show me".
- New `open_note` handler in `EventBridge.tsx`: re-hydrates `useNotesStore` (so the freshly-written row is in the in-memory map), opens Archives behind the Core overlay, then routes to the right view based on kind — `projects` view + `setOpenProjectId` for project pages, `journal` view + `setSelectedNoteId` for journal entries, `notes` view + `setOpenNoteId` otherwise. Kind comes from the MCP payload (known at create time, looked up at update time).
- Result: ask Core to "make a journal entry for today titled X" → Archives animates open behind Core, Journal view selected with the new entry already loaded. Close Core (esc/X) and you're already where you need to be.

### 2026-05-24 — Path B Phase 4: UI-state MCP tools via local TCP bridge (+ fixes)
- **claude_send `--mcp-config` variadic bug**: claude's flag is `--mcp-config <configs...>` — without a `--` sentinel before the positional prompt, clap was eating the prompt as another config path. Fixed: `cmd.arg("--"); cmd.arg(&prompt);`. Symptom was the "working…" indicator flashing for ~1s then vanishing because subprocess exited immediately with "MCP config file not found: <prompt text>".
- **Cache invalidation tool-name fix**: claude prefixes MCP tools as `mcp__<server>__<tool>` in `tool_use` blocks. My write-tool set was checking the bare names (`orion_create_note`) so the suffix-match never fired. Switched to `endsWith` over a list of bare names — now `mcp__orion__orion_create_note` matches and notes refresh within ~250ms of creation.
- **PATH augmentation for `claude_send`**: Tauri-packaged Mac apps get a stripped PATH from launchd. Now pre-pends `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.claude/local` before inheriting parent PATH.
- **90s watchdog + visible "working…" indicator + stderr surfacing** in Core so future silent failures aren't actually silent.
- **Local TCP bridge** (`ui_bridge.rs`): tokio listener on `127.0.0.1:0` (random port) accepts one JSON line per connection, validates a per-launch shared token, emits a Tauri `ui:action` event to the frontend. Started in the Tauri `setup` hook. Port + token published via `BRIDGE: OnceCell<BridgeInfo>` and injected into the MCP subprocess env by `mcp_config::write` (`ORION_BRIDGE_PORT`, `ORION_BRIDGE_TOKEN`).
- **Two new UI-state MCP tools**: `orion_open_app` (archives/orion/xdesign) and `orion_switch_project` (by exact name or id, fuzzy fallback in the frontend handler). Both connect to the bridge from the MCP subprocess via a tiny sync TCP client (no extra deps), send one JSON line, read one ack. Fire-and-forget — agent doesn't wait for UI completion.
- **Frontend handler** in `EventBridge.tsx`: subscribes to `ui:action`, dispatches `open_app` → `useShell.openApp`, `switch_project` → `useProjectStore.switchToProject` (with fuzzy name match against recents). Logs unknown kinds.
- **7 MCP tools total now**: list_recent_notes / search_archive / list_projects / create_note / update_note_body / open_app / switch_project. All running on subscription via claude-code subprocess.

### 2026-05-24 — Path B Phase 3: thinking blocks + write tools + cache invalidation
- **Thinking display in Core**: `coreClaudeStore`'s `CoreContentBlock` already accepts any block via its catch-all variant. `CoreClaude.tsx`'s `MessageBody` now renders blocks in their natural order — text + tool_use + `thinking`. Thinking blocks render via a new `ThinkingBlock` collapsed-by-default card (violet Brain icon, italic mono body, max-height + scroll). Tool chips are now expandable on click — input + result inline with mono pre formatting.
- **MCP write tools** (`mcp_server.rs`): added `orion_create_note(title, body?, kind?)` and `orion_update_note_body(id, body)`. Direct SQLite writes to `notes`; FTS5 triggers auto-update `search_index`. Bodies become BlockNote-compatible paragraph blocks with ulid block ids so the editor opens cleanly. Added `ulid` Rust dep to match the frontend's ulid format.
- **Cache invalidation** (`EventBridge.tsx`): new module-scope `toolUseIdToName: Map<string, string>` populated on every assistant `tool_use` block. When a `user` `tool_result` lands AND the corresponding tool name is in `ORION_NOTE_WRITE_TOOLS` AND `is_error` is false → `scheduleNotesRefresh()` (250ms debounced) reloads `useNotesStore` and updates `useArchives.setCounts.notes`. Works across all chat surfaces (Core, Orix47, Archives rail, XDesign rail) since it sits in the global event router.
- **Verified end-to-end**: piped MCP `orion_create_note` against the live DB — note created, FTS5 indexed it, on next launch UI shows it without intervention. Ask Core "make a note titled X with body Y" → claude calls the tool → note appears in Archives within ~250ms of tool completion.
- **Phase 4 still deferred**: UI-state tools (open_app, focus_window, switch_project) need a Tauri-side HTTP/socket bridge for the MCP server to call back into the running process. The current DB-direct pattern can't drive UI events.

### 2026-05-24 — Path B Phase 2: Core bridged to claude-code subprocess (subscription auth)
- **Migration 10 hydrate fix**: the original `CREATE TABLE IF NOT EXISTS embeddings` collided with a vestigial table from migration 3 (different schema — `entity_type / embedding / generated_at / source_hash`), causing index creation to fail on the missing `entity_kind` column. Rewrote 0010 as `DROP IF EXISTS + CREATE` since no real data ever lived in the legacy table (runtime writes were failing silently anyway). Verified against the user's live DB — schema is now correct, all 12 migrations marked success=1.
- **Shared MCP config helper** (`mcp_config.rs`): factored out of `terminal.rs` so both `claude_send` (chat rails + Core) and `terminal_open_claude` (Claude Code tab) share one impl. Every claude-code subprocess now gets the Orion MCP server registered automatically.
- **Core uses claude-code subprocess**: rewrote `coreClaudeStore.ts` to drop the Messages-API path entirely. `send(text)` now spawns a fresh claude-code via `ipc.claudeSend`, parses stream-json events (`system`/`assistant`/`user`/`result`/`stderr`), and resumes via `--resume <sessionId>` on subsequent turns. Tool execution runs inside claude-code via MCP — no more JS-side tool loop. System prompt inlined on the first turn (claude-code's session memory carries it forward).
- **Tool chips**: still render in the UI but now driven by `tool_use` blocks inside `assistant` events and resolved by `tool_result` blocks inside `user` events. The orion_* tools (list_recent_notes / search_archive / list_projects) appear in chips alongside any of claude-code's native tools the agent picks up (Bash/Read/Edit/Write/etc).
- **Side benefit**: the existing Orix47/Archives/XDesign chat rails ALSO get Orion-aware tools for free since they share `claude_send`. Asking the Archives rail "what notes have I been working on?" now actually queries the embeddings/FTS index instead of asking the model to remember.
- **Removed**: `src/features/coreClaude/tools.ts` (no longer needed), and the API-key requirement from Core. Subscription users can now click the orb / ⌘L and just ask.

### 2026-05-24 — Path B Phase 1: Orion MCP server for the Claude Code subprocess
- **Mode-switched binary**: `orion-terminal --mcp-serve` becomes a stdio MCP server instead of booting the Tauri UI. main.rs short-circuits on argv before falling through to `lib::run()`. Same binary, no second build target — sidesteps bundling complexity.
- **Protocol** (`src-tauri/src/mcp_server.rs`): hand-rolled JSON-RPC 2.0 over stdio per the MCP spec. Implements `initialize`, `notifications/initialized`, `tools/list`, `tools/call`. ~200 lines, zero new deps beyond `rusqlite = { features = ["bundled"] }` (bundled feature ships its own libsqlite3 so it can't collide with tauri-plugin-sql's sqlx-bundled sqlite).
- **3 read-only tools** in v1, all DB-backed (no IPC to the running Tauri process needed): `orion_list_recent_notes`, `orion_search_archive` (FTS5 with prefix matching), `orion_list_projects`. Fresh connection per call (cheap; SQLite WAL handles it).
- **Spawn integration** (`terminal_open_claude` in `terminal.rs`): on each Claude Code tab open, writes `<app_config_dir>/orion-mcp.json` pointing at `current_exe() --mcp-serve` with `ORION_DB_PATH` in the env, then passes `--mcp-config <path>` to the claude CLI. The user's other MCP servers stay active (no `--strict-mcp-config`).
- **Verified end-to-end**: piped MCP requests to the built binary against the user's actual `~/Library/Application Support/com.lucaorion.orion-terminal/orion.db` — initialize, tools/list, list_recent_notes, search_archive all returned real data. Claude Code in the Orion tab now sees Orion-aware tools alongside its native Bash/Read/Edit/Write toolset, **on subscription auth**, no API key burn.
- **Phase 2 deferred**: write tools (create_note, etc.) need cache-invalidation back to the running Tauri process; UI-state tools (open_app, focus_window) need a Unix socket / HTTP bridge. v1 read-only set proves the architecture works.

### 2026-05-24 — Core: agentic central AI with tool-use (the JARVIS thing)
- The dock orb went from decorative-only → cosmetic redirect to Claude Code → **summons Core**, a tool-using agent that drives the whole workstation. Click the orb or hit ⌘L. (⌘L reclaimed from `claude.newChat` which still exists in Spotlight as "New Chat in Orix47".)
- **Messages API + tool_use** (not the CLI subprocess — needed custom tool definitions): extended `messages_chat.rs` to accept a `tools` array, parse streaming `content_block_start` / `input_json_delta` / `content_block_stop` for `tool_use` blocks, emit a discrete `chat:tool_use` event with parsed input on stop. Also passes through `stop_reason` on `chat:done` so the frontend knows to loop. `ChatMessageInput.content` is now `serde_json::Value` so it accepts string text OR tool_result block arrays. Model defaults to `claude-opus-4-7`; cost heuristic adjusted (Opus: $15 in / $75 out per MTok).
- **Frontend tool loop** in `coreClaudeStore.ts`: sends user message → streams assistant content (text deltas → live; tool_use blocks → chips with `running` state). When `stop_reason === "tool_use"`, executes tools via `runTool` in `tools.ts`, builds a user message with `tool_result` blocks, re-enters the loop. Repeats until end_turn. Chips update to `ok` / `error` as results land.
- **7 starter tools** (`src/features/coreClaude/tools.ts`): `open_app`, `list_projects`, `switch_project`, `search_archive` (hits the hybrid FTS5+semantic engine), `create_note` (with kind: note/journal/project, opens the right Archives view), `open_file` (resolves project-relative paths, opens in Orion editor), `get_context` (snapshot of focused app/project/tab so Claude can answer "what's this?").
- **UI**: floating glass panel above the dock; centered; backdrop-blur; cyan-bordered. Empty state shows the orb + tagline + 4 example prompts. Bubbles distinguish user (cyan) vs assistant (neutral). Tool-use chips render inline below the assistant text, color-coded by state. Esc closes (when not running). System prompt is JARVIS-style terse with explicit "do it, don't describe it" guidance.

### 2026-05-24 — Cross-app DnD round 2: assets into NoteEditor + OrionEditor
- `NoteEditor` (BlockNote) accepts `ASSET_DRAG_MIME` drops. Images become inline `image` blocks (via `convertFileSrc` → `asset://` URL, caption seeded with asset title). Non-image kinds become a paragraph with an asset:// link styled as a regular link block. Inserted "after" the block at the current cursor.
- `OrionEditor` (Monaco) accepts the same MIME. Inserts a markdown snippet at the cursor — `![name](path)` for images, `[name](path)` for others. Uses the literal filesystem path so source survives copy/paste across files; the markdown preview tab resolves it via the asset:// protocol naturally.
- Both share the producer side from yesterday's chat-input DnD work — Archives Media tiles + Mood board tiles already publish the cross-app MIME. Drag once, drop into any of: ClaudeChat input, NoteEditor body, OrionEditor body.

### 2026-05-24 — Cross-app DnD: drag assets into any Claude rail
- New shared MIME constant `ASSET_DRAG_MIME = "application/x-orion-asset"` in `src/lib/dragMimes.ts` so producers and consumers don't drift.
- Archives Media tiles + Mood board tiles set this MIME on `dragstart` with the asset's absolute file path. Mood tiles dual-publish (existing `application/x-orion-board-tile` for in-board reorder + the new cross-app MIME) so neither flow breaks.
- `ClaudeChat` input region (shared by all three rails) is now a drop target. On drag-over with the asset MIME: cyan inset glow + `drag-over` class. On drop: appends `@<path>` to the textarea (with proper space handling so multiple assets concatenate cleanly). The CLI subprocess already understands `@<path>` from the auto-tag image-vision path — so dropped images flow through to Claude as real attachments on the next turn.
- Works in all three rails (Archives/Orion/XDesign) for free since they all render `ClaudeChat`. Editor + note targets are deferred — keep scope tight to chat for now.

### 2026-05-24 — Chat routing by origin (XDesign threads come back to XDesign)
- **Migration 0012**: `ALTER TABLE chats ADD COLUMN origin TEXT`. Nullable so legacy rows (pre-migration) are valid; routing treats `NULL` like `'archives'`. New `ChatOrigin` type: `"archives" | "orion" | "xdesign"`.
- `upsertChat` now writes `origin` and all three rails set it on every persist (Orion → 'orion', Archives → 'archives', XDesign → 'xdesign').
- `openChatById` rewritten to route by origin first, project_id second: orion-origin → `useChatStore` + open Orion's Claude tab; xdesign-origin → `useAppChat.threads.xdesign` + open XDesign; archives or null → `useAppChat.threads.archives` + open Archives. The 2026-05-14 follow-up note ("currently that branch opens Archives") is now closed.

### 2026-05-24 — Per-project workspace layouts
- **Migration 0011**: new `workspace_layouts(project_id PK, layout_json, focused_panel_id, updated_at)` table. No FK on project_id (we don't cascade-delete projects); stale rows are harmless. DB helpers `getWorkspaceLayout` / `setWorkspaceLayout` round-trip the JSON.
- New `useProjectScopedLayout` hook in `App.tsx` tracks the active project id. **Within a project**: workspace mutations are debounced (400ms) and written to that project's slot. **On project switch**: cancels pending debounce, synchronously flushes the prior layout to the OLD project's slot (so it's preserved exactly as it was), then loads the NEW project's layout (or falls back to `defaultOrionLayout` on first visit).
- **Hydrate on boot**: if `last_project_id` exists, per-project layout takes precedence over the legacy global `workspace.layout` app_state key. The global remains as a fallback for first-launch / no-project state, so nothing regresses for existing users.
- Side-effect from the prior multi-project switcher entry is closed: switching projects no longer carries the old project's file tabs across. Each project now remembers its own arrangement of file/terminal/claude-code/preview tabs.

### 2026-05-24 — Multi-project switcher (Spotlight + WelcomeOverlay)
- Extended `useProjectStore` with `recents: ProjectRow[]`, `loadRecents()` (reads `listProjects()` — already sorted last_opened_at DESC), and `switchToProject(p)` (bumps last_opened_at + persists + flips active). `openProjectAtPath` and `hydrateFromId` now also refresh recents.
- New `project.switch` command (⌘⇧O, group=File) refreshes recents and opens Spotlight. Spotlight gained a `project` entry kind: recent projects (excluding the active one) appear in a "Projects" section between Applications and Commands in the empty-query view, and are Fuse-rankable by name/path when typing. Cyan `Folder` icon to match the existing project-accent color.
- `WelcomeOverlay` returning-user state gained a row of quick-switch chips below the stats — up to 4 most-recent projects (excluding active), pill-shaped with cyan tinting; click switches and opens Orion. First-launch state unchanged.
- Side-effect: workspace tabs persist across project switch (the file-tree refreshes against the new cwd; old file tabs still hold paths from the previous project). Per-project workspace layouts is a separate, larger change — accepting the current behavior for v1.

### 2026-05-24 — Welcome overlay (wallpaper empty state) + CLAUDE.md state-of-truth refresh
- New `WelcomeOverlay` mounted in `Shell` between MenuBar and the windows layer. Renders only when no visible windows are open (minimized count as hidden). Centered glass card with: live time + greeting (morning/afternoon/evening/late-night by hour), the brief's "Ready when you are." tagline, ⌘K cyan kbd hint. Fades out via `.dim` while Spotlight is open. Mount-in animation 600ms cubic-bezier; respects `prefers-reduced-motion`.
- **Returning user**: stats footer pulls `countNotes` / `countAssets` / `listAllChats(1)` and shows active project name (cyan dot) + counts. **First launch** (all stats zero): expands into a welcome paragraph + 3 pill buttons that openApp into Archives/Orion/XDesign with their canonical neon accents. Auto-detects from stats so no state flag needed.
- **CLAUDE.md cleanup**: the "Still deferred / not started" list at the top was actively misleading — most items had shipped. Rewrote to reflect actual reality (XDesign Phase C done, semantic search live, Claude Code tab live, polish list shipped). New "Still deferred" only lists genuine gaps: voice STT, MCP UI, cross-app DnD, multi-project switcher, onboarding/welcome (just shipped), XDesign-origin chat routing. Migrations updated to 0001..0010.

### 2026-05-24 — Semantic search: real-time reindex on write
- New `scheduleReindex(kind, id, getText)` helper in `embeddingIndexer.ts` debounces per-(kind,id) by 2s and resolves the freshest text at fire time. Calls collapse cleanly during typing; the underlying `reindexEntity` is hash-aware so a no-op save (same text twice) skips the model run.
- Hooked into every canonical write path: notes (`saveBlocks` + `saveTitle`), chats (Orion + Archives + XDesign rails' debounced `upsertChat` callbacks), assets (`ingestBlobs` + `ingestPaths` + post-`runAutoTag` once tags arrive). Removed on delete via new `removeEntityEmbedding(kind, id)` from notes' and assets' `remove` paths.
- **Alignment fix**: backfill and save-path now produce identical indexable text for assets (title + original_name + tags). Previously the indexer's text included `url + metadata_json` while save-path used `tags` — the two would have thrashed each other re-embedding the same row on every search-then-edit. Indexer now joins against `listAllAssetTags()` so backfill and save use the same shape; hashes stabilize.
- New typed content (notes typed today, chats sent today, assets ingested today) now becomes semantically searchable within ~2s of the last keystroke — no more "indexed at next launch" gap.

### 2026-05-23 — Semantic search (local embeddings + hybrid blend with FTS5)
- **Local embeddings via `@xenova/transformers`** running in the WebView. Model: `Xenova/all-MiniLM-L6-v2` (quantized, 384-dim, L2-normalized). First call downloads ~25MB to IndexedDB; subsequent calls hit cache. ~30ms per text on a Mac. Falls back silently to FTS5-only when the model can't load (offline first launch).
- Package is dynamic-imported via `await import("@xenova/transformers")` so it lands in its own 824KB code-split chunk — main bundle is unchanged (2.49MB).
- **Migration 0010**: new `embeddings(entity_kind, entity_id, vector BLOB, text_hash, updated_at)` table with composite PK. Vectors stored as packed little-endian f32 bytes; `serializeVector` / `deserializeVector` round-trip Float32Array ↔ Uint8Array with explicit ArrayBuffer alignment (sqlite BLOBs aren't guaranteed 4-byte aligned).
- **Indexer** (`src/lib/embeddingIndexer.ts`): on boot, walks notes/chats/assets, hashes each entity's "indexable text" (notes: title+plaintext; chats: title+searchable_text; assets: title+original_name+url+metadata), compares against the stored hash, re-embeds only deltas. Per-task `setTimeout(0)` yield to keep the UI responsive. Fire-and-forget, never throws to the caller.
- **Hybrid search** (`src/lib/searchHybrid.ts`): runs FTS5 + semantic in parallel. FTS hits come first (keyword precision); semantic-only candidates with cosine ≥ 0.35 fill remaining slots, enriched with title + body excerpt from the canonical tables. Two consumers (Spotlight `>` mode unchanged, Archives sidebar search dropdown) swapped from `searchArchive` → `searchHybrid` — same `SearchHit` shape, no UI changes needed.
- `searchArchive` stays FTS-only as a building block. Boot scheduling deferred 1500ms past hydrate so model load doesn't compete with first paint. Real-time reindex-on-save is deferred — writes within a session get indexed at next launch (hash-aware indexer skips unchanged entities, so the next backfill is cheap).

### 2026-05-23 — Claude Code tab fixes: session persistence + suppress VS Code auto-install
- **Tab switch was killing Claude Code sessions.** Workspace only rendered the active tab; switching unmounted the panel, the cleanup called `terminalKill`, the pty died. Added a `persistent: (tab) => boolean` opt-in to `ContentRegistry`. Persistent inactive tabs stay mounted in their panel via absolute-positioned slots that use `visibility: hidden` + `pointer-events: none` (NOT `display: none` — visibility-hidden keeps layout, so xterm's ResizeObserver still fires when the panel-body changes size while the tab is offscreen).
- Orion registry marks `claude-code` and `terminal` as persistent — both pty-backed surfaces now survive tab switches. Other kinds (file/note/preview/etc.) keep mount-on-active behavior, so we don't pin Monaco/BlockNote in memory for inactive tabs.
- **Suppressed claude's "Error installing VS Code extension: ERR_STREAM_PREMATURE_CLOSE" warning.** Claude tries to auto-install `anthropic.claude-code` on first launch when it detects an IDE-like env; the install fails because `code` CLI isn't on PATH inside Orion. `terminal_open_claude` now sets `TERM_PROGRAM=OrionTerminal` so claude skips the install path entirely.

### 2026-05-23 — Pin Opus 4.7 + Claude Code as a tab in Orion
- `claude_send` now passes `--model claude-opus-4-7` so all three chat rails (Archives / Orion / XDesign) run Opus regardless of the user's CLI config. One-shot tagging + inline edits unchanged (Sonnet — speed-sensitive paths).
- New `terminal_open_claude` Rust command spawns `claude --model claude-opus-4-7` directly inside a portable-pty session (bypassing the user's shell). Refactored `terminal.rs` to share post-spawn wiring between regular shell + claude via `spawn_pty_with` helper. Registered alongside `terminal_open` in `lib.rs`.
- New `claude-code` tab kind in workspace (singleton, routes to terminal role). New `OrionClaudeCodePanel` mirrors `OrionTerminalPanel`'s xterm.js setup with a per-instance ulid pty id. Lucide `Bot` icon, violet accent.
- Command `view.openClaudeCode` (⌘⇧L) opens or focuses the tab — full interactive Claude Code TUI inside Orion. Falls back with a clear "is the claude CLI on PATH?" hint if spawn fails. `tsc`/`cargo check`/build/tests all clean.

### 2026-05-23 — Variables panel + mode switcher + ColorField var picker
- New `VariablesPanel.tsx` mounted between Pages and Layers in the left rail. Collapsed by default (caret toggle); `+` button creates and opens. Each row: live color swatch (native picker on click) + click-to-rename name + free-text value input + delete. Variables iterate on `activeModeId` so editing a value mutates only the current mode.
- Mode switcher is the row of violet pills at the top of the open panel. Click to switch active mode (Canvas re-resolves all `var:` refs on the spot). Double-click to rename. `+` adds a new mode (inherits values from the first existing mode so existing designs don't go null on switch). `×` deletes (last mode protected).
- ColorField popover gained a Variables section listing every variable as a row (resolved-color swatch + name). Click → writes `var:<id>` into the field. When the field already holds a `var:` ref, the swatch shows the resolved color with a violet inner ring, the text input shows `@<varname>` in violet, and a "Detach from variable" button replaces the ref with its current literal. Typing `@name` into the text input binds to a matching variable by name.
- All three surfaces share the neon-violet accent so variables visually distinct from frames/components/instances. CSS appended to `tokens.css` (xd-vars, xd-modes, xd-color-vars/-var-row/-detach).

### 2026-05-23 — Variables wired into render + persistence
- Canvas `displayShapes` memo composes auto-layout overrides with `resolveShapeVars(shape, variables, activeModeId)` so any `fill`/`stroke`/gradient-stop/shadow color stored as `var:<id>` resolves to the current-mode value at render time. Memo deps include `variables` and `activeModeId` — switching modes triggers a single re-render pass over all shapes. No-op fast path when `variables` is empty.
- Persistence: `useXDesignPersistence` write in `App.tsx` now includes `variables`, `modes`, `activeModeId` alongside `pages`/`activePageId`. Hydrate side already handled them. `AppStateKey` "xdesign.doc" type widened to the new doc shape. Inspector/LayersPanel still see the raw `var:<id>` strings (correct — editing should reference, not the resolved color).
- Still pending: variables panel UI, mode switcher, ColorField var picker.

### 2026-05-19 — Components + drag-reparent in layers + variables (partial)
- **Components** in xdesign store: `isMain` flag promotes any shape to a component template; `linkedMainId` marks an instance. Actions: `toggleMainComponent`, `createInstance` (deep-clone with fresh ids + horizontal offset), `syncFromMain` (replace instance subtree from main, preserve position), `detachInstance`. Simple copy-and-link — no per-property override tracking, sync overwrites the whole subtree.
- Inspector "Component" section adapts: regular shape → "Mark as main"; main → ✓ Main + + Instance; instance → Sync / Detach.
- LayersPanel: violet ◇ for mains + cyan ◆ for instances (name color tinted). Every row HTML5-draggable: drop on a frame → child, drop on another layer → sibling, drop on the "Layers" heading → root. Cycle-protected.
- **Variables + modes (partial)**: data model in store (`Variable`, `Mode`, addVariable/setVariableValue/addMode/setActiveMode), `resolveVar` + `resolveShapeVars` helpers added, hydrate + AppStateKey extended. **Not yet wired**: Canvas resolver pass on displayShapes, persistence write of variables/modes, variables panel UI, mode switcher, ColorField var picker. Pick up here next session.

### 2026-05-18 — XDesign Inspector: collapsible sections + density pass
- Rebuilt right sidebar with a generic `<Section>` wrapper (chevron header). 8 sections: Position, Appearance, Auto-layout (frame), Sizing (closed), Text (text only), Fill, Stroke, Effects (closed), Export (closed). Stroke advanced (dash/cap/join) is a nested collapsed Section.
- Header now reads `KIND • name` instead of generic "Properties".
- Density: labels 44px / 9px caps (was 64/10), inputs 11px (was 12), vertical gap 4px (was 8), mini-buttons 22×22, swatch 16×16. Frame with auto-layout fits without scroll in normal window sizes.

### 2026-05-17 — XDesign parity push: auto-layout, stroke align, text, gradients, export, pen curves, pages, group/ungroup
- **Auto-layout**: `layoutMode: none|horizontal|vertical` on frames + `itemSpacing` + 4 paddings + `primaryAxisAlign` (min/center/max/space-between) + `counterAxisAlign`. Per-shape `layoutSizingH/V` (fixed/hug/fill). `autoLayout.ts` computes a `Map<id, {x,y,w,h}>` of render-time overrides; nested AL frames lay out depth-first; FILL distributes remaining main-axis space.
- **Stroke alignment** (inside/center/outside): inside clips doubled-stroke shape to its own path; outside uses `paint-order: stroke fill`. **Text overhaul**: fontFamily, fontWeight, lineHeight, letterSpacing, textAlign, textCase, textDecoration. **Gradients**: radial + angular added (angular degrades to linear at start angle — SVG has no native conic). **Pen curves**: drag while placing anchor sets symmetric bezier handles.
- **Pages**: each page owns its own `shapes`. List in layers panel header (+ add, click switch, double-click rename, trash delete; last page non-deletable). Persists `{pages, activePageId}` to `app_state.xdesign.doc`.
- **Export PNG/SVG**: clones live SVG, strips overlays, resets viewBox to selection bbox (or all visible shapes); SVG download direct, PNG via canvas @2x.
- **Ergonomics**: ⌘G group-as-frame, ⌘⌥G ungroup, ⌘⇧] bring-to-front, ⌘⇧[ send-to-back, ⇧0 reset zoom, ⇧1 fit all, ⇧2 fit-selection.

### 2026-05-16 — XDesign opacity, visibility/lock, flip, individual corners, clip content
- Per-shape `opacity` (0–1), `hidden`, `locked`, `flipX`, `flipY`. Hidden/locked shapes pass clicks through to the canvas and are excluded from marquee. Flip composes with rotation via `translate cx cy scale ±1 translate -cx -cy` so both pivot the same center.
- **Constrain proportions on resize**: ⇧ during a corner-handle drag locks the start aspect ratio.
- **Per-corner radii** on rect/frame: `radii: [tl, tr, br, bl]` rendered as a custom path that clamps so opposite radii can't overlap. **Clip content** on frames: descendants render under a `<g clip-path>` while the frame's stroke/fill stay visible outside the clip.
- LayersPanel gains eye/lock toggles per row; Inspector's state row mirrors them.

### 2026-05-15 — XDesign Phase C: full design tool foundation + Claude command DSL
- Built `src/apps/xdesign/`: store (shapes, selection, tool, viewport, history, clipboard), Canvas (SVG renderer with smart guides + grid snap + marquee + 8 resize handles + rotation handle + arrow-nudge), LayersPanel (nested tree with frame indentation), Inspector (per-shape props), ToolRail (Select/Frame/Rect/Ellipse/Text/Pen/Image), magenta Claude rail (`XDesignClaudeRail`).
- Shape kinds: rect, ellipse, text, image, frame, path. Path points stored in unit space (0..1) and scaled to (w,h) via a wrapping `<g transform>`. Star geometry generated server-side from `addStar` command.
- Selection mechanics: ⇧/⌘ click + marquee, drag-resize (bbox-aware single + multi via per-shape relative geometry), rotation (single + group around bbox pivot). Pan (space/wheel/middle-mouse), zoom (⌘±, ⌘0, ⌘-wheel, pinch). Smart guides + snap-to-shape edges + grid snap (⌘⇧G), 80-step undo/redo, copy/cut/paste/duplicate.
- Fills: solid + linear gradient (N stops) + image fill (cover/contain, picked from Archives library). Stroke: width/dash/caps/joins. Effects: drop shadow + inner shadow + layer blur, all stackable via per-shape SVG `<filter>` chain.
- **Claude command DSL** (`claudeCommands.ts`): `<canvas-command>` JSON tags in chat replies; runner applies as one history batch. System prompt teaches recipes: glass / chrome / neon / soft-card. Canvas summary with layer ids sent each turn so Claude can target shapes for update/delete.

### 2026-05-14 — Polish batch: wallpaper customization + dock toggle + preview tab + past chats + ⌘/ + multi-select + drag-reparent projects + live tree + voice waveform
- **Custom wallpaper** with 3 overlays (aurora / matrix-katakana / stars). Rust command `wallpaper_store_file` copies to `$APPDATA/wallpapers/<id>.<ext>`; asset-protocol scope extended. Settings → Wallpaper has a 3-tile picker + intensity slider.
- **Dock click toggles minimize** when the app's window is already focused. Aurora overlay fixed (blur + screen blend mode + boosted opacity + bigger drift).
- **Preview tab in Orion** wired: markdown mode (live-reads active `.md` file from `tabsStore.fileBuffers`, falls back to disk; pin button locks a file) + web mode (iframe + URL bar + refresh + open-in-browser). Persists to `app_state.preview`.
- **Past chats view** in Archives + Today "View all". Archives chats now persist to the `chats` table (debounced 600ms, project_id null); `openChatById` routes Orion threads to Orion's Claude tab and Archives threads back to Archives.
- **⌘/ keybindings overlay** (searchable, grouped, animated, reads registry). **Multi-select in Media + Mood detail** (⌘/⇧ click + marquee) with bulk Delete / Add-to-board / Remove-from-board; new `PickBoardModal`.
- **Drag re-parent project subpages**, **live file tree refresh on Write/Edit/MultiEdit tool_result** (via `useFileTreeRefresh` bumped from EventBridge when a file-modifying tool's `is_error` is false), **menubar voice waveform** (12 cyan bars with CSS keyframes; visual only, no audio).

### 2026-05-14 — Animations: aurora drift, window mount-in, dock magnify
- **Aurora drift**: three CSS keyframes (`ot-aurora-drift-a/b/c`) move the three wallpaper blobs on `infinite alternate` loops at 28s / 34s / 40s — different periods so they never sync. Opacity breathes alongside. `will-change: transform, opacity` keeps them on the compositor.
- **Window mount-in**: `.ot-window` runs `ot-window-in` (220ms cubic-bezier 0.2,0,0,1) on mount — opacity 0→1, scale 0.94→1, translateY 10→0. Subtle, not bouncy. Touches only `transform`/`opacity` so it doesn't fight the inline `left/top/width/height`.
- **Dock magnify**: cursor X tracked on `mousemove`, each `DockTile` measures its own center each frame and applies a cosine-falloff scale (1.0 → 1.55 over a 110px radius) + proportional lift. When the cursor leaves the dock zone, tiles ease back to scale 1 in 0.25s. Replaces the old `:hover { scale 1.08 }` CSS rule.
- `prefers-reduced-motion: reduce` disables aurora drift + mount-in and reverts the dock to the static hover lift.
- No new deps — pure CSS + a tiny mousemove listener.

### 2026-05-14 — Window state persistence across launches
- `useShell.restoreWindows(windows, focusedId)` bulk-loads positions/sizes/maximized/minimized/z from `app_state.shell.windows` and `shell.focusedWindowId`. Clamps each window against the current viewport (min 480×320, max viewport − chrome) so a window saved on a bigger display doesn't end up partially off-screen.
- `useShellWindowsPersistence` (new hook in `App.tsx`) subscribes to the shell store and writes the whole window array + focused id to app_state on every mutation, debounced 400ms so drags don't thrash sqlite.
- Hydrate order: if `shell.windows` exists with rows, restore as-is. If empty / first launch, fall back to the existing "auto-open Orion when a project exists" default.
- Brief originally pinned this as Phase C; happy to ship early since the workspace + collections + tags all benefit from "returns to where I left it" continuity.

### 2026-05-14 — Settings panel rewrite (4 sections, neo-Tokyo glass)
- Old `SettingsPanel` was a single API-key Tailwind card. Rewrote as a full settings modal with a 200px left nav and four sections:
  - **API Key**: keychain status dot (green when set), masked input with show/hide eye toggle, Save/Clear, link to console.anthropic.com.
  - **Appearance**: Dark / Light radio backed by `useThemeStore`. (Light is wired but most surfaces are dark-tuned — disclaimer in copy.)
  - **Shortcuts**: live read-only list of every command with a hotkey, grouped, with `⌘⇧S` / `⌥→` formatting. Subscribed to the registry via `useSyncExternalStore` so newly-registered commands appear without reload.
  - **About**: bundle id, app data dir, db path, stack note.
- Esc + click-outside close. Glass overlay with `backdrop-filter: blur(10px)`. Same `⌘,` and `settings.open` command entry points — no API change.

### 2026-05-14 — "New X" commands deep-link into Archives
- `note.new` (⌘N) used to dump the new note into Orion's workspace as a tab. Now opens Archives, switches to Notes view, and sets `openNoteId` so the new note shows in detail mode immediately.
- Added three siblings to the registry: `note.newJournal`, `note.newProject`, `mood.newBoard`. Each creates the entity, opens Archives, switches to the right view, and selects the new item. All ⌘K-discoverable. Status bar shows a brief `[ NEW … ]` hint.
- Pattern works the same way for any future create command: pass `kind` to `useNotesStore.create`, call `useShell.openApp("archives")`, then set the view + the corresponding `useArchives` selection id.

### 2026-05-14 — Chat deep-link + Spotlight Archive integration + image-vision tags
- New `src/apps/archives/searchNav.ts` exports `routeToSearchHit(hit)` and `openChatById(chatId)`. Both `SidebarSearch` and Spotlight (⌘K) call the shared helper, so "opening" each entity kind stays consistent.
- `openChatById`: loads the row via `getChatById`, parses `messages_json`, hydrates `useChatStore.setActive`, opens the Orion window, and opens the Claude tab. Chats in search results now route to the real conversation instead of bouncing to Today.
- Spotlight: new `archive` entry kind. Live FTS5 query runs on every keystroke (120ms debounce, race-safe). Archive hits render with the `Archive` icon and a dedicated "Archive" section heading, ordered above fuzzy hits since FTS rank is more authoritative for content queries. `>` commands-only mode unchanged.
- New Rust command `claude_oneshot_with_image(prompt, image_path)` mirrors `claude_oneshot` but appends an `@<path>` attachment so the CLI streams the actual image to Claude. Empty image_path falls back to the text-only variant.
- `runAutoTag` branches on `asset.kind === "image"`: image kind goes through `claudeOneshotWithImage` with a vision-tailored prompt ("dominant subject, mood, or visual style"); everything else stays on the metadata-only path. Vision failures degrade silently to untagged.

### 2026-05-14 — Archives sidebar search (FTS5 + route-to-entity)
- New DB helper `searchArchive(query, limit)` runs an FTS5 MATCH against `search_index` (notes/chats/assets), uses `snippet()` with custom delimiters (`〔〕`), and `LEFT JOIN notes` to pull `kind` so results can route to the right Archives view. Input is sanitized (strips FTS5 syntax chars) and each term gets a `*` suffix for prefix matching — typing "ori" finds "orion".
- `useArchives` gained `searchQuery`, `openNoteId` (lifted from `Notes.tsx`), and pre-existing setters for project/journal/preview ids. Notes view now reads `openNoteId` from the store instead of local state.
- New `SidebarSearch` component (`src/apps/archives/SidebarSearch.tsx`):
  - Controlled input wired to `useArchives.searchQuery` with a 140ms debounce + race-safe cancellation.
  - Dropdown of hits with icon + title + highlighted snippet (`〔〕` → `<mark>` via a tiny escape-then-replace pass) + kind label.
  - Click a result → `routeToHit`: assets open the preview modal, notes/journal/projects land in the right view with the appropriate id selected; chats fall back to Today for now (deep-link wiring deferred).
- Clear (X) on the input wipes both the query and the dropdown. Esc inside the input clears too.

### 2026-05-14 — Tag filter (Media + Notes) + manual note tagging
- DB helpers added: `listAllNoteTags()` (returns `Map<noteId, string[]>`), `attachNoteTags(noteId, tagIds[])`, `detachNoteTagByName(noteId, tagName)`. Note tags use the existing `tags` + `note_tags` tables (from migrations 0001 + 0003).
- `Note` type gained `tags: string[]`. `notesStore.load()` now fetches all note-tag joins in parallel and seeds the map. New store actions `addTag(id, name)` and `removeTag(id, name)` — upserts the tag row, attaches via join, updates in-memory.
- `NoteTagsRow` component sits in `.ar-note-meta-bar` next to the collection chip on Projects pages, Journal entries, and Notes detail. Existing tags show as violet pills with an inline remove (X). Click "add tag" to type — Enter or comma commits; Backspace on empty input removes the last tag; Escape cancels. Input normalizes to lowercase + hyphenated.
- Sidebar tag clicks now actually filter:
  - **Media** view: only assets where `tags` includes the selected tag. Active-filter banner above the toolbar with a "clear" button.
  - **Notes** view: combined with collection + search filters.
- Sidebar tag counts auto-update when notes are tagged (the SidebarTags effect re-runs when `assets` map identity changes; for note-only tagging, the count refreshes the next time the sidebar re-renders — collections sweep or other store mutations trigger it).

### 2026-05-14 — Real Collections + sidebar Tags
- Migration 0009: `collections (id, name, color, created_at, updated_at)` + `notes.collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL`. Indexes on `collections.updated_at DESC` and `notes.collection_id`.
- New `useCollectionsStore`: load/create/rename/setColor/remove + `COLLECTION_PALETTE` (5 neons).
- `notesStore.Note` gained `collectionId: string | null`. New action `saveCollection(id, collectionId)` writes through `setNoteCollection`. `rowToNote` and `create` thread the field. `insertNote` SQL includes the column.
- `useArchives` gained `selectedCollectionId` and `selectedTag` filter state.
- Sidebar got two real components:
  - `SidebarCollections`: "+" button creates inline; each row has a swatch (click → color picker pop), label (double-click → rename), and a trash icon. "All collections" pseudo-entry clears the filter. Deleting a collection sweeps in-memory notes so their `collectionId` clears immediately (matches the DB `SET NULL`).
  - `SidebarTags`: pulls top 20 tags from the DB (joins `asset_tags` + `note_tags` counts), shows them as clickable pills with their item count, click toggles `selectedTag`. Empty state when no tags exist yet.
- Filters wired in **Projects** (only roots in the selected collection — subpages still visible), **Notes** (kind=note + collection filter + search), **Journal** (kind=journal + collection filter).
- New `NoteCollectionChip` component renders on the editor surface (Projects pages, Journal entries, Notes detail) — dropdown to assign/uncollect. Chip color tracks the assigned collection via `color-mix()`.
- New `.ar-note-meta-bar` CSS — max-width 1180 + padding matches the title row so the chip lines up with the title left-edge inside the Apple-glass page.

### 2026-05-14 — Archives Projects (Notion-style nested pages)
- New `NoteKind` value `"project"` (no migration — kind is a free-text TEXT column with default 'note', so adding a value is purely TS-side).
- New `ArchivesView` value `"projects"` between Journal and Notes, with a `FolderKanban` icon.
- `useArchives` gained `openProjectId` (selected project page) and `expandedProjectIds: Set<string>` (which tree rows are expanded). `toggleProjectExpanded(id)` toggles a row open/closed.
- New `ArchivesProjects` view (`src/apps/archives/Projects.tsx`): left rail with a recursive page tree, right pane embeds `NoteEditor` inside the `.note-page` Apple-glass scope for the selected page.
- Tree mechanics:
  - Build once per render: `buildProjectTree` groups all `kind='project'` notes by `parent_id` (O(n)).
  - "+ New project" creates a root page (`parent_id = NULL, kind = 'project'`) and opens it.
  - "+" on each row creates a subpage with `parent_id = <row id>`, auto-expanding the parent and selecting the new page.
  - Delete cascades manually (leaves-first) since `notes.parent_id` has no `ON DELETE CASCADE`. After deletion, the editor falls back to the first remaining root, or shows empty state.
  - Sort within each parent: most-recently-updated first.
- Existing Notes (kind='note') and Journal (kind='journal') filters unchanged, so Projects is fully orthogonal — nothing shows up in two places.

### 2026-05-14 — Resizable windows + responsive content
- `WindowFrame` now renders 8 invisible resize handles (4 edges + 4 corners) when the window isn't maximized. North/west edges keep the opposite edge fixed (Mac-style); south/east just grow. Min size 480×320 enforced; north handle won't slide the titlebar under the menubar.
- Handle z-indices: handles at 12, titlebar traffic-lights/tools at 14 — clicks on the close/min/max buttons + ⌘K hint still beat the resize zone in the corners.
- `.ot-window-body` got `min-width: 0` + `overflow: hidden` so child app shells (Orion workspace, Archives panels, XDesign) can shrink past their natural width and use their own internal scroll containers instead of overflowing the window.
- `.xd-shell` gained `min-width: 0` + `overflow: auto` — XDesign's fixed-width side panels now scroll horizontally if the window is squeezed below their combined width.
- Orion (`.or-app`) and Archives (`.ar-shell`) already had `min-width: 0`. Verified inside `react-resizable-panels` containers reflow correctly at small widths.

### 2026-05-14 — Week-read + drag-reorder within boards
- Today's "Claude's read of your week" card is real now. Sends a metadata-only prompt (last 8 notes + last 8 chat titles with short previews) via `ipc.claudeOneshot`. Reply caches in `app_state` under `today.weekRead` with a `generatedAt` timestamp; auto-regenerates after 24h or via the Regenerate button. Includes loading spinner, generated-at stamp, error footer.
- Mood Board tiles are HTML5-draggable. Drag a tile onto another tile → reorders. State is optimistic (in-memory snap, persist after). DB layer gets `reorderMoodBoardAssets(boardId, ordered)` which rewrites every `position` in a single transaction (BEGIN/COMMIT/ROLLBACK) so a partial write can't desync the table.
- New MIME `application/x-orion-board-tile` keeps the reorder DnD from interfering with native Finder drops (which still route through Tauri's `onDragDropEvent` and skip the board MIME check).
- Drag visual: source tile drops to 40% opacity; hover target gets a magenta outline + glow.

### 2026-05-14 — Mood Boards rebuilt as first-class entities (Pinterest/Are.na-style)
- Migration 0008: `mood_boards` (id, title, cover_asset_id, created_at, updated_at) + `mood_board_assets` (board_id, asset_id, position, added_at). Cover gets `ON DELETE SET NULL` so deleting an asset just clears the cover, not the board.
- DB helpers in `db.ts`: `listMoodBoards`, `insertMoodBoard`, `renameMoodBoard`, `setMoodBoardCover`, `deleteMoodBoard`, `listAllMoodBoardMembers`, `addAssetToMoodBoard`, `removeAssetFromMoodBoard`. Position auto-increments on add (new members fall to the end).
- New `useMoodBoardsStore` (`src/store/moodBoardsStore.ts`): boards map + members map keyed by board id. Actions: create/rename/setCover/remove/addAsset/removeAsset. Auto-picks the first added asset as the board cover so the list view has a thumb without user intervention.
- `useArchives.openBoardId` controls list-vs-detail in the Mood view.
- **Mood list** (`<MoodBoardList>`): grid of board cards with cover image/video, item count, relative timestamp. "New board" CTA inline-creates with an autofocus input.
- **Mood detail** (`<MoodBoardDetail>`): rename-on-click title, item count, "Add asset" picker button, delete-board confirm. Masonry of tiles supports all asset kinds (image: img, video: poster-frame `<video>`, audio/doc/other: kind icon card). Each tile click opens the existing `AssetPreviewModal`. Tile hover reveals a remove-from-board button (X). Drag-drop into the detail view ingests the file via `ingestBlobs` AND adds it to this board.
- **Asset picker** modal: filterable grid of all existing assets, excludes assets already on the board, click-to-add. Esc + click-outside close.
- Old single-view masonry "all images + tag filter" Mood implementation deleted in favor of the new flow.

### 2026-05-14 — Auto-tags + clipboard paste + Mood Boards
- New Rust command `claude_oneshot(prompt)` in `claude_cli.rs`. Spawns `claude --print --output-format text` (no tools, no permissions flag, no session), captures stdout, returns the assistant reply as a string. Same subscription auth as `claude_send`. Background work surface.
- DB tag helpers in `db.ts`: `upsertTagsByName`, `attachAssetTags`, `listAssetTags`, `listAllAssetTags`. Tag table from migration 0001 was unused — wired now.
- `useAssetsStore` ingestion paths (`ingestPaths` + new `ingestBlobs`) fire `runAutoTag` async after insert. Tagging prompt is metadata-only for v1 (filename + kind + mime + size). Reply is parsed strictly: first line, comma-split, lowercase, single-word/hyphenated, max 3, max 24 chars each. Failures log and clear the spinner. `taggingIds: Set<string>` drives a shimmer placeholder on cards while tags resolve.
- Tags surface in the Media card meta row + the preview modal header, both styled as small violet mono pills.
- New Rust command `asset_store_bytes(bytes, suggested_name, mime_type_hint)` for clipboard paste. Writes bytes to the same `$APPDATA/assets/` dir; derives extension from filename or MIME hint. `useAssetsStore.ingestBlobs(blobs)` wraps it. Archives `useEffect` registers a window `paste` listener that pulls `File` items out of `clipboardData.items` and ingests them — ⌘V an image from anywhere captures it.
- Archives **Mood Boards** view: masonry of `image`-kind assets (CSS `column-count` 4/3/2/1 responsive). Tag filter row shows the top 12 most-frequent tags. Tile hover reveals a name + top-3 tags overlay. Click → opens `AssetPreviewModal`. Empty state CTAs walk the user to drop or paste.

### 2026-05-14 — Phase B step 2: asset ingest + Media view
- Migration 0007: `assets` table picks up `mime_type / size_bytes / original_name` columns + indexes on `created_at DESC` and `kind`.
- New Rust module `src-tauri/src/asset.rs`. Commands:
  - `asset_store_file(source_path)` copies the host-side file into `$APPDATA/<bundle>/assets/<id>.<ext>`, classifies kind by ext+mime, returns metadata to the frontend (which then inserts the DB row via the SQL plugin). No content-addressing yet — duplicate drops create two assets.
  - `asset_delete_file(file_path)` idempotent unlink for clean removal.
- `tauri.conf.json` enables the asset protocol with scope `$APPDATA/assets/**` + `$APPDATA/com.lucaorion.orion-terminal/assets/**`, so the frontend can use `convertFileSrc(filePath)` to render thumbnails without round-tripping bytes through IPC.
- `useAssetsStore`: in-memory map keyed by id, `load()`/`ingestPaths()`/`remove()`. App hydrate calls `load()`.
- Drag-drop wired at the Archives level via `getCurrentWebview().onDragDropEvent`. Drag-over shows a cyan dashed overlay; drop calls `ingestPaths` for every file path; leave clears it. Drops fire app-wide but the listener only mounts when Archives is open — drops while Archives is closed are no-ops.
- Archives **Media** view: kind-filtered grid (All / Images / Video / Audio / Docs / Other), real image thumbnails via `asset://`, kind icons for non-images, hover-to-show delete. Empty state walks user to drag a file.
- Today's "Captured today" card now reads real `todaysAssets` (filtered to `createdAt >= startOfDay`). Empty state CTA routes to Media; populated state renders 4 mini thumbnails that also route to Media on click.

### 2026-05-14 — Notes/Journal split + journal entry metadata
- Notes and Journal are now separate surfaces backed by a `kind` column on the `notes` table (migration 0005, `'note' | 'journal'`, default `'note'`). Existing rows backfill as `note`.
- Notes view became self-contained: clicking a card opens that note INSIDE Notes (back arrow + breadcrumb + delete in a sub-toolbar). No longer routes through Journal.
- Journal entries get a metadata banner above the title: long-form date, tabular-num time, and an Apple-blue location chip (free-text, Enter/blur saves, Esc cancels). Stored via new `location` column (migration 0006, NOT NULL default `''`).
- `notesStore.load()` hardened — wraps `listNotes()` in try/catch and always flips `loaded=true`. Previous failure mode left Journal stuck on "Loading notes…" forever; now it falls through to the empty state. Journal's gate also softened to `!loaded && notes.size === 0` so a partially-populated store still renders.
- New store action: `saveLocation(id, location)`. Mirrors `saveTitle` — patches the row, bumps `updated_at`, no walker needed.

### 2026-05-14 — Archives panels resizable + Apple-glass note page
- Archives shell rebuilt on `react-resizable-panels`: sidebar (collapsible, default 18%, min 14%, max 32%), main (flex), claude rail (collapsible, default 24%, min 16%, max 44%). Sizes persist via `autoSaveId="archives-shell"`. Resize handles only render when their adjacent panel is open.
- Two new toolbar toggle buttons (left-edge + right-edge icons from lucide) collapse/expand the sidebar and the claude rail. Hidden side gets no resize handle, so the layout reflows cleanly.
- `NoteEditor` decoupled from inline Tailwind colors. New base classes: `.note-editor-root`, `.note-editor-title`, `.note-editor-container`, `.note-editor-body`. Used unchanged inside Orion's workspace (inherits the neo-Tokyo theme).
- New `.note-page` scope applies an Apple-glass treatment to the note editing surface only: dark mesh gradient background, SF Pro / SF Mono typography, 36px weight-800 title, max-width 820px glass card with `backdrop-filter: blur(40px) saturate(1.2)`, Apple-blue accents (#007AFF), pink inline code, Notion-style heading scale. Applied to Archives Journal's editor pane via class composition.
- The chrome stays neo-Tokyo; only the editing surface ("the page") shifts to Apple glass. Conceptually: workstation outside, page inside.

### 2026-05-14 — Note editor wired into Orion + Archives Notes/Journal
- `NoteEditor` (BlockNote, already built in Phase 3 but unwired) now renders inside Orion's workspace via the content registry — note tabs show a real editor instead of empty panels. Tab labels mirror the note title, dirty dot shows pending writes.
- Archives **Notes** view: 2-col card grid of all notes sorted by `updatedAt`, with title, plaintext preview, relative-time stamp, search filter, and "New note" CTA. Clicking a card routes into Journal view with that note selected.
- Archives **Journal** view: 240px left rail listing all entries (title + timestamp + dirty dot), main pane embeds `NoteEditor` for the selected note. Empty state walks the user into creating their first entry. "+" in the rail header creates a new entry.
- Archives' "start a new entry" / "today's journal" CTAs in Today now actually create a note and route to Journal. Note creation in Archives goes straight via `useNotesStore.create` instead of routing through the global `note.new` command (which also opens a tab in Orion's workspace — surprising for Archives flow).
- `useArchives` gained `selectedNoteId` for the Journal view's open-note state. `notesStore.Note` gained `plaintext` (set on `rowToNote`, `create`, `saveBlocks`) so card previews work without walking blocks at render time.

### 2026-05-14 — Archives Today view + view router
- New `useArchives` store holds the active view (`today | journal | notes | mood | media`) and cached counts (notes, chats, assets) shared by the sidebar badges and rail subtitle.
- Sidebar rewritten as real buttons routing to `useArchives.setView`. New toolbar above the main area renders the breadcrumb `Archives 47 / <view>` plus share/star/new/more affordances.
- `Today.tsx`: hero greeting (date + time-of-day salutation + a pull-quote), 2-column grid with five cards:
  - Today's journal (notes updated since midnight) — CTA to start journal view if empty.
  - Recent threads — pulled from `listAllChats` (Orion + Archives chats), tagged by origin.
  - Captured today — 4-tile placeholder (asset ingest deferred).
  - On this day, last year — shows a real note if any from the same day/month a year ago, otherwise hidden.
  - Claude's read of your week — deterministic synthesis of recent notes/chats; a real summarizer call lands when the one-shot CLI helper is wired.
- Footer with mono stats (Notes / Chats / Media / Streak). Rail subtitle now shows real `indexed · N notes · N threads` from the live counts.
- Other views (Journal / Notes / Mood / Media) render `ViewStub` placeholders for now — view router is wired so they slot in cleanly.
- `notesStore.Note` gained a `plaintext` field so cards/previews don't need to walk blocks at render time. `rowToNote`, `create`, and `saveBlocks` updated to keep it in sync.
- DB helpers: `listAllChats(limit)`, `countNotes()`, `countAssets()` for the new dashboard data.

### 2026-05-14 — Archives swapped from Messages API to CLI subscription
- Goal: avoid requiring a separate Anthropic API key for Archives — reuse the same Claude CLI subscription path Orion uses.
- Rust: `claude_send` now accepts `project_root: Option<String>` and falls back to `$HOME` when omitted. No other behavior changes; the CLI just needs a valid cwd.
- Frontend: `useAppChat` gained `sessionId` per thread, `setAssistantContent` (snapshot replace — the CLI emits full message snapshots per event, not deltas), and `setSessionId`. EventBridge routes `claude:event` and `claude:exit` to `useAppChat` first via the `streamId → app` registry; falls back to `useChatStore` (Orion) when no app owns the chatId.
- Archives' `handleSend` now calls `ipc.claudeSend(threadId, prompt, null, sessionId)`. First turn prepends the Archives system prompt to the user message; subsequent turns rely on `--resume` to keep context.
- `messages_chat_run` Rust command + `ipc.messagesChatRun` stay in tree for future API-only flows (e.g., a Messages-API toggle in settings if we want it).

### 2026-05-14 — Phase B step 1: real Messages-API chat for Archives
- New Rust module `src-tauri/src/messages_chat.rs` — streaming Messages-API chat. Commands `messages_chat_run(chat_id, system, messages)` and `messages_chat_cancel(chat_id)`. Events `chat:delta`, `chat:done`, `chat:error` keyed by `chatId`. Same SSE-parsing skeleton as `inline_edit.rs`; different shape (full message history in, streamed assistant reply out, no tools). Estimated cost from `message_delta` usage (Sonnet 4.5 pricing).
- Frontend `useAppChat` store (`src/store/appChatStore.ts`) holds per-app threads (`archives | orion | xdesign`) with running state, pending assistant id, active streamId, total cost, error. Replaces the old `stubChatStore` (deleted).
- `EventBridge` routes `chat:*` events to the right app via a `streamId → appId` registry. StreamId is **per-turn** (new ulid each send), so cancelling one turn never collides with the next.
- Archives ClaudeChat wired end-to-end: green accent, real conversation, cancel mid-stream via the running button, cost displayed in the rail footer. Opens API key dialog if no key set.
- XDesign chat rail still deferred — Phase A brief explicitly says it's a Phase C deliverable (floating Claude over the canvas, magenta accent). Infrastructure is in place; just needs the UI hookup when XDesign content lands.

### 2026-05-14 — Dockable workspace (Phase 1.5)
- Replaced Orion's fixed 5-panel layout with a generic dockable workspace under `src/components/workspace/`. Layout is a tree of `LayoutSplit` and `LayoutPanel` nodes; each panel holds a stack of tabs. Panels are resizable via `react-resizable-panels` and tabs are draggable between panels (HTML5 DnD).
- Drag a tab onto another panel's tab strip → it joins that panel. Drag onto a panel's edge (top / right / bottom / left, within 22% of the bounds) → splits the panel and creates a new sibling panel. Drag preview highlights the target zone in cyan.
- Five tab kinds in Orion: `files-tree`, `preview`, `claude` (Orix47), `terminal`, `file`. A user can have multiple files open in the same panel as before, or split editors across panels — opening a file from Spotlight goes into the currently-focused panel.
- `tabsStore` slimmed to file-buffer management only (contents, original, loaded, dirty). All tab-container logic (open/close/setActive/cycle/setLabel) moved into `useWorkspace`. Buffer is shared across panels — open the same file twice, edit in one, the other sees the change live.
- Layout persists in `app_state` under `workspace.layout` + `workspace.focusedPanel`. On hydrate, file tabs whose paths no longer exist are pruned, and empty panels/splits collapse automatically.
- Removed: `src/apps/orion/TabStrip.tsx` (panel tab strip is generic now), the fake `dev / build / tests` terminal-bar tabs, the fixed-width `OrionTerminalShell` wrapper. Old fixed Tailwind columns kept as `.or-files` / `.or-terminal-wrap` for back-compat but unused.
- New commands: `view.openPreview`, `view.openFilesTree`, `view.openTerminal`, `view.openClaude`, `view.resetLayout`. `terminal.toggle` (⌘`) now opens the terminal as a tab (activating if already open).
- Rename: `Code Companion` → `Orix47` in the rail header and window subtitle.

### 2026-05-14 — Migration 3 checksum repair
- First post-Phase-A launch hit `hydrate failed: migration 3 was previously applied but has been modified`. Symptom: clicking "Open Folder…" did nothing — DB init had failed and every IPC awaiting `getDb()` silently hung.
- Root cause is pre-existing: Week 3 work edited `0003_search_and_notes.sql` in place (Apr 30 04:50) before adding `0004_fix_search_triggers.sql` a minute later. `tauri-plugin-sql` stores SHA-384 in `_sqlx_migrations`; the stored hash for v3 still matched the *original* file. v4 had never run on this DB.
- Fix: surgical update of the stored checksum to SHA-384 of the current `0003` file content. `_sqlx_migrations` row for v3 patched in place; data preserved (3 projects, 3 chats, 1 note). v4 runs cleanly on next launch (its triggers use `DROP/CREATE IF EXISTS` + idempotent dedupe).
- Reproduce later if needed: `shasum -a 384 src-tauri/migrations/000N_*.sql` → `UPDATE _sqlx_migrations SET checksum = x'...' WHERE version = N` against `~/Library/Application Support/com.lucaorion.orion-terminal/orion.db`.

### 2026-05-14 — Phase A complete
- All 8 build-order steps shipped (tokens, shell, window mgr, ClaudeChat, Orion app, Archives/XDesign stubs, Spotlight, audit).
- `tsc --noEmit` clean, `npm test` 19/19 pass, `npm run build` succeeds in ~2.7s.
- Deleted orphaned old-architecture files: `src/app/Layout.tsx`, `src/features/palette/`, `src/features/chat/`, `src/features/files/`, `src/features/terminal/`, `src/features/status/`, `src/store/paletteStore.ts`. No stubs at old paths.
- `lang.ts` moved to `src/apps/orion/lang.ts`; Monaco theme moved to `src/apps/orion/monacoTheme.ts` (pre-registered at boot so InlineEdit DiffEditor uses it too).
- **Phase A deferral**: Archives & XDesign ClaudeChat instances are wired UI-side with correct accent, system prompt, opening line, chips, and message log — but `onSend` currently routes through `src/store/stubChatStore.ts` (a local stub that echoes a placeholder reply). The Messages API IPC for these single-shot chats lands as a Phase B prerequisite. Orion's ClaudeChat already uses the real `chatStore` + CLI subprocess pipeline.
- Layout shape changes: the React 19 Tauri shell now boots straight to the wallpaper + dock; ⌘K opens Spotlight; clicking Orion in the dock opens the windowed editor with all Week 1/2 functionality (file tree, Monaco, terminal, inline edit, ⌘S save, ⌘. cancel). Auto-opens Orion on launch if a project was hydrated.

### 2026-05-14 — Phase A kickoff
- Read master brief + design handoff (extracted from `~/Downloads/orion terminal (1).zip` to `./design_handoff_orion_terminal/`).
- Audit clean: 19/19 tests pass, tsc clean, migrations 0001..0004 present.
- Created this file (`CLAUDE.md`) as the rolling project log.
- Noted: brief lists deprecated tokens (`--signal`, `--void`, etc.) that don't exist in this codebase; existing palette is the Tailwind theme keys. Migration plan = introduce new `--*` tokens at CSS level + remap Tailwind theme to point at them, so existing Tailwind classes pick up the new look automatically.
- Building in order per brief §9 (Steps 1–8).
