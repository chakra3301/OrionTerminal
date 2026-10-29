# XDesign Tool and Adjustment Controls Parity Implementation Plan

> **For agentic workers:** five builders run in parallel: four UI groups, each in its own git worktree, and one host-Rust group in the main tree. Each keeps a ledger in `.superpowers/sdd/2026-10-28-xdesign-controls-parity/<group>.md` (absolute path under `/Users/lucaorion/Orion_Terminal`). The integrator merges the worktrees, wires the host features into the UI (Phase 2), then runs the final review.

**Goal:** close every high- and medium-impact gap that the 2026-10-28 controls audit found between XDesign's tool and adjustment controls and Photoshop 2026, so the section is ready for the alpha.

**Architecture:**
- **Phase 1:** UI-only and partial gaps are closed in the React/TS front end. Gaps that need engine work are closed host-side in `src-tauri/src/xdesign_photo_*.rs`; photocraft stays read-only, as Fill Behind/Clear did.
- **Phase 2:** the host features get their UI.

**Tech Stack:** Tauri 2, Rust (photocraft engine rev 47f9306, read-only), React 19, TypeScript, Zustand, Vitest.

**Spec:** the audit reports in `docs/research/xdesign-controls-2026-10-28/` (`adjustments.md`, `paint-retouch.md`, `select-type-shape-view.md`), plus the ranked slice list in `CLAUDE_LOG_ARCHIVE.md` (2026-10-28, "tool and adjustment controls audit").
- The owner approved the slices: "lets do it ... if anything comes up just do it right away ... next time you report ... everything for this section is ready for the alpha launch".
- The owner opted out of questions, so builders rule on ambiguities themselves and ledger each ruling.

## Global Constraints

- **Branch** is `validation/alpha-2026-09-14`; worktrees branch from `2da1072`. No commits, pushes, staging or releases. Leave every change uncommitted.
- **Dependencies:** no photocraft, `src-tauri/vendor` or `node_modules` edits. No new dependencies.
- **Tokens:** never invent tokens. Use the closest existing token and log the gap for Hermes in your ledger.
- **Style:** comments only for a non-obvious why. Match the surrounding code: dense one-line JSX in `PhotoStudio.tsx`, the existing option-spec helpers (`number`, `choice` and `toggle` in `PaintToolOptions.tsx`), and existing menu and popover components (`MenuButton`, `IconCluster`).
- **Values:** Photoshop names, ranges, defaults and units follow the audit report. Where the report says "unverified", use the best-documented value and ledger the ruling.
- **Preview:** every edit previews in real time wherever Photoshop previews it.
- **TDD:** write each behaviour's test first and watch it fail. The gates are focused `npx vitest run <files>`, `npm run typecheck`, and `cargo test --lib` from `src-tauri` for Rust. Avoid repeated broad runs; run the whole `src/apps/xdesign/photo` directory once at the end.
- **No live checks:** no app launches, no Photoshop, and never `pfp.psd`.
- **Out of scope:**
  - L-impact rows, which go to the post-alpha list.
  - ML-backed features: Object Finder, Object Aware refine mode, Refine Hair and the generative options.
  - Adobe-proprietary content: the shipped Color Lookup LUTs and Legacy Gradients.
  - New brush engines: the Bristle, Erodible and Airbrush tips.
  - Cloud, video and 3D.

## Scope rule

Each group closes:
1. The items listed for it below.
2. Every other row in its report sections with status PARTIAL or MISSING-UI and designer impact H or M.

Rows that turn out to need Rust go to the host group's Phase 2 list in the ledger and are not faked in TS.

## Groups

### UI-1 Adjustments (worktree; `adjustments.md`)

1. **Brightness/Contrast:** an Auto button in Properties, and Use Legacy allowing Contrast up to 100.
2. **Hue/Saturation:** ticking Colorize takes the foreground colour's hue, or 0° when the foreground is black or white, as in Photoshop.
3. **Curves Properties:**
   - Show Amount of Light/Pigment.
   - Display Options: the 4×4 or 10×10 grid, Channel Overlays, Histogram, Baseline and Intersection Line.
   - Show Clipping.
4. **Match Color:** a source Layer menu, including Merged. The engine already accepts `sourceLayer`.
5. **Auto Color Correction Options:**
   - Find Dark & Light Colors, Snap Neutral Midtones and Enhance Brightness and Contrast, done as client maths.
   - Ruling: Enhance Brightness and Contrast becomes the default algorithm, per Photoshop CS6 and later.
6. **HDR Toning:** a live preview, and the Toning Curve. The engine already accepts `curve`.
7. **User-saved presets:** they appear in each adjustment's Preset menu, persist across sessions, and Delete Current Preset works.
8. **Eyedroppers outside RGB:** the eyedroppers and the on-image adjustment tool work in Grayscale and the other modes the engine supports.

Not in scope: the shipped Adobe LUTs.

### UI-2 Paint, retouch and brushes (worktree; `paint-retouch.md`)

1. **Smoothing:**
   - The default becomes 10%.
   - The options bar gains the Smoothing options menu: Pulled String Mode, Stroke Catch-up, Catch-up on Stroke End and Adjust for Zoom (engine `paint/src/brush.rs:329-349`).
2. **Brush Settings units:**
   - Color Dynamics jitters show as %.
   - Purity runs −100..+100.
   - Texture Brightness and Contrast run −150..+150.
   - Smoothing shows as % everywhere.
3. **Healing Brush Mode** lists Photoshop's 8 modes. Replace goes in Phase 2, since the host must accept it.
4. **Eraser Block** hides Opacity and Flow and does not send them.
5. **Tool preset picker** on the bar, using the engine's tool presets (`presets/tools.rs:143-190`):
   - The list, Current Tool Only, New Tool Preset, and applying a preset.
6. **Brush preset picker:** groups, meaning folders.
7. **Brush Settings Texture:** a pattern picker (engine `brush.texturePattern`).
8. **Dual Brush:** choosing the second tip.
9. **Mixer Brush:** the combination presets dropdown.
10. **Live Gradient on canvas:**
    - Colour stops: click the line to add a stop, drag to move one, drag it off the line to remove it.
    - Midpoint diamonds.
11. **Patch** can draw its own selection.

### UI-3a Vector tools (worktree; `select-type-shape-view.md` §19, §20, §22)

1. **Shape tools:**
   - Fill and Stroke type: No Color, Solid, Gradient or Pattern.
   - The Stroke Options popover: Align Inside/Center/Outside, Caps, Corners, the Solid/Dashed/Dotted presets, and More Options with dash and gap.
   - W/link/H.
   - Gear constraints: Unconstrained, Square or Circle, Fixed Size, Proportional and From Center.
   - Per-corner radii on Rectangle.
   - Mode Shape/Path/Pixels completed.
   - Path alignment.
2. **Pen tools:**
   - The Make: Selection…/Mask/Shape buttons in Path mode.
   - Fill and Stroke in Shape mode.
   - Path operations honoured in Path mode.
   - Rubber Band.
   - Auto Add/Delete.
   - Freeform Curve Fit.
   - Freeform Magnetic, with Width, Contrast, Frequency and Pen Pressure.
3. **Path Selection and Direct Selection:**
   - Select: Active Layers / All Layers.
   - Fill, Stroke and stroke width for shape layers.
   - W/link/H.
   - Path operations on the selected component, and Merge Shape Components.
   - Path alignment.

In Phase 2, the host group supplies Triangle corner radius and Line arrowheads.

### UI-3b Type, Move, Transform, Selection (worktree; `select-type-shape-view.md` §1, §6–§9, §21, §26)

1. **Move:** the "…" popover with Align To Selection / Canvas. The engine accepts the target (`layer_multi_cmds.rs:752`).
2. **Object Selection:**
   - Its own fields: Mode Rectangle/Lasso and Sample All Layers.
   - The marquee fields are removed.
   - Hard Edge goes in Phase 2.
3. **Select and Mask:**
   - Invert and Select Subject.
   - The in-workspace Quick Selection and Brush (add/subtract) tools.
4. **Type:**
   - Font Style lists the family's real faces (engine `type_cmds.rs:719-730`).
   - The Character/Paragraph panel toggle.
   - Cancel and Commit on the bar.
   - Anti-aliasing never offers a value the engine silently drops. The platform entries show disabled, with "Not supported by the image engine", as Color Lookup's Abstract/Device Link do.
5. **Free Transform:**
   - The reference point locator, with its show checkbox.
   - A switch between Free Transform and Warp.

Magic Wand Sample Size goes in Phase 2.

### HOST Rust (main tree; Rust only, no TS edits)

Each item is a host-side module or a routing change with Rust unit tests. The param contract is written to `.superpowers/sdd/2026-10-28-xdesign-controls-parity/host-contract.md`.

1. **Spot Healing:**
   - Honours `sampleLayer`: current, currentAndBelow or all.
   - Honours the 8 healing modes, including `replace`.
2. **Healing Brush:**
   - Mode `replace`.
   - Source: Sampled or Pattern, plus a pattern.
   - Diffusion: 1–7, default 5.
   - Ignore Adjustment Layers, for both Clone Stamp and Healing.
3. **Patch:**
   - Normal mode: Diffusion.
   - Content-Aware mode: Structure 1–7 (default 4), Color 0–10 (default 0), and Sample All Layers.
4. **Mixer Brush:** a reservoir that persists between strokes, with Load Brush, Clean Brush and Load Solid Colors Only commands.
5. **Paint Bucket:**
   - All Layers.
   - Mode including Behind and Clear; reuse `xdesign_photo_fill_modes.rs`.
6. **Replace Color:**
   - Add to Sample and Subtract from Sample.
   - Localized Color Clusters, with Range.
7. **Match Color:** Ignore Selection when Applying Adjustment.
8. **HDR Toning:** the Equalize Histogram, Highlight Compression and Exposure and Gamma methods.
9. **Magic Wand:** Sample Size: Point, 3×3, 5×5, 11×11, 31×31, 51×51 or 101×101 Average.
10. **Object Selection:**
    - Hard Edge.
    - Lasso-mode regions.
11. **Shapes:**
    - Triangle corner radius.
    - Line arrowheads: Start/End, Width %, Length % and Concavity %.

## Phase 2 (integrator)

1. Apply each worktree's diff to the main tree with `git apply -3`, and resolve any conflicts.
2. Wire every host-contract item into the UI, test-first.
3. Gates:
   - `npm run typecheck`.
   - `npx vitest run src/apps/xdesign`.
   - `cargo test --lib`.
4. Run a fresh whole-change review on the most capable model, then one fix pass. Each fix goes RED→GREEN.
5. Update the docs:
   - PROGRESS.md.
   - CLAUDE_LOG_ARCHIVE.md.
   - The smoke-test doc's alpha limits.
   - The post-alpha list.

## Review Focus

1. **Options persistence across tool switches and relaunch.** New bar controls keep their value per tool, as the existing paint options do, and stale saved options still load (sanitised).
2. **Grayscale and channel targets.** New controls on a grayscale image, or on a mask or channel target, are disabled or behave, and never throw.
3. **Undo granularity.** Each new commit-on-change control (stroke options, W/H, align, Colorize) makes one history step, not one per keystroke or drag tick.
4. **Busy and inert states.** New controls respect `busy` and `geometryActive`, as the bar's existing ones do.
5. **Host param validation.** Unknown or out-of-range host params return an error rather than panic or silently clamp to something different from Photoshop.
