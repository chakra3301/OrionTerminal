# Orion Terminal — Project Log

Durable source of truth for Orion Terminal so context survives a lost chat. **Keep this file lean** — only what an agent needs to orient fast: what it is, the locked decisions/stack/tokens/architecture, the rules, and the current state. Per-session work detail goes to [CLAUDE_LOG_ARCHIVE.md](CLAUDE_LOG_ARCHIVE.md), not here. Whole thing should still read end-to-end in ~60 seconds a year from now.

---

## What this is

**Orion Terminal** is a JARVIS-style personal workstation: one desktop OS shell hosting three deeply-integrated apps with Claude embedded inside each as a context-specific collaborator.

- Shell: wallpaper, menubar, dock, in-canvas windows, Spotlight (⌘K)
- App 1 — **Archives 47**: personal Notion (notes, journal, mood boards, media). Green accent.
- App 2 — **Orion**: AI-first code editor (file tree, Monaco, live preview, terminal, inline Claude edits). Cyan accent.
- App 3 — **XDesign**: design studio UI shell (Figma + PS + Illustrator + Unicorn.studio hybrid). Magenta accent.

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

## Architecture map

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

## AAA Rebuild tracker

Multi-session rebuild (started 2026-06-10): Orion ≥ Cursor, Archives ≥ Notion, XDesign ≥ Figma (single-player), shell = real OS. Per-phase protocol: research → audit → ranked plan (user approval) → green slices (commit each) → user smoke test → ✅. Full per-phase build detail + CUT lists live in [CLAUDE_LOG_ARCHIVE.md](CLAUDE_LOG_ARCHIVE.md).

**Locked first-session decisions (2026-06-10):** Tab autocomplete via Messages API + keychain key, model = Haiku 4.5 (`claude-haiku-4-5-20251001`). New deps OK: LSP servers (typescript-language-server, pyright, rust-analyzer) + a geometry lib for XDesign boolean ops. Light theme CUT (dark-only). Release: unsigned personal .app/.dmg (no signing/notarization).

- **Phase 0 — Foundation** ✅ 2026-06-10 — perf, toast/notification queue, per-window error boundaries, confirmAction + toast.undo, db backup rotation, design tightening.
- **Phase 1 — Orion ≥ Cursor** ✅ 2026-06-13 ([research](docs/research/cursor-2026.md)) — AI editing core, Tab autocomplete, nav/feel, Git panel, checkpoints + blame, real LSP. **User must install**: `npm i -g typescript-language-server typescript pyright`, `rustup component add rust-analyzer`.
- **Phase 2 — Archives ≥ Notion** ✅ 2026-06-13 ([research](docs/research/notion-2026.md)) — capture, AI-native (auto-tag / RAG), database views, `[[`wikilinks + backlinks, callouts + PDF export.
- **Phase 3 — XDesign ≥ Figma** ✅ 2026-06-14 ([research](docs/research/figma-2026.md)) — design→code, canvas feel, vector boolean ops, layout systems, prototyping lite. Export styling = inline styles + CSS-var tokens (locked).
- **Phase 5 — XDesign FX (Unicorn Studio remake)** ✅ code-complete 2026-07-04 (locked: raw WebGL2, no three) — all 9 slices in `src/apps/xdesign/fx/`: ✅ 5.1 compositor foundation (`0fa102d` + scrim-fix `7b00aa3`) · ✅ 5.2 source layers (shape/text/image raster→uSrc) + 9 blend modes (`0736836`) · ✅ 5.3 16 filter effects (`9beeaa4`) · ✅ 5.4 10 generators (`099aaf0`) · ✅ 5.5 bindings mouseXY/speed/hover/appear (`bdf0787`) · ✅ 5.6 masking-by-source-alpha + keyframe timeline (`7b0fb02`) · ✅ 5.7 export PNG/video/standalone-HTML-embed/JSON (`58ae3ed`) · ✅ 5.8 perf HUD (`5acede0`) · ✅ 5.9 custom GLSL layer w/ Monaco + validate, Claude→shader via messages_chat_run, place-in-design-canvas bridge, depth parallax (`f795126`). · ✅ 5.10 quality pass (`32fa1d9`): REAL glyph dither (canvas glyph atlas via uSrc, editable ramp, JetBrains Mono — NOKIADEMON-proven approach), simplex/fbmS/ridge GLSL lib, astro nebula rewrite (double warp + ridged filaments + stars), ray-curtain aurora rewrite. · ✅ 5.11 effect browser w/ live-rendered shader thumbnails (`80593e0`) · ✅ 5.12 FX Assist agent (10 validated tools over the live scene via messages_chat_run, self-correcting GLSL loop) + uMouseSpeed uniform + 8 mouse/glitch effects + duplicate/randomize/reset controls (`7941023`). · ✅ 5.13 finale (`2bd150d`): 10 more effects (lightning · synthwave sun-grid · warp tunnel · voronoi · fire · bokeh · rain-on-glass · interference · CRT · sharpen) + ✦ Presets tab in effect browser (8 curated one-click scenes w/ baked mouse bindings + live thumbnails). · ✅ 5.14 audio reactivity (`e6eb12b`): mic→uAudio uniform + "audio" bind source (any param/custom shader pulses to sound), toolbar mic toggle, audio-reactive HTML embeds, "Sound bloom" preset. · ✅ 5.15 video source layers (`29812ee`): srcVideo streams a live <video> frame into uSrc each tick (fxVideo.ts; placement like image sources) — distort/mask/grade video. **52 layer types, 9 presets, 6 interactivity sources.** Video is live-only (snapshot/embed export freeze sources to stills). Adding effects = registry-only (fxRegistry.ts data+GLSL; u_-reference lint test guards typos). **Deferred:** FX undo/redo · pass flattening · per-layer downsample · ML depth estimation. **UI human-unverified — user smoke test pending.**
- **Phase 4 — One terminal, one brain** 🔨 — ✅ 4.1 notification center (`37f8f0c`) · ✅ 4.2 cross-app memory in Spotlight (`82e4e92`) · ✅ 4.3 ROSIE "catch me up" (`567fc48`) · ⬜ 4.6 cohesion pass (DEFERRED — needs user-driven visual verification, surface-by-surface).

---

## Current state (2026-07-11) — audit + full WIP landing (launch-ready)

Full codebase audit, then all accumulated WIP committed as six clean commits (`6208c19`…`b073deb`): audit hardening · **Cursor SDK provider** (cursor_engine drives `scripts/cursor-agent.mjs`, transcodes SDK NDJSON → `claude:event` contract; dedicated keychain slot; Composer 2.5/Auto seeded; builtin model lists refresh from seeds — adds Sonnet 5 + Fable 5) · **Characters** (see 2026-06-28 entry) · **wallpaper overlays** (matrix hue slider + reactor-Core layer; aurora/stars retired, ~180 lines dead CSS removed) · **Learn error surfacing** (per-node lessonError + retry + toast; figure calls on their own lane) · **XDesign tool-rail AI shortcuts** (railIntentStore seq+consume). Audit fixes: `fs_ops::remove_file_within` scopes all frontend-path deletes (wallpaper/asset/characters) · cursor script resolution prefers the project copy (**Node ESM resolves bare imports from the script's dir — a bundled resource copy can never find node_modules**; status/send verify + fail fast) · EventBridge surfaces `is_error` results (appends, creates message if none streamed) · fidget timers seed from live clock · stale `pick_thumbnail` test dropped (**gate is now `cargo test --lib`, not `cargo check`** — check never compiles tests). Old stash preserved as branch `stash-xdesign-image-adjust` (no longer applied cleanly); `scripts/characters-src/` (126MB) now gitignored. Gates: tsc clean · vitest 843 · cargo test --lib 140 · build exit 0. **UI human-unverified.**

## Current state (2026-07-10)

**Brain (2026-07-10, `3597873`):** Archives → **Brain** — automatic Obsidian-style knowledge graph over everything in Orion Terminal. `src/apps/archives/brain/`: `graphBuild.ts` (pure, tested — nodes = notes/journal/projects/chats/media/boards/tags/collections; edges = wikilinks · parent hierarchy · tags · collections · board membership · unlinked title mentions · **semantic** cosine≥0.55 top-3/node from the existing `embeddings` table — zero manual linking), `forceLayout.ts` (custom grid-repulsion force sim, no new deps), `BrainView.tsx` (canvas: pan/zoom/node-drag, hover neighborhood, search, type filter chips, detail rail → Open routes to owning surface / **Ask Claude** pushes prompt into live Archives chat via new `chatBridge.ts` sender registry). Sidebar item + Spotlight cmd `archives.brain`. Semantic scan capped at 1200 most-recent vectors; mention scan capped at 1500 notes. Visuals = energy-core language (`0a957a0`): 3D force sim (Fibonacci-sphere seed), perspective camera w/ slow auto-orbit, additive-blended wireframe-sphere nodes (gyroscope rings + hot center), depth-faded luminous links; orbit = bg drag, zoom = wheel, node drag in camera-depth plane. UI human-unverified.

**Blueprint visualizer (2026-07-10, `55c7006`):** toggleable wireframe drafting layer behind every note/journal/project editor (`src/features/notes/visualizer/`). Local concept extraction (`conceptExtract.ts`, pure+tested — stopword freq scoring, capitalized-run entity merge, recency tilt, sentence co-occurrence) → canvas layer (`BlueprintCanvas.tsx`) where concepts self-draw as schematic modules (6 shapes, part numbers, dimension line, dashed "live" ring on the just-written concept) w/ pen-plotter dash draw-in, gentle drift, links, fade-out. Accent per note kind. Toggle = drafting-compass btn top-right of editor, persisted app_state `note_visualizer` (key appended to AppStateKey union). Glass card blurs it under text, crisp in margins. Honors reduced-motion. **Pictograms** (`d875322`): 50 real-object wireframe drawings (tree/rocket/coffee/…) in `pictograms.ts`, ~190-word synonym+plural index, head-noun match for entities; matched concepts draw the actual object, unmatched fall back to abstract modules. Adding drawings = append to `LIBRARY` only. UI human-unverified.

## Current state (2026-06-28)

**Characters feature (2026-06-28):** Control Panel → **Characters** (real CP is `src/features/controlpanel/ControlPanel.tsx`, NOT the legacy `SettingsPanel`; both wired). Live-rendered gallery: 7 Meshy biped GLBs in `public/characters/<slug>.glb` + R.O.S.I.E (`/companion/companion.glb`) as default, catalog in `src/features/characters/catalog.ts`. Each card is its own R3F `<Canvas>` (drei `useGLTF`+`useAnimations`, scene cloned via three SkeletonUtils `clone`); idle loops + clicking selects and fires a one-shot "select" clip (resolved by name — idle/run/walk/spin vary per model) + 360° spin. Upload own .glb/.gltf via `character_store_file` Rust cmd → `$APPDATA/characters/` (asset scope added). State `useCharacterStore` (selectedId default `rosie` + custom[], persisted to app_state `characters`, hydrated in App.tsx). Picker lazy-loaded (drei out of main chunk). **The selected character IS the desktop companion**: `CompanionScene` renders `RosieModel` (full 10-clip behavior) when selected===rosie, else a lean `CharacterCompanion` rig (idle + run/walk/spin fidget + same drag ragdoll swing; root bone pinned for in-place locomotion). Mode light unchanged. GLBs optimized 80% (126MB→26MB; 3.4-4.7MB each) via `scripts/optimize-characters.mjs` (`npm run optimize:characters`): gltf-transform dedup/prune/weld + textureCompress(webp,1024) + quantize(KHR_mesh_quantization); **NodeIO must `registerExtensions(ALL_EXTENSIONS)`** or quantization/webp silently drop and three can't read the int16 geometry. Source originals in `scripts/characters-src/` (uncommitted-size, re-run script if they change).

## Current state (2026-06-27)

**Beta v1 polish pass (2026-06-27):** landed the uncommitted shell/theme WIP — true fullscreen window mode + ⌃⌘F app-switcher (`46912af`), Liquid frosted-glass theme + LiquidLens WebGL (`7919b4f`); split heavy vendors via vite `manualChunks` (three+xterm out of main — index 1.98MB→1.25MB) + removed dead Rust fn (`0c917c9`). Fresh release bundle rebuilt (was stale from Jun 23): `.app` + `.dmg` (23MB aarch64) carry all 104 commands. ⚠️ manualChunks must only split leaf vendors (three/monaco/xterm) — grouping react/markdown makes a circular chunk. **Remaining human-only:** launch the bundled `.app` and eyeball the auth liquid-glass + 5 themes on real surfaces.


**XDesign is feature-complete vs open-design / Claude Design:** generation loop (deterministic token engine · expert slot-template blueprints · output guards · best-model routing), brand contracts + URL→brand + 20 built-in design systems, prototypes, decks (HTML / PDF / PPTX), images (raster + SVG), motion (canvas + video) — plus the editable canvas + Orion integration competitors lack.

**Open / user-owned:** validate raster image-gen on a real key (**[P-AUTH]** — parsers now name exactly what came back; patch `xdesign_image.rs` if fields differ); confirm MediaRecorder video export in the bundled .app (works for voice, likely fine); XDesign multiplayer deliberately not contested.

Latest gates (2026-06-27): tsc clean · vitest 725 · cargo lib 0 warnings · build exit 0 · release bundle exit 0. **UI human-unverified.**

Detailed per-session history → [CLAUDE_LOG_ARCHIVE.md](CLAUDE_LOG_ARCHIVE.md).
