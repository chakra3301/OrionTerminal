# XDesign image editor: Photoshop parity spec

2026-10-22 · branch `validation/alpha-2026-09-14` · uncommitted.

This is the target for how the image editor (`src/apps/xdesign/photo/`) works and looks. The reference is Photoshop 2026 on macOS. **Scope:** only what XDesign already has an engine capability for. **Out of scope:** online and cloud features (Libraries, Neural Filters, generative tools, Share, Learn, Discover), 3D, video timeline, Plugins, Help, and rulers, guides and grid (XDesign has none).

Detailed per-item audits are in [photoshop-parity/](photoshop-parity/): [menus](photoshop-parity/menus.md), [tools](photoshop-parity/tools.md), [panels](photoshop-parity/panels.md), [dialogs and look](photoshop-parity/dialogs.md). They cite the Photoshop layout files (`Contents/Required/layouts/**/*.exv`, `drover_layouts/**/*.eve`) and string tables. Anything not in those files is marked *(from memory)* there. This document is the decision layer on top of them. Where the two disagree, this document wins.

## 1. Interaction model

These rules stop the "erasing, then flashing back, then erasing again" class of bug from coming back in another tool. The cause was architectural: one global lock greyed the whole UI for every edit, and overlays were cleared before the new image was on screen. Both are now fixed in the runtime and the canvas, not tool by tool, so new tools get the fix if they follow these rules.

### 1.1 What locks the controls

| Kind of work | How it runs | Controls |
|---|---|---|
| Opening, refreshing, creating or exporting the image; entering or leaving Smart Object contents; placing a file | `operation(work)` (loud) | locked (`controlsLocked`) |
| Every edit command, from menus, panels, dialogs, keys or canvas | `runPhotoCommand(id, params)`: always quiet, queued behind the previous edit | stay usable |
| Pointer gesture (stroke, marquee drag, move, transform handles, patch, shape drag) | `holdImageGesture(reason)` at pointer-down; release it **synchronously before** the commit's `runPhotoCommand` so the commit runs ahead of anything queued during the drag | stay usable; new strokes wait until the commit finishes |
| Multi-click draft (polygon lasso, pen, magnetic lasso) | `beginXDesignActivity` only, no lock | stay usable; an edit that changes the image version cancels the draft |
| Foreground/background colour | `setPhotoColors`: quiet, rapid picks merge into one native call | stay usable |

Rules:
- Only `runtime.ts` writes `busy`/`quiet`. `lockOwnership.contract.test.ts` enforces this.
- Controls read `controlsLocked`, not raw `busy`. The one exception is a modal dialog disabling its own OK while its own commit runs.
- A command started while another commits waits; it never throws "Wait for the image operation to finish". That error is only for lifecycle work.

### 1.2 No flash: the stand-in rule

The canvas keeps showing the previous image until the committed preview (`{version}.png`) has decoded. Whatever stands in for the edit (stroke pixels, selection outline, crop box, text field, dragged path, transform preview) **stays until then**:
- Canvas commits use `clearWhenShown(command(...))`. Overlays get the `untilShown(work)` prop and clear themselves when it resolves.
- Never clear an overlay synchronously after starting a command.
- `untilShown` resolves on the image's `onLoad`, with a 2s safety timeout.

### 1.3 Cursors

| Tool | Canvas cursor | Status |
|---|---|---|
| Move, Path Selection, Direct Selection | arrow | done |
| Type | I-beam | done |
| Eyedropper, Paint Bucket, Lasso, Magic Wand | the toolbar icon, outlined for light and dark pixels, hotspot at the working tip | done |
| Hand, or Space held | grab / grabbing | done |
| Zoom | zoom-in; zoom-out while Alt is held | done |
| Brush-like tools (Brush, Pencil, Eraser, Clone, Healing, History, Blur/Sharpen/Smudge, Dodge/Burn/Sponge, Quick Selection) | the tip outline at its true size, if 6px or more on screen; otherwise crosshair | done |
| Marquee, Polygonal/Magnetic Lasso, Crop, Gradient, Shapes, Pen, Patch | crosshair | Photoshop shows tool icons for Polygonal/Magnetic Lasso, Crop and Pen variants (+, −, convert): **gap** |
| Caps Lock | precise crosshair for every painting tool | **gap** |

### 1.4 Known edges (accepted for now)

- A new stroke is refused for the ~100–300ms its predecessor takes to commit. Photoshop buffers it. Stroke buffering is the next interaction item.
- Arrow-key nudges pressed while an edit commits are dropped.
- A command queued behind a commit carries the layer index it was given when queued.
- Crop: the old image is stretched to the new size until the new preview decodes (pre-existing).
- Magnetic lasso: its outline clears just before the marching ants appear.
- At high zoom, tiles (`PhotoTiles`) can show old pixels for a frame.
- Transform: the stand-in preview exists only if its 120ms preview finished before release; otherwise the old pixels show until the commit.

### 1.5 Checklist for any new tool, overlay or command

1. Runs through `runPhotoCommand`, a gesture hold, or a draft activity, as in 1.1. No direct `busy` writes.
2. Keeps its stand-in until `untilShown` resolves (1.2).
3. Has a cursor from 1.3 (add it to `TOOL_CURSORS` in `PhotoStudio.tsx` and `photo.css`).
4. Its controls read `controlsLocked`.
5. Its shortcut and menu label come from the shared shortcut table (2.3).
6. Its test asserts that controls stay enabled during the commit and that the overlay stays until the image is shown.

## 2. Menus

### 2.1 Look and behaviour (applies to the menu bar, submenus, context menus and panel flyouts)

`EditorMenu` (`EditorChrome.tsx`) is shared with the design editor (`XDesignApp.tsx`), so this applies to both.

| Aspect | Target | Now |
|---|---|---|
| Titles | text only, 13px | icon + chevron hidden by CSS, 12px |
| Open and switch | click opens; while one is open, hovering another title switches menus | each menu toggles independently |
| Row | 22px high, 13px | 4px padding, 12px |
| Row layout | grid `[14px check][1fr label][auto shortcut][12px ▸]`, check gutter on every row | label only |
| Shortcut column | right-aligned glyphs in ⌃⌥⇧⌘ order (`⇧⌘Z`, `F5`) in `--xd-text-2` | none |
| Submenus | ▸ at right; open on hover (~200ms) or →; close on ← or Esc | none: flat lists, and Filter uses accordions |
| Disabled items | shown, dimmed | some are hidden instead |
| Checkmarks | ✓ in the gutter, `role=menuitemcheckbox/radio` + `aria-checked` | `aria-current` + `::before` |
| Keyboard | ↑↓ wrap, ←→ change menu or submenu, Enter, Esc, type-ahead | ↑↓ Home End Esc |
| ARIA | `menubar` / `menu` / `menuitem`, `aria-haspopup`, `aria-expanded` | plain buttons |
| Width | fits content, minimum ~200px | fixed 240px minimum |
| Scrolling | none, except very tall Filter submenus | max-height 70vh scroll |
| Separators | 1px hairline, ~5px margin | ok |
| Highlight | full-width accent fill, white text | ok in dark theme; light-theme contrast unchecked |

### 2.2 Menu bar contents

Order: **File, Edit, Image, Layer, Type, Select, Filter, View, Window.** Full per-item tables are in [menus.md](photoshop-parity/menus.md) §2.

| Menu | What changes |
|---|---|
| File (new) | Place Embedded…, Place Linked…, Save ⌘S and Export ▸ Export As… ⌥⇧⌘W move here from Image. New/Open/Close only once the editor can do them (decision D1) |
| Edit | Add Undo ⌘Z / Redo ⇧⌘Z, Clear, Free Transform ⌘T, Transform ▸ (Again ⇧⌘T, Scale, Rotate, Skew, Distort, Perspective, Warp, rotations, flips), Paste Special ▸ (Paste in Place ⇧⌘V, Paste Into ⌥⇧⌘V, Paste Outside), Puppet Warp, Perspective Warp, Define Brush Preset…, Color Settings… ⇧⌘K, Assign/Convert to Profile…. Relabel the clipboard items Cut, Copy, Copy Merged, Paste |
| Image | Mode ▸ (with bit depths), Adjustments ▸ (destructive, modal), Auto Tone/Contrast/Color with shortcuts, Image Size… ⌥⌘I, Canvas Size… ⌥⌘C, Image Rotation ▸, Crop, Trim…, Reveal All, Apply Image…, Calculations…. Remove the File items and Perspective Crop |
| Layer | Submenus New ▸, Delete ▸, Layer Style ▸, New Fill Layer ▸, New Adjustment Layer ▸, Layer Mask ▸, Smart Objects ▸, Rasterize ▸, Arrange ▸ (⌘[ ⌘] ⇧⌘[ ⇧⌘]), Align ▸, Distribute ▸, Matting ▸. Add Create Clipping Mask ⌥⌘G, Merge Down (⌘E with one layer selected), Rename Layer…, Hide Layers ⌘, , Lock Layers… ⌘/ |
| Type (new) | Anti-Alias ▸, Orientation ▸, Create Work Path, Convert to Shape, Rasterize Type Layer, Convert to Paragraph/Point Text, Warp Text…, Update All Text Layers. Enabled only for a type layer |
| Select | Reorder to Photoshop's order; Modify ▸ (Border, Smooth, Expand, Contract, Feather ⇧F6); add Sky, Save Selection…, Edit in Quick Mask Mode (checked), All Layers ⌥⌘A, Deselect Layers, Find Layers, Isolate Layers. Remove the options-bar "Select" dropdown |
| Filter | Real submenus: Last Filter ⌃⌘F, Convert for Smart Filters, Filter Gallery…, Lens Correction… ⇧⌘R, Liquify… ⇧⌘X, then Blur ▸ Blur Gallery ▸ Distort ▸ Noise ▸ Pixelate ▸ Render ▸ Sharpen ▸ Stylize ▸ Video ▸ Other ▸. Search stays in the Command Browser |
| View | Proof Setup ▸, Proof Colors ⌘Y, Gamut Warning ⇧⌘Y, then Zoom In/Out, Fit on Screen ⌘0, 100% ⌘1, 200% |
| Window | Alphabetical panel list with checks; choosing a checked panel closes it; remove "Document" |

### 2.3 Shortcuts

One table generates both the key handler and the glyphs shown in menus. It extends `MENU_SHORTCUTS` in `PhotoStudio.tsx`.
- Wrong today: ⇧⌘S exports (Photoshop: Save As…). ⌘E always merges (Photoshop: Merge Down when one layer is selected).
- To wire (the command already exists): ⇧F5, ⇧⌘N, ⌥⌘G, ⌘[ ⌘] ⇧⌘[ ⇧⌘], ⌘, , ⌘/, ⌥⌘A, ⌥⇧⌘F, ⌥⌘R, ⇧F6, ⇧⌘T, ⌥⇧⌘V, ⌥⌘I, ⌥⌘C, ⇧⌘L, ⌥⇧⌘L, ⇧⌘B, ⌘L, ⌘M, ⌘U, ⌘B, ⌘I, ⇧⌘U, ⌥⇧⌘B, ⇧⌘X, ⌃⌘F, ⌥⇧⌘C, ⇧⌘K.

### 2.4 Context menus and panel flyouts (none exist today)

Both use the 2.1 menu component. Contents per surface are in [menus.md](photoshop-parity/menus.md) §3:
- **Right-click:** layer rows (pixel, group, smart object and type variants), canvas with a selection tool (Deselect, Select Inverse, Free Transform, Fill…, Stroke…, Layer via Copy/Cut), Crop (Crop, Cancel), Patch (Source/Destination), Pen (Make Selection…, Fill Path…, Stroke Path…, Delete Path, Add/Delete Anchor Point).
- **≡ flyout on every panel:** Layers, Channels, Paths, History, Swatches, Gradients, Patterns, Brushes, Shapes, Styles, Tool Presets, Color. These replace the `PresetManager` forms and the text-button footers.

## 3. Tools and options bar

Details per tool: [tools.md](photoshop-parity/tools.md).

### 3.1 Toolbar

- **Groups and order (Photoshop default):** Move · Marquee (M) · Lasso/Polygonal/Magnetic (L) · Object Selection/Quick Selection/Magic Wand (W) · Crop (C) · Eyedropper (I) · Spot Healing/Healing/Patch/Red Eye (J) · Brush/Pencil/Color Replacement/Mixer (B) · Clone/Pattern Stamp (S) · History Brush (Y) · Eraser/Background/Magic Eraser (E) · Gradient/Paint Bucket (G) · Blur/Sharpen/Smudge · Dodge/Burn/Sponge (O) · Pen variants (P) · Type (T) · Path/Direct Selection (A) · Shapes (U) · Hand (H) · Zoom (Z) · fg/bg chips, swap (X), default (D), Quick Mask (Q), screen mode (F). Today the selection and retouch tools share groups.
- **Flyout:** a press-and-hold or right-click flyout (small triangle at the button's lower right). Each row shows icon, name and letter, and the current tool is checked. Today it is an invisible native `<select>` over a chevron.
- Already right: each group remembers its last tool, and Shift+letter cycles within the group.

### 3.2 Options bar, by priority

1. **Selection tools:** the four-icon mode cluster (New, Add, Subtract, Intersect) driven by the same state as the Shift/Alt modifiers. Feather, Anti-alias, Style (Normal / Fixed Ratio / Fixed Size) with W/H, and a Select and Mask… button.
2. **Painting tools:** a brush preset picker popover (size, hardness, tip, preset list) replaces the plain number fields. Opacity and Flow become popup sliders. Add the airbrush, smoothing, angle and pressure toggles where the engine supports them. Remove Flow/Spacing from the retouch tools, which Photoshop doesn't show there.
3. **Gradient:** gradient picker, five type icons (Linear, Radial, Angle, Reflected, Diamond), Mode, Opacity, Reverse, Dither. **Bucket:** Source (Foreground/Pattern), Mode, Opacity, Tolerance, Anti-alias, Contiguous, All Layers.
4. **Move:** Auto-Select (Layer/Group), Show Transform Controls, Align/Distribute buttons.
5. **Crop:** ratio preset, W×H with swap, Straighten, overlay options, Delete Cropped Pixels.
6. **Eyedropper:** Sample Size (Point … 101×101), Sample (Current Layer, All Layers …), Show Sampling Ring.
7. **Eraser** Mode (Brush/Pencil/Block) and Erase to History; **Patch** Source/Destination, Transparent, Structure, Color; **Healing** Type (Content-Aware / Create Texture / Proximity Match); **Clone** Aligned, Sample, Show Overlay.
8. **Shapes:** Mode (Shape/Path/Pixels), Fill, Stroke, width, W/H, corner radius. **Type:** font, style, size, anti-alias, alignment, colour, warp, Cancel/Commit. **Hand/Zoom:** 100%, Fit Screen, Fill Screen.

### 3.3 Keys

Missing: `[` `]` scaled steps (today a fixed ±5), Shift+`[` `]` hardness ±25%, number keys for opacity (Shift for flow), Shift-click straight line, ⌃⌥-drag to resize the brush, Tab to hide panels, F for screen modes, ⌘Space / ⌥⌘Space temporary zoom, ⌘ held for a temporary Move. Already right: Space pan, Alt sampling while painting, X, D, Q, Shift+letter cycling, Esc/Enter in drafts.

## 4. Panels

Details: [panels.md](photoshop-parity/panels.md).

### 4.1 Dock

| Group | Target | Now |
|---|---|---|
| Top | **Color**, Swatches, Gradients, Patterns | no Color panel |
| Middle | Properties, Adjustments | plus a "Document" tab, which Photoshop doesn't have. Its contents move to Properties when nothing is selected |
| Bottom | Layers, Channels, Paths | ok |
| Iconised strip | History, Navigator, Brushes, Styles, Shapes, Tool Presets, with names on hover | ok contents; opens as an overlay instead of docking |
| Every panel | tab row with ≡ flyout at the right | no flyouts |

### 4.2 Color panel (new; the reference is `Color/Panels/color-1590.exv`)

- **Default mode:** Hue Cube. On the left, fg/bg chips with swap and default, with a gamut warning (icon + nearest-in-gamut swatch) beneath. In the centre, the saturation/brightness field. On the right, a vertical hue strip, 19px wide.
- **Other modes, from the flyout:** Brightness Cube, Color Wheel (with "Add a new swatch for this color"), Grayscale, RGB, HSB, CMYK, Lab and Web Color sliders. Each slider row has a letter label, a 6px ramp over a 12px slider, a 4-digit field and a unit. RGB adds a `#` hex field.
- **Bottom:** a colour ramp ("Click to sample color").
- **Flyout:** the modes above, Copy Color as HTML, Copy Color's Hex Code, Close, Close Tab Group.
- **Behaviour:** the native `<input type=color>` chips in the tool rail and the Swatches panel are replaced. Clicking a chip opens the Color Picker (5.2). Changes go through `setPhotoColors`, so dragging in the field merges into one native call per frame.

### 4.3 Other panels, main gaps

- **Layers:** filter row (kind, name, effect, mode, attribute, colour); Opacity and Fill as popup sliders; auto-nest lock; per-kind thumbnails; mask thumbnail with link icon; fx badge with a per-effect sublist; clipping indicator; group disclosure arrow. Unify the two conflicting row-height rules (`photoshop.css` 40px vs `photo.css` 36px).
- **Properties:** clusters by selection. Pixel layer: Transform W/H/X/Y/rotate/flip, Align and Distribute, Quick Actions. Shape: Appearance (fill, stroke, corner radii). Mask: Density, Feather, Select and Mask…, Color Range…, Invert. Nothing selected: Canvas, Quick Actions (the old Document tab). Adjustment layer: the live adjustment editor (see 5.1). Remove the duplicated Name and Lock controls.
- **Adjustments:** a 16-tile icon grid plus presets. Clicking a tile adds the adjustment layer and opens it in Properties, with no modal.
- **Channels and Paths:** thumbnails; icon footers (Channels: load, save, new, delete; Paths: fill, stroke, load as selection, make work path, new, delete); rename by double-click; everything else moves to the flyout. Remove the help paragraph and the text-button footer.
- **History:** snapshots area and a footer (new snapshot, delete) if the engine supports snapshots. Flyout: Step Forward/Backward, Clear History.
- **Navigator:** zoom-out/zoom-in icons, and an editable % field.
- **Swatches / Gradients / Patterns:** icon bar plus flyout instead of forms. The gradient editor leaves the panel for the Gradient Editor dialog.
- **Info (F8) and Histogram:** add Info with cursor position and colour readouts (the capability exists). Histogram only if the engine provides the data.

## 5. Dialogs

Details per dialog: [dialogs.md](photoshop-parity/dialogs.md).

### 5.1 Conventions (all modal dialogs)

- **Buttons:** OK (default) above Cancel in a right-hand column. Holding Alt turns Cancel into Reset, which restores the values the dialog opened with. The label is "OK", not "Apply" or "Create image". Enter = OK, Esc = Cancel, including when focus is in a select.
- **Preview:** one "Preview" checkbox, on by default, with the effect drawn on the document. Filter dialogs keep a thumbnail with zoom −/+ and a % readout. This merges "Live preview", "Original" and "Preview changes".
- **Titles in Title Case:** "Image Size", "Canvas Size", "Color Range".
- **Labels** in Photoshop wording with a unit suffix ("Radius: [ ] Pixels"). Enum values get real labels; fix `title()` in `PhotoActionDialog.tsx`, which shows "HorizontalOnly", `bicubic` and `topLeft` raw.
- **Remembered values:** last-used values per command for the session, which Last Filter reuses.
- **Adjustments:** on adjustment layers they edit live in Properties. Only Image > Adjustments (destructive) is modal.
- **Transform:** on-canvas only (the options bar holds W/H/angle/interpolation). Remove the modal `ImageTransformDialog`.

### 5.2 Color Picker (new; reference `Color/Dialogs/cube-1660.exv`)

- **Title** per use: "Color Picker (Foreground Color)", "(Background Color)", "(Stroke Color)" …
- **Layout:** a large field and a hue strip with triangle markers; "new" over "current" swatches (clicking current reverts).
- **Fields:** radio-selectable H/S/B, R/G/B, L/a/b and C/M/Y/K, plus `#` hex.
- **Warnings:** gamut and web warnings; an Only Web Colors checkbox.
- **Buttons:** OK, Cancel, Add to Swatches. Color Libraries is out of scope.
- **Opens from:** the fg/bg chips and every colour field in dialogs (Stroke, Canvas Size extension, Replace Color, Photo Filter).
- **Order:** H/S/B, R/G/B and hex come first; Lab and CMYK follow, using the existing colour-profile commands.

### 5.3 Image Size and Canvas Size

- **Image Size:** a size readout; Dimensions; Fit To; Width/Height/Resolution, each with a units popup (Pixels, Inches, Centimeters, Millimeters, Points, Picas, Percent); a link icon for constrain; Resample with Photoshop's list (Automatic, Preserve Details, Preserve Details 2.0, Bicubic Smoother/Sharper/Bicubic, Nearest Neighbor, Bilinear) and Reduce Noise; a preview pane. Drop `lanczos` and `none`.
- **Canvas Size:** Current Size and New Size readouts; units; Relative; a 3×3 anchor grid; Canvas extension color (Foreground, Background, White, Black, Gray, Other…) with swatch.

## 6. Look: token gaps for the design owner

The Photoshop reference values come from `UIColors.txt`, as theme entries lightest → darkest. None is added as a token here. Each one needs a decision by Hermes, and until then the closest existing token stays.

| Need | Photoshop | Closest token today |
|---|---|---|
| Panel fill | 83 or 50 grey | `--xd-panel` #2c2c2c (44) |
| Dialog body | 50 / 37 | `--bg-1` (neon-tinted, outside `.xd-root` semantics) |
| Control fill (field, popup) | 71 / 45 | `--bg-2` |
| Control frame | white at .34 / .30 alpha | `--xd-border` (opaque) |
| Group frame / divider | 66 / 38, 62 / 38 | none |
| Disabled text | 135 / 115 | whole-control opacity .4 |
| Button fill / pressed / stroke | 69 / 41, 56 / 31, 102 / 71 | none (transparent; submit is accent-filled) |
| Slider track / thumb | 117 / 87; 240 with 33 stroke | native range with an accent colour |
| Focus ring | rgb(20,115,230) | `--xd-accent` #0d99ff |
| Tooltip | rgb(255,255,205), black text | unchecked |
| Alert | rgb(239,60,57) | no danger token confirmed |
| Modal scrim | none (the app is blocked, not dimmed) | raw `rgba(0,0,0,.35)` |
| Control height | ~22px *(from memory)* | ~26px |
| Menu row height | 22px | no token |

## 7. Decisions needed

Each decision has a recommendation, following "Reference fidelity is the default".

| # | Decision | Recommendation |
|---|---|---|
| D1 | File menu scope: New/Open/Close are not reachable from the editor today | Save, Save As… (once it exists), Export ▸, Place. Leave ⇧⌘S unbound until Save As exists, and move Export As to ⌥⇧⌘W |
| D2 | OK/Cancel position | Photoshop's right-hand column everywhere |
| D3 | Dialog preview on the canvas (the dialog must not cover the image) or in the dialog | On the canvas, with dialogs movable and opening beside the image |
| D4 | Radii and focus ring: DESIGN.md rejects angular radii and asks for a quiet 1px ink focus ring; Photoshop is near-square with a blue ring | Hermes decides; the menu and panel structure work doesn't depend on it |
| D5 | Adjustment layers edited live in Properties (Photoshop) instead of the modal | Yes; keep the modal only for Image > Adjustments |
| D6 | Drop the Document tab and fold it into Properties | Yes |
| D7 | Layer Effects editor: today a Styles flyout; in Photoshop it's the Layer Style dialog | Layer Style dialog |

## 8. Plan

Phases are ordered by how visible they are and how much later work depends on them. Each phase starts with focused tests and ends with `npm run typecheck` and the xdesign suite.

1. **Menu system (largest single lever).** One menu component with submenus, the shortcut column, hover-switch, keyboard and ARIA. It serves the menu bar, context menus and panel flyouts, for both editors. Add the shortcut table. Restructure File/Edit/Image/Layer/Type/Select/Filter/View/Window per 2.2. Fix ⇧⌘S and ⌘E.
2. **Color panel and Color Picker** (4.2, 5.2). Reorganise the dock (Color tab; Document folded into Properties).
3. **Toolbar and options bar.** Regroup and reorder; a real flyout; the selection mode cluster; brush preset picker and popup sliders; gradient type icons; the missing options per 3.2; the keys in 3.3; stroke buffering (1.4).
4. **Panels.** Layers row anatomy and filter row; Properties clusters; Adjustments grid with live Properties editing; Channels/Paths/History footers and flyouts; Navigator; Info.
5. **Dialogs.** Conventions (5.1); Image Size and Canvas Size; label and enum fixes; remembered values; the Layer Style dialog.
6. **Look.** Apply Hermes's token decisions (6, D4).

Phases 1 and 2 can run in parallel, and so can 3 and 4. Phase 5 depends on D2/D3. Phase 6 depends on Hermes.
