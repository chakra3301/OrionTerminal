# XDesign dialogs and control look vs Photoshop 2026

> Audit of 2026-10-22, before that day's interaction fixes. `file:line` references are as of the audit and drift. Statements the fixes made stale are marked **[resolved 2026-10-22]**; the consolidated spec is [../photoshop-parity.md](../photoshop-parity.md).

Read-only audit. Photoshop sources: `.../Contents/Required/layouts/**/*.exv` (legacy), `drover_layouts/**/*.eve`, `UIColors.txt`, `menu_strings.txt`. XDesign root: `~/Orion_Terminal/src/.../photo/` (abbreviated `photo/`). Tags: `(from memory)` = not in the files; `unverified` = not checked.

## 1. Summary

- Adjustments are modal dialogs in XDesign (`PhotoStudio.tsx:834`, re-edit at `:819`). Photoshop adds the adjustment layer and edits it live in the non-modal Properties panel. Only the destructive Image > Adjustments items in Photoshop are modal; XDesign has none of those in the Image menu (`:663-667`).
- Dialog button model differs. Photoshop: OK (default) on top of a right-hand column, Cancel below, Alt turns Cancel into Reset, optional Auto. XDesign: bottom-right row, Cancel then "Apply" (`ImageDialogs.tsx:9-15`, `PhotoActionDialog.tsx:203`), a separate "Reset all settings" button, no Alt-Reset.
- Preview model differs. Photoshop has a "Preview" checkbox that toggles the effect on the document canvas, plus zoom -/+ in filter dialogs. XDesign shows a preview image inside the dialog (`photo.css:187-190`), with "Live preview", "Original" and "Preview changes" controls and no zoom. The generic `Dialog` (`ImageDialogs.tsx:9`) has no preview control at all.
- **[resolved 2026-10-22]** Committing a dialog used to grey the whole workspace because `runPhotoCommand` was loud. Every `runPhotoCommand` is now quiet. Dialogs still read raw `busy`, so a dialog's own buttons disable while its own commit runs, which is intended.
- Image Size and Canvas Size are far from Photoshop: no units popups, no Fit To, no Reduce Noise, no Relative, no 3x3 anchor grid, no Current/New size readouts, raw-key selects.
- Enum values show as raw camelCase (`title()` at `PhotoActionDialog.tsx:172` only capitalises the first letter: "HorizontalOnly", "RectangularToPolar"). Resampling and Anchor selects show keys (`bicubic`, `preserveDetails`, `topLeft`).
- No Photoshop-style Color Picker. Foreground/background are native `<input type=color>` (`PhotoStudio.tsx:727-728`) firing `changeColor` on every change.
- Numeric controls are a number input plus a separate range input (`PhotoActionDialog.tsx:168`); no scrubby labels, popup sliders, unit suffix text ("pixels", "%", "levels"), or Photoshop label wording.
- Look: XDesign dialog is a 13.6px-radius card with 18px padding and an accent-filled submit (`photo.css:161-167`). Photoshop dialogs are flat, 1px-framed controls on a grey panel. Many Photoshop values have no matching token (section 5).

## 2. Dialog conventions spec

### 2.1 Buttons

Photoshop (`drover_layouts/dialogs/ok_cancel_dialog.eve`, `preview_dialog_buttons.eve`): a right-hand column. OK on top (`default: true`), Cancel below (`dismiss: true`), an overlay slot where holding Alt swaps Cancel for "Reset" (`alt: "Reset"`), optional "Auto", then extra buttons. Legacy `.exv` use four-char ids `ok  `/`cncl`. Image Size: on Mac the OK/Cancel group order is reversed (`imageSize-1460.exv`).

XDesign: bottom-right row `Cancel | Apply`, Apply in accent fill (`photo.css:166-167`). Most dialogs say "Apply" (`SelectionDialog.tsx:126-127`, `GradientFillDialog`, `ChannelOptionsDialog`, `ImageTransformDialog`); NewImageDialog says "Create image" / "Creating...".

Gaps and spec:
- Rename the commit label to "OK" in all modal dialogs that Photoshop shows with OK (Image Size, Canvas Size, Fill, Stroke, Selection modify, Color Range, filter dialogs, channel dialogs, Color Settings). "Apply" is only right for panel-style editing.
- Move buttons to a right-hand column (OK, Cancel) in the wide dialogs (`PhotoActionDialog` special layout `photo.css:187`, Image Size). Narrow dialogs may keep a bottom row if the design owner prefers; open question 1.
- Alt held: Cancel label becomes "Reset" and restores the values the dialog opened with. Replace the "Reset all settings" button (`PhotoActionDialog.tsx:185,202`) or keep it as a secondary; Photoshop has none visible by default.
- Enter = OK, Esc = Cancel. XDesign Esc works (`useDesignDialog.ts`, capture keydown, ignored when busy). Enter works only via native `<form onSubmit>`, so dialogs without a form, or focus inside a `<select>`/textarea, behave inconsistently (`unverified` per dialog).

### 2.2 Preview

Photoshop: a "Preview" checkbox (accelerator P, tooltip "Toggle on/off preview in document"), default on, effect drawn on the document canvas. Filter dialogs (`radius-1490`, `unsharpMask-1510`, `addNoise-1530`, ...) also have a thumbnail pane with ZoomOut / magnification text / ZoomIn. Smart Sharpen has the same plus a Preset popup.

XDesign: `usePhotoCommandPreview` (`commandPreview.ts`, 300ms default, min 100ms, cancelable, tiles/regions) feeds an in-dialog `<img>` (`PhotoActionDialog.tsx` body). Checkboxes "Live preview" (default `isTauri() && w*h <= 16_777_216`), "Original", and a "Preview changes" button.

Gaps and spec:
- Single checkbox labelled "Preview", default on; unchecking shows the original. Merge "Live preview" + "Original" + "Preview changes". "Preview changes" as a manual fallback only above the megapixel limit.
- Render the preview on the document canvas (the existing `previewSurface.ts` canvas) rather than a separate image. Decision needed (open question 2) because the dialog currently covers the canvas.
- Add zoom -/+ and a percentage readout to the thumbnail pane if it stays.
- Generic `Dialog` / `ImageCommandDialog` (Fill, Stroke, Selection modify, etc.) have no preview. Photoshop selection-modify, Feather and Fill dialogs also have none, so no gap there except for filters.

### 2.3 Keyboard

- Tab order and focus trap: ok (`useDesignDialog`).
- Missing: Alt-Reset (above); accelerator underline letters ("&Radius:") that Photoshop uses; up/down arrow and Shift+arrow (x10) stepping in numeric fields (number inputs give arrow stepping but not Shift x10, `unverified`); scrubby labels (drag the label to change the value, THotText).

### 2.4 Remembered values

Photoshop remembers the last-used values for filter and most image dialogs within a session, and Filter > "Last Filter" repeats them (from memory).

XDesign: `PhotoActionDialog.tsx:120-125` initialises from defaults or `layer.adjustmentParams`; nothing remembered for filters or destructive commands. `SelectionDialog` has a "Remember selection settings" checkbox. Spec: remember per-command last values for the session; Alt-Reset restores the opening values, not the defaults.

## 3. Per-dialog table

Photoshop layout files are under `layouts/` unless marked drover. XDesign lines are in `photo/`.

| Dialog | Photoshop file | Target controls | XDesign | Status |
|---|---|---|---|---|
| Image Size | Transform/Dialogs/imageSize-1460.exv | Image Size readout + gear; Dimensions popup; Fit To popup; Width/Height/Resolution each edit + units popup; link icon (tooltip "Constrain aspect ratio"); Resample checkbox + interpolation popup; Reduce Noise slider + % ; right preview pane | ImageDialogs.tsx:38-46 | missing-but-capability-exists (resampling exists) |
| Image Size: Width/Height/Resolution | same | edit + units popup (Pixels, Inches, Centimeters, Millimeters, Points, Picas, Percent, Columns) | ImageDialogs.tsx:44 "Width (px)", "Height (px)", "Resolution (PPI)" | relabel + missing units |
| Image Size: Keep proportions | same | link icon button | ImageDialogs.tsx:44 checkbox "Keep proportions" | wrong-control |
| Image Size: Resampling | same + menu_strings.txt:1880-1887 | Automatic; Preserve Details (enlargement); Preserve Details 2.0; Bicubic Smoother (enlargement); Bicubic Sharper (reduction); Bicubic (smooth gradients); Nearest Neighbor (hard edges); Bilinear | select of raw keys `bicubic, bilinear, nearest, lanczos, preserveDetails, none` | relabel; `lanczos` and `none` are not in Photoshop's list (extra); Smoother/Sharper/Automatic missing |
| Canvas Size | drover canvas_size_dialog.eve; Transform/Dialogs/canvasSize-1471.exv | Current Size readout; New Size Width/Height + units; Relative checkbox; 3x3 Anchor grid; Extension color popup (Foreground, Background, White, Black, Gray, Other...) + swatch | ImageDialogs.tsx:38-46 (canvas mode) | wrong-control (Anchor select), missing Relative, missing readouts, relabel (extension keys), missing Gray/Other |
| Rotate Canvas (arbitrary) | drover rotate_canvas_dialog.eve | Angle (degrees), Clockwise / Counter Clockwise radios | Image menu rotate items (`PhotoStudio.tsx:663-667`) | unverified (no arbitrary-angle dialog found) |
| Fill | Fill/Dialogs/fill-1840.exv | Contents popup (+ Custom Pattern, Script), Color Adaptation, Blending: Mode popup, Opacity %, Preserve Transparency | imageCommands.ts FILL (contents, opacity %, "Preserve transparency") | missing Blending Mode; relabel; Color Adaptation missing |
| Stroke | Paths/Dialogs/stroke-1850.exv | Width, Color patch, Location radios Inside/Center/Outside, Blending Mode, Opacity, Preserve Transparency | imageCommands.ts STROKE (width 1-250, location select, opacity) | missing Color, Mode, Preserve Transparency; location is wrong-control (select vs radios) |
| Feather | Masks/Dialogs/feather-1830.exv | "Feather Radius:" + "pixels", Apply effect at canvas bounds | SELECTION_MODIFY "Feather radius (px)" 0.1-1000 step .1 | relabel; checkbox missing; range ok |
| Expand | expandSelection-2550.exv | "Expand By:" + "pixels", canvas-bounds checkbox | "Expand by (px)" 1-500 | relabel; wrong-range (Photoshop 1-100, from memory, unverified) |
| Contract | contractSelection-2560.exv | "Contract By:" + "pixels", canvas-bounds checkbox | "Contract by (px)" 1-500 | relabel; wrong-range (1-100, from memory) |
| Smooth | smoothSelection-2530.exv | "Sample Radius:" + "pixels", canvas-bounds checkbox | "Sample radius (px)" 1-500 | relabel; wrong-range (1-100, from memory) |
| Border | selectionBorder-1820.exv | "Width:" + "pixels"; no canvas-bounds checkbox | "Width (px)" 1-200 | relabel; range from memory 1-200 ok |
| Color Range | Masks/Dialogs/colorRange-2570.exv | Select popup, Detect Faces, Localized Color Clusters, Fuzziness, Range, 3 eyedroppers, Load/Save, Invert, Selection/Image radios, Preview | SelectionDialog.tsx | missing: Load/Save, eyedropper slots, Detect Faces, Selection/Image radios (unverified per control); capability exists for the rest |
| Gaussian Blur (radius) | Filters/Dialogs/radius-1490.exv | Preview, zoom -/+, "Radius:" edit + "Pixels" | controls.ts gaussianBlur 0.1-1000 (`PhotoActionDialog.tsx:168`) | relabel (suffix text missing); preview model differs |
| Unsharp Mask | unsharpMask-1510.exv | Amount % , Radius pixels, Threshold levels | controls.ts amount 1-500, radius 0.1-1000, threshold 0-255 | ok on ranges; relabel (units suffix); preview model |
| Add Noise | addNoise-1530.exv | Amount %, Distribution radios Uniform/Gaussian, Monochromatic | controls.ts addNoise amount 0.1-400 | wrong-control if distribution is a select; `unverified` |
| Dust & Scratches | dustAndScratches-2790.exv | Radius pixels, Threshold levels | `unverified` | `unverified` |
| Emboss | emboss-1520.exv | Angle ^D + angle picker dial, Height pixels, Amount % | `unverified` | wrong-control (no angle dial; XDesign uses number+range) |
| Motion Blur angle | (angle picker class TAnglePicker) | angle dial plus number | controls.ts motionBlur angle +-360, distance 1-2000 | wrong-control (no dial) |
| Offset | offset-1550.exv | Horizontal "pixels right", Vertical "pixels down", Undefined Areas radios | `unverified` | `unverified` |
| Smart Sharpen | smartSharpen-1515.exv | Preset popup, Amount, Radius, Reduce Noise, Remove popup + angle, Shadows/Highlights cluster (Fade Amount, Tonal Width, Radius) | `unverified` | `unverified` |
| Reduce Noise | reduceNoise-1535.exv | Basic/Advanced radios, preset popup with Save/Delete | `unverified` | `unverified` |
| Fade | Filters/Dialogs/fade-3050.exv, drover fade_dialog.eve | Opacity %, Mode popup, Preview | none found | missing-but-capability-exists if blend modes exist (`unverified`) |
| Levels / Curves / Hue-Sat / Brightness | Adjustments/Dialogs/*, drover adjustments/dialogs/* (not read) | Photoshop edits via Properties panel for layers | PhotoActionDialog.tsx:187-199 specialised controls (levels, curves `CurveEditor` 45-113, hueSaturation, ...) | wrong-control (modal not panel); layouts `unverified` |
| Brightness/Contrast ranges | not read | Photoshop -150..150 / -50..100 (Legacy off) (from memory) | controls.ts brightnessContrast -150..150, contrast -50..100 | ok (unverified) |
| New document | Document/Dialogs/new-1250.exv (not read) | Photoshop 2026 uses a start-screen style New Document panel (from memory) | NewImageDialog.tsx: Name, Width (px), Height (px), Resolution (PPI), Color mode, Depth, Background, "Create image" | relabel ("Create image" vs "Create"), Background select shows raw keys; layout `unverified` |
| Duplicate | drover duplicate_image_dialog.eve | "Duplicate [name]", "As", "Duplicate Merged Layers Only" | none found | `unverified` |
| Color Settings | Color/Dialogs/colorSettings-3550.exv (not read) | settings groups | ColorSettingsDialog | `unverified` |
| Channel Options | Channels/Dialogs (not read) | Name, Color Indicates, Color, Opacity | ChannelOptionsDialog (Solidity %, overlay opacity %, Fill) | `unverified`; "Fill" looks like extra |
| Gradient Editor | Gradients/Dialogs/gradientEditor-2231.exv (not read) | Name, stops, Smoothness | GradientFillDialog "Edit gradient fill" (Style, Color stops, Midpoints, Transparency stops) | `unverified` |
| Transform | (no modal; on-canvas with options bar) | | ImageTransformDialog "Transform layer" modal (Keep proportions, Interpolation, Reset) | extra (modal where Photoshop uses on-canvas Free Transform and options bar) |
| Liquify / Warp / Puppet | (workspace modal for Liquify, options bar for Warp/Puppet) | | GeometryDialog in Properties panel (`PhotoStudio.tsx:813`) | ok-ish; Liquify is a full modal in Photoshop |

Other XDesign-only dialogs without a Photoshop counterpart found: DraftRecoveryDialog, ColorImportDialog ("How should this image open?"), PasteColorDialog. Photoshop's equivalents are Color Profile Mismatch alerts; not compared.

Menu entry gaps that affect dialogs: Image menu has no Image Size / Canvas Size entries (`PhotoStudio.tsx:830` puts them as buttons in the Properties "Document" section), and no destructive Brightness/Contrast, Levels, Curves, Hue/Saturation entries (`:663-667`).

## 4. Color Picker spec

Photoshop: `layouts/Color/Dialogs/cube-1660.exv`, class `TCubeDialog`, title "Color Picker (Foreground Color)" (per-use titles such as "Color Picker (Stroke Color)", `ui_strings.txt`). The 2D field and the hue strip are drawn by the class, not the layout.

Controls:
- Large saturation/brightness field (or other axis according to the selected radio) and a vertical hue strip with triangle markers.
- "new" and "current" swatches, stacked. Clicking "current" resets.
- Buttons: OK, Cancel, "Add to Swatches", "Color Libraries".
- Radio-selectable channels with edit fields: H: (degrees), S: (%), B: (%); R:, G:, B:; L:, a:, b:; C:, M:, Y:, K: (each %).
- Hex field with "#".
- Gamut-warning and web-colour-warning prompt icons; "Only Web Colors" checkbox.
- Non-modal variant (`cubeNonModal-1659.exv`): adds Eyedropper button, sample popups, "Show Sampling Ring".

XDesign today: native colour inputs. Specifically `PhotoStudio.tsx:727-728` (`xd-ps-color fg`, `aria-label="Paint color"`), also `REPLACE_COLOR` and Photo Filter colour fields. No picker dialog, no alpha, no HSB/Lab/CMYK, no hex field, no swatches, no history.

Implementable spec (minimum viable):
1. Modal `ColorPickerDialog` opened by clicking the foreground/background swatches (title per use) and by colour fields in dialogs (Stroke, Canvas extension, Replace Color, Photo Filter).
2. Field + hue strip, new/current swatches, H S B, R G B, hex; L a b and C M Y K as second pass (needs CMM; XDesign has color profile commands, so capability partially exists, `unverified`).
3. OK / Cancel, Esc cancels, Enter OK; live-update the swatch only on OK (Photoshop does not paint with an uncommitted colour). Keep the on-canvas eyedropper path separate.
4. Add to Swatches button wired to the Swatches panel if present (`unverified`); Color Libraries and Only Web Colors are optional; list as non-goals unless the owner wants them.

## 5. Visual look spec

Photoshop colour source: `UIColors.txt`. Each colour has four entries, ordered lightest to darkest (the task note says darkest first; verified from PaletteFill 240/184/83/50, so this note is corrected). Which entry is the default theme is `unverified`; the values below use index 2 (medium dark) and index 3 (darkest) as candidates. Control metrics (heights, spacing) are not in the files and are `(from memory)` or `unverified`.

| Property | Photoshop value | XDesign current (file:line) | Matching token |
|---|---|---|---|
| Panel/palette fill | 83 (#535353) medium dark, 50 (#323232) darkest | `--xd-panel #2c2c2c` (`photo.css:1`, `tokens.css` .xd-root ~7163) | nearest `--xd-panel`, not equal: TOKEN GAP if exact match wanted |
| Dialog options pane | 50 / 37 | dialog bg `--bg-1` (`photo.css:161`) | TOKEN GAP (`--bg-1` is #060a0f neon-tinted, outside .xd-root semantics) |
| Control fill (edit, popup) | WidgetFill 71 / 45 | `--bg-2` (`photo.css:7`) | TOKEN GAP |
| Control frame | WidgetStroke white .34 / .30 alpha | 1px `--border-subtle` (`photo.css:7`) | `--xd-border #454545` is closest; alpha stroke is TOKEN GAP |
| Group frame / divider | 66 / 38; divider 62 / 38 | none | TOKEN GAP |
| Label text | WidgetLabelText 214 / 173 | `--t-secondary` | `--xd-text-2 #b3b3b3` close; TOKEN GAP for exact |
| Default / widget text | 240 / 225 | `--t-primary #e6f4ec` (tinted green) | `--xd-text #e6e6e6` close |
| Disabled text | 135 / 115 | opacity .4 on the whole button (`photo.css:5`) | TOKEN GAP |
| Button fill | WidgetButtonFill 69 / 41 | transparent (`photo.css:3`) | TOKEN GAP |
| Button fill pressed | 56 / 31 | none | TOKEN GAP |
| Button stroke | 102 / 71 | none; submit is accent fill | TOKEN GAP |
| Check mark | WidgetCheck 50 (dark on light) | native checkbox | TOKEN GAP |
| Slider track | WidgetSliderGreySlide 117 / 87 | native range, `accent-color:var(--neon-magenta)` (`photo.css:165`) | TOKEN GAP |
| Slider thumb | 240 fill, stroke 33 | native | TOKEN GAP |
| Focus ring colour | TargetFocused (15,100,210) / (20,115,230); flyout focus (35,190,250) | `outline:2px solid var(--neon-magenta)` (`photo.css:6`), remapped to `--xd-accent #0d99ff` | `--xd-accent` close (hue similar); exact: TOKEN GAP |
| Focus ring width/offset | thin blue ring around control (from memory ~1-2px) | 2px with 2px offset | design owner says quiet focus (1px ink ring on buttons); conflicts, see question 4 |
| Alert / error | (239,60,57) | error `<p role=alert>` colour `unverified` | TOKEN GAP if no danger token |
| Tooltip | bg (255,255,205), text black | `unverified` | TOKEN GAP |
| Hyperlink | (70,160,245) dark themes | none | TOKEN GAP |
| Pill (CTA) stroke | 225 | none | TOKEN GAP |
| Dialog corner radius | square corners on controls, ~0-2px (from memory) | `--r-lg` 13.6px (`photo.css:161`), buttons `--r-sm` 5.1px (`photo.css:3`), options-bar controls 2px (`photoshop.css`) | rejected by DESIGN.md: owner wants soft radii (rejected 2/4/6/8px). Conflict, question 3 |
| Dialog padding | ~12-16px (from memory) | 18px (`photo.css:161`) | `--space-4` 18 |
| Dialog font size | 11px (from memory) | 12px (`photo.css:161`); workspace 11px (`photoshop.css`) | none; inconsistent inside XDesign |
| Control height | edit/popup ~22px (from memory, matches options bar 22px in `photoshop.css`) | padding 5px (`photo.css:7`) giving ~26px | TOKEN GAP |
| Label to field gap / row gap | ~6-8px (from memory) | grid `1fr 70px` (`photo.css:164`) | `--space-2` 8 |
| Shadow | Photoshop dialogs have an OS window shadow, no inner card | `--shadow-window` | exists |
| Scrim | none for Photoshop modals; app is blocked | `rgba(0,0,0,.35)` (`photo.css:160`) | TOKEN GAP (raw value) |
| Command dialog width | content-sized | 320px, 480px (`photo.css:161,170`) | none |
| Preview-pane dialog width | resizable (Image Size) | `min(1000px,94%)` grid `minmax(0,1fr) 265px` (`photo.css:187`) | none; Image Size preview is 278px on Mac |
| Heading | OS title bar ("Image Size"); no h3 inside | `h3` 14px weight 500 (`photo.css:162`), lowercase titles "Image size" | relabel: Title Case "Image Size", "Canvas Size", "Color Range" |
| Colour of submit | default button has a blue-outline default ring (from memory) | accent fill with `--t-on-accent` (`photo.css:166-167`) | `--xd-accent` ok; style differs |

Notes for the design owner: Photoshop's neutral greys do not match the neon-tinted global tokens. Inside `.xd-root` (the photo workspace) the `--xd-*` greys are close to Photoshop (#2c2c2c vs #323232/#535353 candidate), but dialogs use `--bg-1` and `--border-subtle`, which are not remapped; verify that the dialog really reads `--xd-*` values at runtime (`unverified`, the scrim sits inside `.xd-photo` so inheritance should work for `--xd-*` only).

## 6. Open questions

1. Right-hand OK/Cancel column vs bottom-right row: do you want Photoshop's layout on wide dialogs only, or everywhere? DESIGN.md has no rule.
2. Preview on the document canvas (Photoshop) requires the dialog not to cover the image. Accept a movable or side-docked dialog, or keep the in-dialog preview and add zoom?
3. Radii: Photoshop is near-square; the owner rejected angular radii. Keep 13.6px dialogs and round controls, or adopt a Photoshop-flat look for dialog controls only?
4. Focus ring: Photoshop has a visible blue ring; DESIGN.md asks for a 1px ink ring and quiet focus. Which wins in dialogs?
5. Adjustments: move to a live Properties-panel editor for adjustment layers (Photoshop behaviour), keeping the modal for destructive Image > Adjustments only? This touches `PhotoStudio.tsx:819,834`.
6. Photoshop theme: which UIColors index is the default theme (medium dark index 2 vs darkest index 3)? Not determinable from the files.
7. Canvas flash on apply (blank frame): `unverified`, not run. Image Size / Canvas Size is the likely candidate because `previewSurface.ts` clears the canvas when its dimensions change. Needs a runtime check by someone allowed to run the app.
8. Selection modify ranges (Expand/Contract/Smooth 1-100) are from memory; the real limits live in C++ and are not in the layout files. Confirm before changing XDesign's 1-500.
9. Unread Photoshop layouts (new-1250, adjustments/*, colorSettings-3550, gradientEditor-2231, Channels/*, rotateOther-2350) and the unread XDesign filter control table; rows marked `unverified` above need a second pass.
