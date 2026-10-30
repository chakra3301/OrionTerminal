# Dock redesign report

## Plan

1. Add focused failing tests for decode timing, lift selection, dock filtering, accessible labels, interactions, and independent orb physics.
2. Port the approved Raised canvas implementation into `src/shell/dock/`; copy the four unchanged PNG masks to `src/assets/dock/`.
3. Update `src/shell/Dock.tsx`, the dock descriptor metadata in `src/plugins/{appRegistry,builtinApps}.ts`, dock-only CSS in `src/styles/{tokens,materials,lightThemes,customThemes}.css`, `DOCK_CLEARANCE`, and the dock exception in `design/DESIGN.md`.
4. Compare the worktree app on port 1531 with the reference on port 1532. Keep cache and screenshots under `/tmp`; stop both servers and remove the temporary config.
5. Run typecheck, focused importer tests, and `npm test` once. Finish this report with exact results, visual observations, decisions, and token gaps. Leave all work uncommitted.

Branch: `alpha/dock-redesign`. Initial worktree status: clean. The brief supersedes the session logging routine: `PROGRESS.md` and `CLAUDE_LOG_ARCHIVE.md` will remain untouched.

## What changed

- `src/shell/Dock.tsx`: renders the registered apps in order after filtering only explicit `dock.hidden`; moves Rosie before the divider; keeps Spotlight and Control Panel last. Preserves open/focus/minimise actions and existing `data-coach` attributes. Buttons have `aria-label` names without native `title` tooltips. One nearest item reveals and decodes its name, including on `:focus-visible`; labels follow its transformed bottom and clamp inside the dock. Active dots retain visible, non-minimised-window semantics. Pointer movement updates transforms directly, without rerendering the dock on every pixel of movement.
- `src/shell/dock/logic.ts`: testable decoding, nearest-item selection, cosine magnification, accessible labels, dock filtering, and fixed-neon accent mapping. The curve remains 110px / 1.55 / 12px; Rosie peaks at 1.2.
- `src/shell/dock/iconCanvas.ts`: ports the reference alpha-bound mask cropping, noise, raised `emboss`, `prep`, and colour `draw` layers. Canvas-shadow blur preserves the WebKit approach from the mockup. App glyphs fill 0.8 of the item; utility glyphs fill 0.44.
- `src/shell/dock/DockIcon.tsx`: rasterises existing lucide SVGs as masks, loads/caches PNG masks, and renders each icon on its own canvas. Reveal uses the reference 0.16 lerp; pointer tilt and sheen use 0.14 smoothing and the reference 7° maximum. Frames stop once values settle, including during stationary hover. Reduced motion uses a plain 120ms reveal. Unmount cancels frames, listeners, and pending async initialisation.
- `src/shell/dock/orbModel.ts`: ports the exact seed-47 random sequence, Fibonacci patches, nodes, links, spikes and Gaussian core; exposes individual particle springs and cursor push as plain TypeScript.
- `src/shell/dock/orbCanvas.ts`: ports `drawOrb`, including additive drawing, independent per-dot shimmer/push/springs, velocity contribution/cap, rotation, tilt, spikes, node links, and breathing core. Hover changes no global brightness, rotation, or breathing value. Reduced motion quarters rotation/shimmer and fixes breath at 0.5.
- `src/shell/dock/RosieOrb.tsx`: owns the 96px canvas, 25px radius, pointer mapping, animation lifetime, and visibility pause/resume. It is the only canvas that keeps drawing at rest.
- `src/assets/dock/glyph-{archives,orion,xdesign,rosie}.png`: copied unchanged. Byte comparison and SHA-256 checks match all four reference files. Incubator uses `glyph-rosie.png`.
- `src/plugins/appRegistry.ts`: adds optional `dock.hidden`; the required `dock.Icon` remains intact.
- `src/plugins/builtinApps.ts`: hides Command Center and Hermes only from the dock and changes Incubator's plugin-list lucide icon from FlaskConical to Atom. Incubator already had the approved violet accent. All six built-ins and their Spotlight commands remain registered and enabled as before. Community descriptors need no changes.
- `src/styles/tokens.css`: dock-only surface properties and rules: 13.6px fixed corners, 26px frost, smoked dark glass, Milky light glass, sheen, fixed approved colours, transparent item beds, orb slot, open dots, tiny decoded labels, and explicit/OS reduced-transparency fallbacks. The dock now floats 30px above the edge. A selected shader border keeps its edge while the dock retains its inset highlight.
- `src/styles/{materials,lightThemes,customThemes}.css`: removes only dock membership from surface/finish adapters that would repaint it; removes obsolete dock icon-bed styling. Existing keyboard focus styling is retained. Other surfaces are unchanged.
- `src/shell/store/useShell.ts`: changes only `DOCK_CLEARANCE`, 88 → 104 (+16px). `DOCK_REACH` remains 24px. Tests verify opened and maximised windows leave 104px below them, providing 8px between the window bottom and the dock's 66px surface at a 30px bottom offset.
- `design/DESIGN.md`: records the dock as the second exception beside Agent Forge in the No neon paragraph.
- Tests: `src/shell/Dock.test.tsx`, `src/shell/dock/{logic,orbModel,animationLifecycle}.test.{ts,tsx}`, and the added dock-filter assertion in `src/plugins/builtinApps.test.ts`. They cover the brief's four required logic contracts plus community apps, clicks, coach marks, keyboard focus, reduced motion, window clearance, independent particle response, and animation cleanup/idle work.

## Decisions where the reference leaves room

1. **Structure:** one canvas per glyph, one for the orb; cached alpha masks and precomputed material layers. Decode/lift/physics live in plain TS. No dependency additions.
2. **Lucide masks:** serialise the existing rendered `dock.Icon` SVG and decode it as an image before the same 512px alpha-bound crop used by PNGs. This preserves arbitrary registered app icons and leaves `PluginManagerPanel.tsx` unchanged. Search and SlidersHorizontal follow that path too.
3. **Pixel ratio:** exactly the mockup's `min(devicePixelRatio, 2)`, multiplied by 1.6 for icons and 1.25 for the orb. This retains the reference oversampling and 76px padded icon canvas.
4. **Decode timing conflict:** the specification explicitly settles slot i at `90 + i × 30ms`. The mockup's `i < floor((ms - 90) / 30)` settles the first slot at 120ms. The implementation follows the specification: 90, 120, 150ms, etc. Spaces retain their positions and timing slots.
5. **Keyboard precedence:** a `:focus-visible` dock button keeps the lift/name while keyboard focus remains there; otherwise the nearest pointer item controls it. Pointer-only focus does not request a keyboard lift. Switching items restarts decode.
6. **Reduced-motion detail:** tilt/sheen feedback is disabled alongside the plain reveal fade; the existing magnify/lift curve stays intact. Orb pointer push remains active. Direct feedback never changes all dots together.
7. **Failure fallback:** if a mask or Canvas 2D is unavailable, the button still works and its existing lucide icon is shown without colour at 0.55 opacity (the reference's raised top-rim alpha). This is a compatibility fallback, not the normal rendering path.
8. **Incubator's non-canvas Icon:** Atom supplies the orbit motif in the unchanged plugin list; the dock itself uses the exact supplied orbit-and-sparkle PNG.
9. **Colour variables:** fixed Phase A neons are scoped to the dock wrapper so themes cannot retint them. Community `var(--neon-*)` accents resolve to those fixed equivalents; other accent values pass through unchanged.

## Token gaps for Hermes

All new CSS custom properties are local to `.ot-dock-wrap` and its descendants. None changes global tokens or theme palettes. The fixed neons and radius already exist in the Phase A canon; the names below provide the approved dock exception without reading retuned theme values. Hermes can decide which surface-specific values to promote to `design/tokens.json`.

| Name | Value |
| --- | --- |
| `--dock-green` | `#39ff88` |
| `--dock-cyan` | `#00e0ff` |
| `--dock-yellow` | `#e6ff3a` |
| `--dock-magenta` | `#ff3ea5` |
| `--dock-violet` | `#b14cff` |
| `--dock-utility` | `#cdd6de` |
| `--dock-orb-core` | `#9ff6ff` |
| `--dock-radius` | `13.6px` |
| `--dock-backdrop` | `blur(26px) saturate(1.25)` |
| `--dock-smoked-fill` | `linear-gradient(180deg, rgba(40,48,56,.42), rgba(14,18,22,.5))` |
| `--dock-milky-fill` | `linear-gradient(180deg, rgba(225,232,238,.2), rgba(200,210,218,.11))` |
| `--dock-smoked-border` | `rgba(255,255,255,.14)` |
| `--dock-milky-border` | `rgba(255,255,255,.24)` |
| `--dock-shadow` | `0 34px 60px -22px rgba(0,0,0,.85), 0 12px 26px -14px rgba(0,0,0,.7)` |
| `--dock-smoked-edge` | `inset 0 1px 0 rgba(255,255,255,.18)` |
| `--dock-milky-edge` | `inset 0 1px 0 rgba(255,255,255,.34), inset 0 -1px 0 rgba(255,255,255,.06)` |
| `--dock-sheen` | `linear-gradient(118deg, rgba(255,255,255,.16) 0%, transparent 38%, transparent 62%, rgba(255,255,255,.06) 100%)` |
| `--dock-divider` | `rgba(255,255,255,.16)` |
| `--dock-reduced-fill` | `rgba(8,14,18,.88)` — exact §10 dark fallback; light uses existing `var(--bg-2)` |
| `--dock-color` | Per-item mapped accent; Rosie `var(--dock-cyan)`; utilities `var(--dock-utility)` |

Other dock values copied from the approved reference/spec, without creating global tokens: bottom gap 30px; surface padding 8px 12px; gap 10px; item 48px; orb slot 64px with 4px side margins; orb canvas 96px / radius 25px / raise 14px; padded icon canvas 76px / margin −14px; divider 1×28px with 4px side margins; open dot 4px at bottom −8px and 6px glow; labels 500 8px/1 JetBrains Mono, .06em tracking, 6px/45% glow, 1px item gap or 2px orb gap, 10px horizontal inset; 120ms label/dot/reduced-reveal fades; existing 250ms transform return. Icon material alphas, shadow radii, rim offsets, lerps, and particle constants are ported from the named reference functions. The sole compatibility-only visual choice is the fallback icon's 0.55 opacity above.

## Visual check

**Blocked; no screenshots were produced.** I did not observe or certify the rendered result, Ivory Keep's Milky glass over its light wallpaper, real pointer feel, native WebKit, shader borders, or native 60fps window dragging.

- Started worktree Vite on **1531**, with `--strictPort`, `--configLoader runner`, a temporary wrapper, and `/tmp/dock-vite-cache`. Vite reported ready; it was stopped afterwards. Port 1420 and the live app were not used.
- The reference HTTP server on **1532** failed to bind: `PermissionError: [Errno 1] Operation not permitted`.
- The first headless `playwright-cli` launch could not write its normal daemon cache outside the sandbox. Retrying with the CLI's daemon directory under `/tmp/dock-check/pw-daemon` reached Chrome launch, which aborted with `SIGABRT` / `TargetClosedError`.
- Ego Lite also could not start: macOS application-services/XPC connection errors.
- The available browser-control connection rejected opening the local preview. **Automatic approval review rejected `http://127.0.0.1:1531` because network-egress authority was not granted.** No workaround or further browser attempt followed that rejection.
- Required coordinator captures remain: Liquid rest; one lifted app after decode; Rosie under the cursor; Minimal or BMW M; Ivory Keep with Milky glass over its light wallpaper. Capture into `/tmp/dock-check/`, as requested. The exact Milky fill, rim and shadow are implemented, but how they read over the light wallpaper still needs visual acceptance.

## Gate method and initial failures

- Test-first: the new decode/picker/orb/registry tests first failed because their modules did not exist, then passed after implementation. The four initial Dock integration tests first failed against the old order and missing accessible labels, then passed after the dock rewrite.
- The default Vite config loader attempted to write `node_modules/.vite-temp`; the sandbox rejected the write. `--configLoader runner` avoided that, but the original config relies on `__dirname`. A temporary `.dock-vite.config.mjs` supplied it and set `cacheDir: '/tmp/dock-vite-cache'`. No shared `node_modules` file was edited.
- An initial importer run returned `17 passed / 1 failed` because the default dev-server read allowlist denied OpenPencil's font reached through the symlink. The wrapper then allowed read access to the resolved `node_modules` path. `PhotoStudio.layout.test.tsx` subsequently passed all 203 tests, and the full focused importer run passed.
- The temporary wrapper is removed before delivery. The original `vite.config.ts`, dependencies, Rust, live checkout, logs, and release artifacts are unchanged.

## Gate results

`npm run typecheck`:

```text
> tsc --noEmit
exit 0
```

`npx vitest run` with the four new dock test files and every existing test importer found by `git grep` (19 files), using `--config .dock-vite.config.mjs --configLoader runner --cache=false`:

```text
Test Files  19 passed (19)
     Tests  318 passed (318)
  Duration  30.70s
exit 0
```

After adding the reduced-motion name and window-clearance assertions, the final Dock/lifecycle subset was run again:

```text
Test Files  2 passed (2)
     Tests  9 passed (9)
  Duration  3.71s
exit 0
```

These focused runs cover 320 distinct tests in total. Full focused log: `/tmp/dock-focused-tests-final.log`. Additional lifecycle/layout log: `/tmp/dock-animation-layout-tests.log`.

`npm test -- --config .dock-vite.config.mjs --configLoader runner --cache=false` — run once at the end:

```text
Test Files  605 passed | 3 skipped (608)
     Tests  6038 passed | 3 skipped (6041)
  Duration  103.19s
exit 0
```

Full-suite log: `/tmp/dock-full-tests.log`. Existing jsdom Canvas 2D warnings appeared in PhotoStudio tests; they did not fail the run. No Rust tests or build were run, per this frontend-only brief.

`git diff --check`: exit 0.

## Delivery and outstanding acceptance

Implementation is complete within the allowed file scope. All changes remain **uncommitted** on `alpha/dock-redesign`. No commit, push, release, production replacement, remote edit, dependency addition, or Rust change was made. `PROGRESS.md` and `CLAUDE_LOG_ARCHIVE.md` were left untouched as the brief requires.

The temporary Vite wrapper was removed. No process started by this task is listening on 1531 or 1532. The four source PNGs were not altered.

Outstanding: coordinator screenshot comparison and native visual/performance acceptance, including **Ivory Keep's Milky glass over its light wallpaper**, reduced transparency in native WebKit, and the selected theme-border effect. This is the brief's allowed blocked-visual-check outcome; no visual approval is claimed. All intentional implementation choices and the one decode timing disagreement are recorded above.
