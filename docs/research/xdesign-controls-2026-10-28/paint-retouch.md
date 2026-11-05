# XDesign photo vs Photoshop 2026: paint and retouch tool controls

Audit date: 2026-10-28. Read-only. No repo file was edited; Photoshop was not opened and no .psd file was touched.

Scope: options-bar depth for the 22 paint/retouch tools, plus the brush preset picker, Brush Settings panel,
tool presets, Clone Source panel and Gradient Editor. Out of scope: AI/generative options (for example
Spot Healing "Generative"), cloud (Get More Brushes), video (Clone Source frame offset / lock frame), 3D, visual styling.

## Legend and paths

Status:
- PRESENT: the control exists with Photoshop's options.
- PARTIAL: the control exists but values, options or range are missing or wrong.
- MISSING-UI: the engine (or the host) already accepts it; only UI is needed.
- MISSING: needs engine or host (Rust) work. "host-only" means the photocraft engine already has the
  building block and only `src-tauri` glue is needed.

Effort: S = under a day, UI or a param pass-through; M = a few days, new host logic; L = new algorithm or large UI.
Impact: designer impact H/M/L.

Counting rule: the headline counts only Photoshop controls that Adobe's docs confirm. Rows tagged
`[PS: unverified]` are listed for completeness but are not counted. XDesign controls that PS does not
document are listed as "Extras" under each table and are not counted.

Evidence paths (shortened):
- UI = `/Users/lucaorion/Orion_Terminal/src/apps/xdesign/photo/`
- Host = `/Users/lucaorion/Orion_Terminal/src-tauri/src/`
- Eng = `/Users/lucaorion/.cargo/git/checkouts/photocraft-58992417ad0aec0a/47f9306/crates/`

Shared facts used in many rows:
- Options-bar fields per tool: UI `PaintToolOptions.tsx:33-48`. Brush-bar buttons per tool: UI `toolBars.tsx:205-214`.
- Opacity slider is shown for every brush tool except Background Eraser: UI `PhotoStudio.tsx:707-708,1806`.
- Host-painted strokes (Clone, Healing, Spot Healing, History, Dodge/Burn/Sponge, Blur/Sharpen, Mixer, Color
  Replacement, Smudge) read the shared engine brush (`engine.tools.brush`: angle, build-up/airbrush, pressure,
  dynamics): Host `xdesign_photo_retouch.rs:80`, `xdesign_photo_retouch_dabs.rs:52`. So a missing Airbrush, Angle
  or pressure button on those tools is MISSING-UI, not MISSING.
- Mode lists: layer blend list of 27 modes, UI `controls.ts:67`; engine `color/src/blend.rs:11-41` has no Behind,
  Clear or Replace. Behind/Clear exist only for Edit > Fill, in Host `xdesign_photo_fill_modes.rs:1`.
- XDesign keeps one brush (`engine.tools.brush`) for all tools, whereas PS keeps a brush per tool.
- The Brush Settings panel is a generic JSON form over the engine's `BrushSettings`: UI `BrushPanel.tsx:24-35`,
  `LayerEffects.tsx:22-55`. It shows every field except tip, color, background, erase, seed, a sampled texture
  pattern and the dual-brush tip (`BrushPanel.tsx:29-31`). So engine-only fields such as the four smoothing
  options do appear there, as raw fields.

## Headline

XDesign has 125 of 199 doc-confirmed Photoshop controls fully: **63%**.
- Tool options bars alone (22 tools + shared toggle): 90 of 133 (68%).
- Brush picker, Brush Settings, tool presets, Clone Source, Gradient Editor: 35 of 66 (53%).
- The 74 gaps: 20 PARTIAL, 20 MISSING-UI, 34 MISSING.
- Of the MISSING items, 7 are host-only: Spot Healing Sample All Layers, Mixer load/clean menu, Pattern Stamp
  scale, Spot Healing Mode (layer modes; Replace needs engine work), Blur/Sharpen/Smudge Mode.
- Counts were checked with a script over the tables (2026-10-28): it skips `[PS: unverified]` and `[n/a]` rows
  and the Top 15 table.

## Top 15 gaps, ranked by impact / effort

Score = impact (H3, M2, L1) / effort (S1, M2, L3). Ties go to the gap that touches more tools.

| # | Gap | Status | Effort | Impact | Evidence |
|---|-----|--------|--------|--------|----------|
| 1 | Spot Healing: Sample All Layers | MISSING (host-only) | S | H | Host `xdesign_photo_retouch.rs:142` forces `SampleLayers::Current`; same code honours `sampleLayer` for Clone/Healing |
| 2 | Smoothing: default 0% vs 10%, and the 4 options only as raw fields in Brush Settings, not in the options-bar gear (Brush, Pencil, Mixer, Eraser) | PARTIAL | S | M | UI `PaintToolOptions.tsx:18`, `PhotoStudio.tsx:2009`; Eng `paint/src/brush.rs:329-349` |
| 3 | Tool preset picker dropdown on the options bar (only an inert icon now) | MISSING-UI | S | M | UI `PhotoStudio.tsx:1992`; Eng `engine/src/presets/tools.rs:143-190` |
| 4 | Brush preset folder groups and Create New Group in the picker | MISSING-UI | S | M | UI `OptionsBarControls.tsx:128-175`; Eng `brush.presets.move/moveGroup/renameGroup/deleteGroup` |
| 5 | Brush Settings Texture: real pattern picker (only 4 procedural styles now) | PARTIAL | S | M | UI `LayerEffects.tsx:40`; Eng `engine/src/pattern_cmds.rs:422` (`brush.texturePattern`) |
| 6 | Brush Settings Dual Brush: second-tip selection | MISSING-UI | S | M | UI `BrushPanel.tsx:31` strips `dualBrush.tip`; Eng `paint/src/brush.rs` DualBrush.tip |
| 7 | Brush Settings Color Dynamics units: Hue/Saturation/Brightness Jitter as fractions, Purity -1..1 not -100..100 | PARTIAL | S | M | UI `LayerEffects.tsx:9,32`; Eng `paint/src/brush.rs:245-256` |
| 8 | Mixer: load swatch menu (Load Brush, Clean Brush, Load Solid Colors Only) | MISSING (host-only) | S | M | Eng `paint/src/mixer.rs:51,56` `load()`/`clean()`; Host `xdesign_photo_retouch_dabs.rs:56-66` uses them only after a stroke |
| 9 | Mixer: combination preset dropdown (Wet/Load/Mix sets; names unverified) | MISSING-UI | S | M | UI `PaintToolOptions.tsx:45` |
| 10 | Live Gradient: on-canvas stop editing (add, drag, remove, recolor, colour HUD) and midpoints | MISSING-UI | M | H | Eng `engine/src/gradient_fill_cmds.rs:1-12,255`, built for on-canvas edits; UI has only the drag line (`PhotoStudio.tsx:1113`) |
| 11 | Patch draws its own lasso (Shift add / Alt subtract / Alt+Shift intersect) | MISSING-UI | M | H | UI `PhotoStudio.tsx:729,1861-1868` require a prior selection |
| 12 | Paint Bucket: All Layers | MISSING | M | H | Eng `engine/src/paint_cmds.rs:116-124` has no all-layers param |
| 13 | Patch: Content-Aware mode (Structure 1-7, Color 0-10, Sample All Layers) | MISSING | L | H | UI `PaintToolOptions.tsx:34`; no content-aware patch in Eng `engine/src/retouch_cmds.rs:646-700` |
| 14 | Ignore Adjustment Layers (Clone Stamp, Healing Brush) | MISSING | M | M | UI `PaintToolOptions.tsx:25`; no option in Host `xdesign_photo_retouch.rs:142-144` sampling |
| 15 | Paint Bucket: Mode, including Clear | MISSING | M | M | Eng `engine/src/paint_cmds.rs:116-124` has no mode; Host `xdesign_photo_fill_modes.rs:1` already does Behind/Clear for Edit > Fill |

Next by score (1.0 and below), in order:
- Brush/Pencil Mode Behind and Clear (MISSING, M, M).
- Healing Brush Source Sampled/Pattern (MISSING, M, M). Healing and Patch Diffusion (MISSING, M, M).
- Clone Source from another open document (MISSING, M, M).
- Gradient Editor midpoints: MISSING-UI for fill layers, MISSING for classic (M, M).
- Brush tip grid in Brush Settings (MISSING-UI, M, M).
- Each S/L: Pattern Stamp scale (host-only), Use Sample Size, Brush rename, Clone Source aspect link, Mixer
  Airbrush, Background Eraser pen-size menu, Control lists per control, Clear Brush Controls, Sort by Tool,
  picker Create New Brush icon, Eraser Block hiding Opacity/Flow, Replace Gradients, angle/roundness drag box.
- Symmetry presets (MISSING, L, M). Bristle tips (MISSING, L, M).
- Each 0.5 or below: Spot Healing Mode and Replace, Healing Mode list trimmed to 8 plus Replace, Blur/Sharpen/Smudge
  Mode, stroke preview strip and hover preview, Gradient Smoothness, Gradient and ABR export, Impressionist,
  Patch Transparent and Use Pattern, Noise gradients, Erodible/Airbrush tips, Legacy Gradients, brush preset
  include-tool-settings/colour, Convert All to Brush Presets.

## Wrong range, default or unit (clear from the code)

1. Smoothing defaults to 0%; PS default is 10%. UI `PaintToolOptions.tsx:18`; the engine default is also 0
   (Eng `paint/src/brush.rs:347`), and the field resyncs from it (`PaintToolOptions.tsx:91-92`).
2. Color Dynamics Hue, Saturation and Brightness Jitter show as raw 0..1 fractions with no "%"; PS shows %.
   UI `LayerEffects.tsx:9,32` (not in the percent lists).
3. Purity shows -1..1; PS is -100 to +100. Same lines; Eng `paint/src/brush.rs:256`.
4. Healing Brush Mode offers all 27 layer modes and no Replace; PS offers 8 (Normal, Replace, Multiply, Screen,
   Darken, Lighten, Color, Luminosity). UI `PaintToolOptions.tsx:15,25,38`.
5. Eraser Block mode still shows and sends Opacity and Flow; PS Block has neither. UI `PhotoStudio.tsx:1806`,
   `PaintToolOptions.tsx:33,117`.
6. Smoothing amount is % on the options bar but a raw 0..1 number in Brush Settings (`smoothing.amount` is not in
   the percent lists). UI `LayerEffects.tsx:32`.
7. Texture Brightness/Contrast show raw -1..1, while the engine itself documents them as "Photoshop's -150..150
   mapped to ±1" (Eng `paint/src/brush.rs:175`). helpx does not state these ranges.

Checks that the docs do not settle (not counted as wrong):
- Brush size caps at 1000 px (5000 px only for Background Eraser): UI `PhotoStudio.tsx:1963-1965,1993`. PS upper
  limit unverified (commonly 5000 px).
- "Always use pressure for size" starts on (Eng `paint/src/brush.rs:428`). PS default unverified.
- Brush spacing default 10% (Eng default 0.1; UI `PaintToolOptions.tsx:19`). PS default unverified.
- Brush Flow minimum 0 (`PaintToolOptions.tsx:19`) while retouch tools use 1 (`:20`). PS minimum unverified.
- Brush Pose Pressure shows 0..1. PS range unverified.
- Spot Healing Type offers Create Texture and Proximity Match. Desktop 2026 docs mention only Content-Aware.
- Gradient Method offers Smooth and Stripes (UI `gradientMethod.ts:3`). helpx lists Perceptual, Linear, Classic.

## Per-tool tables

### Shared options-bar items

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Toggle Brush Settings panel button | PRESENT | UI `toolBars.tsx:218`, `PhotoStudio.tsx:1996` | - | - | - |

Tool preset picker: see "Tool presets". Brush preset picker: see "Brush preset picker".

### 1. Brush

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode: 29 entries incl. Behind, Clear | PARTIAL: 27 layer modes, no Behind/Clear | UI `PaintToolOptions.tsx:15,33`, `controls.ts:67` | No Behind/Clear in Eng `color/src/blend.rs:11-41` | M | M |
| Opacity % | PRESENT | UI `PhotoStudio.tsx:1806` | - | - | - |
| Pressure for Opacity | PRESENT | UI `toolBars.tsx:206` | - | - | - |
| Flow % | PRESENT | UI `PaintToolOptions.tsx:19` | - | - | - |
| Airbrush | PRESENT | UI `toolBars.tsx:206` | build_up | - | - |
| Smoothing % 0-100, default 10% | PARTIAL: default 0% | UI `PaintToolOptions.tsx:18` | Eng `engine/src/brush_cmds.rs:169`, default `paint/src/brush.rs:347` | S | M |
| Smoothing gear: Pulled String, Stroke Catch-Up, Catch-up on Stroke End, Adjust for Zoom | PARTIAL: raw fields in Brush Settings only; the bar gear has only "Native feedback" | UI `PhotoStudio.tsx:2009`, `BrushPanel.tsx:29-34` | Eng `paint/src/brush.rs:329-343` (all four) | S | M |
| Pressure for Size | PRESENT | UI `toolBars.tsx:206` | - | - | - |
| Symmetry: 10 presets (Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial 2-12, Mandala 3-10), custom path, Transform Symmetry | PARTIAL: path symmetry only (Off, Work Path, Selected Shape Layer Path, saved paths) | UI `toolBars.tsx:222-247` | Eng `engine/src/symmetry_cmds.rs:125,135`: one mirror across a path | L | M |
| Angle field [PS: unverified] | PRESENT (-180..180) | UI `toolBars.tsx:222-247` | - | - | - |

Extras: Spacing % on the bar (PS keeps Spacing in Brush Settings).

### 2. Pencil

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode: same list as Brush (Clear names Pencil) | PARTIAL: no Behind/Clear | UI `PaintToolOptions.tsx:15,33` | Eng `color/src/blend.rs:11-41` | M | M |
| Opacity % | PRESENT | UI `PhotoStudio.tsx:1806` | - | - | - |
| Pressure for Opacity | PRESENT | UI `toolBars.tsx:207` | - | - | - |
| Pressure for Size | PRESENT | UI `toolBars.tsx:207` | - | - | - |
| Smoothing % | PARTIAL: default 0% | UI `PaintToolOptions.tsx:18,33` | as Brush | S | M |
| Smoothing gear (4 options) | PARTIAL: Brush Settings only | UI `PhotoStudio.tsx:2009` | as Brush | S | M |
| Symmetry | PARTIAL: path only | UI `toolBars.tsx:207,222-247` | as Brush | L | M |
| Auto Erase | PRESENT | UI `PaintToolOptions.tsx:33` | - | - | - |
| Flow [PS: unverified] | PRESENT in XDesign | UI `PaintToolOptions.tsx:19,33` | - | - | - |
| Angle field [PS: unverified] | PRESENT | UI `toolBars.tsx:207` | - | - | - |

### 3. Color Replacement

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode (doc names only "Color"; full list unverified) | PRESENT: Hue, Saturation, Color, Luminosity; default Color | UI `PaintToolOptions.tsx:46` | Host `xdesign_photo_retouch_dabs.rs:73` | - | - |
| Sampling: Continuous, Once, Background Swatch | PRESENT | UI `PaintToolOptions.tsx:46` | - | - | - |
| Limits: Discontiguous, Contiguous, Find Edges | PRESENT | UI `PaintToolOptions.tsx:46` | - | - | - |
| Tolerance % | PRESENT (default 30) | UI `PaintToolOptions.tsx:46` | - | - | - |
| Anti-alias | PRESENT | UI `PaintToolOptions.tsx:46` | - | - | - |
| Pen Size menu in the picker [PS: unverified] | MISSING-UI: no pressure button | UI `toolBars.tsx:205-214` (no entry) | shared brush, Host `xdesign_photo_retouch_dabs.rs:52` | S | L |

Extras: Opacity, Flow, Spacing, Smoothing (`PaintToolOptions.tsx:46` spreads the Brush fields).

### 4. Mixer Brush

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Current Brush Load swatch + menu: Load Brush, Clean Brush, Load Solid Colors Only | MISSING | none in UI | Eng `paint/src/mixer.rs:51,56` `load()`/`clean()` on the persistent `engine.tools.mixer`; Host calls them only around a stroke (`xdesign_photo_retouch_dabs.rs:56-66`) | S (host-only) | M |
| Load the brush after each stroke | PRESENT | UI `PaintToolOptions.tsx:45` | Host `xdesign_photo_retouch_dabs.rs:64` | - | - |
| Clean the brush after each stroke | PRESENT | UI `PaintToolOptions.tsx:45` | Host `xdesign_photo_retouch_dabs.rs:56` | - | - |
| Combination preset dropdown (names/values unverified) | MISSING-UI | - | Wet/Load/Mix accepted | S | M |
| Wet % | PRESENT | UI `PaintToolOptions.tsx:45` | - | - | - |
| Load % | PRESENT | UI `PaintToolOptions.tsx:45` | - | - | - |
| Mix % | PRESENT | UI `PaintToolOptions.tsx:45` | - | - | - |
| Airbrush | MISSING-UI | UI `toolBars.tsx:205-214` (no mixer entry) | shared brush build_up via Host `xdesign_photo_retouch_dabs.rs:52` | S | L |
| Sample All Layers | PRESENT | UI `PaintToolOptions.tsx:45` | - | - | - |
| Smoothing % | PARTIAL: default 0% | UI `PaintToolOptions.tsx:18,45` | as Brush | S | M |
| Smoothing gear (4 options) | PARTIAL: Brush Settings only | UI `PhotoStudio.tsx:2009` | as Brush | S | M |
| Flow [PS: unverified] | PRESENT in XDesign | UI `PaintToolOptions.tsx:45` | - | - | - |
| Pressure toggles, Angle [PS: unverified] | MISSING-UI | UI `toolBars.tsx:205-214` | shared brush | S | L |

Extras: Opacity, Spacing.

### 5. Clone Stamp

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode (examples only; full list unverified) | PRESENT: 27 layer modes | UI `PaintToolOptions.tsx:15,25` | Eng `engine/src/retouch_cmds.rs:646-700` | - | - |
| Opacity % | PRESENT | UI `PhotoStudio.tsx:1806` | - | - | - |
| Flow % | PRESENT | UI `PaintToolOptions.tsx:25` | - | - | - |
| Aligned | PRESENT | UI `PaintToolOptions.tsx:25` | - | - | - |
| Sample: Current Layer, Current & Below, All Layers | PRESENT | UI `PaintToolOptions.tsx:12,25` | Host `xdesign_photo_retouch.rs:142-144` | - | - |
| Ignore Adjustment Layers (archived doc) | MISSING | - | no option in Host sampling (`xdesign_photo_retouch.rs:142-144`) or Eng | M | M |
| Toggle Clone Source panel button [PS: unverified] | MISSING-UI: panel is a flyout / Properties section | UI `PhotoStudio.tsx:2100,2124` | - | S | L |
| Airbrush, pressure toggles [PS: unverified] | PRESENT in XDesign | UI `toolBars.tsx:210` | - | - | - |

Extras: Spacing; Transform source, Source W/H, Rotation and Flip on the bar (PS keeps these in the Clone Source panel).

### 6. Pattern Stamp

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode | PRESENT | UI `PaintToolOptions.tsx:40` | Host `xdesign_photo_pattern_stamp.rs:93-96` | - | - |
| Opacity % | PRESENT | UI `PhotoStudio.tsx:1806` | - | - | - |
| Pattern picker | PRESENT (names-only select) | UI `PaintToolOptions.tsx:184` | - | - | - |
| Pattern picker Scale slider | MISSING | - | Host fixes scale at 1.0 (`xdesign_photo_pattern_stamp.rs:102`); Eng `compose/src/pattern.rs:149` `Placement::new` takes a scale | S (host-only) | L |
| Aligned | PRESENT | UI `PaintToolOptions.tsx:40` | Host `xdesign_photo_pattern_stamp.rs:100-101` | - | - |
| Impressionist | MISSING | - | none in Host or Eng | M | L |
| Flow, Airbrush [PS: unverified] | PRESENT in XDesign | UI `PaintToolOptions.tsx:20,40`, `toolBars.tsx:211` | - | - | - |

### 7. History Brush

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode | PRESENT | UI `PaintToolOptions.tsx:39` | - | - | - |
| Opacity % | PRESENT | UI `PhotoStudio.tsx:1806` | - | - | - |
| Source = History panel state/snapshot | PRESENT | UI `PhotoStudio.tsx:1107` (`historySource`), `HistoryBrushSource.tsx` | - | - | - |
| Flow, Airbrush, pressure toggles [PS: unverified] | PRESENT in XDesign | UI `PaintToolOptions.tsx:20,39`, `toolBars.tsx:212` | - | - | - |

### 8. Eraser

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode: Brush, Pencil, Block | PRESENT | UI `PaintToolOptions.tsx:17,33,117` | - | - | - |
| Opacity % | PRESENT | UI `PhotoStudio.tsx:1806` | - | - | - |
| Flow % (Brush, Pencil modes) | PRESENT | UI `PaintToolOptions.tsx:19,33` | - | - | - |
| Block mode has no Opacity/Flow | PARTIAL: both still shown and sent in Block | UI `PhotoStudio.tsx:1806`, `PaintToolOptions.tsx:117` | - | S | L |
| Smoothing % | PARTIAL: default 0% | UI `PaintToolOptions.tsx:18,33` | as Brush | S | M |
| Smoothing gear (4 options) | PARTIAL: Brush Settings only | UI `PhotoStudio.tsx:2009` | as Brush | S | M |
| Erase to History | PRESENT | UI `PaintToolOptions.tsx:33`, `PhotoStudio.tsx:1107` | - | - | - |
| Symmetry | PARTIAL: path only | UI `toolBars.tsx:208,222-247` | as Brush | L | M |
| Airbrush, pressure toggles, Angle [PS: unverified] | PRESENT in XDesign | UI `toolBars.tsx:208` | - | - | - |

### 9. Background Eraser

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Picker Size pen menu (Off, Pen Pressure, Stylus Wheel; archived) | MISSING-UI | UI `toolBars.tsx:205-214` (no entry) | Eng `paint/src/bg_erase.rs` strokes use `BrushSettings` (`pressure_size`, Control) | S | L |
| Picker Tolerance pen menu (archived) | MISSING | - | Eng `paint/src/bg_erase.rs:21,55`: one fixed tolerance | M | L |
| Sampling: Continuous, Once, Background Swatch | PRESENT | UI `PaintToolOptions.tsx:37` | - | - | - |
| Limits: Discontiguous, Contiguous, Find Edges | PRESENT | UI `PaintToolOptions.tsx:37` | - | - | - |
| Tolerance % | PRESENT (default 50) | UI `PaintToolOptions.tsx:37` | - | - | - |
| Protect Foreground Color | PRESENT | UI `PaintToolOptions.tsx:37` | - | - | - |

### 10. Magic Eraser

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Tolerance 0-255 | PRESENT (default 32) | UI `PaintToolOptions.tsx:36` | - | - | - |
| Anti-alias | PRESENT | UI `PaintToolOptions.tsx:36` | - | - | - |
| Contiguous | PRESENT | UI `PaintToolOptions.tsx:36` | - | - | - |
| Sample All Layers | PRESENT | UI `PaintToolOptions.tsx:36` | - | - | - |
| Opacity % | PRESENT | UI `PaintToolOptions.tsx:36` | - | - | - |

### 11. Gradient, live "Gradient" mode (2026 default)

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Gradient / Classic gradient switch | PRESENT | UI `PhotoStudio.tsx:2006` | - | - | - |
| Gradient preset bar | PRESENT | UI `toolBars.tsx:190-202`, `PhotoStudio.tsx:2006` | - | - | - |
| Type: Linear, Radial, Angle, Reflected, Diamond | PRESENT | UI `OptionsBarControls.tsx:51` | - | - | - |
| Dither | PRESENT | UI `PaintToolOptions.tsx:48` | - | - | - |
| Reverse | PRESENT | UI `PhotoStudio.tsx:2008` | - | - | - |
| Drag the line again to change angle/length | PRESENT | UI `PhotoStudio.tsx:1113` (`gradient.fill.set` on a gradient fill layer) | - | - | - |
| On-canvas stops: click line to add, drag to move, drag off to remove, click/double-click to recolor, right-click colour HUD or presets | MISSING-UI | no widget in UI | Eng `engine/src/gradient_fill_cmds.rs:1-12` (stops "stay editable on canvas"), `gradient.fill.set` | M | H |
| On-canvas midpoint diamonds | MISSING-UI | UI `GradientFillDialog.tsx:73` only keeps existing midpoints | Eng `engine/src/gradient_fill_cmds.rs:255` accepts `midpoints` | M | M |
| Properties panel: edit after drawing, choose preset | PRESENT | UI `PhotoStudio.tsx:2130`, `GradientFillDialog.tsx` | - | - | - |
| Method in live mode [PS: unverified] | PRESENT | UI `PaintToolOptions.tsx:48`, `gradientMethod.ts:3` | - | - | - |

### 12. Gradient, Classic mode

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Click gradient sample to open Gradient Editor | PRESENT | UI `toolBars.tsx:197-198` | - | - | - |
| Mode (list unverified) | PRESENT: 27 layer modes | UI `PaintToolOptions.tsx:48` | Eng `engine/src/paint_cmds.rs:126-134` | - | - |
| Opacity % | PRESENT | UI `PhotoStudio.tsx:1806` (Gradient is a colour tool) | - | - | - |
| Transparency | PRESENT | UI `PhotoStudio.tsx:2008` | - | - | - |
| Method: Perceptual, Linear, Classic | PRESENT (+ Smooth, Stripes) | UI `gradientMethod.ts:3` | - | - | - |

Type, Reverse and Dither are the same controls as in live mode and are counted once, above.

### 13. Paint Bucket

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Fill source: Foreground, Pattern | PRESENT | UI `PaintToolOptions.tsx:47` | - | - | - |
| Pattern picker | PRESENT | UI `PaintToolOptions.tsx:184` | - | - | - |
| Mode, incl. Clear | MISSING | - | Eng `engine/src/paint_cmds.rs:116-124` has no mode; Host `xdesign_photo_fill_modes.rs:1` has Behind/Clear for Edit > Fill | M | M |
| Opacity % | PRESENT | UI `PhotoStudio.tsx:708,1806` | Eng `paint_cmds.rs:116-124` | - | - |
| Tolerance 0-255 | PRESENT (default 32) | UI `PaintToolOptions.tsx:47` | - | - | - |
| Anti-alias | PRESENT | UI `PaintToolOptions.tsx:47` | - | - | - |
| Contiguous | PRESENT | UI `PaintToolOptions.tsx:47` | - | - | - |
| All Layers | MISSING | - | no param in Eng `paint_cmds.rs:116-124` | M | H |

Extras: Pattern scale and angle on the bar.

### 14. Blur

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode (entries unverified) | MISSING | UI `PaintToolOptions.tsx:43` | Host `xdesign_photo_retouch_dabs.rs` applies no blend mode | S-M (host-only) | L |
| Strength % | PRESENT (default 50) | UI `PaintToolOptions.tsx:14,43` | - | - | - |
| Sample All Layers | PRESENT | UI `PaintToolOptions.tsx:43` | - | - | - |
| Pressure, Angle [PS: unverified] | MISSING-UI | UI `toolBars.tsx:205-214` | shared brush | S | L |

Extras: Opacity, Flow, Spacing.

### 15. Sharpen

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode (entries unverified) | MISSING | UI `PaintToolOptions.tsx:43` | as Blur | S-M (host-only) | L |
| Strength % | PRESENT | UI `PaintToolOptions.tsx:43` | - | - | - |
| Sample All Layers | PRESENT | UI `PaintToolOptions.tsx:43` | - | - | - |
| Protect Detail | PRESENT | UI `PaintToolOptions.tsx:43` | - | - | - |
| Pressure, Angle [PS: unverified] | MISSING-UI | UI `toolBars.tsx:205-214` | shared brush | S | L |

### 16. Smudge

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode (full list unverified) | MISSING | UI `PaintToolOptions.tsx:44` | Host `xdesign_photo_smudge.rs:45-47` reads only fingerPainting and sampleAllLayers | S-M (host-only) | L |
| Strength % | PRESENT | UI `PaintToolOptions.tsx:44` | - | - | - |
| Sample All Layers | PRESENT | UI `PaintToolOptions.tsx:44` | - | - | - |
| Finger Painting | PRESENT | UI `PaintToolOptions.tsx:44` | - | - | - |
| Pressure, Angle [PS: unverified] | MISSING-UI | UI `toolBars.tsx:205-214` | shared brush | S | L |

Extras: Opacity, Flow, Spacing.

### 17. Dodge

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Range: Shadows, Midtones, Highlights | PRESENT | UI `PaintToolOptions.tsx:26,41` | - | - | - |
| Exposure % | PRESENT (default 50) | UI `PaintToolOptions.tsx:26` | - | - | - |
| Airbrush | PRESENT | UI `toolBars.tsx:212` | - | - | - |
| Protect Tones | PRESENT | UI `PaintToolOptions.tsx:26` | - | - | - |
| Pressure toggle [PS: unverified] | PRESENT (size) | UI `toolBars.tsx:212` | - | - | - |

Extras: Opacity, Flow, Spacing, Angle.

### 18. Burn

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Range | PRESENT | UI `PaintToolOptions.tsx:26,41` | - | - | - |
| Exposure % | PRESENT | UI `PaintToolOptions.tsx:26` | - | - | - |
| Airbrush | PRESENT | UI `toolBars.tsx:212` | - | - | - |
| Protect Tones | PRESENT | UI `PaintToolOptions.tsx:26` | - | - | - |

Extras: as Dodge.

### 19. Sponge

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode: Saturate, Desaturate | PRESENT | UI `PaintToolOptions.tsx:42` | Host `xdesign_photo_retouch_dabs.rs:60` | - | - |
| Flow % | PRESENT | UI `PaintToolOptions.tsx:20,42` | - | - | - |
| Vibrance | PRESENT | UI `PaintToolOptions.tsx:42` | - | - | - |
| Airbrush [PS: unverified] | PRESENT | UI `toolBars.tsx:212` | - | - | - |

Extras: Opacity, Spacing, Angle, pressure for size.

### 20. Spot Healing Brush (generative options out of scope)

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode, incl. Replace (full list unverified) | MISSING: no field; host forces Normal | UI `PaintToolOptions.tsx:38`; Host `xdesign_photo_retouch.rs:145` | layer modes: host-only; Replace: not in Eng `color/src/blend.rs` | S (modes) / M (Replace) | L |
| Type: Content-Aware | PRESENT | UI `PaintToolOptions.tsx:38,179`; Host `xdesign_photo_retouch.rs:148` | - | - | - |
| Sample All Layers | MISSING | - | Host forces `SampleLayers::Current` (`xdesign_photo_retouch.rs:142`); the same path takes `sampleLayer` for Clone/Healing | S (host-only) | H |
| Diffusion [PS: unverified for 2026] | MISSING | - | none in Host | M | L |

Extras: Create Texture and Proximity Match types (desktop 2026 unverified), Opacity, Flow, Spacing.

### 21. Healing Brush

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Mode: Normal, Replace, Multiply, Screen, Darken, Lighten, Color, Luminosity | PARTIAL: all 27 layer modes, no Replace | UI `PaintToolOptions.tsx:15,25,38` | Replace not in Eng `color/src/blend.rs` | S (trim) + M (Replace) | L |
| Source: Sampled / Pattern (+ picker) | MISSING | - | Host heal samples the image only | M | M |
| Aligned | PRESENT | UI `PaintToolOptions.tsx:25` | - | - | - |
| Sample: Current Layer, Current & Below, All Layers | PRESENT | UI `PaintToolOptions.tsx:12,25` | - | - | - |
| Ignore Adjustment Layers | MISSING | - | not in Host or Eng | M | M |
| Diffusion slider (examples 2, 4, 6) | MISSING | - | not in Host heal | M | M |
| Size pen menu (archived) | PRESENT (as Pressure for Size button) | UI `toolBars.tsx:213` | - | - | - |
| Use Legacy [PS: unverified] | MISSING | - | - | - | - |
| Clone Source panel button [PS: unverified] | MISSING-UI | UI `PhotoStudio.tsx:2100` | - | S | L |

Extras: Opacity, Flow, Spacing, source transform fields on the bar.

### 22. Patch

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Draws its own selection; Shift add, Alt subtract, Alt+Shift intersect (icon cluster unverified) | MISSING-UI: needs an existing bounded selection | UI `PhotoStudio.tsx:729,1861-1868` | lasso selection and `SelectionModeCluster` exist (UI `OptionsBarControls.tsx`, `PhotoStudio.tsx:73`) | M | H |
| Patch: Normal / Content-Aware | MISSING: Normal only | UI `PaintToolOptions.tsx:34` | no content-aware patch in Eng `engine/src/retouch_cmds.rs:646-700` | L | H |
| Normal: Source / Destination | PRESENT | UI `PaintToolOptions.tsx:34` | Eng `retouch_cmds.rs:646-700` | - | - |
| Normal: Transparent | MISSING | - | none | M | L |
| Normal: Use Pattern + picker | MISSING | - | none | M | L |
| Normal: Diffusion | MISSING | - | none | M | M |
| Content-Aware: Structure 1-7 | MISSING | - | part of Content-Aware | (L above) | H |
| Content-Aware: Color 0-10 | MISSING | - | part of Content-Aware | (L above) | M |
| Content-Aware: Sample All Layers | MISSING | - | part of Content-Aware | (L above) | M |

### 23. Red Eye

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Pupil Size % | PRESENT (default 50; PS default unverified) | UI `PaintToolOptions.tsx:35`; Host `xdesign_photo_red_eye.rs` | - | - | - |
| Darken Amount % | PRESENT (default 50; PS default unverified) | UI `PaintToolOptions.tsx:35` | - | - | - |

## Brush preset picker and Brushes panel

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Size (px) slider + field | PRESENT (max 1000 px; PS max unverified) | UI `OptionsBarControls.tsx:143-155`, `PhotoStudio.tsx:1993` | - | - | - |
| Use Sample Size (sampled tips) | MISSING-UI | - | sampled tips keep their bitmap (Eng `paint/src/brush.rs:69` TipShape::Sampled) | S | L |
| Hardness % | PRESENT | UI `OptionsBarControls.tsx:160` | - | - | - |
| Preset list | PRESENT | UI `OptionsBarControls.tsx:128-175` | - | - | - |
| Folder groups + Create New Group icon | MISSING-UI: flat grid | UI `OptionsBarControls.tsx:128-175` | Eng `brush.presets.move/moveGroup/renameGroup/deleteGroup` | S | M |
| Create New Brush icon in the picker | MISSING-UI: save exists in the Brushes panel only | UI `BrushPanel.tsx:20` | Eng `brush.presets.save` | S | L |
| Hover live stroke preview (Brushes panel) | MISSING | - | no stroke-preview command in Eng `engine/src/brush_cmds.rs` | M | L |
| New Brush Preset with include tool settings / colour | PARTIAL: name only | UI `BrushPanel.tsx:20` | Eng `engine/src/brush_cmds.rs:745` takes `{name, brush}` only | M | L |
| Rename Brush | MISSING-UI | UI `BrushPanel.tsx:20` | Eng `brush.presets.rename` | S | L |
| Delete Brush | PRESENT | UI `BrushPanel.tsx:20` | - | - | - |
| Import Brushes (.abr) | PRESENT | UI `BrushPanel.tsx:11,20` | Eng `brush.presets.importAbr` | - | - |
| Export Selected Brushes | MISSING | - | no ABR export in Eng | M | L |
| Search field [PS: unverified in the picker] | MISSING-UI in the picker; PRESENT in the Brushes panel | UI `BrushPanel.tsx:20` | - | S | L |
| Angle/roundness widget in the picker [PS: unverified] | MISSING-UI | UI `OptionsBarControls.tsx:128-175` | angle, roundness | S | L |
| Recent brushes row [PS: unverified, community only] | MISSING-UI | - | - | S | L |

## Brush Settings panel (F5)

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Section checkboxes with lock icons | PRESENT | UI `BrushPanel.tsx:29-34` | Eng `paint/src/brush.rs:283-294` SectionLocks | - | - |
| Stroke preview strip | MISSING | - | no preview command | M | L |
| Tip Shape: Size, Flip X/Y, Angle, Roundness, Hardness, Spacing checkbox + % | PRESENT | UI `BrushPanel.tsx:29-34`, `LayerEffects.tsx:32` | Eng `paint/src/brush.rs:363,383-390` | - | - |
| Tip shape grid (choose a tip) | MISSING-UI: `tip` hidden | UI `BrushPanel.tsx:29` | Eng `paint/src/brush.rs:69` TipShape | M | M |
| Drag angle/roundness in the preview box | MISSING-UI | - | angle, roundness | S | L |
| Bristle tip options (Shape, Bristles, Length, Thickness, Stiffness, preview) | MISSING | - | TipShape is Round or Sampled only (Eng `paint/src/brush.rs:69`) | L | M |
| Erodible tip options (Softness, Shape, Sharpen Tip) | MISSING | - | as above | L | L |
| Airbrush tip options (Distortion, Granularity, Spatter Size/Amount) | MISSING | - | as above | L | L |
| Shape Dynamics: Size/Angle/Roundness Jitter, Minimum Diameter, Tilt Scale, Minimum Roundness, Brush Projection | PRESENT | UI `LayerEffects.tsx:32` | Eng ShapeDynamics | - | - |
| Control dropdowns per control (Direction entries only for Angle, etc.) | PARTIAL: every Control lists all 8 entries | UI `LayerEffects.tsx:38` | Eng `paint/src/brush.rs:19-33` | S | L |
| Scattering: Scatter, Both Axes, Count, Count Jitter + Controls | PRESENT | UI `LayerEffects.tsx` form | Eng Scattering | - | - |
| Texture pattern swatch (picker) | PARTIAL: 4 procedural styles (noise, canvas, paper, dots) | UI `LayerEffects.tsx:40` | Eng `engine/src/pattern_cmds.rs:319,422` `brush.texturePattern` | S | M |
| Texture: Invert, Scale, Texture Each Tip, Mode, Depth, Minimum Depth, Depth Jitter + Control | PRESENT | UI `LayerEffects.tsx` form | Eng `paint/src/brush.rs:169` | - | - |
| Dual Brush second-tip selection | MISSING-UI: `dualBrush.tip` hidden | UI `BrushPanel.tsx:31` | Eng DualBrush.tip | S | M |
| Dual Brush: Mode, Diameter, Spacing, Scatter, Both Axes, Count | PRESENT | UI `LayerEffects.tsx` form | Eng DualBrush | - | - |
| Color Dynamics: Apply Per Tip, Foreground/Background Jitter + Control | PRESENT | UI `LayerEffects.tsx:9` (`jitter` is %) | Eng ColorDynamics | - | - |
| Hue, Saturation, Brightness Jitter % | PARTIAL: raw 0..1 fractions | UI `LayerEffects.tsx:9,32` | Eng `paint/src/brush.rs:252` | S | M |
| Purity -100..+100 | PARTIAL: raw -1..1 | UI `LayerEffects.tsx:9,32` | Eng `paint/src/brush.rs:256` | S | M |
| Transfer: Opacity Jitter, Flow Jitter + Controls | PRESENT | UI `LayerEffects.tsx` form | Eng Transfer | - | - |
| Brush Pose: Tilt X/Y, Rotation, Pressure + Overrides | PRESENT (Pressure shows 0..1; PS range unverified) | UI `LayerEffects.tsx` form | Eng Pose | - | - |
| Noise, Wet Edges, Build-up, Smoothing, Protect Texture | PRESENT | UI `LayerEffects.tsx` form | Eng `paint/src/brush.rs:400-410` | - | - |
| Panel menu: Clear Brush Controls | MISSING-UI | - | `tools.setBrush` can reset sections | S | L |
| Panel menu: Copy Texture To Other Tools [n/a] | not needed: XDesign has one brush for all tools | - | - | - | - |
| Texture Brightness / Contrast [PS: unverified] | PARTIAL: raw -1..1 | UI `LayerEffects.tsx:32` | Eng `paint/src/brush.rs:175` documents PS -150..150 | S | L |
| Flip X/Y Jitter [PS: unverified] | PRESENT | UI `LayerEffects.tsx` form | Eng ShapeDynamics | - | - |

## Tool presets

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Tool Preset picker dropdown at the left of the options bar | MISSING-UI: non-interactive icon | UI `PhotoStudio.tsx:1992` | Eng `tool.presets.select` (`engine/src/presets/tools.rs:143-190`) | S | M |
| Tool Presets panel + Create New Tool Preset (saves brush + options) | PRESENT | UI `AdditionalPresets.tsx:29`, `PhotoStudio.tsx:2112` | Eng `engine/src/presets/tools.rs:86-87` captures the brush | - | - |
| Show All / Show Current Tool Presets | PRESENT (Current tool only checkbox) | UI `AdditionalPresets.tsx:29` | - | - | - |
| Sort by Tool | MISSING-UI | UI `AdditionalPresets.tsx:29` | list is client data | S | L |
| Convert All to Brush Presets | MISSING | - | not found in Eng presets | M | L |
| Include Color [PS: unverified on 2026 page] | MISSING-UI: never sent | UI `AdditionalPresets.tsx:29` | Eng `engine/src/presets/tools.rs:89` `includeColor` | S | L |
| Rename [PS: unverified] | MISSING-UI | UI `AdditionalPresets.tsx:29` | Eng `tool.presets.edit` action rename | S | L |
| Delete [PS: unverified] | PRESENT | UI `AdditionalPresets.tsx:29` | - | - | - |
| Reset Tool / Reset All Tools [PS: unverified] | MISSING-UI | - | Eng `tool.presets.reset` | S | L |

## Clone Source panel and overlay

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| 5 clone source slots | PRESENT | UI `PhotoStudio.tsx:1911` | Eng `engine/src/presets/clone_source.rs:346-390` | - | - |
| Source from another open document | MISSING: "Sources sample the current image" | UI `PhotoStudio.tsx:1911-1913` | Eng clone source is per document | M | M |
| Offset X/Y px | PRESENT | UI `PhotoStudio.tsx:1911` | - | - | - |
| W / H % | PRESENT | UI `PhotoStudio.tsx:1911` | - | - | - |
| Maintain Aspect Ratio link (on by default) | MISSING-UI | UI `PhotoStudio.tsx:1911` | W and H are separate params | S | L |
| Rotation degrees | PRESENT | UI `PhotoStudio.tsx:1911` | - | - | - |
| Flip Horizontal / Vertical | PRESENT | UI `PhotoStudio.tsx:1911` | - | - | - |
| Reset Transform | PRESENT | UI `PhotoStudio.tsx:1911` | - | - | - |
| Show Overlay | PRESENT | UI `PhotoStudio.tsx:205-215` | - | - | - |
| Overlay Opacity % | PRESENT | UI `PhotoStudio.tsx:205-215` | - | - | - |
| Auto Hide | PRESENT | UI `PhotoStudio.tsx:211` | - | - | - |
| Clipped | PRESENT | UI `PhotoStudio.tsx:205-215` | - | - | - |
| Overlay mode: Normal, Darken, Lighten, Difference | PRESENT | UI `PhotoStudio.tsx:205-215` | - | - | - |
| Invert | PRESENT | UI `PhotoStudio.tsx:205-215` | - | - | - |
| Alt+Shift: show overlay and Move Source Overlay | MISSING-UI | no handler in UI `PhotoStudio.tsx` | `cloneSource.set` offset (`PhotoStudio.tsx:828`) | S | L |

## Gradient Editor

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Presets list | PRESENT | UI `GradientEditorDialog.tsx` | - | - | - |
| Name + New | PRESENT | UI `GradientEditorDialog.tsx:189` | Eng `gradient.presets.new` | - | - |
| Gradient Type: Noise (Roughness, Color Model, Restrict Colors, Add Transparency, Randomize) | MISSING: option disabled | UI `GradientEditorDialog.tsx:208` | none | L | L |
| Smoothness % | MISSING: fixed 100, disabled | UI `GradientEditorDialog.tsx:209` ("The engine blends stops linearly") | none | M | L |
| Opacity stops: Opacity, Location, Delete | PRESENT | UI `GradientEditorDialog.tsx` | - | - | - |
| Color stops: Color, Location, Delete | PRESENT | UI `GradientEditorDialog.tsx` | - | - | - |
| Midpoint diamonds + Location | MISSING-UI for fill layers; MISSING for classic | UI `GradientEditorDialog.tsx` (no midpoints) | Eng `engine/src/gradient_fill_cmds.rs:255` yes; `paint.gradient` (`paint_cmds.rs:126-134`) no | M | M |
| Load / Import .grd | PRESENT | UI `GradientEditorDialog.tsx:192,200` | Eng `gradient.presets.importGrd` | - | - |
| Save / Export .grd | MISSING: disabled | UI `GradientEditorDialog.tsx:192,201` | no GRD export in Eng | M | L |
| Replace Gradients | MISSING-UI | UI `GradientEditorDialog.tsx:196-202` | `gradient.presets.edit` delete + `importGrd` | S | L |
| Append Default Gradients | PRESENT | UI `GradientEditorDialog.tsx:199` | Eng `gradient.presets.reset` | - | - |
| Legacy Gradients | MISSING | - | not found in Eng | M | L |

## Photoshop sources

From Adobe helpx. D = `https://helpx.adobe.com/photoshop/desktop/` (live 2026 docs, release 27.11, Sep 2026).
U = archived `https://helpx.adobe.com/photoshop/using/<page>` via web.archive.org (the live /using/ URLs now redirect to D).
- Brush/Pencil: D `apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html`; D `repair-retouch/adjust-light-tone/blending-mode-descriptions.html`; D `repair-retouch/clean-restore-images/auto-erase-with-the-pencil-tool.html`; U `painting-tools.html`.
- Smoothing: D `repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html`.
- Symmetry: D `apply-painting-techniques/create-fill-with-patterns/paint-symmetrical-patterns.html`; U `paint-symmetry.html`.
- Color Replacement: U `replace-colors.html` (no 2026 page found).
- Mixer: D `apply-painting-techniques/create-fill-with-patterns/paint-with-mixer-brush.html`; U `painting-mixer-brush.html`.
- Clone/Healing/Spot/Clone Source: D `repair-retouch/heal-clone/*` (clone-source-panel, adjust-the-sample-source-overlay-options, scale-or-rotate-the-sample-source, set-sample-sources-for-cloning-and-healing, retouch-images-with-the-clone-stamp-tool); D `repair-retouch/clean-restore-images/healing-brush-tool.html`, `spot-healing-brush-tool.html`, `remove-small-spots-with-the-spot-healing-brush.html`; U `retouching-repairing-images.html`, `healing-examples.html`.
- Patch: D `repair-retouch/clean-restore-images/repair-a-selected-area-with-the-patch-tool.html`; D `repair-retouch/remove-objects-fill-space/use-the-content-aware-patch-tool.html`; U `content-aware-patch-move.html`.
- Pattern Stamp: D `apply-painting-techniques/create-fill-with-patterns/use-pattern-stamp-tool-for-hand-painted-look.html`. History Brush: D `get-started/set-up-toolbars-panels/paint-image-states.html`.
- Erasers: D `repair-retouch/clean-restore-images/erase-parts-of-an-image-with-the-eraser-tool.html`, `change-pixels-to-transparent-with-the-background-eraser-tool.html`, `change-similar-pixels-with-the-magic-eraser-tool.html`.
- Gradient: D `adjust-color/color-effects-techniques/apply-gradient-fill.html`, `edit-a-gradient.html`; U `gradients.html`, `gradient-interpolation.html`. Paint Bucket: D `apply-painting-techniques/fill-objects-selections-layers/fill-paint-bucket-tool.html`.
- Toning: D `effects-filters/blur-sharpen-filters/*`; D `apply-painting-techniques/fill-objects-selections-layers/smudge-image-areas.html`; D `repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html`, `adjust-color-saturation-in-selected-image-areas.html`. Red Eye: D `repair-retouch/clean-restore-images/remove-red-eye-in-flash-photos.html`.
- Brushes and Brush Settings: D `apply-painting-techniques/brushes-presets/*` (select-a-preset-brush, create-a-new-preset-brush, create-preset-brush-groups, import-brushes-brush-packs, display-brush-panel-brush-options, textured-and-dual-brush-settings, create-brush-set-painting-options); D `apply-painting-techniques/fill-objects-selections-layers/brush-dynamics-settings.html`; U `brush-presets.html`, `creating-modifying-brushes.html`.
- Tool presets: D `get-started/set-up-toolbars-panels/create-tool-preset.html`.
