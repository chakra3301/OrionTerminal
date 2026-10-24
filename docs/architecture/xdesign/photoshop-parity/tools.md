# XDesign Tools Audit vs Photoshop 2026

> Audit of 2026-10-22, before that day's interaction fixes. `file:line` references are as of the audit and drift. Statements the fixes made stale are marked **[resolved 2026-10-22]**; the consolidated spec is [../photoshop-parity.md](../photoshop-parity.md).

Scope: tools XDesign has (IMAGE_TOOL_GROUPS). Read-only audit. PS evidence = layout files under `/Applications/Adobe Photoshop 2026/.../Required/layouts/` (named per tool), `/tmp/ps_ref/shortcuts.txt`, `/tmp/ps_ref/ui_strings.txt` (lines 1048-1133 tooltips). Claims about PS behaviour not in those files are marked (from memory). Unconfirmed items are marked `unverified`.

Status words: ok / missing-but-capability-exists / relabel / wrong-range / wrong-control / extra.

## 1. Summary

- Toolbar groups are merged and ordered differently from PS: Selection and Retouch tools share groups; PS has separate Marquee, Lasso, Object Selection, Crop, Eyedropper, Healing, Brush, Stamp, History Brush, Eraser, Gradient/Bucket, Blur, Dodge, Pen, Type, Path Select, Shape, Hand, Zoom groups (`editorTools.ts` IMAGE_TOOL_GROUPS, 16 groups).
- Flyout is an invisible native `<select>` over a 15x15 chevron (`EditorChrome.tsx:96-117`, `editorChrome.css:38-45`), not PS's press-and-hold / right-click flyout with icon, name and shortcut per row.
- Options bar is table-driven plain number/select/checkbox fields (`PaintToolOptions.tsx` `PAINT_TOOL_FIELDS`). PS uses a brush-preset picker, mode icon clusters, airbrush and pressure toggles, angle dial, and sliders-in-popovers.
- Many PS options are missing even though the capability exists: Move Auto-Select/align, Eyedropper sample size/sample layers/ring, Hand/Zoom buttons, Crop ratio/overlay/delete-cropped, Object Selection mode/Hard Edge, shape fill/stroke/W/H.
- Retouch tools show Flow/Spacing fields PS does not show for them (extra).
- **[resolved 2026-10-22]** Four gestures greyed out the whole UI (polygon lasso draft, pen draft, magnetic lasso trace, Move-tool transform drag) and several commits flashed. See section 5.
- Cursors: **[partly resolved 2026-10-22]** Move/Path selection (arrow), Type (I-beam), Eyedropper, Paint Bucket, Lasso, Magic Wand and Zoom out (Alt) now have their own cursors. Gradient, Patch, Crop, Clone/Heal source and the shape tools are still a plain crosshair.
- Missing keys: Shift+[ ] hardness, number-key opacity/flow, F screen mode, ⌘Space zoom, Shift-click straight line, ⌃⌥-drag resize, Tab hide panels. `[` `]` use a fixed step of 5.

## 2. Toolbar spec

Tooltip format: XDesign shows `${label} (${shortcut})` (`EditorChrome.tsx` ToolGroup ~96-117). PS tooltips are in ui_strings lines 1048-1133, format "Name (Letter)" (from memory). The rail is 40px (`photoshop.css` 40-63); tool buttons are 36px (`editorChrome.css` 38-45).

Target PS order (from memory, matches PS 2026 default toolbar) and XDesign status:

| # | PS group (letter, Shift+letter cycles) | XDesign status |
|---|---|---|
| 1 | Move (V) / Artboard | Move present; Artboard n/a. ok |
| 2 | Rectangular Marquee, Elliptical Marquee (M) | ok in tools; group merged with other selection tools: relabel/regroup |
| 3 | Lasso, Polygonal Lasso, Magnetic Lasso (L) | present; regroup |
| 4 | Object Selection, Quick Selection, Magic Wand (W) | present; regroup, order must be Object Selection first (from memory) |
| 5 | Crop (C) | ok |
| 6 | Eyedropper, Color Sampler (I) | Eyedropper only; `shortcuts.txt:119-120` confirm both on I |
| 7 | Spot Healing, Healing, Patch, Red Eye (J) | present for those XDesign has; Retouch merged: regroup |
| 8 | Brush, Pencil, Color Replacement, Mixer Brush (B) | present; check order |
| 9 | Clone Stamp, Pattern Stamp (S) | present |
| 10 | History Brush, Art History (Y) | History Brush present |
| 11 | Eraser, Background, Magic Eraser (E) | present |
| 12 | Gradient, Paint Bucket (G) | present; PS cycles with Shift+G |
| 13 | Blur, Sharpen, Smudge (no letter) | present |
| 14 | Dodge, Burn, Sponge (O) | present |
| 15 | Pen, Freeform, Curvature, Add/Delete/Convert Point (P) | pen tools present |
| 16 | Type (T) | present |
| 17 | Path Selection, Direct Selection (A) | present |
| 18 | Rectangle ... Custom Shape (U) | present (`SHAPE_TOOLS` PhotoStudio.tsx:86) |
| 19 | Hand (H) / Rotate View (R) | check; Rotate View unverified |
| 20 | Zoom (Z) | present |
| 21 | fg/bg chips, swap (X), default (D), Quick Mask (Q), screen mode (F) | chips, swap, default, Quick Mask present (`PhotoStudio.tsx:725-731`); screen mode (F) missing |

Group behaviour targets:
- Each group remembers last tool (XDesign does: `PhotoStudio.tsx:315-316` `lastTools`). ok.
- Press-and-hold or right-click opens flyout with a small triangle at lower-right of the button (from memory). XDesign: ChevronDown glyph and click on select. wrong-control.
- Shift+letter cycles tools in a group. XDesign: wired (`PhotoStudio.tsx` key handler, `choices` cycling). ok.

## 3. Per-tool spec

PS options layouts: Masks/Tools/{rectangleMarquee-1420, ellipticalMarquee-1430, lassoOptions-1440, polygonalLassoOptions-1441, magneticLassoOptions-1442, magicWandOptions-1444, quickSelection-1450, modernObjectSelectionToolOptions.eve, patchTool-4160}, Transform/Tools/{moveTool-3200, cropOptions-5500, cropOptions2-2380}, Painting/Tools/*, History/Tools/historyBrush-2690, Color/Tools/{eyedropper-2370, paintBucket-1810/1811}, Gradients/Tools/gradientToolOptions.eve, Canvas/Tools/{hand,zoom,rotate}, Paths/Tools/pathComponentSelectOptions-3720, Shapes/Tools/*, Type/Tools/textToolOptions-3701.

Selection-tool mode cluster in PS is four icons: New, Add, Subtract, Intersect (layout files above). XDesign has no mode cluster; modes come only from modifier keys (`selectionGesture.ts` `selectionGestureMode`).

### Move (V)
| Control | PS target | XDesign |
|---|---|---|
| Auto-Select (Layer/Group) + dropdown | moveTool-3200 | missing-but-capability-exists (hit-test layers); unverified whether any exists |
| Show Transform Controls | checkbox | XDesign shows handles always via `ImageTransformOverlay.tsx`; wrong-control |
| Align / Distribute buttons | present | missing |
| Cursor | arrow + scissors-less move (from memory) | generic |
| Modifiers | ⌘-drag distort/skew (ours, `ImageTransformOverlay.tsx`); Shift constrain / 15-degree rotate; arrows nudge 1, Shift 10 (`ImageTransformOverlay.tsx:61`) ok. Alt-drag duplicates (from memory): unverified in XDesign |

### Marquee (M), Elliptical
Target: mode cluster, Feather (px), Anti-alias (ellipse only), Style (Normal / Fixed Ratio / Fixed Size), Width, swap, Height, Select and Mask button (marquee layouts 1420/1430). XDesign: no mode cluster (extra: none), Feather/style status unverified; likely missing-but-capability-exists for Style. Modifiers: Shift add/constrain, Alt subtract/from-center, Shift+Alt intersect: XDesign `selectionGestureMode` implements Shift/Alt/Shift+Alt; `gestureRectangle` handles square/center. ok (confirm Shift-after-start behaviour unverified).

### Lasso (L), Polygonal, Magnetic
Target: mode cluster, Feather, Anti-alias, Select and Mask; Magnetic adds Width, Contrast, Frequency, Pen Pressure (1440/1441/1442). XDesign: Magnetic overlay supports `[` `]` width, CapsLock ring, Alt freehand, ⌘/Ctrl-click close, Esc/Enter/Backspace (`MagneticLassoOverlay.tsx`). Width/Contrast/Frequency numeric fields: unverified, likely missing-but-capability-exists. Polygonal: Shift snaps 45 degrees (`selectionGesture.ts` `polygonPoint`) ok. Lasso cursor added 2026-10-22.

### Object Selection (W), Quick Selection, Magic Wand
Target: mode cluster; Object Selection: Mode (Rectangle/Lasso), Sample All Layers, Auto-Enhance? Hard Edge, Subtract (modernObjectSelectionToolOptions.eve); Quick Selection: brush picker, Sample All Layers, Auto-Enhance; Magic Wand: Sample Size, Tolerance (default 32), Anti-alias, Contiguous, Sample All Layers (magicWandOptions-1444, quickSelection-1450). XDesign: Quick Selection never intersects (`selectionGesture.ts`), matching PS (from memory). Option fields: missing-but-capability-exists where `PAINT_TOOL_FIELDS` lacks them; Object Selection mode/Hard Edge missing.

### Crop (C)
Target: Ratio dropdown, W x H, swap, Straighten, Overlay options, Delete Cropped Pixels, Content-Aware (cropOptions-5500 / 2380). XDesign: `CropOverlay.tsx` has directional handle cursors, rotate stem, Shift 15-degree. Ratio/overlay/delete-cropped: missing-but-capability-exists. Apply is quiet and holds the crop box until the new image is shown **[resolved 2026-10-22]**; the old image still stretches to the new size for a frame (see spec).

### Eyedropper (I)
Target: Sample Size (Point Sample, 3x3 ... 101x101 Average), Sample (Current Layer, All Layers, etc.), Show Sampling Ring (eyedropper-2370). XDesign: `eyedropper.ts` samples a 1x1 display tile, point sample only. Sample Size: missing-but-capability-exists. Alt-eyedropper while painting is `SAMPLING_TOOLS` (`PhotoStudio.tsx:88`, `sampleColor` 390-397): ok for those six tools.

### Brush (B) / Pencil / Mixer Brush / Color Replacement
Target (from memory, painting layouts partly unlabelled): Tool preset, Brush preset picker (size, hardness, tip), Mode (blend), Opacity %, Pressure-opacity toggle, Flow %, Airbrush toggle, Smoothing %, Brush angle, Pressure-size toggle, symmetry. XDesign: number/select fields from `PAINT_TOOL_FIELDS` (size, hardness, opacity, flow, spacing, mode). Brush picker: wrong-control. Airbrush, smoothing, angle, pressure: missing. Defaults live in `paintToolDefaults`.

### Clone Stamp, Pattern Stamp, History Brush
Target: as Brush plus Aligned, Sample (Current Layer / Current & Below / All), Ignore Adjustment Layers, Show Overlay (clone). History Brush adds Mode/Opacity/Flow/Smoothing (historyBrush-2690). XDesign: Alt-click sets source in `resetStroke`/draw flow; aligned and overlay options: unverified / missing.

### Healing, Spot Healing, Patch, Red Eye
Target: Mode, Type (Content-Aware/Create Texture/Proximity Match), Sample All Layers, Diffusion; Patch: Source/Destination, Transparent, Use Pattern, Structure, Color (patchTool-4160). XDesign retouch tools show Flow and Spacing (extra). Patch options missing. No ring cursor for patch.

### Eraser, Background Eraser, Magic Eraser
Target: Mode (Brush/Pencil/Block), Opacity, Flow, Airbrush, Erase to History. Background: Limits, Tolerance, Protect Foreground. XDesign: `eraserTool` (`PhotoStudio.tsx:354-362`) uses brush fields; mode and Erase to History missing.

### Gradient, Paint Bucket
Target Gradient: gradient picker, five type icons (Linear/Radial/Angle/Reflected/Diamond), Mode, Opacity, Reverse, Dither, Transparency (gradientToolOptions.eve). Bucket: Source (Foreground/Pattern), Mode, Opacity, Tolerance (32), Anti-alias, Contiguous, All Layers (paintBucket-1810/1811). XDesign: gradient and bucket are in `SAMPLING_TOOLS`; fields come from `PAINT_TOOL_FIELDS`; type icons and picker: wrong-control/missing. Cursors: crosshair vs PS crosshair/bucket icon (from memory).

### Blur, Sharpen, Smudge, Dodge, Burn, Sponge
Target: brush picker, Mode/Range/Exposure or Strength, Protect Tones, Airbrush; Smudge Finger Painting. XDesign: Flow/Spacing extra; Range, Protect Tones, Exposure labels: relabel/missing.

### Pen, Freeform, Curvature, Add/Delete/Convert
Target options: Path/Shape/Pixels, Make Selection/Mask/Shape, Path operations, Rubber Band, Auto Add/Delete. XDesign pen draft (`PEN_TOOLS`, `PEN_DRAFT_TOOLS` PhotoStudio.tsx:86-88). Rubber Band, Auto Add/Delete: unverified/missing. Drafts no longer grey the UI **[resolved 2026-10-22]**.

### Path Selection, Direct Selection
Target: pathComponentSelectOptions-3720 (Select: Active Layers/All; Show Bounding Box; operations; align). XDesign: `PathEditOverlay.tsx` Alt on handle breaks smoothness (`dragKnot`), anchor 7px squares. Cursors: `photo.css:68-71` path edit cursors ok. Shift-click multi-select, ⌘ toggle: missing.

### Shapes (U)
Target: Mode (Shape/Path/Pixels), Fill, Stroke, stroke width, stroke type, W, link, H, path ops, alignment, arrange, corner radius, Anti-alias. XDesign: drag creation only; Fill/Stroke/W/H/radius controls missing-but-capability-exists.

### Type (T)
Target (textToolOptions-3701): orientation toggle, Font family, Style, Size, Anti-aliasing, Alignment x3, Colour, Warp, Character/Paragraph panel toggle, Cancel/Commit. XDesign `CanvasTextEditor.tsx`: textarea, ⌘Enter commits, Esc cancels. Options bar controls: unverified, likely partial. Commit is quiet; the text field stays until the rendered text is shown **[resolved 2026-10-22]**.

### Hand (H), Zoom (Z)
Target: Hand: Scroll All Windows, 100%, Fit Screen, Fill Screen. Zoom: Zoom In/Out buttons, Resize Windows, Zoom All, Scrubby Zoom, 100%, Fit, Fill (Canvas/Tools). XDesign: toolbar-level zoom exists; per-tool buttons missing. No zoom-out cursor (Alt) specified; missing.

## 4. Global keys and modifiers

| Key / gesture | PS target | XDesign |
|---|---|---|
| Space (hold) | temporary Hand | `spacePan` `PhotoStudio.tsx:290` ok |
| ⌘Space / ⌥⌘Space | temporary zoom in / out (from memory) | missing |
| ⌘ (hold) | temporary Move (with Auto-Select) | missing |
| Alt + eyedropper while painting | temporary eyedropper | ok for six tools (`SAMPLING_TOOLS`) |
| Alt-click source (clone, healing, history) | set source | present; unverified per tool |
| Shift-click | straight line between clicks | missing (grep found nothing) |
| `[` `]` | brush size, scaled step | fixed +-5 (relabel/wrong-range) |
| Shift+`[` `]` | hardness +-25% | missing |
| Number keys 1-0 | opacity (flow with Shift) | missing |
| ⌃⌥-drag (macOS) | resize / hardness | missing |
| X / D | swap / default colours | buttons and keys wired. ok |
| Q | Quick Mask | button and key wired. ok |
| F | cycle screen modes | missing |
| Tab | hide panels | missing (grep found nothing) |
| Arrow keys | nudge 1/10 | present in transform overlay only (`ImageTransformOverlay.tsx:61`) |
| Esc / Enter | cancel / commit | present in lasso, text, crop |
| Shift+letter | cycle group | wired. ok |

## 5. Gestures that grey out the UI, flash, or lose cursor feedback

**[resolved 2026-10-22]** Every row in the original table is fixed: drafts take no lock, gestures hold the lock quietly (`holdImageGesture`), every `runPhotoCommand` is quiet, and outlines, crop/selection boxes, text fields, path drafts and the transform preview stay on screen until the committed image has decoded. Gradient and Patch drags still use the plain crosshair. Remaining edges are listed in the consolidated spec, section 1.4.

## 6. Open questions

- ~~Shift+letter cycling~~ and ~~X/D/Q keys~~: confirmed wired (2026-10-22).
- Which of Feather, Style, Tolerance, Contiguous, Sample All Layers exist in `PAINT_TOOL_FIELDS`/selection options? Not fully mapped.
- PS brush option labels (Opacity/Flow) live in separate structures in the layout files, so those rows are (from memory).
- Whether PS 2026 toolbar defaults to two columns versus one: unverified.
