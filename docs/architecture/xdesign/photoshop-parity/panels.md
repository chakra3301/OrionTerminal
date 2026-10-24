# XDesign panels vs Photoshop 2026 audit

> Audit of 2026-10-22, before that day's interaction fixes. `file:line` references are as of the audit and drift. Statements the fixes made stale are marked **[resolved 2026-10-22]**; the consolidated spec is [../photoshop-parity.md](../photoshop-parity.md).

Evidence: XDesign claims are `path:line` (repo `~/Orion_Terminal/src/apps/xdesign/`, `PS.tsx` = `photo/PhotoStudio.tsx`). Photoshop claims cite files under `/Applications/Adobe Photoshop 2026/.../Contents/Required/layouts/` (`PS:`). Items marked (memory) or unverified were not confirmed in a reference file. Status codes: ok / missing-but-capability-exists (MCE) / relabel / wrong-control / extra / move.

## 1. Summary

- There is no Color panel. Foreground/background are two native `<input type="color">` in the tool rail (`PS.tsx:726-729`) and again in the Swatches tab (`photo/PhotoSwatches.tsx:14`). Photoshop's Color panel (`PS: Color/Panels/color-1590.exv`) has Hue Cube / sliders / wheel modes, fg/bg chips, gamut and web warnings, a ramp and a flyout.
- The top group is Swatches/Gradients/Patterns (`PS.tsx:74`). Photoshop's is Color/Swatches/Gradients/Patterns (memory for the default tab order).
- The middle group's third tab "Document" (`PS.tsx:830-833`) does not exist in Photoshop. Document info belongs in Properties when nothing is selected. The Selection, Channels and Color profile sections have no panel home in Photoshop.
- Properties (`PS.tsx:815-829`) is a button list. Photoshop's is clustered: Transform (W/H/X/Y/rotate/flip), Align and Distribute, Appearance, Mask (Density/Feather), Quick Actions.
- Adjustments (`PS.tsx:834`) is a flat text-button list. Photoshop uses an icon tile grid with a presets list.
- The Layers panel (`PS.tsx:115-128, 840-843`) lacks the filter row, popup-slider Opacity/Fill, the auto-nest lock, an fx badge and sublist, a mask thumbnail and link icon, a group disclosure arrow and type/adjustment/smart-object thumbnails.
- Channels, Paths and History use text-button footers (or none) and have no flyout. Channels and Paths have no thumbnails.
- No panel flyout (hamburger) menu anywhere (`PS.tsx:79-87`). The collapsed strip is icon-only with no labels, and its panels open as an overlay flyout rather than docking.
- There is no Info or Histogram panel and no separate Character/Paragraph panels. Type controls are inline in Properties.
- Greying: panel components use the quiet-aware `controlsLocked` and are correct. Modal dialogs use raw `state.busy` (section 6).

## 2. Dock layout spec

| Group | Photoshop target | XDesign now | Status |
|---|---|---|---|
| Top | Color, Swatches, Gradients, Patterns (memory; PS layouts exist for each) | Swatches, Gradients, Patterns; default tab Swatches (`PS.tsx:74,168`) | MCE: add Color tab (capability: fg/bg state, eyedropper `PS.tsx:704`) |
| Middle | Properties, Adjustments, Libraries (Libraries out of scope) | Properties, Adjustments, Document (`PS.tsx:74`) | relabel/move: drop Document tab, fold into Properties (no-selection state) |
| Bottom | Layers, Channels, Paths | Layers, Channels, Paths (`PS.tsx:74`) | ok |
| Collapsed strip | History, Navigator, Brush, Styles, Shapes, Tool Presets etc. shown as iconised docked panels (memory) | `STRIP_PANELS` History, Navigator, Brushes, Styles, Shapes, Tool Presets (`PS.tsx:75`); 36px strip (`:78`), 28px icon buttons, tooltip only (`:805`) | ok contents; wrong-control: opens an overlay flyout 260px wide (`:797-804`, `photoshop.css` `.xd-ps-flyout`) |
| Window menu | Grouped, with check marks (memory) | Alphabetical `ALL_PANELS` (`PS.tsx:77,678`) | relabel/order |
| Tab row | Tab strip plus hamburger flyout at right; double-click tab minimises (memory) | Tabs, spacer, chevron collapse; double-click collapses (`PS.tsx:79-87`) | missing flyout (see 4) |
| Sizing | Fixed-ish dock column, panels share height | Color group `max-height:30%`, Properties `flex:1`, Layers `flex:1.25` (`photoshop.css`); `EditorChrome.tsx:9-57` default right 272 (220-360), drag resize with keyboard (`:76-97`) | ok (extra: keyboard resize) |

Notes: Info (F8) and Histogram are absent; XDesign's status bar shows size/ppi/zoom only (`PS.tsx:805-846`). Brush Settings is a details block in `photo/BrushPanel.tsx`, not a separate panel. Layer Effects is reachable only through the Styles flyout (`photo/LayerEffects.tsx`).

## 3. Per-panel spec

### 3.1 Color (most detail). Status: entirely missing (MCE)

Photoshop (`PS: Color/Panels/color-1590.exv`, class `TPickerPanel`, view id `colr`). Constants: picker height 19, warn size 13, swatch size 14, ramp height 6, slider-set height 12, edit width = 4 digits + outset. Overall panel width constant `gStdPaletteWidth` is not defined in the files read (unverified).

Modes, one shown at a time:

| Mode (flyout) | Anatomy |
|---|---|
| Hue Cube | Left: small fg/bg selector `frbk` with gamut warning (`gwr2` icon + `gsw2` swatch) beneath. Centre: `TCubeXSection` saturation/brightness field. Right: `TCubeCore` vertical hue strip (19px in 21px control) with a 10px slider set. Owner states this is the default (owner/memory, not in file). |
| Brightness Cube | Same structure, different axis (strings only; layout not separately read). |
| Color Wheel | `swhp` `TColorWheel` plus "new swatch" icon button `ncps` (icon NewSheet, tip "Add a new swatch for this color"). |
| Slider modes | Upper pane `uppr`: fg/bg selector, gamut warning `gwrn`/`gswt` ("Warning: out of gamut for printing" / "Click to select in gamut color"), web warning `wwrn`/`wswt` ("Warning: not a web safe color" / "Click to select web safe color"). Then per-model slider sets. |
| Bottom | Colour ramp `ramp` `TPickerRamp`, tip "Click to sample color". |

Slider sets and row anatomy: each row is letter label, 6px ramp over 12px slider (`TPaletteRamp`/`TColorSliderSet`), 4-digit edit box, unit.

| Model | Rows (label, unit) |
|---|---|
| Grayscale | K % |
| RGB | R, G, B (0-255); hex `#` field |
| HSB | H (degree), S %, B % |
| CMYK | C, M, Y, K, each % |
| Lab | L, a, b |
| Web | R#, G#, B# (hex edit fields `7amt`-`9amt`) |

Flyout (`$$$/Menu/Color/*`, `/tmp/ps_ref/menu_strings.txt` ~753-774): Hue Cube, Brightness Cube, Color Wheel, Grayscale Slider, RGB Sliders, HSB Sliders, CMYK Sliders, Lab Sliders, Web Color Sliders, Show non-Web Safe Ramp, Make Ramp Web Safe, Copy Color as HTML, Copy Color's Hex Code, Close, Close Tab Group. Strings also reference HSB and OKLab color spaces.

XDesign status:

| Element | XDesign | Status |
|---|---|---|
| Panel/tab | None | MCE (fg/bg and eyedropper exist, `PS.tsx:704,726-729`) |
| fg/bg chips with swap/default | Tool rail, native color inputs; swap and Default buttons (X)/(D) (`PS.tsx:726-729`) | ok in rail; wrong-control: native picker rather than panel chips |
| fg/bg inputs in Swatches | `PhotoSwatches.tsx:14` "Foreground"/"Background" inputs | extra (move into Color) |
| Hue cube / wheel / sliders / hex | None | MCE (native color input already yields hex) |
| Gamut/web warnings | None in panel; Document tab has Proof Colors and Gamut Warning toggles (`PS.tsx:833`) | move |
| Color ramp sampling | None | missing |
| Flyout | None | missing |
| Add-to-swatches | "Add foreground to swatches" button in Swatches (`PhotoSwatches.tsx`) | ok; Photoshop puts it in Color wheel mode and Swatches footer |

### 3.2 Swatches (`PS: Color/Panels/swatchesPanel.eve`)

Presets-panel pattern (also Gradients/Patterns/Styles): 232x240 panel; optional search bar (icon `FilteringLayerSearch` + edit); optional Recents row (`TColorListView`, 18px); scrolling list; 25px icon bar `TPresetsPanelIconView`. Flyout: New Swatch Preset, New Swatch Group, Rename, Delete, Import, Export Selected, Export Swatches for Exchange, Append Default, Show Recents, Show Search Bar, Legacy Swatches (menu strings). Context menu: Rename/Delete.

| Element | XDesign | Status |
|---|---|---|
| Swatch grid | 12 hardcoded plus up to 64 custom, 26px buttons, localStorage `orion.xdesign.image-swatches.v1` (`PhotoSwatches.tsx`) | ok |
| Click fg / Cmd-click bg / Alt-click delete | Present | ok |
| Search, Recents, Groups | None | MCE for groups only if capability exists; otherwise out of scope (unverified) |
| Icon bar (new swatch, new group, delete) | One "Add foreground" button only | wrong-control |
| Flyout | None | missing |
| Native fg/bg inputs | `PhotoSwatches.tsx:14` | extra |

### 3.3 Gradients, Patterns, Styles, Shapes, Tool Presets

| Panel | Photoshop | XDesign | Status |
|---|---|---|---|
| Gradients (`PS: Gradients/Panels/gradientsPanel.eve`) | Search, recents, list, icon bar; flyout New/Rename/Delete/Import/Export/Append Default | `GradientPresetsPanel` (`photo/PresetPanels.tsx`): search, 3-col grid, "Current gradient" details editor, Save gradient, Import .grd, New gradient fill, `PresetManager` | extra: inline editor (belongs in Properties/Gradient Editor); wrong-control: `PresetManager` forms replace flyout/context menu |
| Patterns (`PS: Fill/Panels/patternsPanel.eve`) | Same pattern; flyout includes old Load/Save/Replace/Reset | `PatternPresetsPanel` (`photo/AdditionalPresets.tsx`): search, buttons, "Define from selection" form, import .pat | wrong-control (form instead of icon bar/flyout) |
| Styles (`PS: Styles/Panels/stylesPanel.eve`) | List plus flyout; no effect editor | Styles flyout holds `LayerEffects` + `StylePresetsPanel` (`PS.tsx:797-804`) | move: layer-effect editing is a dialog in Photoshop (memory); `LayerEffects.tsx` is extra to panel |
| Shapes | Presets list | `ShapePresetsPanel`: search, width/height inputs, grid | ok (width/height extra) |
| Tool Presets (`PS: Presets/Panels/toolPresetPanel-4252.exv`) | List plus "Current Tool Only" checkbox in icon bar | `ToolPresetsPanel` has `currentOnly` and name field | ok; name field is extra |
| Brushes | Brush panel (presets); Brush Settings separate panel (memory) | `BrushPanel.tsx`: search, name, settings details | move: settings should be separate panel (memory) |

`photo/PresetManager.tsx` (rename/delete/move/new group/rename group/delete group) is the XDesign substitute for flyout and context menus.

### 3.4 Layers (`PS: Layers/Panels/layers-2490.exv`)

Target, top to bottom:
1. Filter row: kind popup (icon `FilteringLayerSearch`) plus on/off switch; kinds pixel, adjustment, type, shape, smart object; name field; Effect, Blend Mode, Attribute, Color popups.
2. Blend-mode popup and "Opacity:" popup-edit-slider.
3. "Unify:" animation row (hidden in practice, skip).
4. "Lock:" five buttons (transparency, image, position, auto-nest, all) and "Fill:" popup-edit-slider.
5. Scroller of `TLayerCellView`.
6. Footer `TLayersButtonBar` order: cleanup (optional), link, fx, mask, adjustment, group, new, trash.

Row anatomy (ui_strings 857-920): eye (tip "Toggles layer visibility. Opt-click to only show layer."), layer thumbnail (variants: adjustment, gradient, pattern, solid, shape, text, smart object, group, frame), layer mask thumbnail, mask-link icon, vector-mask thumbnail, name, fx icon with reveal triangle and per-effect eyes, smart filters with mask and visibility toggles, lock icon variants, clipping icon, advanced-blending icon. Thumbnail context menu: thumbnail sizes, clip to doc/layer, select pixels, add/subtract/intersect transparency mask. Panel flyout (memory): New Layer, Duplicate, Delete, Quick Export, Panel Options, etc.

| Element | XDesign | Status |
|---|---|---|
| Filter row | None | missing (MCE only if filter-by-kind logic exists; unverified) |
| Blend select | `xd-photo-layer-controls` select over `BLEND_MODES` (`PS.tsx:840`) | ok |
| Opacity | Plain number input, commits on blur | wrong-control (popup slider) |
| Lock row | 4 icon buttons plus "Fill:" number (`PS.tsx:841`) | missing auto-nest; Fill wrong-control |
| Row eye | Eye/EyeOff button (`PS.tsx:115-128`) | ok |
| Thumbnail | 28px, generic Layers icon if none (`PS.tsx:115-128`, `photo.css`) | wrong-control for type/adjustment/smart/shape variants |
| Mask | `SquareDashed` indicator button, not thumbnail; no link icon | wrong-control |
| fx badge and sublist | None | MCE (LayerEffects exists) |
| Group arrow | None; children indent `8+depth*14` | missing |
| Lock badge | Single Lock icon for any lock | relabel/variants |
| Link badge | Present | ok |
| Clipping indicator | None | MCE (Clip/Unclip exists in Properties) |
| Drag reorder with drop markers | Present, magenta marker `photo.css` | ok (extra: not in memory of PS styling) |
| Footer | link, fx (opens Styles flyout), mask (`layer.layerMask.revealAll`), adjustment (opens Adjustments tab), group, new, delete (`PS.tsx:843`) | order ok; fx wrong-control (flyout not menu) |
| Row height | min 40px, thumb 32px (`photoshop.css`) vs `.xd-photo-layer` 36 / 28 thumb (`photo.css`) | inconsistent between two CSS files |

### 3.5 Channels, Paths, History

| Panel | Photoshop | XDesign | Status |
|---|---|---|---|
| Channels (`PS: channels-1310.exv`: scroller + list + icon bar) | Rows: eye, thumbnail, name, shortcut (memory). Footer 4 icons: load as selection, save selection, new, delete (memory). Flyout: New/Duplicate/Delete Channel, New Spot Channel, Merge, Split, Channel Options, Panel Options | `PhotoChannels.tsx`: help paragraph, eye+name rows, alpha rows with rename input, Options, up/down, load/duplicate/delete icons; text footer buttons ("Save selection", "New alpha", "New channel", "New spot channel", "Quick Mask options", "Apply Image", "Calculations", "Load Selection", "Split", "Merge") | wrong-control (text footer, no icon bar), missing thumbnails and shortcuts, extra: help paragraph, up/down, inline rename (rename should be dbl-click); flyout items exist as buttons (MCE to a flyout) |
| Paths (`PS: pathsPalette-2020.exv`) | Rows with thumbnail and name. Footer 6 icons: fill, stroke, load as selection, make work path, new, delete (memory). Flyout: New/Duplicate/Delete Path, Make Work Path, Make Selection, Fill, Stroke, Clipping Path, Panel Options | `PhotoPaths.tsx`: empty-state text; rows with text name and buttons Make selection / Fill / Stroke / Save / Delete; `disabled={busy}` | wrong-control (per-row text buttons), missing thumbnails and footer icon bar and flyout |
| History (`PS: history-3310.exv`) | Snapshot area on top, state list, footer: new document from state, new snapshot, delete. Flyout: Step Forward/Backward, New Snapshot, Delete, New Document, Clear History, History Options | `PhotoHistory.tsx`: text-only rows, redo style `xd-photo-history-redo`, `aria-current` on the current row | missing snapshots, footer, flyout (MCE only for Clear History and snapshots if engine supports; unverified) |

### 3.6 Properties (`PS: Application/Core/propertiesPalette-1474.exv`)

Shell: icon cluster `prp1..prp5`, title `pttl` (default "No Properties"), scroller, icon bar. Content switches per selection (clusters have reveal arrow and bold label).

| Context | Photoshop clusters | XDesign |
|---|---|---|
| No selection (`PS: Document/Properties/documentProperties-4588.exv`) | Canvas (W/H with link, X/Y read-only, portrait/landscape, resolution, mode, bit depth, fill color); Rulers and Grids; Guides; Quick Actions (Crop, Image Size, Rotate, Trim, Convert) | Empty state "Nothing selected" (`PS.tsx:~826`) and the separate Document tab (`:830-833`): size text, Image size, Canvas size, Add text, Rotate 90, Flip, Trim buttons |
| Pixel layer (`PS: Layers/Properties/pixelLayerProperties-4589.exv`) | Transform (W/H with aspect link, X/Y, Rotate popup, Flip H/V, Use live update); Align and Distribute (6+6 icons, spacing, Align To popup); Quick Actions incl. Remove Background | Name input, Lock checkboxes (duplicate of Layers, extra), buttons Transform/Warp/Puppet/Perspective/Forward/Backward/Clip/New group (`PS.tsx:817`) |
| Type (`PS: Type/Properties/typeLayerProperties-5225.exv`) | Transform, Character (variable axes), OpenType, Paragraph, Dynamic Text, Bullets, East Asian, Middle Eastern, Quick Actions | `ImageTypographyPanel.tsx` flat fields, with Character spacing and Paragraph in `<details>` |
| Shape (`PS: Shapes/Properties/smartShapeRectProperties-5221.exv`) | Transform, Appearance (fill, stroke, width, four corner radii with link), Pathfinder, Quick Actions | None (no W/H/X/Y or corner radii in the Properties tab) |
| Mask (`PS: Masks/Properties/masks-2662.exv`) | Add-mask icons; Density and Feather sliders; buttons Select and Mask, Color Range, Invert | `PS.tsx:825`: view select (Composite/Grayscale/Red overlay), buttons Mask selection, Hide all, Apply, Delete |
| Adjustment layer | Per-adjustment view in `Adjustments/Properties/*` (not read in detail) | "Edit adjustment" button opens a modal dialog |

Status: Transform W/H/X/Y/rotate/flip fields, Align and Distribute, Density/Feather and Appearance are MCE or missing depending on engine (unverified); Name input is extra; Lock checkboxes are extra; Gradient fill, Smart object and Smart filters sections have no direct Photoshop-cluster equivalent (relabel/move).

### 3.7 Adjustments (`PS: Adjustments/Panels/adjustment-5200.exv`, shell only)

Target (strings, ui_strings 1-60): header "Add an adjustment"; icon tile grid (order unverified); presets list "^0 Presets"; tooltips "(not available in X mode)"; items Brightness/Contrast, Levels, Curves, Exposure, Vibrance, Hue/Saturation, Color Balance, Black and White, Photo Filter, Channel Mixer, Color Lookup, Invert, Posterize, Threshold, Gradient Map, Selective Color, plus 2026 additions (Light, Color and vibrance, Clarity and dehaze, Grain, OpenColorIO Transform). Flyout (`Menu/AdjustmentFlyout/*`): Add Mask by Default, Clip to Layer, Auto-Select Targeted Adjustment Tool, Reset/Save/Load Preset, Show Clipping.

XDesign (`PS.tsx:834`, `controls.ts:8` `ADJUSTMENTS`): help text plus 16 text buttons that open a modal `PhotoActionDialog`. Status: wrong-control (text list not tiles), missing presets and flyout, missing 2026 additions (not proposed). The 16 items match the classic list; order differs from PS (Black and White before Color Balance).

### 3.8 Navigator (`PS: Canvas/Panels/navigatorPanel-2990.exv`)

Target: proxy preview `navv`; zoom bar with edit field `nzed`, zoom-out icon, slider, zoom-in icon; flyout Panel Options (colour presets). XDesign `PhotoNavigator.tsx`: proxy frame with drag-to-centre and view rectangle, log-scale slider 0.01-16 and % readout. Status: zoom out/in icons missing, % readout should be an edit field (wrong-control), no flyout.

### 3.9 Info, Histogram, Character, Paragraph

| Panel | Photoshop | XDesign | Status |
|---|---|---|---|
| Info (`PS: Document/Panels/infoPalette-1710.exv`, F8) | Cursor coordinates, colour readouts in selectable modes (Actual, Proof, Grayscale, RGB, Web, HSB, HSL, CMYK, Lab, Total Ink, Opacity, 8/16/32-bit), W/H, Color Samplers | Status bar: zoom, fit, 100%, size/ppi only (`PS.tsx:805-846`). Eyedropper exists (`:704`) | missing-but-capability-exists (colour sampling and ppi exist; cursor coordinates unverified) |
| Histogram (`histogramPalette-3755.exv`) | Chart plus channel popup | None | missing (capability unverified) |
| Character (`Type/Panels/textCharacterPanelContents-3704.exv`) | Font, style, Size, Leading, Kerning, Tracking, V/H scale, Baseline shift, color, faux bold/italic, caps, small caps, super/sub, underline, strike, ligatures, language, anti-alias (labels memory) | Inline in Properties (`ImageTypographyPanel.tsx`) with all of these as labelled fields | MCE as separate panel; wrong-control (labelled text fields vs icon-prefixed fields and toggle icon row) |
| Paragraph (`textParagraphPanelContents-3716.exv`) | Align L/C/R, justify x4, indents x3, space before/after, bullets | Alignment select with 7 options, direction, indents, spacing in a `<details>` | wrong-control (select vs icon button row) |

## 4. Panel chrome spec

| Item | Photoshop | XDesign | Status |
|---|---|---|---|
| Tab row | About 24px, unselected tab darker, slot behind tabs (memory; `UIColors.txt`: UnselectedTab 193 and TabSlot 178 apply in all four brightness themes, 4-per-theme parse unverified) | 26px on `--xd-bg` #1e1e1e; tab 26px, padding 0 9px, weight 600; inactive `--xd-text-3`, active `--xd-text` on `--xd-panel` #2c2c2c (`photoshop.css`, `tokens.css` ~7176) | ok approx (2px taller) |
| Panel body color | PanelMain [50,50,50] darkest theme (index 3 assumption) | `--xd-panel` #2c2c2c (44) | relabel: about 6 levels darker than PS |
| List selection | ScrollingListSelected [74,74,74]; ScrollingListSelectedOne [49,73,96] (blue tint) | `--bg-3` for layers (`photoshop.css`), accent tint in `photo.css` | relabel: two selection styles in two CSS files |
| Flyout (hamburger) | Present in every panel with panel-specific items | None (`PS.tsx:79-87`) | missing; PresetManager forms stand in |
| Collapse | Double-click tab; collapse to icons (memory) | Chevron button 20px "Collapse/Expand panel group", dbl-click toggles (`PS.tsx:79-87`) | ok (extra chevron) |
| Close, Close Tab Group | In flyouts | Not present | missing |
| Footer icon bar | 25px for presets, 4-8 icons for Layers/Channels/Paths/History | Layers footer 24x22 buttons ok; others text buttons | see section 3 |
| Base font | About 11px (memory) | 11px | ok |
| Icon-only strip | Iconised panels with labels on hover; strip can widen to show names (memory) | 36px strip, 28px buttons, tooltip only (`PS.tsx:805`) | relabel |
| Resize | Drag dock edge | `PanelResize` with keyboard (`EditorChrome.tsx:76-97`); dbl-click reset | ok/extra |

## 5. Open questions

1. Default Color panel mode: owner says Hue Cube; not stated in the layout file.
2. `gStdPaletteWidth` is undefined in files read, so Color panel pixel width is unknown.
3. Adjustments tile order and exact icon set (code-driven, not in layouts).
4. UIColors 4-values-per-theme index mapping (index 3 = darkest assumed).
5. Whether the engine supports filter-by-kind, snapshots, shape corner radii, Density/Feather, Histogram data and cursor coordinates (decides MCE vs out of scope).
6. Panel flyout contents for Layers, Channels footer icons, Paths footer icons were not in layout files (memory).
7. Should the Styles flyout and Layer Effects stay as a flyout editor, since Photoshop uses a dialog?
8. Should Window menu grouping follow Photoshop (Color/Layers etc. at fixed positions)?

## 6. Controls that grey while the canvas is busy painting or erasing (list only)

Mechanism: `controlsLocked = busy && !quiet` (`photo/runtime.ts:46`). **[updated 2026-10-22]** Every `runPhotoCommand` is quiet now, and gestures hold the lock through `holdImageGesture`, so quiet-aware controls stay enabled. `operation()` throws "Wait for the image operation to finish" if busy (`runtime.ts:57`), and the `quietCommit` promise serialises follow-ups (`runtime.ts:48-71`).

Already quiet-aware via `controlsLocked` (should not grey): Layers panel rows, lock row, footer, blend/opacity/fill (`PS.tsx:146`); Swatches (prop); Gradients/Patterns/Shapes/Tool Presets/Styles/PresetManager; Brushes; Channels; Paths and History (props); Properties; Adjustments tab; LayerEffects; SmartFilters; ImageTypographyPanel; tool-rail color chips (`inert`, `PS.tsx:726-729`); task bar (`inert={busy}`, `PS.tsx:788-796`).

Greys during strokes (raw `state.busy`, not quiet-aware), candidates to review:
- Modal dialogs: `PhotoActionDialog`, `ImageTransformDialog`, `ImageDialogs`, `GeometryDialog`, `ExistingNumericFilterDialog`, `ExistingLensFilterDialog`, `ExistingBlurFilterDialog`, `DevelopDialog`, `GradientFillDialog`, `NewImageDialog`, `ImagePlaceDialog`, `DraftRecoveryDialog`, `PhotoTextGeometryDialog`, and `CommandBrowser`. These are launched from panel buttons (Adjustments, Edit adjustment, Edit gradient fill, Transform), and are modal, so a mid-stroke conflict is rare.

Other locks to note:
- `locked=usePhotoWorkspace(s=>s.busy)` at `PS.tsx:146` feeds state-keeping at `:160,163,253`, not visual greying (unverified for every use).
- The Properties and Layers groups are `inert={geometryActive}` (`PS.tsx:812,837`). These grey during transform/geometry sessions, not strokes.
- Panels not yet built (Color, Info, Histogram, Character, Paragraph) should use `controlsLocked` from the start.
