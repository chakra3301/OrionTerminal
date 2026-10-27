# XDesign Photoshop Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps found in the 2026-10-25 live audit, then wire the missing Photoshop 2026 editing features a graphic designer uses, in the owner's order.

**Architecture:** The photo editor drives the read-only photocraft engine through `xdesign_photo_command`. `command_supported()` in `src-tauri/src/xdesign_photo.rs` gates it. Features the engine already has need gate entries plus menus, dialogs and tools in `src/apps/xdesign/photo`. Features the engine lacks are host-side Rust modules next to `xdesign_photo_perspective_crop.rs` and `xdesign_photo_history.rs`. Design-mode fixes stay in `src/apps/xdesign/pencil`. Upstream OpenPencil and photocraft are never edited.

**Tech Stack:** Tauri 2, Rust (photocraft engine), React 19, TypeScript, Zustand, Vitest.

**Spec:** the owner's request of 2026-10-25, plus the audit at the top of `CLAUDE_LOG_ARCHIVE.md` ("XDesign photo vs Photoshop 2026: missing editing features audit"). The engine maps are in this plan's appendix.

## Global Constraints

- Order: Phase 1 (new gaps), then Phase 2 (MISSING-UI), then Phase 3 (MISSING, host engine work), then Phase 4 (designer essentials).
- Out of scope: cloud, AI or generative features (the owner has their own AI planned), video and 3D.
- No commit, push or staging without a fresh owner authorization. Preserve existing dirty work.
- No photocraft or `node_modules` edits. No new dependencies.
- Never invent tokens. Use the closest existing token and log the gap in PROGRESS.md for Hermes.
- Comments only for a non-obvious why.
- Rust gate: `cargo test --lib` from `src-tauri`. Add temporary timing logs around new Tauri commands, then remove them.
- Live checks only on the scratch-HOME release instance with the goR.sh guards. Never use the owner's projects or dev instance.
- Every edit previews in real time when Photoshop previews it.
- Keep these engine commands blocked: anything that runs nested command ids or writes executables (`file.automate.batch`, `file.scripts.browse`, `file.automate.runDroplet`, `file.automate.createDroplet`, `file.scripts.scriptEventsManager`), plus `file.closeAll`, `file.closeOthers` and `file.package`.

## Review Focus

1. **Fill Behind/Clear on a locked-transparency or empty layer.** Behind on an empty layer should equal Normal. Clear on an empty layer is a no-op that still makes one history step. Clear through a feathered selection removes alpha in proportion to coverage. Pinned in Task 1.
2. **Perspective Crop options bar values that disagree with the dialog.** One source of truth: W/H typed in the bar show up in the dialog, and Clear resets both. Pinned in Task 2.
3. **Zoom to fit on a page with one tiny layer.** Zoom goes above 100%, up to the 256× limit, and the content is centred. Pinned in Task 6.
4. **Keyboard zoom when the canvas is scrolled.** The canvas point at the viewport centre stays at the centre. Pinned in Task 6.
5. **Imported .fig with no meta.json, or meta.json that is not JSON.** Export falls back to the OpenPencil stub and does not throw. Pinned in Task 7.

---

## Phase 1: New gaps

### Task 1: Fill Mode Behind and Clear (host engine work)

**Files:**
- Create: `src-tauri/src/xdesign_photo_fill_modes.rs`
- Modify: `src-tauri/src/xdesign_photo.rs` (register the module; route `edit.fill` with `mode` Behind or Clear)
- Modify: `src/apps/xdesign/photo/imageCommands.ts` (`FILL_OPTIONS` Mode list)
- Test: Rust unit tests in the new module, plus `ImageDialogs.test.tsx`

**Interfaces:**
- Produces: `pub(super) fn fill_special(session: &mut PhotoSession, params: &Value) -> Result<Option<Value>, String>`. It returns `Ok(None)` when `mode` is not `behind` or `clear`, so the caller falls through to the engine.

Algorithm:
- Run the engine `edit.fill` with `mode:"normal"`, `opacity:100` onto a scratch copy of the active layer's pixels. That gives the fill colour per pixel for any `contents`.
- The fill coverage per pixel is the selection alpha, or 1 everywhere with no selection.
- **Behind:** `out = dst over (fill × coverage × opacity)`, so existing pixels stay on top.
- **Clear:** `out.a = dst.a × (1 − coverage × opacity)`, and RGB stays the same.
- Commit as one history step labelled "Fill".

- [ ] Step 1: Write the Rust tests:
  - `behind_keeps_opaque_pixels_and_fills_transparent_ones`: a half-opaque 2×1 layer filled red.
  - `clear_scales_alpha_by_coverage_and_opacity`: 50% opacity on an opaque pixel gives alpha 128 ±1.
  - `behind_on_empty_layer_matches_normal`.
  - `non_special_modes_fall_through` returns `Ok(None)`.
- [ ] Step 2: Run `cargo test --lib fill_special`. Expected: they fail to compile because the module is missing.
- [ ] Step 3: Implement it, and route it from the command dispatcher before the engine call.
- [ ] Step 4: Run `cargo test --lib`. Expected: all pass.
- [ ] Step 5: Add `["behind","Behind"],["clear","Clear"]` after Dissolve in the Fill Mode list. Update the existing Fill test to assert the order `Normal, Dissolve, Behind, Clear, …`.

### Task 2: Perspective Crop options bar

**Files:**
- Modify: `src/apps/xdesign/photo/toolBars.tsx` (export `CropSizeFields`; add `PerspectiveCropBar`)
- Modify: `src/apps/xdesign/photo/PerspectiveCropDialog.tsx` (read the size, resolution and grid from the tool options)
- Modify: `src/apps/xdesign/photo/PhotoStudio.tsx` (render the bar for tool `perspectiveCrop`)
- Test: `PhotoStudio.layout.test.tsx`

**Interfaces:**
- Produces: tool options key `perspectiveCrop: { width?: number; height?: number; resolution?: number; unit: "px"|"in"|"cm"|"mm"; showGrid: boolean }`.
- The dialog sends `{quad,width,height,interpolation}` as today. When W/H are set it uses them as the manual size. When a resolution is set, it chains `image.imageSize {resolution, resample:"none"}` and folds both into one "Perspective Crop" history step, the same way crop commit does.

- [ ] Step 1: Write the failing tests:
  - `perspective crop bar edits share the dialog size`: typing W 400 and H 300 makes Apply send `width:400,height:300`.
  - `Front Image fills the bar from the document`.
  - `Clear empties W/H/Resolution and restores the automatic size`.
- [ ] Step 2: Run `npx vitest run src/apps/xdesign/photo/PhotoStudio.layout.test.tsx -t "perspective crop bar"`. Expected: FAIL.
- [ ] Step 3: Implement it, reusing `CropSizeFields` and `cropSizePixels`. Show Grid draws a 3×3 projective grid inside the quad.
- [ ] Step 4: Run the focused tests again. Expected: PASS.

### Task 3: Perspective corner drags are whole pixels

**Files:** Modify `PerspectiveCropDialog.tsx` (`move`). Test: `PhotoStudio.layout.test.tsx`.

- [ ] Step 1: Write the failing test `perspective corner drag rounds to whole pixels`. Drag a corner to a fractional client point; the X/Y fields show integers.
- [ ] Step 2: Round in `move` with `Math.round` after clamping. Run the test. Expected: PASS.

### Task 4: History source marker appears once

**Files:** Modify `PhotoHistory.tsx`. Test: `PhotoHistory.test.tsx`.

- [ ] Step 1: Write the failing test `only the snapshot row marks the Open state as the source`. It expects exactly one `aria-pressed=true` source button.
- [ ] Step 2: Replace the "Open" row's source box with an inert spacer. Run the test. Expected: PASS.

### Task 5: Design inspector shows Figma names and rounded numbers

**Files:**
- Modify: `pencil/AppearancePanel.tsx` (`BLENDS` labels; `NumericValue` display)
- Modify: `pencil/SelectionProperties.tsx` (`NumberField` display)
- Modify: `pencil/MixedSelectionProperties.tsx` (blend labels)
- Test: `pencil/*.test.tsx` next to each

**Interfaces:**
- Produces: `export const BLEND_LABELS: Record<BlendMode,string>` in `AppearancePanel.tsx`, e.g. `PASS_THROUGH:"Pass through"` and `COLOR_BURN:"Color burn"`. The `<option value>` stays the raw enum.
- Produces: `export function displayNumber(value:number):number`, which rounds to 2 decimals. Used for `defaultValue` only. A commit only happens when the typed value differs from the displayed one.

- [ ] Step 1: Write the failing tests:
  - X `41.3999999` shows `41.4`, and blurring without typing commits nothing;
  - the Blend select shows "Pass through".
- [ ] Step 2: Implement, then run the focused tests. Expected: PASS.

### Task 6: Design zoom fit above 100% and centred keyboard zoom

**Files:**
- Create: `pencil/viewportZoom.ts`
- Modify: `pencil/PencilStudio.tsx` (menu items and keys use it)
- Test: `pencil/viewportZoom.test.ts`

**Interfaces:**
- Produces: `zoomAroundCenter(editor:Editor, level:number, size:{width:number;height:number}):void`. It calls `editor.setZoomAroundPoint(level, width/2, height/2)`. Upstream `zoomToLevel` forgets to scale the pan by the new zoom.
- Produces: `fitBounds(editor:Editor, bounds:Rect, size):void`. It is `zoomToBounds` without the `,1` cap (80 px padding, clamped to 0.02–256).
- Produces: `zoomToFitPage(editor, size)` and `zoomToFitSelection(editor, size)`, which use `computeBounds` and `computeAbsoluteBounds` from `@open-pencil/scene-graph/geometry`.

- [ ] Step 1: Write the failing tests, using `createEditor` with `getViewportSize` 800×600:
  - one 10×10 rect fits at zoom > 1 and is centred;
  - with pan (−300,−200) at zoom 1, `zoomAroundCenter(2)` keeps the canvas point under (400,300) fixed.
- [ ] Step 2: Implement it, and swap the PencilStudio call sites for ⌘+, ⌘−, ⌘0, ⇧0, ⇧1 and ⇧2. Run the tests. Expected: PASS.

### Task 7: .fig export keeps Figma's meta.json

**Files:**
- Modify: `pencil/figImportData.ts` (keep `parsed.metaJSON`)
- Modify: `pencil/figPaintCompatibility.ts` (rewrite `meta.json` in the exported zip)
- Test: `pencil/figPaintCompatibility.test.ts`

**Interfaces:**
- The import stores the original meta in the DOCUMENT node's `pluginData` entry `{pluginId:"open-pencil", key:"figMeta"}`. It persists with the project graph.
- The export removes that entry from the cloned export graph before `exportFigFile`. It then writes `meta.json` as the original JSON with `exported_at` set to now. When the stored meta is missing or invalid, it keeps the stub.

- [ ] Step 1: Write the failing tests:
  - `export restores client_meta and file_name from the imported meta`;
  - `invalid stored meta keeps the stub`;
  - `figMeta pluginData is not written into canvas.fig`.
- [ ] Step 2: Implement, then run the focused tests. Expected: PASS.

### Task 8: Project menu labels align (done in this session)

- `figma.css`: `.xd-figma-menu .xd-figma-menu-check`. The `.xd-pencil-layers span{flex:1}` rule leaked into the menu.
- Verified with a headless probe of the built CSS: the check column went from 86 px to 16 px, and labels start at 38 px.

### Task 9: Phase 1 verification

- [ ] Focused vitest for touched files, `npm run typecheck`, and `cargo test --lib`.
- [ ] Release build 10 and live checks on the scratch instance:
  - Fill Behind/Clear;
  - the perspective bar;
  - the history marker;
  - design menu, inspector, zoom and .fig re-export.

---

## Phase 2: MISSING-UI (the engine has the command)

Each task follows the same steps:
1. Add the gate entries with a Rust test in `xdesign_photo.rs` (`command_supported_allows_<group>`).
2. Add the menu, dialog or tool with a failing vitest that asserts the exact command id and params.
3. Implement.
4. Run focused tests.

Ids, params and history behaviour are in the appendix.

| Task | Group | Items |
|---|---|---|
| 10 | Layer | Stamp Visible ⌥⇧⌘E, Stamp Down ⌥⌘E; Select Top/Bottom/Above/Below ⌥⇧[ ⌥⇧] ⌥[ ⌥]; Add Above/Below to selection; Combine Shapes (Unite, Subtract Front, Intersect, Exclude, Merge Components); Vector Mask Reveal All/Hide All/Current Path/Disable/Unlink; New › Frame from Layers; New Layer Based Slice |
| 11 | Edit | Toggle Last State ⌥⌘Z; Define Brush Preset…; Define Pattern…; Define Custom Shape…; Purge › Clipboard; Presets › Preset Manager…; Find and Replace Text…; Check Spelling… |
| 12 | Edit (dialogs) | Auto-Align Layers…; Auto-Blend Layers…; Content-Aware Fill… (sampling, adaptations, output, live preview) |
| 13 | Warp options | Split Horizontally/Vertically/Crosswise, Remove Split, Grid (Default, 3×3, 4×4, 5×5, Custom) |
| 14 | Tools | Polygon and Star (`shape.create` polygon/star with sides and star ratio); Triangle (polygon, 3 sides); Ruler (`image.analysis.rulerTool`, Info readout, Straighten Layer); Count (`count.*`); Note (`notes.*`, Notes panel); Slice and Slice Select (`slice.*`) |
| 15 | Panels | Layer Comps; Measurement Log (`measurementLog.*`, Record Measurements); Clone Source overlay options; Character Styles and Paragraph Styles (`type.characterStyle.*`, `type.paragraphStyle.*`) |
| 16 | View | Clear Guides, Clear Selected Artboard Guides, Lock Slices, Clear Slices |
| 17 | File | File Info…; Scripts › Delete All Empty Layers, Flatten All Layer Effects, Flatten All Masks; Automate › Fit Image…, Conditional Mode Change…; Export › Color Lookup Tables…, Paths to Illustrator… (engine returns text, written through the save dialog); Export › Layers to Files… (host temp directory, then copy) |

## Phase 3: MISSING (host-side engine work)

| Task | Item | Approach |
|---|---|---|
| 18 | Image › Duplicate, Crop and Straighten Photos | New-document path: run in a throwaway session, move the result into a fresh session, publish, and return the photo id so the frontend switches to it |
| 19 | Single Row and Single Column Marquee | Frontend tool using `select.rect` with height or width 1 |
| 20 | Color Sampler tool | Host sample command (up to 10 points, stored per document), shown in the Info panel |
| 21 | Red Eye tool | Host module: a pupil-size and darken-amount filter inside a clicked radius |
| 22 | Pattern Stamp tool | Host module: paint the brush dab mask with a tiled pattern |
| 23 | History snapshots | Host history module: named snapshot rows, New Snapshot, Delete, and New Document from State (through Task 18) |
| 24 | View | Rotate View tool, Flip Horizontal, Fit Layer(s), Print Size, Pixel Grid, Layer Edges, Smart Guides, Snap To › Layers |
| 25 | Layer colour labels | Host metadata in the layer descriptor, plus a context-menu colour list |
| 26 | Actions panel | Record the command ids and params sent through `xdesign_photo_command` and play them back through the same gate. No nested engine scripts. |
| 27 | Paste without Formatting; Copy CSS/SVG | Type paste strips styles; Copy CSS/SVG serialises the shape or text layer host-side |

## Phase 4: Designer essentials

| Task | Item |
|---|---|
| 28 | Preferences: Units & Rulers, Guides/Grid/Slices colours and spacing (frontend setting store) |
| 29 | Save a Copy as Photoshop PDF (single page through the engine's `print_pdf`, written through the save dialog) and Export › Artboards to PDF (`file.export.artboardsToPdf` to a temp file) |
| 30 | Window › Options and Tools toggles, and Workspace › Reset Essentials |

Skipped as out of scope or not fitting the host model: Timeline, Variables data sets, Photomerge and HDR (need multi-file input; revisit after Task 18), Contact Sheet, Batch, Droplets, Scripts browse, Print with spooling, Revert (no source path; History covers it), Close All.

## Appendix: engine maps

These are the batch A and batch B agent reports from 2026-10-25, summarised in the session log. Key facts:

- **Gate surprises.**
  - `edit.*` passes only through the explicit list.
  - `view.*` is not a prefix, so `view.lockSlices`, `view.clearSlices` and `view.clearCanvasGuides` are blocked.
  - `layer.exportAs` and `layer.quickExportAsPng` are deny-listed.
- **Behind and Clear.** The engine has neither (`crates/color/src/blend.rs`).
- **Snapshots, colour samplers and action recording.** The engine has none of them.
- **Return types.** `edit.toggleLastState` returns a bare bool.
- **Layer selection.** `layer.select*` makes no history step. The add-to-selection ids are `layer.addAboveToSelection` and `layer.addBelowToSelection`.
- **Triangle.** There is no `triangle` kind; use `polygon` with `sides:3`.
- **`edit.definePattern`.** Its `rect` is `[x0,y0,x1,y1]`.
- **Find and spelling offsets.** `edit.findAndReplaceText` uses byte offsets, while `edit.checkSpelling` uses character indices.
- **Session-only state.** These are session state, so they are lost on a session rebuild: the Measurement Log, clone sources, and the brush, pattern and custom-shape libraries.
- **Commands that create documents.** These trip the one-document guard: `image.duplicate`, `file.automate.cropAndStraightenPhotos`, `file.scripts.loadFilesIntoStack`, photomerge and HDR.
