# Brief 03: Build the approved dock redesign

Assigned to: GPT 6.1 (Codex). Coordinator: Claude. Owner: Luca.

## Where you work

- Worktree: `/Users/lucaorion/Orion_Terminal-worktrees/dock`, branch `alpha/dock-redesign`, cut from `2aabd42`.
- `node_modules` there is a symlink to the main checkout's. Never edit anything inside it.
- The main checkout `/Users/lucaorion/Orion_Terminal` is the owner's live dev app. It is running on port 1420. Read from it, but never write to it.
- **Leave all changes uncommitted.** No commits, pushes, deploys, GitHub edits, or anything that leaves this machine. The coordinator reviews the diff, and the owner approves before anything is committed.
- Read `AGENTS.md` (the repo rules) and `CLAUDE.md` before you start.

## What to build

The owner approved this design on 2026-10-29. Build it exactly:

- **The spec** is the authority: `/Users/lucaorion/Orion_Terminal/docs/superpowers/specs/2026-10-29-dock-redesign-design.md`.
- **The visual reference** is the mockup: `/Users/lucaorion/Orion_Terminal/docs/superpowers/specs/2026-10-29-dock-redesign-reference/dock-mockup.html`.
  - Option A, "Raised", is the approved one.
  - It reads image pixels, so serve the folder over HTTP: `python3 -m http.server 1532 --bind 127.0.0.1` from inside it. A `file://` URL won't work.
  - Its canvas code (`emboss`, `prep`, `draw`, `orbModel`, `drawOrb`, the decode label) is the reference implementation. Port it to TypeScript faithfully.
- **When the spec and mockup disagree, or are both silent:** where the spec says nothing about a visual number, use the mockup's number. Where both are silent, decide, and list the decision in your report.
- Don't redesign anything and don't re-open the owner's decisions. Items marked "*Claude's call*" in the spec are settled; build them as written.

## Method

1. **Read first.** Read the spec, the mockup and the code the spec names:
   - `src/shell/Dock.tsx`
   - the `.ot-dock*` rules in `src/styles/tokens.css`, `materials.css`, `lightThemes.css` and `customThemes.css`
   - `src/plugins/builtinApps.ts` and `appRegistry.ts`
   - `src/plugins/communityRuntime.ts`
   - `src/shell/store/useShell.ts`
   - `design/DESIGN.md`
2. **Plan.** Write a short plan at the top of `docs/alpha/dock-report.md`: the files you will create or change, and the tasks in order.
3. **Build test-first.** The spec's Constraints → Tests line names the logic to test:
   - the decode text at given elapsed times;
   - which item counts as lifted for a cursor x;
   - Command Center and Hermes absent from the dock;
   - the accessible labels.

   Put pure logic, such as decoding, picking the lifted item and orb physics, in plain TS modules so it can be unit-tested. Write each test, watch it fail, implement, and watch it pass.
4. **Visual check.** See Live-app safety below.
5. **Gates, then the report.**

## You may change

- `src/shell/Dock.tsx`, plus new files for the dock, for example under `src/shell/dock/`.
- The glyph assets: copy the four `glyph-*.png` files from the reference folder into the app, for example `src/assets/dock/`. Don't alter them.
- `src/styles/tokens.css`: only the `.ot-dock*` rules and new dock-scoped custom properties. Another job owns the rest of this file.
- In `src/styles/materials.css`, `lightThemes.css` and `customThemes.css`: only the selectors that target `.ot-dock` or `.ot-dock-*`.
- `src/plugins/builtinApps.ts`: the Incubator glyph and colour, and hiding Command Center and Hermes from the dock.
- `src/plugins/appRegistry.ts`: the dock descriptor type, only if the glyph or hiding needs it.
- `src/shell/store/useShell.ts`: the `DOCK_CLEARANCE` value only.
- `design/DESIGN.md`: add the dock as a second exception in the "No neon" paragraph, beside the Agent Forge.
- New or updated tests for the above.
- `docs/alpha/dock-report.md`: your report.

## Don't touch

- `PROGRESS.md` and `CLAUDE_LOG_ARCHIVE.md`. Put token gaps in your report, and the coordinator logs them.
- `src/shell/MenuBar.tsx`, `BrandMark`, `src-tauri/` (including icons), `PluginManagerPanel.tsx`, and `src-tauri/vendor/`.
- Photocraft.
- Anything about the app's name. The rename is deferred.
- No new dependencies. No Rust changes. If you find you need either, stop and say so in the report.

## Things that must keep working

- **Dock clicks:** clicking a dock item opens the app, or minimises it when it is focused. The Spotlight (⌘K), Rosie (⌘L) and Control Panel (⌘,) actions and shortcuts are unchanged.
- **Magnify and lift:** the curve and the item size are unchanged.
- **Existing markup:** `data-coach` attributes on dock items stay, because onboarding coach marks use them.
- **Other apps:** community plugin apps still appear in the dock. Command Center and Hermes still open from Spotlight.
- **The plugin list:** `PluginManagerPanel` still renders `dock.Icon`.
- **Reduced transparency:** it still works (spec §10).
- **Performance:** window drag must still run at 60fps. Only the orb's canvas draws every frame. Icon canvases redraw only while something is changing, and every `requestAnimationFrame` loop stops on unmount.

## Live-app safety (visual check)

Check the result in a browser against the mockup, using headless `playwright-cli` if it runs in your sandbox.
- **Dev server:** start Vite from the worktree on port **1531** with `--strictPort`, and point it at a separate cache directory under `/tmp`. For example, use a temporary wrapper config that sets `cacheDir: "/tmp/dock-vite-cache"`, and delete it afterwards.
  - Never use port 1420.
  - Never write to the main checkout's `node_modules/.vite/deps`.
- **Screenshots:** they go to `/tmp/dock-check/`, not into the repo.
- **What to capture:**
  - the dock at rest in the default theme (Liquid);
  - one app lifted, with its name decoded;
  - Rosie under the cursor;
  - Minimal or BMW M;
  - Ivory Keep, the light theme with Milky glass.
- **If you can't check:** if the browser or dev server can't run in your sandbox, say so in the report. The coordinator will do the visual check.
- **Clean up:** stop any server you started before you finish.

## Gates (paste the result lines into the report)

- `npm run typecheck`
- `npx vitest run <your test files> <existing test files that import a file you changed>`. Find those with `git grep`.
- `npm test`, run once at the end.

## Deliverable

Write `docs/alpha/dock-report.md` in the worktree with:

1. The plan.
2. What changed, file by file.
3. The decisions you made where the spec and mockup were silent.
4. Token gaps for Hermes: every new dock-scoped value, with its name and value.
5. The visual check: screenshot paths and what you saw, or why it couldn't be done. Include how the Milky glass looks in Ivory Keep.
6. The gate results.
7. Anything not done, or done differently from the spec, with the reason.

End your final message with the report's path and the gate results.
