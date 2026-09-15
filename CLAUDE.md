# Orion Terminal — Project Log

Durable source of truth for Orion Terminal so context survives a lost chat. **Keep this file lean** — only what an agent needs to orient fast: what it is, the locked decisions/stack/tokens/architecture, the rules, and the current state. Per-session work detail goes to [CLAUDE_LOG_ARCHIVE.md](CLAUDE_LOG_ARCHIVE.md), not here. Whole thing should still read end-to-end in ~60 seconds a year from now.

---

## What this is

**Orion Terminal** is a JARVIS-style personal workstation: one desktop OS shell hosting three deeply-integrated apps with a selectable AI embedded inside each as a context-specific collaborator.

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

## Current state (2026-09-11) — polish / shared AI routing

**Public alpha (2026-09-15):** user authorized commit/push and public prerelease `v0.1.0-alpha.1`. Baseline `86ec7cf` passed remote CI and user-reported fresh-Tahoe core/ChatGPT smoke checks. New install: minimal glass username→password or skip, creator-owned stock wallpaper, animations off, only three core apps enabled; Archives save status moved to quiet titlebar text. Existing preferences preserved. **User wants code-only work, no repeated local tests/UI automation unless requested**; publication uses existing automated release gates. Final minimal UI changes have no new human acceptance. [Release notes](docs/releases/v0.1.0-alpha.1.md).

Shared rails, Learn/Tutor/RepoLens text, FX Assist and shader generation now honor provider-qualified selections and global/per-surface defaults. FX has 10 MCP/runtime tools; Cursor SDK now receives Orion MCP config. img2model supports Claude/Codex and fixes late listeners + overwritten reference snapshots; references autosave. XDesign project transitions/document saves/registry writes serialize and block during generation. File/process safety, connector probes, LSP setup, and provider-neutral copy tightened. Node **22.13+**; `npm run doctor` / `npm run verify`; release CI blocks high/critical production advisories.

Follow-up: native HTTP binding, persisted session ownership, RepoLens auth isolation, exact MCP grant enforcement, subscription preflight, and cancellation races hardened. Restricted Codex/Cursor turns start fresh; reviewed CLI families: Codex 0.154.x / Gemini 0.47.x. Latest **tsc/build green · frontend 1,227 · Node 23 · Rust 240/1 ignored · npm zero findings**. Selected macOS native audit: no vulnerable/unsound findings, five UNIC maintenance advisories; whole-lockfile audit not clear. Isolated **Orion Terminal Validation** passed specific desktop/inference/persistence, hostile-preview, tool-denial, independent Cursor install, PPTX, Monaco formatting/save and visible auth-failure/draft-retry checks. Production account/bundle untouched. **Not release-ready:** live provider/specialist acceptance, broad security/filesystem/recovery, visual polish, normal app/DMG/clean-machine CI and complete third-party review remain. No commits; preserve pre-existing dirty work. [Closure evidence](docs/aaa-rebuild/2026-09-11-release-closure.md) · [tool policy](docs/security/2026-09-11-tool-grants.md) · [setup/matrix](docs/setup-and-verification.md).

**ChatGPT live continuation (2026-09-12):** Disconnect/Enable preserves credentials; separate sign-out names the shared profile. Validation's private persistent Codex home is authenticated. Fixed exec-only auth flags, code-mode-only model tools (host enabled + approval scoped to exact-grant Orion MCP), `error:null` parsing, swallowed protocol diagnostics, npm-wrapper cancellation, and early-cancel context loss. Packaged Terra chat/read/write/review and Stop→fresh-session marker recovery passed; native subscription image backend produced a real PNG. No API fallback, other account sign-out, or production changes. **Background/image follow-up closed:** removed legacy one-shot commands; selected-surface analysis has zero grants, bounded lifecycle, and opt-in-only background uploads. Packaged subscription image → scoped Terra vision tags (zero tools) → canvas nudge/restart → private atomic PNG/SVG exports passed. All background opt-ins were turned back off and stayed off after restart. Fixed external-raster/duplicate-xmlns export failures, settings/assistant stacking and oversized Spotlight. Bounded Terra FX tool edits/reopen also passed; analysis/FX default workspaces are now unique and Unix 0700, confirmed by a real native read-only FX turn. Shared turns now reject stale UI callbacks; executing FX/model tools hold a project-switch lock. Native bridge input/time/connection bounds and a live Terra read recheck passed ([callback evidence](docs/aaa-rebuild/2026-09-12-ui-callback-lifetimes.md)). FX replies now preserve separate message paragraphs; project creation/deletion commits documents and registry atomically, and queued metadata updates no longer overwrite renames. SQLite rollback regressions plus native formatting/create/draw/rename/restart/delete passed ([recovery evidence](docs/aaa-rebuild/2026-09-12-format-project-recovery.md)). Failed names/dirty documents now retain retry state; startup validates/coalesces before mutation, legacy adoption is atomic, and failed design/FX/model loads preserve prior work. Native injected failure → retry → restart passed; fresh Validation DMG verified/mounted read-only, production fingerprints unchanged ([save-safety evidence](docs/aaa-rebuild/2026-09-12-save-safety-release-rehearsal.md)). Archives now stages drafts before debounce, orders per-note writes, retains failed patches through refresh/remount, exposes retry, and blocks plugin disable until saved; keyed BlockNote instances prevent stale-document navigation writes. Native note failure → retry → restart/cleanup passed ([Archives recovery](docs/aaa-rebuild/2026-09-12-archives-save-recovery.md)). Normal macOS quit now checks known dirty/busy state; a real ⌘Q bypass required adding Cocoa's missing applicationShouldTerminate hook. Corrected ⌘Q/window-close/AppleEvent cancellation, retry/clean restart and explicit fixture discard passed. Orion file saves now acknowledge exact snapshots and queue same-path Save/LSP writes ([quit evidence](docs/aaa-rebuild/2026-09-12-quit-safety.md)). Backups now publish private no-clobber snapshots only after SQLite integrity/SQLx checksum validation, coordinate retention under a process lock, and surface startup failures. Native lock failure/restart, five-snapshot retention and non-destructive `--restore-db-copy` round-trip/refusals passed; temporary recovered databases removed, production untouched ([backup evidence](docs/aaa-rebuild/2026-09-12-backup-recovery.md)). Private note/file journals now have scoped native SIGKILL → restart → explicit new-copy recovery acceptance, including no-overwrite export and session-specific discard. Native testing also caught and removed startup's unsafe empty-plaintext note purge; blank/image-only notes survive restart. Synthetic fixtures cleaned, production unchanged ([draft recovery](docs/aaa-rebuild/2026-09-12-draft-recovery.md)). XDesign/other draft coverage, full-profile promotion, power loss, broader recovery and specialist/release gates remain. [Initial live evidence](docs/aaa-rebuild/2026-09-12-subscription-live.md) · [image/consent/export evidence](docs/aaa-rebuild/2026-09-12-background-ai-image-workflow.md).

**Core UI safety (2026-09-13):** fixed destructive Cancel+Enter, native Tab escape, modal labels/lifetimes, menu/fullscreen conflicts, file-row menus and narrow chat clipping; conservative rename guards added. Browser/native checks passed,198files/1254frontend/30Node/240Rust+1ignored. Accessibility Proof SHA4ec77e33… closed; fixtures quarantined, production unchanged. Full accessibility/source/CI/clean-machine/sign-off remain. [Evidence](docs/aaa-rebuild/2026-09-13-modal-accessibility.md).

**License packaging (2026-09-13):**213 frontend/342 native notices and8 matching MPL source archives now ship/readably verify; stale/missing material fails builds. Added adapted-code notices and export-carried noise grant; owner confirmed icon authorship. Package SHA109ef3b7… verified, production untouched. Historical provenance limits/final approval remain. [Evidence](docs/aaa-rebuild/2026-09-13-distribution-licenses.md).

**Native core recovery (2026-09-13):** separate generated profile passed real packaged promotion/open/edit/restart/rollback, including assets/HTML/external workspace/draft copy and Tauri schema28→29 startup upgrade. Both versions retained privately; test apps closed, production/Validation bundles untouched. Fixed fullscreen Escape stealing native dialog cancellation and palette opening behind a modal; native focus/no-note-mutation recheck passed. Broader profiles/clean-machine/final provenance approval/CI/sign-off remain. [Evidence](docs/aaa-rebuild/2026-09-13-native-profile-recovery.md).

**Webpage durability (2026-09-13):** XDesign HTML now shares SQLite project saves/backups, with validated non-destructive legacy migration and failed-save retry. Packaged real WebKit migration → injected failure/retry → reopen without synthetic browser source → exact startup-backup/restore-copy HTML passed; fixture cleaned, no cloud calls or production changes. Not full-profile restoration or an HTML crash journal. [Evidence](docs/aaa-rebuild/2026-09-13-webpage-durability.md).

**Bounded alpha continuation (2026-09-13):** recovery feedback now stays inside the top-layer dialog; packaged no-overwrite/error→success/discard checks passed. Added fixture-only cold-profile copy/26-schema-upgrade/same-path rollback rehearsal and wired CI/release gates. No real profile promotion, WebKit restore or clean-machine acceptance; GitHub CLI signed out, remote CI unrun. XDesign specialist entry points labeled experimental. [Exact scope and blockers](docs/aaa-rebuild/2026-09-13-alpha-release-gates.md). No production replacement, commit or release.

## Current state (2026-08-03) — native ChatGPT-subscription image generation

XDesign no longer needs the external `openai-oauth` localhost proxy. New Rust module `src-tauri/src/codex_subscription.rs` reuses the built-in Codex provider's existing ChatGPT OAuth session (default `$CODEX_HOME/auth.json`/`~/.codex/auth.json`, plus Codex direct-keyring format), rejects API-key auth mode, refreshes expiring tokens under a process lock, atomically preserves credential documents, and calls the fixed Codex image endpoint directly with `gpt-image-2`; tokens never enter React or logs. `cli_status` now reports `authMode/subscriptionReady/imageReady`. Control Panel's single **Connect with ChatGPT** flow auto-polls to `Connected · chat + image`; XDesign prefers the subscription and falls back to configured OpenAI/Google API providers. The temporary OpenAI OAuth preset and all `127.0.0.1:10531` code paths were removed; legacy saved providers remain ordinary providers. External proxy stopped and confirmed unreachable; a proxy-free live Rust test generated a real PNG successfully. Apache-2.0 attribution is in `THIRD_PARTY_NOTICES.md`. Gates: tsc clean · vitest 932 · cargo test --lib 150 passed/1 ignored · build exit 0. **Tauri UI restart + human smoke test still required.**

**Approved follow-up:** Apache-2.0 for original code/creator-owned GLBs; owner confirmed authorship. Migrated to `@huggingface/transformers@4.2.0`, bundled matching ONNX WASM, restarted worker realms on failure; Whisper needs basic optimization and no English-only task/language overrides. Fixed SQL plugin JSON-text vector decoding in archive/codebase readers. Real browser embeddings/transcription and packaged semantic-only Spotlight retrieval passed; packaged microphone/offline acceptance remains open. [Migration evidence](docs/aaa-rebuild/2026-09-11-inference-migration.md).

## Current state (2026-07-12) — XDesign img2model: full img2threejs-inspired reconstruction pipeline

New subsystem `src/apps/xdesign/model3d/` (~20 files): a faithful port of the [hoainho/img2threejs](https://github.com/hoainho/img2threejs) skill's staged image→procedural-Three.js pipeline, adapted from a file-based Python/coding-agent skill into a live in-app agent tool loop. Deliberately scoped OUT: the CS2/Counter-Strike vertical (VPK texture ripping — game-asset-specific, irrelevant here) and upstream's still-"Planned" v1.3 identity-grade face-likeness projection (we ship the generic reference-projection mechanic + stylized character track, both actually shipped upstream). Everything else is real, working logic, not stubs:

- **Spec schema** (`sculptSpec.ts`): `ObjectSculptSpec` — preSpecAssessment (object class/complexity/detailInventory/anatomy), qualityContract, component tree (topology/attachment/actionProfile/sockets/colliders/destruction), materials (independent PBR channels + localOverrides + referencePbr + projectedTexture), repetitionSystems, featureReviewTargets, sculptPipeline, reviewHistory.
- **Gates** (ported 1:1 from the Python scripts' logic, not guessed): `validateSculptSpec.ts` (structural + `--strict-quality`), `featureAcceptancePolicy.ts` (≤5 critical/≤3 important per pass), `passOrchestrator.ts` (locked-sequential 8-stage pass order, blockout→...→optimization-pass, +proportion-lock/feature-placement for character domain), `detailInventory.ts` (15-kind taxonomy + zone-scan + mapsTo completeness).
- **Divine Eye** (`divineEye.ts` + `imageMetrics.ts` + `objectness.ts`): the deterministic zero-token ensemble scorer ported exactly — silhouette-IoU/scale HARD gates (0.85/0.08), 8 soft signals (proportion/symmetry/pHash/SSIM/edgeOverlap/blowout/flat/tonal) + OSIM-lite HOG objectness, weighted fidelity, disagreement-spread → probe, and the "reconstruction-mode rescue" (photo-vs-procedural IoU-only reject → probe when objectness confirms same object). All pixel math operates on a DOM-free `Px` type so it's fully unit-tested without canvas mocking.
- **Multi-angle gate** (`multiAngle.ts`) + **bounded correction loop** (`correctionLoop.ts`: repeated-defect/oscillation/plateau/hard-ceiling → forced request-input, never a silent infinite burn).
- **Intake fidelity levers**: `cameraPose.ts` (heuristic FOV/distance), `delight.ts` (canvas de-lighting), `pbrEvidence.ts` (crop→palette/roughness/confidence, 0.7 threshold), `projectionBake.ts` (real camera-projective UV rebake — reference pixels onto mesh, not a procedural approximation).
- **Geometry/materials**: `geometryPatterns.ts` (real chamfer via ExtrudeGeometry bevel, lathe-profile bevels, tube-network attached members, InstancedMesh repetition), `materialBuild.ts` (MeshPhysicalMaterial + independent per-channel canvas masks), `factoryBuilder.ts` (pass-gated live THREE.Group builder exposing `root.userData.sculptRuntime`, + TS factory-file exporter), `characterTemplate.ts` (parametrized head-unit-driven bust template).
- **Agent loop** (`modelAssistTools.ts` + `modelAssist.ts`): 16 tools over `messages_chat_run` (same pattern as `fx/fxAssist.ts`), carrying real vision — reference image on turn 1, comparison-sheet image back on every `model_request_render` (Anthropic image content blocks, confirmed the pass-through in `messages_chat_run` supports this).
- **UI**: new XDesign project kind `"model"` (mirrors `"fx"` in `projectsStore.ts`) → `ModelStudio.tsx` (r3f viewport w/ dedicated offscreen capture renderer + turntable, reference overlay, export/place-in-canvas toolbar) + `ModelAssistPanel.tsx`. Home tile added in `XDesignHome.tsx`.
- 81 new unit tests (13 files) on the pure logic layer; UI/canvas-bound glue (comparisonSheet, materialBuild's canvas ops, projectionBake, pbrEvidence's crop path) intentionally left untested, matching this repo's existing convention for canvas-heavy code (see `fxRaster.ts`).

Gates: tsc clean · vitest 924 (843+81) · build exit 0 (cargo untouched — no Rust changes). **UI human-unverified — no user smoke test yet.**

**Follow-up same day: moved img2model off the API-key path onto the subscription CLI, like every other embedded Claude.** The first cut used `messages_chat_run` (direct Messages API, OS-keychain key) copying FX Assist's pattern — wrong call, since FX is the one exception in this codebase, not the norm. Everything else (docked app rails, Hermes, canvas ops) goes through `claude_send` (CLI subprocess) + the in-process MCP server (`orion --mcp-serve`) + the local `ui_bridge` TCP callback so Rust-side MCP tools can reach into frontend Zustand state. Rewired to match: added 19 `orion_model_*` tool defs to `mcp_server.rs::tool_definitions()` (schemas ported from the now-reference-only `MODEL_TOOLS` in `modelAssistTools.ts`) + one generic `tool_model_bridge()` dispatcher (`send_ui_action(kind, args)` — no per-tool Rust logic); `EventBridge.tsx`'s `handleUiAction` routes any `model_*` kind straight to `executeModelTool` (auto-opens XDesign + ensures a "model" project). Vision for the per-pass render/review loop no longer needs inline MCP image content blocks (no precedent in this codebase, risky) — `orion_model_request_render` now saves the comparison sheet to a real file via `ipc.xdesignSnapshotWrite` and tells the model to use its own built-in Read tool on the path, same mechanism already proven for canvas snapshots. `modelAssist.ts` rewritten from a `messages_chat_run` streaming loop into a thin `claude_send`/`--resume` turn-driver (session id from stream-json `system/init`, text from `assistant` events, bounded-loop decisions read off the spec's own `reviewHistory` after each turn rather than trusting model self-report) — tool execution is no longer in its control at all, the CLI calls tools autonomously via MCP. New `modelTranscriptFeed.ts` (tiny shared zustand store) lets the tool executor push "tool ran"/"render captured" transcript chips even though execution now happens outside the chat loop. Gates: tsc clean · vitest 924 · cargo check + cargo test --lib 140 · build exit 0.

**Second follow-up same day: fixed "slow and stalling" during a real run.** Root cause: `orion_model_request_render`/`extract_pbr`/`project_texture` re-decoded the FULL-resolution reference photo from scratch on every single tool call with no downscaling, and every pixel-analysis function (foreground mask, palette, Divine Eye) already downsamples internally to ~100px anyway. A multi-megapixel photo pushed a single decode+mask past the `ui_bridge`'s **5s synchronous timeout** (`ui_bridge.rs`, shared by every MCP tool) — tool calls were silently timing out/retrying, which looks exactly like stalling. Fixed in `modelAssistTools.ts`: `referenceImageDataCapped()` decodes once, caps to 1024px longest side, and caches by URL (invalidated on reference change); `makeComparisonSheet` now accepts an already-decoded canvas to skip a second full redecode on every render call. Also hardened `modelAssist.ts`: added a 4-minute per-turn timeout with auto-cancel (there was none — a wedged tool call or subprocess just sat there with no recourse but a manual Stop click the UI didn't clearly offer), fresh `chatId` per auto-continue round instead of reusing one, and dropped `MAX_ROUNDS` 30→12 (30 sequential full `claude` subprocess spawns with zero user input in between was its own kind of "stalling"). Gates: tsc clean · vitest 924 · build exit 0 (Rust untouched this round).

**Third follow-up (screenshot-driven): two identical 240s turn timeouts in a row on `--resume`.** Diagnosis: killing the CLI subprocess mid-turn (via `ipc.claudeCancel`) leaves that session's own transcript with a dangling `tool_use` that never got a `tool_result` — resuming THAT exact session with `--resume` re-hits the same hang, which is why both attempts died at exactly the same wall-clock mark. Fixed in `modelAssist.ts`: a timeout now resolves with `timedOut:true` (previously rejected, which just aborted the whole `send()`) and `sessionId` is dropped entirely on timeout — the next Send starts a genuinely fresh CLI session (system prompt + reference image reattached) that recovers spec state via `orion_model_get_spec` instead of resuming a wedged one. Also bumped `TURN_TIMEOUT_MS` 240s→480s (the system prompt explicitly asks the model to autonomously push through multiple passes per turn — that's allowed to take minutes, not seconds) and added a live elapsed-time readout in `ModelAssistPanel.tsx` (`busy` state had zero feedback during a long "model thinking, no tool chips yet" stretch, which read as frozen even when it wasn't). Gates: tsc clean · vitest 924 · build exit 0.

**Fourth follow-up: STILL timing out (480s, screenshot 2) even after the resume-fix.** Since a review had already landed successfully before this stall (image attach worked at least once), the earlier "maybe it's a hang" theory needed narrowing rather than a silver-bullet fix. Landed two things: (1) a real bug regardless of whether it's THE cause — `claude_send`'s image-attach hardcodes `media_type: image/png` (`claude_cli.rs::build_user_image_message`) but img2model let the user attach any of png/jpg/jpeg/webp/gif/bmp and passed the ORIGINAL asset path straight through; every session-reset retry reattaches the image on a fresh session, so a non-PNG reference would choke identically on every retry. Fixed in `ModelStudio.tsx::loadReferenceFromPath`: now always re-encodes to a capped (2048px), freshly-written PNG via `ipc.xdesignSnapshotWrite` and uses THAT path for the CLI attach, never the original asset file. (2) Real diagnostics, since guessing blind wasn't working: `modelAssist.ts` now pushes a 15s-interval "no activity for Ns" hint into the transcript distinguishing "never got a system/init event at all" (claude/MCP subprocess never came up) from "had activity, now silent" (stuck mid-tool-call or model thinking), and CLI stderr lines — previously only `log.warn`'d to the devtools console, invisible to the user — now also land in the transcript panel. Gates: tsc clean · vitest 924 · build exit 0. **Still needs a repro with the new diagnostics on screen to pin the exact stall point.**

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
