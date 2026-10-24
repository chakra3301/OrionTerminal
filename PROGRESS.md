## 2026-10-24 (evening) — XDesign photo: live pass of the panel-internals round, eleven fixes

Branch: `validation/alpha-2026-09-14`. **Committed, not pushed** (owner: "okay lets commit"), as two commits:
- `c6ff015`: the XDesign photo work (`src/apps/xdesign/photo/`, `src-tauri/src/xdesign_photo*.rs`, `src-tauri/vendor/photocraft/`, `docs/architecture/xdesign/photoshop-parity/`).
- The checkpoint commit that contains this entry: every other dirty path on the branch, including other sessions' work (Archives, Orion, intake, media download, landing, companions and character models, licences, Cargo) and the shared files (`lib.rs`, `Cargo.toml`, this file). `c6ff015` does not build without it.

Owner: "do it yourself", meaning I ran the live check of the entry below in the dev app myself. All probing used the scratch project ("Untitled design", `xd-ps-test.png`) only. Photoshop was used only to read its bundle files and strings.

Changed (behaviour fixes got a failing test first; CSS and icon fixes were checked by screenshot; every fix was re-checked live):
1. **Crop: Show Cropped Area off left a faint frame** (`photoshop.css`, `CropOverlay.tsx`).
   - The hidden shade was `#242426`, not the real pasteboard. It now uses `var(--xd-bg)`, or `#000` in full-screen mode, mirroring the pasteboard rules.
   - With the outside hidden, the shade path runs 2 screen px past the image so fractional zooms leave no column of image pixels.
   - Checked live: 28,28,28 on both sides of the edge.
2. **Blue focus ring around the canvas after a key press** (CSS-only): `.xd-photo-image > canvas:focus-visible { outline:none; }`.
3. **Keys ignored while a menu trigger had focus** (`PhotoStudio.tsx` key handler).
   - Letters, digits, H and Escape now reach the editor from the tool-options gear and other menu triggers. Space, Enter and arrows still activate the trigger.
4. **Number keys did nothing after a tool switch**: focus is reclaimed by the editor when a tool is picked.
5. **⌘2 opened the Orion app instead of the RGB composite.**
   - After the double-click into photo mode, focus stayed on the aria-hidden design canvas, so the shell's ⌘-digit handler won.
   - The editor now takes focus back from it. Checked live: ⌘3 shows Red only and ⌘2 returns to RGB.
6. **Doc tab** (`docTab.ts`) names a targeted colour channel, e.g. "(Background copy, Red/8#)", as in Photoshop.
7. **History source column was invisible** (CSS-only, `photo.css`).
   - The generic `.xd-photo button` rule (0,1,1) beat `.xd-photo-history-src` (0,1,0). The fix is the `.xd-photo ` prefix.
8. **Clip arrow pointed the wrong way**: `CornerLeftDown` instead of `CornerDownLeft`, matching `MACDFR_ClippingMask.pdf` in the PS bundle.
9. **Group blend mode showed "Normal"** (`PhotoStudio.tsx`).
   - The blend select now offers "Pass Through" first, for groups only. Groups show their real mode.
10. **Brush Flow/Spacing/Smoothing/Wet read "10.000000149011612"** (`PaintToolOptions.tsx`).
    - The engine stores these as f32. A `percent()` helper rounds to 4 decimals, which keeps real fractions like 12.5%.
11. **Selection display and Extras** (`PhotoStudio.tsx`, `PhotoTiles.tsx`, `viewGuides.ts`).
    - Selections showed a blue tint inside the ants because the selection display defaulted to "Outline & overlay". Photoshop shows marching ants only, so the default is now "Outline". The overlay is still in Properties › Selection.
    - ⌘H (Extras) hid only the grid and guides, so with neither showing it seemed to do nothing. A new **View › Show › Selection Edges** item (Photoshop's string is "&Selection Edges") joins Grid and Guides. Extras now governs it too, through `selectionEdgesVisible`. Hidden edges also hide the overlay that stands in for a truncated outline. A soft overlay the user chose stays.
    - Checked live: ants with no tint; ⌘H hides them and unchecks View › Extras; ⌘H again restores them; the Show submenu reads Selection Edges ✓, Grid, Guides ✓.

Verified live, matching Photoshop:
- Layers: lock badge, footer, Photoshop's tooltips, and the fill/adjustment popup's list and grouping. Clip arrow plus underlined base after fix 8. Group Pass Through after fix 9.
- Channels: thumbnails, ⌘2–⌘5 labels, footer, and ⌘3/⌘2 targeting.
- Paths: footer and Work Path thumbnail.
- History: three-icon footer, and the source column after fix 7.
- Number keys set Opacity, after fix 4.
- Crop: Show Cropped Area, H, / and X.
- Rulers: ⌘R, with zero at the image's top-left corner.

Tests:
- `npx vitest run` on PhotoStudio.tools, PhotoStudio.layout, EditorMenus, docTab, PaintToolOptions, PhotoHistory, PhotoTiles, viewGuides, viewAids and PhotoProperties: 10 files, 283 passed. viewAids.studio: 6 passed.
- New tests:
  - layout: Pass Through for groups only; marching-ants-only default; Selection Edges via View › Show and ⌘H;
  - tiles: edges hidden drop the ants and the truncated-outline overlay;
  - paint options: f32 rounding;
  - tools: crop focus and hidden-design-canvas focus.
- `npm run typecheck`: clean.
- No Rust or Cargo.toml changes, so no timing logs and no license refresh.

Dev notes:
- Live driving goes through `/tmp/pstest/go.sh`, which aborts if the owner is active in another app, and `/tmp/pstest/shot.sh`.
- Editing `PhotoStudio.tsx` often crashes HMR into the root ErrorBoundary ("Orion Terminal hit an error"). This is dev-only; `touch index.html` recovers it.

Open questions / next (gaps seen live, not fixed):
- **Paths:**
  - The path outline is drawn only while a path-selection tool is active. Photoshop keeps the target path drawn.
  - View › Show has no Target Path (⇧⌘H) yet.
- **Pen:** the options bar lacks Make: Selection/Mask/Shape and the path operations.
- **Crop:** selecting the tool doesn't show a crop box over the whole image until you drag.
- **Adjustment layers:** new ones lack Photoshop's default white mask. This needs an engine change.
- **History:**
  - The snapshot thumbnail is a placeholder unless the opening state is current.
  - The list doesn't auto-scroll to the current state.
- **Menus:** after Esc closes a menu, the menubar trigger keeps a focus ring. That's keyboard accessibility (focus returns to the trigger) and shortcuts still work, so I left it.
- No tokens were added, so there are no Hermes gaps.

## 2026-10-24 (later) — XDesign photo: panel internals, number keys, Crop Show Cropped Area

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: "amazing keep going". This entry closes the "Not covered" items in `docs/architecture/xdesign/photoshop-parity/live-test-2026-10-24.md`. That doc's "Not covered" section now lists what was done and, for each gap still open, why.
- **Reference:** Photoshop 2026 bundle files only: `layers_panel.eve`, `Channels/Paths/History.exv`, `cropOptionsFlyout-2381.exv`, strings from the binary and `Default Keyboard Shortcuts.kys`.
- **Who did it:** three Sonnet 5.5 agents did Layers, Channels/Paths and History. I reviewed their code and did the crop work myself.

Changed:
1. **Layers panel** (`PhotoStudio.tsx`, `photo.css`).
   - Clipping arrow on clipped rows, with the base layer's name underlined. I checked the list is top first by reading `layerDropPosition`.
   - The lock badge is solid for Lock All and outline for partial locks.
   - Photoshop's tooltips on the lock row, the footer and the filter row.
   - "Create new fill or adjustment layer" opens a menu: Solid Color…, Gradient…, Pattern…, then the adjustments. It shares `fillLayerItems` with Layer › New Fill Layer, which now reads "Pattern…".
   - A Group filter mode, plus Rename Layer… and Hide/Show Layers in the flyout.
2. **Number keys** (`PhotoStudio.tsx` key handler).
   - With a tool that doesn't paint: 1–9 and 0 set the layer's Opacity, and Shift sets Fill. Two quick digits give an exact value. Each change is one `layer.setProps`, in the same 0–1 units as the sliders.
   - With Airbrush on, digits set Flow and Shift+digits set Opacity.
3. **Channels** (`PhotoChannels.tsx`; Rust `xdesign_photo.rs`, `lib.rs`).
   - Thumbnails come from a new read-only command, `xdesign_photo_channel_thumbnails`. It works like `layer_thumbnails`: colour channels come from the composite thumbnail, and alpha channels and Quick Mask are sampled.
   - Rows show ⌘2–⌘9 labels, and the shortcuts work: one key-handler line sends `channel.target`. No other XDesign or shell shortcut uses ⌘2–⌘9.
   - Load as selection works for the composite, colour and alpha channels, from the button or by ⌘-click. Shift adds, Option subtracts, Shift+Option intersects.
   - Duplicate Channel… is enabled for colour channels, and Panel Options… is shown, but disabled.
4. **Paths** (`PhotoPaths.tsx`).
   - SVG thumbnails from `path.info`.
   - Photoshop's footer: Add a mask (`layer.vectorMask.fromPath`) and Create new path, an empty `path.set`. Create new path replaces the old Save work path button; Save Path… moved to the flyout.
   - The flyout follows Photoshop's order, including Duplicate Path… and Clipping Path… (`path.clippingPath.set`, flatness 0). Panel Options… is disabled.
5. **History** (`PhotoHistory.tsx` rewritten).
   - A snapshot row: click it to return to the opening state. It is disabled once the 50-state cap has evicted that state.
   - A History Brush source column, wired to the existing `setHistorySource`.
   - Footer and flyout in Photoshop's order.
   - New Snapshot, New Document from state, Delete, Clear History and History Options are disabled: the engine has no support for them.
   - Review fixes: "..." became "…" to match every other XDesign menu. The snapshot row's tooltip was Photoshop's "Drag to change…" (for a slider XDesign lacks); it now reads "Return to this state".
6. **Crop** (`CropOverlay.tsx`, `PhotoStudio.tsx`, `photo.css`).
   - Show Cropped Area is in the gear menu, shown with the H shortcut. When it is off, the area outside the box is painted the stage colour (`#242426`, the existing `.xd-photo-stage` value).
   - While a crop box is up, H toggles Show Cropped Area, / toggles the shield and X rotates the box. Otherwise H still picks the Hand tool and X still swaps colours.
   - The shield opacity defaults to 75%, as in Photoshop.

Tests:
- `npx vitest run src/apps/xdesign/photo`: 98 files, 1352 passed, 0 failed (one run after all agents finished).
- New test files: `PhotoChannels.test.tsx`, `PhotoPaths.test.tsx` and `PhotoHistory.test.tsx`.
- Added to `PhotoStudio.tools.test.tsx`:
  - clip and lock badges;
  - the fill/adjustment menu;
  - number keys, including pairs, 0, Shift and the Background no-op;
  - Show Cropped Area and the H, / and X keys.
- Flyout and footer label assertions were updated on purpose.
- `npm run typecheck`: clean.
- Rust gate `cargo test --lib xdesign_photo -- --test-threads=1`: 797 passed, 0 failed, 1 ignored. This includes the new `channel_thumbnails_cover_composite_colors_alpha_and_quick_mask`.
- `grep "\[timing\]"` finds none. Cargo.toml is unchanged this session (its dirty state dates from 2026-10-22), so the license manifest needed no refresh.

Verification:
- **Live:** none. Everything is unit-tested only and has not been seen in the running app.
- **Not tested:**
  - the ⌘2–⌘9 key handler;
  - the airbrush digit swap;
  - real channel thumbnails beyond the Rust test.

Open questions / next:
- **Engine gaps:**
  - Layers: the artboard auto-nest lock, the Color and Artboard filter modes, and the Cleanup button.
  - History: named snapshots, new document from a state, deleting a state and everything after it, and Clear History.
- **No dialogs yet:**
  - Duplicate Channel, Duplicate Path and Clipping Path (flatness) act at once.
  - Panel Options… on Channels and Paths.
- **Known differences:**
  - Two quick digits record two history steps, not one.
  - Add a mask doesn't switch to Add vector mask on a second click.
  - The snapshot thumbnail is an icon unless the current state is the opening state.
  - Crop has no Use Classic Mode or Auto Center Preview. XDesign's crop already moves the box, which is classic behaviour.
- No tokens were added, so there are no Hermes gaps.

## 2026-10-24 — XDesign photo: closing the live-test gaps (focus, adjustment dialogs, Layer Style, tool bars, menus, view aids, panels)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: "okay do recommended but get thru them all", which means every gap in `docs/architecture/xdesign/photoshop-parity/live-test-2026-10-24.md`. That doc now has a "Status after the parity round" section listing what is closed and, for each item still open, why. Most of the work was split across Sonnet 5.5 agents; I reviewed each one's code and re-ran its tests.

Changed:
1. **P0: shortcuts work wherever focus is** (`PhotoStudio.tsx`).
   - `section.xd-photo` takes `tabIndex={-1}`, a click anywhere in the editor focuses it unless it lands in a field, and Enter in a field hands focus back.
   - Checked live: after a click on the Channels tab, ⌘L opens Levels, not R.O.S.I.E. ⌘M reaches Curves, so a page handler beats the native menu.
2. **Adjustment presets.**
   - `adjustmentPresetFiles.ts` (new) reads and writes Photoshop's own preset files: `.alv`, `.acv`, `.eap`, `.ahu`, `.blw`, `.cha`, `.asv`. The decoders are checked against hex from the files Photoshop ships. Selective Color ships no files, so `.asv` is only round-trip tested.
   - `AdjustmentPresetRow.tsx` (new): Preset dropdown plus a gear menu with Load Preset… / Save Preset…, in the dialogs and in Properties. Properties' old inline select is gone.
   - Rust: new `write_file_base64` in `fs_ops.rs` (atomic write) for saving the binary files.
3. **Levels and Curves** (`toneSampler.ts`, `curveTools.ts`, `toneClipping.tsx` new; `ToneTools.tsx`, `toneControls.tsx`).
   - Black, gray and white eyedroppers, plus Options… (the Auto Color Correction dialog: algorithms, Snap Neutral Midtones, target colours, clip %). Rust: new `xdesign_photo_sample` reads the pixels under (or of) the adjustment layer.
   - Curves: point and pencil tools (a pencil curve is fitted to the engine's 19-point limit), Smooth, Light/Pigment, the two grid sizes, the Show checkboxes (Channel Overlays, Histogram, Baseline, Intersection Line), Show Clipping, and the on-image tool (drag up or down on the image to move that tone).
   - Show Clipping uses a new raw-bytes Rust command, `xdesign_photo_tone_pixels`, and composes in the engine's order (Levels master then channel; Curves channel then master), so dragging stays live.
   - Levels Gamma reads "1.00".
   - The RGB composite histogram is now the summed channels, as Photoshop draws it. Threshold gets its own `luminosity` space with the engine's Rec.601 weights.
4. **Other adjustment dialogs** (`psSliders.ts`, `psAdjustMath.ts`, `psAdjustControls.tsx`, `hueSaturationControls.tsx`, `blackWhiteControls.tsx`, `gradientMethod.ts` new; `actionControls.tsx`, `PhotoActionDialog.tsx`, `AdjustmentProperties.tsx`).
   - Photoshop slider look on Brightness/Contrast, Exposure, Hue/Saturation and Black & White: no colon, round thumb, bipolar sliders fill from the centre. Contrast 0 and Gamma 1.00 sit in the middle.
   - Brightness/Contrast: Auto (computed from the luminosity histogram; the engine has none). Use Legacy clamps Contrast to its range.
   - Exposure: the three eyedroppers.
   - Hue/Saturation: the 2026 layout (Preset, on-image tool, colour-range swatches, eyedroppers, Invert, the Before - After bars).
   - Black & White: Auto, Hue and Saturation under Tint, and dragging on the image moves the slider for the colour under the pointer.
   - Channel Mixer output channel and Selective Color Colors are swatch buttons.
   - Gradient Map: the Gradient preset picker, foreground→background default, and Method (Perceptual default, Linear, Classic, Smooth, Stripes). The engine blends stops linearly in sRGB, so Methods other than Classic are sent as up to 64 baked stops. A session memo lets a reopened map show the stops and Method the user set.
   - Color Lookup: 3DLUT File / Abstract / Device Link radios (the last two disabled: no engine support), Dither on by default.
   - Motion Blur: an angle dial inside the Angle row.
   - `controls.ts`: Exposure steps 0.01, Offset 0.0001 (eyedropper values must fit the step). The B/C and Hue/Saturation titles lose their spaces.
5. **Layer Style leftovers** (`LayerStyleDialog.tsx`, `layerStyleDialog.css`; Rust `xdesign_photo_styles.rs`).
   - Preview swatch (a CSS approximation), Make Default / Reset to Default (saved in `localStorage`), "+" on all five multi-instance effects, Bevel Direction Up/Down radios, one globe for Angle and Altitude, "Blending Options".
   - Dragging the image moves Drop Shadow, Inner Shadow and Satin (distance and angle), the Pattern Overlay origin and the Gradient Overlay centre; Gradient Overlay gains Reset Alignment. Each drag is one history step: `layer.layerStyle.editEffect` now takes an empty `path` to replace a whole effect.
6. **Image command dialogs** (`ImageDialogs.tsx`, `imageCommands.ts`, `ColorRangeDialog.tsx`; Rust preview path).
   - Shadows/Highlights: Show More Options (off by default, so it fits), Load…/Save…, Preview, scrolling body.
   - Match Color: Destination Image, Use Selection in Source/Target, live Preview including a source image.
   - Replace Color: eyedropper, Selection/Image thumbnail, Result swatch, Load/Save, Preview.
   - Image Size preview thumbnail; Canvas Size extension swatch.
   - The engine's preview path now allows Shadows/Highlights, Replace Color and Match Color (it loads Match Color's source as a second document).
7. **Tool options bars** (`toolBars.tsx` new; `PaintToolOptions.tsx`, `optionsBar.css`, `CanvasTextEditor.tsx`, `CropOverlay.tsx`, `PhotoStudio.tsx`).
   - Type: orientation, font, style, size, anti-alias, alignment, Warp Text…, colour. It edits the selected type layer, or sets the next text.
   - Shape and Pen (Shape mode): Fill, Stroke colour and width, path operations; Rectangle radius. Pen defaults to Path.
   - Path Selection: Make Selection/Mask/Shape, Fill and Stroke.
   - Crop: Ratio with W:H, swap and Clear; Straighten (draw a line and the crop box turns to level it); a gear with Crop Shield and its opacity; Delete Cropped Pixels. Fixed Size is gone because Photoshop's Crop has no such mode.
   - Gradient: preset picker with swatch, Transparency, Dither, Method (baked the same way as Gradient Map; an existing fill keeps its stops). The mode reads "Gradient" / "Classic Gradient".
   - Eraser: Mode (Brush, Pencil aliased, Block as a hard 16-screen-pixel square tip) and Erase to History.
   - Brush family:
     - Brush Settings panel toggle, Angle, Airbrush, and Pressure for Opacity and for Size. Each appears only on the tools where Photoshop shows it, and reads and writes `state.brush.settings`.
     - Symmetry offers Off and from a path (work path, selected shape layer path, saved paths). The preset symmetry types need engine support.
     - Labels renamed to Range, Aligned and Sample. Spot Healing Type is segmented buttons.
   - Marquee: "Style", Width/Height for Fixed Ratio/Size, no anti-alias on rectangles. Move: the "…" Distribute menu.
   - Eyedropper: Show Sampling Ring (`SamplingRing.tsx` new) and Sample: Current Layer, Current & Below, All Layers. Rust: `xdesign_photo_sample` takes `above_hidden`, using the new `hide_above` helper. Layer samples are not display colour-managed.
   - Zoom: Scrubby Zoom checkbox, off by default (Photoshop defaults it on).
   - Bar clutter: hints and "Editing …" moved to the footer status line. "Paint mask" left the bar; the Layers panel's mask and pixel thumbnails switch targets, as in Photoshop. "Native feedback" moved into a "Brush options" gear.
8. **Toolbar, doc tab, menus** (`PhotoStudio.tsx`, `docTab.ts` new, `ModeDialogs.tsx` new, `photoshop.css`, `extendedFilters.ts`, `imageCommands.ts`).
   - Toolbar foot: Screen Mode button. The toolbar folds into two columns when the window is short.
   - Doc tab: `name @ 100% (RGB/8#)`, with no layer name for a lone Background.
   - ⌘J on a Background: the copy is named "Layer N" inside the host (`xdesign_photo.rs` `layer_via_copy`), so it stays one "Layer Via Copy" history step.
   - Contextual task bar: Remove background (Select Subject then Reveal Selection; it converts a Background first).
   - File > New from Clipboard.
   - Names: "Dust & Scratches", no ellipsis on Find Edges and Solarize (they run directly). Filter submenus sort A→Z.
   - New items with dialogs: Image > Mode > Bitmap…, Duotone…, Indexed Color…, Color Table…, Multichannel; Trap…; Analysis > Set Measurement Scale…, Place Scale Marker…; HDR Toning….
   - New Layer items: Artboard…, Artboard from Group…, Artboard from Layers…, Rename Layer…, Layer Content Options…, Relink to File…, Reveal in Finder, Scale Effects…, Vector Mask, Mask All Objects, Stack Mode, Clear Smart Filters, Matting.
   - Select > Find Layers (⌥⇧⌘F). Type: anti-alias Windows modes, OpenType, Replace All Missing Fonts, default type styles. View: eight Proof Setup presets.
   - Filter: Average, Clouds, Difference Clouds, Flame… (needs a path), Picture Frame…, Tree….
9. **View aids** (`viewGuides.ts`, `viewAids.tsx`, `viewAids.css` new).
   - Rulers ⌘R, Grid ⌘', Guides ⌘;, Extras ⌘H, Snap ⇧⌘; and Snap To (Guides, Grid, Document Bounds, All, None), Lock Guides ⌥⌘;, Clear Guides, New Guide…, New Guide Layout…, New Guides From Shape.
   - Guides are dragged out of the rulers (Alt flips), moved with the Move tool or ⌘, and deleted by dropping them on a ruler.
   - Snapping applies to guide drags, the box-drag tools and the crop box edges.
   - **Guides are session-only.** The engine's `view.*Guide*` commands are pending, so guides are not saved in the file.
10. **Window panels** (`HistogramPanel.tsx`, `CharacterPanel.tsx`, `ParagraphPanel.tsx`, `typePanelFields.tsx`, `histogramPanel.css`, `typePanels.css` new).
    - Histogram (channel per mode, Expanded View with Source and Statistics, hover readout), Character, Paragraph, and Window > Workspace > Essentials (Default) / Reset Essentials.

Tests:
- `npx vitest run src/apps/xdesign/photo`: 95 files, 1338 passed, 0 failed (one run after every agent had finished).
- Rust gate `cargo test --lib xdesign_photo -- --test-threads=1`: 796 passed, 0 failed, 1 ignored. `cargo test --lib base64_writes` also passes.
- `npx tsc --noEmit -p .`: clean.
- Updated on purpose:
  - `paintToolPreferences.test.tsx`: Crop Fixed Size was removed.
  - The Match Color test now expects the two new selection booleans, which the engine accepts.
  - Gradient Map tests expect the Perceptual default.
- Known flaky:
  - `commandPreview.cancel.test.tsx` "does not cancel region-only pans…".
  - "restores native channel overlay options" failed once with a null `.value`, then passed alone and in three full runs. Cause not found.
- Temporary Rust timing logs were added around the new commands and are removed (`grep "\[timing\]"` finds none).

Verification:
- Live: only the P0 focus fix and the ⌘M check. **Everything else is unit-tested only and has not been seen in the running app.** That includes the canvas drawing (rulers, grid, clipping overlay, sampling ring), which jsdom can't render. I skipped a final live pass because the owner was using the Mac at the time.
- Agent output was reviewed in code. One fix came out of the review: a crop `useEffect` sat after the early `return null` (Rules of Hooks) and caused 18 PhotoStudio test failures. It was moved up.

Open questions / next:
- **Engine gaps (no honest UI possible yet):**
  - Replace Color +/− eyedroppers and Localized Color Clusters.
  - Match Color Ignore Selection, Layer dropdown (other documents' layers), Load/Save Statistics.
  - Image Size Scale Styles switch.
  - Crop W×H×Resolution and Fill, Align Edges, Pen Auto Add/Delete, Path Selection "All Layers", Constrain Path Dragging, preset symmetry types.
  - Color Lookup Abstract and Device Link.
  - Layer Style Gloss Contour anti-alias.
  - Pending engine commands: guides (`view.*`), Edit Toolbar, Define Brush Preset / Pattern / Custom Shape, Purge, Artboards to Files/PDF, Actions.
  - Character/Paragraph: superscript/subscript, language, hanging punctuation, justification options, per-character ranges.
- **Approximations to check against Photoshop:** Auto Brightness/Contrast, Auto Levels/Curves algorithms, Black & White Auto, Gradient Smooth and Stripes, the Layer Style preview swatch, the histogram (from a 384 px preview).
- **Undecided:**
  - Doc tab "Gray" vs "Grayscale".
  - Is Perceptual Photoshop's Gradient Map default? XDesign uses it.
  - Levels and Curves stay a draggable panel beside the canvas, not a centred dialog, so the image stays visible.
  - ⌘H (Extras) may be taken by the native macOS Hide menu item. Not yet checked live, nor is ⌘R (Rulers).
  - The ruler and guide strips sit at z-index 5 and may cover the Contextual Task Bar.
- **Snap is on by default** (as in Photoshop). The layout and tools tests set `snap:false` in `beforeEach`, because jsdom's tiny zoom makes the 6-screen-pixel reach huge. Snap itself is covered by the view-aid tests.
- Crop Fill (Background / Content-Aware) and Show Cropped Area are not done. No new tests yet for the brush bar items, Crop Clear, the Type colour swatch, the sampling ring or the Block eraser params.
- **Not done (no engine support or out of scope):** Neural Filters, AI Denoise/Sharpen, Vanishing Point, Generative Upscale, Variables, Video Layers, Timeline, Arrange. Extras doesn't hide selection edges.
- No tokens were added or needed, so there are no Hermes gaps from this session.

## 2026-10-24 — XDesign photo: live Photoshop comparison; Layer Style layout, labels and Esc fixed

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: "okay now that u have access do a full test of photoshop vs xdesign". Both apps were driven side by side on the owner's Mac using a scratch image (`xd-ps-test.png`). The owner's Photoshop document (pfp.psd) was not touched.

The full prioritised gap list is in `docs/architecture/xdesign/photoshop-parity/live-test-2026-10-24.md` (new). It covers dialogs, filters, menus, Layer Style and all 19 tool options bars.

Changed:
1. **Layer Style layout** (`layerStyleDialog.css`).
   - Legacy `photo.css` rules leaked into the dialog: `.xd-photo button` centring, the `.xd-photo-dialog label` grid and the full-width range.
   - Scoped overrides now keep list text left-aligned and each slider row (label, slider, field, unit) on one line. They also stop "Use Global Light" and "Anti-aliased" wrapping, and give the Contour dropdown its width back.
   - The row-name `flex:1` is narrowed to `.xd-ls-item > button.xd-ls-name`. It had been stretching the Styles and Blending Options buttons.
2. **Bevel & Emboss labels** (`LayerStyleDialog.tsx`). `Blend` takes a `label`, so the two rows read "Highlight Mode" and "Shadow Mode" instead of "Blend Mode" twice.
3. **Esc cancels Layer Style after any click inside it** (`LayerStyleDialog.tsx`).
   - In WebKit, a click doesn't focus a `<button>`, so focus fell to `body` and the scrim's `onKeyDown` never ran.
   - Layer Style and New Style now use `useDesignDialog`, as every other photo dialog already does: window-level Esc for the top of the dialog stack, the focus trap and focus restore.
   - The scrim Esc handlers are removed.

Tests:
- `LayerStyleDialog.test.tsx` has a new test: Esc with focus outside the dialog cancels. It failed before the fix. The file passes 9/9.
- `npx tsc --noEmit`: clean.
- No Rust changes, so the Rust gate didn't apply and no timing logs were needed.

Verification:
- Checked in the live app:
  - the one-line rows;
  - Esc after a list click cancels;
  - with the nested colour picker open, the first Esc closes only the picker and the second closes Layer Style.
- While these edits were hot-reloaded, the dev app crashed once ("Orion Terminal hit an error.", at App's `usePluginManager` call). A webview Reload loaded the same code cleanly, so this was a dev-only HMR artifact.
  - `LayerStyleDialog.tsx` exports non-components (`LAYER_STYLE_EFFECTS`, `blendLabel`), so it isn't a Fast Refresh boundary and edits propagate up the import chain.
  - The ErrorBoundary's "Reload Orion Terminal" button only resets the boundary and didn't recover.

Open questions / next (details and priorities in the report):
- **P0: shortcuts need stage focus.**
  - The handler is on `section.xd-photo`, which has no `tabIndex`.
  - After a click on a tool, a panel or the doc tab, ⌘L opens R.O.S.I.E (`src/commands/builtins.ts`) instead of Levels, and other keys do nothing.
  - Candidate fix: `tabIndex={-1}` on the section, or a scoped window listener.
  - Related: shell accelerators that overlap Photoshop shortcuts (⌘L; the native menu's ⌘M, ⌘W, ⌘H, ⌥⌘M).
- **P1 tool options bars:**
  - Type, Shape, Path Selection and Pen are mostly or entirely missing.
  - Crop shows marquee options instead of ratio, W×H and Straighten.
- **P1 dialogs:** Preset dropdown, gear, eyedroppers and on-image tool are missing across the adjustments. The per-dialog lists are in the report, including Curves, Levels and Hue/Saturation 2026.
  - Shadows/Highlights overflows the window height.
- **Layer Style leftovers:**
  - Name field and preview swatch.
  - "+" on every multi-instance effect.
  - Bevel Direction radios, and the globe dial.
  - Make Default / Reset to Default.
  - "Blending Options: Default" should read "Blending Options".
- **Not covered by the live test:** panel internals (Layers locks and blend, Channels, Paths, History, Properties for adjustment layers), number-key opacity and scrubby labels.
- No tokens were added or needed, so there are no Hermes gaps from this session.

## 2026-10-24 — XDesign photo: undo keeps group folds, Collapse All Groups, the Layers list scrolls to the active layer

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: "keep going". This closes three of the four open questions in the entry below. The fourth, the ⌥/⌘ semantics, was then checked in the owner's Photoshop 2026 (see Open questions) and needed no code change.

Changed:
1. **Undo, redo and History steps leave folds as they were** (`xdesign_photo.rs` `persist_command`, `xdesign_photo_layers.rs`).
   - The engine's snapshots carry the folds of their time, so stepping back used to reopen or close groups. Photoshop never does that.
   - After `edit.undo`, `edit.redo` or `history.select` (`layers::HISTORY_STEPS`), the folds from before the step are put back with the new `layers::keep_folds`. This covers steps read back from bundles after a reopen.
   - Groups that come back with the step keep their snapshot state. The reveal of a newly active layer still runs afterwards.
   - `restore_folds` and `keep_folds` now share `set_folds`. It changes nothing (and keeps the doc pointer) when no fold differs.
   - Temporary timing in the test, now removed: `keep_folds` takes 18–700 µs, inside a 44–53 ms persist.
2. **Collapse All Groups** (`PhotoStudio.tsx`).
   - Added to the Layers panel menu and the layer right-click menu, right after New Group from Layers / Group from Layers. That is Photoshop 2026's order, read from the `$$$/Menu/Layer/…` and `…LayerContext/…` strings in its binary.
   - It runs the engine's `layer.setExpanded {all:true, expanded:false}`, so there is no cap on how many groups it closes. It shows at once through the `folds` override. It is disabled when the document has no groups, as the engine's `has_group` requires.
3. **The Layers list scrolls to a layer that becomes active.** Examples are Auto-Select, undo and Select › layer commands.
   - Only the list's `scrollTop` moves, by the smallest amount that shows the row.
   - `scrollIntoView` isn't used because it can also scroll the in-canvas window and its ancestors.

Tests:
- Rust: `undo_redo_and_history_steps_leave_group_folds_as_they_were` covers undo, redo, a two-step `history.select`, and redo after `restore`. It fails without the fix: confirmed by disabling the call.
- Layout: a new test covers the menu position and command, the instant fold, the right-click entry, the disabled state with no groups, and the list scrolling down 60 then up 30. It fails without the list ref.
- Tools: the panel-menu and right-click item lists now include Collapse All Groups.

Verification:
- `PhotoStudio.layout.test.tsx`: 145/145. `PhotoStudio.tools.test.tsx`: 35/35. `npm run typecheck`: clean.
- Rust gate `cargo test --lib xdesign_photo -- --test-threads=1`: 794 passed, 0 failed, 1 ignored (793 before, plus the new test).
- **Not checked in the live app.**

Open questions / next:
- **⌥/⌘-click semantics: checked in the owner's Photoshop 2026, and XDesign matches.** The test used a new scratch document (Outer › Inner › Deep, Outer › InnerSib, Other › OtherInner) that was closed without saving; the owner's file was not touched. Real clicks were sent to the disclosure triangles, and each group's `layerSectionExpanded` was read back through Action Manager:
  - Plain click: only that group.
  - ⌥: that group and every group nested inside it, at any depth. Sibling groups are left alone.
  - ⌘: that group and its sibling groups under the same parent. A ⌘-click on Inner folded InnerSib but not OtherInner, which is at the same depth under another parent. Nested groups are left alone.
  - ⌘⌥: the siblings plus everything nested in each.
  - Mixed states: every affected group is set to the clicked group's new state, not flipped one by one. An ⌥-click with Inner already closed left it closed; a ⌘-click with Other already closed left it closed.
  - The egui reading ("⌥ = every group in the document") is wrong for Photoshop.
  - Not added: a layout test for ⌘ on a nested group. The current tests cover top-level ⌘ only.
- Photoshop's binary also lists `Collapse All Groups` in the group and other layer-kind context menus. Ours has one shared right-click menu, so it appears there for every layer.

## 2026-10-24 — XDesign photo: group folds are saved in the document, a picked layer opens its groups, ⌥/⌘-click on the chevron

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: "lets close those gaps" (the three open questions of the group-rows entry below). This replaces item 3 of that entry: folding is no longer panel-only state.

Changed:
1. **Folds are document data, saved without a new image version** (`xdesign_photo.rs`, `xdesign_photo_layers.rs`).
   - New `persist_command` now holds the publish-or-save-view step of `xdesign_photo_command`. It treats `layer.setExpanded` and the new `layer.setGroupsExpanded` (`layers::FOLDS`) as view changes: they write `{version}.view.json` and do not publish. So there is no preview render, no bundle write and no tile reload.
   - `restore_with_policy` puts the saved folds back on the document (`layers::restore_folds`) before history is restored. Reopening, export (PSD writes open/closed folders) and the channel workspace all load through it, so they all see the folds.
   - The next real edit publishes them in the bundle.
   - Temporary timing in the test, now removed: persisting a fold takes about 11–15 ms, against about 43 ms for publishing even a 24×24 image.
2. **New host command `layer.setGroupsExpanded {layers:[id…], expanded}`.** It sets several groups in one view change, with no undo step, and refuses any id that isn't a group.
3. **A picked layer opens its closed groups** (`layers::reveal_active`, called from `persist_command`). Whenever a command changes the active layer, its closed parent groups open. That covers Auto-Select on the canvas, Select › layer commands and undo, and matches the engine's own `layer_reveal.rs`. Closing the group around the active layer leaves it closed. The publish decision is taken before the reveal, so a selection that opens groups still only saves the view.
4. **Panel** (`PhotoStudio.tsx`):
   - The chevron runs `layer.setGroupsExpanded`. The new fold shows at once (`folds` override in `PhotoStudio`), gives way to the engine's state once the reply arrives, and reverts if the command fails.
   - ⌥-click also folds the groups inside it, ⌘/Ctrl-click the groups beside it, and both together do both.
   - The panel-local fold state and the `Dispatch`/`SetStateAction` imports are gone.

Tests:
- Rust: `group_folds_and_reveals_are_saved_with_the_view_without_a_new_version`. It checks that a fold or reveal keeps the version and survives `restore`, and that an edit publishes with the fold.
- Rust, layers module: `folds_several_groups_at_once…`, `a_layer_that_becomes_active_opens_its_closed_groups…`, `saved_folds_come_back_on_the_document`.
- Layout: the group test now also checks the fold command, ⌥-click (`[3,6]`), ⌘-click (`[3,8]`), the instant fold, and the revert when the command fails.

Verification:
- Rust gate `cargo test --lib xdesign_photo -- --test-threads=1`: 793 passed, 0 failed, 1 ignored (789 before, plus the 4 new tests).
- `PhotoStudio.layout.test.tsx`: 144/144. `PhotoStudio.tools.test.tsx`: 35/35. `npm run typecheck`: clean.
- **Not checked in the live app.**

Open questions / next:
- **Photoshop's modifier clicks aren't in Adobe's docs.** Two community users agree that ⌥ means this group and the ones inside it, ⌘ the groups at the same level, and ⌘⌥ both; that is what's built here. The engine's own egui UI treats ⌥ as every group in the document. Worth a quick check in real Photoshop by the owner.
- **Undo still changes folds.** The engine keeps `expanded` inside each history snapshot, so undo brings back that step's folds; after a reopen, past steps come from their bundles. Photoshop never changes folds on undo. Fixing this needs an engine change.
- **No scroll to the revealed row.** Photoshop and the engine's egui UI scroll the panel to show a revealed layer; ours doesn't.
- **No "Collapse All Groups".** Photoshop's Layers panel menu has it and the engine supports `{"all":true,"expanded":false}`, but it isn't wired.

## 2026-10-24 — XDesign photo: Layers panel group rows look like Photoshop (folder, disclosure chevron, indent)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: "the group icon/how its shown looks wrong in the layer rack, it shows a layer preview instead of the grop folder".

Root cause: `layer_thumbnails` (`src-tauri/src/xdesign_photo.rs`) rendered a picture of every group's contents. The Layers panel shows a picture whenever it gets one, so its Folder icon only appeared when there was no picture.

Changed:
1. Groups follow the same rule as adjustment layers. They get no picture, only their mask thumbnail if they have one, so the panel shows the Folder icon, as Photoshop does. This also stops rendering every group's contents on each change.
2. Group rows now match the owner's Photoshop screenshot (`PhotoStudio.tsx` `LayerRows`, `photoshop.css`, `photo.css`):
   - eye, then a disclosure chevron (`Collapse/Expand <name>`), then a small folder with no thumbnail box, then the name;
   - group rows are compact (26px);
   - the eye column stays fixed. Only what follows it is indented, by 18px per level, so children line up under their group's folder. Before, the whole row was padded and nested eyes drifted right.
   - Adjustment layers show their type icon (Curves, Levels and so on, from `ADJUSTMENT_ICONS`) instead of the generic layers icon.
   - The base row padding (8px) moved from inline styles to CSS.
3. Folding is panel state, like the effects "fx" fold. It starts from each group's engine `expanded` flag (`PhotoLayer.expanded`, which the engine already sent), so imported PSDs keep their closed groups. The fold state is shared down the tree, so nested groups keep their state when a parent reopens. It deliberately doesn't call the engine's `layer.setExpanded`: that replaces the document, so the host would publish a new version (preview render, bundle write, canvas tile reload) on every click.

Tests: new Rust test `layer_thumbnails_give_groups_only_their_mask`, and a new layout test "shows a group as Photoshop does…" (folder, Curves icon, eye column, 18/36px indent, fold and unfold, nested fold kept, no engine command). Both failed before the change and pass after.

Verification:
- Rust gate `cargo test --lib xdesign_photo -- --test-threads=1`: 789 passed, 0 failed, 1 ignored.
- `PhotoStudio.layout.test.tsx`: 144/144. `PhotoStudio.tools.test.tsx`: 35/35. `npm run typecheck`: clean.
- **Not checked in the live app.**

Open questions / next:
- Folds aren't saved into the document, so a PSD export keeps the imported open/closed state. Saving them would need the host to apply `layer.setExpanded` without publishing a new version.
- Photoshop opens a collapsed group when one of its layers is picked on the canvas (auto-select). Ours stays collapsed.
- Option-click on a chevron (fold the group and all groups inside it) isn't implemented.

## 2026-10-24 — XDesign photo: edits show on the canvas live while you drag (Curves, all dialogs, Properties, layer Opacity/Fill, Layer Style)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: "for curves the image does show adjustment untill i move the curve and let go, everything should show real time edits as you are adjusting this is not just for curves for any editing".

Root cause: the shared preview hook only rendered once the controls had rested, and every move cancelled the render in flight. A continuous drag therefore never got a frame until the pointer stopped. Properties and the layer sliders had no canvas preview at all and only changed the image on release.

Changed:
1. **`commandPreview.ts` (all dialog previews).**
   - The hook is now a throttle instead of a debounce. One render is in flight at a time. When it finishes, the newest settings render straight away.
   - In live (automatic) mode, a finished render for older settings is shown as a stale frame. A params-only change no longer cancels the render in flight. Image, view or photo changes, disabling and unmounting still cancel it.
   - Manual mode is unchanged.
   - The default first-frame delay went from 300 ms to 100 ms.
2. **Adjustment layer Properties.** Edits show on the canvas as a draft preview (`layer.setAdjustment`) and commit once on release, so a drag is still one history step. The last frame stays until the committed image is shown, so the old pixels don't flash back. PhotoStudio passes `canvas` and `untilShown`.
3. **New `CanvasDraftPreview.tsx`.** A shared component that renders a control's in-progress `{command, params}` on the canvas and holds the last frame until the commit is shown.
   - Layer Opacity/Fill sliders (PhotoStudio `layerSlider`) now scrub live through `layer.setProps`.
   - The Layer Style dialog's sliders, dials, number fields, Blending Opacity/Fill and Blend If drags preview through `editEffect`, `globalLight` and `blendingOptions`. They commit once on release. The dialog takes new optional props: `document`, `canvas`, `untilShown`.
4. **Rust (`xdesign_photo_preview.rs`).** The temporary-preview allow-list adds `layer.setProps`, `layer.layerStyle.editEffect`, `layer.layerStyle.blendingOptions` and `layer.layerStyle.globalLight`. These already run through `execute_view_command` on a throwaway copy of the image.
5. `MoveDragPreview.tsx`: comment only.

Timing (temporary test and `[timing]` log in `xdesign_photo_command_preview`, both removed; `xdesign_photo.rs` is byte-identical to before). Native render on a 4000×3000 image, dependencies at opt-level 3:
- `layer.setProps`: 85–130 ms
- `editEffect` and `blendingOptions`: 80–140 ms
- Brightness/Contrast: 215–255 ms

Snapshot load and PNG transfer come on top. Expect roughly 4–10 live frames a second at 12 MP.

Tests:
- New:
  - `CanvasDraftPreview.test.tsx` (2)
  - a Layer Style live-drag test
  - an AdjustmentProperties live-drag test
  - a hook continuous-drag test
  - a cancel test (params-only changes keep the render; an identity change still cancels it)
  - Rust: `layer_opacity_and_fill_previews_match_apply` and `layer_style_slider_previews_match_apply`
- Updated to the intended stale-frame behaviour: two hook tests and the PhotoActionDialog.blur path-move test.

Verification:
- Focused vitest (25 files: hook, Properties, all preview dialogs, Layer Style, tone/colour controls, PhotoStudio tools/layout): 758/758 after the blur test update.
- `npm run typecheck`: clean.
- Rust gate `cargo test --lib xdesign_photo -- --test-threads=1`: 788 passed, 0 failed, 1 ignored (was 786 before the 2 new tests).
- **Not checked in the live app.**

Open questions / next:
- Live commits: should we use the engine's `coalesce` key? It would merge a drag into one history step while committing as you go. It isn't used because every committed command runs `publish()` (bundle, preview PNG, history and view to disk), which is too heavy per move. Draft previews avoid that.
- `PhotoActionDialog` only previews automatically under 16.7 MP, and native previews refuse larger images. Photoshop previews at any size, for example on a downsampled proxy.
- Layer Effects panel (Styles flyout) number and colour fields still commit on blur. They are typed fields, not sliders.

## 2026-10-24 — XDesign photo: Photoshop-style adjustment controls (Levels, Curves, Threshold, Hue/Saturation, Color Balance, Channel Mixer, Black & White, Gradient Map, Photo Filter)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: "I dont care about having the exact colours its more about the tools and features etc. and like the controls for stuff look the same like the levels and curves etc". The modal dialog (`PhotoActionDialog`) and Properties (`AdjustmentProperties`) share one renderer (`AdjustmentControls`), so every change below shows in both.

Changed:
1. **Tone controls (new `toneControls.tsx`).**
   - `ToneSlider`: Photoshop's triangle handles under a histogram or gradient. A press on the strip grabs the nearest triangle; arrows move 1 (Shift 10).
   - Levels: histogram, then black/gamma/white input triangles with their fields; Output Levels gradient with two triangles. Black stays 2 levels under white, and gamma follows the triangle's place between them.
   - Threshold: histogram with the level marked, and one triangle.
   - Curves: 4×4 grid (Alt-click for 10×10), histogram behind, baseline, edited channel curves drawn over the RGB composite, vertical and horizontal gradient bars, and Input/Output fields for the selected point. Click adds a point. Drag a point off the graph, ⌘/Ctrl-click it or right-click it to remove it; it comes back if dragged back before release. Endpoints cannot be removed. The drawn curve is the engine's natural cubic spline (`curveLut`).
   - Auto for Levels and Curves uses the engine's rule: clip 0.1% at each end (`autoLevels`).
2. **Histograms (Rust).** New `xdesign_photo_histogram` command in `xdesign_photo.rs`, registered in `lib.rs`. It bins either the target layer on its own (Image ▸ Adjustments) or what an adjustment layer receives (`below`), per tone channel of RGB, CMYK or Lab. The frontend asks once the source settles (`useHistogram`) and ignores malformed replies. The temporary timing log has been removed.
3. **Colour adjustments (new `colorControls.tsx`).**
   - Coloured slider tracks:
     - Hue/Saturation: the hue wheel, grey→colour and black→colour→white, following the chosen range.
     - Color Balance: Cyan…Red, Magenta…Green, Yellow…Blue, with the colour names at the slider ends.
     - Black & White: each colour dark→light.
   - Hue/Saturation: the two colour bars, input above and result below. The result bar uses the engine's formula. With a colour range chosen, the range slider sits between the bars: fade-in and fade-out triangles, full-strength handles and the four degree fields. Ranges stay inside one turn, as the engine canonicalises them. This replaces the old "Range falloff" disclosure.
   - Channel Mixer: Output Channel → Monochrome → Source Channels → Total (with ⚠ above 100%) → Constant.
   - Gradient Map: Photoshop's stop bar. Click under the bar to add a stop with the colour at that point. Drag a stop to move it, or drag it down off the bar to delete it. Arrow keys move a stop and Delete removes it. The Stops group holds Color, Location and Delete.
   - Photo Filter: Use ▸ Filter (named presets, e.g. "Warming Filter (85)") or Color.
4. **Native range sliders in dialogs and Properties** are restyled to Photoshop's thin track with a triangle thumb, using WebKit and Mozilla pseudo-elements in `actionControls.css`. Properties now lays out like the dialog grid.

Tests:
- New: `toneControls.test.tsx` (8) and `colorControls.test.tsx` (10).
- Updated for the new controls: PhotoActionDialog, AdjustmentProperties and GeometryDialog (Curves point removal and drag-off).
- Rust: `histograms_read_the_layer_alone_or_the_image_below_an_adjustment`.

Verification:
- Focused vitest (GeometryDialog, PhotoActionDialog, AdjustmentProperties, toneControls, colorControls, PhotoStudio.layout): 384/384.
- `npm run typecheck`: clean.
- Tailwind probe: 1,491 files pass.
- `cargo test --lib xdesign_photo -- --test-threads=1`: 786 passed, 0 failed, 1 ignored (after the timing log was removed).
- Visual check: the controls were rendered to static HTML with the real CSS and screenshotted in headless Chromium. The scratch files were deleted. **Not checked in the live app.**

Gaps / next:
- No eyedroppers (Levels, Curves, Hue/Saturation), no Curves pencil, no Show Clipping, no Black & White Auto, no Gradient Map Method, and no keyboard way to add a gradient stop.
- No Ctrl-drag to shift the Hue/Saturation bars, and the whole range region cannot be dragged as one. The bars are centred on the chosen range, which is close to Photoshop but not exact.
- The CMYK histogram uses naive RGB→CMYK. Lab bins use D65, while the Color panel reports D50.
- A new adjustment layer's histogram includes the layers above it.
- In the dialog, Color Balance uses the Properties layout (no "Color Levels:" row).

Open questions for Hermes:
- The channel, balance, spectrum and Black & White track colours are literal content colours, not tokens.
- `--xd-photo-track` is a component CSS variable, not a design token.
- The mixer's above-100% warning uses `--xd-accent`; there is no warning token.

## 2026-10-23 (evening) — XDesign photo: the "could be done now" list, D5 live adjustments in Properties, D7 Layer Style dialog, Rust for multi-layer drag and mask state

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: "lets doo the could be done now and d5 d7 and explain the hermes thing". Sonnet subagents did colour (A), dialogs (B), transform modes (C), D5 and D7 on disjoint files. I reviewed each agent's files and did the PhotoStudio.tsx wiring and the Rust myself.

Changed:
1. **Layers panel rows (PhotoStudio.tsx, photoshop.css, types.ts).**
   - Photoshop's filter row: Kind, Name, Effect, Mode, Attribute and Smart Object, with the on/off switch (`filterLayerTree`, `LayerFilterRow`).
   - The layer thumbnail and the mask thumbnail are separate targets, with the link icon between them. The link toggles `layer.layerMask.linked`; ⇧-click on the mask disables it and shows the red X.
   - The fx badge folds out an Effects sublist. The "Effects" eye uses the new `layer.layerStyle.setEffectsEnabled`, and each effect has its own eye. Double-clicking an effect opens Layer Style at that effect.
   - Double-clicking a thumbnail opens Layer Style ▸ Blending Options. On a smart object it opens the contents; on an adjustment layer it opens Properties.
2. **Dragging several selected layers moves them as one block.** The new Rust `layer.moveLayersTo` makes one "Reorder Layers" history step. A moving group carries its children, and the block keeps its stack order.
3. **Painting feel.** A stroke begun while the previous edit still commits is held for up to 2 s and replayed once that edit lands, instead of being refused (`holdStroke`/`replayHeld`).
4. **Cursors.** Polygonal and Magnetic Lasso, Crop, the Pen states (new, continue, close) and the Freeform Pen now show their tool cursors. Caps Lock swaps in the precise crosshair and hides the brush outline, except for Move, path selection, Text, Hand and Zoom.
5. **Colour (colorModel.ts, ColorPanel.tsx, ColorPickerDialog.tsx, colorPanel.css).**
   - The Color panel has Brightness Cube, Color Wheel, Lab and CMYK modes, nine in its ≡ menu in all.
   - The Picker has Lab and CMYK fields.
   - Lab is sRGB→D50, as Photoshop reports it.
   - "Add to Swatches" in the panel and the Picker adds to an open Swatches panel at once (`addImageSwatch`).
6. **Edit ▸ Transform ▸ Scale, Rotate, Skew, Distort and Perspective (freeTransform.ts, transformMath.ts, ImageTransformOverlay.tsx).** Each mode offers only its own handles. With Auto-Select on, a click inside the current layer's transform box now reaches Auto-Select instead of being taken by the handles.
7. **Image ▸ Trim…** opens Photoshop's Trim dialog: Based On (Transparent Pixels, Top Left or Bottom Right Pixel Color) and Trim Away (Top, Bottom, Left, Right). The Properties Quick Actions button is now "Trim…".
8. **Dialog polish.**
   - The filter thumbnail zooms with −/+ and shows a % readout, and drags to pan (FilterThumbnail.tsx).
   - Dialogs reopen where they were moved, for the session (photoDialog.tsx).
   - Color Settings is grouped into Working Spaces, Color Management Policies and Conversion Options.
   - Color Profile Information shows only OK.
   - Image Size resample list: Automatic, Preserve Details (enlargement), Bicubic Sharper (reduction), Bicubic (smooth gradients), Nearest Neighbor (hard edges) and Bilinear.
   - Wording: Wave groups Wavelength and Amplitude as Min./Max. pairs; Levels groups Input Levels and Output Levels.
9. **The Move tool's drag shows the layer's pixels at the new place (MoveDragPreview.tsx).** It goes through the `edit.transform` preview. The outline marks the cursor until the pixels catch up, and the released drag keeps its last frame until the committed image shows.
10. **D5: adjustment layers are edited live in Properties (AdjustmentProperties.tsx, actionControls.tsx/.css, adjustmentProperties.css, adjustmentSettings.ts presets).**
    - An Adjustments panel tile, or Layer ▸ New Adjustment Layer, creates the layer with neutral values and opens Properties.
    - Properties edits the layer live with the same controls as the dialogs (`PhotoActionDialog.tsx` now shares them).
    - Image ▸ Adjustments stays modal.
    - The old "Edit adjustment" button is gone.
11. **D7: Photoshop's Layer Style dialog (LayerStyleDialog.tsx, layerStyleDialog.css; LayerEffects.tsx exports `BLENDS` and `ContourEditor`).**
    - Left list: Styles, Blending Options and the effects with their checkboxes. Blending Options includes Blend If.
    - Preview checkbox, New Style…, and Cancel reverts what the dialog changed.
    - Opens from Layer ▸ Layer Style, a row double-click, the footer fx button and an effect row double-click.
12. **Rust.**
    - New `src-tauri/src/xdesign_photo_layers.rs` adds `layer.moveLayersTo` and `layer.layerStyle.setEffectsEnabled`. Both are host-dispatched and listed in the catalog.
    - Layer state gains `mask: {enabled, linked}`.
    - `xdesign_photo_layer_thumbnails` returns a `mask` PNG for each masked layer, and no `png` for adjustment layers; `tiles::png` is now `pub(super)`.
    - The temporary timing logs measured 1 µs–1.5 ms and have been removed. Cargo.toml is unchanged.

Tests:
- New: LayerStyleDialog (7), AdjustmentProperties (11), FilterThumbnail (3) and colorSpaces.test.ts.
- Extended:
  - ColorPanel and ColorPickerDialog;
  - ImageDialogs (Trim, resample) and ImageTransformOverlay/transformMath (modes);
  - PhotoStudio.tools: cursors and Caps Lock, the held stroke, and Add to Swatches;
  - PhotoStudio.layout: adjustment layers through Properties, Color Lookup, Transform modes plus Trim…, and multi-layer drag.
- Rust: two tests in `xdesign_photo::layers`, and `layer_thumbnails_render_each_layer_alone_and_skip_adjustments` now covers masks.
- The layout profile test now presses OK on the OK-only info dialog.

Verification:
- `npx tsc --noEmit -p .`: clean, after the last change.
- Focused vitest, 14 files: 495/495. The one failure was the profile test still pressing Cancel; after the fix it passes.
- `cargo test --lib xdesign_photo -- --test-threads=1`: 785 passed, 0 failed, 1 ignored.
- Tailwind probe: all 1,487 files pass.
- **Not checked in the live app.** The dev app rebuilds the Rust side.

Known gaps:
- Layer Style: each edit is its own history step, because styles have no non-committing preview. Global Light… and Scale Effects… are not in the menu. The bevel texture uses a temporary Pattern Overlay.
- New Adjustment Layer skips Photoshop's New Layer name dialog.
- D5 has no presets for Levels, Hue/Saturation, Black & White, Channel Mixer or Selective Color. It also lacks the "return to adjustment list" button and the `\` mask shortcut.
- The Move preview waits for a pause of at least 100 ms, and shows nothing when several layers are selected.
- "Bicubic Sharper (reduction)" runs the engine's lanczos. The engine has no Bicubic Smoother, Bicubic Sharper or Preserve Details 2.0.
- CMYK in the Color panel and Picker is a plain K separation, not the SWOP working profile, so the values differ from Photoshop's (pure black is K 100).
- Filter thumbnail zoom crops the ≤2048 px preview. Preview resolution at high zoom is not done, because the engine renders regions only for the Blur Gallery.
- No Split Warp. The gallery and lens filter wording is still unchecked.
- `actionItem`'s `adjustment` parameter and `dialog.layer` are now unused paths. They were left in place.

Open questions for Hermes:
- The token gaps in the earlier entries still stand: panel, dialog and control fills; control frame; group frame and divider; disabled text; button fill, pressed and stroke; slider track and thumb; the focus ring; tooltip; alert red; modal scrim; 22 px control and menu-row height. D4 (radii and focus ring) conflicts with DESIGN.md.
- New:
  - `--neon-magenta`, which is reserved for error/alarm, is used for the layer-filter switch dot and the disabled-mask X (photoshop.css:122, :128).
  - The Layer Style left list needs a selected-row fill.
  - The Blend If gradient uses literal `#000→#fff` (layerStyleDialog.css), and its thumbs need colours.
  - D5 needs a 26×24 small icon button and an 11 px sub-heading size in Properties.

Still to do:
- Check everything above in the live app.
- Engine or Rust work: Save As, Image ▸ Duplicate, channel and path thumbnails, mask Density/Feather/Invert, shape fill and stroke, a live Fade preview, the Histogram panel, and about ten more menu items.
- The look (D4) waits on Hermes or the owner.

## 2026-10-23 (later) — XDesign photo: Photoshop wording in filter dialogs, Properties clusters, on-canvas Free Transform, Fade, Fit To, layer dragging

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Continues the entry below; the owner said "keep going". Three Sonnet subagents did items 1–3 in parallel on disjoint files; I reviewed each one's files before accepting.

Changed:
1. **Filter and adjustment dialogs (`controls.ts`, `PhotoActionDialog.tsx`, `photoDialog.css`).**
   - Photoshop wording, units and radios: `NumberControl` gains `text`/`unit`, `FilterOption` gains `text`/`radios`/`labels`. `label` stays the stable aria name. A `WORDING` table (bottom of `controls.ts`) covers the common filters and adjustments, e.g. "Radius: [ ] Pixels", Offset "pixels right/down", Mosaic "Cell Size: [ ] square", Wave/Offset "Undefined Areas" radios. Everything else is Title Cased at load, and "(mm)"-style suffixes become units.
   - `humanize`/`choiceLabel` replace raw camelCase enum values everywhere.
   - All controls render in the `xd-ps-dialog-grid has-sliders` grid; radio enums are fieldsets with `role=radiogroup`.
   - Session-remembered values: destructive filters and Image ▸ Adjustments reopen with the last OK'd values. Not applied to adjustment layers, geometry, gallery or lens filters. Cleared on project change; colours, files and LUT data are never stored. `forgetRememberedValues()` is exported for tests.
2. **Properties panel (`DocumentProperties.tsx` new, `LayerProperties.tsx` `MaskSection`, `PhotoStudio.tsx`).**
   - Nothing selected: Photoshop's Canvas cluster. W/H resize the canvas about its centre, with a link toggle. Resolution changes ppi without resampling. Mode, depth and profile appear as a readout. Below it: Quick Actions (Image Size…, Trim, Rotate 90°, Flip horizontal, Add text, Profile information…) and Selection display.
   - Layer mask cluster: View, Select and Mask…, Color Range…, and an icon footer (Load Selection from Mask, Apply, Disable/Enable, Delete). Without a mask: Add pixel mask, Hide all, Mask selection.
   - The removed Document/Selection/Channels/Color profile panel buttons are all reachable from menus. Layout tests now go through the menus (`choose` helper).
3. **Free Transform is on the canvas (`freeTransform.ts`, `transformMath.ts`, `FreeTransformBar.tsx`, `ImageTransformOverlay.tsx`; `ImageTransformDialog.tsx` and its test deleted, math tests moved to `transformMath.test.ts`).**
   - ⌘T or the Quick Actions Transform button enters a pending mode. Drag inside moves, handles scale (proportional by default, Shift toggles, Alt from the centre). Just outside a corner rotates (Shift snaps 15°). ⌘-corner distorts and ⌘-side skews.
   - Options bar: X/Y/W/link/H/angle/H and V skew/Interpolation, with ⊘ and ✓ on the right; the tool's own options hide meanwhile.
   - Enter, double-click or ✓ sends one `edit.transform`; Esc or ⊘ sends nothing. Switching tool, document or layer cancels.
   - One `holdImageGesture` lasts the whole session.
4. **Edit ▸ Fade… (⇧⌘F).** Placed after Undo/Redo and labelled "Fade <last step>…" from the current history step, as Photoshop does. Enabled by `state.canFade`. The dialog has Opacity % (with slider) and Mode (all `BLEND_MODES`). Defined as `FADE` in `imageCommands.ts`.
   - **Rust:** `edit.fade` was missing from the host allow-list (`command_supported`, `xdesign_photo.rs`), so the command browser hid it and any call failed with "must be handled by the XDesign workspace". Added it, and added it to `document_operations_do_not_expose_engine_file_or_script_commands`.
   - A temporary timing log around the fade dispatch measured 1,561 fade calls in the fade tests, the slowest at 1.0 ms. It has been removed.
5. **Image Size "Fit To" (`ImageDialogs.tsx`).** Original Size, five screen presets (640×480 … 1366×768 px 72 ppi), 4×6/5×7/8×10 in, and Letter/Legal/Tabloid/A4/A3/B5/B4/B3/International Postcard at 300 ppi. Each preset fits the image inside the preset turned to the image's orientation. Editing any size or resolution switches it to "Custom". Auto Resolution and Save/Delete Preset are left out.
6. **Image ▸ Image Rotation ▸ Arbitrary…** opens Photoshop's Rotate Canvas dialog: Angle with °CW/°CCW radios. It sends `image.rotation.arbitrary`, which the host already allowed through the `image.` prefix. Defined as `ROTATE_CANVAS` in `imageCommands.ts`.
7. **Dead CSS removed** (listed in the previous entry): `.xd-color-buttons` and `.xd-color-ok` (colorPanel.css); `.xd-photo-command-dialog>input/select`, `.xd-photo-channel-source*` and the channel-composite preview/label rules (photo.css). `ColorImportDialog` no longer uses `xd-photo-special-dialog`.

8. **The dev stylesheet failed to build: fixed.** `npm run tauri dev` stopped with `[postcss] Cannot read properties of undefined (reading 'raws')` in `src/styles.css`. Tailwind 3.4's class scanner read `p[1]!-visible.y` in the new `ImageTransformOverlay.tsx` (the rotate-cursor angle) as a class and crashed. Vitest never builds Tailwind, so the tests missed it. `resizeCursor` now destructures the point instead. A probe run of every `src/**/*.ts(x)` file through Tailwind on its own now passes all 1,477.

9. **Dragging layers did nothing in the app: fixed (owner: "dragging layers to go above or under doesn't work … make sure it works for adding to groups").**
   - Cause: tauri-runtime-wry 2.11.4's drag-drop handler always reports a drag as handled, so wry's WKWebView (`drag_drop.rs`) never passes it on to WebKit. DOM `dragover`/`drop` therefore never fire, and every in-page HTML5 drag is dead; only Finder file drops (`fileDrop.ts`, `onDragDropEvent`) work. jsdom tests fire the DOM events by hand, so they passed. `dragDropEnabled` stays on so file drops keep working.
   - New `photo/rowDrag.ts` (`startRowDrag`) drags rows with pointer events instead:
     - a 4 px threshold;
     - a translucent copy of the row follows the pointer;
     - the existing `data-drop` above/below/into styles mark the target;
     - Esc cancels;
     - the release click is swallowed so the dragged row isn't selected again.
   - Converted: Layers, Channels (saved channels) and the preset manager's move-to-group.
   - Layer drop rules (`layerDropPosition`, PhotoStudio.tsx), as in Photoshop:
     - the top or bottom half of a row drops above or below it;
     - a group takes the layer from its middle, and from its bottom too once it has children;
     - the result is one `layer.moveTo` (above/below/into).
     - Nothing drops below the Background, into itself or its own children, or back where it already is. The Background row can't be dragged.
   - Added `.xd-photo-row-ghost` and `.xd-photo-row-dragging` to photo.css, using the existing `--xd-panel`/`--xd-border` tokens.

Tests added:
- PhotoActionDialog: wording and remembered values.
- PhotoProperties.test.tsx (new, 8).
- ImageTransformOverlay (12) and transformMath.
- Image Size Fit To.
- Edit ▸ Fade and Image Rotation ▸ Arbitrary… in PhotoStudio.layout.
- Layer drag in PhotoStudio.layout: above, below, into a group, into a group from its bottom half, out of a group, never below the Background, the refused cases, Esc, and no reselect on release. The channel drag test (PhotoStudio.layout) and the preset drag test (AdditionalPresets) now use pointer events. Mutation checks: removing the Background guard, or the click swallow, makes the layer test fail.

Verification:
- `npx tsc --noEmit -p .`: clean, after the last change.
- Full `npx vitest run src/apps/xdesign`: 329 files, 3,785 tests passed. This ran before Arbitrary… was added; afterwards ImageDialogs and PhotoStudio.layout were re-run (150/150).
- Agents' focused runs: A 207 + 129 + 7; B PhotoProperties 8/8; C 187 across 4 files.
- `cargo test --lib xdesign_photo -- --test-threads=1`: 783 passed, 0 failed, 1 ignored. In parallel, 7 fade tests fail with "Wait for the current retouch feedback". That race between stroke tests was already there (see the "Pre-existing, not from this work" note in an earlier entry), and it does not come from `edit.fade`.
- After the drag change: tsc clean; AdditionalPresets and PhotoStudio.layout 145/145; the Tailwind probe passes all 1,478 files.
- Not checked in the live app.

Skipped, with the reason:
- Dragging several selected layers at once: `layer.moveTo` moves one layer, so only the dragged row moves.
- The same HTML5 drag problem probably affects drags outside the photo app, though this hasn't been checked. They use `onDrop`/`onDragOver` in `xdesign/LayersPanel.tsx` (vector layers), `archives/database/BoardView.tsx`, `archives/Mood.tsx`, `archives/Projects.tsx`, `components/workspace/Workspace.tsx`, `hermes/HermesApp.tsx`, `orion/Editor.tsx`, `ClaudeChat.tsx`, `notes/NoteEditor.tsx` and `intake/SkillIntakePanel.tsx`. Some of these may only take Finder files. They were left alone because the request was about the photo app; `startRowDrag` could be reused for them.
- Image ▸ Duplicate: `image.duplicate` is deliberately refused by the host (`command_supported`).
- Channel and path thumbnails: the only native thumbnail command is `xdesign_photo_layer_thumbnails`, so these need a new Rust command.
- Mask Density/Feather/Invert and a mask enabled state: no engine command or state.
- Shape-layer Appearance: shape layers carry no fill, stroke or size data.
- Live preview in Fade: not available (no preview route).

Open questions for Hermes:
- None new. The agents added no tokens. The rotate cursor is an inline black/white SVG like the existing tool cursors.
- The token gaps in the entry below still stand.

Still to do:
- Filter thumbnail with zoom in filter dialogs.
- Preview resolution at high zoom.
- Remember each dialog's position.
- Color Settings groupings.
- The info-only profile dialog still shows Cancel.
- D5 (live adjustments in Properties) and D7 (Layer Style dialog), which the owner deferred.
- Wording not yet checked against Photoshop: Wave's Min./Max. pairs, Offset choice order, Levels "Input/Output Levels", and the gallery/lens labels.
- Check Free Transform, Fade, the Properties clusters and layer/channel/preset dragging in the live app.

## 2026-10-23 — XDesign photo: every dialog uses the Photoshop dialog frame; Color Range rebuilt; previews show on the canvas

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** The owner asked that "things like this color select" (the Color Range dialog) "be styled like it is in photoshop", and that this apply to every dialog. The owner's decisions: OK/Cancel sit in a right-hand column (D2), and dialogs open beside the image and can be moved, with the preview on the canvas (D3).

Changed:
1. **Shared frame: `photo/photoDialog.tsx` (`PhotoDialog`) and `photo/photoDialog.css`.**
   - A title bar that drags the dialog, and an OK/Cancel column on the right with extra buttons below them.
   - Alt+click on Cancel resets the dialog; the button reads "Reset" while Alt is held. This restores the values the dialog opened with, as in Photoshop, not the defaults. It replaces the old "Reset to defaults" buttons.
   - An optional Preview checkbox, an optional `beside` placement, and `noValidate`.
   - The form grid (`xd-ps-dialog-grid`, `-row`, `-field`, `-check`, `-group` fieldsets with legends, `-readout`, `-unit`) uses right-aligned labels ending in ":".
   - The rules are scoped `.xd-photo .xd-ps-dialog …` so the generic `.xd-photo-dialog` rules in photo.css don't override them.
2. **Color Range (`ColorRangeDialog.tsx`).** Rebuilt to Photoshop's layout:
   - Select menu: Sampled Colors, the colours Reds through Magentas, Highlights/Midtones/Shadows, Out Of Gamut.
   - Localized Color Clusters, Fuzziness and Range.
   - Eyedropper, Add to Sample and Subtract from Sample.
   - A Selection/Image thumbnail, Selection Preview (None, Grayscale, Black Matte, White Matte, Quick Mask) and Invert.
3. **Image dialogs (`ImageDialogs.tsx`).**
   - Image Size: Current Size and New Size groups, linked W/H, Resolution and Resample.
   - Canvas Size: Relative, the anchor grid, and the canvas extension color.
   - Export As.
4. **Filters and adjustments (`PhotoActionDialog.tsx`).** These now use the frame, open beside the image, and preview on the canvas. Geometry filters keep the preview inside the dialog, with handles.
5. **The other 20 dialogs now use the frame, with Photoshop titles:**
   - New Channel / Channel Options; Merge Channels; Apply Image / Calculations / Load Selection.
   - Color Settings ("Restore Defaults" sits in the button column); Assign Profile / Convert to Profile / Proof Setup / 32-bit Preview Options / Color Profile Information; Missing Color Profile / Color Profile Mismatch; Paste Color Profile Mismatch.
   - New; Place (Alt-Reset includes the path); Image Actions; Color Picker ("Add to Swatches" in the button column; the swatch and the web-color warning are not styled as buttons); Gradient Fill.
   - Select and Mask / Focus Area ("Remember Settings After OK"); Camera Raw Filter / Camera Raw.
   - Smart-filter re-edit for numeric, blur and lens filters (each titled with its filter name); Free Transform; Warp Text / Text Position & Box.
   - Buttons read OK, not Apply, Paste or Open image.
6. **Photoshop groupings.**
   - Convert to Profile: Destination Space, then Conversion Options (Intent, Use Black Point Compensation, Use Dither (8-bit/channel images)).
   - Proof Setup: Proof Conditions (Device to Simulate, Simulation, Rendering Intent, Black Point Compensation), then Display Options (On-Screen).
   - Assign Profile: one Assign Profile group.
   - Calculations / Apply Image: Blending and Result groups, with Photoshop's option names: New Document/New Channel/Selection, New/Add to/Subtract from/Intersect with Selection, Merged.
7. **On-canvas preview.** Apply Image/Calculations/Load Selection, Assign/Convert/Proof profile and the numeric smart-filter re-edit now preview on the canvas and open beside it. They no longer show an image inside the dialog.
   - How it works: the preview is portalled into the canvas as `img.xd-photo-canvas-preview`, and photo.css hides the base layers under it.
   - Wiring: `PhotoStudio.tsx` passes `canvas={image.current}` to these dialogs and to `SmartFilters`.
   - Dialogs that keep their in-dialog preview: those led by geometry handles (blur/lens geometry, Free Transform, text geometry, Gradient Fill, Select and Mask) and Camera Raw.
   - Color Import no longer uses the 1000 px special-dialog width.

Tests:
- Updated for the new button names (OK instead of Apply/Paste/Open image; Cancel instead of Close on the profile info dialog).
- The previews are now asserted on a canvas element: ChannelComposite, ExistingNumericFilter, and PhotoStudio.layout lines 217 and 373.

Verification:
- `npx tsc --noEmit -p .` passes.
- Focused dialog files pass: ColorProfile, ChannelComposite, ExistingNumericFilter, SmartFilters and PhotoStudio.layout, 253 tests.
- `npx vitest run src/apps/xdesign` passes: 328 files, 3770 tests.
- Not run: Rust (no Rust changed). Nothing has been checked in the live app yet.

Open questions for Hermes (closest `--xd-*` token used for each):
- Dialog pane fill, control fill, button fill and stroke, and the default-button ring.
- Slider track and thumb, disabled text, and the check mark.
- Group-box frame and legend colour.
- A transparent scrim for dialogs that open beside the image.
- Anchor-grid cell, link-toggle icon, and the progress line.
- D4: radii and the focus ring.

Still to do:
- Preview resolution at high zoom, and a filter thumbnail in filter dialogs.
- Image Size "Fit To" presets. Bicubic Smoother and Preserve Details 2.0 are left out.
- Remember each dialog's position. Per-adjustment layouts (D5). Select and Mask as a workspace.
- Gradient Fill and Free Transform handles on the canvas.
- Color Settings: Photoshop's Working Spaces / Color Management Policies / Conversion Options groups.
- The info-only profile dialog still shows Cancel.
- Camera Raw lost its blur-to-discard protection. The draft commits to local state before the dialog unmounts, so this looks harmless; check it in the live app.
- Dead CSS to remove: `.xd-color-buttons`, `.xd-color-ok` (colorPanel.css); `.xd-photo-command-dialog>input` and `.xd-photo-channel-composite .xd-photo-preview-actions/.xd-photo-special-controls>label` (photo.css).

## 2026-10-22 — XDesign photo: deferred Photoshop-parity items (gestures, screen modes, presets, Adjustments, Properties)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Continues the Phases 3–4 entry below and clears most of its "Still to do" list. The owner asked to "make it by dragging, then continue", meaning channel reordering by drag (done in that entry) and then this list.

Changed:
1. **Options bar and panels.**
   - Paint tools: right-clicking the canvas opens the brush picker at the pointer. The order is now Mode → Opacity → Flow, with Opacity and Flow as popup sliders. Spacing stays a number field.
   - Layers: Opacity and Fill are popup sliders. Releasing one makes a single history step; there is no live preview while dragging.
   - Navigator: an editable zoom % field between small and large mountain buttons.
   - CSS: the `input[type=number]` rules are scoped per panel, so new fields don't inherit option-bar widths.
   - Blend modes were already in Photoshop's order (`controls.ts` `BLEND_MODES`). No change.
2. **Crop.**
   - Right-clicking with the Crop tool opens Photoshop's crop menu: Original Ratio and the preset ratios (radio), Reset Crop, Rotate Crop Box and Crop.
   - Triangle and Golden Spiral overlays were added. O cycles the overlays and Shift+O cycles their orientation.
3. **Shift constraints (new `photo/strokeConstraint.ts`, with tests), following Photocraft's `stroke_constraint.rs`.**
   - Shift-click draws a straight line from the last painted point.
   - A Shift-drag locks to 0°/45°/90° once the pointer has moved 3 screen pixels.
   - The Gradient tool snaps to 45°.
   - With Shift held after a stroke, a rubber-band line from where it ended previews the line a click will paint.
4. **Brush resize.** ⌃⌥-drag (and ⌥-right-drag) resizes the brush: horizontal changes the diameter, vertical the hardness (Quick Selection: diameter only). It shows a red tip preview and a Diameter/Hardness readout.
5. **Temporary Move.** Holding ⌘ with any tool except Crop, Straighten and Magnetic Lasso switches to Move until ⌘ is released. ⌘-click auto-selects the layer under the pointer. The move preview is still an outline.
6. **Screen modes.**
   - F cycles forward and Shift+F backward through Standard, Full Screen with Menu Bar, and Full Screen (black, chrome hidden).
   - The modes are also in View ▸ Screen Mode.
   - Tab still hides the panels, and Esc leaves Full Screen.
   - The modes apply to the image editor window only, and Photoshop's first-use Full Screen dialog is skipped.
7. **Tool flyouts (`EditorChrome.tsx` `ToolGroup`).**
   - Press-and-hold opens the flyout. Dragging onto a row and releasing chooses that row, as in Photoshop.
   - The triangle toggles the flyout open and closed.
8. **Preset groups (`PresetManager.tsx` now exports `PresetGroups`; the Organize form is gone).** The Gradients, Patterns, Shapes and Styles panels show presets in folder groups:
   - Click a folder to collapse it.
   - Right-click a preset for Rename… or Delete, using Photoshop-style Name dialogs.
   - Right-click a folder for New Group…, Rename Group… or Delete Group. Delete Group confirms first.
   - Drag a preset onto another group to move it.
   - The footer has Create new group and Delete.
   - The Style rows lost their × buttons. The Pattern rows show only W × H.
9. **Adjustments panel.** It is now Photoshop's icon grid: 16 lucide icons in its three rows. A caption reads "Add an adjustment" or the name of the hovered or focused adjustment. Clicking an icon still opens the existing adjustment dialog; the live Properties editor (D5) is still to come.
10. **Properties for a layer (new `photo/LayerProperties.tsx`).**
    - **Transform:** W/H with a link toggle (linked by default; sizes from the top-left), X/Y, an angle field and Flip H/V. Moves go through `layer.translate`; resizes, rotation and flips go through `edit.transform` with an explicit `rect` and `quad`. The angle reads 0° again after it is applied, as on Photoshop pixel layers. The section is disabled when the layer's position is locked and hidden when the layer has no bounds.
    - **Align and Distribute:** six align icons, six distribute icons, two spacing icons, and an Align To popup (Selection/Canvas). With "Selection", alignment goes to the active selection if there is one, otherwise to the selected layers, and a lone layer goes to the canvas. Distributing needs three or more layers.
    - The old "Layer properties" section is now "Quick Actions" and keeps its buttons (Transform, warps, arrange, clip, group, smart object, Edit text, Edit adjustment).
    - The duplicated Name field and Lock checkboxes are removed. Locks stay in the Layers panel's lock row.
    - **Layers panel:** double-click a layer name to rename it in place. Enter commits and Esc cancels.

Tests:
- New or updated: strokeConstraint (2), EditorChrome flyout press-drag-release, AdditionalPresets folder groups, the Adjustments grid caption and rows, the Transform/Align test, and Layers inline rename.
- The typing-guard tests now type into the Width field, and the lock test uses the Layers lock buttons.

Verification:
- `npm run typecheck` passes.
- PhotoStudio layout/tools, strokeConstraint, AdditionalPresets and EditorChrome pass: 185 tests.
- `npx vitest run src/apps/xdesign` passes: 326 files, 3748 tests (`/tmp/phase5-xdesign.txt`).
- Not run: Rust (no Rust changed). Nothing has been checked in the live app yet.

Still to do:
- ⌘Space zoom. Deferred because macOS gives ⌘Space to Spotlight.
- The rest of the Properties clusters: the Canvas cluster when nothing is selected, Shape Appearance, Mask Density/Feather, and the live adjustment editor (D5).
- The Layer Style dialog (D7).
- Channel and path thumbnails.
- A filled preview while moving, instead of the outline.
- The Transform section uses `transformBounds` (falling back to `bounds`) and has not been checked against the engine for groups and text layers.

Open questions for Hermes (design tokens):
- Shift-line rubber band: `rgba(0,0,0,.47)` / `rgba(255,255,255,.9)`.
- Brush-resize tip red: `rgba(255,0,0,.43)`.
- Full Screen background: `#000`.
- The crop guide colour, still `rgba(255,255,255,.6)`.
- The preset folder drop outline uses `--neon-magenta`, and selected preset rows use `--bg-3`. Both need confirming.

Next: check the new gestures and the Properties clusters in the live app, then D5 (live adjustments in Properties) and D7 (Layer Style dialog) once the owner confirms.

## 2026-10-22 — XDesign photo: options bar, panel menus, right-click menus, Info panel (spec Phases 3–4)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Follows the Phases 1–2 entry below. The owner asked to "keep going" after Phases 1–2.

Changed:
1. **Options bar (Phase 3).**
   - New files: `photo/OptionsBarControls.tsx` (`PopupSlider`, `BrushPresetPicker`, `SelectionModeCluster`, `GradientTypeIcons`) with tests, and `optionsBar.css`.
   - Brush tools: a brush-tip picker (size, hardness, presets), scrubby/popup sliders for Size and Opacity, `[`/`]` size steps that grow with the brush, `{`/`}` hardness, digit keys for opacity, and Tab to hide the panels.
   - Selection tools: the New/Add/Subtract/Intersect icon cluster. Gradient tool: style icons.
   - Zoom tool: zoom-in/out mode icons, plus 100%, Fit Screen and Fill Screen.
   - Move tool: Auto-Select with a Layer/Group target, Show Transform Controls, and the six Align buttons. A zero-distance drag no longer sends a move.
   - Eyedropper: Sample Size, from Point Sample to 101 by 101 Average (`eyedropper.ts` averages the area).
   - Crop tool: an overlay selector (Rule of Thirds, Grid, Diagonal, Golden Ratio, None; Triangle and Golden Spiral not yet) drawn by `CropOverlay.tsx`.
2. **Channels panel rewritten in Photoshop's layout (`PhotoChannels.tsx`).**
   - Rows have an eye button and a name.
   - Alpha channels: ⌘-click loads the channel as a selection, double-click renames it inline, and right-click opens Duplicate, Delete, Merge Spot and Channel Options…. Dragging a channel's name above or below another alpha row reorders it, as in Photoshop. The drop line reuses the layer list's magenta inset.
   - The footer is four icon buttons: Load channel as selection, Save selection as channel, Create new channel (Alt-click for options), and Delete current channel.
   - Removed: the help text, text footers and per-row buttons. Apply Image, Calculations and Load Selection stay in the Image and Select menus and in the Properties document section.
3. **Paths panel rewritten (`PhotoPaths.tsx`).**
   - Rows can be selected. Work Path is shown in italics. Double-click renames inline, and right-click opens the path menu.
   - The footer is six icon buttons: Fill, Stroke, Load as selection, Make work path, Save work path, and Delete.
   - The selected path is held in PhotoStudio, so the ≡ menu, the canvas right-click and the panel all act on the same path.
4. **≡ panel menus on every panel group and on the strip flyouts.**
   - Layers lists Photoshop's flyout items (New Layer through Flatten Image) trimmed to the commands the engine has. Channels and Paths use their panels' menus, History has Step Forward/Backward, and Color keeps its colour modes.
   - Docked groups end with Collapse/Expand Panel Group. Strip panels end with Close.
   - Shortcuts are shown where the item is bound.
   - Items are looked up from the menu bar's `menus` array by path (`fromMenu`), so each command is defined once. The clipping and merge items are shared consts.
5. **Right-click menus, in Photoshop order (taken from the reference's `layer_menu_ui.rs` and `canvas_tool_menu.rs`).** No shortcuts are shown, following Photoshop's convention for context menus.
   - Layer row: Blending Options…, Duplicate/Delete, Group from Layers, Convert to Smart Object plus the item for the layer kind (Rasterize Type, Edit Contents, or Rasterize Layer), mask items (Add, Apply or Delete Layer Mask), the clipping mask item, Link Layers, Copy/Paste/Clear Layer Style, and Merge/Flatten. Right-clicking an unselected row selects it first.
   - Canvas with a selection tool: Deselect, Select Inverse, Feather…, Select and Mask…, Save Selection, Make Work Path, Layer via Copy/Cut, Free Transform, Transform Selection, Fill…, Stroke… and Last Filter. Without a selection: Select All, Reselect, Color Range…, Load Selection…, Select Subject, Fill…, Stroke… and Last Filter.
   - Canvas with a pen or path tool: Delete Path, Make Selection, Fill Path and Stroke Path.
   - Move tool, or ⌘ + right-click with any tool: a list of the layers under the pointer (`layer.pickAt` with `list:true`). Choosing one selects it.
   - The canvas never shows the webview's own menu.
6. **Info panel (new strip panel).**
   - New files: `photo/InfoPanel.tsx` with tests, and `infoPanel.css`.
   - Shows RGB, HSB, X/Y, the selection's W/H, and the document size.
   - The pointer position goes through its own small store (`useInfoCursor`), so pointer moves don't re-render PhotoStudio. Positions are fed only while the panel is open.
   - Sampling waits until the pointer reaches a new pixel, with one request in flight at a time.
   - Window menu keys: Brushes F5, Color F6, Layers F7, Info F8.
7. **CSS.** Path rows, the italic work path and the inline rename input use existing tokens only. Selected channel and path rows use the same `--bg-3` as selected layers. Unused `.xd-photo-alpha`, `.xd-photo-channel-actions`, `.xd-photo-channel-footer` and `.xd-photo-channel-help` rules were removed.
8. **Tests.**
   - The Paths and Channels tests now use the new controls: footer icons, ⌘-click, the ≡ menu, and the row context menu.
   - New tests cover the Layers ≡ contents and shortcuts, the layer-row context menu, the selection-tool canvas menu with and without a selection, the Move-tool layer picker, the pen-tool path menu, the Channels ≡ (Merge Spot Channel), the History ≡ Close item, and Info sampling. The channel test now drags with a stubbed `dataTransfer`: dropping below a row, dropping above one, and dropping a row on itself, which sends nothing.

Verification:
- `npm run typecheck` passes.
- Focused tests pass: PhotoStudio tools, PhotoStudio layout and InfoPanel (174 tests).
- `npx vitest run src/apps/xdesign` passes: 325 files, 3736 tests.
- Not run: Rust (no Rust changed) and a check in the live app.

Deviations and limits (deferred):
- There are no channel or path thumbnails yet.
- Not in the menus because the engine has no command for them: Disable Layer Mask, Collapse All Groups, Move Group Up/Down, Close Tab Group, and the pen menu's Create Vector Mask, Define Custom Shape, New Guides From Shape, Clipping Path and Free Transform Path.
- Auto-Select clicks inside the current layer's transform box are still taken by the transform overlay.
- Still to do:
  - Flow/Spacing popup sliders and Photoshop's blend-mode order.
  - F screen modes, ⌘Space zoom, holding ⌘ for a temporary Move tool, ⌃⌥-drag brush resize, and Shift-click straight lines.
  - Re-opening a tool flyout, and gaps in releasing a press-and-hold.
  - The Preset Manager forms.
  - The brush picker on right-click with paint tools.
  - A popup slider for Layers Opacity/Fill.
  - The Adjustments icon grid.
  - Restructuring the Properties panel's Transform/Align.
  - Navigator zoom icons.
  - A crop-tool context menu.

Open questions for Hermes (design tokens):
- Pressed-state fill for option-bar icons and selected rows: `--bg-3` is used for now.
- The styling of the flyout triangle on tool buttons.
- Input sizing inside the option-bar popovers.
- The crop guide colour, currently `rgba(255,255,255,.6)`. No token exists for it.

Next: the brush picker on right-click with paint tools, a popup slider for Layers Opacity/Fill, the Adjustments icon grid, and then the D5/D7 work (live adjustments in Properties, the Layer Style dialog) once the owner confirms.

## 2026-10-22 — XDesign photo: Photoshop menu bar, Color panel and Color Picker (spec Phases 1–2)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Follows the entry below. The owner approved Phases 1 and 2 ("go") with D1 (Save ⌘S plus File ▸ Export ▸ Export As… ⌥⇧⌘W, ⇧⌘S unbound), D2 (OK/Cancel in a right column), D3 (preview on the canvas) and D6 (drop the Document tab). D5 and D7 come later; D4 waits on Hermes.

Changed:
1. **One menu component.**
   - New files: `menuModel.ts` (types, `shortcutGlyphs`, `matchesShortcut`, `findShortcut`), `EditorMenus.tsx` (`MenuBar`, `MenuButton`, `ContextMenu`) and `editorMenus.css`, each with tests.
   - Supports submenus, a ✓ / radio column, a right-aligned ⌃⌥⇧⌘ shortcut column, hover-to-switch between open menus, full keyboard navigation (arrows, Home/End, type-ahead, Escape one level at a time) and menubar/menu/menuitem ARIA.
   - Rows render only while their menu is open.
   - Plain keys stay inside the menu; ⌘ shortcuts pass through to the app.
2. **`PhotoStudio.tsx`: Photoshop menu structure** with File, Edit, Image, Layer, Type, Select, Filter, View and Window menus, built in one `menus` array.
   - Shortcuts are listed on their rows. The key handler routes ⌘, Ctrl and F-key presses through `findShortcut`, so each binding is defined once.
   - A disabled match is swallowed. Matching is skipped during IME composition and in contenteditable.
   - The old `MENU_SHORTCUTS` lines, the nav of `EditorMenu`s and the options-bar Select menu are gone. Perspective Crop… stays in the Crop tool's options bar.
   - Online-only items are left out.
3. **Behaviour changes that follow Photoshop:**
   - Ungroup ⇧⌘G only works when a group is selected.
   - Filters need a layer.
   - Layer Mask ▸ Reveal/Hide items are disabled once a mask exists.
   - ⌘E reads "Merge Down" or "Merge Layers" depending on how many layers are selected.
   - ⇧⌘X opens Liquify instead of Cut.
4. **Colour.**
   - New files: `photo/colorModel.ts`, `ColorPanel.tsx`, `ColorPickerDialog.tsx` and `colorPanel.css`, each with tests.
   - The Color tab is now the real panel:
     - Fg/bg chips with swap and reset.
     - Five modes (Hue Cube, RGB, HSB, Grayscale, Web) chosen from the tab's flyout menu.
     - A web-safe warning.
   - Clicking a rail or panel chip opens the Color Picker:
     - HSB/RGB fields and hex entry.
     - New/current preview.
     - Only Web Colors.
     - OK/Cancel in the right column.
   - Layer ▸ New Fill Layer ▸ Solid Color… uses the same picker.
   - Grayscale targets (masks, channels, Quick Mask) receive grey values.
5. **Document tab removed (D6).** Its sections (Document, Selection, Channels & saved selections, Color profile) now show in Properties when no layer is selected.
6. **Cleanup.**
   - `EditorChrome.tsx` loses `EditorMenu`, and its CSS is removed. `XDesignApp.tsx`'s File menu uses `MenuButton`; its labels are unchanged.
   - The `.xd-ps-menus` rules, the native colour-swatch CSS and the `PhotoSwatches` native fg/bg inputs are removed.
   - `FilterBrowser.tsx` is now unused outside its own test. It is left in place for a later decision.
7. **Tests.**
   - The photo layout and tools tests now drive the menu bar: open the title, then the submenu row, using the new labels.
   - Colour changes go through the picker, and Document checks use Properties with no layer selected.
   - New tests cover:
     - Merge Down / Merge Layers.
     - ⇧⌘X → Liquify.
     - ⇧⌘S unbound and ⌥⇧⌘W export.
     - The Color panel in its tab, and no Document tab.

Verification:
- `npm run typecheck`: clean.
- `npx vitest run src/apps/xdesign`: 323 files, 3710/3710 passed.
- Not run in the live app (no live probing of owner projects).
- No Rust, `Cargo.toml` or migration changes.

Deferred:
- Picker: Lab/CMYK fields and Color Libraries. Panel: Brightness Cube and Color Wheel modes.
- Context menus and flyouts for the other panels; Layers right-click.
- Layer Style dialog (D7), and live adjustments in Properties (D5).
- Trim… dialog. Transform Scale/Rotate/Skew/Distort/Perspective modes.
- Mask enable/link, Warp Text, Duplicate image, Save Selection dialog, Pattern fill dialog, Vanishing Point.

Next (spec §8): Phase 3 (tools and options bars) and Phase 4 (panels) can run in parallel. Owner to check how the menus look and work in the app.

Open questions:
- **For Hermes (spec §6, D4):**
  - Menu row metrics: 22px rows, 13px text, 200px minimum width, 4px padding.
  - Colour dialog sizing.
  - Highlighted menu rows use `--t-on-accent` (`#03060a`, dark) on `--xd-accent`, where Photoshop uses white text on its blue highlight. Confirm the pair.
  - Nothing new was invented.
- Should `FilterBrowser.tsx` be deleted, now that the Filter menu replaces it?

## 2026-10-22 — XDesign photo: no grey-out and no flash for every tool; per-tool cursors; Photoshop parity spec

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Follows the two entries below. Owner: "we need to apply all these fixes we made for the eraser and brush to everything else … compare what we have against photoshop and get a clear idea of the gaps and also a clear idea on how everything needs to work in xdesign … i want all tools and menus to work and look the same"

Spec: [docs/architecture/xdesign/photoshop-parity.md](docs/architecture/xdesign/photoshop-parity.md). It covers the interaction rules (§1), menus (§2), tools (§3), panels (§4), dialogs (§5), token gaps (§6), decisions needed (§7) and a phased plan (§8). Per-item audits against the Photoshop 2026 layout files are in `docs/architecture/xdesign/photoshop-parity/` (menus, tools, panels, dialogs). Four sub-agents wrote them; I spot-checked their claims against the code, corrected two of them (X/D/Q and Shift+letter cycling are wired) and marked the statements this work made stale.

Changed:
1. `runtime.ts`
   - Every `runPhotoCommand` is quiet; the `{ quiet }` option is gone.
   - `setPhotoColors` and `stepSmartContentsHistory` are quiet too. A colour update already in flight takes new picks without waiting on itself, so rapid picks still merge into one native call.
   - New `holdImageGesture(reason)`: a pointer gesture holds the lock quietly. Release it synchronously before the gesture's own command, so the commit runs ahead of work queued during the drag.
   - Loud operations remain only for lifecycle work: open, refresh, create, export and place, plus entering and leaving Smart Object contents.
2. `PhotoStudio.tsx`
   - Gestures use `holdImageGesture`. Polygon, pen and magnetic drafts hold only an activity (no lock, no grey).
   - **No flash:**
     - `imageShown`/`untilShown`/`clearWhenShown` keep each stand-in on screen until the committed preview decodes: outlines, crop and selection boxes, the text field, the dragged path, the transform preview.
     - The transform overlay follows the shown layer.
   - **Per-tool cursors** (`TOOL_CURSORS` and `photo.css`): arrow for Move/Path selection, I-beam for Type, and icon cursors for Eyedropper, Bucket, Lasso and Magic Wand. Zoom shows zoom-out while Alt is held.
   - Fixed a hook-order crash: the `shownWaiters` ref sat after `if(!document) return null`, so closing the image threw "Rendered fewer hooks than expected".
3. Overlays:
   - `ImageTransformOverlay` holds its preview until the image is shown.
   - `MagneticLassoOverlay` takes no lock.
   - `CanvasTextEditor` goes read-only while committing and closes when the text is shown.
   - `PathEditOverlay` keeps the dragged path until the edit lands.
4. Tests:
   - New `photo/lockOwnership.contract.test.ts`: only `runtime.ts` may write `busy`/`quiet`.
   - `runtimeQuiet.test.ts` covers gesture-release ordering.
   - Polygon-draft tests now expect no lock plus a held activity.
   - The `{quiet:true}` expectations are removed.
   - The magnetic and transform overlay tests are updated.

Verification:
- `npm run typecheck`: clean.
- `npx vitest run src/apps/xdesign`: 3638/3639 passed.
  - The one failure was a 5s timeout under load in `pencil/nativeReactMaskRegionTransform.test.ts`, which this work doesn't touch. It passes alone.
  - The guard test was added after that run and passes on its own.
- No Rust, `Cargo.toml` or migration changes.

Known edges (spec §1.4):
- A new stroke is refused during the ~100–300ms commit (no stroke buffering yet).
- Arrow nudges are dropped while an edit commits.
- Queued commands keep the layer index they were queued with.
- Crop stretches the old image for a frame.
- The magnetic lasso outline clears just before its ants appear.
- High-zoom tiles can lag a frame.
- The transform stand-in only exists if its 120ms preview finished first.
- Modal dialogs still read raw `busy`, which only disables their own OK during their own commit.

Next (spec §8): Phase 1 is one menu component (submenus, shortcut column, hover-switch, keyboard, ARIA), shared by the menu bar, context menus and panel flyouts in both editors, plus the menu restructure. Phase 2 is the Color panel and Color Picker. Owner retest of the erase/brush/selection/crop/text/transform commits is needed.

Open questions:
- Owner decisions D1–D7 are in spec §7: File menu scope, OK/Cancel column, on-canvas dialog preview, radii and focus ring, live adjustments in Properties, dropping the Document tab, and a Layer Style dialog.
- **For Hermes, token gaps (spec §6):** dialog body, control fill, alpha control frame, divider, disabled text, button fill/pressed/stroke, slider track/thumb, tooltip, alert, scrim, control height and menu row height. None was invented.

## 2026-10-22 — XDesign photo: brush and eraser cursor is a ring at the tool's real size

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Follows the entry below; the owner confirmed the erase flash and grey-out are fixed. Owner: "the only thing life is showing the area of which im erasing like the cursor shold be the cirl and the size of the eraser or brush"

Changed:
1. `PhotoStudio.tsx`
   - A ring element `.xd-photo-brush-tip` (L782), sized at `size × zoom` screen px (`tipSize`, L362).
   - Applies to every brush tool: brushes, eraser, retouch and the background eraser. Quick Selection uses its own size. Not shown while space-panning, during geometry editing, or while a view preview is loading.
   - Moved by a transform from the last pointer position (`placeBrushTip`, L214–222). This runs on pointer move, on stage scroll and after every render, so zoom, scroll and `[`/`]` size changes keep it under a still pointer.
   - It stays off React's render path while moving, and is hidden on pointer leave (L780).
   - While the ring is at least 6 screen px, the canvas gets `.xd-photo-brush` (`cursor:none`). Smaller than that keeps the crosshair, so a 1px brush never leaves the pointer invisible.
2. `photo.css` (L34–35): the ring reuses the selection contour's white-over-#222 pair so it reads on light and dark pixels. No new tokens.
3. Test: `PhotoStudio.layout.test.tsx` L633 covers size at 100% zoom, follows the pointer, resizes in place, hides on leave, keeps the crosshair for a tiny brush, and shows no ring for a non-brush tool.

Verification:
- `npm run typecheck`: clean.
- `npx vitest run src/apps/xdesign`: 317 files / 3638 tests pass.
- No Rust, `Cargo.toml` or migration changes.

Known edges / next:
- The ring shows the full diameter; it does not shrink for soft brushes or follow pen pressure.
- Alt-sampling with a brush tool keeps the ring rather than an eyedropper cursor.
- Owner retest needed.

## 2026-10-22 — XDesign photo: erasing and painting no longer grey out the controls or flash the unedited image after release

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Follows the entry below. Owner: "i feel like when using the earase we do not have to grey out all the other buttons its so unessecary and again its still erasing then flashing back then erasing again"

Root causes:
- **Flash.**
  - For a Pencil-placed image, `runPhotoCommand` publishes the reply's state (`receive`) before `commitPencilPhoto` publishes the new document version, which waits for the placement's preview.
  - In that gap `stateVersion !== document.version`, so `currentState`/`displayState` went null.
  - The detail tiles are keyed by `document.id/viewKey`, so they remounted twice and reloaded the old version's (unerased) tiles before the new ones arrived.
- **Grey-out.** `busy` was set at pointerdown, cleared after the feedback, set again by the commit's `operation`, and cleared once more. Every `disabled={busy}` control dimmed twice per stroke.

Changed:
1. `runtime.ts`
   - New `quiet` flag on the workspace state.
   - `controlsLocked` (L46) = `busy && !quiet`: what visible controls show.
   - `operation(work, quiet)` (L49):
     - A quiet operation registers as `quietCommit`.
     - Operations started meanwhile wait for it (L52) instead of failing with "Wait for the image operation to finish". So an Undo pressed right after a stroke undoes that stroke.
     - Ordinary operations still refuse a second command, as before.
   - `runPhotoCommand(id, params, { quiet })` (L299).
   - `setPhotoColors` also waits (L187), because it pins the version before calling `operation`.
2. `PhotoStudio.tsx`
   - `locked` (the real lock) and `busy` (`controlsLocked`) at L146. The document-switch and `refreshImage` effects keep the real lock, so a quiet commit's gap never triggers a refresh.
   - The last state that matched the document is kept (`shown`, L157–160). While the lock is held and the newer state's document has not arrived, `currentState`/`displayState` (L209) keep showing the state of the image that is still on screen. Nothing remounts.
   - Gestures set `{busy:true,quiet:true}` (L754, L766), and `endGesture`/`resetStroke` clear both.
   - `commitGesture` (L471) and the new `gestureCommand` (L364) commit quietly: strokes, retouch, Patch, the erasers, gradients, bucket, selections/straighten, move, shapes and pen paths.
   - Polygon/pen click-drafts keep the ordinary lock while drafting.
3. Docked panels use `usePhotoWorkspace(controlsLocked)`: LayerEffects, SmartFilters, PresetManager, BrushPanel, PhotoChannels, PresetPanels, AdditionalPresets, ImageTypographyPanel. Modal dialogs still use the real lock.
4. Tests:
   - New `runtimeQuiet.test.ts`: a quiet commit queues a concurrent undo onto the committed version, and an ordinary operation still refuses.
   - `PhotoStudio.layout.test.tsx` L566: the detail-tile node and Undo survive a state-before-document commit. It failed before the fix.
   - The gesture test (L609) now expects enabled controls and `{quiet:true}`.
   - Gesture-commit assertions in the layout and tools tests gained `{quiet:true}`.
   - The SmartFilters and AdditionalPresets runtime mocks gained `controlsLocked`.
5. No Rust, `Cargo.toml` or migration changes.

Verification:
- `npm run typecheck`: clean.
- `npx vitest run src/apps/xdesign`: 317 files / 3637 tests pass.
- Cargo was not rerun: no native changes. The last run was 783 passed, 1 ignored.

Known edges / next:
- A new stroke started while the previous one is still committing is still ignored, as before.
- A panel click in the few milliseconds between release and the commit start (while the last feedback paints) still reports "Wait for the image operation to finish".
- Picking a History Brush source during a commit shows the same wait status.
- The Magnetic Lasso and transform overlays keep their own ordinary lock.
- Owner retest needed. If a flash remains, note whether it appears during the drag or on release, and at which zoom.

## 2026-10-22 — XDesign photo: zoomed, channel/mask/proof and retouch strokes paint in place too; release waits for the last samples

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Follows the entry below and fixes its "Known edges". Owner: "you are right when i zoomed it they appeared again, can we fix these leftover limitations ?"

Changed (every pixel tool now patches its feedback into the canvas that already shows the image, so there are no squares while dragging and nothing swaps on release):
1. **Native (`xdesign_photo_stroke.rs`).**
   - `render_pixels` (L457) now serves every streamed pixel tool through `pixel_draft`: stroke, pencil and erase, the 12 continuous retouch tools, Patch, and the magic and background erasers.
   - Redrawn area: the damage inflated by the tool's effect reach + 2. Patch and the erasers return their whole result (replace), capped at 64 chunks.
   - Channel, mask and proof views render through `tiles::rgba` with the channel view, so tile pixels match the committed view.
   - `render_preview_pixels(…, view)` (L497), and `xdesign_photo_stroke_preview_pixels(…, view)` (`xdesign_photo.rs:2157`): while a view preview is shown, it renders at that preview's size (factor `ceil(max(W,H)/2048)`).
   - New tests assert the patched pixels equal the committed result byte for byte:
     - L1016: all 12 retouch tools, at scale 1 and 2.
     - L1036: Patch at two offsets, plus both erasers.
     - L1057: a hidden channel, an alpha overlay and a gray mask view.
2. **Client.**
   - `strokeCanvas.ts`: the `StrokeCanvas` overlay is replaced by `TileSurface`.
     - Detail colour tiles are now canvases (`PhotoTiles.tsx` `TileCanvas`).
     - Stroke chunks are patched into those canvases and reapplied to tiles that load mid-stroke.
     - `settle` and `restore` behave like `PreviewSurface`.
     - `record` drops covered chunks, so retouch feedback (which repaints its whole damage each frame) does not grow per frame.
   - `previewSurface.ts` and `TileSurface` take `paint(chunks, replace)`.
   - `strokePreview.ts`:
     - Pixel mode supports `replace` (Patch and the erasers), with `null` clearing.
     - `end()` returns a promise that resolves once the queued release samples are painted.
   - `PhotoStudio.tsx`:
     - At pointerdown, `beginStrokeSurface` (L451) picks the preview surface when the preview covers the screen, otherwise the tile surface.
     - Every pixel tool goes through `strokePixels` (L452).
     - `commitGesture` (L464) stays busy until `feedback.end()` resolves, then commits. It settles when the version changes and restores when the version is unchanged or the command fails.
     - The held-stroke overlay (`.xd-photo-stroke`) and the `tilesReady` hand-off are gone.
3. **Tests.**
   - `PhotoStudio.layout.test.tsx`: renamed preview commands; the tile-space test (L531) was rewritten to check pixels patched into a tile canvas, settle, undo and restore.
   - `strokeCanvas.test.ts`: `TileSurface` and `record`.
   - `previewSurface.test.ts`: replace.
   - `PhotoTiles.test.tsx`: canvas colour tiles.
   - `strokePreview.test.ts`: `end()` waits for the release samples; replace and clear.
4. No temporary timing logs remain. `Cargo.toml` and migrations were not touched.

Verification:
- `npm run typecheck`: clean.
- `npx vitest run src/apps/xdesign`: 316 files / 3634 tests pass.
- `cargo test --lib xdesign_photo -- --test-threads=1`: 783 passed, 0 failed, 1 ignored.

Now unused by the app and left in place (removal candidates):
- `xdesign_photo_stroke_preview`, the PNG feedback command (`xdesign_photo.rs:2108`). `render_with_identity`, `patch_preview_tiles` and `eraser_preview_tiles` behind it are still used by Rust tests.
- `NativeStrokePreview.detach` and its tile-URL mode.
- The `PhotoTiles` `ready` and `children` props.
- `patchPreviewScale` (`patchGesture.ts:24`).

Next:
- The owner should retest in the live app. The dev app wasn't running here.
  - Drag at 200%+ zoom.
  - Drag in channel, mask and proof views.
  - Clone, healing, Patch and both erasers.
  - Fast releases.
- Remaining edges:
  - The surface is chosen at pointerdown. Zooming across preview density mid-stroke hides the live stroke until the commit lands.
  - Unchanged from the entry below: cancelling a stroke before the previous commit's preview has loaded can briefly redraw the older preview.

Open questions: none new.

## 2026-10-22 — XDesign photo: strokes paint into the preview itself (no squares while dragging, no settle on release)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Follows the entry below. Owner: "when i drag theres a distortion that happens showing the squared fragments in the line, then when i let go theres an adjustment moment before the line solidifies".

Cause (measured with a temporary in-app probe, since removed):
- At fit and low zoom, the image shows from the `<img>` preview. WKWebView downscales that img differently from the canvas chunks the stroke was drawn into, so each chunk showed as a slightly different square over it.
- On release the stroke canvas was swapped back for the committed img, which is the "adjustment".
- Flat colours were identical, so this was resampling, not colour management.

Changed (one display surface: the stroke is patched into the same pixels the commit produces, so nothing swaps):
1. **Native.**
   - `xdesign_photo.rs:226` `preview_size` is now shared by `descriptor` and `publish`.
   - New command `xdesign_photo_stroke_preview_pixels` (`xdesign_photo.rs:2155`, registered `lib.rs:594`).
   - `xdesign_photo_stroke.rs:465` `render_preview_pixels` renders stroke damage at the published preview's size, the same way the preview PNG is rendered (`render_reduced_damage` + `display::rgba`). It returns at most one chunk, in the `render_pixels` format.
   - The incremental view is `[0,0,pw,ph,0]`. Scale 0 never collides with tile views, which are always power-of-two.
   - Validation is shared through `pixel_points` (L417).
   - Test `streamed_preview_pixels_patch_the_published_preview_into_the_committed_preview` (L944) streams stroke, erase and pencil in batches, blits the chunks into the old preview, and asserts the result equals the committed preview byte for byte. It covers full-size, reduced and square previews.
2. **`src/apps/xdesign/photo/previewSurface.ts` (new).**
   - `PreviewSurface` draws the decoded preview into one canvas and `putImageData`s stroke chunks into it.
   - Chunks of the live stroke are reapplied if a newer preview (the previous commit's) loads mid-stroke.
   - `settle()` stops that after a commit, so undo never brings them back. `restore()` redraws the clean preview when a stroke is cancelled or refused.
   - Test: `previewSurface.test.ts`.
3. **`PhotoStudio.tsx`.**
   - The preview `<img>` is now a hidden loader (`.xd-photo-preview-source`). The visible `.xd-photo-preview` is a canvas fed by `PreviewSurface`.
   - Stroke, pencil and erase use the preview-space command when `!viewPreview.active && previewCoversScreen(...)`, the same test `PhotoTiles` uses for `selectionOnly` (`tiles.ts:15`, `PhotoTiles.tsx:51`).
   - Zoomed past preview density, or under a channel/mask/proof view, strokes keep the `StrokeCanvas` tile overlay from the entry below.
   - The flat placeholder line is skipped for all pixel tools once native feedback exists, so it no longer flashes over the real pixels.
   - `photo.css:27,29,252,261` were updated.
   - `strokeCanvas.ts`: `parseStrokePixels` takes an `edge` argument (default tile edge).
   - Layout tests were updated. A new test is at `PhotoStudio.layout.test.tsx:560`.
4. The temporary probe (`src/devPerfProbe.ts`, its `main.tsx` import, `node_modules/orion-perf-cmd`) is removed. `main.tsx` is byte-identical to its pre-probe backup. `Cargo.toml` was not touched this session.

Verification:
- `npm run typecheck`: clean.
- `npx vitest run src/apps/xdesign`: 316 files / 3631 tests pass.
- `cargo test --lib xdesign_photo -- --test-threads=1`: 780 passed, 0 failed, 1 ignored.

Next:
- The owner should retest drag and release at fit zoom in the live app. The dev app wasn't running here, so there was no final on-screen check.
- Known edges:
  - If the release flush loses the race with the commit taking the incremental cache entry, the stroke's last samples appear when the committed preview loads, not before.
  - Zooming in mid-stroke keeps painting into the preview, which tiles cover until the commit.
  - Cancelling a stroke before the previous commit's preview has loaded can briefly redraw the older preview.
  - Zoomed-in, view-preview and retouch strokes still use the tile overlay.

Open questions: none new.

## 2026-10-22 — XDesign photo: smooth brush/eraser feedback (raw pixels into persistent canvases, no blink on commit)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Follows the entry below. Owner: "it still stutters … the delay stutter and the whole page like blinks while erasing, i just cant have that even on a less powerful device … look into photoshop or photocraft and see how things are being handeled".

Cause:
- Each brush step re-encoded whole 512px tiles as PNG/base64.
- Imgs remounted by URL or version.
- `PhotoTiles` blanked on every version change.
- The held stroke was dropped before the new image had decoded.
- The eraser drew a white placeholder.

Changed (Photoshop-style damage rects: only changed pixels move, painted in place, and the old view stays until the new one is decoded):
1. **Native raw-pixel feedback.**
   - `xdesign_photo_stroke.rs:422` `render_pixels` returns a u32 LE count (≤64), six u32 per chunk (`x,y,w,h,pw,ph`, scale-aligned, inside one `512*scale` tile), then straight RGBA.
   - New command `xdesign_photo_stroke_pixels` (`xdesign_photo.rs:2123`, registered `lib.rs:593`) returns it through `tauri::ipc::Response`, so there is no PNG or base64.
   - Clone/history/patch are refused, and those tools keep the tile path.
2. **`src/apps/xdesign/photo/strokeCanvas.ts` (new).**
   - `parseStrokePixels` validates the whole payload.
   - `StrokeCanvas` keeps one canvas per tile and paints each chunk onto the same screen-anchored checker `.xd-photo-image` uses, so erased pixels hide the stale preview.
   - Tests: `strokeCanvas.test.ts`.
3. **`strokePreview.ts`.**
   - An optional `paint` callback is used in pixel mode, with no URLs and no React state per frame.
   - `end()` (L88) flushes the last samples on release, then closes without releasing native feedback.
   - Test added to `strokePreview.test.ts`.
4. **`tiles.ts` / `PhotoTiles.tsx`.**
   - Tiles are decoded (`decodeImage`, `tiles.ts:34`) before they are shown.
   - `retire()` (L128) keeps the previous version's cache on screen until the new visible set has loaded (`PhotoTiles.tsx:26-35`).
   - Imgs are keyed by tile position and role, so a version change swaps `src` in place instead of remounting.
   - New `ready(count, version)` prop. `children` render between the color and selection layers.
   - Test added to `PhotoTiles.test.tsx`.
5. **`PhotoStudio.tsx`.**
   - Stroke, pencil and erase (`PIXEL_STROKE_TOOLS`, L72) paint into a `StrokeCanvas` mounted by `StrokeLayer` (L130).
   - Each finished stroke stays on screen until both the preview img and the detail tiles show a newer version (`settled`, L232). A 10s safety timer (L240) backs this up.
   - The eraser's white placeholder is gone. `photo.css:36-37` was added.
   - Layout tests updated.
6. Temporary perf probes are removed: the `devPerfProbe` dev import, the `orion-perf-cmd` stub, and the `xdesign_photo_stroke_perf_tmp.rs` test. `main.tsx` is byte-identical to its pre-probe backup. `Cargo.toml` is unchanged.

Measured per brush step (temporary native test on a 6000×4000 image, 60 steps, eraser, since removed):

| Case | Before (PNG tiles) | After (raw pixels) |
|---|---|---|
| fit, dpr2 | p50 57.5ms, p95 114.5ms, 1310KB/step | p50 0.7ms, p95 1.4ms, 7KB/step |
| fit, dpr2, big brush | p50 114.8ms, p95 229ms, 1962KB | p50 5.0ms, p95 7.4ms, 61KB |
| fit, dpr1 (scale 4) | p50 373ms, p95 749ms, 1487KB | p50 4.5ms, p95 6.2ms, 16KB |
| 100%, dpr2 | p50 4.5ms, 1524KB | p50 0.2ms, 33KB |

Verification:
- `npm run typecheck`: clean.
- `npx vitest run src/apps/xdesign`: 315 files / 3627 tests pass.
- `cargo test --lib xdesign_photo -- --test-threads=1`: 779 passed, 0 failed, 1 ignored.

Next:
- The owner should try stroke/erase in the live app. WebKit decode timing and smoothness on a slower machine are unverified, because the app can't be driven from here.
- Retouch tools (clone, history, patch, dodge and friends) still use the PNG tile path.
- Known gaps:
  - Chunks dropped by the per-step budget or the 64-chunk cap, and areas scrolled into view mid-stroke, stay stale until commit.
  - The checker is baked at the zoom used during the stroke.
- Delete the scratch project "perf-scratch" (`01M5J0XBXT9TJTPBE5RC1105KZ`).

Open questions:
- The checker colors `#303034`/`#3a3a3e` are duplicated in `strokeCanvas.ts` from `photo.css`, because canvas can't read the CSS gradient. Should they become tokens? (Hermes)

## 2026-10-22 — XDesign perf follow-ups: companion in apps, idle photo saves, undo cap, image blobs, batched PhotoCraft flushes

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** These follow on from the entry below. Owner: "maybe the companion only show when we arent in an app by default and people with stronger computers can enable it as they please. 2. do it [batch photocraft's per-tile flushes] 3. maybe we can have it only save when idle ? 4. lets cap the undo limit to like 4-5 edits". On moving images out of the saved document: "its exceptable".

Changed:
1. **Companion only on the bare desktop by default.**
   - New `src/features/rosie/avatar/companionPresence.ts`: `companionOnScreen()`/`useCompanionOnScreen()` require `companionVisible` and either `showInApps` or no un-minimized window.
   - Used by `CompanionAvatar.tsx:32` and `useProactiveCompanion.ts:158,205`.
   - `src/store/characterStore.ts`: `showInApps` (L16, persisted L47, default `false` L54, hydrate L64-65, `setShowInApps` L81-82).
   - `src/features/characters/CharacterPicker.tsx:176-191`: a "Show in apps" toggle.
   - Test: `companionPresence.test.ts`.
2. **Photo edits save when the canvas goes quiet.** `runtime.ts:548-560`: `commitPencilPhoto`'s `apply()`/`revert()` only `requestRender()`. The session's 250ms debounce (`:272`) saves once edits stop, and dispose (`:281`) flushes a pending one. Tests: `persistence.test.ts:40,48`.
3. **Photo undo capped at 5.**
   - New `src/apps/xdesign/pencil/photoUndoCap.ts`: `PHOTO_UNDO_LIMIT = 5`, `capPhotoUndo` (L40-60), called at `runtime.ts:563` for top-level, non-shared photo commits.
   - It trims the undo stack below the 5th-newest photo edit. Previews that no reachable state still shows are then dropped from `graph.images`, along with each renderer's `imageCache` entry.
   - Test: `photoUndoCap.test.ts`. One case covers a preview that undoing a later design edit can restore; it is kept.
4. **Saved format: PackedGraph v2.**
   - `graphPacking.ts:15,43-63`: images ≥64KB are stored base64 in a `blobs` array beside the deflated graph instead of inside it. Their encodings are cached per `Uint8Array`, so saves after an edit don't re-encode or re-deflate photo bytes.
   - `formatVersion` is 2 only when blobs exist. `graphDocument.ts:38-42` decodes blob references, and v1 documents still load.
   - Test: a v2 case in `graphPacking.test.ts:30-34`.
   - Node bench on the owner's design: serialize 591–635ms → 56–62ms (cached), deserialize ~1000–1075ms → 470–498ms, same size.
5. **PhotoCraft batched tile flushes (vendored patch).**
   - New `src-tauri/vendor/photocraft/`: photocraft-format 0.3.0 at the pinned `47f9306`, plus the repo's LICENSE-MIT/LICENSE-APACHE/NOTICE.
   - Wired in through `[patch."https://github.com/storytold/photocraft"]`, appended to `src-tauri/Cargo.toml`.
   - The only code change is in `store.rs`: `save_dir` writes new objects through `write_new_objects`. That is tmp file + plain `fsync` each, one `F_FULLFSYNC` after the last, then renames and one best-effort dir sync per directory. Before, it paid two `F_FULLFSYNC`s per tile.
   - Its crate adds `nix` 0.28 `fs`, which already ships through portable-pty. `rustix` was tried first, but it would have added a new shipped crate, so it was reverted.
   - Details and the removal condition are in `vendor/photocraft/ORION_CHANGES.md`.
   - Measured on whole-image saves of a 4000×3000 Add Noise (192 new tiles) through `write_document`, with a temporary test that has been removed: 2.66–3.02s → 0.81–1.01s.
6. **License materials.**
   - `scripts/sync-license-materials.py`: a branch for the vendored crate records `vendoredFrom`/`sourceRevision`/`localChanges` and the pinned upstream license texts.
   - `npm run licenses:prepare` regenerated `resources/distribution-license-manifest.json`. Only `cargoLockSha256`, `cargoManifestSha256` and photocraft-format's provenance fields changed; every notice file is byte-identical.
   - `npm run licenses:check`: "Verified license materials: 444 native notices; 8 source archives".
   - `Cargo.lock` differs only in photocraft-format losing its git `source` and gaining `nix`.
7. `src/apps/xdesign/pencil/nativeSceneControlsPresent.test.tsx:91` (pre-existing untracked) now reads `unpackGraph(...).json`, because `unpackGraph` returns `{json, blobs}`.

Verification:
- `npm run typecheck`: clean.
- `npx vitest run src/apps/xdesign src/features/rosie/avatar src/features/characters`: 322 files / 3685 tests pass.
- `cargo test --lib xdesign_photo -- --test-threads=1`: 778 passed, 0 failed, 1 ignored. That run included the temporary timing test, which was removed afterwards; the shipped code differs only by that test function.

Left / next:
- Not re-measured in the real app (WKWebView): the end-to-end photo commit, post-edit frames and pan with the companion parked. The numbers above are Node/`cargo test` measurements.
- The remaining ~0.8–1s of a whole-image save is mostly serial zstd compression in `save_dir` (unprofiled). Upstream `save_zip` already compresses in parallel (`par_compress`); doing the same in `save_dir` would cost temporary memory.
- Upstream the `save_dir` change to storytold/photocraft. Then delete `src-tauri/vendor/photocraft/`, the `[patch]` and the sync-script branch, and re-run `npm run licenses:prepare`.
- Option A (photo bytes fully outside the document, e.g. in the asset pool) is not done; v2 blobs are still inside the saved document string.
- Scratch data from the entry below is still to delete: XDesign project **"perf-scratch"** (`01M5J0XBXT9TJTPBE5RC1105KZ`).

Open questions:
- With "Show in apps" off, ⌥R / "Summon ROSIE" while an app is open sets her visible but she stays parked until every window is minimized. Should summoning temporarily show her, or turn the toggle on?
- The undo cap applies only to photo edits and only to the local session; shared-room sessions aren't capped. Is 5 right, and should design edits keep OpenPencil's 200?
- v2 documents (any image ≥64KB) can't be opened by builds from before this change. Is that acceptable for the alpha?

## 2026-10-22 — XDesign perf pass in the real desktop app (design canvas + photo mode)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: XDesign "extremely laggy and unusable" in `npm run tauri dev` (WKWebView). Measured in the running app with a temporary dev-only probe (rAF frame times, input→frame latency, React commit/component durations, Tauri IPC timing), `/usr/bin/sample` of the WebContent/app processes, and `top` CPU. The probe (`src/devPerfProbe.ts`, a TEMP line in `src/main.tsx`, `node_modules/orion-perf-cmd/`) has been removed. No Rust timing logs were added; `sample` covered the native side.

What was slow (real app, owner's project: 48.6MB packed graph, 5 images / 35MB):
- **Design canvas autosave serialized the whole graph after every event.** 250ms after any pan/zoom/selection, `persistPencil` → `serializeGraph` re-packed every image as base64 (2087–2522ms), so each gesture ended in a 2.1–2.3s freeze. Pan: 39.9fps with a 2152ms frame. Open: 4578ms plus a 2291ms frame. Lead 1's `version` bump was *not* the cost: React commits during pan averaged 1.2ms.
- **Photo commits re-hashed the multi-MB preview with OpenPencil's `computeImageHash`** (per-byte `i % 5` switch, 83–224ms until JSC tiers it up) on the main thread after every stroke or filter.
- **Native photo commits spent most of their time in F_FULLFSYNC.** `xdesign_photo_bundle::write_document` copied each newly written tile into the `.objects` pool through `atomic_write`, two more full syncs per tile on top of `save_dir`'s. A 4000×3000 Add Noise took 5.7s; `sample` showed 2443/3788 samples in `fcntl(F_FULLFSYNC)`.
- **The desktop companion (lead 2) halves photo-pan frame rate while visible.** Uncontended alternating runs: visible 32.2 / 54.4fps (p95 120 / 27ms, max 298 / 127ms) vs hidden 60 / 60fps (p95 18ms, max 20–21ms). Earlier runs under `cargo test` load: visible 49.6 / 48 / 60, hidden 60 / 56.1 / 60. Idle CPU showed no consistent difference uncontended. **Not fixed, see Left.**
- Not the problem: photo zoom 58.6fps (PhotoStudio re-render 1.1ms, React 2.7ms per commit) and photo pan 59.3–59.6fps with the companion hidden; tile IPC was not on the hot path. Lead 4: deps were rebuilt with `opt-level = 3` at 00:19–00:20 (e.g. `libphotocraft_algo-50cb16b83a477114.rlib` 00:20:32) and the running binary links them; the 12MP noise filter itself takes ~0.5s.

Changed:
1. `src/apps/xdesign/pencil/runtime.ts:224-228`: `persistedGraph()` caches the serialized graph per `(graph, sceneVersion)`, so viewport/selection/page events reuse it. `currentPencilSnapshot` (`:240`) uses it, and dispose clears it (`:281`).
2. `src/apps/xdesign/pencil/graphDocument.ts:11-18`: `serializeGraph(graph, {referencedImagesOnly})` persists only images still referenced by a fill (undo keeps the rest in memory). `graphPacking.ts:9-11,26`: native `Uint8Array.toBase64/fromBase64` with a Node fallback, plus `packGraph` overrides; the reviver uses `decodeBase64`. The owner's saved doc was re-saved pruned, 48.6MB → 10.1MB (original backed up at `/tmp/orion-perf-backup/project-01M5HWY8WM18T9S0D92QDVN1QP.json`).
3. New `src/apps/xdesign/pencil/imageHash.ts`: the same digest as `computeImageHash`, unrolled by five (3–4ms vs 83–224ms). `runtime.ts:536` uses it in `commitPencilPhoto` and stores the bytes directly.
4. `src-tauri/src/xdesign_photo_bundle.rs:197-212` (`write_document`): when the pool anchor is missing, hard-link it to the draft object `save_dir` already synced instead of rewriting it with `atomic_write`.
5. Tests: new `imageHash.test.ts` (digest parity for every length remainder) and `persistence.test.ts`; a pruning case appended to `graphPacking.test.ts`; `sharedRecovery.runtime.test.ts` now asserts the image map is untouched rather than only checking the `storeImage` spy.

Before → after (real app):
- Design pan (wheel, net movement, through autosave): 39.9fps / max 2152ms → 60fps, p95 18ms, max 30ms.
- Design open (owner's project): 4578ms + 2291ms frame → 597ms + 204ms frame. Serialize on a real scene change is ~156ms, down from 2.1–2.5s after every event.
- Photo brush stroke: 40–53fps, max 447–889ms → 55.6–56fps, p95 20–23ms. Post-stroke frames: 315–447ms → 228–250ms + ~130ms.
- Add Noise commit, 4000×3000: 5673–5702ms → 3425–3640ms. The after-number was taken with `cargo test` running in parallel; an uncontended re-run wasn't possible (see below).

Verification: `npm run typecheck` clean, re-run after removing the probe. `npx vitest run src/apps/xdesign`: 313 files / 3612 tests pass. `cargo test --lib xdesign_photo -- --test-threads=1`: 777 passed, 0 failed, 1 ignored. Cargo.toml unchanged.

Left / next:
- **Companion vs. pan (largest remaining interactive cost).** It already renders on demand at 30fps (`CompanionScene.tsx` `FrameThrottle`, a setInterval not aligned with rAF) and parks when hidden. Each frame runs the mixer, pose capture and the spring rig, then renders a skinned GLTF with two point lights over the stage. Which part costs the pan (main thread vs. a second WebGL layer recompositing over the scrolling stage) is not yet isolated: the webview was suspended (the user was working in other apps) before it could be timed. Next step: wrap the R3F root's `gl.render`/advance to time one companion frame, then try parking `frameloop` while an XDesign pointer/wheel gesture is active. Its files (`src/features/rosie/avatar/*`, `physics/`) are pre-existing dirty work from 2026-10-20; nothing there was touched.
- `photocraft_format::PcraftWriter::save_dir` (git dependency) still does a file `sync_all` plus a dir `sync_all` for every new tile, which is most of the remaining Add Noise time. The fix belongs upstream: write all objects, do one F_FULLFSYNC, then publish.
- `commitPencilPhoto`'s `apply()` still calls `persistPencil()` synchronously, spending ~190–230ms deflating a 9–12MB base64 photo preview after each photo edit. Options: store images outside the packed graph, skip deflate for already-compressed image payloads, or serialize in a worker.
- `graph.images` grows ~9MB per photo commit for undo, unbounded in memory (persistence is now pruned).
- Scratch data: delete the XDesign project **"perf-scratch"** (id `01M5J0XBXT9TJTPBE5RC1105KZ`, a 4000×3000 test photo) from the XDesign home. It couldn't be deleted through the app once the webview was suspended.
- Housekeeping noticed: 442 draft-recovery `.lock` files and a 98MB SQLite WAL in app data.
- Not measured: design-canvas node drag/draw and zoom as separate gestures (zoom shares the viewport → cached-persist path that was measured for pan), photo layer drag, and lead 5 (backdrop-filter/paint cost).

Open questions: may the companion pause (or drop to a still pose) during XDesign gestures, or while XDesign is focused? Is moving image bytes out of the packed graph (a persisted-format change) acceptable?

## 2026-10-21 — Hermes / XDesign design canvas → Figma UI3 layout (Photoshop mode next)

Branch: `validation/alpha-2026-09-14`. **Uncommitted, nothing staged.** Owner: Orion done ("call it done here"); "i want to fix the ui/ui for the canvas i want to match figmas exactly. and then the same for the photoshop ui when u double click and go photoshop mode i want it to look exactly like photoshops layout". References: Figma help-center UI3 images (layout, toolbar, left sidebar, Design/Prototype panels) and Adobe's Photoshop workspace-overview image (screen recording of the local Figma/Photoshop apps isn't permitted).

Done (design canvas, `src/apps/xdesign/pencil/`):
1. `PencilStudio.tsx` re-laid out as Figma UI3: the top context bar and vertical tool rail are gone. The left side is the navigation bar (File · Agent · Assets · Tools · Variables) plus a sidebar with a file header (file name with main menu: Back to files, Rename, Present, Share, Export, Hide UI; then "Local file / Shared room / View only"), a collapsible **Pages** list (add, double-click rename, right-click rename/delete) and a **Layers** tree. Floating **bottom toolbar**: Move/Hand · Frame/Section · shapes · Pen · Text with flyouts, plus Comments, Actions (design partner) and the Dev Mode switch. Right panel: header row (avatar, undo/redo, room presence, Present ▷, blue **Share**); tabs **Design | Prototype** (Code | Lint in Dev Mode; Comments appears when opened) with a zoom % menu (zoom in/out/fit/selection/50/100/200, Rulers ⇧R, Canvas grid) and a hide-panel button. With panels hidden, floating chips keep the file name / Share / zoom reachable. Figma shortcuts: ⌘\ hide UI, ⌘+/⌘−/⌘0, ⇧0/⇧1/⇧2, ⇧R.
2. New `FigmaChrome.tsx` (Popover menu, FigmaToolbar, LayerTree, PageList). The layer tree is now Figma-ordered (frontmost first), collapsible, auto-expands to the selection, has type icons (auto-layout frames show rows/columns; components violet), hover lock/eye toggles, and double-click rename.
3. Prototype interactions moved out of the Design inspector into the Prototype tab (`SelectionProperties.tsx` no longer renders `PrototypePanel`), with a Flows section.
4. `canvasView.ts` store: rulers and the 40px grid are now **off by default** (as in Figma) and toggled from the zoom menu; `CanvasHost.ts`/`canvasGrid.ts` read them per frame (no remount).
5. `figma.css` (new, loaded after pencil.css): Figma density (11px UI, 32px layer rows, 48px header, 40px tab row, 24px menu rows, blue-filled active tool) using only the existing `--xd-*`/global tokens, so light and other themes still apply. `editorTools.ts`: tool groups in Figma's order (Move+Hand, shapes Rectangle/Line/Ellipse/Polygon/Star).
6. Tests: `PencilStudio.layout.test.tsx` updated for the Pages list and the Tools view (two assertions about where controls live). Layout + EditorChrome + grid + prototype suites 61/61; typecheck clean. Chrome screenshots checked: layout, zoom menu and shape flyout render unclipped.

Photoshop mode (owner: "Yea let's work on that photoshop"), `src/apps/xdesign/photo/`:
7. `PhotoStudio.tsx` re-laid out as Photoshop's workspace, reference: Adobe's workspace-overview image:
   - Top: a **menu bar** (Home · Edit · Image · Layer · Select · **Filter** · **View** · **Window**; undo/redo, action search, panel toggles at the right), then the **options bar** (tool icon, the tool's own fields now inline instead of in the inspector, hints), then a **document tab** reading `name @ zoom% (layer, RGB/8)` with a close button.
   - Left: a one-column **Tools panel** with Photoshop's overlapping foreground/background color chips plus swap/default, and Quick Mask.
   - Centre: the pasteboard with a floating **Contextual Task Bar** (Select subject · Adjust colors · …; with a selection: Invert · Create mask · Fill · Transform · Deselect).
   - Right **dock**: an icon strip of flyout panels (History, Navigator, Brushes, Styles, Shapes, Tool Presets) next to three stacked, tabbed, collapsible groups: Swatches/Gradients/Patterns · Properties/Adjustments/Document · Layers/Channels/Paths. The Layers panel has blend + Opacity, a Lock icon row + **Fill** (`layer.setProps {fill}`, which the engine already supports), 40px rows, and Photoshop's bottom icon row (link · fx · mask · adjustment · group · new · delete).
   - Bottom: a **status bar** with zoom, document size/ppi and messages.
   - Window menu opens any panel. Every existing control, dialog and shortcut is kept; only placement changed.
8. New `photoshop.css`, loaded after photo.css, using the `--xd-*` tokens only.
9. Tests: the photo layout/tools tests now open panels by their Photoshop names (e.g. "Document", "Tool Presets", "Swatches", "Brushes", "Styles", "History", "Channels"); the Develop entry is under Filter. Full XDesign suite 311 files / 3608 tests pass; typecheck clean. One run flaked on the timer-based Background Eraser test, which passes alone, in the photo suite and in the full rerun. Chrome check with a mocked image document: layout, History flyout and Filter menu render unclipped.

Follow-up (owner, 2026-10-22: "remove assts tools and variables because i dont believe we even have those correct me if im wrong also whenim in the photoshop view the its so extremely laggy its unusable"):
10. Lag root cause, measured: `tauri dev` builds the photocraft image engine unoptimised, so a 512px tile takes **~51ms** to render, versus **~3.2ms** with dependencies optimised (temporary `cargo test` probe, since removed). The frontend was not the cause: WebKit held 55–60fps idle/scroll/hover in the mock, and React made only 2–9 commits during a 100-move drag. Fix: `src-tauri/Cargo.toml` `[profile.dev.package."*"] opt-level = 3`, which optimises dependencies only so Orion's crate keeps fast rebuilds. `resources/distribution-license-manifest.json` `cargoManifestSha256` was refreshed (Cargo.lock unchanged; `npm run licenses:check` passes). **Needs a `tauri dev` restart; the first rebuild recompiles all dependencies.** Secondary: the desktop companion's WebGL costs a few fps and occasional 60–120ms frames.
11. Figma sidebar: Assets, Tools and Variables tabs removed (only File + Agent remain). They did work: Assets = local components + publishing shared libraries; Variables = collections/modes/bindings, still in the Design panel; Tools = Design actions/Scripts/Resources/Import video, now in the file-name main menu. Library publishing has no entry point now (`AssetsPanel.tsx` kept, unused).
12. Tests: pencil layout test updated (Tools items via Main menu). Typecheck clean; pencil 2024/2024; photo layout 135/135 run alone. The full XDesign run fails one timing test ("Background Eraser stroke when bounded preview…") about 1 in 2 times: under full parallel load its 100ms preview timer fires mid-batch (2 previews instead of 1). It passes alone and in the photo suite. Not a behavior change, but it got flakier after the bigger Photoshop layout, so it may need fake timers.

Eraser follow-up (owner: "imagine im erasing a line across the screen in the photo shop view the eraser its suttering then the erase doesnt happen till after a draw the lne then it redraws it a again. it should earase as i move my mouse around"). The dev app was already running the optimised engine (restarted 08:30). Three causes, all fixed:
13. Whole-stroke re-render. Each native feedback step re-rendered every tile the stroke had touched so far (`damage.inflate(256)` of the whole stroke), so the cost grew with stroke length. Now `BrushDraft::push`/`incremental_step` return the rectangle the newest samples changed (including the smoothing tail), and `render_with_identity` renders only that, as long as the viewport/scale is unchanged. On a 4000×3000 noisy image, measured with a temporary probe (since removed): 175ms → **7ms per update**, 6.7 → 1.3 tiles.
14. PNG encoding. Display tiles and view/selection previews now encode with `PngCompression::Fast` (`xdesign_photo_tiles.rs`, `xdesign_photo.rs` preview + view preview, `xdesign_photo_selection_preview.rs`); 28ms → 7ms per 512px photographic tile. Pixels are identical; only the zlib level changed.
15. Feedback start delay and release flicker. `NativeStrokePreview` waited 100ms before each request; now 16ms (one frame) and still coalesced while a render is in flight. On release, the stroke's live tiles were dropped before the committed image reloaded, so the erase vanished and redrew. Now `NativeStrokePreview.detach()` hands them to `heldTiles` in PhotoStudio, which keeps them over the image until `PhotoTiles` reports the new version's detail loaded (`tiles.ts` `loaded()`, `PhotoTiles` `ready`), with a 4s safety timeout, and drops them on error/refusal.
16. Tests: typecheck clean; full XDesign vitest 311/3608; photo suite stable twice. Two photo tests were updated for the new behavior (stroke tiles stay until reload; Background Eraser previews now go out per frame up to the cap). Rust: the 6 photo tests that failed under `--test-threads=4` all pass alone; they are the known parallel-load flakes. Full single-threaded `cargo test --lib xdesign_photo -- --test-threads=1`: 777 passed, 0 failed. Not yet tried by hand in the real app; it needs a `tauri dev` restart for the Rust changes.

17. Owner asked "could it be because its trying to autosave everysingle frame?" No: the stroke-preview path writes nothing to disk, and XDesign saves only when asked (`saveProjectFile`). But each preview call rebuilt a colour-managed preview `Session`: `color_views::Snapshot::install` → `restore_native` runs proof setup in a fresh engine, **~14ms per pointer step** (measured with a temporary probe, since removed; snapshot capture 0.007ms, document clone 0.08ms, `Session::new` 1.7ms). `xdesign_photo_stroke_preview` now keeps one preview engine keyed by image version + view key + History-Brush flag (`stroke_preview_engine()`), refreshes only the `DocState` each step, and clears it in `xdesign_photo_stroke_end`. Per-step native cost is now ~7ms render plus the IPC round-trip, down from ~22ms+. `cargo test --lib xdesign_photo::stroke` 95/95; full `cargo test --lib xdesign_photo -- --test-threads=1` 777/777.

Open questions: none. The floating desktop companion overlaps XDesign's right panel in screenshots (it predates this work); left as is unless the owner wants it moved.

## 2026-10-20 — Hermes / Four companions: new models, card picker, sleeve gestures, live springs

Branch: `validation/alpha-2026-09-14` (unchanged). **All uncommitted, nothing staged.** Owner asked Hermes to make these frontend changes directly.

Done:
1. Lineup is now exactly R.O.S.I.E (`rosie`, new cybernetic Rosie replaces rosie-stylized), M.X.S.H.Y (`mxshy`, Mushroom), A.N.G.3.L (`ang3l`, ANGEL v2), S.U.K.I (`suki`, Cream v2). GLBs compressed losslessly for the rig (WebP 1024 + quantize + meshopt, ~3 MB each) into `public/characters/`; manifest has sha256/bytes. The 7 retired GLBs are deleted in the working tree (recoverable from git). `characterStore` maps old ids to successors; unknown ids → rosie.
2. Settings/Control Panel picker (`CharacterPicker.tsx` + `.ot-ccard*` / `.ot-companion*` in tokens.css) uses the orion-site cards (`public/companions/cards/`) with the site's type-in reveal over the clean plate, plus one live 3D stage for the selected companion (one WebGL context). Custom .glb upload/remove kept.
3. Animations: the new bodies have no hands (oversized sleeves cover them), so Mixamo hand clips are gone for built-ins. `sleeveGestures.ts` bakes procedural clips once per model (Idle, Greeting, Talking, Point, Clap, Cheer, Huff, Surprised, Stretch, Bashful) using only shoulder/arm/elbow/spine/head/root motion; spine bends kept small because limbs hang off the rig root. Per-companion temperament in `companionProfiles.ts`. Request reactions alias onto these (`companionRig.ts`). Custom uploads keep Mixamo clips.
4. Live physics: `swingSprings.ts` (one TS port of the identical hair/sleeve solver from the three handoffs, per-asset specs) and Rosie's `RosieBodySprings` from the Rosie physics patch; drag/resize/visibility feed `dragState` so springs react and reset on jumps.
5. Tests: `companionAssets.test.ts` rewritten (real GLBs: hashes, rigs, no finger joints, every gesture bakes + deforms finitely, sleeves stay attached, springs within limits); store/modelInstance tests updated. Companion + store + rosie suites 69/69; RosieBodySprings 31/31; typecheck clean. Visual check in Chrome: all 10 gestures × 4 companions render without tearing; picker renders all four cards.

Alpha polish pass, batch 1 (2026-10-21, uncommitted). Audited every dock app + every Settings page in Chrome against a mocked Tauri IPC (screens, not native):
- Fonts: `--f-ui` / `--f-sans` were never defined, so 56 `font:` shorthands (Incubator, Skill intake, parts of Archives) were silently dropped and fell back to 16px browser default. Aliased to `--f-display` in tokens.css; also aliased the undefined `--font-ui/--font-mono/--border*/--space-1..4` used by new XDesign photo/pencil/project-file CSS onto existing canon values.
- Windows: the open cascade offset could push later windows off the right edge / under the dock (Hermes clipped). `useShell.openApp` now clamps position as well as size.
- Spotlight: duplicate "Open X" rows (app entry + its open command + "View: Open X") deduped outside `>` mode; sections group by kind (fixed duplicate React keys); per-kind icons; "Cycle Theme (Neon / Minimal / Modern)" → "Next Theme" with keywords.
- Copy: removed developer/QA text from user surfaces (XDesign start types → plain descriptions + a quiet Beta tag; Archives "auto-tags wire up next"; Command Center "pi credentials"; API Keys, MCP, Shortcuts, Agent Forge internals). About shows `version · Alpha test` from package.json and an alpha notice. Model pickers say "No AI connected" instead of "selection unavailable"; Agent Forge shows that when no models exist instead of a blank select. "Companion: Test Animation Clips" → "Preview Gestures".
- Splash particle shader used mediump in the fragment and default highp in the vertex for `uSpark`; Chromium refused to link it. Both stages now highp.
- Light theme: picker code line inks with `--t-secondary`.
- 32 files / 188 focused tests pass; typecheck clean.

Alpha polish pass, batch 2 (2026-10-21, uncommitted). Archives subpages, Orion with a project, XDesign canvas, BMW M + Minimal themes, first-run tour:
- Archives empty states unified: one sentence-case title style (no trailing periods) across Journal/Notes/Mood/Favorites/Projects/Media/Brain/Past chats, one quiet tertiary 20px icon instead of four different neon tints; Notes and Media gained icons; Notes says "No matches" when a filter hides everything.
- Media toolbar hint shortened and hidden under 940px toolbar width (it was wrapping the filter row).
- Copy no longer hard-codes "Claude" where the AI is selectable: Learn, Journal, tag cloud, Brain "Ask AI", Orion rail placeholder now uses the companion's name (`Message Orix47…`, no wrapping hint).
- XDesign inspector disclosure rows (Guides, Variables) drop the native triangle for the same right chevron as the rest; window subtitle "untitled frame" → "studio" (not handoff copy; it contradicted the open "Untitled design" tab).
- BMW M radii are deliberately tight (1.7–3.4px), not a bug. Tour looks right. Login screen not reachable in browser dev; unreviewed.
- Typecheck clean. Archives/Orion/XDesign/plugins/shell/styles: 3980 pass, 6 fail, all in XDesign photo/pencil engine tests that import no CSS and no file this pass touched (PhotoStudio smart-filter test already recorded as pre-existing; the rest are canvaskit 5s timeouts and an engine `frame` read). Owner: decide whether these block the alpha.

XDesign test failures fixed (2026-10-21, owner asked, uncommitted):
- **Real bug:** OpenPencil 0.15.1 (unchanged in 0.16.0) writes solid SVG fills via `colorToHex`, dropping alpha, so a 40% red exported as opaque `#FF0000` (affects React/prototype artwork and the SVG export command). `scripts/open-pencil-vite.mjs` now rewrites the two solid-fill sites in `svg/defs.js` + `svg/export.js` to emit `rgba()` when alpha < 1 (opaque fills stay hex; P3, gradient stops and shadows untouched) and throws if an upgrade moves those lines. Verified: translucent → `rgba(255,0,0,0.4)`, opaque → `#0000FF`.
- `prototypeSmartPaint.test.ts`: the incoming opaque rectangle now exports as a CSS `backgroundColor` (cssSolidPaint path), so there was no SVG to tween. Gave it smoothed corners so it stays on the SVG path the test covers.
- `PhotoStudio.layout.test.tsx`: Gaussian Blur radius moved into the Edit Filter dialog; test now opens it, sets Radius, applies.
- 5 canvaskit-heavy pencil tests (HitAlpha, CoverageBounds ×2, ControlsPresent textField, MaskRegionTransform) pass in 1–8s alone but hit the 5s default under suite load; each now has a 30s timeout.
- Result: 382 files / 4055 tests pass (archives, orion, xdesign, plugins, shell, styles, characters, store, rosie); typecheck clean.

Alpha polish pass, batch 3 (2026-10-21, uncommitted). Lock + first-run screens, toasts, notification center, Command Center/Hermes with seeded data, Monaco with a file open:
- Lock screen: the password `<input>` inside `.ot-auth-input` also matched `.ot-auth-field input`, so it drew a second box + magenta ring inside the field. Inner input reset; focus is now the outer border in ink only (DESIGN.md: fields get no ring); field labels, error and "Forgot password" lifted to `--t-secondary`/`--t-primary` for contrast over the red glass; error box neutral instead of magenta-on-red.
- Toasts moved from bottom-right (on top of the companion, beside the dock) to top-right under the menubar, frosted, accent stripes softened toward tertiary (error keeps magenta), enter from above. Hidden while the notification center is open (it already lists them).
- Windows: one `DOCK_CLEARANCE` (88px) in `useShell` for open/maximize/restore; windows were ending ~15px under the dock (Command Center composer covered). Now end 33px above it.
- Checked, no change: first-run setup, Hermes board, Command Center thread, Monaco/tabs/statusbar. Companion overlapping windows is by design (draggable, hideable).
- Typecheck clean; auth/shell/plugins/components/store/command/styles 60 files / 401 tests pass.

Orion editor → Cursor workbench (2026-10-21, owner: "the orion app needs polishing. the 3 tabs have a look at cursor we basically want to copy the way their frontend works exactly"; uncommitted). Reference: Cursor 0.44 theme files + docs video stills (classic editor view with agent side pane). Only Orion changed; Archives/XDesign rails keep the default `ClaudeChat` variant.
- Layout: sidebar · one editor group · agent pane. Fresh layout starts with an empty editor group (shortcut sheet: Go to File, Search in Files, Toggle Terminal, Toggle Agent, Spotlight); Preview no longer opens by default.
- Tabs (`workspaceStore`, `Workspace.tsx`): files open as tabs in one group instead of a new pane per file. Single click in the tree = italic preview tab, replaced by the next preview; double-click, editing (`pinFile` via tabsStore subscription) or an explicit open pins it. Middle-click closes; unsaved tabs show a dot that turns into × on hover, and closing one asks first (`confirmClose`). Split Editor Right button on file groups; last tab closing keeps the editor group in place (split duplicates still collapse). The tab-strip "+" is now "More actions" (⋯).
- Terminal docks under the editor area only; sidebar and agent stay full height.
- Sidebar (`OrionSidebar.tsx`, `store/sidebarStore.ts`): Explorer / Search / Source Control icon row with a change badge. ⇧⌘F reveals sidebar Search (no more Search tab), new ⇧⌘E Explorer and ⌃⇧G Source Control commands. Tree: project-name header with hover actions (new file/folder, refresh, collapse all), 22px sans rows, chevron-only folders, one quiet glyph per file family, folders start collapsed, softened git tints; old "orion · workspace" footer removed.
- Agent pane (`ClaudeChat` `variant="agent"`, `OrionClaudeRail`, `PastChats.tsx`): chat-title header with New chat + history menu; empty state puts the composer on top with Past Chats under it; composer is one box with @, inline model picker and round send/stop; user turns are bordered boxes, replies plain markdown with real list markers. Placeholder "Ask anything, @ for context". Opening line, chips, "Ready when you are." kept.
- Status bar: Cursor density, neutral items, file details only when a document is focused.
- Styles live in new `src/styles/orionWorkbench.css` (loaded last, theme tokens only); markdown moved to `components/ChatMarkdown.tsx`.
- Verified in the browser harness on Liquid and Ivory Keep: empty state, preview/pin tabs, split editor, terminal dock, sidebar Search, a chat thread. Typecheck clean; components/orion/commands/shell/store/intake/archives 95 files / 677 tests pass (7 new editor-group tests).
- Backup of pre-change Orion/workspace files: `$TMPDIR/orion-bak/` (not in git).

Orion agents + git (2026-10-21, owner: "make sure pi claude codex and hermes work inside of orion and are up to date. i like how you have the pure terminal look or a more polished look option for claude code and stuff like that in cursor … the branch stuff commit and push make sure everything actually works"; uncommitted).
- CLI check, run headless from the exact Orion argv: claude 2.1.306, codex-cli 0.163.0, pi 1.3.0 are each the latest on npm and answer; hermes v0.21.6 works but v0.22.3 is available (`hermes update`, not run: it restarts the gateway).
- Agent tabs now have Chat | Terminal views (`ClaudeCodePanel.tsx`, `store/agentChatStore.ts`, new Rust `agent_chat.rs` with `agent_chat_send/cancel`). Chat runs the CLI headless in the project and normalises Claude stream-json (with partial messages), Codex `exec --json`, Pi `--mode json` and Hermes `--format stream-json` into text + tool steps; follow-up turns resume the CLI session. Terminal is the CLI's own TUI. Codex added everywhere agents are listed (+ menu, Spotlight "View: Open Codex", Run menu).
- Agent terminals no longer pin Claude to an old model; they use each CLI's own default. Hermes gets `--in <project>`, Codex `-C <project>`.
- Models: Claude list adds Opus/Sonnet/Haiku 5.5 and Fable 5.1 (ids verified against the CLI), default `claude-opus-5-5` (TS + Rust `OPUS_MODEL`). Codex seed list = codex 0.163's listed models (gpt-5.5 and gpt-5.3-codex-spark no longer exist there). Codex 0.163 added to the reviewed versions for restricted grants after re-testing that a restricted turn can't run shell or write.
- Git (`git_ops.rs`, `ChangesPanel.tsx`, `StatusBar.tsx`), tested against real scratch repos: Push publishes a branch with no upstream (`push -u`, clear error with no remote) and is labelled Publish; new Pull (ff-only); Discard works on untracked files (was failing); new folders list their files; branch menu has "Create new branch…"; checkout uses `switch`; credential prompts can't hang the app. Commit with nothing staged offers "Stage all and commit"; ⌘↵ commits. Status-bar changes button and "Review AI Changes" open sidebar Source Control.
- Tests: tsc clean; 124 files / 732 vitest + 5 new agent-chat tests; Rust `agent_chat`, `git_tests` (2 new repo round-trips), `reviewed` pass. Browser harness: Codex chat with streamed steps, Terminal switch, Source Control, branch menu.
- Pre-existing, not from this work: `xdesign_photo::stroke` Rust tests fail under the default parallel `cargo test --lib` (23/95) but pass with `--test-threads=1` (95/95) — timing-sensitive under load.
- Known limit (fixed in the follow-up below): a Hermes profile with `terminal.cwd` set overrode `--in`.

Agent chat options + branding + launch fixes (2026-10-21, owner: "still need options in the chat view for model etc and customize the chat so we know what were in center show the claude code branding same as how the terminal kinda shows it and do the same for the other harnesses … i just care about it working properly so other people when they download can use the harnesses"; uncommitted).
- Pi crash root cause: `npm run tauri dev` puts `node_modules/.bin` dirs first on PATH, so Orion launched a stale pi 0.79.6 from `~/node_modules` (its extensions need ≥0.86). New `src-tauri/src/agent_cli.rs`: agent CLIs resolve via the user's login-shell PATH with `node_modules` dirs dropped, then Orion's fallbacks; used by chat, terminal and the Pi provider engine. Missing CLI → clear "isn't installed, run <install command>" instead of a spawn error.
- Hermes project folder: Hermes' managed-config layer pointed (per run, `HERMES_MANAGED_DIR`) at an Orion-owned `app_data/hermes-session/config.yaml` with `terminal.cwd: "."`, so `--in <project>` wins for any profile; user config is never edited; skipped if a real managed scope exists. Verified: `pwd` tool call returns the project, not ~/Studio.
- Chat view composer has Mode (Claude Edit/Plan, Codex Write/Read only), Model and Effort/Thinking/Reasoning pickers; "Default" = the CLI's own config. Lists come from each CLI (`codex debug models`, `pi --list-models`, Claude ids, Hermes `config get`) via `agent_cli_info`; choices persist per agent (`app_state` "agents.options"). Passed as `--model/--effort/--permission-mode`, `-m/-c model_reasoning_effort/-s` (Codex resume uses `-c sandbox_mode`, verified writing a file), `--model/--thinking`, `-m/--reasoning`. Values are allow-listed (no flags/spaces).
- Empty chat shows each CLI's own start-screen mark, centered, captured cell-for-cell with colors from the real TUIs (`agentMarks.ts`): Claude Code mascot + version/model/effort/path, Codex knot + `>_ OpenAI Codex (v…)`, Pi block mark, Hermes caduceus + gold name. Tab header shows a small brand mark.
- Real runs with options: Claude (haiku-5-5, plan) ok; Hermes (-m, --reasoning) ok in project dir; Pi via `claude-bridge/*` ok. Pi's `anthropic/*` provider returns "You're out of extra usage" (owner's Claude extra-usage balance) and `openai-codex` has no Pi login on this Mac; account-side, not Orion.
- Responsive (owner: "they are cuttoff they should be responsive to the size of the window they have"): agent panel is a size container; marks scale with pane width (knot/caduceus hide only under 220px), header/model facts wrap between items instead of clipping, pickers ellipsize, below 520px the Claude/Pi mark stacks above its text, below 380px the Chat/Terminal switch is icon-only. Checked at 1300/760/560px windows for all four agents.
- Follow-up (owner screenshot: long repolens path cut off; "when i try to change models or any of those settings it doesnt work"): picker menus were rendered inside the composer, whose `overflow: hidden` (added in the responsive pass) clipped them so nothing could be clicked. Menus now portal to <body> with fixed positioning (open up, or down when there's no room; clamp to the viewport). Project path is shortened to `~/…/parent/name` (full path on hover) and long facts wrap instead of clipping. Harness: picked GPT-6-Luna / low / Read only; the send carried `{model:"gpt-6-luna",effort:"low",mode:"read-only"}`; long path checked at wide/760/560 for Codex, Hermes, Claude.
- Divider drag letting go (owner: "when i click and hold the diverder line and drag it around its so easy for the cursor to let go … it should stick and move perfectly with my cursor"): reproduced only in WebKit (Tauri's macOS webview), not Chrome. WebKit fires pointerleave/pointerout with `buttons === 0` while the button is still held when the element under the cursor changes; react-resizable-panels 2.1.9 treats that as "released outside an iframe" (its #340 edge case) and ends the drag. New `src/lib/panelDragGuard.ts` (installed in `main.tsx`) swallows those boundary events only while a divider is in `drag` state and no pointerup has arrived; real releases still end it. Playwright WebKit harness (`$TMPDIR/shots/drag.mjs`): before, most drags dropped after 40–200px; after, 18/18 drags tracked to the pixel across grab offsets and heights. Also removed the "Drag to resize" tooltip that popped up over the divider. Applies to every PanelGroup (Orion workspace, Archives).
- File icons (owner: "i just want to have these icons beside the different files in orion just like in cursor"): Orion now uses the Seti file-icon theme Cursor/VS Code ship by default (MIT; notice in `src/assets/fileIcons/NOTICE.md`). `src/assets/fileIcons/{seti.woff,setiMap.json,fileIcons.css}` — map generated from Cursor.app's `theme-seti` + built-in language associations (generator: `~/.hermes/profiles/studio/cache/scratch/gen_seti.py`). `src/lib/fileIcon.tsx` resolves like VS Code (file name → longest extension → language filename patterns → default) and renders the glyph in its own color, Seti's light palette under light themes. Used in Explorer, editor tabs, Search, Source Control (status letter moved to the right edge, name keeps width before the folder path), Quick Open. Folders still chevron-only, as Seti/Cursor do.
- Tests: Rust 30 (agent_chat incl. options→flags, agent_cli PATH/version/model parsing/option sanitising, git, pi_engine); tsc clean; vitest 45 files / 295. Harness screenshots of all four empty states and menus.

Next:
- Owner review of the Orion workbench in the native app (tab drag between groups, terminal, real agent streaming).
- In-app feel check of springs while dragging the companion (only CPU-tested + static renders so far).
- Native-app pass (terminal/PTY, real providers streaming, file save) — needs `npm run tauri dev` hands-on, not reachable from the browser harness.

Open questions: none blocking.

## 2026-10-20 — Claude / XDesign Photoshop punch list implemented (incl. follow-ups)

Branch: `validation/alpha-2026-09-14` (unchanged). **Owner rescope: do not resume the Codex XDesign completion goal below.** Out of scope: multiplayer, collaboration, sharing/rooms, prototyping fidelity, stock/icon services. Goal is Photoshop tool parity from PhotoCraft. Skip acceptance docs, hash manifests, `/tmp` build copies and sub-agent swarms; use focused tests + typecheck.

Checkpoint branch `checkpoint/xdesign-2026-10-20` (`707d658`) snapshots the pre-fix dirty tree (built from a temp index; HEAD untouched). Acceptance records and `/tmp/xdesign-*` were moved to `~/.Trash/xdesign-cleanup-2026-10-20/` by the owner. **All punch-list work below is uncommitted.**

Done (Image mode, `src/apps/xdesign/photo/` + `src-tauri/src/xdesign_photo*.rs`):
1. Undo/Redo fixed (native guard now allows `edit.undo`/`edit.redo`); History tab with jump-to-state via new host command `history.select` and `state.historyRedo`.
2. Photoshop tool letters (Shift cycles groups) on `editorTools.ts`; ⌘A/⌘D/⇧⌘D/⇧⌘I/⌘J/⇧⌘J/⌘E/⇧⌘E/⇧⌘G, ⌘0/⌘1/⌘±, Space-pan. Delete clears the selection (layer delete only without one); ⌥⌫/⌘⌫ fill fg/bg; Esc no longer leaves Image mode.
3. Eyedropper tool (I) + Alt-click sampling with paint tools (1×1 `xdesign_photo_tile`, display color); Swatches section (localStorage `orion.xdesign.image-swatches.v1`).
4. Hand (H) and Zoom (Z) tools, ⌘/pinch-wheel zoom anchored at the cursor.
5. Pen tool (P, Shape/Path modes, corner + smooth anchors), Rectangle/Ellipse/Line shape tools (U), Paths tab (selection/fill/stroke/save/delete; new `state.paths`).
6. Layer menu (new/duplicate/delete, via copy/cut, group/ungroup, link, lock, arrange, merge, merge visible, flatten); lock checkboxes + lock/link badges (new `layer.locks`).
7. Select menu (all/deselect/reselect/inverse, subject, color range, focus, select and mask, expand/contract/feather/smooth/border, grow, similar, load selection).
8. Adjustable crop box (handles/move, Enter/Apply, Esc/Cancel); ⌘-drag transform corner = distort, side = skew (`edit.transform` quad).
9. Fill… (incl. Content-Aware) and Stroke… dialogs (generic `ImageCommandDialog` + `imageCommands.ts`).
10. Image menu: color mode + bit depth, all rotations/flips. 11. Auto Tone/Contrast/Color, Shadows/Highlights…, Replace Color…, Desaturate, Equalize.
12. System font picker (datalist from `xdesign_font_families`) in the text dialog and Typography panel.
13. Export dialog (PSD/PNG/JPEG+quality/WebP/TIFF/native; `xdesign_photo_export` takes `quality`); ⌘S saves back to an opened PSD/PSB, ⇧⌘S = Save As.

Verified: `tsc` clean; vitest `src/apps/xdesign/photo` + EditorChrome 956/957 (new `PhotoStudio.tools.test.tsx` 13 cases; distort case in `ImageTransformOverlay.test.tsx`; crop test updated for Apply). The 1 failure (`edits smart-filter order…` in `PhotoStudio.layout.test.tsx`) is pre-existing — fails identically on the checkpoint; Codex moved the Radius editor and didn't update the test. Native: 55 focused tests pass (new `image_undo_redo_and_history_jumps_run_through_the_host`, `pen_and_shape_tool_payloads_create_shapes_paths_and_selections`). Not run: production build, full native suite, hands-on in the running app.

Follow-up (same session), also uncommitted:
- Content-Aware Scale… (guard now allows `edit.contentAwareScale`); Transform Selection (box handles → `select.transformSelection` quad); Navigator (Image tab: thumbnail, view box, click/drag to pan, log zoom slider).
- Rotatable crop box (rotate handle, Shift snaps 15°) → new host command `image.cropRotated` (arbitrary rotation + crop in one publish; native test checks pixel placement).
- Freeform and Curvature pens (`penPath.ts`: RDP simplify + Catmull-Rom handles); Path Selection / Direct Selection (A) via `PathEditOverlay` (`path.info` → `path.set` / `path.transform` / `shape.edit`).
- Match Color… with another project image as source (host loads it as a second engine document for the command, then closes it).
- Layer thumbnails: new Tauri command `xdesign_photo_layer_thumbnails` (registered in `lib.rs`), fetched only while the Layers tab is open.
- On-canvas type (`CanvasTextEditor`): Type tool click types in place, clicking existing text edits it; font/size in the options bar.
- **Bug fix:** the engine reports pixel layers as kind `"Pixel"`, but Magic/Background Eraser and Edit → Copy/Cut pixels required `"Raster"` (test fixtures use `"Raster"`), so they were always refused/disabled. Both kinds are now accepted.

Verified: `tsc` clean; vitest `src/apps/xdesign/photo` + EditorChrome 965/966 (only the pre-existing smart-filter failure); native `xdesign_photo::tests` + history 52/52 (new: rotated crop, transform selection, match color, layer thumbnails, path editor round-trip, content-aware scale).

AVIF export (owner approved the dependency): `photocraft-codecs` now has `features = ["heif", "avif"]`; `Cargo.lock` gained 34 crates (rav1e/ravif and helpers; no existing versions changed). `npm run licenses:prepare` regenerated materials (444 notices, purely additive: 31 new notice files + manifest); three crates lacked bundled licenses and are pinned in `resources/native-license-upstreams.json` (profiling, profiling-procmacros at their release commit; simd_helpers at the later upstream commit that added its MIT LICENSE). `npm run licenses:check` passes. Export dialog offers AVIF with quality; native test encodes AVIF at two qualities.

`npm run tauri dev` fix: the app build failed with `cannot find crate photocraft_psd` because smart-filter code (`xdesign_photo_smart.rs`, `xdesign_photo_smart_sources.rs`, from the Codex sessions) uses it outside tests while `Cargo.toml` listed it only under `[dev-dependencies]`; `cargo test --lib` never caught it. Moved it to `[dependencies]` (already in `Cargo.lock` transitively, lock unchanged); `cargo build` succeeds; `licenses:prepare` changed only the manifest's Cargo.toml hash; `licenses:check` passes. Gate gap: `cargo test --lib` alone misses dev-dependency leaks — run `cargo build` before calling native work done.

XDesign dev-server fixes (WebView showed `Importing binding name 'default' cannot be resolved by star export entries`): `@open-pencil/core` is excluded from Vite pre-bundling, so its `sucrase` → `@jridgewell/*` chain was served raw and `@jridgewell/resolve-uri`'s `browser` export (UMD, no default) broke `pencil/` modules (PencilStudio, InspectPanel, codeEdits, designJsx). Added `"@open-pencil/core > sucrase"` to `optimizeDeps.include` (same pattern as expr-eval). Also `scripts/xdesign-native-react-worker.mjs` passed esbuild's `<define:import.meta>` placeholder to `addWatchFile`, making the virtual worker 500 in dev (native React export); now watches only existing files. Verified by importing all 403 non-test XDesign modules in headless Chromium against the live dev server (all ok); nativeReact tests 62/62. Gate gap: vitest inlines open-pencil under Node conditions and `vite build` uses Rollup's CJS handling, so neither catches dev-server module errors.

Drag/drop + outside paste (owner: "drag and drop into canvas doesnt work… copy paste images from anywhere like online"):
- `src/lib/fileDrop.ts`: wry reports macOS drag positions in points although Tauri types them physical; the orchestrator divided by DPR, so on the Retina display every drop hit-tested halfway toward the top-left and usually missed its zone (affects all drop zones app-wide). Now divides only off macOS, and drop events carry `point` (CSS px).
- XDesign drops: Image mode now places dropped files as embedded smart-object layers (`file.placeEmbedded`, fit) instead of adding them to the hidden design; Design (Pencil) mode places at the drop point (`pencilCanvasPoint`) instead of fixed scene (500,350).
- Paste: new `src/apps/xdesign/pasteCatcher.ts` — ⌘V keeps its default and briefly focuses an offscreen textarea so WebKit's menu Paste delivers clipboard data (images copied in a browser/other apps). Image mode: an image on the clipboard → `placeImageBlob` (temp asset via `asset_store_bytes` → `file.placeEmbedded` named "Pasted Image" → `asset_delete_file`); otherwise the internal `edit.paste`/Paste in Place as before (500 ms fallback if no paste event arrives). Internal ⌘C/⌘X now write empty text to the system clipboard so an older outside image can't shadow them. Design mode: ⌘V routes through the catcher into the existing `pastePencilData`; pasted files land at the view centre instead of (100,100).
- Native: `file.placeEmbedded/placeLinked` accept an optional `name` (layer/embedded file name); test `place_input_names_pasted_sources_from_the_request`.
- Known limit: dragging an image straight from a browser can't work — Tauri's native drop handler claims every drag (returns true) and browsers provide file promises, not paths, so the drop arrives with no files. Use Copy Image → ⌘V. Also means in-page HTML5 drags go through Tauri's handler on macOS; not investigated.
- Follow-up (owner: paste works, Finder drag still didn't): `startFileDropOrchestrator` died under React StrictMode (dev). App's mount effect ran start → cleanup → start; the second start hit the `started` guard and got a no-op, then the cancelled first start tore down the only listener — so no Finder drop reached any zone in `tauri dev` (all apps, not just XDesign; production builds don't double-run effects). Now one shared, user-counted listener removed only when the last caller releases it. Regression test `src/lib/fileDrop.test.tsx` (fails on the old code at the teardown assertion).
- Tests: pasteCatcher 2/2; photo clipboard/layout suites pass except the pre-existing smart-filter failure (⌘V tests now dispatch the paste event on the catcher); Pencil clipboard/layout + drop-zone consumers 33/33; native place 13/13; typecheck clean. Not verified by hand in the WebView.

Not in PhotoCraft: Red Eye, Content-Aware Move, Pattern Stamp, Actions, Info/Histogram, neural filters. Not run: production build, full native suite, hands-on in the app.

Next: owner hands-on pass in `npm run tauri dev`; fix what that finds.

## 2026-10-20 — Codex / Owner paused XDesign goal

Branch: `validation/alpha-2026-09-14`. **Goal PAUSED at owner's explicit request; all six areas unfinished. Changes uncommitted.** Seven numeric Smart Filter editors are integrated/verified: 192 frontend tests/7 files (56 new), 26 focused native tests (8 new), TypeScript and isolated Vite build (8,086 modules/232 files) pass. All 1,358 native tests compile; full suite unrun. Basic-filter verification passes 3,967 hashes; closeout complete. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-basic-filter.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-basic-filter.json).

Mute/unmute/toggle-mute is **staging only, not integrated/tested**, in `/tmp/xdesign-media-mute-2026-10-20/`: 11 files (10 existing, one new runtime test), agents report 66 added cases. Three GPT-6.1 Sol agents split model/FIG/controls, live mute/checkpoints and Present/native/export tests. Final tiny runtime snapshot-member-binding/pending-field promotion delta needs peer review. Fresh baseline verified all 3,967 parent hashes; all 2,351 source inputs (including vite.config.ts) and 232 production files still match it. Gate/evidence/integration helpers are prepared, not run; gate expects 23 frontend files. No mute integration/freeze/check/build/record exists.

Saved Smart Warp remains unimplemented. Bound Basic-filter audits/decision specify canonical source mesh/full H, source-required pixel Preview/Apply, stationary masks/selection, honest unwarped input and geometry/resource guards. A/C were assigned separate `/tmp/xdesign-saved-warp-2026-10-20/` staging, then interrupted on pause; inspect any partial files before reuse and coordinate API first. B is available for independent tests after resume. All three agents interrupted and all owned tool handles terminal. No commits/push/releases/package/install/production replacement, dependencies/config/schema/migrations/upstream edits, owner-data access, external sends or UI/browser/server denial bypass. Authored-original/installed/device/accessibility/service/resource acceptance remains open. Resume only on owner instruction.

## 2026-10-20 — Codex / Staged existing Blur and Sharpen Smart Filters

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents split UI/native implementation, independent tests and reviews. Root integrated, corrected one test fixture and controlled checks. Prior native checkpoints and unrelated owner/Archives work preserved.

Existing Gaussian/Box/Motion/Radial/Surface Blur, Unsharp Mask and Smart Sharpen now have captured Preview/Apply/Cancel editing. All native fields/defaults appear for empty/partial imports; staged changes and Reset retain unknown JSON, while one Apply sends the same full settings as Preview. Workspace/document/version/dimensions/layer/index/command/settings ownership, stale/busy/duplicate/late-event guards and invalid-input handling preserve the source. Malformed root JSON stays preserved/uneditable. Native selected preview admits exactly seven full-stack edits through checked sources; changed-known settings validate consistently for Preview/Apply, untouched legacy values remain. Cancel suppresses late publication/delivery; synchronous native CPU is not interrupted.

Passing **192 frontend tests/seven files (56 new), 26 native tests (eight new plus 18 retained Camera Raw/Lens/Blur Gallery), TypeScript and one isolated Vite build (8,086 modules/232 files)**. All 1,358 host tests compile; full native suite unrun. Native binary 177,595,248 bytes/SHA `796a3951d46b9d829b4d872dd3c4b05a5566964639c45c24b9eb0fd827552341`. First native 7/8 failure retained: Motion Blur fixture used unknown radius; corrected only to actual distance, preserving exact values/refusal/full-state oracles. Focused retry and final eight pass; production unchanged. Original 21 SmartFilters cases retained. Frontend receipt reused with exact unchanged input maps across only that Rust fixture correction; no unnecessary rerun.

Three existing files changed/three added. Configuration/pinned SDK/styles/all 232 repository production files unchanged; build output isolated in tmp. Source/hash verification passes before byte-preserving log prepends; all owned handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-basic-filter.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-basic-filter.json).

Next: [saved-Warp engineering contract](docs/architecture/xdesign/acceptance-artifacts/basic-filter-2026-10-20-next-saved-warp-decision.md) and adjoining frontend/native/test audits. Preserve canonical source bounds/irregular knots/full placement; the ordinary document-AABB round trip drifts under rotation/projective placement. A scoped source-space edit, stationary mask/selection behavior like stored mesh editing, truthful missing-source refusal and bounded true unwarped input need implementation/acceptance. Targeted mute, sensor RAW options and wider tools remain open; RAW's direct dependency requires separate owner authorization. All six areas plus aggregate resources/cancellation/history/recovery, original files/installed UI/browser/device/tablet/IME/font/keyboard/accessibility/live service/general export-reopen acceptance remain unfinished. Grid/canvas-first/PSD entry/themes/placements/Companion/owner data preserved. No commits/push/releases/package/install/production replacement, dependencies/config/schema/migrations/upstream edits, external sends or UI/browser/server denial bypass. No new owner question blocks independent work.

## 2026-10-20 — Codex / Banded Trim with retained selection

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents split production, independent core/host tests and reviews. Root integrated controlled checks; sparse Canvas/Crop, checked Again and unrelated owner/Archives work preserved.

Trim now scans the original composite through public 256-wide strips/256-row bands instead of a whole-canvas float image. Native corner references, premultiplied/alpha-squared thresholds, side flags and errors survive with full-document compositing context. Its resolved rectangle reuses private native geometry and sparse content/cache/mask/channel restoration, forced content deletion and Shape-only refresh. Trim retains translated selection; Smart sources/filter masks remain unchanged. One original-parameter Trim edit/journal, history/coalescing/revision/Fade/presets and Undo are preserved.

Passing **31 native tests: 11 new Trim plus all 20 retained Canvas/Crop; all 1,350 host tests compile, full suite unrun**. Includes 36 mode/depth/reference native scenes, 16 literal side flags, strict threshold counterexamples, global gradient/vector/blend and 256 boundaries, a literal 300,000×3 sparse scan without unsafe native reference, real active-job/error priority, retained selection/source state and nine new actual immutable publish/reopen/UndoRedo iterations. Real preset/coalescing/refusal/older-byte checks pass. Binary 177,373,184 bytes/SHA `0ce399b81f2a3122cf64caa4756e4377f47c84f0c3f423a2af995234ca9e1d21`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-trim.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-trim.json).

One shared adapter changed/three native files added; exact reviewed patch/original parent retained. Configuration/pinned SDK/frontend/all 232 production files unchanged. Prior 625 frontend/typecheck/build, 29 Warp and 16 Again remain historical, not rerun. Source/hash verification passes before byte-preserving log prepends; all owned handles terminal.

Next: captured Preview/Apply/Cancel for seven existing basic Blur/Sharpen Smart Filters is staging only in `/tmp/xdesign-basic-filter-2026-10-20/`, not integrated/verified. Omitted fields/defaults, unknown JSON, exact selected tuple, full-stack private replay, Reset/Cancel/busy/stale handling and native selected-preview admission need checks. [Image workflow audit](docs/architecture/xdesign/acceptance-artifacts/canvas-crop-2026-10-20-next-image-tools.md) also covers saved Smart Warp editing and sensor RAW controls; RAW's direct pinned-crate dependency awaits separate authorization. Targeted mute actions remain open. Whole-layer FX/patterns/native Shapes/actual output/cache/history/decoded/aggregate RSS/CPU/latency/cancellation/recovery and all six areas plus authored-original/installed/browser/device/tablet/IME/font/keyboard/accessibility/live-service/general export-reopen acceptance remain unfinished. Grid/canvas-first/PSD entry/themes/placements/Companion/owner data preserved. No commits/push/releases/package/install/production replacement, dependencies/config/schema/migrations/upstream edits, external sends or UI/browser/server denial bypass. Independent work continues without a new owner question.

## 2026-10-20 — Codex / Sparse Canvas Size and Crop

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents split staged production, independent tests and peer review; root added host tests/integration/evidence. Checked Again and unrelated owner/Archives work preserved.

Canvas Size/Crop now copy encoded tile intersections instead of flattening entire sparse content rectangles. Checked physical tile/i64 arithmetic preserves raw samples/defaults/hidden RGB/alpha; aligned retained tiles share Arcs. Private native geometry/Shape refresh survives sparse content/cache/mask/channel/Quick Mask/selection restoration. Crop clips only content/fill caches and clears selection; Smart source/filter masks stay unchanged with no new source reads. Background extension fills exposed bands around the old protected rectangle, retaining default holes and off-canvas content. Original caller parameters, one owner edit/history/coalescing/journal/posthooks and real preset persistence remain intact, including zero offset.

Passing **20 new native tests; all 1,339 host tests compile, full suite unrun**. Eight helper cases include 486 safe native raw-format comparisons and 54 encoded overlay checks; nine adapter cases include 180 native Canvas/Crop/Background scenes plus far literals/refusal/full state/UndoRedo; three host cases include nine actual immutable publication/reopen/UndoRedo iterations, native coalescing and real preset writes. Single first-run gate, no compiler warnings. Binary 177,180,400 bytes/SHA `2129cdca0561f51f477190addccee14ca33e0ca91a1ddfa32e20e40009605fdf`. Only allocated all-default tiles are canonicalized for native comparisons; actual compacted tile footprint governs history bytes.

One routing file changed/five native files added; exact three-line subtraction reconstructs baseline. Configuration, pinned SDK, frontend and all 232 production files unchanged. Prior 625 frontend/typecheck/isolated build, 29 Warp and 16 Again checks retained without rerun. Source/hash verifier passes before log prepends; all owned handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-canvas-crop.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-canvas-crop.json).

Next: Trim staging only in `/tmp/xdesign-trim-2026-10-20/`; not integrated/verified. [Trim audit](docs/architecture/xdesign/acceptance-artifacts/canvas-crop-2026-10-20-next-trim.md) specifies narrow public compositor bands, exact native threshold/side flags and retained translated selection. [Media audit](docs/architecture/xdesign/acceptance-artifacts/canvas-crop-2026-10-20-next-media.md) supports targeted mute/unmute/toggle mute with native FIG transport and reversible live mute state; implementation remains open. Actual output/FX/tile/cache/history/decoded/aggregate RSS/CPU/latency/cancellation/recovery remain unbounded by this checkpoint. All six areas plus authored-original/installed/browser/autoplay/device/tablet/IME/font/keyboard/accessibility/live-service/general export-reopen acceptance remain unfinished. Grid/canvas-first/PSD entry/themes/placements/Companion/owner data preserved. No commits/push/releases/package/install/production replacement, dependencies/config/schema/migrations/upstream edits, external sends or UI/browser/server denial bypass. No new owner question blocks independent work.

## 2026-10-20 — Codex / Checked Transform Again and Again Copy

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents staged implementation, independent tests and peer review. Gray Warp and unrelated owner/Archives work preserved.

Both Again commands now privately replay the actual native transform recipe with checked, ordered Smart Object source decisions. Current-bounds quadrilaterals, matrix reuse, nested copies, source/PSD retention, native journal/revision/history/target/Fade and preset semantics are preserved. Native Copy geometry failure retains its duplicate/Undo side effects; checked preparation refusals and panics publish nothing. Byte-budget history reconstructs native record/trim/purge against fresh pixels, handling external source growth and shrinkage while retaining the original source-bearing Undo Arc.

Passing **16 new focused native tests; all 1,319 host tests compile, full suite unrun**. Includes format/depth/literal geometry, nested source order/pin lifetime, unsafe/oversize/growing source refusal, history limits/prior redo and four byte-budget cases with an independent native fallback counterexample. Five host tests include 12 actual immutable publication/reopen/UndoRedo iterations after linked-source deletion and real preset persistence. Binary 176,746,240 bytes/SHA `7b84abdf51c91a5a300f1cfee9afb4f8ca2d9656784a1305d73cab1dbc6722ea`, warning-free. One initial test-only compiler mismatch is retained; exact borrow correction leaves production and all assertions unchanged.

One routing file changed/three native files added; original routing reconstructed after subtracting three lines. Configuration, pinned SDK, frontend and all 232 production files unchanged. Prior 625 frontend/typecheck/isolated build and 29 Warp tests remain historical, not rerun. Source/hash verification passes before these byte-preserving log prepends; all owned handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-again.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-again.json).

Next: sparse Canvas Size/Crop is staging only in `/tmp/xdesign-canvas-crop-2026-10-20/`, not integrated or verified. Tile-wise encoded translation/cropping must preserve native Background extension, geometry, masks/channels/selection, history and Shape-only refresh. Native transform/resource/aggregate history/RSS/CPU/latency work remains open. All six areas and authored-original/installed/browser/autoplay/device/tablet/IME/font/keyboard/accessibility/live-service/general export-reopen acceptance remain unfinished. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No commits/push/releases/package/install/production replacement, dependencies/config/schema/migrations/upstream edits, owner asset/database access, external sends or UI/browser/server denial bypass. No new owner question blocks independent work.

## 2026-10-20 — Codex / Sparse gray Warp and selection-aware Apply

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents split staged implementation, independent tests and peer review. Targeted-video checkpoint and unrelated owner/Archives work preserved.

Warp no longer fills the entire empty source/destination union for gray masks. Source staging and output flattening use bounded1,024pixel rows, retaining native public mesh/interpolation/fold/default/sample/alpha behavior. Both Apply commands preserve original bounds/parameters, native validation/locks/Background/group routing, direct selected raster split/composite, linked layer/allSmart filter masks and bilinear selection. Native geometry runs privately; mask/source/view restoration precedes checkedSmartrefresh and existing owner history/journal/preset commit.

Passing **29 focused native tests,14new; all1,303hosttests compile, full suite unrun**. Includes252exact safe mesh comparisons,27far literal and27empty scenes,54selected-raster/36Smart-group native scenes, late refusal/panic/pin/preset/history checks and12new actual immutable publish/reopen/UndoRedo iterations after linkedsource deletion; retained15Warp cases also pass. Final binary 176,079,152bytes/SHA `88368efe24fdadb33eaa14750ec66d22810a07864d91174998d9e6f01ce9ccbf`, warning-free. Two28/29failures retain a view-fixture mismatch: activation only truncates visibility vectors; real visibility commands now initialize expected arrays. Exact fullview/assertions/tolerances retained; isolatedhostcase and final29pass on identical frozen inputs/binary. Production unchanged during retries.

One existingfile changed/four nativefiles added. Configuration/pinnedSDK/frontend/all232production files unchanged; previous625frontend/typecheck/isolatedbuild evidence retained without rerun. Full source/hash verification passes before log prepends; all owned gatehandles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-gray-warp.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-gray-warp.json).

Next: [read-only audit](docs/architecture/xdesign/acceptance-artifacts/gray-warp-2026-10-20-next-audit.md) for checked Transform Again/AgainCopy (native failure/revision/duplicate/journal semantics) and sparse Canvas Size/Crop (encoded tile translation/cropping, Background extension, native Shape-only refresh). Again implementation/core/host tests are staging only in `/tmp/xdesign-again-2026-10-20/` with A/B/C; neither next slice is integrated or verified. Empty-gap fix does not bound native source/mesh/destination/coordinates/CPU/RSS/history aggregates. All six areas and authored-original/installed/browser/autoplay/device/tablet/IME/font/keyboard/accessibility/live-service/general export-reopen acceptance remain open. Grid/canvas-first/PSD entry/themes/placements/Companion and ownerdata preserved. No commits/push/releases/package/install/production replacement, dependencies/config/schema/migrations/upstream edits, ownerasset/database access, external sends or UI/browser/server denial bypass. No new owner question blocks independent work.

## 2026-10-20 — Codex / Targeted prototype video controls and native FIG instance actions

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents split authoring/model, runtime, export and peer review. Previous native checkpoint and unrelated owner/Archives bytes preserved; pause/resume revalidated the current source state before checks.

Added explicit video Play/Pause/Toggle in prototype controls, Present, portable/native React, sequences/conditions and held/drag restoration. Mounted occurrence/source-generation ownership, prompt play rejection, cancellation, current screen/overlay and stable component/variant targets preserve sibling media, time/source/poster, scroll, route and source history. Media-only actions avoid workers/route preparation. Native FIG actual bytes reopen without plugin fallback; omitted component children use owner-instance symbol overrides with exact paths, distinct destination GUIDs and preserved foreign overrides/interaction IDs. Ambiguous peer/nested native targets diagnose. Private variant graph context is now separate from original source GUID lookup; authored unresolved flags remain.

Passing **625 tests/22 files (73 added, no removed), TypeScript and one isolated production build**; core280/runtime163/export182. Existing React test and bundler warnings retained. Initial core failures, unused-argument compiler failure and later private-graph/nested-fixture failures are retained alongside exact corrections; no tolerance or valid-target oracle weakened. Fifteen existing files changed/two test files added; configuration/pinned SDK/native binary and all232 repository production files unchanged. Native73-case checkpoint remains historical, not rerun. Final source/receipt/hash verification passes before these byte-preserving log prepends. All owned gate handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-media.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-media.json).

Next: staged gray Warp helper/tests in `/tmp/xdesign-gray-warp-2026-10-20/`; selection-aware apply adapter staging continues, NOT integrated/verified. Helper removes redundant empty source/destination-gap fill with bounded row staging/flattening; native source/mesh/destination/CPU/aggregate memory risks remain. Mute/seek/rate/default-target semantics, erased template provenance, broader six-area fidelity/resource/history/crash and authored-original/installed/browser/autoplay/device/tablet/IME/font/keyboard/accessibility/live-service/general export-reopen acceptance remain open. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No commits/push/releases/package/install/production replacement, dependencies/config/schema/migrations/upstream edits, external sends or UI/browser/server denial bypass. No new owner question blocks independent work.

## 2026-10-20 — Codex / Checked rotation, transform presets and nested Straighten

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Full six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents split rotation/admission, preset implementation, independent tests and review; root integrated raw/endpoint Straighten and host acceptance. Warp checkpoint and unrelated owner/Archives work preserved.

Arbitrary rotation now checks every nested Smart source in native order, inherits actual Background tool color, and preserves native geometry/cache fallback/metadata/history/journal/context/presets. All five rotation/flip presets preserve active/group targeting, nearest computed transform, ignored outer fields, one Free Transform edit and BOTH inner/outer journals. Raw-ruler Straighten routes nested rotation/transform through checked replay and refreshes Smart filters BEFORE crop while retaining native compound history/revision/failure boundaries. Endpoint Straighten keeps one owner edit and original recipe; private tools/background and success-only owner preset persistence fixed. Shared preview/apply rotation admission uses native f32 angle and resolved size, preserving SDK errors and no-ops.

Passing **73 distinct native tests across six focused scopes, 31 new cases; all1,289hosttests compile, full suite not executed**. Rotation16, presets10, admission13, existing endpoint Straighten7, retained Warp15 and Free Transform12. Includes36literal right-angle and36nonright format/depth/interpolation scenes,15preset literal/mask scenes,24raw-ruler scenes,6endpoint scenes and35actual immutable publication/reopen iterations (30root+5preset-owner). Native full state, source/PSD metadata, pin retirement, colored Background, lens refresh-before-crop counterexample, real MemBackend persistence and cached redo after source deletion pass. Seven terminal receipts retain one14/16failed test run: expected endpoint recipe coordinates normalized to floats; invalid CameraRaw parameters skip that filter and render fresh pixels. Only core/host tests changed; no production/tolerance weakening. Selected-group coverage removes the unused fixture-field warning. Final binary175,644,016bytes/SHA `e511598a474d9f8a3fb4fd4e1fdd296be500248a49af763a5ccd95dc1336ebd4`, all final logs warning-free.

Four existing source/test files changed, six added; subtracting nine replay registration/routing lines reconstructs baseline. Final verifier passes **3,681 hashes before logs**. Frontend/configuration/pinned SDK and all232 production files unchanged; no frontend tests/build repeated. All owned native/evidence gate handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-rotation.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-rotation.json), SHA `1f2aab969964776ff559d9fe09464b3e4fad702c418a4f1e297cb785c64f4201`.

Next work already staged, NOT integrated/verified: targeted prototype video Play/Pause/Toggle in `/tmp/xdesign-media-2026-10-20`; three agents own model/FIG/controls, occurrence-scoped runtime, and stable export targets/route guards. Seed379file hashes are in [stage baseline](docs/architecture/xdesign/acceptance-artifacts/media-2026-10-20-stage-baseline.json). Preserve current native checkpoint with a fresh baseline before copying staged diffs; run focused frontend/FIG/generated-module tests, typecheck and isolated build. [Next audit](docs/architecture/xdesign/acceptance-artifacts/rotation-2026-10-20-next-audit.md) also specifies the narrow redundant Warp gray union gap fix and exact selection integration seam. Dense source/destination/Background buffers, coordinate arithmetic, decoded/cache/history/RSS/CPU/latency, Again transforms, sparse Canvas/Crop, banded Trim and wider Smart Filters remain. All six areas plus authored-original/installed/device/IME/font/keyboard/accessibility/live-service/general export-reopen/resource acceptance unfinished. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No commits/push/releases/package/install/production replacement, dependency/config/schema/migration/upstream changes, external sends or UI/browser/server denial bypass. Generated fixtures only; no new owner question blocks independent work.

## 2026-10-20 — Codex / Checked Warp apply and stored mesh edits

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Full six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents split production, stored meshes, independent tests and review alongside root. Parent Stack Mode checkpoint and unrelated owner/Archives work preserved.

Both Warp apply commands and all five stored mesh commands now replay checked Smart Object source decisions while preserving native geometry, cache fallback, metadata, context, history, journal and success-only preset persistence. Apply retains warped-cache fallback for unavailable/corrupt source; stored mesh edits commit on missing source and refuse corrupt source. Inline geometry requests retain native no-source/no-document-edit behavior. Encoded pins retire sequentially before owner publication; preparation refusal cannot partially publish the owner document.

Passing **41 distinct focused native tests: 15 new Warp, 14 retained Stack Mode, 12 retained Free Transform**. All 1,258 host tests compile; full native suite not executed. New tests include 24 actual format/depth Apply scenes, 15 stored-command/depth scenes and 21 immutable publication/reopen/UndoRedo scenes, literal pixels/knots and complete native state/context comparisons. Four terminal receipts retain one failed test run (13/15): corrected only an inactive-target selection-dependent empty default-bounds fixture and an equidistant Remove split fixture (point moved off the axis tie); no production/assertion weakening. Final scopes share binary174,653,280bytes/SHA `3df3622c4c1eabdd35536238979271e119a2561cdcf75ce23467b651ef144b81`, no warnings.

One routing file changed, four native implementation/test files added; exact routing subtraction reconstructs baseline. Final verifier passes **3,670 hashes before logs**. Frontend/configuration/pinned SDK and all232 production files unchanged; no frontend build/tests repeated. All owned gate handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-warp.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-warp.json), SHA `1acfcc75c4de4cc9af42b15871947f510ee667012358a166518e730c138b23b7`.

Next: shared Warp/rotation geometry admission and bounded sparse kernels; nested arbitrary rotation/straighten (refresh before crop), transform presets, sparse Canvas Size/Crop, banded Trim and targeted prototype media actions. [Follow-up audit](docs/architecture/xdesign/acceptance-artifacts/warp-2026-10-20-next-audit.md). Current encoded/filter guards do not bound decoded frames, aggregate geometry/cache/history/RSS/CPU/latency; wider Smart Filter coverage remains open. All six areas plus authored-original/installed/device/tablet/IME/font/keyboard/accessibility/live-service/multiaccount/general export-reopen/resource acceptance remain unfinished. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No commits, pushes, releases, package/install/production replacement, dependencies/config/schema/migrations/upstream changes, external sends or UI/browser/server denial bypass. Generated fixtures only; no new owner question blocks independent work.

## 2026-10-20 — Codex / Checked Smart Object Stack Modes

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Full six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents implemented, independently tested and peer-reviewed alongside root. Resume matched the Open link checkpoint; unrelated owner/Archives work preserved.

All 12 existing Stack Mode commands now resolve one checked encoded source decision, decode in the requested statistic/composite mode before running-filter admission and render from a temporary Embedded clone. Missing source still commits mode with the exact old/absent cache; corrupt decoding refuses before admission. Original source/PSD/global metadata, explicit inactive targets versus active-Smart enablement, native error priority, context/posthooks/slices, one coalesced owner history edit, first label, journal, success-only preset flush and older Fade remain. Encoded pins retire before owner commit; preparation refusal/panic cannot publish partial state.

Passing: **70 native tests/three scopes, 14 new cases; all 1,243 host tests compile, full suite not executed.** Includes 108 actual pcraft/PSD/PSB mode/depth scenes, independent literal/statistical full-cache RGBA, group frame semantics, exact native document/history/context, actual immutable publication/reopen/UndoRedo, source authority/lifetime, sparse cap/growth, missing/corrupt/unsupported ordering, four views and real pending preset storage. Four terminal receipts retain one corrected compiler failure: SDK Rust 2024 let-chain syntax replaced by equivalent Rust 2021 nested conditions; no assertion changes. Authoritative scopes share binary173,957,744bytes/SHA `43b4288eff080deb5240334f14409fd738105197240ac66fb51fa72a1aab7ec5`, with no compiler warnings.

One existing routing file changed; three native source/test files added. Removing the intended three routing/declaration lines reconstructs the exact baseline. Final verifier passes **3,666 hashes before logs**; frontend/configuration/pinned SDK and all232 production files unchanged, so no frontend build/tests repeated. All owned handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-stack-mode.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-stack-mode.json), SHA `8c1c05fa05e1b70aa7cc958f54c58a712eeb598b60b47178c69484df5ff20c86`.

Next: checked Warp apply versus stored mesh edits, arbitrary rotation/straighten's refresh-before-crop boundary, sparse Canvas Size/Crop and banded Trim; targeted prototype media actions remain pending. Unsupported running Smart Filters are still refused and wider coverage remains open. Native stack decoding retains full contributor frames; encoded/metadata caps do not bound decoded/cache/history/RSS/CPU/latency. [Read-only resource audit](docs/architecture/xdesign/acceptance-artifacts/stack-mode-2026-10-20-resource-audit.md) records fixed-canvas/color-context requirements before faithful streaming. All six broader areas and authored-original/installed IPC/WebKit/native-dialog/device/tablet/IME/font/keyboard/accessibility/live-service/multiaccount/general export-reopen/resource acceptance remain open. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No dependency/config/token/schema/migration/upstream changes, commits/push/releases/deployment/package/install/production replacement, external sends or denial bypass. Generated fixtures only; no new owner question blocks independent work.

## 2026-10-20 — Codex / Prototype Open link across FIG, Present and React export

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Full six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents implemented, independently tested and reviewed alongside root. Resume matched the transform/resize checkpoint; unrelated owner/Archives work preserved.

Added distinct Open link authoring with exact URLs and optional new-tab flags, native Undo/Redo, route-option cleanup and accurate held/drag help. Actual native FIG URL fields round-trip true/false/absent through sequences/conditions without destination GUIDs or plugin fallback. Duplicate, snapshot/HTML paste, serialized reopening, portable React and native offline archive preserve links without introducing reachable screens. Dynamic CMS/linkParam data remains diagnosed unsupported.

Present and both React hosts accept explicit URL callbacks; refusal/rejection stops later actions. Direct/URL-only held and drag actions avoid route preparation and media/scroll resets; mixed actions lazily start reversible local changes. Pending cancellation/new activation prevents later links and stale errors without rewinding unrelated scroll or media. Web defaults detach popup openers before address assignment and report blocks; desktop Present uses the existing OS opener, keeping Orion's WebView. Valid HTTP(S)/mailto/tel bytes remain exact. Missing new-tab flags default true only as playback host policy; native metadata absence is preserved. OS tab placement and actual browser activation remain unverified.

Passing: **552 tests/20 files, 64 new cases; TypeScript and production build, 8,085 modules.** Includes actual emitted React execution, offline native WASM worker, strict typed React-only archive, actual FIG native-field/plugin-free reopening, literal scroll progress, independent host request/media/route/Undo assertions. Nine terminal receipts retain three failed attempts: opaque-schema test typing, unsupported Vitest CLI flag and native-bookkeeping/click-only-accessor test assumptions. Corrections preserved full graph and behavior assertions; production source stayed frozen. Retained React test warnings and bundler warnings are recorded.

Fifteen changed/two added frontend source/test files; zero foreign source changes. Final verifier passes **3,681 hashes before logs**. All 232 production files rebuilt; configuration, pinned native code and previous native binary unchanged. Native execution evidence is historical; no native suite repeated. All owned handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-20-prototype-url.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-prototype-url.json), SHA `e0832c5ab142146e0546cd3b2521adab6fe5922e5f97a587a177e2d6844ec8a6`.

Next: checked 12 Stack Mode commands, then two Warp apply IDs versus five stored mesh edits, and rotation/straighten's native refresh-before-crop boundary. Targeted prototype Play/Pause/Toggle remains missing. [Read-only audit](docs/architecture/xdesign/acceptance-artifacts/prototype-url-2026-10-20-next-audit.md) preserves exact semantics and test plans. Sparse Canvas Size/Crop translation and banded Trim remain pending. All six broader areas and authored-original/installed IPC/WebKit/native-dialog/device/tablet/IME/font/keyboard/accessibility/live-service/multiaccount/general export-reopen/resource acceptance remain open. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No dependency/lock/catalog/attribution/token/config/schema/migration/upstream changes, commits/push/releases/deployment/package/install/production replacement, external sends or computer-use denial bypass. Generated fixtures and stubbed URL handlers only; no new token gap or owner question blocks independent work.

## 2026-10-20 — Codex / Checked Free Transform and streamed Image Size

Branch: `validation/alpha-2026-09-14`. **Verified progress; uncommitted. Full six-area goal ACTIVE and unfinished; no area complete.** Three owner-requested GPT-6.1 Sol agents implemented, independently tested and reviewed alongside root. Resume matched the prior copy/placement checkpoint; unrelated owner/Archives work preserved.

Checked `edit.transform` now covers actual Smart targets and nested groups, including repeated linked paths and embedded siblings. Native geometry/coverage validation runs privately with undecodable embedded placeholders; original sources then refresh through sequential checked decisions with no accumulated encoded pins. Missing/corrupt sources keep the native transformed cache. Lone mask/alpha/Quick Mask and source-free targets retain native behavior. Source/PSD/global metadata, context, history/coalescing, presets/posthooks and earlier Fade remain.

`image.imageSize` now prepares raster/mask/fill-cache/channel/selection pixels separately while native code owns dimensions/DPI, effects, text/vector/Smart geometry, guides/marks and sharp text/shape refresh. Completed pixels and original source references are restored before checked Smart refresh and one authoritative history edit. Generalized streamed resampling supports anisotropic scales, all five filters, nonzero mask defaults and native raw-channel/alpha arithmetic. Pure guards cover native tap endpoints, full raster tiles and oversized Preserve Details sharpening workspaces. This does not establish aggregate memory/CPU/latency bounds or cover other geometry routes.

Passing: **52 native tests/five scopes, 32 new cases; all 1,229 host tests compile, full suite not executed.** Includes 24 affine and 24 Image Size source/format/depth cases, 42 rich resize scenes, 1,080 exact resampler comparisons plus retained 180 placement comparisons, literal pixels/projective corners/tiny alpha, late refusal/source pin lifetime, native full state and actual immutable-host reopening. Nine terminal gate receipts retain three corrected test-only failures (constructor/types and incorrect oracle assumptions); production stayed frozen during retries. Final binary 173,320,848 bytes/SHA `af358decfb34139515d113878597a26d0ca8b0431f95b809edc8ed7ab8183a0e`.

Four changed/five added native source/test files; zero foreign changes. Main host/linked dispatcher/placement module reconstruct their resume versions after intended additions. Final verifier passes **3,669 hashes before logs**; frontend/configuration/pinned SDK and all 232 production files unchanged, so no frontend rebuild/tests repeated. All owned handles terminal. Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-20-transform-resize.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-transform-resize.json), SHA `d856cb2c5185b106caac610ee25a2e2a208e658f3f609d4a3827c8cea941226f`; [verification](docs/architecture/xdesign/acceptance-artifacts/transform-resize-2026-10-20-verification.json), SHA `161cb370b0f72ba7531cc6001e0aa9a2278c4078b40abab1a902f91a55035638`.

Next concrete feature: prototype Open link import/authoring/playback/export (native FIG URL/new-tab exists, current host rejects it). Next native slices: checked Warp apply versus stored mesh edits, arbitrary rotation/straighten nested dispatch and stack modes; streamed sparse Canvas Size/Crop translation and Trim compositing. All six broader areas and authored-original/installed IPC/WebKit/native-dialog/device/tablet/IME/font/keyboard/accessibility/live-service/multiaccount/general export-reopen/resource acceptance remain open. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No dependency/lock/catalog/attribution/token/config/schema/migration/upstream change, commits/pushes/releases/deployment/package/install/production replacement/external sends or computer-use denial bypass. Generated fixtures only; no new token gap or owner question blocks independent work.

## 2026-10-20 — Codex / Smart Object copy, placement and streamed resize

Branch: `validation/alpha-2026-09-14`. **Verified progress; Uncommitted. Full six-area goal ACTIVE and unfinished; no area complete.** Owner reactivated the goal. Previous turn was verified progress; current source/configuration/pinned-native/production inputs and the parent supplement matched the October 19 checkpoint before edits. Three GPT-6.1 Sol agents implemented, tested and peer-reviewed alongside root. Unrelated owner/Archives work preserved.

Added checked New Smart Object via Copy with one raw source decision, no rendering/filter admission, missing-Linked cached fallback, untouched original and copy-only native PSD detachment. Added actual Place Embedded/Linked host admission and Image-menu file picker/fit/scale/center controls. Current project/image/placement/source/version/layer and busy/transition/capability guards reject stale picker results and submission; cancellation/retry remain usable. Placement reads/imports once, checks source/result geometry after decode and before flatten/resize, then commits through native context/posthooks/presets/journal/coalesced history.

Review found native tiny-scale bicubic can request roughly 25.6 GB of padded sampling data. Placement now switches to streamed separable Keys sampling for oversized native intermediates, retaining complete normalization, raw channels, accumulation order and alpha behavior. Valid tiny scales and automatic fit below `1e-4` remain supported. No unsafe native allocation was attempted. The helper does not cover other resize/transform routes or prove aggregate memory/latency bounds.

Passing: **132 native tests/two scopes, 24 new native cases; 147 frontend tests/two files, 14 new cases; all 1,197 host tests compile, full native suite not executed.** TypeScript/production build passes, **8,085 modules**, one build with nonfatal bundler warnings. Independent literal pixels/bytes, 24 copy plus 24 placement format/depth combinations, 180 exact safe-native/streamed surface comparisons, tiny F32 alpha, actual unclamped auto-fit, original identity, native state/history/context/preset and immutable reopening pass. Five terminal receipts retain one compiler diagnostic (private SDK alpha module); the exact local arithmetic correction touched only the resampling file, so passing frontend inputs stayed identical and were not rerun. Final native binary 172,409,024 bytes/SHA `328765f8b4ba7aded527227793e8fd0cabd6388ef81e5c264c05dcbcf584bea2`.

Five changed/seven added source/test files, zero foreign changes. Main host/linked dispatcher reconstruct resume baselines after intended additions. Final preservation/evidence verification passes **3,652 hashes before logs**; all owned handles terminal. Production's 232 files were rebuilt for the UI; they are not asserted unchanged from October 19. Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-20-copy-place.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-20-copy-place.json), SHA `c649b0832ed804b3452b42625d7e361be5a0cda1c4b65ac861b6313dadb814f6`; [verification](docs/architecture/xdesign/acceptance-artifacts/copy-place-2026-10-20-verification.json), SHA `dd3f885f6c137ff7ae5a2173aa93c29339d3def1ef5200cef60a4029acc0498f`.

Next: checked single-Smart Free Transform retaining native failed-refresh cache fallback, then audit remaining source-reading and resize paths. All six wider areas and authored-original/installed IPC/WebKit/native-dialog/device/tablet/IME/font/keyboard/accessibility/live-service/multiaccount/export-reopen/resource acceptance remain open. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No dependency/lock/catalog/attribution/token/config/schema/migration/registration/upstream change, commits/pushes/releases/deployment/package/install/production replacement/external sends or computer-use denial bypass. Generated fixtures only; no new token gap or owner question blocks independent work.

## 2026-10-19 — Codex / Bounded file output and prepared linked conversion

Branch: `validation/alpha-2026-09-14`. **Verified progress; Uncommitted. Full six-area XDesign objective unfinished, no area complete.** Continued at the owner's request using three GPT-6.1 Sol agents. The goal controller still reports the earlier paused status; no controller resume/completion is claimed. Preserved the newer unrelated Archives work: 29 changed and 25 added owner source files relative to the historical XDesign parent.

Exact Export Contents now resolves raw checked source bytes once and uses public native atomic output, preserving filename/count, unknown/disabled filters and invalid/empty encoded contents without rendering or history edits. Native enablement, context/slice posthooks, preset flush, journal, coalescing and older Fade remain. Convert to Linked resolves destination metadata without reading the output, renders with destination basename/intended bytes and guards exact Linked/metadata invariants BEFORE publishing. It detaches only psd_raw/SoLd/PlLd/SoLE. Later image-document save failures explicitly report that the external file was saved; atomic rename is not a file+document transaction.

Passing: **87 distinct native tests/six scopes; 18 new cases, all 1,173 host tests compile, full native suite not executed.** Seven terminal receipts retain one corrected test-only diagnostic: shared native filename-insensitive decoded cache warmed the original basename counterexample. Fresh-byte/cold-cache and explicit warm-cache parity now both pass; four redundant imports removed. Final scopes have no compiler warnings. Non-neutral literal full-frame pixels across 24 format/depth/source combinations, raw bytes, native state/history/posthooks/presets, metadata authority, source growth/refusals, actual/injected atomic failure cleanup, symlinks, immutable reopen and honest post-output save failure pass. Final binary171,483,952bytes/SHA `3f07fb1b284caa5338102d39e9a8c0cc864eac84e1fd169621aac4822666330c`.

Both verifiers pass **3,649 current hashes before logs**, with an eight-file post-record supplement binding their actual terminal results. Five changed/one added source/test files; zero foreign changes. Main-host publication/rollback/reply and metadata facades reconstruct their resume baselines after removing intended additions. Fresh coverage2,304source/script+48configuration+1,041pinned native+232production files; current production files unchanged from October19 resume. No frontend rebuild/tests rerun for native-only work; October15 whole-app evidence is historical after Archives changes. All owned handles terminal.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-19-file-output.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-19-file-output.json), SHA `aff66be07e4d5b6d479862c195e6590c2d343605b43912b49b3a71d6fd6718ee`; [supplement](docs/architecture/xdesign/acceptance-artifacts/file-output-2026-10-19-post-record-verification.json), SHA `6ccc9d40aca990d0d4e5261d82606383f4cd47e7873b4b59e3f91a620d3a2cbf`. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No dependencies/locks/catalog/attribution/tokens/config/schema/migrations/registrations/upstream change, commits/pushes/releases/deployment/package/install/production replacement/external sends or denial bypass. Generated temporary fixtures only.

Next: bounded New Smart Object via Copy (raw present/missing-source semantics, no filter admission); single-Smart Free Transform with native failed-refresh transformed-cache fallback; then expose native Place Embedded/Linked with checked loading. All six broader areas and authored-original/installed IPC/WebKit/device/font/IME/keyboard/a11y/live-service/multiaccount/export-reopen/resource acceptance remain unfinished. Encoded/canvas/cache limits do not bound aggregate decoded/transient/history/RSS or blocking I/O races. No new design-token gap or owner question blocks independent work.

## 2026-10-19 — Archives Downloads / practical closeout, full-parity target cut

Branch: `validation/alpha-2026-09-14`. **Practical construction scope complete; uncommitted.** Owner explicitly cut exhaustive Stacher parity to finish this secondary feature cheaply: thumbnails, richer library, queue/lifecycle, playback/extras, search/organization, large-file/failure recovery and integration. Scheduling/subscriptions, reusable/pre-download destination systems, acquisition-time unembedded sidecar retention and extra advanced combinations are deferred, **not active backlog**. Do not resume old “next approved backlog” entries below. Older independent XDesign objectives are untouched.

Added bounded native public-HTTPS raster previews (validated/pinned DNS; no redirects/proxy/cookies/WebView remote URL;6s/256KiB/dimension bounds,16entries/30min), local persisted posters for actual embedded audio covers, completed-item/player library title/favorite/source controls, Video/Audio/Favorites + saved-title/tag/filename filtering, actual media-element caption selection and explicit inspected chapter seeking without autoplay. Rename/favorite persist before state mutation; failed writes stay honest. Read-only reviews caught/fixed rejected-Stop import-tracking loss and stale queued-ready publication errors, then found no additional concrete scoped defects. Audio-poster fixture caught FFmpeg dropping art even with `-ss 0`; audio artwork extraction now emits no seek. Existing resource/recovery/original/consent protections remain.

Passing: **103 frontend/125 ordinary native/259 bridge tests**, typecheck, frontend production build, license-materials413native+8archives/diff. Updated actual installed embedding fixture passes, including320px MJPEG posters for all3clipped MP3/M4A/FLAC outputs and unchanged sources. Five blocked-IPC/nonpersistent background WK renders cover source raster preview, library/player, Liquid/Ivory/420px with no horizontal overflow. First build hit160s harness timeout; owner's requested single retry passed (existing chunk/mixed-import warnings only). Evidence `~/.local/share/orion-proof/downloads-20261005-owner-feedback/p2-closeout-01/`; [authoritative closeout](docs/architecture/archives-downloads-closeout.md).

Remaining: normal updated full-app startup/schema39/real-source/native dialog/audio/caption/queue/large-file/fault owner acceptance; these are delivery/verification boundaries, not feature expansion. Real-cookie tests require separate consent. Schema39 bytes unchanged/frozen; last owner-profile check found39 absent, private full1–39 startup passed previously. This closeout did not read/change owner DB/media or force-launch/activate app. Next normal updated native launch applies39; frontend refresh cannot upgrade an old installed native binary. No new migration/dependency/engine update, installed-app replacement, commit/push/package/release. Specific authorization is still required for those release actions. No new design-token gap.

## 2026-10-19 — Archives Downloads / saved-file sidecars and caption search

Branch: `validation/alpha-2026-09-14`. **Uncommitted; whole-tool parity remains unfinished.** Continued the approved rebuild after SponsorBlock, preserving unrelated dirty work and the closed owner-confirmed Marathon recovery. Added explicit saved-file inspection in Downloads/Media, actual supported-track VTT/SRT and chapter/metadata JSON exports through native Save authority, bounded selected-track local caption index/clear, inline keyword results and shared Archives/MCP FTS integration. Merely opening controls does not inspect/extract/search; no remote access, cookies, transcription or model call. Sidebar now defaults to Keyword only/no AI with explicit existing semantic option and disabled-app visibility preserved.

Append-only registered/frozen schema39 extends asset FTS with source-revision-bound transcripts. Native source descriptors stay pinned/read-only; repeated child commands rewind only the nominated inherited descriptor while parent CLOEXEC remains set. Source/version checks, finite duration/timing, bounded parser/JSON, single-operation/profile authority, cancellation tombstones and phase3 guard retention protect publication. Review fixes cover stale-file shared-search cleanup, valid-hit read-snapshot iteration (not unstable OFFSET), native profile-scoped cache-change events, cross-panel status/search invalidation and late cancellation epoch/operation guards. Clearing/deleting captions retains ordinary metadata search and originals. This is not acquisition-time unembedded sidecars/OCR/transcription or recovery of captions never saved.

Passing: **93 focused frontend/121 ordinary native/seven opted-in synthetic installed engine fixtures**, plus separate descriptor-inheritance subprocess/helper (nine ignored runner entries), typecheck/notices413native+8archives/diff. Generated4s H.264/mov_text proves sequential VTT/SRT cue equality, native0600 no-clobber output, protocol/playlist refusal, cancellation and unchanged original. A hidden private native host passes actual inspect/index/search/clear IPC, full SQL-plugin schema1–39 startup/cold reopen, native stale-generated-source pruning/event delivery, retained index and unchanged originalA; only generated fixtureB is deliberately changed to test invalidation. Six blocked-IPC nonpersistent WK renders cover Liquid/Ivory/420px saved-download/player controls. No native Save-dialog, full-React/MCP/full-shell/owner acceptance. [Exact authority/evidence](docs/architecture/archives-downloads-sidecars.md); private `~/.local/share/orion-proof/downloads-20261005-owner-feedback/p2-sidecars-01/`.

Migration39 SHA384 `795e74c7030c3f459b9c04ac2aec7d2332d49e27df603c777e7ed70287650dc31b05de0d1618d79f07f08401ab58ab5d`. Latest read-only **migration39 metadata only** found it absent in owner profile; no dev app/watcher was running. Do not claim it applied there. Next normal updated native launch must apply it; the agent did not force-launch/activate the owner app or repair its DB directly. Private proof1–39 startup is separate evidence.

Next approved backlog: remote row thumbnails/richer library/file actions, reusable/pre-download destinations, acquisition-time unembedded sidecars and explicit subscriptions/scheduling; mixed SponsorBlock policies and appropriate live/native/owner acceptance remain open. Real-cookie smoke requires separate consent. No new dependency/engine installation/update, owner media/history/browser/keychain read or mutation, forced owner activation, manual app promotion, commit/push/release or new design-token gap. Only owned private hosts/servers exited and owned proof incremental caches pruned; executables/evidence retained. Disk remains constrained (~6GiB), not intentionally filled. Older independent XDesign objectives remain untouched.

## 2026-10-19 — Archives Downloads / optional verified SponsorBlock

Branch: `validation/alpha-2026-09-14`. **Uncommitted; whole-tool parity remains unfinished.** Continued the approved rebuild after limits; preserved unrelated work and accepted clip recovery. Added default-off YouTube SponsorBlock mark/remove controls, literal category/preset/range validation, saved/frozen options and archive identity. Inspection never contacts the service. Explicit download/Run can query `sponsor.ajay.app` using a video-ID hash prefix/categories (not anonymity); no cookies/media/model request is forwarded to the service. Mixed mark-some/remove-other policies are not implemented. Removal currently refuses captions/clips; marking supports video/M4A and preserves/rebases actual chapter coverage.

A fixed-origin native loopback gateway bounds service bodies before decode, refuses malformed scalars/objects/duplicate video rows/oversized entries, does not forward browser headers/cookies/proxy/redirect authority, latches failures and aborts on Drop. Valid empty/404 retains the whole timeline; missing/error/unsupported lookup cannot claim success. Actual category-specific merged chapter intervals and finite source/processed/final duration are verified (≤1s final drift, not weaker generic1%). Engine fixture caught pinned yt-dlp's globally latched `--no-sponsorblock`; native now emits it ONLY Off, never before positive flags. Originals remain untouched.

Passing: **76 focused frontend/100 ordinary native/six opted-in installed synthetic fixtures**, typecheck/notices413native+8archives/diff. Generated12s H.264/Opus plus loopback API proves zero Off requests, marks,1–6s clip rebasing2–4s→1–3s, ~10s video/MP3 removal, empty/404, malformed/500/duplicate/over-limit/unsupported refusal and unchanged source bytes. Thirteen gateway tests cover bounded/schema/routing/credentials/redirect/latching/abort paths. Six blocked-IPC WK Liquid/Ivory/420px source/default renders show actual themed controls without overflow. [Exact feature/privacy/evidence](docs/architecture/archives-downloads-sponsorblock.md); private `~/.local/share/orion-proof/downloads-20261005-owner-feedback/p2-sponsor-01/`. This is not real YouTube/SponsorBlock/EJS, native-dialog/chapter-player/owner/full-shell acceptance. Real-cookie smoke still needs separate consent.

Next approved backlog: standalone sidecars/transcript search, remote row thumbnails/richer library/file actions, reusable/pre-download destinations and explicit subscriptions/scheduling; mixed SponsorBlock policies and appropriate live/native/owner acceptance remain open. No migration/dependency/engine install/update, owner media/DB/browser/keychain access, forced app activation, manual app promotion, commit/push/release or new design-token gap. Normal dev watching may rebuild. Disk stayed constrained (~8GiB), not intentionally filled. Older independent XDesign objectives remain active and untouched.

## 2026-10-18 — Archives Downloads / configurable storage and time limits

Branch: `validation/alpha-2026-09-14`. **Uncommitted; full downloader parity remains unfinished.** Continued the approved rebuild and preserved unrelated XDesign/runtime/plugin work. Historical defaults remain2GiB file/4GiB work/512MiB reserve/45minutes; source/default controls now validate file16–65536 MiB, shared work32–262144 MiB (≥2× file), reserve512–65536 MiB and per-engine1–1440minutes. Old jobs/defaults retain historical values. New batches/playlist/default snapshots freeze limits; resource-only changes do not change archive identity. Native transfer/conversion/remux/copy/publication honor snapshots; manual export retains independent64GiB ceiling/512MiB reserve.

Review fixes: recoverable ready files bypass transfer-only admission and stay ready after failed publication; shared scans tolerate only peer disappearance during rename/cleanup, not links/special files/other I/O failures; posters receive the original reserve. Different work-cap cohorts wait for active workers to drain. Full pending-copy headroom/free-space checks are sampled, not reservations. Long saving copies keep their claim without holding the global activity mutex. Local playable-copy preparation now returns a durable job immediately, copies in the blocking pool with Stop/work checks and removes only its own incomplete temporary bytes on failure; originals remain untouched.

Passing: **72 focused frontend/81 ordinary native/five opted-in synthetic installed-engine fixtures**, typecheck/notices413native+8sourcearchives/diff. Added boundary/corruption/argv/archive/snapshot/cohort/shared-work/pending-copy/cancellation/rename/ready-state/reserve regressions. Six blocked-IPC nonpersistent background WK renders cover Liquid/Ivory/420px source/default controls with nondefault limits. No real large transfer, live low-disk/native-dialog/large-copy-Stop/whole-shell or owner acceptance claim. [Policies/evidence](docs/architecture/archives-downloads-limits.md); private `~/.local/share/orion-proof/downloads-20261005-owner-feedback/p2-limits-01/`.

Next approved work: sidecars/transcript search, remote row thumbnails/richer library actions, reusable pre-download destinations, explicit SponsorBlock and subscriptions/scheduling. Live-site/EJS, native Save/Allow/default reopening, audio/caption/owner review and broader lifecycle/fault acceptance remain open; real-cookie tests still need separate consent. No new migration/dependency/engine install/update, owner media/DB/browser/keychain access, manual app promotion, commit/push/release or new design-token gap. Normal dev watching may rebuild; disk was constrained (~8GiB available), not deliberately filled. Older independent XDesign objectives below remain active and untouched.

## 2026-10-18 — Archives Downloads / verified metadata and caption embedding

Branch: `validation/alpha-2026-09-14`. **Uncommitted; full downloader parity remains unfinished.** Continued the already-approved rebuild without repeating the accepted Marathon recovery or disturbing unrelated XDesign work.

Added actual optional metadata, chapter, MP3/M4A/FLAC artwork and full-video caption embedding in source controls/defaults, with native validation and output-variant archive/queue identity. All extras default off for historical settings/jobs. Manual captions take priority; automatic fallback is explicit. One–five exact languages; captions+clips refuse rather than publish mistimed text. Verified receipts reflect actual probes, not requested controls. Ogg/Opus/Vorbis stream title/artist survive M4A conversion; audio art survives clipping. Source chapters shift to clipped-video time.

Review corrections: complete bounded language inventory, keys-only extraction receipt with unambiguous missing sentinel and pinned-handle read, cleanup-compatible receipt names, ISO aliases, corrected three-letter engine tags and persistent regional identities even with codec conversion off. Metadata-only remux verifies before private atomic replacement; conflicting base/region markers and unrelated existing captions refuse. No Library original is changed.

Passing: **69 focused frontend, 68 ordinary native and five opt-in synthetic installed-engine fixtures**, typecheck/notices/diff. Generated fixture has14 cases including `fil`/`slo`, `pt-BR` opt-out reprobe, missing English/Nauru with preexisting tracks, artwork/clipped chapters and byte-identical sources. Four blocked-IPC WK theme/narrow renders pass. These are not live-site/caption playback/native dialog/full-shell/owner acceptance. [Implementation, exact evidence and limits](docs/architecture/archives-downloads-embedding.md); private `~/.local/share/orion-proof/downloads-20261005-owner-feedback/p2-embedding-01/`.

Next: configurable large-file/work limits and disk safeguards, standalone sidecars/search, remote row thumbnails, richer Library actions/reusable pre-download destinations, SponsorBlock and subscriptions/scheduling. Real-site/EJS, native-dialog/default reopening, caption/audio/owner review and broader lifecycle/fault acceptance remain open; real-cookie tests need separate explicit consent. Existing dev watcher may rebuild normally; no new migration/dependency/engine install/update, manual app promotion, commit/push/release or owner media/browser/keychain operation. No new token gap. Preserve older XDesign task entries below; this downloader milestone does not complete or supersede those independent objectives.

## 2026-10-15 — Codex / Bounded Relink and Replace Contents

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area complete. Uncommitted.** Three owner-requested GPT-6.1 Sol agents implemented and independently reviewed production, tests and verifier. Root added the bounded disk reader and controlled checks. Previous turn was verified progress; parent checkpoint/supplement/logs reverified before edits. Dirty work preserved.

Relink and Replace now use typed private source-change transactions with Embed. Relink validates the actual target before checked metadata-first NEW-path resolution, renders once and restores the exact Linked path. Replace reads DISK once and publicly decodes before explicit-target validation/admission, preserving native error priority. Both clear only psd_raw and SoLd/PlLd/SoLE while preserving unrelated/global metadata, transforms, filters and masks. Preparation precedes one authoritative edit/coalescing/posthooks/preset/journal; failures retain owner state. Embed keeps its original metadata behavior. The new source-only reader uses existing bounded reads and truthful nonregular refusal; existing import code remains exact.

Passing: **69 distinct native tests/five scopes, fourteen new cases; all 1,084 host tests compile, full suite not executed.** Five passing terminal receipts, no diagnostics. Binary 166,945,200 bytes/SHA `956891c8a69f2cc1ca2f61ad0e60e5379de91de23a6c15caf071211fbc8d6647`. Independent non-neutral pixels/bytes, metadata/disk collision, pin lifetime, ordering/atomicity/panic, mixed coalescing/Fade, actual presets and immutable reopening pass. Both full verifiers pass **22,870 hashes before logs**; an eight-file supplement binds final receipts/helpers. Three changed/one added source/test files, zero foreign changes. Input/dispatch bodies reconstruct exactly except intended additions; main host, registration, Embed tests and Refresh code/tests unchanged. All frontend/config/tooling/upstream inputs and 232 production files unchanged; historical579frontend/20files, build8,075modules, six production checks/worker executions retained without rerun. All owned handles terminal.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-source-change.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-source-change.json), SHA `f1bddbd9004829af27435e3df4839863df82ae242536736e6f7e86f85470ef24`; [verification supplement](docs/architecture/xdesign/acceptance-artifacts/source-change-2026-10-15-post-record-verification.json), SHA `a5e10fb6e9f3a6405e4af7ffc9542e2b4dc85e177a5199514b62c53f14433c0a`. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No dependency/lock/catalog/attribution/token/config/schema/migration/registration/upstream changes, commits/pushes/releases/deployment/package/install/production replacement/external sends or denial bypass.

Next: bounded raw Export Contents and Convert to Linked. Native public photocraft_format::atomic_write is the correct writer; Export must not render/admit filter stacks or create history, but retains native success posthooks/preset/journal and exact raw bytes/name/count. Convert needs destination basename plus metadata-only authority resolution; native writes before rendering and may overwrite on failure. Product reliability direction: prepare/render BEFORE publishing the external destination, explicitly test/document changed failure ordering and later project-save output persistence. Atomic rename is not a two-resource file+document transaction. Agent/test writes stay in generated temporary fixtures. All six areas plus authored-original/installed device/service/font/IME/keyboard/a11y/export-reopen/resource acceptance remain unfinished. Existing encoded/canvas/cache policies do not bound decoded/transient/history/RSS or blocking I/O races. No new token gap or owner question blocks independent work.

## 2026-10-15 — Codex / Bounded embedded source conversion

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area complete. Uncommitted.** Three owner-requested GPT-6.1 Sol agents implemented, tested and independently reviewed the source/verifier. Previous turn was verified progress; its checkpoint, supplement and logs were reverified before edits. Dirty work preserved.

Exact Convert to Embedded now resolves the actual target once with checked source loading and available-stack admission, retaining the resolved filename/byte Arc as the final Embedded source. Native active-Linked enablement still allows explicit inactive Linked or Embedded targets. Missing/error/job/parameter ordering, keep_psd placed/raw metadata, context/posthooks, one coalescible edit, preset flush, journal, Undo/Redo and immutable publication/reopening are retained. A failed private render does not commit or flush owner presets.

Passing: **55 distinct native tests across four scopes, eleven new cases; all 1,070 host tests compile, full suite not executed.** All four receipts pass with no diagnostics. Final binary is 166,738,240 bytes, SHA `a516b1ce4c66b2f784b0226c5fdf736f7bd4f7736d07eb0398e34b1b3f01872d`. Independent literal pixels/source bytes, native state/history, single-read/final Arc ownership, inactive targets, refusal/preset and actual host reopen checks pass. Both full verifiers pass **22,844 hashes before logs**; an eight-file supplement binds their actual terminal results. One changed/two added source/test files, zero foreign changes; existing dispatch reconstructs exactly after removing only the new module/branch. Main host, registrations, refresh code/tests and all frontend/tooling/config/upstream inputs remain identical. Historical 579 frontend tests/20 files, build 8,075 modules, six production checks and worker executions retained without rerun; 232 production files unchanged. All owned handles terminal.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-embed.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-embed.json), SHA `bbc07bd94e198385dc96bc33efeba32c8890e672413478add60c363f34fb9456`; [verification supplement](docs/architecture/xdesign/acceptance-artifacts/embed-2026-10-15-post-record-verification.json), SHA `3d4b5919a95145dcd7206bcb200d9da9bf8d2677d6125ef5587a93abf8d46f31`. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No dependency/lock/catalog/attribution/token/config/schema/migration/registration/upstream changes, commits/pushes/releases/deployment/package/install/production replacement/external sends or prior-denial bypass.

Next: implement Relink to File and Replace Contents together using typed source-change transactions in replay/embed plus an independent test child. Relink resolves the NEW Linked path, metadata first, after target validation. Replace must read DISK and publicly decode before explicit-target lookup, so its bounded predecode precedes stack admission. Both clear only native placed keys SoLd/PlLd/SoLE and psd_raw, retaining unrelated/global metadata. Preserve mixed-command coalescing, exact errors/one-read decisions and immutable history. Treat nonregular-input refusal explicitly rather than falsely calling it oversized; consider a narrow shared input reader extension if needed. External write-bearing conversion/export remains separate. All six areas and authored-original/installed device/service/font/IME/keyboard/a11y/export-reopen/resource acceptance remain unfinished; existing caps do not bound aggregate decoded/transient/history/RSS. No new token gap or owner question blocks independent work.

## 2026-10-15 — Codex / Bounded linked Update All

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area complete. Uncommitted.** Three owner-requested GPT-6.1 Sol agents implemented/reviewed the native transaction and independent tests/verifier. Previous checkpoint and dirty work preserved.

Exact `layer.smartObjects.updateAllModifiedContent` now resolves and renders checked Linked sources sequentially in native depth-first occurrence order, including hidden/nested/repeated paths. Unavailable sources retain cache without stack admission; a later corrupt/oversized/growing/unsupported source leaves the authoritative document/history/journal/context/pending presets unchanged. Success keeps Linked references and placed metadata, one coalescible edit, native slice/view posthooks, preset flush and immutable Undo/Redo/reopening. Encoded occurrence pins retire before the next source read.

Passing: **49 distinct native tests/four scopes, ten new cases; all 1,059 native tests compile, full suite not executed.** One final binary166,447,056bytes/SHA `99e270979f12000ae40be859bbfc0c6e469c4dbf53420acb7007c7f618082139`. Five terminal receipts retain one corrected test-helper SampleType compile diagnostic; independent pixels and strict state/Undo oracles remain. Both full verifiers pass **22,819 hashes before logs**; an eight-file supplement binds their actual final receipts/helpers. Two changed/one added source/test files, zero foreign changes. All frontend/tooling/config/upstream inputs and232production files unchanged: historical579frontend/20files, build8,075modules, six production checks and actual worker executions retained without rerun. All owned handles terminal.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-update-all.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-update-all.json), SHA `b090390a47a6da7f5b3265968eedb56295075c3728cca2f45451c0c146eeb1d7`; [verification supplement](docs/architecture/xdesign/acceptance-artifacts/update-all-2026-10-15-post-record-verification.json), SHA `0647643b0ab8445df325b2dd278d13484037b76b2b8aabc45b002d2faf9d7121`. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. Main photo host/registrations, dependencies/locks/catalog/attribution/tokens/config/schema/migrations/upstream unchanged. No commits/pushes/releases/deploy/package/install/production replacement/external sends or denial bypass.

Next: exact Convert to Embedded is the smallest bounded source-changing route. Preserve active-Linked enablement even with explicit inactive target; unavailable error, intended final Embedded bytes, keep_psd=true metadata, one read and native edit/coalescing/posthooks/preset/UndoRedo/reopen. Relink clears native placed keys; Replace reads/decodes before explicit-layer resolution; Convert to Linked/export carry external writes and need separate treatment. No arbitrary aggregate cap: per-source/canvas/cache policies do not establish decoded/transient/history/RSS bounds. All six broader areas plus authored-original/installed device/service/font/IME/keyboard/a11y/export-reopen/resource acceptance remain unfinished. No new token gap or owner question blocks independent work.

## 2026-10-15 — Codex / Video reset navigation and playback ownership

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area complete. Uncommitted.** Previous goal turn was verified progress. Three owner-requested GPT-6.1 Sol agents implemented model/import/export, playback and independent test scopes, cross-reviewed corrections and supplied a verifier. Dirty work preserved.

Native/local video-reset flags now round-trip explicit true/false with an authoring checkbox. Present/native hosts reset only the arriving screen/overlay occurrence at committed layout, including same-screen/Back/Close, without replacing its video/source/poster or disturbing lower/base controls and scroll. Exported media state handles metadata, autoplay, trigger rearming/stale callbacks, playback-only failure recovery, held/drag/motion rollback and StrictMode resource/seek ownership. Native base DOM identity is stable across overlay/history changes.

Passing: **579 frontend tests/20files,38new cases, build8,075modules and6production checks.** Actual emitted worker3,990,457bytes/SHA `cea7787ee8fa0491a006dd0a2fa2d21fa651d9a52de63cf188abbf400a2b9383`:14offline requests/one expected refusal+recovery/20PNGs,2changed/1,379inputs. Older697-input scripting worker retains6executions. All Rust/native verification inputs and binary remain identical; historical26native/4scopes,1,049compiled retained without rerun. Ten terminal gate receipts retain2corrected diagnostic runs; old cleanup assertions unchanged. Both full verifiers pass **22,790hashes before logs**. A path-only verifier correction and actual final receipts are additionally bound by an8-hash supplement. All owned handles terminal;12existing source/test files changed, zero added/foreign.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-video-reset.md), [record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-video-reset.json), SHA `48fd5e2af31a4e1c4a6663b6cdb0beb3190c16e660dec4b9fec8390d3b5924a9`; [verification supplement](docs/architecture/xdesign/acceptance-artifacts/video-reset-2026-10-15-post-record-verification.json), SHA `15a5530d648feb443e848809b0993cae260e42f3e01794e4335b434cab755406`. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No dependencies/config/tokens/schema/migrations/registrations/upstream changes or commits/pushes/releases/deploy/package/install/production replacement/external sends/denial bypass.

Next: exact layer.smartObjects.updateAllModifiedContent currently bypasses bounded linked loading. Use linked_replay.rs+linked_refresh.rs for sequential per-occurrence source resolution/render, native ordered missing-source fallback and one atomic authoritative edit, preserving preset/history/UndoRedo/reopen semantics. Do not pre-pin N encoded sources or invent an aggregate ceiling. Existing source/canvas/cache accounting does not bound decoded/transient/history/RSS; that acceptance remains open. Source replace/relink/embed and write-bearing conversion remain distinct. All six broader areas and authored-original/installed device/service/font/IME/keyboard/a11y/export-reopen/resource acceptance remain unfinished; controlled DOM/worker fixtures are not browser/original parity. No new token gap or owner question blocks independent work.

## 2026-10-15 — Codex / Geometry admission and script import ownership

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area complete. Uncommitted.** Three owner-requested GPT-6.1 Sol agents implemented native admission, dialog ownership and independent tests, cross-reviewed, and supplied an independent verifier. Previous checkpoint and dirty work preserved.

Image Size/Canvas Size now apply the existing pixel policy to actual native final dimensions before allocation, including omitted-axis aspect growth, relative growth, floats/defaults/clamping and resolution-only no-resample edits. Root's host integration is checked as exactly one early gateway insertion and narrowing the old coarse guard to Crop; its Crop body and all other host/registration code remain identical. ScriptDialog now ignores superseded file success/error after typing, later selection, Preview/Apply, Close or unmount, including after operations finish. Current files retain exact source and the64KiB limit.

Passing: **36 frontend tests/4files,26distinct native tests/4scopes, build8,075modules and one production identity proof;20new cases (12dialog+8native).** All1,049native tests compile, full suite not executed. Seven terminal passing receipts, zero diagnostics. Both full verifiers passed **22,746 hashes before logs**. Four changed/two added source/test files; zero foreign changes. Current worker payloads/1,379renderer inputs/697script inputs are identical; previous actual worker executions retained, not rerun. All owned handles terminal.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-geometry-script.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-geometry-script.json), SHA `389cd68155d8b587987bd186df759a87f7b689b0f055bc172f5264a869fbe557`. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No dependencies/config/tokens/schema/migrations/registrations/upstream changes, commits/pushes/releases/deploy/package/install/production replacement/external sends or prior computer-use denial bypass.

Next: implement native transitionResetVideoPosition navigation across Present/generated/native exports with same-screen handling, per-destination/overlay occurrence media reset, timestamp/end trigger rearming, async preparation/commit, held/drag rollback and .fig round trips. All six broader areas remain unfinished. Canvas-pixel admission is not a decoded/transient/layer/history/RSS bound; authored-original/installed device/service/font/IME/a11y/export-reopen and representative resource acceptance remain open. No new token gap or owner question blocks independent work.

## 2026-10-15 — Codex / Nested layout exports and linked sharpening

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area complete. Uncommitted.** Three owner-requested GPT-6.1 Sol agents implemented separate scopes and cross-reviewed corrections. Previous goal turn was verified progress; its checkpoint/logs were reverified before edits. Dirty work preserved.

Portable measured FRAMEs now support own fixed H/V nowrap auto-layout, native numeric cross sizing, basis/shrink, min/max/alignment, axis gaps/SPACE_BETWEEN, inherited direction and constrained absolute descendants. Source/provenance/control/baked fidelity guards remain; prototype-fixed flow children stay refused. A public SDK probe found negative spacing clamps to0; initial and live CSS gaps now match it without stale positive gaps. Linked Unsharp Mask/Smart Sharpen now support bounded add, numeric edit/Preview and exact native Repeat with existing source/cache, preset, history/coalescing/Fade and reopening semantics. Native Smart Sharpen remains its three-parameter implementation; no full Photoshop Remove-mode claim.

Passing: **421 frontend tests/16 files,120 distinct native tests/11 scopes, build8,075modules and6production proofs;68 frontend+10native new cases.** All1,041native tests compile, full suite not executed. One native binary165,955,664bytes/SHA `d2ca9c7f08bdcd8a5c572ae5f5e7f5b24abc03e17fe8ce611a5d55c12f77030f`. Exact emitted worker3,989,722bytes/SHA `6ed9a431133f4301ede0701fac9dd1ca29bbbbb0bc234375ec5341d46230d092`:12offline requests/one expected refusal+recovery/20PNGs,2changed/1,379inputs. New source calibration24direct+24fixture-worker renders/120literal probes; fractional runtime measurements included. Twenty-one terminal receipts retain2corrected frontend diagnostics. Both full verifiers passed **22,717hashes before logs**. Six changed/zero added source/test files, zero foreign changes; all owned handles terminal.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-nested-sharpen.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-nested-sharpen.json), SHA `248421fbef3001655c1dd3af076b380c9c1886053ac21c8b1e96bba4f762cdc0`. Main host/registrations, dependencies/config/tokens/schema/migrations/upstream unchanged. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved. No commits/pushes/releases/deploy/package/install/production replacement/external sends or prior computer-use denial bypass.

Next: area3 native ImageSize/CanvasSize admission currently underestimates omitted-axis aspect-ratio growth and relative canvas dimensions before allocation. Resolve exact native final dimensions and enforce the existing MAX_PIXELS policy before work; inspect no-resample false positives and job/error ordering. Area5 ScriptDialog delayed File.text can overwrite newer typing/file choice: add import/edit intent ownership and controlled real input-event races. Next area1 gap: explicit native transitionResetVideoPosition navigation is refused; implementing it needs scoped media epochs, same-route handling, trigger rearming, rollback and round-trip tests. All six areas and authored-original/installed device/service/export-reopen/RSS/latency acceptance remain open. Generated fixtures/JSDOM/PNGs are not authored or browser parity. No new token gap or owner question blocks independent work.

## 2026-10-15 — Codex / Measured responsive frame export

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area complete. Uncommitted.** Three owner-requested GPT-6.1 Sol agents implemented disjoint scopes and independently reviewed corrections. Existing dirty work preserved.

Portable fixed-axis, flex-grown leaf FRAME exports now provide actual local border-box measurements to constrained children, with source-resolved initial fallback, both-axis stretch/self alignment/min-max and live nonstretched cross-size bindings. Stable emitted identities retain media/scroll/DOM state and reject obsolete observer callbacks. Measurement and prototype refs compose correctly; rounded fixed clipping preserves both existing radius contracts. Private initial layout restores geometry/cache even on failure. Unsupported nested auto-layout/HUG/GRID/wrap/import/control/baked/effect/mask families retain fidelity guards.

Passing: **353 frontend tests/16 files, 55 new cases**, TypeScript/Vite build (**8,075 modules**) and six production proofs. Exact emitted worker **3,984,727 bytes**, SHA `b16f4cd365fa4c26a4490b1d855c2c5d791465dba033692a9741a8ab5cbf23be`:12 offline requests/one expected refusal and recovery/20PNGs. Two of1,379 worker inputs changed. Source calibration separately performs21 direct+21 fixture-worker renders and105 literal paint probes. All Rust/native verification/configuration inputs and binary unchanged; prior110native/11scopes retained,1,031 compile, full suite not executed. Ten terminal receipts include two corrected diagnostics; geometry/pixel oracles and prior assertions retained. Both full verifiers passed **22,644 hashes before logs**. Four changed/one added source/test file, zero foreign changes; all owned handles terminal.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-flex-frame.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-flex-frame.json), SHA `e0c715c137cb2858455e22a9fa6dfb96118e0372aed132e8d167dd8c8c5ead14`. No commits/pushes/releases/deploy/package/install/production replacement/external sends or prior computer-use denial bypass. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data preserved.

Next: bounded ordinary/selected Unsharp Mask and Smart Sharpen using existing linked replay, generic numeric controls and independent Gaussian-residual pixels; preserve ordinary missing-cache versus selected source-required semantics, preset/history/Fade/Repeat. Parallel export candidate: own fixed-size nested H/V auto-layout FRAMEs under flex parents, with distinct native cross-sizing and axis-gap/SPACE_BETWEEN rules; keep leaf admission separate. Update-all/source-changing operations require distinct ordered fallback/aggregate-resource treatment. All six broader areas and authored-original/installed-device/service/export-reopen/RSS/latency acceptance remain unfinished; generated layouts/PNGs/JSDOM are not authored or browser parity. No new token gaps or owner question blocks independent work.

## 2026-10-15 — Codex / Standard Smart Blur and linked-source refresh

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area complete. Uncommitted.** Previous goal turn was verified progress. Two owner-requested GPT-6.1 Sol agents implemented separate native files, a third cross-reviewed, and root coordinated evidence/gates. Dirty work preserved.

Linked Gaussian/Box/Motion/Radial/Surface Blur now support ordinary add, existing numeric edit and exact native Repeat with bounded source decisions, native cache fallback, shallow-merge/unknown settings, target routing, history/coalescing/Fade and reopening. Single Update linked source now stages a bounded pinned render while keeping authoritative Linked identity, updates only cache and invokes native slice/mask posthooks without extra history/journal. Root review caught owner preset-store flushing missing from previous replay; success now flushes pending owner changes, refusal does not. No unrelated scratch color/tools clones were retained.

**110 native tests/11 scopes pass;22 new cases;1,031 compile, full suite not executed.** One final binary:165,768,096bytes/SHA `1a7b6fa26a839697c9f6adcf805ece091ce6cd14b26e842d28ec027e50412e60`. Eleven terminal passing receipts, zero diagnostics. All frontend/tooling/config/upstream inputs and232 production files remain identical; prior598frontend/18files, build and6production proofs retained without redundant rerun. Both full verifiers passed **22,595 hashes before logs**. One changed/one added native file, zero foreign changes; main host/registrations unchanged. All owned handles terminal.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-smart-basic.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-smart-basic.json), SHA `d210f03f049baf4a45ca9ad481ed33922236dd5e41336ba6ca271a97afcaab8d`. No commits/pushes/releases/deploy/package/install/production replacement/external sends or prior computer-use denial bypass. Grid/canvas-first/PSD entry/themes/placements/Companion and owner data unchanged.

Next: actual local box measurement for constrained children inside ordinary portable flex-grown FRAME containers; keep existing refusal until responsive-parent runtime support is proven. Planned files: pencil/reactExport.ts, reactExportRuntime.tsx, reactExport.test.tsx, prototypeScrollRuntime.test.tsx; nativeReactRenderer.test.ts only for independent source-backed pixel calibration. Preserve selected-root dynamic-flow/HUG/grid/control, baked resize and ancestor effect/mask/backdrop guards. Other filter families, update-all/source-changing/transform policies and all six broader areas remain. Authored-original/installed device/service/export-reopen and representative RSS/latency acceptance remain open; encoded caps are not decoded/transient/private-history/RSS ceilings. No new token gaps or owner question blocks independent work.

## 2026-10-15 — Codex / Smart Filter lifecycle and ordinary Blur geometry

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area complete. Uncommitted.** Three owner-requested GPT-6.1 Sol subagents implemented and cross-reviewed disjoint scopes; root integrated source admission and central gates. Existing dirty work preserved.

Eight linked Smart Filter lifecycle operations now use bounded prospective-stack replay. Ordinary Field/Iris/Spin/Path/Tilt-Shift filters use source-aware input, sharp geometry tiles and document coordinates; unavailable-source fallback retains cached pixels and actual selection bounds. Captured contexts reject stale actions. Gallery Repeat preserves recorded inner settings, outer journal/coalescing, native Fade and source provenance. Checked resolution admits available stacks before reading bytes, skips admission for missing fallback, and retains the opened handle. Two frontend regressions found by the first gate were corrected: retained visibility help and owned displacement picker completion; all original assertions remain, with four extra regressions.

Passing: **598 frontend tests/18 files, 88 distinct native tests/10 scopes, production build and six production proofs**; **55 frontend +23 native new cases**. All1,009 host tests compile, full native suite not executed. Accepted native scopes share binary SHA `ee64e7fcb2fd601ea0211f848580893c2ed0bb8b3edb127f505988f0780547be` (165,277,232 bytes). Independent and primary verification passed **22,563 hashes** before logs; all owned handles terminal. Nineteen receipts retain one corrected frontend diagnostic. Ten changed/zero added source files, zero foreign changes. Exact worker remains unchanged and was re-executed offline:12 requests/one expected refusal/20PNGs.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-smart-gallery.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-smart-gallery.json), SHA `f5185241818e3b7e4e212ac405d50f979ea523940926c309ed08049e22749e41`. Grid/canvas-first/PSD-image entry/themes/placements/Companion, dependencies/config/schema/migrations/registrations/upstream remain preserved. No commits/pushes/releases/deploy/package/install/production replacement/external sends or prior computer-use denial bypass.

Next: bounded ordinary Gaussian/Box/Motion/Radial/Surface Blur and exact native Repeat through a private classifier, keeping Gallery geometry unchanged. Single updateModifiedContent needs original active-only enabled semantics and native slice fixups; proposed scratch render + same-index nonjournaled document.activate requires differential proof. Update-all/transform fallback, other filter families and broader six-area work remain. Authored originals, installed native/device/service/export-reopen, RSS/latency and full parity acceptance remain open. Encoded limits are not decoded/transient/private-history/RSS ceilings. No new token gaps or owner question blocks independent work.

## 2026-10-15 — Codex / Existing Blur editing and bounded linked replay

Branch: `validation/alpha-2026-09-14`. **Verified progress; full six-area XDesign goal ACTIVE and unfinished, no area marked complete.** Three GPT-6.1 Sol subagents implemented/reviewed parallel slices. **Uncommitted**; no commits, pushes, releases, installations or production replacement authorized or performed. Pre-existing dirty work preserved.

Existing Field/Iris/Spin/Path/Tilt-Shift Smart Filters now have staged source/lower-stack geometry and numeric editors, exact Preview/Apply drafts, explicit array clearing/reset, sharp source detail tiles, captured identity refusal and cleanup. Pixel refresh retains zoom/pan while expiring old gestures. Shared encoded preview limits cover both bases plus all three tile families. Linked existing RAW/Lens/Wide/five-Blur setParams now resolve once with bounded reads in a private pin, restoring the authoritative Linked source before native history/journal/coalescing commit. Undo/redo, Fade, channel/selection/slice context and native reopening are covered.

Passing: **543 frontend tests / 18 files**, **58 distinct native tests / 8 scopes** on one final binary; **68 frontend + 18 native new cases**. All986 host tests compiled, full native suite not run. TypeScript/Vite build passed (8,075 modules). Six production proofs passed; exact emitted native worker re-executed12 requests/one expected refusal/20PNGs, with all1,379 inputs unchanged. Both primary and independent verifiers passed **22,501 hashes** before log edits; all gate/verifier handles terminal. Initial diagnostics retained: unmount capture-owner cleanup defect + case-sensitive test label, four native fixture/oracle contract corrections, and the Field Blur oracle's once-extended12px halo. Numeric tolerances and full-state assertions were retained. Frontend/build retained on identical inputs after only two Rust test-file follow-ons.

Evidence: [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-blur-linked.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-blur-linked.json), SHA-256 `9c3df0b8342a21940d4270c39dd8bbec8e44f941cbd14ead754ccc74ffbf7889`. Native final binary SHA-256 `7810fc16d48bc778b3d603cb143c40dc412a4c737bf359308747391e2db0f26c` (164,750,128 bytes). Original grid/canvas-first layout, PSD/image entry, themes/tokens, dependencies/configuration/schema/migrations/native registrations and pinned upstream inputs preserved.

Next: extend the bounded transaction to exactly eight filter lifecycle commands (visibility/blend/move/delete/clear/global enable/mask enable/delete), checking the prospective visible stack so unsafe entries can still be hidden/deleted. Then fix ordinary selected-Smart Blur using native source-aware input/bounds: renderable sources use document coordinates; missing-source cached fallback uses actual selection bounds. Preserve one resolved available/missing decision through Preview/Apply and keep mask/Alpha/Quick Mask/raster behavior. Other creation/transform/update-all/relink/export routes need separate fallback/multi-source treatment. Current Linked editing admits only8 selected commands/11 pure stack commands; other Linked edits explicitly refuse. Encoded caps do not prove decoded/transient/private-history memory or RSS bounds.

Still open: all six original areas and authored-original/installed desktop/device/service/export-reopen acceptance. No browser/UI/IPC/tablet/IME/font/accessibility/provider/multi-account/RSS parity claim. Prior computer-use denial respected. No new token gaps or owner questions.

## 2026-10-15 — Codex / Solid shape playback, lens editing and numeric drafts

**Branch:** `validation/alpha-2026-09-14`. **Uncommitted.** Full six-area XDesign goal remains **ACTIVE and unfinished**; no area is complete. Three owner-requested GPT-6.1 Sol agents implemented separate scopes and cross-reviewed integration. Root reverified the preceding checkpoint/logs before edits, reviewed code and controlled shared gates.

**Changed:** portable rotated/reflected solid shapes retain live paint; live fill bindings share strict shape fidelity and actual visible paint-index admission, preserving complex artwork/native fallback and bound component/instance clipping. Existing Lens/Wide Angle Smart Filters now have captured staged editors, stable pre-filter geometry input, full-stack Preview/Apply, explicit resets, canonical straighten/profile settings and repeatable automatic scaling above 150%. Native metadata now uses the exact canvas-union-placed replay frame for off-canvas images. Develop scalar/HSL/grading controls have guarded numeric drafts, synchronous Preview/Apply flush, reset/cancel handling and valid slider detents without quantizing exact values. Pointer cancel/lost capture respect drag ownership. Grid, canvas-first panels, double-click Image entry, themes, placements, Companion and existing dirty work are preserved.

**Verified:** 590 frontend tests/25 files (93 new), focused2 exact-pixel cases (not additional distinct coverage), 61 native tests/10 scopes on one final binary (7 new; 968 compile, full suite not executed), TypeScript/Vite build8,074 modules and six production proofs. Exact emitted native worker3,980,047 bytes, SHA `635bfd53bfd89f364e6be6106a7a246473b1017366f8e71de8d354bccde484cb`: 12 requests, one expected refusal/recovery, 20 decoded PNG checks, no network/source mutation. 75 scene/control guards, 69 UI literals and notices verify. Runtime unchanged; only reactExport.ts changed among1,379 worker inputs. Both full verifiers passed22,427 hashes before logs; 25 terminal receipts comprise19 passes and6 historical diagnostics. Eleven source/test inputs changed, two added, no foreign changes. Six-area/authored-original/installed/native-device/service/resource acceptance remains open.

**Checkpoint:** [acceptance](docs/architecture/xdesign/acceptance-2026-10-15-shape-lens.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-shape-lens.json), SHA `86fc302dd81c5c998b152ebefe31430d9b5591b7bbee8f1d345551d97b85af18`. Final freeze SHA `56d9b405a70e3764c83e1b67e4a8b218392d5c720fa6ca5a5da503befce4db19`; native binary164,125,616 bytes/SHA `ed55ebb159959bda136625ac7b96a3784af002456d21423b6f0fd6e7475e58bc`. Historical failures are preserved. Four erased test-only type assertions retain byte-identical72,827-byte JavaScript; after frontend/build only the native preview module changed for the replay-frame correction. Exact continuity and final native execution are recorded. Owned source/test/config/docs/harness writers froze during live gates/writers/verifiers; terminal handles confirmed before fixes. No dependencies/locks/catalogs/attribution/tokens/config/schema/migrations/registrations/upstream edits, commits/pushes/releases/deploy/package/install/production replacement/external sends or UI/browser/server/process-inventory denial bypass. All6,380 pinned native inputs unchanged; Finder metadata excluded.

**Next:** staged existing Blur Gallery editors for five filters using source-aware geometry/full-stack setParams, explicit array resets and unknown-field preservation; then bounded linked-source replay. Audit confirmed external Linked bytes are reread before decoded-cache lookup without a total cap. A narrow pinned scratch-session setParams transaction appears feasible but must admit the entire pure stack, preserve linked history/coalescing/journal/Fade/context and exclude active jobs/external readers; it is not implemented. Generic Gallery frame is fourth document bounds, while Lens/Wide uses sixth placed extent; selected-Smart ordinary Blur selection framing needs a source-aware fix preserving missing-source fallback. Full ancestor effects/masks/backdrops, non-bicubic Smart Wide Angle, broader tool/RAW/PSD/resource/history/legacy/prototype/export/collaboration work and authored/installed acceptance remain unfinished. No new owner question blocks independent work.

## 2026-10-15 — Codex / Clone offsets, Smart RAW editing and root playback

**Branch:** `validation/alpha-2026-09-14`. Full six-area goal ACTIVE and unfinished; no area complete. Three reused, owner-requested GPT-6.1 Sol agents implemented separate scopes and cross-reviewed the integration. Root verified the prior checkpoint, coordinated frozen-source gates and independently verified the final record before logs.

Clone/Healing now expose saved-source offsets, signed scale, rotation, flips and reset, preserving source pairing and separate opt-in stroke transforms. Numeric drafts reject stale contexts and a draft plus mouse flip saves in one command. Existing Camera Raw Smart Filters open in Develop with captured drafts, source-backed full-stack Preview/Apply, explicit reset defaults and preserved unknown/legacy settings. Portable admitted roots now play their own x/y/rotation variables through the shared geometry forest. Baked transforms and native layout/control fidelity guards remain.

**488 frontend tests across 22 files, 52 distinct native tests across eight scopes, production build and six production proofs pass. All 961 native tests compile; the full suite was not executed.** There are 51 new frontend and six new native cases. Independent RAW stack order/double-processing oracles, 24 complete native PNG paint/padding expectations, source/history/Undo/Redo/native reopen, stable media identity and native Clone mappings/donors pass. The focused 14-case renderer pass is not additional distinct coverage. Twenty terminal receipts retain two corrected fixture diagnostics and one superseded native RAW pass. All accepted native scopes share the final binary. After frontend/build, only native Clone test setup changed; machine continuity checks preserve all other inputs.

Independent verification passes 22,342 hashes: 19,333 frozen, 2,855 retained, 65 evidence and 232 production. Eleven source/test files changed, none added; zero foreign changes and all 6,380 pinned native inputs unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-editing-playback.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-editing-playback.json), SHA `6e36089c71e750a1ffadf48f7c9806a62e393ee7aec07136bc0ef2903ef54215`.

**Next:** prove live CSS export for simple solid geometry with nonzero authored rotation/reflection; extend precise existing Smart Filter editing beyond Camera Raw after native source-stack validation; improve Develop scalar numeric drafts. Keep baked/effect/mask/backdrop, layout/control and non-bicubic pixel-Smart Wide Angle guards. Authored-original/installed desktop/device/service/export-reopen, representative resources/RSS/latency and broader legacy/RAW/Smart/six-area acceptance remain open. No new token gaps.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry/themes/placements/Companion and pre-existing dirty work preserved. No dependency/lock/catalog/attribution/token/config/schema/migration/registration/upstream changes, commits/pushes/releases/deploy/package/install/production replacement/external sends or prior UI/browser/server/process-inventory denial bypass. All owned gate/writer/full-verifier handles are terminal before logs; writes froze during each gate, and corrections began only after terminal confirmation. Scoped log verification follows. Final helper `/tmp/xdesign-editing-playback-ledger-final.py` is copied in artifacts.

## 2026-10-15 — Codex / Source markers, RAW regions and ancestor geometry

**Branch:** `validation/alpha-2026-09-14`. Full six-area goal ACTIVE and unfinished; no area complete. Three reused owner-requested GPT-6.1 Sol agents implemented disjoint scopes and cross-reviewed them. Root verified the prior checkpoint, coordinated frozen-source gates and restored a temporary corruption fixture.

Clone/Healing now show a native-equivalent source crosshair using the actual slot/alignment/anchor/transform parameters, with zoom/scroll/source/tool/dialog cleanup. Develop exposes parametric tone-region boundaries with normal numeric draft editing and live sliders. Portable selected layers follow variable-bound unselected ancestors through shared geometry, constraints and inherited modes; source/model/media identity and native fidelity guards retain. Interactive component variants consume their outer geometry once.

**433 frontend tests/21 files, 46 distinct focused native tests, production build and six production proofs pass. All 955 native tests compile; the full suite was not executed.** Forty frontend/four native cases are new. Independent native RAW oracles check all26516-bit samples/two tuples within two U16 codes, exact alpha, Preview/source immutability, Apply/Undo/Redo and Smart .pcraft reopen/refresh. Eighteen new analytic native PNGs and independent graph corner/union references cover ancestor geometry. Final focused76 passes separately. Eighteen terminal receipts retain a fixture-induced timeout and a corrected duplicate-constraint regression; the original110px control assertion remains unchanged. All accepted native scopes run after build on one final binary. Independent verification passes22,275hashes:19,333frozen/2,794retained/59evidence/232production; ten changed/two added source files, foreign0 and all6,380pinned native inputs unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-live-geometry.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-live-geometry.json), SHA `8b119d0f5ed3568c35eabeba1a0b04ce057f1ed2dd87b00a685e02b1847e636f`.

**Next:** native Clone Source Offset X/Y + Reset Transform controls; professional Develop editing/preview for an existing CameraRaw Smart Filter; portable own-root x/y/rotation bindings through the new shared forest. Bounded file plans and reset/merge/fidelity constraints are in the acceptance/archive. Keep dynamic flow/control/baked-resize, ancestor effect/mask/backdrop and non-bicubic pixel-Smart Wide Angle guards. Full authored-original/installed desktop/device/service/export-reopen and broader resource/RSS/latency/cancellation/legacy/RAW/Smart/six-area acceptance remains open. No new token gaps.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry/themes/placements/Companion and dirty work preserved. No deps/locks/catalogs/attribution/tokens/config/schema/migrations/registrations/upstream changes, commits/pushes/releases/deploy/package/install/production replacement/external sends or prior UI/browser/server/process-inventory denial bypass. All agents/gates/writers/full verifier terminal before logs; writes froze during every gate/writer/verifier, with terminal handles confirmed before corrections. Scoped log verification follows. Final helper `/tmp/xdesign-live-geometry-ledger-final.py` is copied in artifacts.

## 2026-10-15 — Codex / Clone sources, RAW curves and export sizing

**Branch:** `validation/alpha-2026-09-14`. Full six-area goal ACTIVE and unfinished; no area complete. Three owner-requested GPT-6.1 Sol agents implemented disjoint scopes and cross-reviewed them; root coordinated frozen-source gates.

Native Clone/Healing canvas strokes now use five saved slots and alignment anchors, with active-slot selection and correct native-preview cleanup on stale/missing-source refusal. Develop reuses the precise curve editor with RAW's sixteen-point cap, numeric/keyboard/drag/grab-offset controls, final native-f32 spacing and source/submission guards. Portable exports recalculate all selected roots and their common envelope when root dimensions change under fixed transformed ancestors, including reflections and LINE geometry.

**393 frontend tests/20 files, 42 distinct focused native tests, production build and six production proofs pass. All 951 native tests compile; the full suite was not executed.** Twenty-nine frontend/three native cases are new. Twelve new analytic native PNGs and independent private-graph corner/union oracles cover export geometry; exact emitted worker additionally passes twelve requests/twenty decoded PNG expectations with retained refusal/recovery, source preservation and no network. Seventeen terminal receipts retain two corrected test-only diagnostics (floating coordinate equality and optional mock params). Final frontend/build and every accepted native scope use final frozen source; native scopes share one final binary. Independent verification passes 22,212 hashes: 19,331 frozen, 2,736 retained, 56 evidence and 232 production; eleven changed/no added source files, zero foreign changes, all 6,380 pinned native inputs unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-studio-controls.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-studio-controls.json), SHA `e315935f500b2f14592d6b34e8e3215ae66e1667c941ec519fb68207e68c6a5c`.

**Next:** reuse the three agents for native-equivalent Clone Source crosshair mapping; RAW parametric curveSplits controls plus independent 16-bit pixel/Smart .pcraft reopen oracles; and portable dynamic unselected-ancestor geometry chains/constraints/modes. Detailed bounded plans are in the acceptance record and archive. Native source slots sample the current image; no cross-document donor/pixel-ghost claim. Keep Wide Angle and effect/mask/backdrop fidelity guards. Authored-original, installed desktop/device/service, resource/RSS/latency, legacy/RAW/Smart and broader six-area acceptance remain open. No new token gaps.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry/themes/placements/Companion and dirty work preserved. No deps/locks/catalogs/attribution/tokens/config/schema/migrations/registrations/upstream changes, commits/pushes/releases/deploy/package/install/production replacement/external sends or prior UI/browser/server/process-inventory denial bypass. All agents/gates/writers/full verifier terminal before logs; writes froze during each owned gate/writer/verifier. Scoped log verification follows. Final helper `/tmp/xdesign-studio-controls-ledger-final.py` is copied in artifacts.

## 2026-10-15 — Codex / Native pixel fidelity and bounded image inputs

**Branch:** `validation/alpha-2026-09-14`. Full six-area goal ACTIVE and unfinished; no area complete. Three owner-requested GPT-6.1 Sol agents implemented disjoint painting, bounded-input and composition scopes, cross-reviewed them and audited the next work. Root coordinated frozen-source gates and independent verification.

Color Replacement now preserves actual inactive pixel-layer and grouped Fade with native pixel-only routing. Ordinary PSD/PSB/RAW/raster imports check opened-file metadata before allocation and read at most the existing limit plus one overflow byte in bounded chunks. Host native opacity layers avoid faulty SDK bounds for reflected/rotated translucent groups, including the actual editor/grid and borrowed PNG renderer; all other paints and resource ownership retain. Portable transformed children follow their current responsive/bound dimensions using equivalent center pivots. Selected-root bound-size geometry remains separate work.

**230 frontend tests/15 files, 45 distinct focused native tests, production build and six production proofs pass. All 948 native tests compile; the full suite was not executed.** Sixteen frontend/ten native cases are new. Exact emitted native worker executes twelve requests/twenty decoded PNG expectations with retained refusal/recovery, source preservation and no network. Full independent direct-Canvas opacity references retain two-byte tolerance. Filtered references compare all premultiplied RGBA pixels at two bytes, including raw alpha, plus independent interior straight-color anchors. Small repeated-capture native-heap plateau is not representative RSS acceptance. Twenty terminal receipts preserve one corrected frontend test/reference failure. All native scopes run after build on one final binary. Independent verification passes 22,154 hashes: 19,331 frozen, 2,675 retained, 59 evidence and 232 production; ten changed/two added source files, zero foreign changes, all 6,380 pinned native inputs unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-native-integrity.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-native-integrity.json), SHA `4d926266fc2cf9b32e23de50be9811121e1105e77eaf769bafea1270c3ba5e5a`.

**Next:** three agents will implement native Clone Source slot routing in the canvas, precise Camera Raw point-curve editing by reusing the adjustment editor with its RAW 16-point cap, and portable multi-root bound-size placement/envelope recomputation under fixed transformed ancestors. Preserve native guards for non-bicubic pixel-Smart Wide Angle and ancestor effect/mask/backdrop composition. Broader memory/RSS/latency/cancellation/legacy/RAW/Smart functionality and authored-original/installed desktop/device/service/export-reopen acceptance remain open. No new token gaps.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry/themes/placements/Companion and dirty work preserved. No deps/locks/catalogs/attribution/tokens/configuration/schema/migrations/registrations/upstream changes, commits/pushes/releases/deploy/package/install/production replacement/external sends or prior UI/browser/server/process-inventory denial bypass. All agents complete and owned gates/writers/full verifier terminal before logs. Writes froze during gates/writers/verifiers; scoped log verification follows. Final helper `/tmp/xdesign-native-integrity-ledger-corrected.py` is copied in artifacts.

## 2026-10-15 — Codex / Actual-layer Fade, save admission and native overlap

**Branch:** `validation/alpha-2026-09-14`. Full six-area goal ACTIVE and unfinished; no area complete. Three owner-requested GPT-6.1 Sol agents implemented separate painting, history and native composition scopes, then cross-reviewed them. Root verified the preceding checkpoint and coordinated frozen-source gates.

The exact thirteen Brush/Pencil/Mixer/retouch commands now Fade their actual inactive pixel/mask layer and grouped pixel-to-mask edits. Native-correct journal/Fade passes through; native nonnumeric-layer/unknown-target fallback semantics match without changing generic filter/Fill/Patch validation. Saved-history constraints run before binding/cloning/writes; restore constructs fresh history instead of copying resident stacks it would clear. Native export preserves overlapping authored fixed/sticky/video/own-scroll roles, with each role fully guarded; only the obsolete fixed-overlay overlap refusal is removed. Runtime and source design geometry retain.

**155 frontend tests/9 files, 49 distinct focused native tests, production build and six production proofs pass. All 938 native tests compile; the full native suite was not executed.** Thirteen native/seven frontend cases are new. Twenty-four independent mounted/native full-scene pixel comparisons retain their two-byte tolerance. Exact emitted worker: ten requests, eighteen decoded PNG oracles, retained ancestor-effect refusal/recovery, source preservation and no network. All accepted native scopes run after build on one final binary. Independent verification passes 22,091 hashes: 19,329 frozen, 2,600 retained, 73 evidence and 232 production; seven changed/two added source files, zero foreign changes, all 6,380 pinned native inputs unchanged. Twenty-six terminal receipts preserve four corrected test/reference failures and six superseded successful native executions. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-layer-admission.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-layer-admission.json), SHA `3d90510db80b5b976ecc9524217d2c7c46d93d3ff34e6d8961c94286b251efd5`.

**Next:** reuse three agents for pixel-only Color Replacement inactive-layer Fade, bounded ordinary PSD/PSB/RAW file reads, and host opacity-only native saveLayer bounds compatibility (actual nested reflected/rotated translucent native/PNG groups can clip). The current reference-only viewport correction does not fix that production gap. Agent composition has a four-file scoped Canvas proxy plan preserving blur/masks and borrowed renderer state; portable responsive rotated/reflected pivots are another concrete later gap. Keep non-bicubic pixel-Smart Wide Angle guard: pinned replay hardcodes bicubic and serialization omits interpolation, with no public replay override. Broader resource/RSS/latency/cancellation/legacy/RAW/Smart and authored-original/installed desktop/device/service/export acceptance remain open. No new token gaps.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry/themes/placements/Companion and dirty work preserved. No deps/locks/catalogs/attribution/tokens/configuration/schema/migrations/registrations/upstream changes, commits/pushes/releases/deploy/package/install/production replacement/external sends or prior UI/browser/server/process-inventory denial bypass. All agents complete and owned gates/writers/full verifier terminal before logs. Writes froze during each gate/writer/verifier. Scoped log verification follows. Final helper `/tmp/xdesign-layer-admission-ledger-final.py` is copied in artifacts.

## 2026-10-15 — Codex / Coverage transactions, cache accounting and fixed scrolling

**Branch:** `validation/alpha-2026-09-14`. Full six-area goal ACTIVE and unfinished; no area complete. Three owner-requested GPT-6.1 Sol agents implemented separate transactions/workspace, memory and runtime scopes, then cross-reviewed routing and ownership. Root verified the previous checkpoint before writes and ran gates centrally.

Fill/Bucket/Gradient/aliases and Patch now retain actual coverage/pixel/mask Fade, including inactive Fill/Patch layers and grouped first labels. Apply Image/Calculations/Load Selection share journal/coalescing transactions; structural outputs do not Fade. Workspace installation preserves stable source references and resident engine context, validates captured state and completes publication/response serialization before ownership moves. Cold profile staging is detached and read-only, preserving files, builtin ordering, warnings and style clipboard.

Resident estimates reuse the capped preview visitor for current/borrowed undo resources, retaining native/legacy floors, normal redo/LRU and oversized-active behavior. Private redo/container/engine/transient/RSS costs remain incomplete. Fixed layers retain authored sibling order through clipped counter-scroll wrappers. Native non-passive wheel listeners cancel forwarded movement and preserve nesting, edges and cleanup. Native planner overlap/effect/mask/backdrop refusals remain.

**148 frontend tests/9 files, 118 distinct native tests, production build and six production proofs pass. All 925 native tests compile; the full suite was not executed.** Twenty-four native/nine frontend cases are new. Accepted native scopes all run after build on one binary. Exact emitted worker: nine requests, fourteen independent PNG expectations, two expected refusals and recovery. Independent verification passes 22,014 hashes: 19,327 frozen, 2,536 retained, 62 evidence, 232 production; twelve changed/three added source files, zero foreign changes, all 6,380 immutable native inputs retained. Twenty terminal receipts preserve a corrected passive-wheel failure and test-only compiler mistakes. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-transactions-scroll.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-transactions-scroll.json), SHA `361abea77cfae1f9d0cddf5fd6f8c6eca4abc5e87b0c7dc344b61ce42c389d7f`.

**Next:** correct actual pixel/mask Fade for the exact thirteen Brush/Pencil/retouch commands; move persistence admission before cloning/identity binding; implement coherent native fixed/video/scroll overlap admission with independent paint-order references. Keep ancestor effects/mask/backdrop and pixel-Smart non-bicubic guards. A cached-layer Apply Image audit found refusal before mutation, not content loss. Avoid speculative history cursors: pinned APIs clone private targets and can grow hidden capacities. Broader resource/latency/cancellation/legacy/RAW/Smart and original/installed desktop/device/service/export acceptance remain open. Remove the unused legacy `remember_coverage_fade` wrapper when that module next changes. No new token gaps.

Uncommitted. Grid, canvas-first/collapsible layout, double-click Image entry, themes, placements, Companion and dirty work preserved. No dependencies, locks, catalogs, attribution, tokens, configuration, schemas, migrations, registrations or upstream changes; no commits, pushes, releases, deployment, packaging/install, production replacement, external sends or prior UI/browser/server/process-inventory denial bypass. All writers/gates/full verifier terminal and agents complete before logs. Writes froze during every gate, writer and verifier; scoped log verification follows. Helper `/tmp/xdesign-transactions-scroll-ledger.py` is copied in artifacts.

## 2026-10-15 — Codex / Retouch Fade, Smart Contents and live fixed layers

**Branch:** `validation/alpha-2026-09-14`. Full six-area goal is ACTIVE and unfinished; no area complete. Owner requested continued GPT-6.1 Sol subagents. Three reused agents implemented/reviewed disjoint retouch, Smart/PSD and export slices, then audited the next work; root integrated bounded Smart Contents sources and ran central gates.

Eleven additional channel-aware retouch tools now retain correct Alpha/Quick Mask Fade for ordinary and cached commits, with grouping, first labels, saved donors and guarded fresh context. Fresh PSD/PSB imports recover explicitly enabled/disabled white Smart Filter masks, require raw Boolean enable flags and reuse bounded per-item Boolean decode results. Smart Contents open checks embedded/linked/disk source and metadata limits before copying/reading; embedded bytes share Arcs and unrelated linked payloads stay borrowed. Exported fixed layers, controls, tabs and panels use live bound/responsive geometry once, correct local content placement and nested-scroller parent size.

**139 frontend tests/9 files, 46 distinct selected native tests and full TypeScript/Vite build pass. All 901 native tests compile, not all execute.** All final accepted native scopes run after the build on the same recorded binary. Nine emitted-worker requests/14 decoded PNG oracles, two expected refusals and recovery pass. Worker remains byte-identical after Runtime tree shaking; current actual execution is new. Full independent verification passes 21,947 hashes: 19,324 frozen, 2,459 retained prior, 75 evidence, 232 production; seven changed/two added source/test files, foreign0, all6,380 immutable native inputs unchanged. Twenty-six terminal receipts preserve two corrected frontend rounds and one history metadata fixture mismatch. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-retouch-fixed.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-retouch-fixed.json), SHA `2d17273dbe5480d8dd86f3b608c8da687c71a03ad5160b26e3d22104f2f25481`.

**Next:** shared fill/Patch/Apply Image coverage transactions including stable cross-image context installation; improve resident/history estimates through the existing preview estimator; authored-order live fixed composition before overlap admission. Audit found native history privately retains redo documents/target metadata: do not blindly clone History or force peer eviction on ordinary redo. Remaining full ancestor effects/masks/backdrop/media, aggregate resource/RSS/latency/cancellation/legacy/RAW/Smart fidelity and authored-original/installed desktop/device/service/export acceptance stay open. Keep existing fidelity guards. No new design-token gaps.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry/themes/placements/Companion and owner dirty work preserved. No dependencies/locks/catalogs/attribution/tokens/configuration/schema/migrations/native registration/upstream changes, commits/push/releases/deploy/package/install/production replacement/external sends or prior UI/browser/server/process-inventory denial bypass. All owned writers/gates/full verifier terminal before logs; agents' next-work audits are read-only. Source/test/config/docs/harness writes froze during gates, writers and verifiers. Scoped log verification follows; helper `/tmp/xdesign-retouch-fixed-ledger.py` copied in artifacts.

## 2026-10-15 — Codex / Coverage Fade, PSD masks and nested scrollers

**Branch:** `validation/alpha-2026-09-14`. Owner explicitly requested resumed implementation and GPT-6.1 Sol subagents. Three agents implemented disjoint slices and cross-reviewed them; root integrated ordinary painting and ran sequential gates. The background goal control still reports paused despite the resume request. Full six-area scope remains unfinished; no area complete.

Coverage adjustments now retain undo grouping/journal/Fade on layer masks, Alpha and Quick Mask, including explicit inactive mask layers. Ordinary and cached Brush/Pencil Alpha/Quick Mask commits now Fade the actual coverage plane with guarded fresh context. Fresh PSD/PSB import recovers explicitly disabled white Smart Filter masks, preserving linked flags and native-deletion isolation with bounded extra metadata/decoding. Native React composition now classifies fixed/sticky layers by their immediate scrolling parent; existing effect/mask/backdrop/overlap refusals remain.

**85 frontend tests/6 files, 69 distinct selected native tests and full TypeScript/Vite build pass; all888 native tests compile, not all888 execute.** Thirteen new native/ten new frontend cases. Native60 cases run before build;9 persisted-history cases run after native resource rebuild, with source frozen throughout. Exact emitted worker additionally passes9 requests/14 decoded PNG oracles, including2 expected refusals; worker3,973,055bytes/SHA `7a722d50dd0b139d714716c3c9d306dd5d2ed15329f809b4ddd203b032c1cca7`. Existing actual worker/motion execution and strict generated React typing run in the current85 gate. Production guards/notices/WASM/styles verify. Independent verifier passes21,868hashes:19,322current frozen,2,261retained prior,56evidence,232production;10changed/2added owned source files, foreign0, all6,380immutable native inputs unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-refinements.md), [final machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-refinements-final.json), SHA `c0e6d8ad2a9a5fed3d43c93221f8c02dca2148df7f0e067ddd11e52f05343efb`.

**Next:** cache disabled-white detection for repeated placed IDs; wider retouch/coverage Fade and private post-hooks; aggregate resource/RSS/latency admission, broader cancellation and legacy conversion; full live ancestor-effect/mask/backdrop/scroll/media composition; remaining RAW/PSD/Smart fidelity. Keep non-bicubic pixel-Smart wide-angle guard until real replay support. Authored-original, installed native IPC/WebKit/keychain/service/multi-account, tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen acceptance remains open. Current generated fixtures are not original-file parity. No new token gaps.

Uncommitted. Owner dirty work/grid/canvas-first/collapsible/double-click Image entry/placements/Companion preserved. No deps/locks/catalog/attribution/tokens/config/schema/migration/registration/upstream changes, commits/push/releases/deploy/package/install/production replacement/external sends or prior UI/browser/server/process-inventory denial bypass. All source/test/config/docs/harness writes froze during gates/writers/verifiers. All owned handles terminal and agents completed before logs; scoped post-log verification follows. Full verifier: `python3 /tmp/xdesign-refinements-final-ledger.py verify c0e6d8ad2a9a5fed3d43c93221f8c02dca2148df7f0e067ddd11e52f05343efb` (helper copy in acceptance-artifacts).

## 2026-10-15 — Codex / Repeat previews and reliable workflow history

**Branch:** `validation/alpha-2026-09-14`. Full six-area scope remains unfinished; no area complete. Owner requested continued implementation with GPT-6.1 Sol subagents. Three agents implemented and cross-reviewed disjoint Repeat Last, fallback filter history and remote-asset slices; root integrated boundaries and ran central sequential gates. All agents stopped. Background `/goal` control still reports paused; work in this turn followed the owner's explicit resume request.

Last Filter opens the existing Preview/Apply dialog. Replay captures exact resident owner/version/current state/color and at most two authoritative raw journal candidates, preserving host/native target-routing differences. Missing/reopened/stale context refuses; no undo-label reconstruction. Outer params validate before copying, effective lens/displacement guards apply, source history stays isolated, and completed-cache reuse is bypassed to avoid direct-filter/replay collisions. Repeat cancellation observes phase boundaries, including before dispatch and display conversion; no mid-calculation interruption claim.

Fallback mask/separate Alpha/Quick Mask/layerless filters honor native coalescing keys without cloning retained history; different/unkeyed/outer Repeat keys preserve normal step boundaries. Mixed filters retain the first history label in Fade metadata and restore gesture-start coverage. Private post-command hooks remain outside acceptance. Stop now blocks cached-icon/deferred-image/batch asset publication and later notifications while preserving graph/selection/Undo/Redo/persistence/busy cleanup and successful retry. Already-sent notifications cannot be retracted; shared access batch guards remain unchanged.

**207 frontend tests/10 files,49 distinct native tests/all875 compilation and full TypeScript/Vite build pass.** All875 were not executed. Native32mask/channel+4Repeat parity+3resolver/ownership+7request+3ordinary cases;13 new native/six new frontend cases. Repeat matrix retains24depth/route/separate+2layerless contexts and direct-versus-repeat/source/target/refusal cases. Build8,072modules/44.18s Vite/60.048s wrapper. Production43UI literals/75guards, Last Filter dialog action, dedicated asset guard/four aborted checks/ten context assertions,112current defaults, exact native/script worker/WASM/notices and styles pass. Sixteen terminal receipts14pass/two diagnostics (invalid deselect fixture; asset probe counted existing service cancel strings). No scenarios/tolerances/budgets removed.

Independent verification passes21,600hashes:19,320frozen/21,514retained/55evidence/24production; nine changed/one added owned source files,foreign0,all6,380 immutable native inputs retained. Binary161,066,896bytes/SHA `583af40aa8039d3aaa348e61311edc9eef9e1912147f30e52a0f62449fd28fd8`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-workflow.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-workflow.json), SHA `34f0972bc1826c97b0764e1f3acc3a967830185ecfe2ec1feca91328201ba986`. Earlier retouch/nonresident-restore wave has its separate145frontend/13native/all862 checkpoint below; it is not represented as additional final-binary execution.

**Next:** wider channel painting/adjustment Fade and private post-command context; aggregate memory/admission, larger imports/transactions/legacy formats and more interruptible operations; live scroll/fixed/sticky/native group and media/backdrop/export integration; Smart Wide/PSD mask edges. Do not relax existing composition guards or resurrect stale backlog labels for already-implemented collaboration/libraries/nested/responsive work. Authored originals/independent visual oracles, installed native/network/multi-account/device/tablet/IME/fonts/keyboard/a11y/export-reopen and representative memory/latency acceptance remain open. Prior UI/browser/server/process-inventory denials remain binding.

Uncommitted. Dirty work, grid/canvas-first/collapse/double-click Image entry/themes/tokens/placements/Companion preserved. No deps/locks/catalog/attribution/configuration/schema/migrations/native-registration/upstream changes, commits/push/releases/deploy/package/install/production replacement/external sends or denial bypass. Finder metadata excluded. All source/test/config/docs/harness writes froze during gates/writers/verifiers; checkpoint writer/verifier terminal before logs. Scoped post-log verification follows.

## 2026-10-15 — Codex / Retouch controls and preview restore

**Branch:** `validation/alpha-2026-09-14`. Full six-area scope remains unfinished; no area complete. Owner requested faster implementation with GPT-6.1 Sol agents. The background goal control still reports paused; implementation resumed at the owner's request. Two agents implemented disjoint slices and cross-reviewed them; a third audited real remaining gaps. Root ran sequential gates.

Clone Stamp/Healing Brush now have opt-in source width/height, rotation and flip controls with independent persistence, preset support and identical preview/final dispatch. Default/legacy strokes omit transform params to preserve native Clone Source slots. Nonresident temporary previews skip historical bundles while validating saved/current identity and targets, preserving view/color/coalesce; editing and History Brush still restore history.

**145 frontend tests/5 files,13 distinct native tests (14 executions),all862 native compilation and full TypeScript/Vite build pass.** Three new history cases retain corrupt/missing current-versus-historical assertions, ten invalid-record mutations and legacy/state parity. Existing history/Undo/Redo/History Brush/archive/COW and transformed native sampling pass. Eleven terminal receipts:10pass/one fixture failure corrected for directory bundles. Build8,072modules; production42UI literals,75guards and exact native/script worker/WASM/notices/styles retain. Independent verification passes21,541hashes:19,319frozen/21,478retained/37evidence/23production; all6,380 immutable native inputs unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-15-retouch-restore.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-15-retouch-restore.json), SHA `d4195d174573c232fd33fadd41c4bcc97a526f940c6386be2e28459433a8039a`.

**Next wave:** authoritative Repeat Last previews; fallback mask/separate/no-layer coalescing; Stop before cached/delayed asset publication. Existing shared-editor batch guards already defend read-only publication: the proven asset gap is cancellation. Do not relax native group scroll/sticky guards: callers include live Present/React export, so baked offsets would double-transform or go stale. Broader resource/cancellation/Fade/Smart/PSD/legacy/dynamic composition and original/installed/device/service acceptance remain open. Private native post-hooks and approved upstream compatibility remain separate limits.

Uncommitted. No deps/locks/catalogs/attribution/configuration/tokens/schema/migration/registration/upstream changes, commits/push/releases/deploy/package/install/production replacement/external sends/UI/browser/server/process inventory or denial bypass. Dirty work/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved. Volatile Finder metadata excluded explicitly. All writers/gates/verifier terminal; scoped log verification precedes the next parallel implementation wave.

## 2026-10-14 — Codex / Preview cancellation and history ownership

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area scope remains unfinished; no area complete. This checkpoint was implemented October 14 and sealed after the October 15 resume request. The goal control still reports paused; the owner explicitly requested resumed implementation and GPT-6.1 Sol subagents.

Temporary command/stroke/mask snapshots now copy current state without retaining undo history; History Brush and editing keep their history. Native request IDs, bounded pre-start cancellation, two active slots, worker draining and serialized cancel/cache publication support capability-gated previews. Invalidated frontend requests cancel once; stale replies remain suppressed and region-only pans retain useful work. Native asynchronous raster filters keep host file validation; synchronous mask/channel/Smart/separate calculations cancel at phase boundaries.

**379 frontend tests/18 files and 75 distinct native tests pass; all859 native tests compile, not all859 execute.** Full TypeScript/Vite build passes (8,072 modules), and production worker/WASM/editor guards/styles verify. Fifteen native/five frontend cases are new. Twenty-four receipts terminal:19pass/five corrected diagnostic failures. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-preview-control.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-preview-control.json), SHA `865bd58de5ca9922c479f65cf6a43a48406ecf590953d7d03403660a5ad66be1`. Resume verification checks21,502 substantive hashes; five macOS Finder metadata files are explicitly excluded, with captured/current hashes recorded separately. Source, binary and build artifacts match. No broad tests/build repeated on resume.

**Next:** skip persisted history-bundle loading for nonresident temporary previews; expose native-backed Clone Stamp/Healing Brush source scale/rotation/flip controls. Two owner-requested GPT-6.1 Sol agents audited these independently and are queued for disjoint implementation. Aggregate memory/latency, wider cancellation, Repeat Last temporary preview, coalescing/Fade/PSD/Smart compatibility and all six original-file/desktop/device/service/export acceptance areas remain open. Prior UI/browser/server/process-inventory denials remain binding.

Uncommitted. Owner dirty work and grid/canvas-first/collapsible/double-click Image entry/theme/token/placement/Companion behavior preserved. No dependencies/locks/catalogs/attribution/configuration/schema/migrations/registrations/upstream changes, commits/push/releases/deployment/package/install/production replacement or external sends. The checkpoint writer and verifier are terminal; scoped log verification follows before implementation resumes.

## 2026-10-14 — Codex / Completed Blur Gallery previews

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous channel batch and this increment classify as verified progress. Two owner-authorized GPT-6 Luna agents supplied the memory estimator, independent pixel fixtures and read-only ownership/retention reviews; root integrated/corrected and ran central sequential gates. Both stopped; no agent gates.

The native preview endpoint now reuses completed Field/Iris/Spin/Path/Tilt Shift Blur output across Fit and viewport/detail refreshes, skipping filter execution and fitted PNG encoding. Exact owner/version/weak-source allocation/revision/targets/channels/command/parameters/full color settings/proof SHA-256/HDR identity guards reuse; validation precedes lookup. Shared four-entry/128MiB conservative retained-byte budget, one latest result per photo, LRU, 60s expiry on cache activity, dead-source cleanup and outstanding-renderer accounting apply. Entries retain output document/channel/base/result only: no session/history/strong original/display snapshot. Document accounting includes omitted masks/fill caches/video/pattern/selection/raw/structured payloads. Linked Smart targets always compute fresh because files can change without document edits; all five modes pass generated-file mutation comparisons. Embedded Smart cache reuse remains.

**35 distinct native tests pass on the final binary; all844 compile, not all844 execute.** Final scopes13cache+5detail+6tiles+3ordinary+2adjust+6color. Thirteen new tests include240 independently decoded paired detail references across five modes/three document depths/three regions plus75 target contexts, proof/HDR, ownership misses, retries, byte/LRU/expiry/weak-source/held-renderer and large-capacity raw payloads. Warm counters prove filter/base encode are skipped. Binary160,502,448bytes/SHA `425cb817953bf818f5829f1b69c52ef6c6c2518f4d162f013976da4ef0d4363b`. Earlier full37preview and26mask tests pass on preparatory revisions before final cache-only refinements; retained with snapshots, not claimed as final-binary execution. Eleven terminal receipts:9pass/2compilefailures (Debug tuple arity and unavailable test tile-coordinate import). No scenarios/tolerances removed. Review removed display/ICC retention under-accounting; proof identity strengthened and linked-source freshness regression added.

374frontend tests/17files and full TypeScript/Vite build retain on byte-identical frontend/build/production inputs; no redundant frontend run/build. Native worker1,379inputs/exact payload/WASM, script697, service/filter/UI evidence retain. All6,380 immutable native inputs unchanged. Independent full verification passes21,433hashes:19,320frozen/21,393retained/31evidence/23production;3changed/3added owned Rust files,foreign0,2,933unavailable historical inputs declared. Writer27980/170685 and independent verifier54511/98d381 exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-completed-preview.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-completed-preview.json),SHA `b8424ca777668c8793a5ac3b036c2a3480dc63a7722058646a318d14e277840e`.

**Next:** reduce command snapshot history cloning/holding, cancellation and aggregate process/operation memory; measure cache admission/latency on authored large documents before>16MP preview. Linked-source snapshot reuse and other filter families remain performance work. Repeat Last temporary preview, mask/separate/no-layer coalescing/post hooks, broader channel paint/adjustment Fade, pixel-Smart non-bicubic Wide replay and disabled all-white PSD Smart mask import remain open. Continue all six prototype/native fidelity,Photoshop options/retouch/RAW/color/PSD,large-project/history/legacy,reponsive/nested/scroll/media/code export,collaboration/libraries/services/assets/scripting and original/installed desktop/tablet/pressure/IME/font/keyboard/accessibility/export-reopen areas. Native IPC/keychain/HTTP/TLS/WebKit/Node22 remain unverified.

Uncommitted. Owner dirty work/grid/canvas-first/collapse/double-click Image entry/themes/tokens/placements/Companion preserved. No dependency/lock/catalog/attribution/configuration/schema/migration/registration/upstream changes,commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/UI/browser/server/process inventory or denial bypass. Source/tests/config/docs/harness writes froze during all owned gates/writers/verifiers; all terminal before logs. Scoped post-log verification follows. Goal active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Native channel filter routing

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous mask batch and this increment classify as verified progress. Two owner-authorized GPT-6 Luna agents supplied independent native references and read-only routing/Fade/context/extent/coalescing reviews; root implemented/integrated the corrections. Agents completed and ran no gates.

RAW/lens/wide-angle/Liquify/Puppet/Perspective now target Alpha/Quick Mask without changing image layers or unrelated planes. Explicit pixels/Alpha override live Quick Mask; implicit target precedence follows native. Private grayscale computation supports no-active-layer/group/Smart targets, preserves scalar format/default/channel metadata/selection and one edit/journal. Ordinary channels retain native dispatch/coalescing/post hooks, then annotate existing journal for guarded channel Fade. Fade uses existing previous history only, checks document/revision/label/target, creates one undoable edit and clears erroneous native layer Fade. Transient canFade exposes host/native availability; browser refuses unavailable/stale/busy submits. Smart channel wide-angle offers all interpolations; pixel Smart replay stays restricted. Native no-change success preserves source/undo history, malformed Perspective remains refused. Combined extents guard before readback; exact-content normalization preserves implicit outside-canvas coverage.

**374 frontend tests/17 files, 42 distinct native tests/all831 compilation and full TypeScript/Vite build pass.** Focus220/ten plus154/seven; four new frontend/fourteen native tests. Final native scopes26mask/channel/normalization+5detail+6tiles+3ordinary+2adjust. Seventy-two separate handler/actual8–16–32-bit/four-target cases compare independent native grayscale raw pixels and preview PNGs;24ordinary comparisons,2coalescing,6Smart interpolation,4Repeat Last,9no-change and3empty-Perspective refusals pass. Retained474decoded paired detail references execute again. Binary160,021,680 bytes/SHA `1542bbc1ac520f26b3be21a5d5542b077b43d97b1fdd12d572d2c3c12f7a84f7`;6,380 immutable native inputs retain. All831 compile, not all831 execute. Previous28/all817 are historical only.

Three failures preserved: baseline history mistaken for an edit; invalid empty Perspective fixture (valid identity plus original refusal now retained); tile padding overwriting implicit outside-canvas white coverage (reproduced0versus1, exact-content fix passes). Read-only coalescing audit prompted native ordinary-channel dispatch restoration and new native parity case. No scenarios/existing tolerances removed/loosened. Twenty-five receipts terminal22pass/3fail;seven freezes/twelve harness versions. Build8,072modules46.87s Vite/63.192s wrapper. Later Rust-only correction does not change frontend/build inputs, so no extra build. Production75guards/fivechunks and36UIliterals/twochunks/twostyles pass. Native worker1,379inputs/3,973,401bytes/onecopy/exactWASM7,159,342bytes/69rendererpackages/287notices/MPL0 retain;script697/sixhistorical executions,service and112metadata retain. Actual prior worker/React typing retains on exact inputs/payload, not repeated.

Independent verification passes21,397hashes:19,317frozen/21,296retained/73evidence/23production; six changed/two added owned source/test files,foreign0,2,933historical unavailable declared. Writer20589/7ed105 and full verifier3822/e921bc exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-channel-filters.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-channel-filters.json),SHA `3c2ba50c9c1d96aa1df8c25b0f0cc5a99b26d59c17ef152b0bea29ae17e5eaa0`.

**Next:** completed-filter preview cache with exact source/parameter/color/channel ownership and bounded aggregate retention; currently every pan/detail request reruns filter/basePNG. Cancellation,total memory/latency and>16MP preview remain open. Mask/separate/no-layer fallback coalescing/post-hook compatibility and broader channel adjustment/paint Fade need work; Repeat Last temporary preview unsupported. Continue all six prototype/native visual fidelity,retouch/RAW/PSD,large-project/history/legacy/recovery,responsive/nested/scroll/media/code export,collaboration/services/assets/scripting and original/installed desktop/tablet/pressure/IME/font/keyboard/accessibility/export-reopen areas. Non-bicubic wide-angle pixel Smart replay and disabled all-white PSD Smart mask import need approved upstream/dependency work. Native IPC/keychain/HTTP/TLS/WebKit/Node22 unverified.

Uncommitted. Owner dirty work/theme/tokens/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved. No dependencies/locks/catalogs/attribution/configuration/schema/migrations/native registrations/upstream changes,commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/UI/server/process inventory or prior-denial bypass. All root/agent source/tests/config/docs/harness writes froze during each sequential owned gate/writer/verifier. All owned work terminal before logs; scoped post-log verification follows. Goal active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Native mask filter routing

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous detail-preview batch and this increment classify as verified progress. Two owner-authorized GPT-6 Luna agents were reused for native references and read-only routing/cache audits; root implemented/integrated the adapter, rendering/UI corrections and acceptance. Both agents completed and ran no gates.

Pinned ordinary and separate native handlers could edit color pixels when a raster mask was targeted. XDesign now computes against a private mask raster and commits only coverage. Explicit/implicit/layer/group/Smart Object targets preserve source pixels, selection, channel state, mask format/default/metadata, one history step/journal, Repeat Last/Undo/Redo and filter Fade. Separate RAW/lens/wide-angle/Liquify/Puppet/Perspective handlers preserve grayscale defaults and flatten introduced alpha. Smart Object raster masks offer all three wide-angle interpolations; pixel Smart Filter replay retains its bicubic restriction. Detail tiles omit discarded selection feedback and gain contextual native references. Existing theme/tokens/grid/canvas-first/collapse/double-click Image entry retained.

**370 frontend tests/16 files, 28 distinct native tests/all817 compilation and full TypeScript/Vite build pass.** Final216 focus/nine plus154 regressions/seven; one new frontend/fifteen native tests. Native scopes: masks12,details5,tiles6,ordinary3,adjustments2. Independent paired references decode474 images (144 mask,240 contextual,90 retained references executed again), all five modes/8–16–32-bit/source and reduced clipped crops. Separate mask handlers pass36 depth/target cases plus3 group/Smart cases. Current binary159,752,064 bytes/SHA `0a3583b9f01adba4ca8bc1dcf9215f7afb652fe8c31c7eb9607b4e1acda72ae4`. All6,380 available immutable native inputs retain; five Rust source/test files changed/added, registration/schema untouched. The previous23 native tests are historical acceptance, not newly executed on this binary.

Six failures preserved: non-clone color state, omitted fixture target, merged checkerboard contour, uniform warp fixture, replaced Smart layer ID and widened frontend fixture string. Corrections remove no scenarios or existing tolerances. Final focus/build follow explicit PhotoState typing; native/regression inputs unchanged by that annotation. Twenty-two receipts terminal,16pass/6fail; eight freezes/nine harnesses preserved. Build8,072 modules,49.40s Vite/65.657s wrapper. Exact native worker1,379inputs/3,973,401bytes/onecopy/WASM7,159,342bytes/69rendererpackages/287notices/MPL0 retain; script697/six historical executions,service and112metadata retain. Actual prior worker execution/React typing retains on identical inputs/payload, not repeated. Production75guards/fivechunks and35UIliterals/twochunks/twostyles pass.

Independent verification passes21,320 hashes:19,315frozen/21,228retained/65evidence/23production; five changed/two added owned source/test files,foreign0,2,933unavailable historical inputs declared. Writer32066/ce0a75 and full verifier90356/214f0d exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-mask-filters.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-mask-filters.json), SHA `df0ae6988b578b80996bb11e2e04fe988e57d9afa0c5cddc842b68c0f9f8590f`.

**Next:** repair separate RAW/lens/warp Alpha/Quick Mask routing; current ordinary channel detail tests do not accept those handlers. Repeat Last temporary preview remains unsupported. Scratch preview reruns whole filter/base; bounded cache/cancellation, aggregate peak memory/combined normalization extent, lower latency and >16MP previews remain open. Continue all six areas, including prototype/native visual fidelity,retouch/RAW/color/PSD,large-project/history/legacy/recovery,responsive/nested/scroll/media/code export,collaboration/services/assets/scripting and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen. Non-bicubic wide-angle pixel Smart replay and disabled all-white PSD Smart mask import need approved upstream/dependency work. Native IPC/keychain/HTTP/TLS/WebKit and Node22 unverified.

Uncommitted. Owner dirty work/placements/Companion preserved. No dependencies/locks/catalogs/attribution/tokens/configuration/schema/migrations/native registrations/upstream changes,commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/UI/server/process inventory or prior-denial bypass. Root/agent source/tests/config/docs/harness writes froze during every sequential owned gate/writer/verifier. All owned work terminal before logs; scoped post-log verification follows. Goal remains active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Blur Gallery detail previews

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous native hit-alpha batch and this increment classify as verified progress. Owner-authorized GPT-6 Luna agents implemented native regions and preview controller/tests, then audited integration read-only; root integrated measured viewport planning/display, independent pixel references, ownership/budget/retry/type corrections and acceptance. Existing UI/theme/tokens retained.

The existing immutable native command-preview API now returns optional paired filtered/original detail tiles for the five Blur Gallery modes. Regions remain outside filter parameters and Apply. Measured SVG size/display density plans source-aligned visible tiles only when sharper than the fit preview. Same-parameter base stays during panning; details hide/revoke on viewport/parameter/source/view/busy changes. Original switches matching cached base/tiles; Fit removes details without a render. Manual parameters remain manual, with viewport refresh after accepted Preview; one request runs with latest controls coalesced. Strict whole-number source extents, eight regions, power-of-two scales1–64,512px output edges,2,097,152px/set and encoded24MiB base/2MiB per tile/48MiB combined bounds apply. Empty regions preserve legacy JSON. Busy generation and allocation/error/retry checks prevent stale or partial publication. The16MP full-operation limit remains.

**369 frontend tests/16 files, 23 native tests/all802 compilation and full TypeScript/Vite build pass:** final215 focus/nine plus154 regressions/seven,18 new frontend/four native cases. Independent full-composite/manual premultiplied references compare90 decoded paired crops across five filters,8/16/32-bit,source/reduced/clipped odd-edge sampling. Channel/proof context and source/history/legacy/bounds checks pass. Existing native preview/Apply/Undo,Smart Filter,profile/selection/text/warp/adjustment cases pass on the new binary. Native371.457s wrapper/345.87s tests; binary159,318,176 bytes,SHA `6c3f87f92d8c345e1b41571651505e66cdecaac9e49361073c8d8e85b879ccd3`. All6,380 available immutable native inputs retain; two existing Rust implementation files changed, no registration/schema changes.

Initial focus212/214 exposed wrong new fixture expectations (fractional pan adds an edge tile; a reply described the wrong requested region). Native compilation exposed private IPC type visibility; first build exposed overly broad test mock typing. Corrected without removing scenarios/tolerances. Busy generation adds final18th frontend case; final focused/build checks follow explicit mock signatures. Native and surrounding regression inputs did not change with that test-only correction. Thirteen receipts terminal,ten pass/three preserved failures. Build8,072 modules,46.96s Vite/62.033s wrapper.

Production: native worker3,973,401 bytes/SHA `a3dafdf579807ed6d973f565eba9236803677a2f2496b61aec63eb866bcb30f8`,1,379 unchanged inputs/one exact emitted copy,exact7,159,342-byte WASM,69 renderer packages/287 main notices/MPL0,75 guards/five chunks and35 library/Blur Gallery/detail UI literals/two chunks/two styles. Actual offline worker/strict generated React typing retain on identical inputs/payload; no separate worker compilation/execution repeated. Script697/six historical executions,service and112 UI/default metadata retain unchanged.

Independent verification passes21,251 hashes:19,313 frozen/21,186 retained/35 evidence/23 production,seven changed/three added owned source/test files,foreign0,2,933 unavailable historical inputs declared. Writer55598/736719 and independent verifier19385/1a49a3 exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-blur-detail.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-blur-detail.json),SHA `16359bdc4e6d9a3b586b9012611cd5708dfb3582a7c01ed09100ea62b08effb8`.

**Next:** selection/mask/Smart Object detail-reference combinations and wider color/proof/tool workflows; assess scratch recomputation/cache/cancellation/memory before larger-image preview. Detail presentation does not prove lower full-filter computation memory/latency; >16MP remains unaccepted. Continue native mask/antialias/path/image/styled-text/effect/overlap/scroll/media/backdrop and responsive/nested/code export,retouch/RAW/filter/Smart Filter/PSD,large-project/history/legacy/recovery,collaboration/services/assets/scripting and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen. Non-bicubic wide-angle Smart replay and disabled all-white PSD Smart mask import need approved upstream/dependency work. Native IPC/keychain/HTTP/TLS/WebKit and Node22 remain unverified.

Uncommitted. Owner dirty work/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved. No dependencies/locks/catalogs/attribution/tokens/schema/migrations/native registrations/upstream/configuration changes,commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/UI/server/process inventory or prior-denial bypass. Root/agent source/tests/config/docs/harness writes froze throughout each sequential owned gate/writer/verifier; all agents/work terminal before logs. Scoped post-log verification follows. Goal remains active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Native mask hit alpha readback

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous library revision batch and this increment classify as verified progress. Owner-authorized cheaper GPT-6 Luna agents implemented the alpha helper/tests and independent native references; root probed and integrated the capture/scanner. No UI or token changes.

Temporary mask hits now read caller-owned Alpha_8 memory, construct the path before Free, and skip unused PNG/RGBA readback/copy. Native rendering, high surface, linear downsample, geometry and normal PNGs remain. Legacy RGBA/new alpha APIs share one scanner and unchanged nonzero/span/4MP/4MB/finite guards. The pinned allocating wrapper is unsupported for Alpha_8; its documented caller-owned form matches all 256 alpha values exactly.

**463 tests/48 files and full TypeScript/Vite build pass:** 204 focus/33 plus 259 regressions/15, including 14 new pure/native cases. Independent PNG alpha paths match ALPHA/LUMINANCE/VECTOR, transformed/nested hits and old tolerance-two references. Large hit readback is 3,145,728 bytes versus 12,582,912 per RGBA array, without a second copy or hit PNG. Ownership/stride/free/failure/retry/source checks pass; actual offline worker and strict generated React typing pass. Large render surfaces remain RGBA; no total-process memory/latency claim.

Initial focus 202/204 exposed two allocation oracles: coincident size and earlier alpha Free. Root now requires exact buffer identity and all five frees in lifetime order. Second 203/204 timed out on decoded 12 MB-array deep equality; stronger complete PNG-byte equality preserves the scene/resource/path/source checks without raising timeout. Existing large-frame oracle retains four >=16 MiB surfaces/sub-1 MiB endpoints and separately requires one 4 MiB alpha plane. No scenarios or pixel tolerances removed. Build 8,071 modules, 35.20 seconds Vite/50.234 wrapper; eleven receipts terminal, eight pass/three diagnostic failures including the unsupported probe.

Production: one 3,973,401-byte worker, SHA `a3dafdf579807ed6d973f565eba9236803677a2f2496b61aec63eb866bcb30f8`, 1,379 inputs/two changed; exact 7,159,342-byte WASM, 69 renderer packages/287 notices/MPL0, 75 guards/five chunks and 63 diagnostics/23 region guards. Script 697/six historical runs, service/metadata112 and native Rust five actual/all798 compilation retain unchanged on 6,380 available immutable inputs/binary; no Rust repetition. Library/Blur Gallery UI32 guards/two chunks/two styles verify.

Independent verification: 21,211 hashes, 19,310 frozen/21,144 retained/42 evidence/23 production; five changed/one new source/test files, foreign0, 2,933 unavailable historical inputs declared. Writer40379/35e42f and verifier53660/a9917f exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-hit-alpha.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-hit-alpha.json), SHA `f20d33993efabaeb0ecdb6a5335fc44a72cceffa876554b109c6ce56d75fc59d`.

**Next:** sharper Blur Gallery viewport tiles via existing preview/tile APIs, preserving exact filter/color/channel pixels and bounded tile/byte/stale parameter/source/view ownership. High zoom currently stretches <=2048 preview; >16MP computation is unaccepted until safely bounded. Continue whole-frame memory/cancellation, native antialias/path/image/styled-text/effect/overlap/scroll/media/backdrop, retouch/RAW/color/filter/Smart Filter/PSD, history/legacy/recovery, responsive/nested/code export, collaboration/services/assets/scripting and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen. Non-bicubic wide-angle Smart replay and disabled all-white PSD Smart mask import need approved upstream/dependency work. Native IPC/keychain/HTTP/TLS/WebKit and Node22 remain unverified.

Uncommitted. Owner dirty work/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved. No dependencies/locks/canonical catalogs/attribution/tokens/schema/migrations/native registrations/upstream/native Rust/configuration source changes, commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/UI/server launch/process inventory. Prior denials respected. Root/agent writes froze through sequential owned gates/writers/verifiers; all agents/work terminal before logs. Scoped post-log verification follows. Goal active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Cached library revision review

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous Blur Gallery topology turn and this increment classify as verified progress. Owner-authorized cheaper GPT-6 Luna agents implemented catalog/cache metadata and exact-target session review; root implemented/integrated picker/dialog/source guards and independent controller checks/corrections. Existing frontend-design skill/theme controls/tokens retained; no new tokens or art direction.

Saved device/downloaded room libraries expose lazy Revision history with validated chronological metadata, full IDs and current/latest labels. Choosing a revision leaves artwork unchanged; viewers/offline can browse cached versions. Explicit review/apply supports forward/backward targets, existing impact/override/before-after preview and Undo. Personal overrides and removed definitions persist. Catalog head/publications and other projects' pins remain. Checksums/exact predecessor chain, room-scoped IDs/collision/provider rebind, exact returned manifests and async source/binding guards protect reads. Reviews are privately owned/fingerprinted; copies/mutations/foreign/disposed sessions/stale source/room refuse. UI discards late source results and closes stale review dialogs.

**228 tests/18 files and full TypeScript/Vite build pass:** final 82 focus/ten plus 146 collaboration/history/regressions/eight, including 27 new catalog/session/picker/controller cases. Actual SDK graph/cache/review/Undo and one existing offline CanvasKit before-after PNG preview execute; original/native filter-pixel/installed/device acceptance remains open. Initial focus79 pass/three fail preserved: incompatible stale-design error and two wrong new fixture/error expectations corrected. First build failed on overly broad new Vitest mock type; root corrected annotation and reran final focus/build. Surrounding regressions preceded only that test typing correction. No scenarios/tolerances removed. Build8,071 modules,43.88sVite/58.911s wrapper;32 UI guards/two chunks/two styles verify, retaining Blur Gallery UI.

Native-export worker remains one byte-identical3,972,700-byte payload/1,379 unchanged inputs, exact7,159,342-byte WASM,69renderer packages/287notices/MPL0,75guards/fivechunks and63diagnostics/23region guards. Worker execution/React typing and script697/six historical runs retain unchanged; no new worker execution this library increment. Service checks/engine inputs,112metadata and nativefive actual/all798 compilation retain on unchanged native sources/binary/6,380 available immutable inputs; no Rust repetition.

Independent full verification passes21,166 hashes:19,309 frozen,21,097 retained,36evidence,23production outputs;8changed/5new owned source/test files, foreign0,2,933unavailable historical inputs declared. Ten gate receipts terminal,8pass/2preserved failures. Writer12511/f74247 and independent full verifier58883/9aecc4 exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-library-revisions.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-library-revisions.json), SHA `7a6e77b534514315619d48f21ed772b6bd182a24a801f0256533062562a92919`.

**Next:** independently verify CanvasKit Alpha_8 hit-only capture, preserving exact mask path/threshold/coordinates and transformed/nested pixel checks while removing unused PNG/RGBA copies. Read-only agents/root confirm current capture reads/copies4-byte RGBA but path uses alpha only; actual conversion/cleanup/memory parity remains unproven. Then sharper Blur Gallery viewport tiles via existing preview/tile APIs: current <=2048 downsample stretches at zoom; >16MP preview remains unavailable until safely bounded computation exists. Continue all six areas, including native antialias/path/image/styled-text/effect/overlap/scroll/media/backdrop, retouch/RAW/color/filter/Smart Filter/PSD, aggregate memory/cancellation/history/legacy/recovery, responsive/nested/code export, collaboration/services/assets/scripting and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen. Non-bicubic wide-angle Smart replay and disabled all-white PSD Smart mask import need approved upstream/dependency work. Native IPC/keychain/HTTP/TLS/WebKit and Node22 unverified.

Uncommitted. Owner dirty work/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved. No dependencies/locks/canonical catalogs/attribution/tokens/schema/migrations/native registrations/upstream/native/configuration source changes, commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/UI/server launch/process inventory. Prior denials respected. All root/agent source/tests/config/docs/harness writes froze through sequential owned gates/writers/verifiers; follow-up audits read-only and agents terminal before closure. All owned gates terminal before logs; scoped post-log verification follows. Goal remains active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Blur Gallery topology and preview navigation

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous five-mode overlay batch and this increment classify as verified progress. Owner-authorized cheaper GPT-6 Luna agents implemented pure topology helpers/tests and reviewed selection/viewport ownership read-only. Root integrated viewport/UI/controller coverage and corrections. Frontend-design skill follows existing controls/theme/tokens; no new tokens or art direction.

Field/Iris/Spin Blur now add pins directly by double-click or Add pin and delete by keyboard/button, preserving at least one pin. Path Blur inserts into the closest physical-pixel segment and removes points while retaining two. Scalar settings convert explicitly; raw rows/metadata and 256 limits remain. New/adjacent handles receive focus, and selection clamping persists after list shrink. Bounded 1–64× fit-relative zoom, cursor-anchored modified wheel, fit/pan buttons, Space/middle-button pan and +/−/0 shortcuts keep view state out of filter settings. Handle size stays stable and nudges stay original document pixels. Source/capture/busy/cancel/Escape/window-blur safeguards retain exact Preview/Apply parameters; Space release works after focus moves. High zoom uses the existing downsampled preview, not accepted actual-pixel display.

**351 tests/14 files and full TypeScript/Vite build pass:** final 197 focus/seven plus 154 surrounding regressions/seven, including 21 new topology/viewport/React DOM/dialog-mocked IPC cases. The initial build failed on one unused helper local; root removed it and reran focus/build. Subsequent Space-release correction reran final focus/build. Surrounding regressions preceded those two corrections; no scenarios/tolerances removed. Final build 8,070 modules, 45.22 seconds Vite/60.309 seconds wrapper; 18 emitted UI guards and CSS verify. Native filter pixels/original PSD/installed visual/device/assistive-technology acceptance remain open.

Native worker byte-identical 3,972,700 bytes/1,379 unchanged inputs; exact 7,159,342-byte WASM, 69 renderer packages/287 notices, renderer MPL0, 75 guards/five chunks and 63 diagnostics/23 region guards retain. Worker execution/React typing retains from preceding verified chain; no new execution this UI increment. Script 697/six historical executions, service 171, metadata 112 and native five actual/all 798 compilation retain on unchanged native sources/binary/6,380 available immutable inputs; no Rust repetition.

Independent full verification passes 21,123 hashes: 19,304 frozen, 21,057 retained, 38 evidence files and 23 production outputs; six changed/two new owned source/test files, foreign zero, 2,933 unavailable historical inputs declared. Eleven gate receipts terminal, ten pass/one preserved compiler failure. Writer 39238/3fb15c and independent verifier 8967/81f817 exit zero. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-blur-topology.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-blur-topology.json), SHA `651cefb8aaf2fb3b5bc3d2a1825808b5df12f781f4cef8d641c0e3937e7fcfc2`.

**Next:** explicit cached team-library revision selection/review/apply. Root independently confirms validated predecessor history and scoped revision lookup exist, while UI exposes head downloads/latest-only review. Preserve room scope/head, pinned instances, impact/override review and Undo; no silent publication or artwork replacement. Continue native filter/resource/latency/Smart Filter/PSD/RAW/color/retouch and every other six-area requirement: native antialias/path/image/styled-text/effect/overlap/scroll/media/backdrop fidelity, large-project memory/history/legacy/recovery, responsive/nested/code export, collaboration/services/assets/scripting and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen. Non-bicubic wide-angle Smart replay and disabled all-white PSD Smart mask import still need approved upstream/dependency work. Native IPC/keychain/HTTP/TLS/WebKit and Node22 remain unverified.

Uncommitted. Owner dirty work/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved. No dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream/native/configuration source changes, commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/UI/server launch/process inventory. Prior denials respected. All root/agent source/tests/config/docs/harness edits froze during sequential owned gates/writers/verifiers; all terminal before logs. Scoped post-log verification follows. Goal remains active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / On-image Blur Gallery controls

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous scratch-identity turn classified as verified progress; this batch is verified progress. Owner-requested cheaper agents implemented only pure geometry/tests and audited pinned native semantics read-only; root implemented/integrated the overlay, guarded dialog and interaction/controller tests. Agents stopped before gates. Frontend-design skill applied existing controls/theme tokens; no new tokens or art direction.

Field/Iris/Spin/Path Blur and Tilt-Shift now have on-image center, radius, rotation, feather, vertex, focus/transition and amount handles. Geometry follows nonempty selection content bounds or full image, independently of active layer bounds; radii/bands use the shorter operation side. Pointer ownership, captured-offset movement, release/cancel/Escape/window-blur, keyboard precision and busy/source/reset/bounds guards protect local settings. Numeric forms and insertion/removal routes remain. Empty/malformed/oversized imported lists require explicit repair before Preview/Apply instead of native silent fallback. Raw rows/extra metadata stay exact. Fractional numeric/range values validate; generated geometry suppresses IEEE64 residue at fifteen significant digits without rounding unedited authored fields.

**330 current tests/13 files and full TypeScript/Vite build pass:** 176 focused/six plus 154 regression/seven, including 28 new pure/React DOM/mocked IPC/controller cases. All five filters share exact Preview/Apply parameters; selection/letterbox/active-layer independence, multi-pin/path data, Original comparison and serialized stale previews pass. Initial scope 167 pass/nine fail is preserved: four slider validation failures, four generated-float residues and one incorrect default-injection oracle, all corrected without removing scenarios. Native pixel corpus, installed visual/tablet/pressure and actual assistive-technology acceptance are not established by these UI tests. Build 8,069 modules, 44.62 seconds Vite/59.888 seconds wrapper; seven emitted UI/style strings verified.

Native worker retains one byte-identical 3,972,700-byte payload/1,379 unchanged inputs, exact 7,159,342-byte WASM, 69 renderer packages/287 main notices, renderer MPL0, 75 guards/five chunks and 63 diagnostics including 23 region guards. Actual worker execution/React typing retain from preceding verified scope; no new execution this UI increment. Script 697/six historical runs, service 171, UI/default metadata 112 and native five actual cases/all 798 compilation retain on unchanged native sources/binary/6,380 available immutable inputs; no Rust repetition.

Independent full verification passes 21,081 hashes: 19,302 frozen, 21,022 retained prior, 31 evidence files and 23 production outputs; three changed/five new owned source/test files, foreign zero; 2,933 unavailable historical inputs declared. Eight gate receipts terminal, seven pass/one preserved initial failure. Writer 30807/86adac and full verifier 51525/7ab283 exit zero. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-blur-canvas.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-blur-canvas.json), SHA `05904aa7098b2316c6d733fa4b806cb4b41dd8e0b6338a1d6e84a85f5c702549`.

**Next:** direct on-image pin/path insertion/removal, zoom/pan and broader filter/Smart Filter/PSD/native pixel/resource checks; independently audit cached library revision selection before implementation. Continue every six-area requirement, including retouch/RAW/color, large-project memory/history/legacy/recovery, mask/media/scroll/nested/code export and collaboration/assets/scripting/original/installed/device acceptance. Non-bicubic wide-angle Smart Filter replay and disabled all-white PSD Smart Filter mask import still need approved upstream/dependency work. Native IPC/keychain/HTTP/TLS/WebKit and Node22 remain unverified.

Uncommitted. Owner dirty work/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved. No dependencies, locks, canonical catalogs/attribution/tokens/schema/migrations/native registrations/upstream/native/configuration source changes, commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/UI/server launch/process inventory. Prior denials respected. Root/agents source/tests/config/docs/harness edits froze throughout sequential owned gates/writers/verifiers; all terminal before mandatory logs. Scoped post-log verification follows. Goal remains active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Private native scratch identities and transformed hits

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous mask-alpha turn classified as verified progress; this batch is verified progress. Owner-requested cheaper agents audited ID/resources and transformed hits read-only, then identified prospective Blur Gallery canvas-control/library-history work. Root implemented and verified; all agents terminal before evidence closure.

Native animation, endpoint mask coverage and isolated leaf capture now reserve private document/page IDs outside imported semantic/output/snapshot IDs. Four deliberate baseline collisions reproduced existing rejection paths; final identity checks also cover parent/leaf cycles, private-looking imported names, exact native PNGs, stable semantic IDs, valid ancestry and unchanged source. No SDK/global-generator/dependency change. Three allocation fault cases verify endpoint/coverage/blend resources unwind and exact retry succeeds. Three reflected/rotated sampled hit references verify painted interiors/exteriors, hidden targets, visible overflow and locally placed clip wrappers. Exact antialias boundary pixels remain outside this acceptance.

**443 tests in 46 files and full TypeScript/Vite build pass:** 184 focused/31 plus 259 regression/15, including fifteen new cases and twelve existing mask cases added to current scope; 8,067 modules, 44.71 seconds Vite/59.861 seconds wrapper. Actual offline native bundled-worker execution and strict generated React-only typing pass. Nine terminal gate receipts: eight pass/one four-failure baseline. Four cyclic parent/leaf cases were excluded only from the baseline to avoid the SDK's unbounded ancestry walk; all final cases execute. Previous independent rotated/nested/large-frame references retain tolerance two and pass.

Production verifies one 3,972,700-byte native worker/1,379 physical inputs, exact 7,159,342-byte WASM, 69 renderer packages/287 main notices, renderer MPL0, 75 guards/five chunks and 63 diagnostics including 23 region guards. Script-worker 697 exact inputs/six historical runs, service 171 and 112 filter UI/default metadata checks retain unchanged. Native sources/binary/6,380 available immutable inputs unchanged; five actual cases/all 798 compilation retained without another Rust run. Original/device acceptance remains open.

Independent verification passes 21,043 hashes: 19,297 frozen, 20,987 retained prior, 32 evidence files and 23 production outputs; two changed/three new owned source files, no foreign source delta; 2,933 unavailable historical inputs declared. Writer 7816/72cc9e and independent full verifier 37467/baf6c7 exit zero. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-native-scratch-identity.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-native-scratch-identity.json), SHA `a76d2029b05b318016db33e492055203842177565d08b439ed03d3e7745c1950`.

**Next:** validate and implement direct on-image Field/Iris/Spin/Path Blur controls using existing parameter/preview/apply paths, preserving precise numeric forms and pointer/keyboard/busy/source guards. Independently audit cached team-library revision selection before treating it as a required fix; revision ownership/current-head/pinned-instance semantics must remain. Continue antialias-boundary and broader nested/path/image/styled-text/effect fidelity, whole-frame/large-project memory, cancellation/latency and all six areas. Non-bicubic wide-angle Smart Filter replay and disabled all-white PSD Smart Filter mask import still need approved upstream/dependency work. Original/installed/device, native IPC/keychain/HTTP/TLS/WebKit and Node22 remain unverified.

Uncommitted. Owner dirty work/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved. No new tokens, dependencies, locks, canonical catalogs/attribution, schema, migrations, native registrations, upstream/configuration/native source changes, commits, pushes, releases, deployment, packaging, installation, live-profile/production replacement or external sends. Prior computer-use/listen/process-inventory denials respected. Source/tests/configuration/documents frozen during sequential owned gates/writers/verifiers; all terminal before logs. Scoped post-log verification follows. Goal remains active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Native mask coverage and semantic bounds

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. The previous bounds draft's four fidelity failures are resolved and this batch is verified progress. Owner-requested cheaper agents audited geometry/clipping read-only; root implemented and verified. Both stopped before gates.

Private native coverage now preserves affected semantic children's logical boxes while its vector geometry paints the full transformed crop. This matches the native temporary mask-layer context instead of changing it with a crop-sized cover. All four rotated/nested/large-frame references pass with tolerance two and every existing scenario/assertion retained; their seek/source/endpoint/hit checks now execute. Bounded root-grid captures and sub-1 MiB endpoint allocations are accepted with this correction. A new empty-region regression verifies finite geometry, transparent output, no semantic children and unchanged source. Whole-frame artwork/hit allocations still need work.

**416 tests in 43 files and full TypeScript/Vite build pass:** 157 focused cases/28 files plus 259 regression cases/15 files; 8,066 modules, 41.86 seconds Vite/57.257 seconds wrapper. Actual offline bundled-worker execution and strict generated React-only typing pass. Twelve gate receipts terminal: seven pass/five preserved diagnostic failures. Endpoint/high-reference probes localized the difference before blending to white coverage versus semantic artwork; the ineffective native translation-phase experiment and all diagnostic source instrumentation were removed.

Production verifies one 3,971,763-byte native worker/1,378 physical inputs, exact 7,159,342-byte WASM, 69 renderer packages/287 main notices, renderer MPL0, 75 guards/five chunks and 63 diagnostics including 23 region guards. Script-worker 697 exact inputs/six historical executions, service 171 and 112 filter UI/default metadata checks retain unchanged. Native sources/binary/6,380 available immutable inputs unchanged; five actual cases/all 798 compilation retained without another Rust run. Original/device acceptance remains open.

Independent verification passes 21,006 hashes: 19,294 frozen inputs, 20,943 retained prior hashes, 42 evidence files and 23 production outputs; two changed owned files, no added or foreign source changes; 2,933 unavailable historical inputs declared. Writer 73960/59d146 and full verifier 7846/b35a19 exit zero. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-mask-region-alpha.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-mask-region-alpha.json), SHA `9a48b45ebbf0e02f5ff0ae2e64e9aa51eede34b2af5a66ce37cf95a3193f0ae1`.

**Next:** audit endpoint generated-ID collisions with original/legacy graphs; broaden transformed hits, nested/path/image/styled-text/effect coverage and large-resource/cancellation/latency checks. All six areas remain incomplete, including overlapping paint reorder/reflection/skew/scroll/live media/backdrops, RAW/PSD/color, history/recovery, responsive/nested/code export, collaboration/services/assets/scripting and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen. Non-bicubic wide-angle Smart Filter replay and disabled all-white PSD Smart Filter mask import still need approved upstream/dependency work. Native IPC/keychain/HTTP/TLS/WebKit and Node22 remain unverified.

Uncommitted. Owner dirty work/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved. No new dependencies, locks, canonical catalogs/attribution, tokens, schema, migrations, native registrations, upstream/configuration/native source changes, commits, pushes, releases, deployment, packaging, installation, live-profile/production replacement or external sends. Prior computer-use/listen/process-inventory denials respected. Source/tests/configuration/documents frozen throughout sequential owned gates/writers/verifiers; all terminal before logs. Scoped post-log verification follows. Goal remains active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Mask-region bounds draft

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous combined-region batch classified as verified progress. Current batch is unfinished progress: allocation and transformed-reference evidence changed the next action, but four new fidelity tests fail. Owner-requested cheaper agents authored only new references and audited bounds read-only; root corrected/integrated. Both stopped before gates.

Coverage now bounds the affected semantic child trees plus complete endpoint mask trees, including transforms/effect overflow. Empty chains retain identity over child/interaction boxes. Native coverage captures use the selected-root coordinate space and final pixel grid; inverse-parent placement avoids rotated-parent resampling. Endpoint captures skip unused hit/low buffers. Supersampled dimensions round directly at high scale. Two small-mask cases inside3200×3200 frames now render rather than hitting the full-parent coverage refusal. Executed allocator assertions show four final artwork/hit buffers at16 MiB or above, with all endpoint/source/coverage allocations below1 MiB; endpoint high planes65,088 bytes. Whole-frame artwork/hit memory still needs work.

**Current focused scope:152 pass/four fail,156 cases/28 files; TypeScript passes.** The26 existing files pass, including actual offline-worker execution, generated React-only typing and cleanup/path/mask/prototype checks. New independent rotated insertion and nested Boolean/intersection references fail by3 channel levels; large-frame change/insertion fail by4, exceeding unchanged tolerance2. Exact endpoints/common-child identity precede the transformed failures; post-failure seek/source/hit assertions in those new cases have not executed. Current draft is not accepted. No regression suite/build/production update while these failures remain; prior production artifacts remain historical for changed source.

Eleven gate receipts terminal:10 failed attempts/one passing typecheck. Corrected initial local-motion/raster-size oracles to independently interpolated world poses, fixed test-only nullable-parent typing, removed unsuccessful nearest/F16 experiments, and kept every scenario/tolerance. Independent draft verification passes20,962 hashes:19,294 frozen,20,920 retained;2 changed/2 new owned sources, foreign0,2,933 unavailable historical inputs declared. Native source/binary unchanged; prior5 actual cases/all798 compilation retained without Rust repetition. Writer55543/1ded83 and verifier33940/0a4b73 exit0. [Draft acceptance](docs/architecture/xdesign/acceptance-2026-10-14-mask-region-bounds-draft.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-mask-region-bounds-draft.json), SHA `8d8be242734f49d28c3f47480064a0399c7cd09c1a8b02e028c644d1bcc4925b`; machine explicitly records acceptance failure.

**Next:** trace independently measured high-resolution endpoint coverage and semantic-art clipping to resolve3/4-level residual differences before broader/build/production acceptance. The cause remains unproven: nearest filtering, F16 blending and exact dimension rounding did not fix it. Consider complete endpoint-chain/current-art pixel composition while keeping one semantic child, proper overlap ordering, coverage hit paths and aggregate resource bounds; do not silently double-mask or fade. Continue transformed hits, nested/path/image/styled-text/effect/large-resource/cancellation/latency checks and all six areas. Non-bicubic wide-angle Smart replay and disabled all-white PSD Smart mask import still need approved upstream/dependency work. Original/installed/device, native IPC/keychain/HTTP/TLS/WebKit and Node22 remain unverified.

Uncommitted. Owner dirty work/grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved; no new tokens or art direction. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream/configuration/native source changes. Prior computer-use/listen/process-inventory denials respected. Source/tests/configuration/documents frozen through sequential owned gates/writers/verifiers; all terminal before logs. Scoped post-log verification follows. Goal remains active; no Photoshop/Figma completion claim.

## 2026-10-14 — Codex / Combined native mask-region motion

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous lens batch classified as verified progress. Two owner-requested `gpt-6-luna` agents authored the private mask-region registry and independent pixel references; root corrected, integrated and verified. Both stopped before final gates.

Native Smart Animate now supports inserted/removed mask chains, children crossing masked/unmasked regions, splits/merges and consecutive mask intersections. Complete endpoint-chain coverage blends at shared sampled geometry; each semantic child retains one instance. Exact authored endpoints, stable arbitrary-seek IDs, one-sided opacity fades, displayed-alpha hit paths and source serialization pass. Root also corrected same-graph source/destination selection for added/removed branches. Private state is bounded and cloned transactionally; native coverage remains supersampled until final artwork downsampling.

**411 frontend tests/41 files and full TypeScript/Vite build pass** (152 focused/26 plus259 regression/15;8,066 modules,56.45s Vite/74.197s wrapper). Independent alpha/vector/luminance insertion/deletion, moving split/merge, complete two-mask products, one-sided art, hit coverage and allocation references pass within the existing two-level RGBA tolerance. Actual bundled offline worker executes an inserted vector mask; generated React-only typing passes. Two preserved failures caught premature coverage downsampling and hidden helper IDs in hit membership; both corrected without weakening tolerance or removing scenarios.

Production verifies one3,966,895-byte native worker/1,378 physical inputs, exact7,159,342-byte WASM,69 renderer packages/287 notices, renderer MPL0,75 guards/five chunks and63 diagnostics including23 region guards. Blanket mask-membership refusal retired. Script697/six historical runs and service171 retain unchanged. Native sources/binary/6,380 immutable available inputs unchanged; prior five executed cases/all798 compilation retained without repeated Rust.

Independent full verification passes20,922 hashes:19,292 frozen,20,859 retained;6 changed/3 new owned sources, zero foreign source delta;2,933 unavailable historical inputs declared. All10 gate receipts terminal:8 pass/2 fail. Writer76727/037442 and independent verifier95806/6ef4db exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-mask-regions.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-mask-regions.json), SHA `c31dba61e1db391fa7884bb9a26ce1a150860b68fd07ccf5da016927bb8ebb37`.

**Next/open:** independent nested/rotated/Boolean/path/image/styled-text region references, tighter affected-region bounds and large-resource/cancellation/latency measurements; overlapping opaque reorder, reflection/skew/scroll/effects/backdrops and broad raster/font/axis/caret/IME/codec fidelity. Lens solver/output/resource budgets and fast non-lens admission remain. Non-bicubic wide-angle Smart Filter replay and disabled all-white PSD Smart Filter mask import require approved upstream/dependency work. Continue RAW/PSD, history/legacy/recovery, responsive/media/nested/export, collaboration/team/services/assets/scripting and original/installed desktop/tablet/pressure/keyboard/accessibility/export-reopen. Native IPC/keychain/HTTP/TLS/WebKit and Node22 remain unverified. No complete Photoshop/Figma parity claim.

Uncommitted. Owner grid/canvas-first/collapse/double-click Image entry, placements, Companion and dirty work preserved. Runtime fidelity uses existing authored motion; no new UI tokens. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream/configuration edits. Prior computer-use/listen/process-inventory denial respected. Source/tests/configuration/documents frozen through all sequential owned gates/writers/verifiers; all terminal before logs. Scoped post-log verification follows.

## 2026-10-14 — Codex / Lens correction and source geometry

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Previous filter/mask batch classified as verified progress. One owner-requested `gpt-6-luna` agent authored lens metadata/tests; the second audited changing mask coverage read-only. Root corrected, integrated and verified; both stopped before gates.

Image mode now exposes Lens Correction and Adaptive Wide Angle beside the 110 ordinary/gallery actions. Typed native settings include profiles, projection, fringe/vignette/perspective/scale, edge colours and raster interpolation. The source-image editor adds straightening and up to 128 constraints, pixel coordinates, orientation, native curve feedback, pointer/keyboard precision, cancel and external-reset ownership. Empty constraints remain valid for native scaling. Native previews preserve source/history. Smart Objects use bicubic interpolation; apply/preview/setParams reject other choices because the pinned Smart Filter renderer cannot replay them correctly.

**178 frontend tests/eight files, five native tests and full TypeScript/Vite build pass.** All 798 native library tests compile. Current native tests execute 63 lens raster and 18 lens Smart Filter scenarios at 8/16/32-bit depth, plus existing 327 ordinary preview/apply/undo and ten structured Smart Filter scenarios. Exact native-oracle/preview/commit/undo and selection checks pass. First native attempt failed an overly strict outside-selection float assertion; preserved evidence proves about 0.00000003 rounding. Corrected oracle keeps exact native/PNG equality and allows one float epsilon from original channels. No scenario removed. Lens debug scope took 318.50s; installed latency is unmeasured.

Build: 8,065 modules, 56.21s Vite/74.513s wrapper. Production verifies one unchanged 3,950,614-byte native worker/1,377 unchanged inputs, exact 7,159,342-byte WASM, 69 renderer packages/287 notices, renderer MPL0, 75 guards/five chunks and 41 diagnostics. Prior actual native-worker execution/React typing retains through exact input/payload identity. Script 697/six historical runs and service 171 retain. Both current UI manifests match executed defaults: 110 ordinary and two lens actions. Previous 571 frontend cases are historical, not repeated current coverage; 49 prior native cases are historical on replaced binaries.

Independent full verification passes 20,882 hashes: 19,289 frozen, 20,812 retained; eight changed/five new owned sources, zero foreign source delta; 2,933 historical inputs unavailable. Ten gate receipts/nine pass/one fail are terminal. Writer 76531/a1993b and independent verifier 37728/788148 exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-lens.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-lens.json), SHA `f93ab14217f0576e7031a5a345e13bb92f0130b2f45eedf7780ac9301185d6a3`.

**Next/open:** implement combined endpoint-chain coverage for changing mask chains/cross-region/split-merge, preserving one semantic child and matching hit paths; independent agent audit/oracle is in the archive. Keep current structural refusals until proven. Overlapping reordered paint, transforms/scroll/effects/backdrops/raster fidelity, fonts/axes/caret/IME/codecs and installed acceptance remain. Lens projection output/solver/resource budgets, cancellation and measured large-image latency remain; include a fast non-lens admission return before layer lookup in that pass. Non-bicubic wide-angle Smart Filter replay and disabled all-white PSD Smart Filter mask import need approved upstream/dependency work. Continue history/legacy/recovery, responsive/media/nested/export, collaboration/team/services/assets/scripting and original/desktop/tablet/pressure/keyboard/accessibility/export-reopen. Native IPC/keychain/HTTP/TLS/WebKit and Node22 remain unverified. No complete Photoshop/Figma parity claim.

Uncommitted. Owner grid/canvas-first/collapse/double-click Image entry, placements, Companion and dirty work preserved. Existing frontend-design guidance/theme controls and canon spacing reused; no token gap. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream/configuration edits. Prior computer-use/listen/process-inventory denial respected. Source/tests/configuration/documents frozen through all sequential owned gates/writers/verifiers; all terminal before logs. Scoped post-log verification follows.

## 2026-10-14 — Codex / Complete filter catalog and stable native mask runs

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents authored disjoint filter/structured-control and mask-membership slices; root reviewed, corrected and integrated them. Both stopped before central gates. Session started October13; evidence filenames retain that prefix.

Image mode now exposes all110 actions from the pinned ordinary/extended/gallery catalogs, with search, collapsible categories, native numeric/enum/boolean/colour defaults, displacement-map selection and typed kernel/shear/light/pin/path/ordered-gallery controls. Structured overrides restore scalar fallback when cleared; empty/hidden gallery stacks are gated. Native pixel-filter previews retain source/history and16MP/1MiB limits; displacement apply/preview reject non-files and files above512MB. Repeat Last uses the actual session journal directly. Stable ordered native mask runs now allow child additions/removals and destination order while shared children retain their masked/unmasked region and interpolated geometry.

**571 frontend tests/47 files, three native cases and full TypeScript/Vite build pass.** Frontend291 focused/31 plus280 regression/16; native all796 library tests compile,327 default preview/apply/undo scenarios cover109 actions at8/16/32-bit depth, and10 smart-filter scenarios cover structured arrays/full unsigned seeds. Independent native mask references and actual offline worker additions pass; generated React-only typing passes. Build8,063 modules,55.10s Vite/71.322s wrapper. Production verifies one3,950,614-byte worker/1,377 physical inputs, exact7,159,342-byte WASM,69 renderer packages/287 notices, renderer MPL0,75 guards/five chunks and41 diagnostics. Script697/six historical runs and service171 retain unchanged;46 previous native executions are explicitly historical on the replaced binary. Current UI defaults match the compiled native manifest; the gallery type correction emits byte-identical JavaScript.

Independent full verification passes20,839 hashes:19,284 frozen,20,762 retained;11 changed/7 new owned sources, zero foreign source delta;2,933 historical inputs unavailable. Four failed fixture/reference/compiler attempts remain preserved among14 terminal gate receipts/10 pass. Writer57687/61b6f9 and independent verifier94500/e6a2ee exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-14-filters-mask.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-14-filters-mask.json), SHA `c0bdfc9fd1d73c65d063854456ebe528a89d1c2ae5c29dcb283d8eca7641edd0`.

**Next/open:** changing mask chains/cross-region/split-merge combined coverage, overlapping reorder paint, reflection/skew/scroll positioning, live effects/backdrops, large/rotated/nested raster fidelity, zero-axis viewport, fonts/axes/caret/IME, codecs and measured resource/cancellation/latency gates. Other lens/adaptive filter families, canvas spatial controls, displacement source portability and broad PSD acceptance remain; gallery checks establish pinned engine behavior, not proprietary Photoshop visual parity. Disabled all-white PSD smart-filter mask elision requires approved parser/upstream/dependency work. Continue operations/history/legacy/recovery, responsive/media/nested/export, collaboration/team/services/assets/scripting and original/installed desktop/tablet/pressure/keyboard/accessibility/export-reopen. Node22/native IPC/keychain/HTTP/TLS/WebKit remain unverified.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and owner dirty work preserved. Frontend-design skill used existing theme controls/classes/canon spacing; no token gap. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream or configuration edits. Prior computer-use/listen/process-inventory denial respected. Source/tests/configuration/documents frozen through sequential owned gates/writers/verifiers; all terminal before mandatory logs. Scoped post-log verification follows.

## 2026-10-13 — Codex / Native lines, controlled prototypes and Image tool drafts

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two existing owner-requested `gpt-6-luna` agents authored disjoint native-line and numeric-option patches; root reviewed, corrected and integrated them. Both stopped before all central gates.

Horizontal/vertical LINE sampling now preserves exact zero axes, including selected-root geometry, while other types retain their existing size floor. Native own-layer artwork uses finite pixel placement on zero axes. Controlled prototypes accept a parent echo during deferred variable acceptance without cancelling a drag; rollback, rejection/throw, independent external updates and obsolete acceptance retain ownership. Image numeric tool fields preserve replacement drafts and publish valid values immediately; bounds/native units/browser number controls remain, with blur/Enter/Escape/external/disabled/visibility/tool resets.

**419 distinct tests/42 files and full TypeScript/Vite build pass** (139 focused/26 plus280 regression/16;8,059 modules,54.09s Vite/71.291s wrapper). Independent nonempty native horizontal/vertical cap references, exact endpoint/source/seek checks, zero-axis placement, deferred owner outcomes, numeric drafts and actual offline worker horizontal-line execution/strict React typing pass. The regression scope retains unchanged application/configuration and test inputs after unused bindings were removed from one focused-test file. Production verifies one3,950,203-byte worker/1,377 inputs, exact7,159,342-byte WASM,69 packages/287 notices, renderer MPL0,75 guards/five chunks and41 motion diagnostics. Script697/six historical executions, service171 and unchanged native binary/6,380 inputs/prior five actual cases/all793 compilation retain without repeated execution. Initial owner-echo and TypeScript unused-binding failures remain preserved.

Independent full verification passes20,792 hashes:19,277 current frozen,20,733 retained;9 changed owned sources, zero foreign source delta;2,933 historical inputs unavailable. Eleven gate receipts/nine pass/two fail are terminal. Writer1454/3d416d and independent verifier21668/a00d46 exit0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-native-line-options.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-native-line-options.json), SHA `7c853f10bceee5b570c5b2ece20d59f86a584af3e9de45c1a554a143f6c99ce6`.

**Next/open:** selected-root zero-axis prototype viewport/point-line acceptance, changed mask membership, reflection/skew/scroll positioning, live effects/backdrops, large/rotated/nested raster fidelity, unsupported paths/glyphs/fonts, dynamic axes/caret/IME, real codecs/JPEG-WebP fallback and measured resources/latency. Continue Image/RAW/filter/PSD, operations/history/legacy/recovery, collaboration/team/services/assets/scripting and original/installed desktop/tablet/pressure/keyboard/accessibility/export-reopen. Disabled all-white PSD smart-filter mask elision still needs approved parser/upstream/dependency work. Node22/native IPC/keychain/HTTP/TLS/WebKit and browser partial-number/device behavior remain unverified. No complete Photoshop/Figma parity claim.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and owner dirty work preserved; no token gap. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream writes or configuration changes. Computer-use/listen/process-inventory denial respected. Source/tests/configuration/documents frozen through sequential owned gates/writers/verifiers; all terminal before mandatory logs. Scoped post-log verification follows.

## 2026-10-13 — Codex / Native path morphing and raster crop bounds

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents authored path-format and raster-bounds slices; root reviewed, corrected and integrated them. Both stopped before central gates.

Compatible encoded fill/stroke paths now interpolate little-endian float32 coordinates through fixed-size and resized geometry, retaining exact endpoint bytes, fresh buffers, byte offsets and representable overshoot. Geometry no longer disappears from sampling when dimensions stay unchanged. Compatible path paints tween; discrete path paints compose on the same coordinates, including native masks, with private resource inheritance and existing budgets. Direct PNG/JPG/WEBP square-cap bounds now expand in world space;64MP/max-edge admission uses the expanded box, and one transparent private padding node is always removed. Original source/read ownership and procedural export remain.

**395 tests/41 files and full TypeScript/Vite build pass** (8,059 modules,1m29s Vite/109.540s wrapper). Independent quarter/mid/three-quarter native curve/mask/paint/endpoints, actual offline worker encoded paths, strict generated React typing, native cap/crop/transformed-parent references, cleanup, shared-image/resource/procedural/Present/export regressions pass. Production verifies one3,950,043-byte worker/1,377 physical inputs, exact7,159,342-byte WASM,69 renderer packages/287 notices, renderer MPL0,75 guards/five chunks and41 motion diagnostics. Script697/six historical executions, service171 and unchanged native binary/6,380 inputs/prior five cases/all793 compilation retain; Rust not repeated. Independent verification passes20,759 hashes:19,277 pre-final-gate frozen,20,700 retained;2,933 historical inputs unavailable. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-native-path.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-native-path.json), SHA `00009a76b1db4a622413dc563d7bdad148c236982464326f485eb0da21364f5e`. Three failed raster references/frozen versions and a superseded documentation-count candidate remain preserved.

**Next/open:** changed mask membership, reflection/skew/scroll positioning, live effects/backdrops, large/rotated/nested raster fidelity, unsupported path/glyph/font cases, dynamic fonts/axes, caret/IME, real codecs/JPEG-WebP browser fallback and measured resources/latency. Continue Image/RAW/filter/PSD, operations/history/legacy/recovery, collaboration/team/services/assets/scripting and original/installed desktop/tablet/pressure/keyboard/accessibility/export-reopen. Disabled all-white PSD smart-filter mask elision still needs approved parser/upstream/dependency work. Node22/native IPC/keychain/HTTP/TLS/WebKit remain unverified. No complete Photoshop/Figma parity claim.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and owner dirty work preserved; zero foreign source changes. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream writes or new configuration. Computer-use/listen/process-inventory denial respected. Source/tests/configuration frozen through sequential owned gates/writers/verifiers; all terminal before logs. Scoped post-log verification follows.

## 2026-10-13 — Codex / Native mask coverage and live line strokes

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents audited masks/transforms and authored private mask-state/live LINE slices; root reviewed, corrected and integrated them. Both stopped before central gates.

Native React Smart Animate now blends one alpha/vector/luminance coverage plane when a matched mask changes paint, mask type, silhouette, vector topology or Boolean operation. One masked sibling run and intermediate child geometry remain; native hit paths regenerate and exact endpoints restore. Private bounded snapshots/resources survive scratch clones without entering documents. Composed paints inside masks retain their normalized coverage. Centered LINE correction now also reaches the live editor renderer, with reversible/idempotent installation and cleanup on recreation/teardown. Original40-pixel grid and clean exports retain behavior.

**342 tests/35 files and final full TypeScript/Vite build pass** (8,058 modules,1m17s Vite/99.535s wrapper). Independent native mask/type/topology/Boolean/composed-paint/endpoint references, actual offline worker mask motion, strict generated React-only typing, native line/cap pixels and grid/resource/Present/export regressions pass. Production verifies one3,944,993-byte worker/1,376 physical inputs, exact7,159,342-byte WASM,69 renderer packages/287 notices, zero renderer MPL,75 guards/five chunks and40 motion diagnostics including10 mask guards; blanket mask-type refusal retired. Script697/six historical executions, service171 and unchanged native binary/6,380 inputs/prior five cases/all793 compilation retain; Rust not repeated. Independent verification passes20,721 hashes:19,272 pre-final-gate frozen,20,645 retained;2,933 historical inputs unavailable. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-native-mask.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-native-mask.json), SHA `c5601c27c7b4e74c65b3cc951d383c399016979990571d5db8adf1899203e56a`. Initial mask/compiler failures and intermediate successful versions retain terminal receipts.

**Next/open:** native geometry-command coordinate interpolation (typed path blobs still select snapshots), changed mask membership, reflections/skew/scroll positioning, live effects/backdrops, large/rotated/nested raster fidelity, dynamic fonts/axes, caret/IME, real codecs and measured resources/latency. Live hook/native tests do not establish installed UI/device acceptance; broader direct-line export bounds remain open. Continue Image/RAW/filter/PSD, operations/history/legacy/recovery, collaboration/team/services/assets/scripting and original/installed desktop/tablet/pressure/keyboard/accessibility/export-reopen. Disabled all-white PSD smart-filter mask elision still needs approved parser/upstream/dependency work. Node22/native IPC/keychain/HTTP/TLS/WebKit remain unverified. No complete Photoshop/Figma parity claim.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and owner dirty work preserved; zero foreign source changes. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream writes or new configuration. Computer-use/listen/process-inventory denial respected. Source/tests/configuration frozen through sequential owned gates/writers/verifiers; all terminal before these logs. Scoped post-log verification follows.

## 2026-10-13 — Codex / Native group appearance composition

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents authored the ordered appearance helper and reviewed compositor safety; root corrected/integrated it. Both stopped before central gates.

Native React Smart Animate now keeps one intermediate child tree while ordered strokes/shadows/blur interpolate or discrete fill/cap/join styles blend aligned native appearances in premultiplied space. Private WeakMap plans and referenced images survive export/render scratch clones without entering documents. Nested composites materialize from children outward; logical root dimensions, original mask regions and supported live scroll children/offsets remain. Exact endpoint paint restores directly. The native raster adapter fixes centered LINE strokes drawing as rectangles; round/square caps now differ, with expanded diagonal cap bounds. Source documents stay unchanged.

**325 tests/31 files and full TypeScript/Vite build pass** (8,056 modules,1m33s Vite/113.586s wrapper). Independent native midpoint/cap/endpoint references, live scroll/source/seek checks, actual offline worker execution, strict generated React-only typing and renderer cleanup/Present/export regressions pass. Production verifies one3,936,433-byte worker/1,374 physical inputs, exact7,159,342-byte WASM,69 renderer packages/287 notices, zero renderer MPL,75 prior guards/five chunks and31 motion diagnostics including16 composition/mask guards. Script697/six historical executions, service171 and unchanged native binary/6,380 inputs/prior five cases/all793 compilation retain; Rust not repeated. Independent verification passes20,670 hashes:19,267 pre-gate frozen,20,604 retained;2,933 historical inputs unavailable. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-native-composite.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-native-composite.json), SHA `e4e62e6fb5d565e9692c63c8a1850131d51cbf58022b7355d1b4bb44d68b4cb0`. Four failed focused attempts retain terminal receipts/frozen versions.

**Next/open:** changed masks/membership/type/topology, reflection/skew/scroll positioning, live effects/backdrops, large/rotated/nested group raster fidelity, dynamic fonts/axes, caret/IME, real codec playback and measured resources/latency. Native capture LINE correction does not establish installed editor-canvas acceptance. Continue Image/RAW/filter/PSD, operations/history/legacy/recovery, collaboration/team/services/assets/scripting and original/installed desktop/tablet/pressure/keyboard/accessibility/export-reopen. Disabled all-white PSD smart-filter mask elision still needs approved parser/upstream/dependency work. Node22/native IPC/keychain/HTTP/TLS/WebKit remain unverified. No complete Photoshop/Figma parity claim.

Uncommitted. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and owner dirty work preserved; zero foreign source changes. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream writes or new configuration. Computer-use/listen/process-inventory denial respected. Source/tests/configuration frozen through sequential owned gates/writers/verifiers; all terminal before these logs. Scoped post-log verification follows.

## 2026-10-13 — Codex / Native scene motion and reversible drag

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents implemented bounded slices; root reviewed and corrected the integration. Agents stopped for all central gates.

Native React exports now sample fresh scene graphs between prepared endpoints for compatible geometry, vector paths, solid/gradient paint, text metrics and native strokes/effects. Complete routes include overlay positions/backdrops. Worker playback coalesces pending frames, preserves spring overshoot and requires exact endpoint pixels. Built-in drag buffers early release and restores route/session/control/scroll/focus checkpoints on rollback. Temporary frame IDs never enter document scroll history; reset-scroll reaches the destination. Keyboard focus stays on the inert-frame host until interactive controls return. Resize/external controlled updates restore the source and reject obsolete frames without echoing old owner values.

**305 tests/28 files and full TypeScript/Vite build pass** (8,055 modules,1m4s Vite/83.388s wrapper). Actual offline worker execution, independently authored native intermediate PNGs, generated React-only typing, cancellation/recovery, drag commit/rollback and host focus/scroll checks pass. Production verifies one3,919,193-byte native worker/1,372 physical inputs, exact7,159,342-byte WASM,69 renderer packages/287 notices, zero renderer MPL,75 existing guards/five chunks and15 motion diagnostics. Script697/six historical runs, service171 and unchanged native binary/6,380 inputs/prior five cases/all793 compilation retain; Rust was not repeated. Independent verification passes20,630 hashes:19,263 pre-gate frozen,20,562 retained;2,933 historical inputs unavailable. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-native-motion.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-native-motion.json), SHA `647131b23b284b7946d794c275e8f2458bdb696c5fa64b83ba6a36682cfba6c3`. Failed focused/compiler attempts and frozen versions remain recorded.

**Next/open:** child-preserving group paint/effect interpolation, changed masks/reflections/skew/scroll positioning, live effects/backdrops, dynamic fonts/axes, caret/IME, real codec playback and measured latency/resources. Continue Image/RAW/filter/PSD, operation/history/legacy/recovery, collaboration/team/services/assets/scripting and original/installed desktop/tablet/pressure/keyboard/accessibility/export-reopen acceptance. Disabled all-white PSD smart-filter mask elision still requires approved parser/upstream/dependency work. Node22/native IPC/keychain/HTTP/TLS/WebKit remain unverified. No complete Photoshop/Figma parity claim.

Uncommitted. Owner dirty work, grid/canvas-first/collapse/double-click Image entry, placements and Companion preserved; zero foreign source changes. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream writes or new configuration. Computer-use/listen/process-inventory denial respected. Code/tests/configuration frozen through each sequential owned gate/writer/verifier; all terminal before these logs. Scoped post-log verification follows.

## 2026-10-13 — Codex / Native scroll and offline prototype flows

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents implemented disjoint slices; root reviewed, corrected and gated the integration.

Native React export now embeds reachable screens and prepares navigation/back/overlay/swap/close before publication. Repeated overlays keep independent native controls, scroll and focus; close/reopen restores authored scroll history. Sequences, variables/modes, scroll and temporary press/hover rollback retain owner-visible state. Instant/dissolve/slide/move/push transitions use occurrence snapshots with spring/easing and reduced motion. Native own-layer pixels preserve authored order around supported scroll/fixed/sticky/video surfaces; static effect/mask regions and glyphs remain native. Masks avoid duplicate clipping, and selected text roots avoid duplicate DOM glyph paint. Unsupported live effect/mask crossings, external backdrop pixels and fixed overlap receive explicit diagnostics.

Export preflight bounds resources and exact UTF-8/base64 growth, deduplicates/caps font loading, owns image/WASM bytes and checks cancellation/source leases across asynchronous work. Credits cover all reachable screens. Existing Interactive React/Copy/Orion staging/Present/save cancellation retain behavior.

**241 tests/21 files and full TypeScript/Vite build pass** (8,054 modules,1m40s Vite/127.433s wrapper). Actual offline worker execution and native PNG comparisons, generated React-only TSX typing, overlay/control/scroll/focus/held rollback and resource boundaries pass. Final production verifies one3,868,081-byte worker/1,369 physical inputs, exact7,159,342-byte WASM,69 renderer packages/287 notices and zero renderer MPL packages;75 guards span five chunks. Script worker697/six historical runs and service171 retain; unchanged native binary/6,380 inputs retain prior five cases/all793 library compilation, without repeating Rust. Independent verification passes20,591 hashes:19,257 pre-gate frozen,20,501 retained;2,933 historical native inputs unavailable. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-native-flow.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-native-flow.json), SHA `856479117675ab9a2c1320965b85e98a30976a4e86d107e084e197bb7db46216`. Failed attempts remain recorded. Media fixtures prove embedding/ancestry and mocked frame capture, not real codec playback.

**Next:** source-backed native Smart Animate/matched-layer interpolation and drag scrub, live backdrop/effect composition, dynamic fonts/axes and caret/IME/resource/latency acceptance. Continue all six areas including Image/RAW/filter/PSD, operations/history/legacy/large-project recovery, collaboration/team/services/assets/scripting and original/installed desktop/tablet/pressure/keyboard/accessibility/export-reopen. All-white disabled PSD smart-filter mask elision still needs approved parser/upstream or production-dependency work. Node22/native IPC/keychain/HTTP/TLS/WebKit and real media/device/original-file acceptance remain. No complete Photoshop/Figma parity claim.

Uncommitted. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/schema/native registrations/upstream writes or new configuration. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and owner dirty work preserved;zero foreign source changes. Computer-use/listen/process-inventory denial respected. Source frozen through each sequential gate/writer/verifier; all owned work terminal before these logs. Post-log scoped verification follows.

## 2026-10-13 — Codex / Offline source-backed native React export

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents implemented renderer/font slices; root reviewed, corrected, integrated and gated them.

Inspect → Code → Native React now exports one selected root as a React-only TSX archive with its source graph, offline worker/WASM, primary/subset/fallback fonts, initial native artwork, notices and asset credits. Explicit/measured host sizing, variables and component snapshots regenerate constrained geometry, layout and complete artwork together—including gradients/strokes/images/blur/masks/native glyphs. Authored component IDs, explicit child axes and private source ownership stay intact. Public font registration preserves shards across fresh providers and reuses existing bytes. The actual CanvasKit loader uses a local WASM blob through locateFile; its advertised instantiateWasm hook is absent from the shipped loader.

One active render/one replaceable pending request, captured requests and mounted epochs discard stale results. Last successful art/hit geometry survives errors; shutdown/timeout/boot/transport failure release workers/URLs. Export saves retain project/resource ownership, stale-source discard, atomic installed save/browser download and accurate dialog cancellation. Existing Interactive React single-file export, Copy code, Orion staging and normal native Present retain behavior.

**198 tests/13 files and full TypeScript/Vite build pass** (8,048 modules,1m35s Vite/117.574s wrapper). Actual offline bundled-worker execution transfers styled fonts and matches native PNGs; the generated component typechecks with only React. Production verifies one3,849,016-byte worker/1,367 physical inputs, exact7,159,342-byte WASM and69 renderer packages/287 main notices; no MPL package in renderer inventory. Script worker697/six historical runs and compiled75guards/four chunks retain. Native binary/6,380 inputs retain prior five actual cases and all793 library compilation; no Rust gate repeated. Independent verification passes20,529 hashes:19,071 pre-gate frozen plus175 postbuild supplemental inputs,20,276 retained;2,933 historical native inputs unavailable. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-native-react.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-native-react.json), SHA `e7fe45f4d0cea7739d8fe0545e42a922d6ee7bf28bead92ae087732b7a0e95a3`. Failed attempts and terminal corrections remain recorded.

**Next:** integrate source-backed rendering with multi-screen/overlay routing, responsive live media, scrolling/fixed layers and external backdrop composition; preserve current single-file workflow. Dynamic font families/variable axes, full native animation/glyph/style/caret/IME, resolution/resource/latency and original/installed device acceptance remain. Continue all six areas including Image/RAW/PSD/filter, operations/history/legacy/large-project recovery and collaboration/team/services/assets/scripting. All-white disabled PSD smart-filter mask elision still needs an approved parser/upstream or production-dependency change. No complete Photoshop/Figma parity claim.

Uncommitted. No commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/canonical attribution/tokens/migrations/service schemas/native registrations/upstream writes. Local Vite worker plugin and virtual-module declaration are explicit configuration changes. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and owner dirty work preserved;zero foreign source changes. Prior computer-use/listen/process-inventory denial respected; no installed app/browser launch. Source remained frozen through sequential gates/writers/verifier; all owned work terminal before these logs. Post-log scoped verification follows.

## 2026-10-13 — Codex / Responsive React constraints and bounded eraser feedback

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents implement disjoint slices; root reviews, corrects and runs frozen sequential gates.

Standalone React exports now reflow absolute children from immutable authored geometry using pinned MIN/MAX/CENTER/STRETCH/SCALE and group rules. Explicit child bindings, nested frames and filled interactive variants remain coherent through shrink/grow. A supported opaque flat-shape subset uses live CSS; position-only SVG artwork moves with its wrapper. Native Present keeps prepared geometry, normalized selected roots keep export placement, and scene-covered children keep their parent image without separate CSS repaint. Existing live CSS text behavior remains; arbitrary resized baked/vector/image/effect art, unresolved flex-grown dimensions and composed scenes still need native regeneration/resolved geometry and are diagnosed precisely.

Background Eraser skips viewport/parameter/JSON work after the feedback sample cap, clears once per gesture and draws one bounded outline cursor. Full sample/pressure retention, native tiles below limits, one undoable release and existing 131,072/16 MiB commit budgets remain. Repeated long moves yield a single complete6,001-point edit in the integration check.

**346 frontend tests/12 files and full TypeScript/Vite build pass** (8,041 modules,1m16s Vite). Unchanged native binary/6,380 available inputs retain five actual eraser cases and all793 library compilation; no Rust gate repeated. Current compiled75guards, worker697 exact inputs/six retained historical runs and service171 input checks pass. Independent verification checks20,300 hashes (19,058 frozen/20,249 retained),26evidence/20production outputs;2,933 historical native inputs remain unavailable. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-responsive-eraser.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-responsive-eraser.json), SHA `f88e25d119757eb5aaab11be1f4b8ad39e1b862bcbd7a4234143e627dfb0f7a3`. Failed attempts/corrections remain in the archive and receipts.

**Next:** implement source-backed responsive artwork regeneration and genuine full-scene recomposition so temporary export refusals can be removed. Current single-file React exports embed fixed SVG/PNG art; a portable native runtime/asset bundle must use the approved pinned renderer, embedded resources/fonts and existing archive facilities, preserve standalone/local export workflows and licensing, and validate actual resized native output. Host sizing, resolved flex/grid/media/nested-instance behavior and full native glyph/font fidelity remain open. Continue all six areas: advanced native transitions/control/glyph/layout; Photoshop/options/RAW/PSD/filter; operation/history/legacy/large-project recovery; responsive/media/nested/export; collaboration/team/services/assets/scripting; and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen. All-white PSD smart-filter mask elision still needs an approved parser/upstream or production-dependency change.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/resource catalogs/attribution/tokens/migrations/schema/native registrations/upstream writes. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and owner dirty work preserved;zero foreign source changes this increment. All source corrections follow terminal gates; agents remain stopped through evidence/log closure. Prior computer-use/listen/process-inventory denial respected. All owned work terminal before these logs; post-log verification follows.

## 2026-10-13 — Codex / Colour erasers and automatic prototype holds

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents implemented disjoint slices; root reviewed, corrected and gated them.

Image mode exposes Magic Eraser and Background Eraser with native tool options, composite/raster targeting, read-only scratch feedback and one undoable release operation. Background Eraser preserves full coalesced strokes through the native 131,072-sample/16 MiB commit budgets; bounded feedback stops separately. Preview includes distant layer effects when pixel damage lies outside the viewport. Captured project/document/version/view/layer ownership and cancellation guards prevent stale edits.

Prototype automatic delay/media actions remain within temporary hover/press checkpoints; release restores variables/modes/scroll and native bound geometry. Matching source ownership includes actual base/history/overlay route context. A→B→A temporary navigation retains destination rollback; portable local views restore variable/mode session as well as scroll and preserve explicit whole-view supersession.

**316 frontend tests/11 files, five native eraser tests and full TypeScript/Vite build pass** (8,041 modules, 1m28s Vite). All 793 native library tests compile; other native executions remain historical. Production checks retain 75 compiled guards, worker697 exact inputs/six historical runs and service171 without separate executions. Independent verification passes 20,272 hashes (19,058 frozen, 20,213 retained); 2,933 historical native inputs remain unavailable. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-eraser-lease.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-eraser-lease.json), SHA `cf0f9ef80386995fa6e03c8c357add63f1d76641211725da3bda491a48177445`. Failed attempts/corrections remain recorded in the archive and terminal receipts.

**Next:** implement responsive standalone React export from the actual pinned parent/child constraint behavior. Read-only audit confirms fixed child geometry under bound parent resizing. Keep visual artwork and hit targets synchronized; position-only independent artwork can move together, while resized raster/vector/text or composed blur/mask scenes require proven native fidelity, source-backed regeneration or precise refusal until supported. Do not substitute semantic-only reflow for rendered parity. Broader native transition/glyph/layout, responsive/media/nested/export, RAW/options/filter/PSD, operations/history/legacy/recovery, collaboration/team/assets/scripting and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen gates remain. All-white PSD smart-filter mask preservation still needs an approved parser/upstream or production-dependency change.

Uncommitted; no commits/push/releases/deploy/package/install/production or live-profile replacement/external sends/dependencies/locks/resource catalogs/attribution/tokens/migrations/schema/native registrations/upstream edits. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and pre-existing dirty work preserved; no foreign source changes this increment. Root/agents made no source changes during owned gates/writers/verifiers. Prior computer-use/listen/process-inventory denial respected. All owned work terminal before these logs; post-log verification follows.

## 2026-10-13 — Codex / Patch retouch and hover-click prototypes

**Branch:** `validation/alpha-2026-09-14`. Full unbudgeted six-area `/goal` active; no area complete. Two owner-requested `gpt-6-luna` agents implemented disjoint slices; root reviewed, corrected and gated them.

Image mode now exposes Source/Destination Patch with bounded-selection drag, explicit pixel/mask/alpha/Quick Mask targets, replacing native provisional tiles and one undoable commit. Authored/imported prototypes allow hover plus click; source activation supersedes its hold while destination edits retain temporary rollback. Reset interactive components is authorable and FIG-round-trippable; Present resets the exact destination occurrence only after successful model/cache publication, preserving failure/stale recovery.

**317 frontend tests/12 files, three native Patch tests and full TypeScript/Vite build pass** (8,040 modules, 4m16s Vite). All 788 native library tests compile; other native execution remains historical. Production checks retain 75 compiled guards, worker697 exact inputs/six historical runs and service171 without separate executions. Independent verification passes 20,240 hashes (19,056 frozen, 20,169 retained); 2,933 historical native inputs remain unavailable. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-patch-hover.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-patch-hover.json), SHA `e3129083a0afa439e34265c77141d386803b6be4647cd5744bc5d6e4b231d2d6`. Detailed corrections/receipts in the archive.

**Next:** wire the pinned engine's Magic Eraser and Background Eraser into Image mode; read-only audit confirms both are absent from the frontend. Keep central frozen gates and cheaper-agent review. Full native slider/transition/glyph/layout and responsive/media/nested/export, deeper RAW/options/filter/PSD, operations/history/legacy/recovery, collaboration/team/assets/scripting and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/export-reopen remain. All-white PSD smart-filter mask preservation needs an approved parser/upstream or production-dependency change. No such change made.

Uncommitted; no commits/push/releases/deploy/package/install/production or live-profile replacement/external sends/dependencies/locks/resource catalogs/attribution/tokens/migrations/schema/native registrations/upstream edits. Grid/canvas-first/collapse/double-click Image entry, placements, Companion and other dirty work preserved. Owner character catalog/test updates preserved; test changed before the final project-binding freeze, with that version used by the final frontend/build/evidence checks. Root/agents made no source changes during owned gates/writers/verifiers. Prior computer-use/listen/process-inventory denial respected. All owned work terminal before these logs; post-log verification follows.

## 2026-10-13 — Codex / Rosie added as the seventh animated companion

**Branch:** `validation/alpha-2026-09-14`. Owner requested the fitted matte Rosie model in Orion; existing authorization to commit/push companion work continues. Other sessions' dirty and concurrent changes stay excluded.

**Changed:** Added `rosie-stylized` / Rosie to Settings → Characters, with a self-contained 6,584,636-byte GLB and all 20 clip names. Texting remains the main idle; existing summon, request reactions, fidgets and drag behavior apply through the shared controller. The dense unrigged fitted source is reduced from 1,909,852 to 79,999 triangles after welding coincident UV seams; 2K matte atlas, metallic zero and roughness 0.88 retained. Mixamo auto-rigging failed repeatedly, including a connected-mesh retry, with “Unknown error while generating motion.” A local 41-bone humanoid rig uses Blender heat binding and four normalized weights per vertex. Closed gloves stay rigid under their wrists; unweighted thumb/index landmarks calibrate palm orientation, with no invented independent finger deformation. All clips receive anatomical wrist transfer. Texting has a glove surface contact limit; both clap clips also reopen using the donor stroke scaled to glove size. Rosie has a freshly downloaded, distinct standing Angry clip. Original six public GLBs and manifest entries remain exact, including their accepted Texting hashes. Original fitted Rosie GLB SHA remains `00e66a7229715baa5f7d765bab72d04e3550e5f0209709a29362bd3990af9c03`; source Blender project/4K atlas not edited.

**Verified:** 23 focused Vitest cases/seven files pass; the asset cases were rerun successfully after the final glove correction. Eleven Node cases pass, including all seven hand skins at 120 Hz through contact clips and Rosie's Texting. Original-six installer retains Rosie; Rosie installer verifies source/bake/repair hashes and all 20 names. Picker selection renders Rosie; browser review sampled 60 poses across all 20 clips with finite geometry, and final Texting/clap front/profile views were inspected. Packed final Blender copy reimports 20 corrected actions/41 bones with Texting selected: `scripts/characters-src/rosie-companion-2026-10-13/exports/rosie-companion-ready.blend`. Browser-only hydration alerts reflect missing native IPC; installed desktop acceptance is not claimed. Full typecheck is blocked by concurrent unrelated XDesign changes: initially `PrototypePreviewDialog.tsx:185`, then `PhotoStudio.tsx:425/428`; no companion diagnostics. No broad build/native gates, dependencies, migrations or token changes.

**Next/open:** owner visual review of Rosie in the dev app; optional future true finger geometry/rig would be needed for independent fingers. Placement review for Kneeling/Female Dynamic Pose/Sitting Clap/Falling remains explicit. Original-six mislabeled Angry/kneeling findings are unchanged. Reproducible preparation, local rigging, baking, hand repair, installer and guide are tracked; source masters/donors/reports/review stay in ignored `scripts/characters-src/`. Only this session's files and this entry are included in the authorized companion commit/push.

## 2026-10-13 — Codex / Mushroom doll: fitted puffy-sleeve matte project

**Branch:** validation/alpha-2026-09-14

Owner requested the same treatment as the approved Rosie asset for `~/Downloads/fashion doll 3d model.glb`, using `~/Downloads/Cybernetic_Mushroom_Puffy_Sleeves`. Delivered an editable [Blender project](scripts/characters-src/mushroom-puffy-stylized-2026-10-13/project/mushroom-puffy-stylized.blend), [GLB](scripts/characters-src/mushroom-puffy-stylized-2026-10-13/project/mushroom-puffy-stylized.glb), flat 4K color atlas and five view previews. Pink sleeves/top and accents, pearl cap/hair/boots, pale skin and charcoal cargo surfaces are matte; original PBR material/images and proportions are retained. Six references are packed, profile labels match the pack, and the shape-key fit is adjustable. Reference side hems differ from the front; a blended rigid sleeve-depth offset preserves inflated fabric cuffs/concealed hands. [Recipe/limits](scripts/characters-src/mushroom-puffy-stylized-2026-10-13/README.md).

**Verified:** source SHA unchanged; all 1,886,183 triangles and indexed UVs preserved, intended fitted positions within 1.49e-8 source units, normals/container/embedded atlas valid. Project reopens pixel-identically with packed assets; reimported GLB differs by at most one channel value (99.898% identical pixels). Sampled average front/profile span errors are 0.317%/0.895% of character height, including intentional cuff preservation. No perfect all-angle claim for generated references. No broad app gates needed.

**Next/open:** owner visual review; dense static source still requires retopology/rigging for animation or companion integration. No app integration/dependencies/migrations/tokens. Pre-existing dirty work preserved. Uncommitted; no commit/push/release/production replacement authorized.

## 2026-10-13 — Codex / Overlay isolation, RAW sensor checks and filter masks

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Two owner-authorized `gpt-6-luna` agents implement bounded patches, with root review and central validation. Repeated overlays now have independent native controls, values, focus, models and scroll identities; temporary/drag checkpoints and failed-swap recovery preserve the right occurrence. Existing close/reopen scroll history remains; fresh controls reset, and explicit reset/Restart clear history. Smart-filter masks expose enabled state with an accessible explicit-state command and legacy/absent handling. Original generated DNG sensor/fallback fixtures validate exposure/orientation/default/profile behavior; they are not real-camera/original acceptance.

**255 distinct frontend cases/fourteen files and native6 pass; all785 lib tests compile.** Final158 focused plus97 regressions; five RAW cases include the previously filtered PNG comparison and two generated DNG cases, plus one live mask metadata/render case. Full TypeScript/Vite build passes: **8,039 modules / 2m27s Vite /180.50s wrapper**. Production AST75/three chunks and exact worker697 inputs/six historical executions/one copy retain; service171 exact engine inputs retain. Failed fixture/selector gates, native test enum mismatch and compiler lookup narrowing are retained and corrected between terminal gates.

**19,054 frozen /20,205 total /20,147 retained prior hashes**; ten owned sources/two new/eight changed prior. Two unrelated Companion catalog/test changes from another owner are preserved and captured before the final RAW/point-binding freezes and final build. Native binary158,500,080 bytes SHA `eab59cd0fc0007f3919e22f2eac57c6a794a61d31063f49c1b333f2b55f9540c` executes6; older32 executions remain historical and2,933 historical inputs unavailable. Writer11300/eb0c66 and separate verifier90539/3ae4fc exit0; machine SHA `f74cea65e7b1247cefd352ab379e9027f8fd2780c06e6f36b18fc36f5260e86d`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-overlay-sensor.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-overlay-sensor.json). Prior affine PNG execution prose is explicitly corrected; its sealed machine remains unchanged.

**Next:** bounded non-instant same-screen overlay paint-ownership acceptance (source audit finds generated capture keys already distinct), PSD/native save-reopen mask-state acceptance and the pinned all-white disabled-mask import edge. Cross-variant identities, full native/portable motion/glyph/style/caret/layout and dynamic scroll/fixed/backdrops remain. All Image/options/retouch/RAW/filter/PSD, operations/history/legacy/recovery/resources, responsive/media/nested/export, verified collaboration/team/assets/scripting and original/installed desktop/tablet/pressure/IME/font/keyboard/accessibility/export-reopen gates remain active. RAW demosaic/WB, aggregate resources/latency/ownership/cancellation and installed IPC/keychain/HTTP/TLS/WebKit/Node22 remain unverified.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalogs/attribution/tokens/migrations/schemas/registrations/upstream edits by this increment. Grid/canvas-first/collapse/double-click Image entry/placements/Companion and other dirty work preserved; no token gap. Prior computer-use/listen/process-inventory denials respected. Both agents stay stopped during central gates/writers/verifiers. All owned gates/writers/verifiers terminal before mandatory logs; post-log scoped verification follows.

## 2026-10-13 — Codex / Cybernetic girl: fitted matte Blender project

**Branch:** validation/alpha-2026-09-14

Owner supplied `~/Downloads/cybernetic girl 3d model.glb` and selected `~/Downloads/rosie-pack-02-no-hands` as the proportion reference. Delivered a self-contained editable [Blender project](scripts/characters-src/cybernetic-girl-stylized-2026-10-13/project/rosie-stylized.blend), [GLB](scripts/characters-src/cybernetic-girl-stylized-2026-10-13/project/rosie-stylized.glb), 4K flat color atlas and five camera previews. Front widths/profile depths guide an adjustable shape-key fit; original proportions, UV topology, source PBR material and packed source textures remain available. Final materials use matte charcoal, uniform skin/off white and flat graphite, with no normal map/metallic sheen. All six reference images are packed. [Recipe/limitations](scripts/characters-src/cybernetic-girl-stylized-2026-10-13/README.md).

**Verified:** all 1,909,852 triangles and indexed UV coordinates preserved; exported fitted positions within 3.73e-9 source units. Original GLB SHA unchanged. Project reopens pixel-identically with packed assets/cameras/shape key; reimported GLB render differs by at most one channel value (99.92% identical pixels). Average sampled front/profile span errors are 0.125%/0.301% of character height; this is an approximate multi-view fit, not a perfect all-angle match of the inconsistent generated references. Initial embedded-image sampling failure was fixed by explicitly loading extracted originals. No broad app gates needed.

**Next/open:** owner visual review; dense static source still needs retopology/rigging before animation or companion integration. No app integration, dependencies, migrations or token changes. Pre-existing dirty work preserved. Uncommitted; no commits/pushes/releases/production replacement authorized.

## 2026-10-13 — Codex / Parallel affine controls and RAW import

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Owner explicitly requests cheaper subagents; two `gpt-6-luna` agents implement disjoint geometry/RAW slices, with root review and central frozen validation. Sliders/progress now carry rotated/reflected parent geometry through native pixels and portable CSS while preserving authored origins and the previous axis-aligned baseline. RAW Open offers sensor-import exposure/orientation with closed options, default codec limits, cancel/validation/duplicate-submit/retry/project guards. Embedded-JPEG fallback rejects non-default settings it cannot honor; successful sensor warnings reflect selected settings. Demosaic/white balance remain defaults. Current retained smudge already exists; the initial historical-document gap finding is corrected, with no duplicate implementation.

**240 distinct frontend cases/thirteen files pass; ten new.** RAW14 pass in initial mixed gate and retain exact inputs; corrected geometry/export93 plus other133 pass. Initial failures expose a duplicate test name, SDK reflection-before-rotation decomposition, then an unwanted axis-aligned range-origin shift; corrected without weakening the baseline. **Native RAW2 pass; all782 lib-test sources compile** via `cargo test --lib --offline xdesign_photo::tests::raw_ -- --test-threads=1`,65.34s wrapper. **Evidence correction:** generated PNG equivalence compiled but was filtered out (`plain_png_` name); the original execution claim is incorrect and the next sensor gate includes it explicitly. No sensor RAW/original fixture ran here. **Full TypeScript/Vite build passes:8,037 modules/2m7s Vite/155.89s wrapper.** AST75 guards/three chunks; worker697 exact inputs/six historical executions/one copy and service171 engine inputs retain without separate runs.

**19,052 frozen/20,174 total/20,127 retained prior hashes**; twelve owned sources,three added,nine changed prior; no foreign source delta relative to last record. Other owner work/dirty files remain. Current rebuilt native binary158,300,160 bytes SHA `f14fba2318fbab60faa2992016550bb27bc7e92abb8dd3a28ab3ae57c196bfb7` executes the two new cases; priorNative30 remain historical on replaced binary and2,932 older Rust cache inputs unavailable. Complete native provenance/installed acceptance not claimed. Writer5143/4627e1 and separate verifier29596/b16411 exit0. Machine SHA `9371da58bd242d1053bfcd2bc7cb6eaf03155433c8561d9b6a7c97c95151629b`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-affine-raw-import.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-affine-raw-import.json).

**Next:** cheaper-agent read-only proposals for independent generated sensor-RAW acceptance and repeated-overlay/control identities; approve bounded disjoint patches, then centrally freeze/gate. RAW demosaic/WB, cross-variant identities, native-pixel animation scrubbing/full glyph/style/caret/layout, live media/scroll/fixed/backdrops/portable responsive composition and aggregate memory/CPU/latency/ownership/cancellation remain. All broader Image/options/filter/PSD, operations/history/import/legacy/recovery, collaboration/team/services/assets/scripting and original/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/FIG export-reopen six-area gates remain active. Installed IPC/keychain/HTTP/TLS/WebKit and Node22 unverified.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalog/attribution/tokens/migrations/schemas/native registrations/upstream edits. Grid/canvas-first/collapse/double-click Image entry/placements/Companion preserved; no token gap. Prior computer-use/listen/process-inventory denials respected. Subagents stop all editing during central gates. Earlier root-stage log-only check exits before source checks because a concurrent owner prepends PROGRESS; that entry is preserved, and new entry-scoped verification replaces the top-line assumption. All current owned gates/writers/verifiers terminal before mandatory logs; post-log scoped verification follows.

## 2026-10-13 — Claude / Rosie character: smooth faceless face

**Branch:** validation/alpha-2026-09-14

Owner supplied a new Tripo GLB of Rosie (`~/Downloads/robotic character 3d model (1).glb`) plus reference `~/Downloads/rosie-pack-02`, asking to refine it starting with the face (should be smooth, no features). Delivered `~/Downloads/rosie-v2-smooth-face.glb` and a before/after sheet beside it. Nose, lips, eye sockets, chin pouch, painted lips/brow/smudges and pink paint on fringe strands are gone. The fringe rides out with the new face, so nothing clips. Only head positions/normals, two degenerated lip-pocket triangles and the three textures changed; skin, joints, UVs and nodes are byte-identical. Tools and an exact rebuild recipe are in `scripts/characters-src/rosie-face-2026-10-13/` (re-run reproduces the GLB byte-identically). No app integration.

**Open:** the source rig is unusable: joint nodes have no rest transforms, about 1/3 of the vertices are weighted only to `root`, and split vertices disagree on their weights. Re-rig before companion use. Next refinement candidates vs reference: solid swept fringe and curlier ponytails, paler/cooler skin tone, and the rest of the body. Uncommitted; no deps/migrations/tokens.

## 2026-10-13 — Codex / Masked controls, drag and component roots

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Mask clipping now reaches live variants, including nested control keyboard targets. Actual native drag commit/rollback/cancel workflows restore controls and variable checkpoints. Fresh component/set roots enter private snapshot/font/layout preparation before capture; stable authoring root keys, realized dimensions, rotated placement, independent snapshots and authoring defaults survive. Empty sets and oversized fresh expansion fail before instantiation. Grid/canvas-first/collapse/double-click Image entry/placements/Companion/dirty work preserved; no token gap.

**223 distinct frontend cases/eleven files pass; nine new.** Twenty-six native-engine/Node/JSDOM workflows include seven new masked/instant-drag/fresh-root cases with independently prepared full PNG comparisons and source preservation. The ten-file197 regression execution includes two new root/limit cases. Full `npm run build` passes through TypeScript/Vite: **8,037 modules / 3m1s Vite / 204.20s wrapper**. Production AST70 guards/three chunks verifies; exact worker697 inputs/six prior executions and service171 engine inputs retain. Native30 remain historical; 2,932 previous Rust cache inputs unavailable, retained binary verifies. No installed/device/IME/original/Smart Animate scrubbing acceptance claim.

**19,049 frozen / 20,152 total / 20,121 retained prior hashes**; five changed XDesign inputs, no new foreign source changes relative to the last host record. Previous foreign/dirty work remains preserved. Writer68857/ec723e and separate verifier94720/bb581a exit0. Machine SHA `b568c7ef0ae8fa592473563f4e6eccd5ad64d1e4dfb134cb3fad5a80fdfadae6`. Three owned gates pass sequentially on the initial frozen implementation; the first freeze-helper seed typo fails before writing, then is corrected before gates. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-scene-control-roots.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-scene-control-roots.json).

**Owner steering:** explicitly requested cheaper subagents to accelerate the goal. After this increment's implementation/gates/writer/verifier finished, two `gpt-6-luna` agents completed read-only audits: affine controls and Image gaps. Affine thumb/range coordinates are currently scalar; that agent now owns the geometry/export/runtime fix and focused tests, with central gates pending. The Image agent's deeper source review corrects its first historical-document finding: current untracked/frozen source already implements retained smudge with extent-sensitive rollback; only identity-less preview retains the2,048 cap. That agent now reviews actual failure/retention/cancellation defects, then current RAW/filter/PSD options if none are established. No duplicate smudge implementation or broad builds.

**Next:** affine slider/range geometry and verified Image defects/options; canonical cross-variant/repeated-overlay identities; native-pixel animation scrubbing/full glyph/style/caret/layout fidelity. Live media/scroll/fixed/backdrops, portable responsive compositor/router/host, whole-scene numeric animation and aggregate memory/CPU/latency/ownership/cancellation remain. All Image/options/retouch/RAW/smart-filter/PSD, operations/history/legacy/import/filesystem/crash/restore/upgrade/resources, responsive/media/nested/export, verified collaboration/team/services/assets/scripting and originals/installed desktop/tablet/pressure/IME/fonts/keyboard/accessibility/FIG export-reopen six-area gates remain active. Installed IPC/keychain/HTTP/TLS/WebKit and Node22 unverified.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalog/attribution/tokens/migrations/schemas/native registrations/upstream edits by this increment. Prior computer-use/listen/process-inventory denials respected. Subagents are now explicitly owner-authorized for following work; none participated in these sealed implementation gates. All owned gates/writers/verifiers terminal before this mandatory log edit; post-log scoped verification follows.

## 2026-10-13 — Codex / Hosted native control presentation

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Present now routes control snapshots through private fonts/layout/native pixels and active semantic trees. Explicit host + validated component properties admits live controls; portable diagnostics remain. Covered controls omit duplicate artwork. Same-route updates keep input elements/focus usable; route/session identities reject obsolete preparations before React cleanup. Restart and temporary/drag checkpoints restore controls with variables/legacy values. Variable/scroll actions preserve temporary holds; explicit navigation ends them. Hold cleanup retains its document/window targets. Valid behavior Booleans may serve only disabled/accessibility state. Grid/canvas-first/collapse/double-click Image entry/placements/Companion/dirty work preserved; no new token gap.

**214 focused frontend cases/eleven files pass**, **19 new native-engine/Node/JSDOM workflows** across all fifteen kinds. Complete native PNG comparisons, actual Unicode glyph-ID/font input checks, hover/press/focus, grouped visibility/ranges, stable inputs, async latest publication/failure/retry, temporary variables/controls and pending Restart pass. Existing132 affected cases pass; four of63 old controller expectations initially fail on added helper arguments, then all63 pass after a test-only correction. Initial fixture/reference/source-sync/font/global/timing failures are retained; queued SDK authoring sync settles before the preservation baseline. Native-pixel drag/masked-control combinations and installed/browser/caret/IME/original fidelity remain open. Installed Heiti TC/Apple Color Emoji inputs are read-only; fonts are not copied/redistributed.

**Full TypeScript/Vite build passes: 1m22s / 8,037 modules**,108.23s wrapper. AST69 guards/three chunks; exact worker/697 inputs/23 packages/285 notices retain six prior executions. Service171 exact inputs retain. Native30 remain historical: **2,932 prior Rust cache inputs unavailable** after pause; retained binary/available inputs verify, without a new native gate or complete current-input claim. Main bundling includes worker generation; no separate worker/native/service compilation/execution.

**19,049 frozen / 20,141 total / 20,031 retained prior hashes**; seven changed prior XDesign sources/one new file,40 evidence/20 production outputs. Thirty-four separate changed sources/eight added/one removed character source are preserved. Writer66760/092230 and independent56180/e2332f exit0; machine SHA `746b4cd5c48dced2bcc6ba7dd635c2febad907d4e169f807a629aa00e170942f`. Pauses respected; scoped interrupted sources match on resumption. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-13-scene-control-host.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-13-scene-control-host.json).

**Next:** native-pixel drag/masked controls; fresh component/set snapshot roots; canonical cross-variant/overlay identities; affine ranges and full glyph/style/caret/layout fidelity. Live media/scroll/fixed/backdrops, whole-scene numeric animation, portable responsive composition/router/host and aggregate font/native/JS/canvas memory/CPU/latency/ownership/cancellation remain. All Image/options/continuous retouch/RAW/smart-filter/PSD, operations/history/import/legacy/filesystem/crash/restore/upgrade/resources, responsive/media/nested/export, verified collaboration/team/services/assets/scripting and original/installed six-area gates remain active. Desktop/tablet/pressure/IME/fonts/keyboard/accessibility/FIG export-reopen, installed IPC/keychain/HTTP/TLS/WebKit and Node22 unverified.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalog/attribution/tokens/migrations/schemas/native registrations/upstream edits/subagents by this increment. Prior computer-use/listen/process-inventory denials respected; no bypass. Other authorized sessions' changes/commits remain untouched. All owned gates/writers/verifiers terminal before this mandatory log edit; post-log scoped verification follows.

## 2026-10-13 — Codex / Gesture palm orientation and clap contact repaired

**Branch:** `validation/alpha-2026-09-14`. Owner confirmed the palm angles looked better, then reported the clapping hands passing through each other. Companion commit/push authorization continues; paused-session work stays preserved and excluded.

**Changed:** Extended anatomical wrist/finger transfer to all 19 non-Texting clips on six characters. Clapping/Sitting Clap and the currently mislabeled Angry clip use actual skinned palm/finger surfaces to keep the hands on opposite anatomical sides. Stable downward elbow bends and 60 Hz contact keys prevent crossings between keys; the limit preserves reopening. Full hand rigs begin from donor wrist spacing; Demon begins from its original wrist paths and receives the surface constraint without donor spacing. Other gestures retain their arm positions. Updated six hashed GLBs, manifest provenance, installer, reproducible gesture repair and documentation. Accepted Texting channel definitions and sample bytes remain exact; all mesh/skin/texture/bone definitions, non-hand body channels and non-contact arm channels are preserved. Ragdoll remains removed.

**Verified:** 19 focused Vitest tests/six files, 11 Node tests and `npm run typecheck` pass. Real-asset regressions preserve all six accepted Texting hashes, compare clapping/waving palm normals with the donor, bound clapping rotation steps and replay all 18 contact clips at 120 Hz, including samples between baked keys. Selected hand surfaces stay separated and reopen on every rig; smallest gap is about 1.35 mm. All 114 non-Texting character/clip pairs sampled at seven points remain finite and within about one degree of donor palm orientation. Browser comparisons show corrected waves, pointing, surprised gestures and clapping; all 18 final contact reactions return to full-weight Texting. Updated result gallery is left open at `scripts/characters-src/companion-hand-library-2026-10-13/gallery.html`. All pre-existing dirty-file hashes match the baseline; no dependencies, migrations, tokens or native build/install.

**Next / limitations:** Owner trial of the final contact correction. The audit's wrong Angry download and kneeling-grounding issues remain separate repairs; Demon's independent five-finger motion still requires reskinning. Preserved Blender masters predate the baked repair; import the corrected GLBs or run the documented repair pipeline. No design-token gap. Commit and push only this companion patch and this progress entry.

---

## 2026-10-13 — Codex / Other companion animations reviewed

**Branch:** `validation/alpha-2026-09-14`. Owner asked to check the remaining animations after accepting Texting. This pass reviews all 19 other clips on six characters; no GLBs, runtime source, triggers or accepted Texting tracks changed. Companion commit/push authorization continues for the review documentation, excluding paused-session work.

**Found:** Angry duplicates Sitting Clap in all six GLBs; the cached FBX files also decode to identical animation tracks, so the source download must be replaced. Anatomical palm orientation remains roughly a quarter-turn from the donor on Fox/Angel/Robot/Pigtail outside Texting; Clapping/Sitting Clap show crossed wrists or forward-facing palms, and Surprised/Kneeling Pointing also need hand review. Kneeling grounding varies: Angel floats above its standing baseline; Fox's tail/body reaches below it. Sitting Clap/Falling remain context-dependent manual clips; Female Dynamic Pose retains its intentionally floating forward-bent pose and requested fidget mapping. Demon's partial thumb/index hand rig still needs reskinning for independent five-finger motion.

**Verified / artifacts:** All 114 character/clip pairs sampled at seven times (798 poses); bone transforms and 256 skinned vertices per pose remain finite. Browser gallery renders all 19 clips across six full-body/hand views with extra early/late checks for key gestures. All 114 reactions run through the actual CompanionAnimator at 30 Hz and return to full-weight Texting without sticking. Findings and limits are in `docs/companion-animation-review-2026-10-13.md`; gallery/script/JSON are local under ignored `scripts/characters-src/animation-audit-2026-10-13/`. No broad builds, new dependencies, migrations or tokens. Existing dirty-file hashes remain unchanged.

**Next:** Replace the incorrect Angry download, transfer the remaining hand gestures anatomically with contact correction only where appropriate, then fix kneeling floor contact and review native framing. Preserve the accepted Texting keys and the removed ragdoll. This audit is complete; these repairs remain outstanding. Commit/push only the report and this entry.

---

## 2026-10-13 — Codex / Accepted anatomical Texting grip repair

**Branch:** `validation/alpha-2026-09-14`. Owner rejected the camera-facing wrist adjustment and accepted the new source-grip comparison. Existing companion commit/push authorization continues; paused-session changes stay preserved and excluded.

**Found / changed:** Mixamo bone names did not guarantee matching hand bind orientations: Pigtail's palms differed from the motion donor by roughly a quarter-turn. Replaced the runtime Sad Idle finger substitution with an offline transfer of Texting's actual palm orientation and local finger bends in anatomical bind frames. Read inverse-bind transforms without altering posed bones or dropping non-bone parents. Baked arm rotations with two-bone IK to match source wrist spacing at each character's hand size while preserving limb lengths and the original gesture center. Updated all six hashed GLBs, manifest provenance, installer, regeneration script and documentation. Only Texting arm/wrist/finger quaternion channels change; the other 19 clips, remaining body motion, geometry, textures, bone definitions and skin weights are preserved. Companion, picker, clip tester and Blender imports now use the same baked grip. Ragdoll remains removed.

**Verified:** 19 focused Vitest tests/six files, eight Node retargeting tests and `npm run typecheck` pass. Asset tests compare both palms at 3/10/20 seconds to source-donor normals and exercise all 120 clip bindings/deformations. Source-alignment checks sampled the wrists through the clip; bind/skin/texture data and all non-Texting animations match their baseline exactly. Browser comparisons cover all six rigs; Orion's actual dev frontend loads the repaired Pigtail, and the owner accepted its front-view comparison. Unrelated dirty-file hashes match the saved baseline. No dependencies, migrations, tokens or native package build/install.

**Next / limitation:** The accepted Texting repair is complete. Demon still has only thumb/index chains per hand; independent motion of its remaining fingers requires reskinning. Preserved Blender masters predate the repair; import the corrected GLBs or run both repair scripts after rebuilding. No new design-token gap. Commit and push only this companion patch and the prior local ragdoll-removal commit.

---

## 2026-10-13 — Codex / Remove ragdoll and relax Texting hands

**Branch:** `validation/alpha-2026-09-14`. Owner requested scrapping the ragdoll and reported the fingers still looked wrong mainly during Texting in the dev app. Companion commit/push authorization continues; unrelated dirty work is preserved and excluded.

**Changed:** Deleted the articulated ragdoll and its tests. Dragging now moves the upright widget while normal playback continues; fling-to-dismiss, hide, click-to-chat, long-hold suppression, 60fps drag positioning and proactive drag suppression remain. Kept a small authored-bone rotation buffer to prevent attention offsets accumulating on sparse clips. Reduced excess canvas drawing room after removing body swinging. All six characters' runtime Texting clips now use their own relaxed Sad Idle finger pose with 15% of imported thumb motion; body, wrist, arm movement and other animations remain intact. Picker and clip tester use the same preparation without mutating cached clips. Built-in model loads use manifest-hash URL versions to replace stale loader-cache entries; custom URLs stay intact. Updated companion documentation. Raw GLBs and the prior offline axis repair are unchanged.

**Verified:** 24 focused Vitest tests/seven files and `npm run typecheck` pass; four hand/pose/cache cases reran after a type-only guard correction. Actual six-rig Texting samples at 3/10/20 seconds keep relaxed fingers stable and geometry finite; all 120 authored clip bindings still pass. Browser hand comparisons cover all six characters. On `http://localhost:1420` (the dev frontend), dragging moves the widget while the body group's position/rotation stay zero during hold/release. No native build/install, dependencies, migrations, tokens or model-file changes. Native inspection selected an older installed app; it is not evidence for the owner's dev build.

**Next / limitation:** Owner visual acceptance of the gentler Texting pose is pending; do not claim every rig defect is solved. Demon's original finger weights are unusable and its Mixamo hand rig still has only thumb/index chains, so clean independent five-finger motion needs reskinning. Original model files and Blender masters remain untouched. No new design-token gap. All paused-session files and its character-orb removal remain uncommitted and unchanged.

---

## 2026-10-12 — Codex / Original-rig finger retargeting repaired

**Branch:** `validation/alpha-2026-09-14`. Owner's companion commit/push authorization continues; unrelated dirty work remains preserved and excluded.

**Found / changed:** Fox, Angel and Robot still have their original 30 finger bones and skin weights. Their palms differ from the Mixamo donor by roughly 90 degrees; the old world-space transfer preserved bend amounts but sent those bends sideways. Corrected only their finger quaternion keys in all 20 clips using anatomical palm/finger bind frames (600 rotation channels per character). Added a reproducible offline repair script, safe shared-accessor/sampler handling, updated hashed GLBs/manifest, installer default and companion documentation. Preserved the original downloads/canonical assets and pre-repair Blender masters. The corrected GLBs are the handoff for updated finger motion; rebuilding old masters requires rerunning the repair.

**Verified:** Four Node regression tests, 25 focused Vitest tests/seven files and `npm run typecheck` pass. Real-asset checks establish anatomical bend axes on both hands of the three original rigs, all 120 clip bindings/deformations, ragdoll bounds/recovery and unchanged reactions. Compared 59 geometry/skin/image data sets and 17,520 non-finger rotation/position/scale tracks against canonical assets; all unchanged, with animation timing and node/skin/material/mesh definitions preserved. Browser close-ups compare both hands during Texting, and the corrected Fox loads in Orion's frontend. No native package rebuild/install, dependencies, migrations or tokens.

**Next / limitation:** Demon, Mushroom and Pigtail's existing Mixamo GLBs are byte-for-byte unchanged. Demon's original GLB has no usable finger weights; its replacement rig has only thumb/index chains per hand. Full five-finger articulation needs a separate hand reskin. Mushroom's supplied skin was malformed; Pigtail's supplied FBX had no skeleton. No new design-token gap. The paused session's files and character-orb removal remain untouched and uncommitted.

---

## 2026-10-12 — Codex / Grab-point ragdolls, texting idle and additive request reactions

**Branch:** `validation/alpha-2026-09-14`. Owner's companion commit/push authorization continues; the paused session's dirty work is preserved and excluded.

**Changed:** Restoring authored bone poses before procedural offsets fixes repeated head/spine rotation on sparse clips. Grabs choose a body joint from the clicked mesh's skin weights and anchor the surface point, with gravity, damped joint limits and release recovery. Playback pauses during holds. Expanded drawing room preserves framing and click-through outside the widget; dragging uses DOM positioning and 60fps rendering, idle remains 30fps, and long holds no longer open chat. Texting While Standing is the main idle. Silly Dancing, Joyful Jump, Female Dynamic Pose and Sad Idle join existing fidgets. R.O.S.I.E requests add Kneeling Pointing at start, Clapping on success, Rejected on refusal/error and Surprised when the final response asks for input. Greeting, Talking, existing fidgets and Angry (before Rejected on errors) remain. Priority reactions now finish in sequence.

**Verified:** `npm run typecheck`; 25 focused Vitest tests across seven files, covering all six actual rigs/120 clips, long-hold bounds, head/hand/foot anchors, release recovery, request outcomes, preserved reaction ordering, drag rendering and chat suppression. Frontend browser preview confirmed a steady head during a prolonged hold, foot-anchored hanging/swinging, recovery, retained widget position and outside click-through. No native package rebuild/install, dependencies, migrations, tokens or GLB changes.

**Next / open questions:** Optional owner tuning after trying the behavior. Surprised uses the completed R.O.S.I.E response asking for input; no separate provider permission-wait state exists. No new design-token gaps. The other session's character-orb removal and all unrelated work remain untouched and uncommitted.

---

## 2026-10-12 — Codex / Six animated companions replace the built-in library

**Branch:** `validation/alpha-2026-09-14`. Owner authorized committing and pushing this companion replacement; unrelated dirty work is preserved and excluded.

**Changed:** Fox, Demon, Mushroom, Angel, Robot and Pigtail replace the eight retired runtime models. Each self-contained GLB has 20 Mixamo clips; Fox is the default and every character starts with Sad Idle. Shared playback preserves error/proactive/summon reactions, quiet fidgets, drag inertia and hidden-canvas pausing. Independent skeletons prevent picker/companion interference; model-space anchoring preserves jump height across rig axes, and viewport-aware framing keeps wings visible. Retired selections fall back to Fox; existing custom uploads remain available. The clip tester exposes all 20 clips and resets its index on character changes. Added a hashed runtime manifest, verified local installer and `docs/companions.md`.

**Verified:** `npm run typecheck`; 11 focused Vitest tests across five files, including actual binding/deformation of all 120 clips, idle recovery, priority reactions, rig anchoring and saved-selection behavior. Full frontend browser preview: all six selections loaded without model errors; clip tester opened via its shortcut, Sad Idle and Joyful Jump rendered on Angel with wings inside the companion canvas. Native SQL persistence is covered by store tests; the packaged desktop app was not rebuilt or installed. No dependency, migration or design-token changes.

**Next / open questions:** Optional owner tuning of event mappings; placement-specific clips remain manual in the tester. No new design-token gaps. Local Blender masters and original downloads remain intact. The other session's existing character-orb removal and all unrelated changes remain uncommitted.

---

## 2026-10-12 — Claude / Screenshot pass 2: quiet focus, glass buttons, skill picker, prose wrap, Forge neon restored

**Branch:** validation/alpha-2026-09-14

Owner re-sent seven screenshots (copies in `/tmp/ot-shots/`, temp only). This builds on the parallel session's uncommitted explorer-anchor and Providers work; none of that was reverted except the Forge wireframe, which the owner asked to undo.

- **Blue outlines (Spotlight, R.O.S.I.E, terminal/tabs):** `workstation.css` gave every input, textarea and select in Spotlight, R.O.S.I.E, the rail and more a 2px `--neon-cyan` focus ring. Text fields always match `:focus-visible`, so it showed on every click. Buttons now get a 1px ink ring, and fields get a border change only (new "Quiet focus" rule). Cyan/green/violet focus borders and glows are neutral in `tokens.css` (Rosie, Claude input, search, settings, MCP, prompt, git commit box, focused-panel tab line), `controlpanel.css` (`.cp-input`), `settingsExperience.css`, `themeExtras.css`, `customThemes.css`, `skillIntake.css` and `incubator.css`. The active pane tab is underlined in ink instead of cyan (`workstationApps.css`).
- **White buttons → Liquid glass (`workstation.css`):** workstation primaries, Settings `.cp-btn`/primary/`.pm-install`, the skill-intake button, the Claude send button, `.cc-send` and Brain's Ask Claude get a translucent ink gradient, top rim, shadow and blur on Liquid only (blur skipped under `.ot-reduce-glass`).
- **Skill picker (`features/intake/SkillTurnPicker.tsx`, `skillIntake.css`):** `--f-ui` was undefined, so text fell back to the wrong font. It is now a compact bordered row: chevron, "Skill for this turn", value on the right. It expands into a small label and a 30px select. The test was updated to the label/value spans.
- **"AI section overlays the editor" (`apps/orion/Editor.tsx`):** pane resizing itself is correct (harness: the rail pushes the editor 827→527px with no overlap). The cause was `wordWrap: "off"` everywhere, so Markdown/text lines ran under the rail. Prose now wraps by default; ⌥Z toggles wrap per editor.
- **Agent Forge (owner: revert, keep neon here):** removed the parallel session's `.forge` wireframe override block. `.forge-btn` is no longer forced white (`settingsExperience.css`), so its violet→cyan gradient is back. On Liquid, `.forge` re-scopes the original vivid Liquid `--neon-*` values so the de-neon doesn't reach it.

**Verified:** tsc clean; 220 focused tests pass (intake, orion, controlpanel, workspace, styles). A harness style board (Liquid, real CSS) shows the glass buttons, the collapsed/expanded skill picker and ring-free focused Spotlight/R.O.S.I.E fields. Forge restore, prose wrap and ⌥Z were not visually checked; nothing checked in the native app.

**Open:** BMW M/Minimal untouched. Other app-local focus colors (XDesign `--xd-accent`, downloads green) are neutralized only where the shared rules win.

Uncommitted (this batch not yet authorized). Note: `src/features/intake/` and `materials.css` are untracked work from earlier sessions, so committing this batch's picker/focus edits there also means committing those files.

## 2026-10-12 — Claude / Providers toggles, Agent Forge wireframe, character orbs, Orion explorer anchor

**Branch:** validation/alpha-2026-09-14

Owner notes (Oct 12): providers "way cleaner… even just a toggle for each", remove the orbs around characters, Agent Forge "clean wireframe" instead of neon, Orion panes "hard to drag… if you close one everything resizes weird… explorer should always just be a fixed size and can't be closed so that can be the anchor". Appearance and Archives: keep as they are.

- **Providers (`ProvidersPanel.tsx`, `ProviderConnectionToggle.tsx`, `controlpanel.css` `.cp-prov*`):** one quiet row per provider: name, chevron, `ot-switch`. Sign-in/keys/image model/Remove fold under the chevron. A row opens by itself only when an API provider still needs a key. The toggle no longer asks to confirm, because switching off is reversible: chats, settings and credentials are kept, and it never signs out of CLI accounts. The subscription/billing paragraph is now one line inside each provider's details. Background AI consent is unchanged.
- **Characters (`CharacterCanvas.tsx`):** removed the WireframeCore icosahedron shells; `WireframeCore.tsx` deleted (unstaged). `color` prop kept optional for callers.
- **Agent Forge (`controlpanel.css`, scoped `.forge`):** hairline monochrome wireframe from `--t-primary` via `color-mix`. No glows, gradients, spinning reticles or scanlines, and the emblems are monochrome. The Skill Library still has the old emblems (not asked). The Forge button keeps Settings' ink style. No new tokens.
- **Orion layout (`Workspace.tsx`, `workspaceStore.ts`, tokens.css `.ot-anchored-row/.ot-explorer-anchor`):** the explorer leading a row now renders outside the resizable group at a fixed 240px. The other panes resize beside it. It can't be closed as a tab or panel, hidden (⌘B now "Focus Explorer"), dragged out or dropped into. A closed pane's share goes to its nearest non-anchor neighbour (`absorbRemoved`) instead of re-flowing every pane. The group re-lays out from the store when panes open or close. Layouts saved without an explorer get it back on the left at hydrate. The AI rail still snaps closed.

**Verified:** `tsc --noEmit` clean. 55 focused tests in 10 files pass (workspace, controlpanel, characters), with toggle tests rewritten and four new anchor tests. Driven the real UI on a private Vite server with headless Chrome and a Tauri stub (in-memory providers table, demo project; scratchpad only):
- Providers render as 4 toggle rows.
- Characters show no orbs; Forge renders as a wireframe.
- In Orion the explorer measures 240px. Dragging the editor/rail divider moved only those two (740→590, 297→447). Closing the rail gave all of its space to the editor (1038) with the explorer unchanged.

Not verified in the native Tauri app.

**Next / open:** whether the Skill Library should get the same wireframe emblems. The explorer width is fixed at 240px, so make it a setting if the owner wants. Earlier open items still stand (screenshots #2/#4/#5).

Uncommitted (no commit authorization for this work). Pre-existing dirty work in `controlpanel.css`, `tokens.css`, `AgentForge.tsx` and others preserved; no dependencies, migrations or tokens.

## 2026-10-12 — Claude / Orion resizing, Brain wireframe, Liquid de-neon

**Branch:** validation/alpha-2026-09-14

Owner screenshot pass (Oct 8 captures). The five temp screenshots were already purged by macOS; #1 (Orion resizing), #3 (Brain) and the global neon note were actionable from the text. **#2, #4 ("blue highlight too much") and #5 were not identifiable; ask the owner to re-send them as saved files.**

- **Panel resizing (`src/components/workspace/Workspace.tsx`, `workspaceStore.ts`):** `onLayout` used to commit to the store on every pointer move, re-rendering every pane and writing SQLite twice per frame. Sizes now commit when a drag ends (160ms debounce otherwise), and `setSplitSizes` no-ops on unchanged or unknown splits. The divider is a real 11px grab zone above its neighbours, because the library's coordinate hit margins fail next to the Preview iframe, which takes the pointerdown. Iframes get `pointer-events: none` while dragging. Double-click resets the split to role sizes (`preferredSizes`: explorer 16, claude 24, terminal 30, rest shared). Explorer and AI rail snap closed past their minimum and are stashed (⌘B/⌘J restore). Minimums are by role (editor 20%). Dividers are neutral: hover and drag show a 3px ink bar, no cyan.
- **Brain (`src/apps/archives/brain/BrainView.tsx`, tokens.css `.ar-brain*`):** replaced neon additive-glow gyroscope spheres with a monochrome annotation wireframe after the owner's Pinterest reference. Hairline links, hollow junction circles, mono labels in ruled paper-filled boxes with `.type` suffixes, a shape marker per type, collision-culled hub labels, fit-to-view zoom (wheel overrides it; double-click empty space restores it), and selection brackets with a coordinate readout. Faint construction arcs sit on a dot-grid sheet. Ink and paper read `--t-primary`/`--bg-0`, so light themes work. DOM chips and the detail rail are monochrome and keep the soft theme radii.
- **Liquid de-neon (`themes.css`, `LiquidLens.tsx`, `renderThemeSpheres.ts`):** retuned the existing Liquid `--neon-*`/`-rgb` values, glow shadows and `--xd-accent-rgb`, and dimmed the aurora. The global focus ring is neutral ink. Recorded in `design/DESIGN.md`. No new tokens. Light-theme divider hover is no longer cyan.

**Verified:** `tsc --noEmit` clean. 273 focused tests / 40 files pass (workspace, archives, styles, theme, settings), including 3 new resize tests. A throwaway Vite+Playwright harness (`/tmp/ot-harness`, mocked graph/db, not in repo) screenshotted Brain in Liquid and Ivory, and drove the real Workspace: a 400px drag across an iframe in one gesture with 3 renders and 1 commit, explorer snap-closed and stashed, and double-click reset. Not verified in the native Tauri app.

**Next / open:** get screenshots #2/#4/#5 re-sent. XDesign keeps Figma blue `#0d99ff` for selection and was deliberately left alone; it may be what #4 meant. Decide whether to extend no-neon beyond Liquid (Minimal is already pastel; BMW M untouched). About 25 files still hard-code Phase A neon hex, mostly canvas, syntax or semantic; not swept. Pre-existing uncommitted `themes.css`/`workstation.css` edits were preserved.

Committed and pushed as `e65f322` (owner-authorized), with only this session's hunks staged; earlier sessions' uncommitted work stays uncommitted in the working tree. No dependencies, migrations or new tokens.

## 2026-10-12 — Codex / Private control snapshots and shared runtime resolution

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. React and private native preparation now share control values/variant selection. Optional font/model snapshot APIs prepare text/Boolean assignments, state/dynamic axes, grouped selection and disabled inheritance before fonts/layout; range/thumb/indicator and child geometry finish after layout. Static axes, authoring defaults, unrelated property assignments and placement names survive private swaps; variant-specific property IDs map by name/type. Saved state/value and expansion/traversal bounds reject malformed inputs and missing parts. **Live composed-control admission stays disabled:** the publication/focus/session host is the next increment. Source serialization, grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens/dirty work preserved.

**132 focused frontend cases/nine files** pass on final frozen source, **23 new** across all fifteen standard kinds. New cases establish generated SDK graph/state/boxes/defaults/source preservation, not composed live pixels, newly assigned glyph pixels or originals/installed UI. Initial21 pass; after terminal receipt, kind validation/default selection/cross-variant mapping add two cases. Final23 +109 affected cases and **full npm build exit zero** pass: **2m 1s / 8,034 modules**, 146.17s wrapper. AST verifies68 guards/three chunks and exact worker payload/697 inputs/23 packages/285 notices; prior six worker/thirty native/171 service executions retain exact inputs/binary/engines. No separate worker/native/service gate or compilation; required main bundling includes worker generation.

**21,971 frozen / 23,021 total / 22,990 retained prior hashes**, two changed prior sources/two new files, fifteen replaced outputs, ten evidence/twenty production outputs. Corrected writer51695/14659d and independent32093/82c10c exit zero. Machine SHA `2ef02b2e0d4a2cbaa95758a7fa7bc4a6e2f65cb94cd8efdf98a1efc97ccedd73`. Initial record writer stops before publication on a service-summary count/map mismatch; corrected lookup verifies hashed engine inputs, with source/gates unchanged. Final focus artifact reused the initial name; initial21 receipt is retained explicitly from terminal tool output, without claiming an unchanged historical log file. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-scene-control-state.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-scene-control-state.json).

**Next:** control callbacks, cache revision/coalescing, atomic matching pixel/semantic publication, stable focused inputs, Restart and reversible/drag/session restoration, then native admission. Fresh component/set snapshot roots, cross-variant child identities, arbitrary affine range/text/glyph/style fidelity, general defaults/raw imports/slot dependencies/partial selections/nested navigation remain. Media/scroll/fixed/backdrop composition, whole-scene numeric animation, portable responsive compositor/router/host, aggregate resources/ownership and all Image/options/retouch/RAW/smart-filter/PSD, operations/history/import/legacy/filesystem/crash/restore/upgrade/resources, collaboration/team/services/assets/scripting and original/installed six-area acceptance remain active. Desktop/tablet/pressure/IME/fonts/keyboard/accessibility/FIG export-reopen unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream edits/subagents. Prior computer-use/listen/process-inventory denials respected. Independent character-asset entry and pre-existing dirty work preserved. All owned gates/writers and the independent verifier terminal before this log update; scoped post-log verification follows.

## 2026-10-12 — Codex / Private nested component properties and ordinary scene composition

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Private export/presentation graphs now materialize explicit text/visibility assignments and assigned nested instance swaps before fonts, variables, layout and capture. Dependency closure resolves local/component/library/source aliases and copies swap defaults. Same-target swaps preserve realized overrides and custom slots. Prepared ordinary components join native group effects; live controls, damaged references and unknown fields retain diagnostics. Fresh component-root instances prepare before export. Selected ancestry rejects invalid chains before dependency lookup, and duplicate child references fail before property mutation. Source serialization, grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens/dirty work preserved.

**109 focused frontend cases/8 files** pass on final forest source, **14 new**. Native generated-geometry pixels match a separately constructed SDK-rendered scene; covered navigation/visibility/source preservation and fresh roots are covered. Newly assigned text glyph pixels, originals and installed UI are not established. Initial combined/isolated/trace gates reach real 120/300/90-second deadlines; probing identifies the malformed editor-ancestry fixture. Private fixture isolation/restoration and early source ancestry validation pass. Compiler-only nullable assertion erases to identical JavaScript. Earlier corrected build passes tsc then reaches its actual 600-second Vite deadline; only unfinished Vite repeats and passes 3m 10s. Final review then rejects repeated child references and adds a regression. Final twelve component/ninety-seven affected cases and **full npm build exit zero** pass: **4m 31s / 8,033 modules**, 339.28s wrapper. Earlier candidate remains historical. Recorded timeout groups are already absent; no process inventory/bypass.

Final freeze **21,969**, **23,007 total / 22,937 retained prior hashes**; six declared prior source/docs changes, two new files, fifteen replaced production outputs, forty-five evidence/twenty production files. Writer 2661/1e8261 and independent read-only 36696/0e440f exit zero. Machine SHA `f89302a9e21195d74694e5cff6a0bf53484cbd5d926dc823b9ae292f4862c26b`. Production AST checks fifty-six guards/three chunks. Exact worker payload/697 inputs/23 packages/285 notices retains six prior executions; required main bundling includes worker generation, with no separate worker gate. Native thirty/service 171 retain scoped inputs/binary/engines without execution/recompilation. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-scene-components.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-scene-components.json).

**Next:** feed live control variants/values/hover/press/focus/ranges/groups/parts/text entry into native pixels and semantics together; preserve identity, focus, Restart, drag/hold restoration and async publication. General defaults/slot dependencies/raw unnormalized imports/partial selections/expanded-child identities/nested navigation remain broader component/export work. Media/scroll/fixed/backdrop composition, numeric scene animation, portable responsive composition, aggregate resources, authored geometry/typography/glyph/color fidelity and all Image/options/retouch/RAW/smart-filter/PSD, operations/history/import/legacy/filesystem/crash/restore/upgrade/resources, collaboration/team/services/assets/scripting and original/installed six-area acceptance remain active. Desktop/tablet/pressure/IME/fonts/keyboard/accessibility/FIG export-reopen unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream edits/subagents. Prior computer-use/listen/process-inventory denials respected. Independent character-asset entry and pre-existing dirty work preserved. All owned gates/writers and the independent verifier terminal before this log update.

## 2026-10-12 — Codex / Native composed masks and semantic clipping

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Native private presentation composition now handles alpha/vector/luminance/group masks, consecutive unions, following sibling ranges, nested masks and current variable values. Solid color/paint/layer alpha stays multiplicative; vector coverage becomes opaque. Bounded native coverage generates private SVG clip definitions. Native path intersections remove fully clipped keyboard targets, combine nested masks and preserve visible overflow beneath outside containers. Semantic text/source IDs/navigation stay available; mask sources and duplicate artwork are omitted. Static masked React export and real-engine Present reveal/hide/Enter/Restart are covered. Authoring serialization, grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens/dirty work preserved.

**199 focused frontend cases/14 files** pass across frozen executions, **22 new**. Complete independently calculated rectangle RGBA and every ellipse alpha pixel versus hit path pass. Actual controller uses cached CanvasKit/rendering in Node/JSDOM; browser pointer/device/accessibility acceptance remains open. Initial nineteen passes/six failures expose temporary white-layer metadata leakage, lost solid alpha and a missing fixture fill; corrected twenty-one passes/one failure needs paint on the fixture target. Final Present two and affected regressions 171 pass. Initial compiler exits 2 on test tuple spread; type-only assertion preserves exact emitted JavaScript. Corrected npm build passes TypeScript, then reaches its real four-minute Vite execution deadline (124/-15). Only unfinished Vite repeats, passing **2m 27s / 8,032 modules** (148.75s wrapper); whole npm build is not claimed exit zero. No passing broad-suite/TypeScript/native/service/worker rerun.

Initial freeze **21,966**, subsequent three **21,967** inputs. **22,958 total / 22,907 exact retained prior hashes**; eight expected prior source/docs changes, four added files, fifteen replaced production outputs, twenty-two evidence/twenty production files. Writer 80163/1e196a and independent read-only 10691/f891ec exit zero. Machine SHA `cc487a6cfa887f05fdbeb03741f08426d5e03425663dcfc027d5bee4cc908a03`. Production AST checks forty-two guards/three chunks, one exact worker/697 inputs/23 packages/285 notices. Native thirty/service 171/worker six retain exact scoped inputs without execution/recompilation. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-scene-masks.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-scene-masks.json).

**Next:** component/property/control and live media/scroll/fixed/backdrop scene state, numeric subtree animation and portable responsive composition; zero-size/arbitrary-effect mask semantics and authored geometry/typography/color-space fidelity. Capture/path/source limits do not prove aggregate memory/CPU/latency/cancellation or permanent/alias/async ownership. All Photoshop options/continuous retouch/RAW/smart-filter/PSD, operations/history/import/legacy/filesystem/crash/restore/upgrade/resources, responsive/media/nested/export, verified collaboration/team/services/scripting and authored/installed six-area gates remain. Desktop/tablet/pressure/IME/fonts/keyboard/accessibility/FIG export-reopen remain unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream edits/subagents. Prior computer-use/listen/process-inventory denials respected; no sockets/bypass. Independent character-asset entry and pre-existing dirty work preserved. All owned gates/writers and the independent verifier terminal before this log update.

## 2026-10-12 — Codex / Native presentation layout and binding geometry

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Private presentation graphs now resolve native horizontal/vertical/grid layout with exact available fonts, settle wrapped text, resize vector/glyph/path geometry and apply nested frame constraints. Explicit child bindings win; scalar stroke weights stay fixed during ordinary resizing. Uniform and individual corner/border bindings agree regardless of insertion order. Invalid geometry, contradictory limits, unavailable fonts and nonsettling layout fail before publication. Prepared semantic boxes match composed artwork without a second CSS layout. Owned font providers, global text measurement, surfaces and buffers restore independently after faults. Root backdrop blur retains an explicit external-scene diagnostic. Grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens/dirty work preserved.

**467 distinct frontend cases/35 files** covered by passing executions; **TypeScript/production build passes** (Vite **2m 19s / 8,030 modules**, 166.47s wrapper). Twenty-eight new cases include thirteen geometry, thirteen actual CanvasKit/SDK layout, one real-engine Present/controller and one backdrop diagnostic. Five full decoded RGBA/dimension comparisons match independent SDK layout/export. Present tests use real native initialization/rendering and bundled fonts in Node/JSDOM, not installed desktop/device acceptance. Initial interruption, focused failures and unused-type-import compiler failure are retained. Only affected failing checks repeat; emitted JavaScript proves the final type-only correction. No broad regression, successful build or native/service/worker execution repeat.

**21,963 frozen / 22,930 total / 22,872 exact retained prior hashes**; six expected prior source/docs changes, six added source/test files, fifteen replaced production outputs, twenty-nine evidence/twenty production files. Machine SHA `43c6ed7367fc405c71d840ab31dd856c6fc3fac202aab7a93450151601d1068d`; independent read-only 97383/8aa2ff verifies all hashes/branch/scoped whitespace. Writer 88207 completed its sealed artifact; truncated tool output leaves its original terminal chunk unavailable, and re-poll reports an unknown handle. It was not restarted and no exit receipt is invented. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-scene-layout.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-scene-layout.json).

**Next:** dynamic full-scene component/property/control/media/mask/scroll/fixed/backdrop state, numeric subtree animation and portable composition; arbitrary viewport reflow, authored/rotated/zero-size/path-text geometry and concurrent font ownership. All Image/options/continuous retouch/RAW/smart-filter/PSD, operation/history/import/legacy/filesystem/crash/restore/upgrade/aggregate-resource, responsive/media/nested/export, verified collaboration/team/services/scripting and authored/installed six-area gates remain open. Desktop/tablet/pressure/IME/fonts/keyboard/accessibility/FIG export-reopen remain unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream edits/subagents. Prior computer-use/listen/process-inventory denials respected; no sockets/bypass. Existing independent character-asset entry and all pre-existing dirty work preserved. All owned gates and the independent verifier terminal before this log update.

## 2026-10-12 — Codex / Mixamo Sad Idle on three characters

**Branch:** validation/alpha-2026-09-14

Independent character-asset task: imported the owner's three Downloads GLBs, downloaded Mixamo Sad Idle through the already signed-in local Chrome session, and prepared a packed-texture Blender scene with all three animated at 30 fps, frames 1–121. Fox and demon retain their 61-bone rigs with baked retargeting. The stylized character's original skin distorted during animation; a fresh 65-bone Mixamo auto-rig fixes it, with the original retained hidden for reference. Accidentally exposed glTF Icosphere bone-display helpers caused the covering orb; corrected imports and upload/export files hide/exclude those helpers. Initial unsaved Blender contents are preserved in `previous-unsaved-window.blend`.

Finished scene is open in native Blender; visible playback and successive frames verified. [Asset index](scripts/characters-src/mixamo-sad-idle-2026-10-12/README.md) links `characters-sad-idle-ready.blend`, three `*-sad-idle-verified.glb` files, and Blender/Mixamo screenshot proof. Each verified GLB was re-imported and checked at first/middle/last frames; midpoint dimensions match within 3 cm. Structural checks confirm one mesh/skin, one four-second clip and unique animation channels. GLB clip labels renamed to `Sad Idle` while preserving binary buffers. Earlier ACTIVE_ACTIONS exports produced invalid third-character transforms; those attempts/logs are retained, and the index directs users to the passing SCENE-baked exports only. Original Downloads GLBs unchanged.

**Next:** character asset task complete. Orion integration or additional animations require a new owner request; the existing six-area rebuild objective and its open gates remain unchanged. No new design/token questions.

Uncommitted. Generated assets/scripts are under the existing ignored `scripts/characters-src/` path; this entry is the only tracked edit for this task. No application code, dependency, migration, commit, push, release or production replacement; pre-existing dirty work preserved.

## 2026-10-12 — Codex / Prepared native scene text and variables

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Private presentation snapshots now resolve current session colors, dimensions, actual stroke weights, opacity, visibility, inherited/explicit modes and font choices. Detaching resolved private bindings prevents native color resolution from rereading saved definitions; authoring bindings/definitions/serialization stay exact. Present awaits private font preparation and discards stale work on restart/unmount. Exact per-node/styled-run faces and ready glyphs guard native text capture. Owned font providers/caches release independently after faults and restore the active provider. Covered semantic text/runs preserve languages, geometry, accessible navigation and Enter; paint restores when coverage ends. Grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens/dirty work preserved.

**439 distinct frontend cases/32 files** covered by passing executions; **TypeScript/production build passes** (Vite **1m 23s / 8,027 modules**, 103.01s wrapper). Fifteen new cases: ten actual locked CanvasKit/SDK pixel/session/font/provider/fault cases and five synthetic DOM/controller cases. Initial 435 passes/two failures; scoped corrected 88 passes/one failure; final 27 passes. Broad run itself fails and is retained. Restart expectation and unavailable-font fixture corrected; remaining failure exposes SDK documentFontStatus excluding its queried text root. Per-node exact-face admission fixes production. First build stops at two missing-this-annotation errors in one test callback; Vite does not run. Type-only annotation correction preserves exact reconstructed passing test input and byte-identical emitted JavaScript. No broad-suite or successful-build repeat. Four 21,957-input freezes; all frontend/compiler/build checks sequential and every gate terminal before corrections. Production AST verifies seventeen guards/three chunks and one exact worker/23 packages/285 notices. Native 30/service 171/worker 6 retain exact scoped inputs without execution/recompilation.

**21,957 frozen / 22,893 total / 22,847 exact retained prior hashes**; ten expected prior source/docs changes, one added test, fifteen replaced production outputs, eighteen evidence/twenty production files. Writer 71853/e4a4fb exits zero; machine SHA `7cf9f62a6aaef75684669627cbb7c04a5b7b6aebf4b90e27273c092630d1fcec`. Independent read-only 47517/8a05b6 verifies all 22,893 hashes/branch/scoped whitespace. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-scene-state.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-scene-state.json). Historical evidence and initial failures preserved.

**Next:** general variable vector/text-path dimension scaling, constraints/independent corners/borders/invalid geometry; live font fallback/provider concurrency; dynamic full-scene media/component/property/control/layout/mask/scroll/fixed/backdrop state and smooth-corner hit regions; numeric full-subtree Smart Animate and portable compositor/router/host. Generated sRGB native text/paint pixels and mocked Present font boundaries do not establish authored geometry/typography/color spaces, browser/assistive technology/device acceptance or aggregate CPU/memory/latency/pressure. Cache/alias/async/permanent-release ownership remains open. All Image/options/continuous retouch/RAW/smart-filter/PSD, operations/history/import/legacy/filesystem/durability/reservation/crash/operator restore/upgrade/non-Unix/codec/preview/aggregate resources, responsive/media/nested/export, verified connected collaboration/team/services/scripting and authored/installed six-area gates remain. Installed IPC/keychain/HTTP/TLS/WebKit/UI/media/Node22/desktop/tablet/pressure/IME/font/keyboard/accessibility/FIG export-reopen remain unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalog/attribution/tokens/migrations/native registrations/service schemas/upstream edits/subagents. Prior computer-use/listen/process-inventory denials respected; no sockets/bypass. All owned gates/verifiers/writers terminal; final read-only verification follows this log update.

## 2026-10-12 — Codex / Native static group scene composition

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Actual SDK subtree capture now preserves static group layer/foreground blur across visible descendants, nested filters, descendant blends/opacity and native child clipping. Conservative transformed bounds retain rotated/overflowing children. Private capture normalizes only root geometry/opacity; authoring remains exact. Composed images bypass the own-layer cache. Covered semantic layers keep geometry/source IDs/navigation/focus/Enter while omitting duplicate artwork and child motion. Matching composed scenes crossfade as one paint; composition changes use whole-branch fallback. Dynamic text/fonts/video/variables (including hidden bindings)/responsive layout/components/properties/masks/scroll/fixed or external root blends retain explicit diagnostics; their group effects still need dynamic composition. Grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens/dirty work preserved.

**399 distinct frontend cases/29 files** covered by passing executions; **TypeScript/production build passes** (Vite **1m 55s / 8,027 modules**, wrapper139.20s). Twenty-one new cases: four exact native RGBA/model/cache workflows, nine admission diagnostics, four high/low/render/encode cleanup faults and four React/DOM/motion/navigation/keyboard cases. Initial focus23 passes; broad398 passes/one generated TypeScript check timeout (5642ms >5000ms); that unchanged case passes alone with one worker/20000ms allowance (725ms test time). Broad gate itself fails and is retained; no source correction/broad-suite/build repeats. One21,956-input freeze; source/docs frozen during owned gates/verifiers/writers and frontend/build sequential. Current production AST verifies thirteen guards/two chunks and one worker/23 packages/285 notices. Native30/service171/worker6 retain exact scoped inputs without execution/recompilation.

**21,956 frozen / 22,872 total / 22,835 exact retained prior hashes**; five expected prior source/docs changes, three new source/test files, fifteen replaced outputs, twelve evidence files/twenty production outputs. Writer33584/d774fd exits zero; machine SHA `f04c037997fdfeb1b05836d900858ce97d6b97b21872257924ab3f031fdf838a`. Independent read-only66207/3c85ac verifies all22,872 hashes/branch/scoped whitespace. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-scene-composition.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-scene-composition.json). Historical evidence preserved.

**Next:** dynamic whole-scene compositor, prepared fonts/text/media/control/variable/scroll/layout/mask state, smooth-corner hit regions, external backdrop/structural changes, numeric full-subtree Smart Animate and portable whole-page compositor/router/host. Original geometry/typography/color spaces/scroll/overlay/spring/interruption/velocity and arbitrary CSS-variable spacing remain open. Static supersampled generated SDK pixels and synthetic DOM/keyboard checks do not establish originals/native browser/accessibility/device fidelity. Native caches/aliases/snapshots/async/permanent-release ownership and aggregate memory/CPU/latency/pressure remain open; local2048-edge limits do not measure resources. All Image/options/continuous retouch/RAW/smart-filter/PSD, operation/history/import/legacy, responsive/media/nested/export, connected collaboration/team/services and authored/live six-area gates remain. Prior filesystem/durability/reservation/crash/operator restore/upgrade/non-Unix/codec/preview and memory/disk/WAL/receipt/history/checkpoint/cancellation/compaction gates remain. Installed IPC/keychain/HTTP/TLS/WebKit/UI/media/verified teams/Node22/desktop/tablet/pressure/IME/font/keyboard/accessibility/FIG export-reopen stay unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends/dependencies/locks/catalog/attribution/tokens/migrations/native registrations/service schemas/upstream edits. Prior computer-use/listen/process-inventory denials respected; no sockets/subagents. All owned gates/writers terminal; final read-only verification follows this log update.

## 2026-10-12 — Codex / Private renderer initialization and resilient cleanup

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Added local ownership for the actual SDK's twenty Paint/one Font initialization handles and temporary dash wrapper. Failed constructors unwind returned handles while preserving caller surface ownership. Success restores supplied factories; global CanvasKit/authoring data stay unchanged. Dash-wrapper release preserves exact native outline pixels. Destruction independently attempts known handles/surface after an SDK failure; native/legacy caller cleanup attempts every buffer/display/editor release and preserves original render/allocation errors as aggregate causes. Free refuses backing still used by a live native surface. Grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens/dirty work preserved.

**378 frontend cases/27 files and TypeScript/production build pass** (**1m 20s / 8,026 modules**). Fourteen new actual locked CanvasKit/SDK fault cases cover four constructor stages, transfer/dash pixels, combined initialization/delete errors, two raster teardown failures, two before/after surface-close failures, protected live backing and two legacy render/free failures. Existing native pixels and synthetic DOM/timeline/export/interaction regressions pass. Initial focused38/full378/one build all pass; no source corrections or passing-check reruns. One21,953-input freeze; source/docs remain frozen during gates/verifiers/writers; frontend/build sequential. Temporary helper prefix replacement mistakenly changes its previous baseline to its missing output; it exits before writes/checks and the baseline line is corrected before the real freeze. Current production AST verifies nine guards/two motion chunks and one worker/23 packages/285 notices. Native30/service171/worker6 retain exact scoped inputs without execution/recompilation.

**21,953 frozen / 22,855 total / 22,822 exact retained prior hashes**; four expected prior source/docs changes, two new source/test files, fifteen replaced production outputs, ten evidence files/twenty production outputs. Writer52433/fb36df exits zero; machine SHA `331bfd360c9e83a6259ee9c0084e15eee62bd77ec7080a796237ca34c93f8c6e`. Independent read-only35375/16f034 verifies all22,855 hashes/branch/scoped whitespace. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-native-lifecycle.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-native-lifecycle.json). Historical evidence preserved; preceding corrected post-log verifier66483/f24f62 passed without source/machine changes.

**Next:** full group/descendant/backdrop/structural scene composition, smooth-corner paths/non-native clipping and portable whole-page compositor/router/host. Current export clears child IDs before own image capture, so descendants need actual full-scene composition with semantic hit regions; current eligibility still excludes descendant effects. Original geometry/typography/color-space/scroll/overlay/spring/interruption/velocity and arbitrary multi-value CSS-variable spacing remain open. Known initialization ownership is covered; unreturned native allocations, permanently failing releases, caches/lazy HUD/asynchronous allocations, alias/snapshot ownership and broader procedural/editor lifetimes need acceptance. Protected backing can remain retained when its native surface cannot close. Six display-equivalent resident buffers plus temporary snapshots/canvas/SDK allocations, CPU/latency/pressure and aggregate resources remain unmeasured. All Image/continuous-retouch/PSD/RAW/filter/options, operation/history/import/legacy, responsive/media/nested/export, connected collaboration/team/services and authored/live six-area gates remain. Prior orphan/lifecycle/registry/filesystem/durability/reservation/crash/operator restore/upgrade/non-Unix/codec/preview and aggregate memory/latency/disk/WAL/receipt/history/checkpoint/cancellation/compaction gates remain. Installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/media/verified teams/Node22/desktop/tablet/pressure/IME/font/keyboard/accessibility/FIG export-reopen remain unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. No dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream edits. Prior computer-use/listen/process-inventory denials respected; no sockets/subagents. All owned gates/writers terminal; final read-only verification follows this log update.

## 2026-10-12 — Codex / Own artwork, child clipping and renderer boundaries

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Frame/component/instance children now clip separately from own expanded strokes/shadows. Rounded scroll/fixed boundaries preserve positions/callbacks. Layout moves once; explicit padding/gap sides/axes preserve variant overrides and removal. Native resize/interruption updates clip radii using current numeric dimensions and restores only still-owned inline values. Incomplete gradients retain actual SDK export fallback without authoring mutation or invented stops/transform. Failed private editor initialization disposes its display; legacy export owns/releases its premultiplied surface buffer. Grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens/dirty work preserved.

**364 frontend cases/26 files and final TypeScript/production build pass** (**1m 37s / 8,025 modules**). Twelve new cases: five React/SDK model and seven CanvasKit/boundary workflows, including exact expanded-stroke pixels, incomplete-gradient PNG equality, allocation failures and numeric resized/interrupted clipping. DOM/styles/frame clocks are synthetic, not authored/browser/device pixels. Initial362/one failure exposes undefined longhands clearing shorthand; initial build passes (1m 3s). After terminal gates, first correction/new rerender check catches removed overrides clearing unchanged shorthand (10/one). Explicit longhands plus functional/multi-value coverage yield11/one serialization assertion; final per-side/axis assertions preserve exact values. Focused12/full364/final build pass. Four phase freezes and failures retained. Original initial build tool output is truncated/handle later closed; authoritative terminal receipt/log verified without restart or invented terminal chunk. Source/docs frozen during all owned gates/verifiers/writers; frontend/build sequential. Current production AST verifies seven guards/two motion chunks and one worker/23 packages/285 notices. Native30/service171/worker6 retain exact scoped inputs without execution/recompilation.

**21,951 frozen / 22,841 total / 22,793 exact retained prior hashes**; eight expected prior source/docs changes, two new test files, fifteen replaced outputs, 21 evidence files/twenty production outputs. Writer16625/a7f6ce exits zero; machine SHA `7ca7fd67b508eff3bb66cfb9a9938e0cf7358081380dc59e813cba0dea08c925`. Independent read-only50816/64831b verifies all22,841 hashes/branch/scoped whitespace. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-native-boundary.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-native-boundary.json). Historical evidence preserved.

**Next:** complete group/descendant/backdrop/structural scene composition, smooth-corner paths and broader non-native clipping; portable whole-page compositor/router/host and original geometry/typography/color-space/scroll/overlay/spring/interruption/velocity. Arbitrary CSS custom-property shorthands expanding into several spacing values need acceptance. SDK renderer construction allocates Paint/Font/PathEffect before returning an instance; partial-constructor ownership and cleanup exceptions remain open despite known caller allocation cleanup. Broader caches, six display-equivalent resident buffers plus transient snapshots/canvas/SDK memory, synchronous frame cost and aggregate pressure remain unmeasured. All Image/continuous-retouch/PSD/RAW/filter/options, operation/history/import/legacy, responsive/media/nested/export, connected collaboration/team/services and authored/live six-area requirements stay active. Prior orphan/lifecycle/registry/filesystem/durability/reservation/crash/operator restore/upgrade/non-Unix/codec/preview and aggregate memory/latency/disk/WAL/receipt/history/checkpoint/cancellation/compaction gates remain. Installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/media/verified teams/Node22/desktop/tablet/pressure/IME/font/keyboard/accessibility/FIG export-reopen remain unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. No dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream edits. Prior computer-use/listen/process-inventory denials respected; no sockets/subagents. All owned gates/writers terminal; final read-only verification follows this log update.

Post-log read-only82638/f1837c verifies every22,841 machine hash/branch/scoped source-doc whitespace, then exits1 on a logging assertion that expects plain "goal active" but encounters Markdown backticks around `/goal`. No source/machine change. Normalize Markdown in this temporary log assertion; corrected read-only verification follows.

## 2026-10-12 — Codex / Native strokes, effects and artwork bounds

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Matching native strokes interpolate width/color/opacity/dashes, miter/independent borders; isolated Drop/Inner Shadow and Layer/Foreground Blur interpolate color/radius/offset/spread. Solid multi-fill stacks join gradients. Prepared captures and numeric interruption state preserve authoring data and public model serialization. Shadows match only with an actual native plan. Expanded PNG/SVG percentage placement preserves the original layer box; backdrop exports skip intrinsic cache reuse. Structural changes, group/child/backdrop effects, expanded content-clipped paint and unsupported artwork retain fallback. Gradient-only clipped frames without own overflow retain support. Existing grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens/dirty work preserved.

**270 frontend cases/eighteen files and final TypeScript/production build pass** (**1m 39s / 8,025 modules**). Eighteen new cases: seventeen actual SDK/CanvasKit appearance/native-source checks and one mocked DOM shadow-plan case. Exact source/midpoint/destination pixels cover three stroke alignments/four effect kinds; exact multi-fill and padded wider-border checks, React server/portable SVG placement, forty-frame filter cache, admission/fallback and two allocation-lifetime workflows pass. Initial 260 passes/eight failures expose convenience unpremultiplied versus native premultiplied render/downsample buffers; initial compiler/build passes (1m 17s). After both gates terminate, explicit high/low premultiplied buffers, proper display disposal and strict rounded size cap correct the failures without tolerances. Focused35 then full270/final build pass. Source/docs frozen while gates/writers live; frontend/build sequential. Current production AST verifies two compiled native/motion chunks and one worker/23 packages/285 notices. Native30/service171/worker6 retain exact scoped inputs without rerun/recompilation.

**21,949 frozen / 22,816 total / 22,775 exact retained prior hashes**; seven expected prior source/docs changes, two new source/test files, fifteen replaced production outputs, fifteen evidence files/twenty production outputs. Writer2807/c7e35c exits zero; machine SHA `b1d56d28d10b6af15926a53c8eb3ea13b027a696413f336546139518b939a716`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-native-appearance.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-native-appearance.json). Two freezes, initial failures and explicit terminal receipts retained; temporary freeze baseline typo exits before writes/checks and is corrected before real freeze.

**Next:** full group/child/clipped/backdrop paint composition, structural paint topology and portable whole-page compositor/router/host; native constructor/error lifecycle, broader legacy renderer buffer/cache ownership and measured resources. Audit incomplete gradient/paint metadata against SDK fallback before widening native capture. Three resident surfaces now consume six display-equivalent pixel buffers before temporary snapshots/canvas/caches. Source/paint/stop/display caps plus64strokes/32effects/state,256dash entries and4096transition appearances bound admission, not aggregate memory/CPU/latency. Original typography/color-space/geometry/clip/scroll/overlay/spring/interruption/composite/velocity, unsupported rich text and all other Image/continuous-retouch/PSD/RAW/filter/options, operation/history/import/legacy, responsive/media/nested/export, connected collaboration/services and authored/live six-area gates remain. Prior orphan/lifecycle/registry/filesystem/durability/reservation/crash/operator restore/upgrade/non-Unix/codec/preview and aggregate memory/latency/disk/WAL/receipt/history/checkpoint/cancellation/compaction gates remain. Matching installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/media/verified teams/Node22/desktop/tablet/pressure/IME/font/keyboard/accessibility/FIG export-reopen remain unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. No dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream edits. Prior computer-use/listen/process-inventory denials respected; no sockets/subagents. All owned gates/writers terminal; final read-only verification follows this entry.

## 2026-10-12 — Codex / Native-rendered Smart Animate gradients

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Compatible linear/radial/angular/diamond matrices, stops, premultiplied colors, opacity and own-layer geometry now animate through the actual Skia renderer. Detached captures preserve authoring data, public model serialization and repeated variant identities. A shared playback clock supports pause/seek/scrub/spring release, source-endpoint holding, later scrubbing and interrupted native PNG/state snapshots. Unsupported topology/text/stroke/effect/mask/path-local/backdrop-dependent artwork retains crossfade. Private geometry caches and surfaces dispose with motion. Existing grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens and dirty work preserved.

**252 frontend cases/seventeen files and final TypeScript/production build pass** (**41.40s / 8,024 modules**). Seventeen new cases: eleven actual CanvasKit/native-source checks and six synthetic DOM/timeline checks. Four gradient kinds compare every generated 40×40 RGBA pixel at source/midpoint/destination against independently authored native SDK PNGs. Initial 242 passes/five failures expose native 2× supersampling/downsample and a calculated-spring-duration fixture mismatch; both corrected after terminal gates. One misnamed helper runs Vitest in src-tauri and matches no tests, not native acceptance. Corrected focused twelve pass; additional resource/variant/attachment coverage yields 250 and a 44.01s build. Final backdrop guard adds two regressions; final suite/build pass. Current production AST verifies two compiled motion chunks and one exact worker/23 packages/285 notices. Exact native30/service171/worker6 scoped inputs retain prior checks without rerun/recompilation.

**21,947 frozen / 22,797 total / 22,744 exact retained prior hashes**; eight expected prior source/docs changes, fifteen replaced production outputs, twenty-five evidence files/twenty production outputs. Writer33225/b385c0 exits zero; machine SHA `244e0301d34102f09fc68b2316e32105b85aa41b87a98c597e02abb6c70869c6`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-native-gradient.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-native-gradient.json). Four phase freezes/failed attempts/terminal check receipts retained. Final freeze tool output was truncated: independent read-only17146/3dbaeb verifies complete artifact/all current hashes before final checks, without writer restart or invented original handle. All frontend/build gates sequential and terminal before source/docs changes.

**Next:** richer native stroke/effect/backdrop/topology paint composition and portable whole-page compositor/router/host; unsupported rich text and original typography/color-space/clip/scroll/overlay/composite/velocity fidelity. The 16 Mi display-pixel admission is not a total-memory bound: 2× high surface plus display has five display-equivalent pixel buffers before transient snapshots/caches. Synchronous draw cost, aggregate native/JS/canvas memory and partial SDK-constructor failure ownership need resource acceptance. All Image/PSD/RAW/filter/options, history/import/legacy, responsive/media/nested/export, connected collaboration/service and authored/live six-area gates remain. Prior orphan/lifecycle/registry/filesystem/durability/reservation/crash/operator restore/upgrade/non-Unix/codec/preview and aggregate memory/latency/disk/WAL/receipt/history/checkpoint/cancellation/compaction gates remain. Matching installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/media/verified teams/Node22/desktop/tablet/pressure/IME/font/keyboard/accessibility/FIG export-reopen remain unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. No dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream edits. Prior computer-use/listen/process-inventory denials respected; no sockets/subagents. All owned gates/writers terminal; final read-only verification follows this entry.

## 2026-10-12 — Codex / Numeric Smart Animate paint and compatible rich text

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Flat/SVG/text colors now evaluate intermediate sampled frames with premultiplied sRGB alpha through spring, scrub and release. Equal Unicode text aligns different styled-run boundaries and interpolates compatible size/weight/spacing/line height/decoration metrics/variable axes. Text boxes resize once with nested affine compensation. Changing flow dimensions retain crossfade to protect sibling placement; incompatible styles/languages/fonts/features/unresolved lengths/wide-gamut/mixed paints remain fallback. Interrupted snapshots retain computed individual text properties. Bounded run/node/character/segment admission complements existing keyframe/layer/composite limits. Existing grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens and dirty work preserved.

**172 frontend cases/thirteen files and final TypeScript/production build pass** (**47.05s / 8,023 modules**). Twenty-nine new cases (color14/text15); actual SDK model/React rendering with synthetic text/computed-style/WAAPI mocks, not original/browser/device pixels. Initial unavailable test-library import/compiler failure, two then one fixture/style failures and focused retarget correction are retained. Existing React harness used without dependencies; explicit native run/whitespace fixtures represent jsdom’s missing inherited typography. Final nested/flow/flat/SVG midpoint checks pass; all gates sequential and terminal before source/docs changes. Current production AST verifies compiled motion guards and one exact worker/23 packages/285 notices. Exact native30/service171/worker6 scoped inputs retain previous checks without rerun/recompilation.

**21,944 frozen / 22,767 total / 22,717 exact retained prior hashes**; seven expected prior source/docs changes, fourteen replaced production outputs, twenty-two evidence files/twenty production outputs. Writer59915/1ff0d1 exits zero; machine SHA `314d46640f9965b605ab5e0db896afe990baeee2421b49b2918c6f83d5b11f6b`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-smart-text.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-smart-text.json). Five freezes/failed attempts/corrections/terminal receipts retained.

**Next:** numerical gradients/strokes/complex-paint representation and timeline integration; unsupported rich-text flow/style cases and original typography/color-space/clip/scroll/overlay/composite/velocity fidelity; portable full-page compositor/router/host. All other Image/PSD/RAW/filter/options, resource/history/legacy, responsive/media/nested/export, connected collaboration/service and authored/live six-area gates remain active. Prior orphan/lifecycle/registry/filesystem/durability/reservation/crash/operator restore/upgrade/non-Unix/codec/preview and aggregate memory/latency/disk/WAL/receipt/history/checkpoint/cancellation/compaction gates remain. Matching installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/media/verified accounts/teams/Node22/desktop/tablet/pressure/IME/font/keyboard/accessibility/FIG export-reopen remain unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. No dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream edits. Prior computer-use/listen/process-inventory denials respected; no sockets/subagents. All owned gates/writers terminal; final read-only verification follows this entry.

## 2026-10-12 — Codex / XDesign reviewed shared-image placement recovery

**Branch:** validation/alpha-2026-09-14

Full unbudgeted six-area `/goal` active; no area complete. Accepted shared images recovered after publisher downgrade now have a reviewed inspector action after editor access returns. Saved revision choices show dimensions and affected linked-placement count. Fresh immutable metadata/member authorization precedes review and Apply. Exact original/local or predecessor matching preserves historic pins, geometry, foreign metadata and newer native working edits. Private epoch-bound drafts, all-target/per-update guards, one undo batch and idempotent failed-save retry avoid extra uploads/native copies/history. Canonical JSON tolerates collaboration field ordering. Failure-path rollback preserves intervening edits while removing only this operation’s still-matching fields. Existing grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens and dirty work preserved.

**134 frontend cases/seven files and final TypeScript/production build pass** (**41.62s / 8,021 modules**); twelve new cases: three client, two mounted controls, seven real SDK/editor/shared/project runtime cases. Native files/SQLite/HTTP mocked and synthetic preview signatures used. Initial 129 pass/five failures and an optional test-field type error retained; all initial gates finish before fixing fixtures, canonical comparison and shared snapshot rollback. The full affected suite/build reruns once and passes. No native source/compiler/binary change: thirty prior native executions retain exact inputs/uninstalled binary, no rerun/recompilation. Service171/twelve and worker6/697 inputs retain exact checks; current production AST/notices verifies one worker/23 packages/285 notices.

**21,940 frozen / 22,738 total / 22,698 exact retained prior hashes**; eleven expected source/docs changes, thirteen replaced production outputs, thirteen evidence files/nineteen production outputs. Writer87527/3948b4 exits zero; machine SHA `6c2aeccb3892068507fbdb15b578324b00e316cc24c4f213e3e9f5fda0567ff5`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-image-placement.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-image-placement.json). Three freezes/failed attempts/corrections/terminal receipts retained.

**Next:** remaining prototype complex-paint/rich-text interpolation and transition fidelity; broader resource lifecycle/unknown orphan assets. Arbitrary image branch/replacement/missing-predecessor decisions are not inferred. Ordinary cross-window registry saves, aggregate memory/latency/disk/WAL/history/receipt/checkpoint/cancellation/compaction, failure-path graph reconstruction cost, full filesystem/durability/reservation/crash/operator restore/upgrade/non-Unix identity and codec/preview bounds stay open. Authored originals/managed-preview correspondence, matching installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/media/verified accounts/teams/Node22/desktop/tablet/IME/font/keyboard/accessibility/FIG export-reopen and every remaining six-area gate remain unverified. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. No dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream changes. Prior computer-use/listen/process-inventory denials respected; no sockets/subagents. All owned checks/writers terminal; final read-only verification follows this entry.

## 2026-10-12 — Codex / XDesign Home recovery and pending-image maintenance protection

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; no area complete. Home now shows bounded, metadata-only interrupted desktop copies with names/start times and explicit Open/Remove/Refresh controls. Reopening registers the original staged identity using a fresh validated registry; failed saves retain it, lost replies open canonical saved data, and removal preserves copies registered elsewhere. Active-project guards protect unsaved work. Strict closed receipts refuse injected operation fields. Older native receipts remain discoverable without labels; display truncation preserves saved names. Startup collection/compaction/recovery now preserves pending and unknown-owned copied directories before Home opens; registered copies resume maintenance. Owner markers protect promotions after the database snapshot and database-restore gaps; corrupt/excessive receipts cancel maintenance before mutation. Other projects continue ordinary maintenance. Existing controls/tokens, original grid/canvas-first/collapse/double-click Image entry/Companion/placements and dirty work preserved.

**163 frontend cases/seven files, 30 current-binary native cases, TypeScript and production build pass** (**41.76s / 8,021 modules**). Final eleven Home UI cases follow accessible-label improvements; five initial files/152 cases retain exact inputs. Native: seventeen lifecycle, seven storage, three compaction and three new real interrupted-copy maintenance cases; final compile 19.36s/no warnings. Generated float native images, actual archives/files/leases and temporary SQLite; frontend native IPC mocked. Uninstalled native test binary: 158,276,240 bytes/SHA `cce2ccfd618963593dbcb90386c04862abd4ca2e383b24f47b3b9790db622afa`. Older cases outside thirty remain historical scope. Service 171/twelve files and six actual worker executions retain unchanged inputs without rerun/recompilation; current AST/notices verifies one worker/697 inputs/23 packages/285 notices.

**21,940 frozen / 22,722 total / 22,666 exact retained prior hashes**; twelve expected prior source/docs changes, fifteen replaced native/production outputs, twenty-two evidence files/eighteen production outputs. Writer 62647/c14b55 exits zero; machine SHA `201fa46c62687e41ad16b0a87cac97cff27c66818fc32c94b0c3d91436cabbcf`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-recovery-home.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-recovery-home.json). Initial/final UI freezes, maintenance/complete freezes, initial binary metadata and terminal gate receipts retained. Truncated complete-freeze output resolved by independently verifying its completed file/current hashes; writer not repeated and no original terminal handle invented.

**Next:** orphan/placement reconciliation after publisher downgrade and broader resource lifecycle. Ordinary project saves retain a broader cross-window registry concurrency gate. Discovery64/maintenance100000 admission caps, aggregate memory/disk/WAL/receipt/metadata/checkpoint growth, latency/cancellation/compaction, whole-file codec vectors and shared16MiB/native24MiB preview limits stay open. Pre-ownership/hash/reservation/crash windows preserve unknown files for review; full filesystem races/parent-path/handle-relative/hard-link/durability/operator restore/upgrade and equivalent non-Unix identity remain open. Generated/mocked checks do not establish authored PSD/PCRAFT/managed-preview correspondence, matching installed optional/control IPC/keychain/HTTP/TLS/WebKit/UI/visual/media/verified teams/accounts/Node22/desktop/tablet/IME/font/keyboard/accessibility/FIG export-reopen or any remaining six-area gate. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. No dependencies/locks/catalog/attribution/tokens/migrations/service schemas/native registrations/upstream forks. Prior computer-use/listen/process-inventory denials respected; no sockets/subagents. All owned gates/writers have finished; final read-only verification follows this entry.

## 2026-10-12 — Codex / XDesign durable project import and copy lifecycle

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; no area complete. Portable imports, shared new-room copies and independent local recovery now reserve a known native operation identity before copying. SQLite receipts bind directory identity/ownership/result hashes and declared file inventory. Registry registration verifies unchanged asset references, refuses stale project lists and commits the exact request digest atomically. Lost stage replies recover the same copy; lost commit replies open canonical registered data. Exact accepted retries preserve later edits/other projects. Failed validation/source guards/registry writes clean only unchanged owned generated assets through quarantine; registered, changed, linked, replaced and unknown files/directories remain protected. Sealed staging recovers before promotion; partial cleanup retains ownership metadata until last and remains discoverable until deletion succeeds. Pending capacity is 64. Sources, grid/canvas-first/collapse/double-click Image entry/Companion/placements/tokens and prior dirty work preserved. One new closed native status/discard/list command; optional operation/receipt arguments on existing import/clone/state commands. Existing `app_state`, no migration/dependency/service-schema change.

**141 distinct frontend cases/six files, 41 actual current-binary native cases, final TypeScript and production build pass** (**37.59s / 8,019 modules**). Eighteen new frontend cases; initial 140 pass, final 14 helper cases pass. Five initial files/127 cases retain unchanged tests/store/callers/class/recovery decoder; only the separate pending-list phase/type changes, reconstructed/hash verified against the initial freeze. Native: 15 new lifecycle, six SQLite state and 20 archive/room-image cases; compile 27.78s/no warnings, real temporary files/SQLite/leases and generated resources/layered fixtures. Initial native compilation fails at two shared Staging constructors; both corrected after every initial gate terminates. No cases execute during that failed compile. Cleanup discovery improves after the same terminal boundary; affected helper/build rerun. Current native binary uninstalled, 158,177,872 bytes/SHA `2ba5e94bad9d51d31e4be56aae1e890cccab07579937d7a1d1d3159fb7cc1d57`. Older native cases outside 41 remain historical scope, not current-binary executions. Service 171/twelve files and six actual worker executions retain exact inputs without rerun/recompilation; current production AST/notices verifies one worker/697 inputs/23 packages/285 notices.

**21,935 frozen / 22,693 total / 22,639 exact retained prior hashes**; sixteen expected source/docs changes, thirteen replaced native/production outputs, seventeen evidence files/eighteen production files. Writer 45811/9507d2 exits zero; machine SHA `dd8a2f175bb2aa3cf49176625d2f67fe5a9643114ad64c4221de4b92e09f01dd`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-project-import.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-project-import.json). Initial/final freezes, failed native compile and every terminal receipt retained.

**Next:** visible post-restart import recovery and reopening the existing staged project without copying again; orphan-placement reconciliation after publisher downgrade and broader resource lifecycle. Pre-ownership/result-hash crash windows preserve unrecognized staging for review. Complete filesystem races/parent-path/handle-relative operations/hard links, durability, other-platform identity (current device/inode support requires Unix), aggregate memory/disk/WAL/metadata/receipts/checkpoints/latency/cancellation/compaction, whole-file codec vectors and shared16MiB/native24MiB preview limits stay open. Generated/mocked acceptance does not establish authored PSD/PCRAFT/managed-preview correspondence, installed optional/control IPC/keychain/HTTP/TLS/WebKit/UI/visual/native media/verified teams/accounts/Node22/desktop/tablet/IME/font/keyboard/accessibility/FIG export-reopen or any remaining six-area gate. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. No dependencies/locks/catalog/attribution/tokens/migrations/service schemas/upstream forks. Dedicated format-six/five service registrations unchanged. Prior computer-use/listen/process-inventory denials respected; no sockets/subagents. All owned gates/writers terminal; final read-only verification follows this entry.

## 2026-10-12 — Codex / XDesign independent editable shared Image copies

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; no area complete. New-room preparation and rejected-upload local recovery now hydrate missing pinned originals before project transition, then convert accepted native revisions to fresh local photo identities. Repeated placements deduplicate; historic/unplaced accepted versions survive beside unpublished drafts. Copied graphs preserve geometry/preview addressing/foreign metadata, drop old room markers/mappings/checkpoint, and new rooms start fresh Yjs history. Original project/checkpoint/pending uploads remain. Scoped read permissions permit recovery downloads from known error/disconnected artwork sessions without granting ordinary publication fallback. Fresh viewer access survives failed local-copy commits; cancellation/source changes preserve the source. Native clone accepts optional closed immutable source/version/target aliases through its existing command, selecting checked project-relative files and preserving editable layers/previews/history through staged archive validation. No new IPC registration; installed optional-argument acceptance remains open. Grid/layout/collapse/Image entry/Companion/placements/tokens/dirty work preserved.

**166 distinct frontend cases/eight files, final TypeScript/production build pass** (**41.87s / 8,018 modules**). Eleven added cases; final three pure-copy/24 runtime cases plus 139 initial unchanged cases/six files. Initial 162 pass/four fixture failures and intermediate 26 pass/one failure remain retained. Only two test fixtures change after production passes: correct version paths and mocked preparation name. All gates terminate before corrections; passing production and six frontend files are not repeated. **18 distinct native cases**: eleven initial archive cases, seven correct storage cases. The initial storage filter executes zero and is not counted. Correct storage execution recompiles (10.16s); three new copy cases rerun against the identified current binary. **Ten current-binary executions** (three copy/seven storage); eight other initial archive regressions retain exact native source/test/compiler inputs, not current-binary execution status. Actual generated native layers/pixels/files and SQLite used. Native binary 157,610,224 bytes/SHA `4478b29e18564c364536a1ba0e8de6f512f13bfb32191790b32b7a0b927245a0`, uninstalled. Service 171/twelve-file cases and six actual worker executions retain exact inputs; current production AST/notices verify one worker/697 inputs/23 packages/285 notices. No service/worker execution/recompilation.

**21,931 frozen / 22,668 total / 22,618 exact prior hashes**; six expected prior source/docs changes, thirteen replaced native/production outputs, 27 evidence files/16 production files. Writer 5059/efddfb exits zero; machine SHA `b988bdab56bc3cb27d646ab41bb4dc74b87af1825624da1f101814500cda7db2`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-image-copy.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-image-copy.json). Initial failures, setup corrections, freezes and terminal receipts retained.

**Next:** orphan/placement reconciliation after publisher downgrade, failed-import destination cleanup and broader asset/resource lifecycle. Cancellation/source guards preserve the registry/source but do not cancel native clone work or clean unused copied directories after a failed commit. Generated native/opaque fixtures and mocked IPC/network are not authored PSD/PCRAFT/managed-preview/media/installed/visual/export-reopen acceptance. Shared 16 MiB/native 24 MiB preview caps, native whole-file vectors, aggregate memory/disk/WAL/metadata/receipts/checkpoints/latency/cancellation/compaction, full filesystem race/durability/reservation/crash/operator restore/upgrade/deployment/key lifecycle and every authored/installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/native media/verified accounts/teams/Node22/device/tablet/IME/font/keyboard/accessibility/FIG export-reopen and six-area gate remain open. No new token gap.

Changes remain uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external messages. No dependencies/locks/catalog/attribution/tokens/migrations/new native registrations/service schemas/upstream forks; dedicated six/five registrations stay frozen. Prior computer-use/listen/process-inventory denials respected; no sockets. All owned gates/writers terminal; final read-only verification follows this log update.

## 2026-10-12 — Codex / XDesign full-resolution shared Image resources

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; no area complete. Portable component-library review and canvas export now resolve pinned shared Image revisions from immutable accepted native base versions. Resources hydrate on demand, deduplicate repeated placements and recover only matching interrupted downloads. Pending uploads/other pins refuse without publication. Portable copies embed image bytes, strip reserved room/local photo markers and preserve geometry, foreign metadata, unpublished drafts and source artwork. Component closures include preferred/variant dependencies and exclude unrelated images. Viewers can export without publication rights; fresh downgrade preserves the imported original while refusing editable library review. Operation-scoped resource guards expire and reject forged/concurrent/foreign/stale reads; late tasks preserve a replacement editor/project’s busy/error state. Existing grid/layout/collapse/double-click Image entry/Companion/tokens and dirty work preserved.

**152 distinct frontend cases/nine files, final TypeScript and production build pass** (**44.87s / 8,017 modules**). Fourteen added cases cover resource portability/dependencies, pins/deduplication, permissions, matching download recovery, viewer/downgrade and changed-source behavior. Initial 151 pass/one fixture failure is retained; two affected 15-pass/one-fail attempts precede the final 16 runtime passes (7.10s; 4.81s tests). Corrections affect only the duplicate-placement fixture: accepted override metadata plus a full decoded graph-data comparison, avoiding JSON property-order artifacts. Every gate terminates before corrections. Eight passing files and the production build are not rerun; production inputs remain exact. Previous 171 service cases/twelve files, 15 current-binary native cases and six actual worker executions retain exact inputs/binary; no passing service/native/worker execution/recompilation repeated. Current production AST/notices verify one exact worker/697 inputs/23 required packages/285 notices.

**21,929 frozen / 22,637 total / 22,585 exact prior hashes**; ten expected prior source/docs changes, twelve replaced production outputs, 25 evidence files/16 production files. Writer 12802/ac41da exits zero; machine SHA `56a7ab6c03640e19cefe55475386cdfb84b034ef62ef3f84efcf3bd571ce1d6f`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-image-resources.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-image-resources.json). Historical acceptance remains intact. Native binary remains 157,481,952 bytes/SHA `3efebeb38a02b35aa303681e902f8c7d7fc86a8b928e5ba9338a1aa1e061f70f`, uninstalled; older native cases remain historical subject-specific scope.

**Next:** independent shared-image copy/new-room conversion, orphan-placement reconciliation after publisher downgrade and broader resource lifecycle. Generated opaque bytes and mocked native/file/network/render boundaries do not establish authored PSD/PCRAFT/native raster/managed-preview or installed/UI/export-reopen acceptance. Shared 16 MiB/native 24 MiB preview limits, native whole-file vectors, aggregate memory/disk/WAL/metadata/receipts/checkpoints/latency/cancellation/compaction, complete filesystem race/durability/reservation/crash/operator restore/upgrade/deployment/key lifecycle and every authored/installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/native media/verified accounts/teams/Node22/device/tablet/IME/font/keyboard/accessibility/FIG export-reopen and remaining six-area gate stay open. No new token gap.

Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external messages. No dependencies/locks/catalog/attribution/tokens/migrations/native registrations/service schemas/upstream forks. Format-six/five registrations remain frozen. Prior computer-use/listen/process-inventory denials respected; no sockets. All owned gates/writers terminal; final read-only verification follows this log update.

## 2026-10-12 — Codex / XDesign canvas-owned shared Image documents

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; this turn makes verified progress. Connected explicit lazy shared Image download, double-click native Image entry, immutable origin/room/reference local mappings, durable/idempotent receipt saves, staged unpublished native edits and exact publication review to the canvas. Shared markers never receive native filesystem identities. New publication replaces original local placements or exact predecessor pins, preserving geometry/foreign metadata/historic or changed placements. Viewer hydration preserves artwork restrictions; a fresh image-endpoint publisher downgrade makes recovery read-only before saving its accepted mapping. Original native documents survive failed saves/cleanup and reopening without duplicate imports or undo entries. Selected cached-image export uses the accepted full-resolution native version and excludes unrelated unresolved images. Copy/portable-backup/storage visiting protects accepted mapping versions beside working drafts. Added project-switch activity admission. Compact selection controls/dialogs reuse existing tokens/styles; frontend-design skill applied. Grid/canvas-first/collapse/double-click entry/Companion/placements and dirty work preserved.

**167 distinct frontend cases/twelve files, 171 actual service cases/twelve files, 15 current-binary native cases and final compiler/production build pass.** Final affected 23 cases/four files include nine runtime cases (5.08s); 144 initial regression passes remain retained. Initial 157 passes/five failures and compiler errors are preserved; all initial gates terminate before source/test corrections. Correction passes 21 cases/build (42.15s). Selected-export improvement passes eight runtime cases/build (41.35s); final permission correction passes nine/build (**43.00s / 8,016 modules**). Passing service/native checks are not repeated. Service engines stay byte-identical at 499,964/511,135 bytes, 308/309 inputs/eight notices on Node 24.16.0. Native eight archive/seven storage cases execute in the current uninstalled binary (40.96s compile/no warnings; .61s/1.49s tests), including three new generated-asset/temporary-SQLite cases. Binary 157,481,952 bytes/SHA `3efebeb38a02b35aa303681e902f8c7d7fc86a8b928e5ba9338a1aa1e061f70f`; prior native room/state/codec/history cases are historical subject-specific scope, not current-binary executions. Current production AST/notices retain six actual worker executions/697 exact inputs/one copy/23 packages/285 notices.

**21,926 frozen / 22,607 total / 22,537 exact prior hashes**; twelve expected prior source/docs changes, nine replaced outputs, 35 evidence files/16 production files. Final writer 61157/3a7a7e exits zero; machine SHA `9a24c3be4a8d990b3cd6c4461e213ed448de23b4422439582296c983bcd05f3e`. Initial pre-permission proof is retained as historical evidence. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-image-canvas.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-image-canvas.json).

**Next:** resolve full-resolution shared images into portable libraries, seamless export hydration, independent shared-image/new-room conversion, orphan/placement reconciliation after downgrade and broader asset lifecycle. Frontend native/file/network/renderer boundaries are simulated; generated native assets do not establish authored originals or installed native/managed-preview correspondence. Shared 16 MiB admission versus native 24 MiB preview, whole-file vectors/aggregate memory/disk/WAL/metadata/receipts/checkpoints/latency/cancellation/compaction/complete filesystem race/durability/reservation/crash/operator restore/upgrade/deployment/Node22/key lifecycle and every authored/installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/native media/verified teams/device/tablet/IME/font/keyboard/accessibility/FIG export-reopen plus six-area gate remain open. No area complete or new token gap.

No dependencies/locks/catalog/attribution/tokens/migrations/native registrations/service-schema changes/upstream forks. Dedicated format-six/five registrations stay frozen. Prior computer-use/listen/process-inventory denials respected; no sockets. Uncommitted; no commits/push/releases/deploy/package/install/live-profile/production replacement/external messages. All owned gates/writers terminal; final read-only verification follows this log update.

## 2026-10-12 — Codex / XDesign durable Image transfer recovery

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; this turn makes progress. Added strict metadata-only project/origin/room/member/request pending state and a file-backed Image transfer controller. Original source saves before native preparation; exact revision/epoch approval saves separately before publication. Recovery of unapproved preparation does not publish. Uploads resume missing 1 MiB chunks and recover accepted original receipts after downgrade. Downloads pin current authorization/revisions and recover the same local native identity after lost import replies. Completion stays pending until a caller durably saves its result, journals acknowledgment, dismisses the cache and clears the exact pending record. Lost cleanup replies resume without applying/importing twice; save callbacks must be idempotent if their own receipt is lost before acknowledgment. Repeatable native missing-cache dismissal preserves imported artwork and absent/changed-root/corrupt/extant-cache safeguards. Project-bound CAS refuses stale/deleted-project writes; native project deletion clears only its pending record atomically. The canvas room controller exposes APIs and reads local pending metadata on opening. **Ordinary canvas action handlers and joined native Image hydration still need wiring.**

**Final 88 editor cases/five files, five actual SQLite cases, 41 native cases and compiler/production build pass.** Native 35 room/file plus six project-state cases execute in the current uninstalled binary, compilation 16.64s/no warnings; native/SQL are not rerun. Initial 67 frontend passes/21 fixture origin failures and compiler fixture-type failure are retained. After all initial gates terminate, fixture correction yields 14 passes/seven failures, catching a typed-chunk/raw-wire boundary error and extra publisher fields. After all recovery gates terminate, source/fixture correction passes all 88 (11.15s) and final production build (Vite 45.88s/8,012 modules). Prior recovery build 47.13s is retained for its pre-correction source. Exact service inputs/308–309-input engines retain 171 cases; current production AST/notices retain six worker executions/697 inputs/one copy/23 packages/285 notices. Current binary 157,415,248 bytes/SHA `6d97c656448cafea8d00faa7c0d75d71d5f35886a3899be2c36cf8378cb6dafb`; older nineteen codec/history/storage cases remain historical source evidence, not current-binary executions. **21,919 frozen / 22,558 total hashes / 22,505 exact prior hashes**; nine expected source/docs changes, nine replaced outputs, 27 evidence files. Writer 91606/e06251 exits zero; machine SHA `92b7ecf04147bad82ed4c9879d53e5c5e0edc6de81026cef1a998c8b2cc0cc1d`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-image-client.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-image-client.json).

**Next:** lazy canvas-native hydration, local receipt/placement mapping, double-click shared-image entry, editable reviewed revision publication and full-resolution library resolution. Controller native/service/file boundaries are simulated in frontend checks; current native tests use generated assets. Authored originals/native managed-preview correspondence, shared preview 16 MiB versus native 24 MiB, native whole-file vectors/aggregate memory/metadata/disk/WAL/receipts/checkpoints/latency/cancellation/compaction/comprehensive filesystem races/durability/pre-publication reservation/crash/operator cleanup/upgrade/deployment/Node22/key lifecycle and all installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/media/verified teams/device/tablet/IME/font/keyboard/accessibility/FIG export-reopen and six-area gates remain open. No area complete; no new token gap.

Grid/canvas-first/collapsible layout/double-click Image entry/Companion/placements/dirty work preserved. No UI/token/dependency/lock/catalog/attribution/app-migration/service-schema/native-registration changes/upstream forks. Dedicated format-six/five registrations remain frozen. Prior computer-use/listen/process-inventory denials respected; no sockets. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. All owned gates/writers terminal; final read-only verification follows this log update.

## 2026-10-12 — Codex / XDesign strict room image references

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; this turn makes progress. Added closed canonical versioned artwork references to immutable room Image revisions and SDK preview addresses. Current saved documents validate marker/resource identity while preserving legacy local markers, foreign metadata and geometry. Service admission checks same-room publication for every novel hidden/merged/overwritten/losing/tombstoned CRDT value and the projected preview's SHA-256 before history/checkpoint/receipt writes. New-room creation also rejects hidden foreign reference history before writing grants. Damaged saved current references refuse reads/updates/comments, preserving originals. Historic revisions/selective undo/owner successors/downgrade receipts remain supported. Portable libraries refuse unresolved native room images; full-resolution resolution remains next. **Canvas Image endpoint actions and ordinary joined native Image documents remain absent.**

**79 editor cases/six files, 171 actual service cases/twelve files and TypeScript/production build pass.** All initial gates pass; no source corrections or passing-gate reruns. Thirteen new service workflows use actual SDK/Yjs/Node streams/temporary SQLite and generated opaque archive/preview bytes. Vite 42.86s/8,010 modules; pure/client engines 499,964/511,135 bytes, 308/309 inputs, eight notices/no compiler warnings. Exact unchanged native source/test/compiler/uninstalled binary retain 53 preceding cases without rerun; current production AST/notices retain six actual worker executions/697 inputs/one copy/23 packages/285 notices. **21,913 frozen inputs / 22,523 total hashes / 22,484 exact preceding hashes**, ten expected prior source/docs changes, eight replaced outputs, sixteen evidence files. Writer 50454/00788c exits zero; machine SHA `da4b95805edfb5aa01d4fa0f097b2d8739bb83425cec6ed29f846ad0defdc692`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-image-refs.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-image-refs.json).

**Next:** durable client pending/recovery, lazy joined-image hydration, canvas editing/reviewed publication and full-resolution portable library resolution. Markers do not require a paint fill or establish rendered/managed-color/native-decoder/original-archive correspondence. Existing shared image resources cap at 16 MiB versus native preview 24 MiB. Whole-file native vectors/aggregate memory/metadata/disk/WAL/receipts/checkpoints/latency/cancellation/compaction/complete filesystem race/durability/pre-publication reservation recovery/crash/operator cleanup/upgrade/deployment/Node22/key lifecycle and every original/installed/native media/verified teams/UI/visual/device/tablet/IME/font/keyboard/accessibility/FIG export-reopen plus all six-area gates remain open. No area complete; no new token gap.

Original grid/canvas-first/collapsible layout/double-click Image entry/Companion/placements and prior dirty work preserved. No UI/token/dependency/lock/catalog/attribution/app-migration/native-registration/service-schema changes/upstream forks. Dedicated format-six/five registrations remain frozen. Prior computer-use/listen/process-inventory denials respected without bypass; no sockets. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. All owned gates/writers terminal; final read-only verification follows this log update.

## 2026-10-12 — Codex / XDesign file-backed native Image transfers

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; this turn makes progress. Added a registered native file command and seven typed actions for preparation/status/bounded reads/staging/checked writes/import-recovery/explicit cache dismissal. Project-local caches retain immutable source metadata/prepared bytes/received chunks under origin/room/member/request scopes; OS credential prefixes pin the local member. Existing sequences/cancellation/worker slots, a process file gate, independent OS file leases, observed project-root identity checks and no-parent-recreation writes constrain operations. Fresh native import identities journal before publication; lost completion receipts recover the same verified original image. Pending source/import/history versions survive cleanup, and transfer photos skip compaction until explicit cache dismissal. Typed metadata/hash/scope/path/progress/write-acknowledgement checks stay single-flight and ignore late results. **Whole archives stay out of frontend IPC. Canvas actions still do not call Image endpoints; ordinary joins still lack native Image documents.**

**53 native cases and 51 distinct frontend cases, final TypeScript and production build pass.** All initial native checks pass without warnings (28.67s compilation); generated layered 8/16/32-bit documents, float pixels/history, lost replies, actual competing locks, scoped/corrupt bytes, observed root replacement and real history cleanup/compaction are exercised. Initial frontend runs 50 passes/one fixture failure; the mock also rejects its after-test close. After every initial gate terminates, test-only correction scopes that rejection; final eleven affected cases (.653s) and compiler pass, retaining the exact initial 40. Initial production build explicitly passes (Vite 41.75s), then remains exact; no native/build/service/worker passing gate rerun. Current uninstalled native binary: 157,412,880 bytes / SHA `535af379e756493f82df55aeb8a816bcd843a9ca8e7c9e9518bd9186dc8702c8`. Current production AST/notices retain six actual worker executions/697 inputs/one copy/23 packages/285 notices. Exact service/307–308-input engines retain 158 cases. **21,910 frozen inputs / 22,502 total hashes / 22,455 exact preceding hashes**, twelve expected prior source/docs changes, nine replaced verification outputs, twenty evidence files. Writer 41229/36c084 exits zero; machine SHA `5bca17e230fb2f87ee79e7f2a048222993bf47b4aefc0adb9e287c294f53e21c`. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-image-files.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-image-files.json).

**Next:** strict room image references, durable client pending/recovery, lazy joined-image hydration and canvas editing/publication. Native codec assembly/decoding still uses bounded whole-file vectors; callbacks run between work units. Cache caps and observed directory guards do not establish aggregate memory/latency/disk/WAL/metadata/receipt/checkpoint or comprehensive filesystem race/durability acceptance. Uncertain pre-publication reservation recovery/operator cleanup, real crash/upgrade/deployment/Node22/key lifecycle, authored original PSD/PCRAFT/non-native embedded/managed preview compatibility, native media/verified accounts/teams and matching installed IPC/keychain/HTTP/TLS/WebKit/UI/visual/device/tablet/IME/font/keyboard/accessibility/FIG export-reopen plus all remaining six-area gates stay open. Frontend IPC is mocked; generated documents and synthetic Windows paths do not establish original/device acceptance. No area complete; no new token gap.

Grid/canvas-first/collapsible layout/double-click Image entry/Companion/placements and prior dirty work preserved. No dependencies/locks/catalog/attribution/tokens/app migrations/dedicated service schema changes/upstream forks. **One new native command registration requires a matching updated binary; the verification binary is uninstalled.** Dedicated format-six/five registrations stay frozen. Prior computer-use/listen/process-inventory denials respected without bypass; no sockets. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. All owned gates/writers terminal; final read-only verification follows this log update.

## 2026-10-12 — Codex / XDesign native Image archive and scoped transport

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; this turn makes progress. Added a strict dedicated single-image archive codec preserving native layers/precision, exact checked previews, saved views/history and nested smart sources. Local links embed in copied current/historical bundles; remote current/nested/historical links, unknown paths/fields/versions, corrupt inventories, missing/extra history and changed reviews are refused. Imports stage validated native assets under fresh local identities; existing/competing destinations and uncertain reservation markers refuse replacement. Eight native/typed room Image operations now use the existing pinned credentials/session/cancellation workers, separate transfer limits, canonical SDK/raw byte hashes, detached requests and single-flight preparation/decoding. Writes require exact chunk/publication/dismissal acknowledgements. **No staged-file IPC bridge or canvas Image endpoint calls yet; ordinary joins still lack native Image documents.**

**40 frontend cases/four files, 29 distinct native cases and final compiler/production build pass.** Initial 39 frontend, 21 native room/seven archive and build pass; history fixture fails before archive code because a temporary parent is absent. After all initial gates terminate, four-file correction fixes parent setup/two const-reference warnings and adds typed acknowledgement/copy coverage. Final eight native archive/history cases execute in the rebuilt uninstalled binary, retaining the unchanged initial 21 room cases as source-specific evidence. Actual generated 8/16/32-bit bundles verify float pixels/layers, nested embedding, concurrency/corruption and native history reopen/source IDs/redo/undo/undo/redo. Initial/final native compile 29.47s/11.57s; final log has no warnings. Initial/final Vite 44.58s/34.83s, explicit zero. Current native binary: 156,540,048 bytes / SHA `9a1e9ef6e9d9aa611ffba5d88e766fc5cbb828eea9dd5bb151bdda8c89904329`. Current production AST/notices retains six exact worker executions/697 inputs/one copy/23 packages in 285 notices. Exact service/307–308-input engines retain 158 cases without rerun. **21,906 frozen inputs / 22,476 total hashes / 22,435 exact preceding hashes**, seven expected prior source/docs changes, nine replaced verification outputs, eighteen evidence files. Writer 45081/bbe7d0 exits zero; machine SHA `4f38495bf9252245d42789cb1308d4ed084b0ee3c1690c3f472c0318669990cd`. First writer's Unicode-line whitespace assumption and pre-freeze Node crypto assignment failure are retained; helper-only correction needs no source changes or gate rerun. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-image-native.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-image-native.json).

**Next:** native file-backed prepare/read/stage/import/recovery APIs (avoid full-archive frontend IPC), strict room image references, durable client pending/recovery, lazy joined-image hydration and canvas editing/publication. Codec work still needs operation cancellation/resource integration. Generated documents are not supplied original PSD/PCRAFT; embedded non-native authored/decoder compatibility and rendered/managed-color preview correspondence remain unproven. Crash-marker recovery/durability/operator cleanup, decoded/aggregate memory/disk/WAL/receipts/checkpoints/latency/compaction/crash/upgrade/Node22/deployment/key lifecycle, native media/verified accounts/teams and every matching installed IPC/keychain/TLS/HTTP/WebKit/UI/visual/original/device/tablet/IME/font/keyboard/accessibility/FIG export-reopen plus broader six-area gate remain open. No area complete; no new token gap.

Original grid/canvas-first/collapsible layout/double-click Image entry/Companion/placements/dirty work preserved. No dependencies/locks/catalog/attribution/tokens/app migrations/new native command registrations/upstream forks; dedicated format-six/five registrations stay frozen. Prior computer-use/listen/process-inventory denials respected without bypass; no sockets. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. All owned gates/writers terminal; final read-only verification follows log update.

## 2026-10-12 — Codex / XDesign resumable room Image archive service

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; this turn makes progress. Shared Design checkpoints currently retain local Image document IDs while room joins create no native Image documents. Added the service/protocol foundation for transferring complete editable-image bundles as opaque original bytes: canonical SDK manifest/revision hashes, checked out-of-order 1 MiB chunks, restart progress, pinned immutable reads, exact predecessor publication and atomic revision/head/original result. Current viewers read; creator/editor or owner successors publish. Reauthorization, room/member/request isolation, rejected/stale/failed writes, downgrade/rename recovery, pending-only dismissal/tombstones and corruption refusal preserve originals. This does **not** yet decode native bundles or hydrate/publish joined Image/PSD editing. Dedicated service format six appends four tables (16 total), frozen immediately; previous format-five registration and application migrations remain exact.

**All initial checks pass: 158 actual SDK/Node-stream/temporary-SQLite service cases/11 files, four SDK/Web Crypto protocol cases and TypeScript.** Fifteen new Image workflows include independent concurrent SQLite writers and 500 actual accepted opaque-byte revision publications; fixtures are synthetic bytes, not authored PSD/PCRAFT. Pure/client engines are 494,063/505,234 bytes, 307/308 inputs, eight notices/no warnings. Inputs freeze before gates; every gate explicitly terminates before documentation edits. No source corrections or passing-gate reruns. Exact eleven preceding production outputs, 697 worker inputs/six prior executions and native source/compiler/uninstalled binary retain preceding scopes without build/native/worker reruns. Earlier 174 frontend/13 SQL cases remain exact and are retained, not rerun. **21,901 frozen inputs / 22,451 total hashes / 22,420 exact preceding hashes**, 12 expected prior source/docs changes, zero replaced verification outputs and 13 evidence files. Writer 6670/e048d5 exits zero; machine SHA `d47a2c6ebc1c1ca81a6d16fa383c053d3979b7696c2803292f7efcaa712064d1`. First writer 63130/d98888 fails on a license-asset list/map assumption; helper-only correction after terminal failure preserves it and requires no gate rerun. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-room-images.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-room-images.json).

**Next:** strict native portable single-image export/import/validation (embed linked sources; reject remote linked paths) and scoped chunk transport, then image-reference admission, durable client pending/recovery, lazy editable hydration and canvas publication. Ordinary joined rooms still lack native Image documents. Native media dependencies, verified account/team identity and every broader Image/prototype/composition/original/device gate remain open. Structural chunk/count caps do not establish aggregate metadata/receipts/checkpoints/native memory/disk/WAL, operation latency/cancellation, compaction/crash/operator rollback/upgrade/Node22/deployment/key lifecycle; whole-file hashing is synchronous in a SQLite transaction. Matching installed native IPC/keychain/HTTP/WebKit/UI/visual/original linked files/FIG export-reopen/tablet/IME/font/keyboard/accessibility acceptance remains unpassed. No area is complete; no new token gap.

Original 40px grid/canvas-first/collapsible layout/double-click Image entry/Companion/placements and pre-existing dirty work preserved. No dependencies/locks/catalog/attribution/tokens/app migrations/native registrations/upstream forks. Prior computer-use/listen/process-inventory denials respected without bypass; no sockets. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends. No owned gate/verifier remains live; final read-only verification follows the log update.

## 2026-10-12 — Codex / XDesign canvas room libraries and durable publication

**Branch:** validation/alpha-2026-09-14

The full unbudgeted six-area `/goal` remains active; this turn makes progress. Assets now merges device/downloaded room libraries under distinct SDK identities, with explicit Refresh/Download and existing insertion/update review/undo. Saved device libraries can be reviewed for room publication without changing local source metadata or revisions. Pinned complete-history checks refuse partial/corrupt/foreign/regressed results. Original publication packets save before native dispatch, recover receipts before replay and clear only after accepted cache storage and pending removal save. Viewer reads/accepted recovery preserve artwork restrictions. Source/member/epoch cancellation, detached small UI summaries, rejected-draft retention and confirmed local dismissal are connected. Ordinary opening performs no library network operation. Project-bound pending CAS refuses late deleted-project writes; native deletion atomically cleans its grants/comment/library pending and rolls back on registry failure.

**174 distinct frontend cases/11 files, 13 actual temporary-SQLite cases/three files, six native project-state cases and final compiler/production build pass.** Initial 154/172 exposes a thumbnail-copy realm issue plus fixture equality/stable-key problems; all failures are retained. Three-file correction after every initial gate terminates normalizes validated thumbnail bytes and fixes fixtures, adding late accepted-reply/fresh-viewer-role coverage. Final affected 94/five (10.79s) retains 80 unchanged cases/six files. Initial/final builds explicitly exit zero (Vite 42.28s/37.40s). Native compilation 43.05s replaces the uninstalled verification binary, now 155,795,808 bytes / SHA `89f7d94be41679ceaa691e150d85cce4780736184f289726aad67c2a0553b7f7`; six state cases execute, while prior 17 room cases retain source-specific evidence without claiming new-binary execution. Exact service/306–307-input engines retain 143 cases/ten files without rerun. Current production AST/notices retain six exact worker executions/697 inputs/one copy/23 packages in 285 notices. Two 21,897-input freezes and final proof verify **22,432 total / 22,382 exact preceding hashes**, 11 expected prior source/docs changes, nine replaced verification outputs and 19 evidence files. Final writer 13576/exit zero; machine SHA `5efb996e68792e667ca61c08a549da400f4b756ca4f32a8717ecd7e14ba36fba`. Initial record assertions about the scoped native input map/separate shared-connection chunk are retained and corrected through actual full-source/current-chunk inspection, without source changes or gate reruns. No owned gate/verifier remains live. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-12-room-library-client.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-12-room-library-client.json).

**Next:** shared native Image/PSD/media dependencies, verified account/team identity and broader library lifecycle/resources, alongside every remaining Image/prototype/composition/original/device gate. Cached provenance is not current remote authorization. Matching installed native IPC/keychain/HTTP/WebKit/UI/visual/original linked files/FIG export-reopen/tablet/IME/font/keyboard/accessibility, aggregate memory/latency/disk/WAL/history/receipt compaction/crash/operator restore/upgrade/Node22/deployment/key lifecycle and every other original six-area requirement remain open. Synthetic image signatures test bytes, not rendering. No area is complete; no new token gap.

Original 40px grid/canvas-first/collapsible layout/double-click Image entry/Companion/placements and pre-existing dirty work preserved. Existing controls/dialogs/theme styles reused. No dependencies/locks/catalog/attribution/tokens/app migrations/native registrations/upstream forks; dedicated service format five stays frozen. Prior computer-use/listen/process-inventory denials respected without bypass, no sockets. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign immutable room library cache and resource identities

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; this and the preceding transport turn are progress. Downloaded library histories now use separate strict app-state/CAS storage, preserving exact original bundles and publication metadata. Derived SDK revisions use room/origin-specific component, variable/mode and image identities with original provenance, stable unchanged resources and inherited modes. Complete-history/rollback/corruption checks and bounded admission refuse stale replacements. Shared resource installation now preserves geometry image bytes and refuses conflicting identities before changing resources. **The cache is not yet connected to Assets**; the current build includes the shared installation improvement.

**72 frontend cases/five files, eight actual temporary-SQLite cases/two files and final compiler/production build pass** (Vite 1m 1s; 47246/exit 0). Initial 68/SQL8/type checks pass. Later stable-successor fixture checks fail on internal-only pages and an incorrect PAGE type; all failures are retained, then corrected through actual addPage/CANVAS after gates end. Thirteen final cache/resource cases cover reopening, source isolation, nested choices/overrides, image collisions, geometry resources, stable variables and admission. Current production AST/notices retain the exact worker/697 inputs/six executions/one copy/23 packages in 285 notices. Exact unchanged service/engine/native inputs and the 17-case uninstalled binary retain prior scope without rerun. An initial record-writer chunk assumption fails; corrected unique SDK-runtime guard inspection needs no source changes or gate rerun. **21,888 frozen inputs / 22,402 total hashes / 22,356 exact preceding hashes**, five preceding source/docs changes, seven replaced production verification outputs and 27 evidence files. Final writer 90350/exit 0. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-room-library-cache.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-room-library-cache.json).

**Next:** canvas-owned room library controller, pinned complete history download, composite local/remote catalog, explicit publication/revision review, durable client pending/recovery and library panels. Ordinary opening must never publish. Cached provenance is not current remote permission or verified account/team identity. Shared native Image/PSD/media, authored/installed/native/keychain/HTTP/WebKit/UI/device/tablet/IME/font/keyboard/accessibility/FIG export-reopen, aggregate memory/latency/disk/WAL/receipt compaction/crash/operator restore/upgrade/Node 22/deployment/key lifecycle and every other prototype/Image/composition/full six-area requirement remain active. No area complete; no new token gap. Synthetic signatures/empty geometry blobs test resources, not decoding/rendering.

Original 40px grid/canvas-first/collapsible layout/double-click Image entry/Companion/placements/dirty work preserved. No dependency/lock/catalog/attribution/token/app migration/native registration/upstream fork changes; dedicated format-five registration stays frozen and operator docs now say twelve tables. Prior computer-use/listen/process-inventory denials respected without bypass; no sockets. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign native library transport and bounded preparation

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding library-service turn and this turn are progress. The existing native/typed room bridge now exposes catalog/revision reads, portable library publication and original receipt recovery through immutable origin/document handles and scoped OS credentials. Closed DTOs/SDK identities/Unicode/graph checksums/resource validation and digest-bound responses preserve originals. Preparation, dispatch and asynchronous decoding stay single-flight; copied requests resist caller mutation and aborted/disposed sessions suppress late results. Recovery sends only the original request ID. Separate library transfer bounds preserve ordinary artwork limits. Native preparation now runs inside the timeout/cancellation guard on a blocking worker, retaining its operation lease until that thread actually returns. A service summary-bound bug is corrected: maximum valid multibyte names/descriptions remain readable after publication/restart/recovery. The format-five registration remains frozen; no app migration changes.

**59 frontend cases/four files, 143 actual SDK/Node-stream/temporary-SQLite service cases/ten files, 17 native cases and compiler/production build pass.** Initial frontend 8.49s, service 9.07s, native 16 cases (1m compile/18.98s tests) and build (Vite 1m 5s) all pass and end before the native worker improvement. Final native passes 17 cases after 19.81s compile/15.88s tests, including real blocking-thread cancellation/lease retention. Exact unchanged frontend/service/build inputs retain their passes without rerun. Production AST/notices verify the exact 1,905,078-byte worker/697 inputs/one copy/23 packages in 285 notices; six actual executions are retained. Pure/compiled connection engines remain exact at 482,989/494,160 bytes, 306/307 inputs, eight notices/no warnings. Native IPC/app storage are mocked in frontend fixtures; native tests use planning/actual response streams/real workers without keychain/network/UI. New binary is uninstalled. **21,884 frozen inputs / 22,368 total hashes / 22,330 exact preceding hashes**, explicit terminal receipts, schema hash and replaced native/production verification outputs are recorded. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-library-transport.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-library-transport.json).

**Next:** room-scoped remote catalog/cache with local/remote identity collision protection, publication/revision review, durable client pending/recovery and library panels. Native/typed transport alone does not complete their UI. Normal opening must never publish. Verified accounts/cross-room teams, native Image/PSD/media dependency sharing, actual original/installed-app/keychain/HTTP/WebKit/UI/device/tablet/IME/font/keyboard/accessibility/export-reopen acceptance, aggregate memory/operation latency/disk/WAL/receipt compaction/crash/operator backup/restore/upgrade/Node 22/deployment/key lifecycle and every remaining prototype/Image/composition/full six-area requirement remain active. No area complete. Synthetic large graph strings test native transfer bounds, not SDK artwork or latency. No new design-token gap.

Original 40px grid/canvas-first/collapsible layout/double-click Image entry/Companion/placements/dirty work preserved. No dependencies/locks/catalog/attribution/tokens/app migrations/native registrations/upstream forks changed. Prior computer-use/listen/process-inventory denials respected without bypass; no sockets. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign room-scoped library service

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding unified-history turn and this turn are progress. The dedicated room service now publishes and retrieves immutable component libraries with strict portable manifests/graphs, existing SDK asset/revision hashes, whole-bundle/graph integrity, original metadata/thumbnails/images/nested definitions/variable modes and missing-resource refusal. Current members read; editors publish their own library, owners can publish successors preserving the original creator. Exact predecessor checks and atomic head/revision/member-request receipts support unchanged retry and restart recovery after publisher downgrade or a full admission cap; revoked access is refused. Reads reauthorize and recheck stored bytes after asynchronous validation, refusing changed latest heads or damaged storage. Equal library/request IDs stay room scoped. Dedicated service format five appends three tables (12 total), frozen immediately; earlier app migrations/live profiles are untouched.

**32 distinct frontend cases/two files, 142 actual SDK/Node-stream/temporary-SQLite service cases/ten files (13 new library cases), and final TypeScript pass.** Initial 30/140/type gates all pass and end before resource/geometry/isolation/interrupted-read strengthening. Final six affected frontend cases pass in 2.58s, retaining 26 unchanged local-library cases; final service passes in 6.53s. Pure engine 482,989 bytes/306 inputs; compiled connection client 494,160/307; eight notices/no compiler warnings. All owned gates terminal before edits. **21,882 frozen inputs / 22,345 total hashes / 22,310 exact preceding hashes**, schema hash and initial/final logs/receipts are retained. Initial freeze reply was unavailable after compaction; the same handle was closed and its completed artifact matched all inputs before gates, without restart. Final freeze has explicit zero exit. Existing production outputs, worker 697 inputs/six actual executions and native source/13-case uninstalled binary remain exact; no production/native/worker gate repeated for this service-only increment. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-team-libraries.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-team-libraries.json).

**Next:** native HTTP/keychain and strict typed library transport, room-scoped remote catalog/cache with local/remote identity collision protection, library publication/revision review and durable client outbox/recovery before library panel integration. Current local libraries remain functional; normal opening must never publish automatically. Native Image/PSD/media dependency sharing, verified account/cross-room team identity, original/installed app/device/tablet/IME/font/keyboard/accessibility/export-reopen acceptance, aggregate memory/latency/disk/WAL/receipt compaction/crash/operator backup/restore/upgrade/deployment/key lifecycle/Node 22 and every remaining prototype/Image/composition/full six-area requirement stay active. No area is complete. Structural service admission bounds are not resource acceptance. No new design-token gap.

Original 40px grid/canvas-first/collapsible layout/double-click Image entry/Companion/placements/dirty work preserved. No dependencies/locks/catalog/attribution/tokens/app migrations/native registrations/upstream forks changed. Prior computer-use/listen/process-inventory denials respected without bypass; no sockets. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign unified canvas history

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding author-controls turn was progress. Global toolbar/keyboard and room-owned native editor actions now order selective artwork and durable semantic comments together. Native labels/batches/view endpoints remain; intent reservations split coalescing and keep delayed comments before later artwork. Restored pending comments precede new artwork in a fresh session. Receipts deduplicate and keep current member/origin/step semantics. Viewer comment undo stays available without artwork rights. Comment replay blocks competing artwork, recovers unknown outcomes through existing pending metadata and restores current access afterward. Batch/gesture/room/pending changes refresh availability without a network poll. New actions suppress abandoned native redo; native methods restore on disposal. Previous artwork stacks are not reconstructed on reopening.

**148 distinct frontend cases/eight files and final compiler/production build pass** (Vite **1m 6s**, session 13815/explicit zero). Initial 144/145 and intermediate 146/147 failures are retained: one peer-delivery fixture used a network-poll deadline, then the 200-entry functional native capacity case hit default 5s while a build ran. After all gates terminate, explicit peer delivery/status notifications/two regressions precede intermediate 54.46s build/zero. Further post-terminal restored-pending ordering and one regression give 68 affected/three-file passes (11.75s), retaining 80 unchanged cases; all 200 native replays remain, with a 20s functional allowance and no latency claim. Direct production AST/notices passes with the exact worker/697 inputs/one copy/23 packages in 285 notices; six prior actual worker executions are retained. Exact unchanged service/compiled connection-engine and native inputs/binary retain **129 service/13 native** cases without repeating them. Desktop comment-client checks are frontend SDK/controller fixtures, not the compiled connection engine. Proof: **21,878 frozen / 22,321 total hashes / 22,283 exact preceding hashes**, nine expected preceding source/docs changes, seven replaced production outputs, 16 evidence files. All owned gate/verifier handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-canvas-history.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-canvas-history.json), SHA `33dd5d78d0254cf8139082a841e0a0417290e84822153c3fbca2699bc8fddd29`.

**Next:** collaboration feedback/account/team/library/shared Image/PSD services and broader historical/raw interoperability, alongside remaining Image/prototype/composition/resource work. Global fresh-session ordering is connected; arbitrary raw undo-manager callers, other-device ordering and cross-session artwork reconstruction remain broader acceptance. Original linked assets/matching installed native/keychain/network/WebKit/dialog/menu/keyboard/tablet/IME/fonts/accessibility/export-reopen and aggregate memory/latency/disk/WAL/history/receipt compaction/crash/operator upgrade/Node22/key lifecycle remain open. Every original six-area requirement stays active; no area is complete. Current binary is a verification output; explicitly account for its replacement on future native compilation. No new token gap.

Grid/canvas-first/collapsible panels/double-click Image entry/Companion/placements/dirty work preserved. Existing frontend-design guidance/styles/tokens reused; no dependency/lock/catalog/attribution/token/migration/native registration/engine fork. Prior computer-use/listen/process-inspection denials remain binding without bypass. Changes **uncommitted**; no commits/push/releases/deploy/package/install/live profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign desktop original-author controls

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding service-author turn was progress. Share now exposes explicit searchable/paged original-author assignment/removal and interrupted-request recovery through existing nonsecret sharing metadata. Strict native/typed catalog/self/assign/recover operations preserve original names/IDs/time and current-owner/source/step checks. A current-member-only self-ownership API and canvas-owned single-flight client enable granted comment edit/delete/pin controls; legacy actions reread rights before saving/dispatch, and the service independently reauthorizes. Viewer artwork stays read-only. Original attribution/history ownership stays intact; owner delegation is not verified account identity. Normal opening remains idle.

**148 distinct editor cases/12 files, 129 actual Node service cases/nine files and 13 native cases pass.** Initial 144 editor cases pass; a fixture's widened role stops the initial compiler before Vite. After all initial gates terminate, literal-role/source/pending-read guards and three DOM cases give 14 affected passes and an explicit-zero build (1m 8s). After every intermediate gate ends, valid imported dictionary-name IDs gain own-property selection and one regression; final 15 affected cases pass (8.60s), retaining 133 unchanged cases. Final compiler/build has its complete **1m 21s** marker/current artifacts; session 68557's terminal reply was lost at compaction and the same handle is unavailable. No exit is invented or build repeated. Direct current-production AST/notices inspection exits zero, retaining six exact worker executions/697 inputs. Pure/client engines are **458,286/469,457 bytes, 285/286 inputs, seven notices/no warnings**. Actual uninstalled native test binary/13 passes are verified. Proof: **21,874 frozen / 22,299 total hashes / 22,243 exact preceding hashes**, 18 expected preceding source/docs changes, seven expected replaced production outputs, 22 evidence files. The verifier's corrected dependency-inventory assertion/failure is retained. No owned gate/verifier remains live. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-author-controls.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-author-controls.json), SHA `501e97305046be30622936393f32675bf641e4b5e5b016ce05d5ba316e76fcaa`.

**Next:** unified artwork/comment history ordering, broader historical/raw recovery and collaboration feedback/team/account/library/shared Image/PSD services. Other members refresh granted access explicitly; service checks govern stale UI. Deleted/reaction/resolution-only/malformed original identities remain outside catalog coverage. Matching installed native/keychain/network/WebKit/dialog/original linked assets/tablet/IME/fonts/keyboard/accessibility/export-reopen, aggregate memory/latency/disk/WAL/history/receipt compaction/crash/operator upgrade/Node22/key lifecycle and every other original six-area requirement remain open. No area is complete. Current native binary is a verification output; future native compilation must explicitly account for its changed hash rather than silently retain it. No new token gap.

Original grid/canvas-first/double-click Image entry/Companion/placements/dirty work preserved. Existing styles/tokens reused; no dependency/lock/catalog/attribution/token/app or room migration/native IPC registration/engine fork. Computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign explicit imported comment author grants

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding recovery turn was progress. Room owners can now explicitly delegate an original imported message-author identity to one current member without relabeling document authors/timestamps/root/message IDs. Current membership/grants protect raw atoms/projected historical restoration and semantic edit/delete/pin/undo. History stays with its recording member. Viewers gain only semantic comment ownership. Versioned assignment/removal and durable receipts recover original/current state without replaying superseded grants. Dedicated room format four appends an author catalog/receipt table atomically from format three; known members are excluded and application migrations stay unchanged. Catalogs cover live visible original message authors and retain the first label, not already-deleted or reaction/resolution-only identities. Owner delegation is not verified account identity.

**128 actual Node service cases/nine files, 115 editor cases/eight files and TypeScript pass.** Initial 126/127 service results retain one stale seven-table assertion failure; all 15 initial author cases passed. After all initial handles terminate, four service/test corrections fix the nine-table expectation, cache member identity lookup/iterate upgrade checkpoints, strengthen raw restoration and add revoked pin/reply history coverage. Final 128/4.209s passes; final source changes leave frontend/compiler inputs unchanged. Pure/client engines are **454,209/465,380 bytes, 284/285 inputs, seven notices, no warnings**. Client evidence compilation follows the actual four-client-case gate; it is not another client execution. Exact unchanged seven production chunks/index/notices, worker/697 inputs/six prior actual executions and native/11 prior cases/binary retain prior checks without repetition or installation. Proof verifies **21,868 frozen inputs / 22,268 total hashes / 22,228 exact preceding hashes**, 14 expected preceding changes, 21 evidence files. All owned gate/verifier handles terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-comment-authors.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-comment-authors.json).

**Next:** strict native/typed author routes, owner grant controls, grant-aware canvas ownership and durable pending assignment recovery. Current editor ownership controls still compare literal IDs and do not expose the new grants. Recipients also need a current self-ownership read API; owner-only catalog endpoints must not be silently made public. Broader historical/raw interoperability, unified artwork/comment undo, richer collaboration feedback/verified accounts/team/library/shared Image/PSD and aggregate resources/receipt compaction/crash/operator upgrade/key lifecycle remain open. Prior append stages are individually transactional, not a global multi-version rollback. Raw restoration of differently attributed contained replies needs their current grants; semantic root undo uses original server-held peer metadata. Node 22 and every other six-area/native/live/original/tablet/IME/font/keyboard/accessibility/export-reopen requirement remain active. No area is complete. No new token gap.

Original grid/canvas-first/double-click Image entry/Companion/placements/dirty work preserved. No frontend production/native registration/dependency/lock/catalog/attribution/token/application migration/engine fork changes. Dedicated room append only. Computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign retained collaboration artwork recovery

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding raw-admission turn was progress. Share now offers **Save local copy** and **Open latest shared version** for error/viewer/disconnected connections with unsent artwork. Both save/preserve the source project and its checkpoint/pending requests through the existing atomic import. Local recovery clones linked assets and drops only the copy's shared checkpoint; reopened local artwork is editable. Shared recovery independently reads a complete server checkpoint with pinned source/editor/member/live revision/applied-clock checks and opens a fresh shared project. Rejected causal operations are never merged or uploaded during recovery. Cancellation/navigation/late handle/clone/disk/actor/rollback/incomplete replies preserve original content/access. Duplicate recovery/connection starts and active edits are guarded; UI controls disable competing actions. Project-ID canvas remount handles dialog handoff. New sessions keep existing fresh-undo behavior; no cross-project undo persistence is added.

**151 distinct frontend cases/eight files, four actual Node client/service cases and production compiler/build pass** (Vite 56.42s/explicit zero). Initial 149/10.13s and typecheck pass; after all initial gates terminate, a post-open source guard and two cases give 43 affected/10.27s, retaining 108 unchanged passes. Node four/.993s includes a real rejected hidden-comment/mixed-artwork upload and clean independent authenticated read; the full eight-file service corpus totals 112 with 108 exact retained cases. Actual client engine **463,613 bytes/284 inputs/seven notices/no warnings**; pure service remains 452,442/283. Current production AST verifies the exact 1,905,078-byte worker/697 inputs/one copy/23 packages in 285 notices; six prior actual executions and 11 exact native cases/binary are retained without repetition or installation. Proof verifies **21,865 frozen inputs / 22,242 total hashes / 22,208 exact preceding hashes**, five source/three documentation changes expected, 15 evidence files/seven current production chunks. All owned gates/verifiers terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-room-recovery.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-room-recovery.json).

**Next:** legacy-author mapping, broader raw interoperability/historical ownership recovery, unified artwork/comment undo, richer feedback and verified account/team/library/shared Image/PSD services. Recovery preserves branches; it does not automatically repair/replay/discard a rejected outbox. A valid preference or staged native assets may remain after later import failure. Native IPC/app SQLite/OS asset copying are mocked in frontend fixtures; actual authored/linked PSD assets/keychain/network/WebKit/renderer/UI/crash and aggregate memory/latency/disk/WAL/history/receipt compaction still require acceptance. All other six-area/original/tablet/IME/font/keyboard/accessibility/export-reopen/deployment/upgrade/key lifecycle/Node 22 requirements remain open. No area is complete. No new design-token gap.

Original grid/canvas-first/double-click Image entry/Companion/linked placements/dirty work preserved. Frontend-design guidance applied to compact conditional controls using existing styles/tokens. No dependencies/locks/catalog/attribution/tokens/app or room migrations/native registrations/engine forks. Prior computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign raw collaboration operation admission

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding turn was progress. New raw packets now pass service-only Yjs operation admission plus projected policy under current-member SQLite authorization before any history/checkpoint/receipt write. Every merged/intermediate/losing/tombstoned atom proves comment ownership; immutable authors/times/root identity, reserved artwork metadata and historical page types are guarded. Known clocks must agree; missing parents/origins/right origins/prefixes and future deletion targets cannot remain buffered behind a low advertised vector. Effective candidate deletions include container cascades. Own edits/reactions/selective undo, author/root/page deletion rights, historical names, partial/full/binary replay and receipt recovery remain supported. Cached ownership avoids repeated historical scans.

**111 distinct focused editor cases/five files, 111 actual Node service cases/eight files and final TypeScript pass.** Initial established 85 service/108 editor passes are retained alongside 19 new fixture-ID failures and one compiler annotation failure. Corrected 104 service cases pass (6.935s); final affected 26 service/18 editor cases pass (1.893s/1.81s). A final one-case test-only strengthening (.462s) proves nonempty semantic history/provenance preservation and successful undo after a rejected hidden foreign mixed-artwork write. Corrected/final/strengthened engines are exact: **452,442 bytes/283 inputs/seven notices/no warnings**, SHA `128e8b783585e5d4db2a3bfb8d6a0ef80a1c4e0cc146dacccd8006435f11a8d1`. Exact unchanged production/worker/native inputs retain prior build/six worker/11 native passes without repetition or installation. Proof verifies **21,865 frozen inputs / 22,216 total hashes / 22,183 exact preceding hashes**, two source/three documentation changes expected, 23 evidence files/seven retained production chunks. All owned gates/verifiers terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-raw-update.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-raw-update.json).

**Next:** broader raw interoperability/adversarial corpus and malformed historical ownership recovery, legacy-author mapping, rejected-provider recovery, unified artwork/comment history ordering, richer feedback and verified account/team/library/shared Image/PSD services. One-million-clock-unit raw refusal bounds and ownership caches do not establish aggregate memory/latency/disk/WAL/history/receipt compaction or crash/operator rollback acceptance. Matching installed native/network/keychain/WebKit/renderer/UI, authored originals/tablet/IME/fonts/keyboard/accessibility/export-reopen/deployment/upgrade/key lifecycle/Node 22 and every other six-area requirement remain open. No area is complete. No new token gap.

Original grid/canvas-first/double-click Image entry/Companion/placements/dirty work preserved. No frontend/runtime/native registration/dependency/lock/catalog/attribution/token/app or room migration/engine-fork changes. Prior computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign canvas comment history and semantic recovery

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding turn was progress. Comments now exposes Your comment history with member-scoped Undo/Redo, Refresh/Older/Latest, applied/undone labels and comment navigation. A canvas-owned client uses a separate native handle, holds one request through canceled/late adapters and replaces one bounded 100-entry page. Normal opening stays idle. Commands invalidate older summaries; current project/editor/origin/member/epoch guards suppress stale reads. Undo/redo uses the existing durable pending/receipt/checkpoint path, including lost-reply recovery after reopening. Viewers remain unable to edit artwork; local comment undo stays intact. Explicit discard clears obsolete errors and expected read cancellation stays quiet.

**116 distinct frontend cases/eight files pass** (initial 114/8.13s; final 22 affected/two files/1.47s), as do initial/final TypeScript, production build (48.21s / explicit zero) and six actual bundled-worker checks. The four-file final correction follows terminal initial gates and adds two DOM cases. Unchanged service/engine/native inputs and actual binary retain prior 85 service/11 native passes without repeating gates. Worker remains 1,905,078 bytes/697 inputs/one production copy/23 packages in 285 notices; engine stays 428,323 bytes/282 inputs/seven notices. Proof verifies **21,862 frozen inputs / 22,188 total hashes / 22,160 exact preceding hashes**, seven source/three documentation changes expected, 14 evidence files/seven production chunks. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-comment-history-ui.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-comment-history-ui.json).

**Next:** comprehensive latent/losing/tombstoned raw CRDT authorization, legacy-author mapping, rejected-provider recovery, richer feedback, verified accounts/team/shared Image/PSD services and every other six-area requirement. Explicit comment history is connected; global artwork undo retains its selective stack and unified ordering is unaccepted. A listed page is a snapshot; changes from another device may require refresh/server conflict recovery. Older pre-format-three actions have no ledger. Operator rollback losing receipts, real crash/deployment/upgrade/key lifecycle/Node 22, aggregate memory/disk/WAL/latency/history/receipt compaction, installed native/network/keychain/WebKit/renderer/UI, original/tablet/IME/fonts/keyboard/accessibility/export-reopen remain open. No area is complete. No new token gap.

Grid/canvas-first/double-click Image entry/Companion/placements/dirty work preserved. No dependencies/locks/catalog/attribution/tokens/application or room schema migration/native registration/engine fork. Prior computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign semantic comment history service and transport

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; this turn made progress. All seven comment actions now have authenticated semantic undo/redo in the service and existing native/typed transport. Immutable member/source/step records restore original message metadata, selectively preserve peer activity and reject later same-value changes with field provenance. Checkpoint, history, tokens, revision and permanent receipt commit together; retry/recovery after restart executes once. Member-only 100-entry seek pages expose summaries, not snapshots. Dedicated room format three appends two tables atomically, retaining old rooms/grants/receipts and validating the grant key before the format-two append. Application migrations stay unchanged. Older actions have no retroactive ledger.

**101 distinct frontend cases/eight files, 85 service cases/seven files (17 history, 4.648s), 11 native cases (41.05s compilation/.02s tests), corrected TypeScript, production build (53.88s / explicit zero) and six actual production-worker checks pass.** Initial six author-fixture failures, one unused type error and old five-table expectation are retained. Final correction freezes before gates; unchanged native inputs retain their initial pass without recompilation. The intermediate freeze's completed artifact is retained, but its terminal handle/output was lost at compaction; no exit is invented. Final source freeze has explicit zero. Actual worker remains 1,905,078 bytes/697 inputs/one production copy/23 packages in 285 notices; engine is 428,323 bytes/282 inputs/seven notices/no warnings. Proof verifies **21,860 frozen inputs / 22,170 total hashes / 22,128 exact preceding hashes**, 12 source/three documentation changes expected, 21 evidence files, seven production chunks and matching uninstalled native test binary. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-comment-history.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-comment-history.json).

**Next:** canvas-owned member history listing/undo/redo controls with current source/actor/epoch cancellation and durable existing-command recovery. Canvas history UI/global routing is not wired yet. Comprehensive latent/losing/tombstoned raw CRDT authorization, legacy-author mapping, rejected-provider recovery, richer feedback and team/shared Image/PSD/account services remain open. Admission caps (32 MiB record, 128 MiB room/512 MiB service data, 100k/400k field rows and permanent receipt capacity) do not establish aggregate memory/disk/WAL/latency/compaction or crash acceptance. Operator rollback losing receipts, deployment/upgrade/key lifecycle/Node 22, matching installed native/network/keychain/WebKit/renderer/UI, original/tablet/IME/fonts/keyboard/accessibility/export-reopen and every other six-area requirement remain active. No area is complete. No new token gap.

Grid/canvas-first/double-click Image entry/Companion/placements/dirty work preserved. No dependency/lock/catalog/attribution/token/app migration/engine fork/new native registration. Prior computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign canvas comment commands and pending recovery

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding turn was progress. Canvas comments now use the server-authored seven-action API through a separate native handle. Connected viewers can pin/reply/react/resolve and manage their own messages while artwork stays read-only. One strict project/origin/member/document/client/request/vector/command packet saves before dispatch, recovers before replay and survives failed/unknown replies, checkpoint saves and removal writes. Current source/epoch/member/revision and applied-vector admission precede publication; the project checkpoint saves before pending removal. External receipts invalidate older artwork replies, conservatively downgrade access and preserve pending uploads/selective artwork history. Forms retain drafts/text, disable duplicates, expose recovery/confirmed local discard and ignore stale navigation. Corrupt/newer data is preserved. Ordinary reopening never sends a comment automatically.

**102 distinct frontend cases/eight files pass**, including actual SDK/Yjs/binding/project/native-adapter and React DOM form fixtures. Initial 101/102 and three compiler storage-key errors are retained; four-file correction gives 31/three (4.66s). After every earlier gate ended, one test-only strengthening proves actual rejected-form text retention; its eight cases (1.23s) and final TypeScript pass. Production build passes (56.64s / explicit zero), as do six actual worker checks and a separate exact production AST/notice check: 1,905,078 bytes/697 inputs/one copy/23 embedded packages in 285 notices. Exact unchanged service/engine/native inputs and binary retain prior 68 service/ten native cases without repeating gates. Final proof verifies **21,856 frozen inputs / 22,143 total hashes / 22,106 exact preceding hashes**, ten source/three doc changes expected, 18 evidence files, all owned gates terminal. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-comment-canvas.md), [machine](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-comment-canvas.json).

**Next:** semantic server-authored shared comment undo/redo, complete latent/losing/tombstoned raw CRDT authorization, legacy-author mapping, rejected-provider recovery, richer feedback and team/shared Image/PSD/account services. New shared commands intentionally have no local/raw history restore; local/unconfigured comment undo remains. Pending submitted text persists, ordinary unsent drafts have no new reopen guarantee. Local discard cannot delete an accepted command. Operator rollback losing receipts, real crash, aggregate outbox/checkpoint/history/receipt memory/disk/WAL/latency/compaction, matching installed native/network/keychain/WebKit/renderer/UI, original/tablet/IME/fonts/keyboard/accessibility/export-reopen/deployment/upgrade/key lifecycle/Node 22 and every other six-area requirement remain open. No area is complete. No new token gap.

Grid/canvas-first/double-click Image entry/Companion/placements/dirty work preserved. Only an app-state key type is added; no migrations/dependencies/locks/catalog/attribution/tokens/engine forks/new native registrations. Denials respected without browser/native/socket/process-inspection bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign server-authored comment commands and recovery

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the preceding turn was progress. A strict seven-action comment API and its recovery route now use the actual SDK/SQLite service and existing registered native/typed transport. Add/reply/edit/delete/resolve/move/react are server authored: current membership supplies authors, server time supplies timestamps and scoped SHA-256 identities supply new IDs. Viewer service commands cannot upload artwork; author/root ownership, historical names, own reactions, resolution attribution, visible-page moves and stale target guards are enforced. Receipts commit with checkpoint/revision, bind immutable scope/payload and recover after restart or thread deletion without executing a missing action. `comment:` receipts survive ordinary artwork cleanup; 100,000 per room is a bounded admission cap that preserves existing recovery. Dedicated format-two/five-table schema and application migrations stay unchanged.

**133 distinct frontend cases/eight files (final affected 17/one, 929ms), 68 Node cases/six files (16 new command cases, 5.54s), ten native cases (28.39s compilation/.01s tests), final TypeScript, production build (Vite 72s / explicit zero) and six actual bundled-worker checks pass.** Initial one TypeScript fixture-cast and one Rust declaration compile error are retained; two-file correction happened after all owned gates ended and was frozen again. Seven unchanged frontend suites retain 116 initial passes; service/engine inputs remain exact after their passing gate, so no service/broad rerun. Engine: 414,440 bytes/281 inputs/seven notices/no warnings. Worker remains 1,905,078 bytes/697 inputs/one copy/23 embedded packages in 285 notices. Updated native test binary is not packaged/installed. Final proof verifies **21,852 frozen inputs / 22,119 input-evidence-document hashes / 22,083 exact preceding hashes**, with eight source and three doc changes expected, 19 evidence files. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-comment-commands.md).

**Next:** canvas-owned command controller with durable project-scoped pending packets, recovery before replay, source/actor/revision/applied-vector admission and asynchronous forms that preserve drafts. **Viewer canvas controls remain disabled** until that integration; this increment implements the service/native API. Complete authorization of latent/losing/tombstoned raw Yjs operations, legacy local/imported author mapping, semantic shared-comment undo/redo, rejected-provider recovery, richer feedback, verified account/team identity and team/shared Image/PSD services remain open. Receipt storage/compaction, aggregate memory/disk/WAL/latency, real crash/operator restore, native/network/keychain/UI/renderer/service deployment/upgrade/key lifecycle/Node 22 and every other six-area/original/device/tablet/IME/font/keyboard/accessibility/export-reopen requirement remain active. No area is complete. No new token gap.

Original 40px grid/canvas-first/double-click Image entry/Companion/placements and dirty work preserved. No dependencies/locks/catalog/attribution/tokens/app migrations/engine forks/new native registrations. Existing computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign connected comment authors and projection admission

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; this goal turn made progress. Configured room comments now use authenticated editor/owner IDs and names with read-only member labels. Local/unconfigured shared projects retain local profiles. Initializing/unpublished/disconnected/viewer authoring is blocked through the ordinary artwork channel; connection/member/name/document changes cancel pending pins, ordinary polling preserves them, and submission pins author/editor/graph/project/page scope. Corrupt local profile bytes remain untouched and cannot block room authoring or comment navigation. Existing historical authors are preserved. Unicode names support 128 UTF-16 units with control/surrogate rejection; cursor labels truncate at grapheme boundaries.

The room service rechecks membership and compares accepted/candidate comment projections inside its SQLite transaction before storing checkpoint/receipt. New authors, immutable author/time/root identity, own body/reply deletion, root deletion/movement, own reactions and attributed resolution are enforced. Hidden/non-page reserved metadata is checked; whole-page deletion retains artwork semantics. Individual replies/reactions still merge. Rejected mixed edits preserve checkpoint, revision and receipts; accepted retries recover across restart/downgrade and revoked retries fail. **This remains partial projection authorization, not comprehensive auditing of latent/losing/tombstoned raw Yjs operations.**

**85 frontend cases/seven files (3.97s), 52 Node cases/five files (11 new comment cases, 2.19s), TypeScript, production build (Vite 67s / explicit zero) and six actual bundled-worker checks pass.** All initial gates pass and ended before documentation edits. Engine: 402,241 bytes/279 inputs/seven notices/no warnings. Worker remains exact: 1,905,078 bytes, one production copy, 23 embedded packages in 285 notices. Native source/binary unchanged; prior eight-test scope retained without rerun. Final proof verifies **21,848 frozen inputs / 22,094 input-evidence-document hashes / 22,063 exact preceding hashes**, with eight expected source and three current-doc changes. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-comment-auth.md).

**Next:** server-authored viewer comment commands, durable semantic operation receipts/recovery/history and comprehensive raw CRDT authorization. Imported/local author mapping, restoring foreign replies/resolutions/stale labels, rejected-provider recovery, richer comment feedback, team/shared Image/PSD services and aggregate projection/checkpoint/history/receipt/WAL resources remain open. Every other prototype/Image/RAW/filter/PSD/memory/history/legacy/responsive/nested/media/export/original/device/tablet/IME/font/keyboard/accessibility/export-reopen requirement remains active. No area is complete. Native/live network/keychain/UI/renderer/service deployment/upgrade/key lifecycle/crash/Node 22 acceptance remains outstanding. No new design-token gap.

Original 40px grid/canvas-first/double-click Image entry/Companion/placements and pre-existing dirty work preserved. No dependencies/locks/catalog/attribution/tokens/native/app-migration/engine-fork changes. Existing computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/live-profile/production replacement/external sends.

## 2026-10-11 — Codex / XDesign canvas presence and collaborator follow

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active; the previous goal turn was progress. Authenticated canvas sessions now open a separate native presence handle and publish bounded current cursor/selection/page/view state. Single-flight requests, conservative independent expiry, sequence watermarks, scoped actor checks, stable increasing reconnect identity, ordered best-effort leave and late/source/timeout guards keep artwork synchronization independent. Cursor/selection SVG validates current-page world geometry and ignores input. Compact collaborator controls expose names/access/pages, Follow/Stop/retry; Stop stays outside busy inert chrome. Follow pins actor/client, checks cycles/missing/internal targets, fits the peer view through public SDK APIs (including zoom below .02), and stops on input, unavailable/expired peers, Image mode or disposal. Materialized-page fixtures preserve graph/checkpoint/history; ordinary local camera saving remains.

**134 distinct frontend cases/eight files (final 42/three, 6.78s), final TypeScript, production build (Vite 61s / explicit zero) and six actual bundled-worker checks pass.** Initial 130/134 and three type errors are retained: a real strict-adapter parser failure incorrectly retried, and geometry assertions assumed origin rotation/exact floating equality. Fatal classification, annotations and center/pixel-precision fixtures correct them. Five unchanged suites retain 92 passes. All owned gates terminal before edits. Native/backend/engine sources and the native binary remain exact; prior 41 Node/eight native scopes retained without repeating those gates. Final proof verifies **21,844 inputs / 22,074 input-evidence-document hashes / 22,045 exact preceding hashes**, with four source/three documentation changes expected and 15 evidence files. Worker remains exact at 1,905,078 bytes / one copy / 23 packages in 285 notices. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-canvas-presence.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-canvas-presence.json).

**Next:** authenticated comment-author/server permissions, team/shared Image services and every remaining six-area/original/device gate. Cursor badge truncation still uses UTF-16 slicing; include grapheme-safe labels in the font/IME work. Live native/network/keychain/bridge/UI/device, lazy-page/layout/resize/focus/keyboard/tablet behavior and aggregate IPC/lease/render/cleanup resources remain unaccepted. Process-local presence is not federation; grant labels are owner-assigned, not verified accounts. Member-name reconciliation, deployment/upgrade/key lifecycle/crash/Node 22 and matching installed binary stay open. No area is complete; no new token question.

Original grid/canvas-first/double-click Image entry/Companion/placements and pre-existing dirty work preserved. No dependency/lock/token/catalog/attribution/app migration/engine fork changes. Prior computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/pushes/releases/deploy/package/install/production/profile replacement/external sends or real credential/socket/service access.

## 2026-10-11 — Codex / XDesign authenticated ephemeral presence backend

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. A closed presence protocol and authenticated endpoint now carry bounded page/cursor/selection/viewport/follow targets without changing artwork, revisions, checkpoints, receipts, history or database schema. Current grant membership supplies labels/access; viewers can participate, stale/changed sequences and cross-member client collisions are refused, and revoked access is rechecked after body reading. Leases last 15 seconds; sequence tombstones last 90 seconds, with four active sessions/member, 128 retained slots/room and 128 in-memory rooms. New malformed Unicode is refused; invalid legacy labels remain stored and are refused/omitted without poisoning healthy rosters. Native/typed transports support 64 KiB request / 4 MiB reply limits. Canvas callers, cursor/selection overlays and follow controls are not connected yet.

**41 distinct Node cases (final ten / 434.58ms), 55 frontend/four files (final 18/two / 562ms), eight native cases (44.83s compile / 0.01s), final TypeScript and six actual bundled-worker checks pass.** Vite completes in 84 seconds; the post-build zsh wrapper used reserved `status` and exits one, so no build exit-zero receipt is claimed. Completed chunks and worker are independently verified. Truncated Unicode Node/compiler terminal outputs prompted focused receipt reruns; all original handles were confirmed ended before edits. Final backend-only legacy correction preserves frontend/compiler/native/production inputs. Freeze verifies **21,839 inputs / 22,052 input-evidence-document hashes / 22,005 exact preceding hashes**, with six source/three documentation changes expected. Worker remains exact at 1,905,078 bytes / one copy / 23 packages in 285 notices; service engine is 397,019 bytes / 278 inputs / seven notices. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-presence.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-presence.json).

**Next:** canvas presence client/lifetime, separate transport handles, conservative peer expiry, actor-pinned follow, graph-target validation, cursor/selection overlays and follow controls; then authenticated comment authors, team/shared Image services and every remaining six-area/original/device acceptance requirement. Process-local presence is not service federation; labels are owner-assigned grants, not verified accounts. Member rename/reconciliation UI, real native keychain/network/UI, matching installed binary, deployment/upgrade/key lifecycle/crash/Node 22 and aggregate resources remain open. No area is complete; no new token question.

Original grid/canvas-first/double-click Image entry/Companion/placements and pre-existing dirty work preserved. No dependencies/locks/tokens/catalog/attribution/app migrations/engine forks changed. Prior computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/pushes/releases/deploy/package/install/production/profile replacement/external sends or real credential/socket/service access.

## 2026-10-11 — Codex / XDesign saved room creation and invitation handoff

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Share now supports Create shared copy, Publish/recover, Invite/Recover/Copy/Done and explicit local dismissal. Project-scoped nonsecret pending records commit with saved copies, pin original checkpoint bytes and preserve newer/corrupt data. Reopened unpublished copies stay read-only until owner OS credential/configuration/pending removal succeeds. Lost replies, failed copying/storage and late work retain recovery; unresolved duplicate invitations are refused. Native verified asset copying preserves layered PSD files, drafts/history and original projects under separate project IDs. Copies start fresh shared history; original transient local undo is not newly persisted across reopening.

**159 distinct frontend cases/nine files (final 41/three, 13.80s), 18 native cases (54.72s compile), final TypeScript, production build (Vite 1m 21s) and six actual bundled-worker checks pass.** The initial fixture failure correctly hit a webpage ownership guard; correction, toolbar refinement and the later PSD asset-ownership fix retain all phases, including the initial 1m 24s build. Final freeze verifies **21,835 inputs / 22,014 input-evidence-document hashes / 21,966 exact preceding hashes**, with eleven source/three documentation changes expected. All owned gates terminal before edits. Worker stays exact at 1,905,078 bytes / one copy / 23 packages in 285 main notices. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-grant-ui.md), [machine record](docs/architecture/xdesign/acceptance-artifacts/checks-2026-10-11-grant-ui.json).

**Next:** presence/follow, authenticated comment-author permissions, team/shared Image services, then every remaining prototype/Image/RAW/filter/PSD/memory/history/legacy/responsive/nested/media/export/original/device/IME/font/keyboard/accessibility gate. Real native keychain/network/UI, WebCrypto in native WebKit, key lifecycle/deployment/upgrade/crash and aggregate archive-copy/IPC/checkpoint/history/WAL resources remain open. Orphan copied assets after a later failed registry transaction have no new crash guarantee. Generic refused-operation messages remain. New clone registration requires a matching binary; none bundled/installed. No area complete; no new token question.

Original grid/canvas-first/double-click Image entry/Companion/placements and pre-existing dirty work preserved. No dependency/lock/token/catalog/attribution/app-migration/engine-fork changes. Prior computer-use/listen/process-inspection denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/package/install/production/profile replacement/external sends or real credentials/clipboard/service access.

## 2026-10-11 — Codex / XDesign recoverable room grants

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Creation/invitation request IDs now bind payloads to encrypted grant receipts committed with rooms/members. Exact retries return the original credential without duplicate membership; administrator/owner-scoped GET recovery avoids replaying artwork and rejects changed/revoked grants. A stable service secret protects credentials, with scoped AES-GCM and a fingerprint; mismatch/corruption fails without replacement. Dedicated room format one appends format-two receipt storage atomically, preserving original rows; no Tauri app migration is added. Native operations and the typed adapter support receipt IDs and recovery; Create/Invite UI still needs pending requests and credential handoff.

**31 Node cases (2.238s, 11 new grant checks), 44 frontend/four files (9.25s), seven native cases (35.47s compile / 0.01s tests), TypeScript, production build (Vite reports 2m 1s) and six actual bundled-worker checks pass.** Initial Rust compile failed on two old direct test constructors missing the optional field; final `None` corrections pass. Frontend/Node/type inputs remain unchanged after their passes. Final freeze pins **21,832 inputs / 21,980 input-evidence-document hashes / 21,949 exact preceding hashes**, with six source/three documentation changes expected and terminal receipts retained. Engine remains 391,747 bytes / 277 inputs / seven notices. Worker stays exact at 1,905,078 bytes, one production copy, 23 packages in 285 main notices. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-room-grants.md).

**Next:** durable nonsecret pending creation/invitation records, a saved shared-copy workflow preserving old history, OS owner-credential handoff and invitation copy/recovery/dismissal UI, then presence/follow/authenticated authors/team/shared Image services. Encryption-key rotation/lifecycle, existing deployment upgrade/backup/crash/disk/WAL/aggregate resources, real native network/keychain/UI/device and every remaining prototype/Image/RAW/filter/PSD/memory/history/legacy/responsive/nested/media/export/original/IME/font/keyboard/accessibility gate stay open. No area is complete. Stable grant secret must be retained separately when administrator access rotates. Legacy calls without request IDs retain one-time behavior. Matching native binary still required, not packaged/installed.

Original grid/canvas-first/double-click Image entry/Companion/placements and dirty work preserved. No dependency/lock/token/catalog/attribution/app-migration/engine-fork changes. No real-profile/credential/socket/service access; denials respected without bypass. Changes remain **uncommitted**; no commits/push/releases/deploy/bundle/install/production/profile replacement/external sends.

## 2026-10-11 — Codex / XDesign room controls and viewer editing

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Share now provides room Join as a new atomic project, explicit Connect/Disconnect/Retry and owner list/change/revoke controls. A canvas-owned controller preserves the existing shared binding and selective history, suppresses late work and checks owner management before dispatch. Strict nonsecret `xdesign.rooms` preferences use existing app-state storage; credentials remain in scoped OS commands. Normal reopening stays disconnected; successful Join has a one-use connection intent. The native adapter is now production reachable.

Viewer edits are rejected at shared history/runtime boundaries and disabled in tools/properties/pages/libraries/comments; public SDK selection/pan/zoom/navigation, comments search/jump, copy, presentation and export remain. Async downgrade and late image replies are guarded. Accepted-only project-transition snapshots fix shared save failures; selection/page/viewport subscriptions fix stale React inspectors. Failed connection setup restores the saved offline role and history. Cached roles are last-known hints; server authorization remains authoritative.

**146 distinct cases across thirteen focused suites**, final TypeScript, production build (Vite **45.81s**) and six actual bundled-worker checks pass. The 145-case pass preceded a two-file setup-recovery correction; its 25 session/layout cases pass with one added case. Initial 143/two UI failures, corrected navigation, all compiler phases and the earlier 50.59s build are retained. Final freeze verifies **21,830 inputs / 21,958 input-evidence-document hashes / 21,188 exact preceding hashes**, including complete src and preceding SDK/compiler/native/catalog/attribution inputs. Actual worker remains exact: 1,905,078 bytes, one production copy, 23 packages in 285 main notices. Native source unchanged; no repeated native/full suite. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-room-ui.md).

**Next:** durable create/invite receipts and one-time credential handoff, presence/follow, authenticated comment-author permissions, team/shared Image services; every remaining prototype/Image/RAW/filter/PSD/memory/history/legacy/responsive/nested/media/export/original/device/IME/font/keyboard/accessibility gate remains active. Create/invite UI is still absent. Native matching-binary, actual keychain/network/TLS/proxy/crash/UI/device, viewer marquee/deeper navigation, late external library side effects and aggregate resources remain unaccepted. No area is complete. Failed project imports can retain already written OS credentials/nonsecret room preferences. No new token gap identified.

Original grid/canvas-first/double-click Image entry/Companion/placements and pre-existing dirty work preserved. No dependencies/locks/catalog/attribution/tokens/native/app-migration changes. Existing computer-use/listen/process-inspection denials remain; no bypass or real-profile/credential/socket access. Changes remain **uncommitted**; no commits/push/releases/deploy/bundle/install/live-profile replacement/external sends.

## 2026-10-11 — Codex / XDesign native room transport

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Seven registered Tauri commands and a typed opt-in desktop adapter now provide normalized origin/document handles, separate OS keychain scopes for room/admin credentials, strict service route operations, canonical transfer limits, bounded streamed replies, native cancel-before-dispatch and late-response suppression. Immutable room receipt IDs remain independent of native transport sequence IDs. Handles/operations are capped; a handle cannot overlap work. Recognized readonly/dependency errors preserve provider recovery. Credentials do not enter project exports; default opening stays local. The adapter has no production import or sharing UI yet.

**Six focused native tests (17.58s compile / 0.02s tests), 140 frontend cases / eight files (4.94s, including 13 new adapter checks), 14 separate layout cases (3.89s) and TypeScript pass on 21,097 unique frozen inputs / 21,205 input-evidence-document hashes / 11,720 exact preceding hashes.** One native registration source and three documentation changes are expected. Initial native 5/6 exposed a real Serde unit-variant unknown-field gap; an empty struct variant and strict regression fix it. The first frontend command mistakenly named nonexistent sharedLayout; actual PencilStudio.layout ran separately. Logs/status receipts retain all phases. No main production build repeat because new adapter has no production import; prior room-client build keeps its scope. Native registrations need an updated binary, which has not been bundled or installed. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-room-native.md).

**Next:** configured create/join/member controls and provider/session wiring, enforced viewer authoring, unknown-mutation recovery/durable grant handoff, presence/follow and authenticated comment-author permissions. Create/invite lack upload-style durable receipts; do not automatically retry unknown outcomes or lose available one-time grants. Native async keychain-read/network work has a 30s bound, but non-abortable OS keychain threads retain slots until they return; credential settings and synchronous serialization/decoding lack total latency acceptance. Real native network/keychain/UI/device/TLS/proxy/crash, aggregate IPC/copied-state/history/WAL resources, verified accounts/team libraries/shared Image/PSD services and every remaining prototype/Image/RAW/filter/PSD/legacy/responsive/nested/media/export/original/IME/font/keyboard/accessibility gate remain open. No area is complete.

No socket/service/real-profile/credential access. Existing listen EPERM/computer-use denial remain; process inspection was denied and not bypassed. Original grid/canvas-first/double-click Image entry/Companion/placements and pre-existing dirty work preserved. No token, dependency/lock, catalog/attribution or app-migration changes. Changes remain **uncommitted**; no commits/push/releases/deploy/install/live-profile replacement/external sends.

## 2026-10-11 — Codex / XDesign editor room connection

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. An opt-in room connection now owns one outstanding request, full reconnect/resync, immutable lost-reply retries, separate newer-edit delivery, accepted-clock/scope/member/revision checks and bounded dependency-conflict recovery. Accepted offline edits and selective history remain. Viewer grants receive peer state and retain local artwork without uploading new writes; enforced desktop viewer authoring is still open. Runtime owns the connection for an explicitly supplied adapter, suppresses stale-project callbacks and cancels it on canvas disposal. Normal XDesign opening supplies no adapter or automatic upload.

Incoming editor work now pins guards, removes aborted queue entries immediately and validates candidate checkpoints before publication. Accepted-update subscriptions operate while the legacy outgoing callback is disconnected. Identical admitted polls avoid canvas publication; changed revisions/payloads still undergo admission, including deletion-only updates. Close/disconnect are safe under reentrant observers. An adapter that ignores abort must settle before reconnection can send another request; bounded native transport remains next.

**141 frontend/editor cases / eight files (5.36s), 20 actual bundled client/service/SQLite cases (1.864s), final TypeScript, production build (Vite 43.91s) and six actual bundled-worker checks pass.** The optional Node client bundle is 402,041 bytes / 278 pinned inputs / seven notices; default service is 391,747 bytes / 277 inputs. Production connection chunk is 9,429 bytes. Worker remains exact at 1,905,078 bytes, one production copy and 23 packages in 285 main notices. Final freeze pins **11,627 unique inputs / 11,724 input-evidence-document hashes / 11,685 exact preceding hashes**; six source and three documentation changes are expected. Initial five fake-clock fixture failures and omitted intended runtime suite, corrected 139/139 phase, earlier 55.91s build and subsequent idle/reentrant corrections are retained. Every owned gate is terminal before edits. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-room-client.md).

**Next:** native HTTP/keychain adapter, configured create/join/member controls, viewer authoring restrictions, presence/follow and authenticated comment-author mapping; then remote accounts/team libraries/shared Image/PSD services. No sockets, desktop UI or real profile is accessed this increment. Existing loopback `listen EPERM` and computer-use denial remain. Canvas/DB fixture mocks, exact in-memory receipt identity rather than restart persistence, aggregate copied state/base64/Yjs/history/SQLite-WAL resources and genuine network/crash/device acceptance remain open. Continue all prototype/Image/RAW/filter/PSD/history/memory/legacy/responsive/nested/media/export/original/native/device/IME/font/keyboard/accessibility gates; no full-goal area is complete.

Grid/canvas-first/double-click Image entry/Companion/placements and pre-existing dirty work preserved. No token gap, dependency/lock/catalog/attribution/native registration or app migration changes. Changes remain **uncommitted**; no commits, pushes, releases, deploy/install/live-profile replacement, external sends or denial bypass.

## 2026-10-11 — Codex / XDesign durable room service

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Added a standalone repository Node/SQLite Design service with private dedicated DB creation, hashed room capabilities, owner/editor/viewer grants/revocation, strict versioned room/client/request scope and durable immutable retry receipts. Initial owner creation and checkpoint/receipt updates are transactional; exchange locks before reading. Applied-clock acknowledgment refuses incomplete dependencies, deletion-only changes survive equal vectors and receipt retention follows insertion order across clock corrections. Corrupt/foreign/newer records are preserved. No desktop connection or automatic upload is wired yet.

**17 actual engine/Node-stream-handler/SQLite/concurrent-writer cases (1.129s), 83 frontend cases/four files (2.95s) and final TypeScript pass.** The actual 391,533-byte Node bundle has 277 pinned inputs and seven complete embedded dependency notices. **11,624 unique frozen inputs / 11,694 input/evidence/document hashes / 4,400 exact preceding hashes** verify; two index/goal document changes are expected. Initial crypto/shim failures, one missing initial ULID freeze input and a 14/15 causal fixture phase are retained. The sandbox denied loopback listening with `EPERM`; final handler fixtures explicitly use no sockets. Live HTTP remains unaccepted. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-room-service.md) and [operator/protocol contract](docs/architecture/xdesign/room-service.md).

**Next:** native desktop HTTP/keychain connection/provider UI, immutable single-flight retries/reconnect/resync and cancellation/admission guards, viewer authoring restrictions, authenticated comment-author mapping/permissions, presence/follow, verified remote accounts/team libraries and shared Image/PSD services. Capability grants are authenticated memberships, not verified account identity. TLS/proxy/live network/Node22/crash/disk-full/multi-process deployment, aggregate copied-state/SQLite-WAL/receipt/history/tombstone resources and large-project acceptance remain open. Continue every prototype/Image/RAW/filter/PSD/history/memory/legacy/responsive/nested/media/export/original/native/device/IME/font/keyboard/accessibility requirement; no full-goal area is complete.

Grid/canvas-first/double-click Image entry/Companion/placements and dirty work preserved. No token gap. Executable desktop/native inputs, dependencies/locks, catalogs and attribution unchanged; no broad build/native/full-suite repetition. The service initializes its own first-version schema; no application migration changes. Changes remain **uncommitted**; no engine forks, commits, pushes, releases, deployment/install/live-profile replacement, external sends or computer-use-denial bypass.

## 2026-10-11 — Codex / XDesign saved shared recovery

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Saved Design documents now carry a bounded, versioned shared checkpoint/document ID through existing project snapshots/saves. Admission pairs candidate artwork and binary state; normal canvas startup restores validated checkpoints with fresh peer IDs and owns recovered replicas. Offline branches/tombstones merge with the original peer. Provisional pages/previews stay outside saved artwork; failed publication restores the prior saved record; failed startup aborts without saving temporary shared metadata. Readiness failure/repeat/late disposal cleanup is guarded, and binary/base64 checkpoint encoding is reused for view snapshots. Malformed/newer/mismatched data is preserved and refused. Local history restarts on reopen.

**163 focused frontend cases / thirteen files (5.25s), final TypeScript, production build (Vite 44.69s), six actual bundled-worker checks and eight Node license tests pass.** Worker bytes remain exact (1,905,078), one production copy with 23 embedded packages/285 main notices. Distribution: 413 notices/eight archives. **4,363 unique frozen inputs / 4,402 input/evidence/document hashes / 4,384 exact preceding hashes** verify; six expected source/test inputs and two index/goal documents changed among preceding hashes. Initial 80/82 fixture failures, 82/82 correction, and two wider 161/162 phases are retained. The latter exposed a real failed-startup cleanup save bug, fixed by aborting and restoring the original record. All gates have explicit terminal/status receipts. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-shared-recovery.md).

**Next:** production room/provider setup, remote identity/authorization and room-scoped protocol, automatic reconnect/resync delivery, presence/follow, team/shared Image/PSD services. Existing Orion auth is local unlock. Native SQLite/portable archive/crash/WebKit/device recovery, aggregate copied checkpoint/base64/JSON/tombstone/history/pending-dependency resources, deeper nested fields/async/native/schema behavior and every other prototype/Image/RAW/filter/PSD/history/memory/legacy/responsive/nested/media/export/original/IME/font/keyboard/accessibility requirement remain open. Project save/load and canvas recovery tests use DB/renderer mocks; no live native/device claim. No full-goal area is complete.

Original grid/canvas-first/double-click Image entry/Companion/placements and dirty work preserved. No token gap. Native sources/registration, dependencies/locks, catalogs and attribution unchanged this increment; no native/bridge/full-suite rerun. Changes remain **uncommitted**; no engine forks, migrations, commits, pushes, releases, bundle/install/live-profile replacement, external sends or computer-use-denial bypass.

## 2026-10-11 — Codex / XDesign shared editor integration

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Added an opt-in shared editor binding and lazy production loader: actual native actions/coalescing/batches/previews, asynchronous clipboard/page work, same-root graph replacement, schema resources, view restoration and queued remote updates use selective local undo. Committed whole-graph callbacks are released so local undo retains peer artwork/replies. Exact provisional rollback and no-op capture preserve metadata/redo; stale-project publication, paired owned busy state, outgoing failure reporting and disconnect history are guarded. Default local sessions keep their existing path. Room transport/authentication/presence/offline storage are still unimplemented; this host API is bundled, not exposed as live sharing.

**84 focused cases / seven files (4.69s), final TypeScript, production build (Vite 46.84s), six actual bundled-worker checks and eight Node license tests pass.** The 33,274-byte shared module is present. The unchanged 1,905,078-byte worker appears once, with all 23 embedded packages in 285 main notices; distribution has 413 native notices/eight archives. **1,007 loader inputs**, **4,360 unique supplemented inputs** and **4,392 unique input/evidence/document hashes** verify, with 1,025 unique preceding hashes exact and five expected source/index changes. Earlier counts include a duplicate entry across hash categories. Initial 37/40, 38/40 and 80/81 phases are retained; 40/40 intermediate passes. Loader session handles were lost at compaction; final terminal 84-pass output is retained and TypeScript repeated once with an explicit exit receipt. Process inventory was denied and not bypassed. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-11-editor-sync.md).

**Next:** real production-compatible room/provider setup, authenticated identity/authorization, offline/reconnect/resync delivery, cursors/follow, team services and shared Image/PSD assets. Broader asynchronous adapter nesting, durable publication failure, existing-history share entry, deeply nested-field merge, whole-graph/tombstone/history/queue aggregate resources and renderer/schema/original/device behavior remain open. Continue every other prototype/Image/RAW/filter/PSD/history/memory/legacy/responsive/nested/media/export/IME/font/keyboard/accessibility/export-reopen requirement; no full-goal area is complete.

Original grid/canvas-first/double-click Image entry/Companion/placements and dirty work preserved. No token gap. No native/bridge/broad-suite rerun: native inputs unchanged. Changes remain **uncommitted**; no dependencies, engine forks, migrations, commits, pushes, releases, bundle/install/live-profile replacement, external sends or computer-use-denial bypass.

# Progress

## 2026-10-11 — Codex / XDesign shared-document foundation

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Added a **staged host API**, using existing installed Yjs, for binary checkpoints/state-vector differences, concurrent node-property/tree/comment merging, public-factory peer IDs and selective local undo. Cyclic moves, deletion/orphan recovery and concurrent last-page deletion/internal changes resolve deterministically. Typed geometry/schema/image bytes, overrides, variables and library references survive. Local/remote admission preflights isolated state and project serialization; rejected edits preserve accepted state/redo. Fractional order code retains upstream MIT attribution. These modules are **not wired to editor history or a live sharing UI/provider**.

**36 focused cases / three files (4.13s), TypeScript, eight Node license tests and 413 notices/eight archives pass.** The actual SDK FIG codec retains a new peer-ID component instance, variable and comment target. **1,004 frozen inputs and 579 exact preceding hashes** verify; only three expected attribution files and two index/goal documents changed among preceding hashes. Failed attempts and preserved pre-existing Markdown hard breaks are recorded in [sync foundation acceptance](docs/architecture/xdesign/acceptance-2026-10-11-sync-foundation.md). No production build repeated: executable entry source is unchanged; prior comments build/worker evidence retains its original scope.

**Next:** editor transaction/preview/graph-replacement and safe history entry/exit binding; real production-compatible rooms, reconnect/offline persistence, authentication/authorization, presence/follow, team libraries and shared Image/PSD assets. Nested property/variable/mode granularity, aggregate cloning/tombstone/history/pending-update resources and native renderer/schema acceptance remain open. Continue every prototype/Image/RAW/filter/PSD/history/memory/legacy/responsive/nested/media/export/original/device/IME/font/accessibility requirement; this substrate closes no full-goal area.

Original grid/canvas-first/double-click Image entry/Companion/placements and dirty work preserved. No design-token gap. Changes remain **uncommitted**; no new dependencies, engine forks, migrations, commits, pushes, releases, bundle/install/live-profile replacement, external sends or computer-use-denial bypass.

## 2026-10-11 — Codex / XDesign project comments

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` stays active. Comments now has canvas/region pins, selection/view-center and C authoring, replies, author edit/delete/move, six reactions, resolve/reopen, page/file/search filters and location navigation. Profile-local identity/name and versioned page metadata persist; isolated metadata undo preserves artwork/other plugins and failed publication preserves redo. Normalized corners follow layer geometry and page moves; unavailable targets retain the authored fallback. Native FIG page repair and canonical nested-instance GUID paths preserve threads alongside prototypes; session opening materializes valid references to local IDs.

**65 focused frontend cases / nine files (4.99s), final TypeScript, production build (Vite 2m 40s) and six actual bundled-worker checks pass.** The verified 1,905,078-byte worker appears once with all 23 embedded packages in 285 main notices. The build also covers final resource WebP/duplicate/empty fixes. Idempotent catalogs and 413 notices/eight archives pass. **552 frozen inputs / 584 source-evidence-document hashes / 579 retained prior hashes** verify; twelve current changed inputs and seven expected prior hash changes recorded. Initial exporter/zoom, nested proxy mapping and diagnostic-helper failures are retained in [comments acceptance](docs/architecture/xdesign/acceptance-2026-10-11-comments.md).

**Next:** real collaboration/presence/follow/shared identity, team libraries/synchronization; richer feedback (mentions/notifications/attachments/full reactions/unread/subscriptions/prototype comments) and broader target behavior; every remaining prototype/Image/RAW/filter/PSD/history/memory/legacy/responsive/nested/media/export/original/device requirement. Existing installed Yjs/protocol packages can be inspected for reuse; upstream Trystero/y-indexeddb are absent and were not added.

**Open gates:** genuine sharing/authentication/authorization, original Figma/cloud-comment interoperability, owned-slot/library/variable-driven targets, aggregate resources/history/serialization/durability, live WebKit/tablet/IME/font/keyboard/accessibility/export-reopen. Local author IDs and generated FIG round trips do not prove these. No new design-token gap. Native sources unchanged; no native/bridge/broad full-suite rerun or installed replacement. Original grid/canvas-first/double-click Image entry/Companion and pre-existing dirty work preserved.

Changes remain **uncommitted**. No dependencies, engine forks, migrations, commits, pushes, releases, Tauri bundle/install/live-profile replacement, external sends or computer-use-denial bypass.

## 2026-10-11 — Codex / XDesign online resources

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Design → Resources now offers editable Iconify icons, Pexels/Unsplash search/insert/fill, existing OS-keychain connections and retained source/author/license links. All four remote-service tools use typed bounded native adapters and source-pinned, one-step graph/page/selection publication. Stock-fill replacement detaches only the replaced PSD-linked placement; original image documents/other placements and undo/redo remain. WebP Image entry, duplicate requests and empty-icon partial success are corrected. React exports retain escaped credit data; live provider/rendered credit acceptance remains open.

**76 frontend tests / seven files (2.90s), eight native service tests and final TypeScript pass.** Catalog audit is idempotent: Pencil 110 routes/14 representative smokes; PhotoCraft 787/657/17/177/144 unchanged. Distribution verifies 413 notices/eight archives. Earlier production builds pass (49.41s and 39.33s Vite); the later build precedes final WebP/duplicate/empty-icon edits in five files. Final production build remains pending; no third broad build was repeated. Evidence verifies **545 frozen inputs / 586 source-evidence-document hashes / 567 retained prior hashes**, with failed phases and twelve expected prior input changes recorded in [resources acceptance](docs/architecture/xdesign/acceptance-2026-10-11-online-assets.md).

**Next:** collaboration/presence/comments/team-library/synchronization work; remaining prototype/Image/RAW/filter/PSD, memory/history/legacy, responsive/nested/media/export implementation and every original/live/device/IME/font/keyboard/accessibility/export-reopen gate. Zero pending tool routes does not establish full replacement parity.

**Open gates:** actual provider/keychain/network/CanvasKit/UI/complex-SVG/export acceptance; final production build; aggregate resources/latency/malicious allocation. Native requests continue within their bounded timeout after frontend abort; remote download counting cannot roll back failed publication. Header checks are separate from full pixel decoding. New native commands require a matching binary/frontend. No new design-token gap identified.

Original grid/canvas-first layout, double-click Image entry, Companion/placements and pre-existing dirty work preserved. Changes remain **uncommitted**. No dependencies, engine forks, migrations, commits, pushes, releases, bundle/install/live-profile replacement, external sends or computer-use-denial bypass.

## 2026-10-10 — Codex / XDesign isolated JavaScript scripting

**Branch:** validation/alpha-2026-09-14

The full six-area `/goal` remains active. Added Design → Scripts with `.js` Open/Save, timeout, Preview/Stop, logs/results/change review and Apply. Actual published OpenPencil `FigmaAPI` and JavaScript run on a copied graph inside a disposable worker launched from an opaque, CSP-pinned frame. The adapted `eval` path uses the same draft pipeline; other privileged tools stay excluded. Source/project/page/selection pinning, schema/hierarchy validation and one graph/page/selection undo transaction cover stale/failed work. Failed layout/publication restores source and redo. Pure graph/slot support is separated from host editor actions; embedded worker dependencies join the production license inventory.

**60 frontend tests / 10 files (4.33s), six actual bundled-worker checks, eight license tests, TypeScript and production build pass.** Vite completes in 54.21s; the exact checked 1,905,078-byte worker appears once in the lazy script chunk, and all 23 embedded packages are in the 285-package main notice inventory. Build retains upstream externalization/mixed-import/large-chunk warnings. Catalogs: Pencil 110/106/10, four remote service tools pending; PhotoCraft 787/657/17/177/144 unchanged. Distribution: 413 native notices/eight archives. Native source unchanged; no native or broad full-suite rerun. Final evidence verifies 537 frozen inputs, 39 evidence files, three acceptance documents and 538 unchanged prior hashes. Frozen phases, failures and limits are in [scripting acceptance](docs/architecture/xdesign/acceptance-2026-10-10-isolated-scripting.md) and its machine-readable record.

**Next:** remaining services/collaboration and all prototype/Image/history/responsive/export implementation; renderer-dependent scripting APIs and script-editor/library polish; genuine browser/WebKit isolation/termination/resource checks and original/font/IME/tablet/keyboard/accessibility/export-reopen acceptance. DOM/Node tests do not close those gates. Code/document/worker bounds are local admission limits, not aggregate-memory or malicious-allocation guarantees. No new design-token gap identified.

Original grid/canvas-first layout, double-click Image entry, Companion/placements and pre-existing dirty work preserved. Changes remain **uncommitted**; no dependencies, engine forks, migrations, commits, pushes, releases, Tauri bundle/install/live-profile replacement, external sends or computer-use-denial bypass. Full replacement acceptance is still pending.

## 2026-10-10 — Codex / XDesign native magnetic lasso

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Magnetic Lasso joins Selection tools: native visible-edge tracing, automatic/manual fastening points, Alt-click/freehand, guarded closing/cancellation/undo, remembered width/contrast/frequency/pressure/edge controls and existing named presets. The image/detail tiles/grid stay mounted. Active shortcuts preserve button activation, text inputs and IME composition.
- Pinned version/view-key snapshots, serial prefix feedback and stale-reply rejection protect drafts. Soft-edge scoring, border sampling, exact manual endpoints, Command-click closure and floating straight-run compaction were refined. Native lasso supplies all four selection modes/edge options as one reversible host edit; native bundle reopen preserves exact original history.
- **115 frontend cases / four files (6.83s)**, final TypeScript; **nine new native workflows + one extended preset workflow**, zero successful native warnings. Failed phases retained. **518 frozen inputs / 549 final source/evidence/doc hashes** and **535 retained prior hashes** verified. Scoped whitespace, idempotent catalog audit and **413 notices/eight archives** pass. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-magnetic-lasso.md).
- New native trace registration and additive capability metadata require a matching binary/frontend. The full six-area goal remains active.

**Next:** Continue remaining selection/retouch depth, curved/unsupported-document perspective crop, RAW/smart-filter/PSD fidelity and resources/history/legacy reliability; preserve all prototype/responsive/nested/media/export/collaboration/service/scripting/original/live acceptance requirements.

**Open questions/gates:** Trace <=8192 guide points / 1048576 graph nodes / 8388608 corridor work / eight heap pushes per node / two trace leases. Close <=8192 outline points / 16777216 document pixels / 67108864 polygon work; larger selections currently need reduction. Native trace/publication synchronous; these are local admission limits, not aggregate RAM/latency/cancellation guarantees. Presented 8-bit edges, actual pressure/Adobe numerical behavior, HDR/CMYK/proof/channel/mask/Quick Mask originals, pan/zoom/devices/accessibility and complete export-reopen fidelity remain open. No broad suite/build/bundle/installed/live-profile replacement or authored/device acceptance. Prior computer-use denial remains. Original grid/layout/tokens/double-click Image entry/Companion/placements and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, pushes, releases, installed replacement or external sends authorized/performed.

## 2026-10-10 — Codex / XDesign perspective crop and exact native curve history

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Perspective Crop joins Image/Crop: four canvas corners, keyboard/coordinates, proposed/explicit size, interpolation, isolated corrected previews and guarded cancellation/Apply. Native sampling moves layers/groups/masks/channels/marks, retains Background identity and nested editable text/shape/fill/filtered sources, and records one original Undo. Additive capability metadata guards older binaries.
- Generated imported PSD checks corrected stale outer type blocks and exact curve-history JSON parsing via the existing `serde_json` float-roundtrip feature. Normal license preparation changes only the Cargo-manifest checksum; versions/notices/archives remain.
- **114 frontend cases / four files (7.11s)**, final TypeScript; **eight crop + 51 history workflows, 58 distinct native cases**, zero successful-run warnings. Analytical HDR/alpha, 12 mode/depth cases, groups/masks/marks, rollback/replay, source/filter order, immutable reopening and original imported-curve Undo pass. Failed phases retained.
- **511 frozen inputs** verified; nine source/test/audit paths, catalog, one Cargo feature and inventory checksum changed. Scoped whitespace/idempotent audit and **413 notices/eight archives** pass. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-perspective-crop.md). Updated binary required; full six-area goal active.

**Next:** Curved outer path/mask projective preservation, artboard/video/comp/data crop, stronger downscale/Smart refresh fidelity, magnetic lasso/extension; RAW/smart filters/PSD/resources/history/legacy and every remaining prototype/responsive/nested/media/export/collaboration/service/scripting/original/device gate.

**Open questions/gates:** Inside-source convex corners; output side <=100000px/existing 256MP ceiling, summed layer/plane work <=67108864 pixels and 512MiB temporary estimate. Horizons/projected coordinates >1M rejected; these are not aggregate RAM/latency/cancellation guarantees. Native solve/publication synchronous; previews keep 16MP source admission. Unsupported curved outer paths/artboards/video/comps/data fail without source mutation; Smart source/exterior-retention/interpolation/HDR and authored parity remain. Exact float parsing needs whole-app performance acceptance. Authored originals unset/not run; no broad build/full suite/bundle/installed/live-profile/device/tablet/pressure/IME/font/keyboard/accessibility/full original/export-reopen gate. Grid/layout/tokens/double-click Image entry/Companion/placements, dirty work and computer-use denial preserved.

**Commit:** None; uncommitted. No dependency versions, engine forks, migrations, commits, pushes, releases, installed replacement or external sends authorized/performed.

## 2026-10-10 — Codex / XDesign local selection-edge brushing

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Select and Mask gains local guided-refine/erase strokes, pointer capture/Alt/Escape/activity guards, draft Undo/Clear and keyboard coordinates. Native preview/Apply share original coverage and all outputs with one-step history; host recipe replay explicitly rejects native-only playback. Additive engine capability metadata prevents older binaries from silently ignoring strokes.
- Remember settings after successful Apply persists validated workflow/view/brush options; samples/strokes remain image-local. Cancel/Reset/native failure preserve preferences; malformed/newer/oversized data blocks writes, denied storage reports actual edit success.
- **41 frontend cases / four files**, final TypeScript and **28 native cases**, zero native warnings. Local coverage/numeric target/8-16-32-bit outputs/erase/decontaminated previews/reopen/rollback/replay plus 24 related regressions pass. Initial 40 frontend/four native passes and two test-narrowing errors retained; final checks cover capability refinement too.
- **508 frozen inputs** and **526 prior retained hashes** verify; ten source/test/audit paths changed/added, catalogs/configuration/attribution unchanged. Scoped whitespace, idempotent audit and **413 notices/eight archives** pass. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-selection-brush.md). Updated binary required; full six-area goal active.

**Next:** Magnetic lasso/perspective crop/extension; authored/local brush pressure/continuous feedback/pan/zoom, resource/cancellation/replay depth; RAW/smart filters/PSD/resources/history/legacy and every remaining prototype/responsive/nested/media/export/collaboration/services/scripting/original/device gate.

**Open questions/gates:** 128 strokes/8192 points; brush size <=5000px/native local radius <=250px, each stroke/halo <=16,777,216 pixels and summed stencil work <=67,108,864 pixels. These are not aggregate RAM/latency/cancellation guarantees. Native solve/publication remains synchronous; live masks update after completed strokes. Preferences are localStorage, not named native presets/cross-device sync. Host-only journal and exact authored soft-edge/CMYK/HDR/decontamination remain open. Authored originals unset/not run; no broad build/full suite/app bundle/installed/live-profile/device/tablet/pressure/IME/fonts/keyboard/accessibility/full original/export-reopen gate. Grid/layout/tokens/double-click Image entry/Companion/placements, dirty work and computer-use denial preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, pushes, releases, installed replacement or external sends authorized/performed.

## 2026-10-10 — Codex / XDesign interactive straightening

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Straighten joins Crop: horizon/vertical reference-line gestures rotate/trim Image or rotate selected layer roots while retaining canvas size, with saved target preferences/presets and guarded cancellation. Isolated native staging preserves coverage/masks/channels, original ruler, one-step Undo/Redo and explicit command replay. Groups transform once; Background follows native conversion. Intermediate histories are discarded.
- **124 frontend cases / five files**, TypeScript and **eleven distinct native cases**, zero successful-run warnings. Native 24-combination mode/depth/scope matrix, multi-layer coverage/group/numeric-target/rollback/replay/native reopen and generated PSD/PSB/PNG checks pass. Selected-layer failure exposed native active-only behavior; implementation extended and attempts retained.
- **505 frozen hashes** and **528 prior retained hashes** verified; eleven source/test/audit paths and Photo catalog changed. Configuration/attribution/IPC signatures unchanged; scoped whitespace, idempotent audit and **413 notices/eight archives** pass. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-straighten.md). Updated binary required; full six-area goal active.

**Next:** Interactive selection-edge brushing/durable dialog options, magnetic lasso/perspective crop/extension; RAW/smart filters/PSD/resources/history/legacy; all remaining prototype/responsive/nested/media/export/collaboration/services/scripting and authored/device gates. Prior ellipse/crop geometry/native edge options/preference restoration already exist; inspect before duplicating.

**Open questions/gates:** Unsavable outside-canvas multi-layer selections are rejected without mutation; one-layer path remains. Exact authored trim/interpolation and native gamma/mixed-view/color fidelity unverified; nondefault text gamma remains rejected because composition uses a process-global setting. Rotated pixel admission/history disposal are not aggregate RAM/latency/cancellation acceptance. Authored originals unset/not run; no broad build/full suite/app bundle/installed/live-profile/device/tablet/pressure/IME/fonts/keyboard/accessibility/full original/export-reopen gate. Grid/layout/tokens/double-click Image entry/Companion/placements, dirty work and computer-use denial preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, pushes, releases, installed replacement or external sends authorized/performed.

## 2026-10-10 — Codex / XDesign conversion dither and destination precision

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Saved/per-operation 8-bit ICC dithering now affects profile/mode/import/paste, with deterministic float conversion before destination quantization, shared preview/Apply choices and unchanged alpha/numeric planes. Higher-depth paste fixes source-depth rounding missed by the prior native oracle. Matching/high-depth profiles omit dither; native Multichannel path and continuous vector colors remain.
- **63 frontend cases / six files**, TypeScript; **39 distinct native cases**, zero successful-run warnings. Precision-discriminating float oracles, dither statistics/defaults/coordinates, nested numeric preservation, one-step undo, preview/rollback/generated exports and prior clipboard/color/profile regressions pass. Initial SDK Clone error and two old-baseline failures corrected/retained.
- **504 frozen hashes** and **535 prior retained hashes** verified; three later test-only changes reproduce preceding whole-file hashes exactly. Twelve scoped source/test/audit paths, idempotent audit and **413 notices/eight archives** pass; catalogs/configuration/attribution and IPC registrations/signatures unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-color-dither.md). Updated binary required; full six-area goal active.

**Next:** Nondefault text blending/mixed-view and exact authored color behavior; interactive selection edges/options/magnetic lasso/perspective crop/straightening/extension, RAW/smart filters/PSD/resources/history/legacy, and all remaining prototype/responsive/nested/media/export/collaboration/services/scripting requirements.

**Open questions/gates:** Host-promoted conversion has a conservative 512MiB temporary estimate, not full physical RAM/latency/cancellation acceptance; native staging/history/cache and direct-edit coalescing/journals/recovery remain. Exact Adobe dither/CMYK/float/gray behavior unverified; uncached vectors stay vectors, Multichannel uses native path. Authored originals unset/not run; no broad build/full suite/app bundle/installed/live-profile/device/tablet/pressure/IME/fonts/keyboard/accessibility/full original/export-reopen gate. Grid/layout/tokens/double-click Image entry/Companion/placements, dirty work and computer-use denial preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, pushes, releases, installed replacement or external sends authorized/performed.

## 2026-10-10 — Codex / XDesign mask and channel clipboard

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Native shared clipboard now edits masks, alpha channels, Quick Mask and single color planes: all copy/paste variants, opaque black/layerless copies, group Copy Merged, bounded numeric/selection/alpha blending and one-step undo while preserving other pixels/metadata. UI shortcuts/menu pass selected/reopened masks; plane copies return to normal images via reviewed ICC conversion.
- **101 frontend checks / three files (6.88s)** plus **ten final runtime checks (2.27s, overlapping)**, final TypeScript; **eleven clipboard native workflows (56.50s) + one final ICC case (1.29s), twelve distinct; sixteen regressions (9.88s), zero warnings**. Generated depth/mode/metadata/undo/retry/reopen matrices pass. Initial parameter/narrowing and grayscale-target fixture errors corrected/retained.
- **503 frozen hashes**, distribution **413 notices/eight archives**, seven-path scoped whitespace and idempotent audit pass. The final test-only addition reconstructs the prior source SHA exactly. Seven source/test/audit paths changed/added; catalogs/configuration/attribution unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-clipboard-planes.md). Updated native binary required; full six-area goal active.

**Next:** OS/floating clipboard and metadata/exact authored semantics; conversion dither/text gamma and mixed-view color fidelity; selection edges/options/magnetic lasso/perspective crop/straightening/extension, RAW/smart-filter/PSD, resources/history/legacy and every remaining prototype/responsive/nested/media/export/collaboration/services/scripting requirement.

**Open questions/gates:** Numeric destinations use native gray pixel math, independent of document ICC; exact authored CMYK/HDR/channel behavior unverified. Direct-plane coalescing/jobs/journal replay and full resource admission remain; bands are not aggregate RAM guarantees, publication cannot be interrupted and partial-file/orphan recovery remains. Authored corpus unset/not run; no broad build/full suite/app bundle/installed/live-profile/device/tablet/pressure/IME/font/keyboard/accessibility/original/export-reopen gate. Computer-use denial, grid/layout/tokens, double-click Image entry, Companion, placements and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, pushes, releases, installed replacement or external sends authorized/performed.

## 2026-10-10 — Codex / XDesign shared image clipboard and paste colors

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Cross-image Copy/Cut/Copy Merged/Paste Special and separate clipboard images retain source native format/selection alpha/ICC/bounds. Edit menu and guarded Photoshop shortcuts; saved paste questions now apply. Reviewed conversion/numbers choices pin pixels/target before publishing versions and linked legacy/Pencil history; destination-depth conversion, retry/cancel/stale guards and acknowledgment receipts preserve actual results.
- **111 frontend checks / five files (7.05s)** plus **nine final runtime checks (2.44s)**, 113 distinct; final TypeScript; **six clipboard native workflows (13.60s) + 41 regressions (14.35s), zero warnings**. Generated mode/depth/alpha/profile/native geometry/mask/undo/retry/PSD/PSB/reopen cases pass. Initial version-path/shortcut/CMS/Arc/channel fixture errors and secondary test-lock failures corrected/retained.
- **502 frozen hashes** verify, distribution **413 notices/eight archives**, fourteen-path scoped whitespace and idempotent audit pass. Thirteen source/test/audit paths, one IPC registration and the Photo catalog changed; matching frontend/binary required. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-clipboard.md). Full six-area goal active.

**Next:** OS/channel/mask clipboard, actual conversion dither/text gamma and mixed-view color fidelity; interactive selection edges/durable options/magnetic lasso/perspective crop/straightening/extension, RAW/smart-filter/PSD, native resources/history/legacy and all remaining prototype/responsive/nested/media/export/collaboration/services/scripting requirements.

**Open questions/gates:** Clipboard is process-local; channels/Quick Mask/visible masks explicitly rejected. One buffer/two decisions/four receipts are entry bounds, not full RAM guarantees; copy admission follows native allocation, sessions may retain their own clipboard. Native publication is not interruptible; partial-file/orphan-version recovery and CMYK approximation remain. Authored corpus unset/not run; no broad build/full suite/app bundle/installed/live-profile/device/tablet/pressure/IME/font/keyboard/accessibility/original/export-reopen gate. Computer-use denial, grid/layout/tokens, double-click Image entry, Companion, placements and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, pushes, releases, installed replacement or external sends authorized/performed.

## 2026-10-10 — Codex / XDesign working spaces and reviewed imports

**Branch:** validation/alpha-2026-09-14

**Changed:**
- File-menu/Image Color Settings: RGB/CMYK/Gray working profiles, preserve/convert/off policies, mismatch/missing questions, intent/BPC, bounded retained custom ICC bytes, optimistic/atomic preferences and draft-only default restoration. Reviewed imports hold raw decoded documents/settings before publishing versions or attaching legacy/Pencil placements; retry/cancel/expiry and small acknowledgment receipts preserve the chosen baseline. Working contexts survive isolated jobs, smart drafts and native reopening; semantic view fingerprints ignore JSON formatting/source names.
- **129 frontend checks / six files (7.12s)** plus **eight final runtime checks (2.41s)**, 130 distinct cases; final TypeScript; **41 native workflows (13.96s), zero warnings**. Profile/policy/alpha/PNG/PSD/PSB ICC/reopen/lifetime/retry/identity cases pass. Initial formatter/mock/type/Arc fixture errors corrected/retained; earlier fourteen-color and twenty-six-regression runs also pass.
- **498 frozen hashes** verified; distribution **413 notices/eight archives**, scoped whitespace across twenty-four source/config paths and idempotent audit pass. Twenty-three source/test/audit paths and the Photo catalog changed/added; two IPC registrations and the native open union require a matching binary/frontend. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-color-settings.md). Full six-area goal active.

**Next:** Actual paste-color policies/dither/text blending, broader/mixed-view color fidelity; interactive selection edges/durable options/magnetic lasso/perspective crop/straightening/extension, RAW/smart-filter/PSD, aggregate native memory/admission/cancellation/legacy and every remaining prototype/responsive/nested/media/export/collaboration/services/scripting requirement.

**Open questions/gates:** Upstream stores paste warnings/dither without applying them; dedicated controls omitted while values persist. Nondefault text gamma/monitor output rejected pending consistent composition/display behavior. ICC <=16MiB, preferences <=32KiB; two pending imports/four receipts/sixty-four live contexts are not aggregate memory guarantees. Native publication is not interrupted by frontend cancellation. Invalid/newer preferences preserved; CMYK approximation/mixed views remain. Original corpus unset/not run; no broad build/full suites/app bundle/installed/live-profile/device/tablet/pressure/IME/font/keyboard/accessibility/original/export-reopen acceptance. Computer-use denial, original grid/layout/tokens, double-click Image entry, Companion, placements and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, pushes, releases, installed replacement or external sends authorized/performed. Retained-hash verification is recorded in the linked acceptance/checks.

## 2026-10-10 — Codex / XDesign saved proof, gamut and HDR views

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Twelve explicit native view routes, Proof Setup/paper/plate/color-blindness/gamut/32-bit workspaces, saved custom ICC/HDR options and guarded canvas toggles/Photoshop shortcuts. Plain color composites use native display LUTs with float HDR exposure before clamping; source alpha/pixels/history, normal saved composites/placements and exports remain unchanged. View/stroke fingerprints normalize native defaults and equivalent channel flags across reopening.
- **105 frontend passes / three files (5.10s)** and TypeScript; **six native workflows (12.79s)** and **22 regressions (11.22s)**, zero final native warnings. Custom proof source deletion/reopen, native LUT pixels, fixed above-white HDR oracle, proof-aware Color Range, adjustment/stroke feedback and identical unproofed PNG/PSD/PSB export bytes pass. Initial Arc coercion/warnings, two identity defects and two test-only tab selectors corrected/retained.
- **491 frozen hashes verified**, distribution **413 notices/eight archives**, scoped whitespace and **521 retained hashes** pass. Seventeen source/test/audit paths and Photo catalog changed/added; optional metadata/saved-view/render paths require an updated binary. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-color-views.md). Full six-area goal active.

**Next:** Working-space policies/mismatch flows and broader/mixed-view color fidelity; interactive selection edges/durable options/magnetic lasso/perspective crop/straightening/extension, RAW/smart-filter/PSD, full native memory/admission/cancellation/legacy and every remaining prototype/responsive/nested/media/export/collaboration/services/scripting requirement.

**Open questions/gates:** Proof presentation applies to plain color composites; isolated/mixed channel/Quick Mask/visible-mask presentations retain existing channel behavior. ICC <=16MiB, saved view <=32MiB, preview <=16,777,216 source pixels/side <=2,048; sixteen-entry caches exclude full RAM guarantees. Native Gamut Warning still scans the full source. Default working settings only; pinned CMYK approximation/HDR highlight 0–1 behavior remain. Original corpus unset/not run; no broad build/full suites/app bundle/installed/live-profile/device/tablet/pressure/IME/font/keyboard/accessibility/original/export-reopen gate. Computer-use denial, original grid/layout/tokens, double-click Image entry, Companion, placements and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, native registration/signature changes, migrations, configuration/attribution changes, commits, pushes, releases, installed replacement or external sends authorized/performed.

## 2026-10-10 — Codex / XDesign document ICC profiles

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Explicit native Assign/Convert/Profile Information routes, compatible/custom ICC destinations, intent/BPC, profile metadata/details and isolated color-managed composite previews. Bounded admitted snapshots retain the chosen custom bytes after source-file replacement/deletion; native history/immutable versions preserve applied profiles. Stale/busy/error/closure guards and unloaded-image admission retain the canvas.
- **115 wider frontend passes / four files (6.32s)** precede the final unloaded-image guard; **93 final dialog/layout passes / two files (6.06s)** and TypeScript pass. **Six native profile workflows (2.64s)** and **13 preview regressions (6.19s)** pass, zero warnings. Assignment/conversion/alpha/previews/undo span 8/16/32-bit; generated 16-bit native reopening/history and PNG/PSD/PSB exports retain exact ICC bytes. Initial tuple typing and incorrect live-built-in-vs-serialized-file oracle are corrected/retained.
- **490 frozen hashes verified**, distribution **413 notices/eight archives**, scoped whitespace and **511 retained hashes** pass. Nine source/test/audit paths and Photo catalog changed/added; three Rust runtime paths add optional profile metadata/data fields and require an updated binary. Narrow wrapper smoke recognition reconciled the audit after checks without changing compiler/native/frontend inputs. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-color-profiles.md). Full six-area goal active.

**Next:** Working-space policies/mismatch flows, actual proof/gamut/HDR presentation/persistence and broader color fidelity; interactive edge brushing/durable selections/magnetic lasso/perspective crop/straightening/extension, RAW/smart-filter/PSD and all remaining native resource/prototype/responsive/nested/media/export/collaboration/services/scripting requirements.

**Open questions/gates:** Custom ICC bytes <=16,777,216; preview source <=16,777,216 pixels/side <=2,048; limits exclude full native/IPC RAM/latency/cancellation. Journals retain source paths; portable replay and session-local dialog settings remain. Pinned custom CMYK compositing is approximate. Original Photoshop corpus unset/not run. No broad build/full suites/live desktop/tablet/pressure/IME/font/keyboard/accessibility/original/export-reopen acceptance. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion, placements and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, native registrations/signatures, migrations, configuration/attribution changes, commits, releases, app bundle, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign native selection workspaces

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Select and Mask, Focus Area and Color Range gain supported native fields, decontaminated outputs, exact foreground/full-resolution samples, tonal/hue/proof/localized choices and six isolated native preview views. Edge coverage and actual result output stay distinct; stale project/document/version/view guards and busy/error/reset/cancel workflows preserve the canvas.
- Precise number entries, version-only dismissal and unfinished sample-coordinate validation are corrected. **149 wider frontend passes / seven files (6.49s)** precede the final draft fix; **21 final workspace/settings passes / two files (2.78s)** and TypeScript pass. **Six native selection workflows (5.98s)** and **ten existing preview regressions (4.78s)** pass, zero warnings. Native preview cases span 8/16/32-bit; actual output/history/reopen fixture uses 16-bit.
- **487 frozen inputs unchanged**, distribution **413 notices/eight archives**, scoped whitespace and **505 retained hashes** pass. Thirteen source/test/audit paths and Photo catalog changed/added; three Rust runtime paths and an optional preview argument require an updated binary. Initial failures/attempts retained. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-selection-workspace.md). Full six-area goal active.

**Next:** Interactive edge brushing, durable selection options, magnetic lasso/perspective crop/straightening/extension and deeper color/background/channel/RAW/smart-filter/PSD; aggregate native memory/admission/cancellation/legacy and every remaining prototype/responsive/nested/media/export/collaboration/services/scripting requirement.

**Open questions/gates:** 16,777,216-source-pixel preview admission; <=2,048 output side; 4,096-float coverage row staging excludes full native/composition RAM and latency. No incremental native canvas mask/Refine Edge brush or durable dialog settings. Original Photoshop corpus unset/not run. No broad build/full suite/live desktop/tablet/pressure/IME/font/keyboard/accessibility/original/export-reopen acceptance. Prior computer-use denial respected; original 40px grid/layout/tokens, double-click Image entry, Companion, placements and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, native registrations, migrations, configuration/attribution changes, commits, releases, app bundle, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign selection and crop workflows

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Ellipse, polygonal lasso and native Quick/Object Selection join the existing compact tool rail. Shared preview/commit geometry supports ratio/size/center and click placement; edge/sampling options, selection modifiers, dedicated Quick size/shortcuts and crop retention/deletion choices send supported native fields.
- Polygon drafts retain an activity lease, support click/Enter/double-click/Finish, vertex removal and Escape/Cancel/cancellation/version/unmount cleanup. Snapped preview endpoints match native points. Alt-click sets sources only for Clone/Healing. Supported preferences and named tool presets survive reopening without retaining transient draft data.
- **107 frontend passes / five files (5.51s)**, TypeScript and **four native workflows (3.91s)**, zero warnings: actual 8/16/32-bit masks/combinations/pixels, crop retention/deletion, undo/redo/reopen and alias/options profile reopen. Initial fixture/type compile errors corrected/retained. **482 frozen inputs unchanged**, distribution **413 notices/eight archives**, scoped whitespace and **504 retained hashes** pass. Ten source/test/audit paths and the Photo catalog changed/added; two Rust paths contain test additions only. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-selection-crop.md). Full six-area goal active.

**Next:** Dedicated Select and Mask/Focus Area/color-range controls; magnetic lasso/perspective crop and remaining crop/color/RAW/smart-filter/PSD work; aggregate native memory/admission/cancellation/legacy and every remaining prototype/responsive/nested/media/export/collaboration/services/scripting requirement.

**Open questions/gates:** Native selection commits on release; host outlines/ink are not incremental native masks. Magnetic lasso/perspective crop are absent from the pinned registry. Generated DOM/native cases do not establish desktop/tablet/pressure/IME/font/keyboard/accessibility/original/export-reopen acceptance. Original Photoshop corpus unset/not run. No broad build/full native/frontend/live gate. Prior computer-use denial respected; original 40px grid/layout/tokens, double-click Image entry, Companion, placements and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, runtime-native registrations, migrations, configuration/attribution changes, commits, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign native Image colors and tool state

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Native foreground/background metadata, controls and guarded X/D swap/default shortcuts synchronize Image tools. Exact RGBA profile records restore across sessions/reopen, preserve unreadable/newer data and retain session values with warnings after write failure. Smudge exposes foreground for Finger Painting.
- Coalesced picker updates hold one guarded busy lease; failure/stale replies and the synchronous release boundary are checked. Strokes, dynamic gradients, shape placement and captured/restored tool presets retain native colors. Background gradients no longer assume white. Other-route brush changes rebase inherited options while explicit preset options survive. Color/preset commands skip unrelated history saves; the unwritable-view boundary preserves successful native metadata, pixels and undo.
- **83 frontend passes**, TypeScript and **nine distinct native passes** (five new color/failure-boundary workflows **0.61s**, four preset regressions **0.62s**), no warnings. Initial prop-type and write-failure fixture errors corrected/retained. **480 final inputs stable after catalog reconciliation**, distribution **413 notices/eight archives**, scoped whitespace and **501 retained hashes** pass. Fifteen source/test/audit paths and the generated command catalog changed/added, including three Rust paths; native registration/config/attribution unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-image-colors.md). Full six-area goal active.

**Next:** Remaining Image option/selection/crop/color-management/RAW/smart-filter/PSD work; aggregate admission/memory/cancellation/legacy conversion and every prototype/responsive/nested/media/export/collaboration/services/scripting requirement.

**Open questions/gates:** Additive native `state.tools` fields/profile colors require an updated binary for full reopen synchronization. No fresh app bundle/installed replacement/full frontend/native/live gate. Swatches remain hex displays and mask/channel choices local; deeper channel-background semantics and durable tool state remain. Mocked UI/native generated fixtures do not establish actual desktop/profile/tablet/pressure/IME/font/keyboard/accessibility/export-reopen acceptance. Original Photoshop corpus unset/not run. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign Image controls and saved preferences

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Brush/Pencil blend/flow/spacing/smoothing, Pencil Auto Erase, retouch flow/spacing/full native clone/heal blends, pattern Bucket fills, Magic Wand layer sampling and classic gradient blend/dither have dedicated controls. Preview/final commands share correct native units. Brush changes rebase inherited fields without clearing unrelated choices; saving a brush preserves choices.
- Bounded versioned per-tool profile preferences restore supported fields. Transient history/source/pattern IDs stay excluded. Hydration writes nothing; malformed/newer/oversized/inaccessible data stays retained, and quota failures show session-only notices.
- **63 frontend passes**, TypeScript, **four native profile/preset passes** (0.48s) and **one prepared Pencil pass** (0.39s), no Rust warnings. Initial wrong native filter matched zero tests; corrected and retained. **476 frozen inputs unchanged**, distribution **413 notices/eight archives**, scoped whitespace and **488 retained hashes** pass. Seven frontend source/test paths changed/added; native/config/attribution unchanged. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-image-options.md). Full six-area goal active.

**Next:** Native foreground/background/tool-state synchronization and remaining Image options/RAW/smart-filter/PSD; aggregate admission/memory/cancellation/legacy work and every prototype/responsive/nested/media/export/collaboration/services/scripting requirement.

**Open questions/gates:** Saved fields are frontend profile preferences, not portable/project/sync metadata. Gradient style/mode/reverse, selection mode, foreground and active tool remain outside this record. Mocked DOM preview/commit and focused native checks do not establish desktop rendering/profile/tablet/pressure/IME/font/keyboard/accessibility/export-reopen acceptance. Original Photoshop corpus unset/not run. No fresh broad build/full native or frontend/live gate. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign saved image storage compaction

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Project history schedules/cancels compaction for the next Orion Terminal launch and shows results/errors. Startup preflight and native ZIP-to-shared-directory conversion preserve raw manifests/blobs/previews and every version/source/view/checkpoint/draft identity. Copied objects share equal payloads.
- Durable original-ZIP intents recover interrupted conversion; a separate orphan-stage check closes the process-death gap before intent publication. Temporary links recover. Make independent now accepts directory bundles and preserves source versions.
- Final **nine native compaction/import passes**, **6.11s**, **5 archive passes**, nine focused native workflows, **five frontend passes** and TypeScript; zero Rust warnings. Initial Debug test compile error corrected; intermediate 170/171-pass gates are historical. **474 frozen inputs unchanged**, distribution **413 notices / eight archives**, scoped whitespace and **495 retained hashes** pass. Nine source paths, native registration and three attribution files changed/added. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-history-compaction.md). Full six-area goal active.

**Next:** Aggregate restore/planning/native memory/admission/cancellation and history/memory compaction, wider legacy formats/large imports; remaining Image options/RAW/smart-filter/PSD and every prototype/responsive/nested/media/export/collaboration/services/scripting requirement.

**Open questions/gates:** Existing bundle/import/scan limits remain. Generated unique file-content counters are not RAM/blocks/latency; real OS crash/power-loss, updated-binary IPC and original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen acceptance remain. Original Photoshop corpus unset/ignored, not passed. New schedule command/storage-report fields require an updated binary; no fresh bundle/live gate. Environment rejected intermediate test-stop attempts; exact live handle completed before edits. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and dirty work preserved.

**Commit:** None; uncommitted. No dependencies, engine forks, migrations, commits, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign saved native image history

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Native past/current/redo labels, layer targets, stable History Brush IDs and limits persist with immutable image versions. Public History reconstruction and equal-tile sharing support reopen/project-version undo/redo. Main Image Undo/Redo uses native history; selected sources persist in project metadata without moving placements.
- Portable files retain direct snapshots and validate history in staging. Cleanup protects saved-root history without recursively retaining trimmed ancestors; missing/corrupt dependencies refuse cleanup. Legacy views open fresh history.
- Six native integration checks pass. Final **163 native Image passes / one authored gate ignored**, **226.69s**, plus **5 native archive passes**, **61 frontend passes** and TypeScript; zero Rust warnings. Initial frontend fixture mismatch corrected. **469 frozen inputs unchanged**, distribution **413 notices / eight archives**, scoped whitespace and **484 retained hashes** pass. Eleven source paths and three attribution files changed/added. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-history-persistence.md). Full six-area goal active.

**Next:** Remaining Image tool options/RAW/smart-filter/PSD, aggregate history restore/native resource admission/cancellation, explicit compaction/legacy conversion, Content Aware initialization and every remaining prototype/responsive/nested/media/export/collaboration/services/scripting requirement.

**Open questions/gates:** 4,096 total history states / 32MB view and existing bundle/portable limits; native tile accounting excludes total RAM/opaque/ICC/metadata, and native decode/allocation/calls remain uninterruptible. Fade/journals/clipboard/all tool state are not durable. Original Photoshop corpus unset/ignored, not passed; original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen gates remain. No fresh broad build/native-bundle/live gate. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and dirty work preserved.

**Commit:** None; uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign prepared Brush, Pencil and Eraser completion

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Eligible Brush/Pencil/Eraser gestures transfer public native LiveStroke pixels through guarded completion, appending only unpreviewed samples. Complete source/tool/target/symmetry guards and native fallback preserve painting, undo/Fade/coalescing/journal/slices/replay and unrelated tool state.
- Corrected implicit mask/alpha/Quick Mask/single-color preview routing. Changed-tile color restoration uses at most 4,096-pixel patches; identity-less PNGs match native dispatch, with the raw-preview mismatch verified.
- Seven new workflow checks cover depth/modes/symmetry/dynamics/blends/targets/locks/Auto Erase/labels/history/fallbacks. Three fully previewed **4,097-sample** transfers append **zero release samples**; diagnostic timings exclude preview/UI/device/large-document latency and total RAM. Native renderer/coverage/symmetry/tail resources and uninterruptible native calls remain.
- Final **157 native Image passes / one authored gate ignored**, **200.77s**, no warnings. Distribution **413 notices / eight archives**, **467 frozen inputs unchanged**, scoped whitespace and **479 retained hashes** pass. Four Rust paths and three attribution files changed/added; frontend/config/API unchanged and wider gates not rerun. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-brush-completion.md). Six-area goal active.

**Next:** Native history-source/project undo/reopen, remaining Image tool options/RAW/smart-filter/PSD, Content Aware initialization/full-native resources and every remaining prototyping/large-project/responsive/export/collaboration/services/scripting requirement.

**Open questions/gates:** Original Photoshop corpus unset/ignored, not passed; original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen acceptance remains. Full native resources/cancellation and device latency remain; no timing/RAM guarantee. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and pre-existing dirty work preserved.

**Commit:** None; uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign bounded healing source staging

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Healing/Spot Healing use bounded native source reads, color encoding and affine destination batches with cancellation. Full native source/composition domains, visibility, interpolation, premultiplied alpha and source documents remain.
- Source fixture **33,204 pixels** observes **4,096 peak read/encode/resample pixels** per batch. Complete inputs/outputs/composition/solver/allocator work remains; counters exclude total RAM, overhead and device/latency guarantees.
- Reproduced and corrected the new adapter's integer-endpoint overflow; four refined source checks pass in **3.00s**. Final **150 native Image passes / one authored gate ignored**, **169.54s**, no warnings. Distribution **413 notices / eight archives**, **465 frozen inputs unchanged**, whitespace and **478 retained hashes** pass. Two Rust paths and three attribution files changed/added; no frontend/config/API or fresh wider gate. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-healing-sources.md). Full six-area goal remains active.

**Next:** Content Aware initialization/pyramid/coarsest cancellation and full-native resources, normal Brush/Pencil/Eraser prepared gesture/symmetry, history-source/project undo/reopen and every remaining six-area requirement.

**Open questions/gates:** Global/native/allocator work and batch overhead/device/peak-memory measurements remain; endpoint test does not establish general native integer-boundary acceptance. Original Photoshop corpus unset/ignored, not passed; original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen gates remain. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and dirty work preserved.

**Commit:** None; uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign strided healing solve and borrowed paint

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Healing/Spot Healing stage native difference/mask data from source strides, removing both cropped float input copies. The original destination is borrowed rather than cloned into full paint; corrected solve pixels overlay it in bounded native publication patches. Bounds/domain/float/clamp/selection/target/atomic publication semantics remain.
- Mask scan, staging, final mix/clamp and overlay rows observe cancellation. Difference/source/mask buffers release before later mixing/publication where applicable. Native fixture avoids **76,800 full-paint / 34,122 cropped-input copy pixels** on the unchanged **17,061-pixel solve**, with **4,096 peak owned-paint/publication pixels**. Counts exclude global/native buffers, total RAM and latency/overhead.
- Final **146 native Image passes / one authored gate ignored**, **166.71s**, no warnings; three solver checks **0.49s** and fourteen workflow checks **20.17s** pass. Distribution **413 notices / eight archives**, **464 frozen inputs unchanged**, whitespace and **476 retained hashes** pass. Three Rust paths and three attribution files changed/added; no frontend/config/API or fresh wider gate. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-healing-solve.md). Full six-area goal remains active.

**Next:** Cancellable source reads/composition encoding/affine sampling, Content Aware initialization, normal Brush/Pencil/Eraser prepared gesture/symmetry, full-native resources, project history/source undo/reopen and every remaining six-area requirement.

**Open questions/gates:** Original/composed sources, dense masks/correction/native workspace and individual native/allocator calls remain; bounded overlay overhead/device/peak-memory measurements open. Original Photoshop corpus unset/ignored, not passed; original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen gates remain. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and dirty work preserved.

**Commit:** None; uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign bounded healing publication and cancellable Spot Healing

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Healing/Spot Healing use unchanged native coverage application in patches capped at **4,096 pixels**, eliminating full damage-coverage/target publication and channel-restoration copies. Atomic document/damage publication and exact native formats/blends/selection/locks remain.
- Create Texture/Proximity Match adapters preserve pinned native RNG/candidate order/scoring/ties/float math and full solve domains while adding construction/search/score/block/row-copy cancellation. Empty-source synthesis uses public interruptible Poisson fill; no engine fork/dependency.
- Actual two-prefix strokes match native pixels/damage/source/history with **22,936 Healing / 21,712 Spot damage pixels**, **4,096 peak publication pixels / 18 cumulative patches**. Counts exclude global source/solver/native tiles, total RAM and latency/overhead.
- Final **143 native Image passes / one authored gate ignored**, **169.94s**, no warnings; **52 focused retouch passes**, **112.32s**, plus direct format/publication checks. Initial compile errors corrected and retained. Distribution **413 notices / eight archives**, **463 frozen inputs unchanged**, whitespace and **476 retained hashes** pass. Three Rust paths and three attribution files changed/added; no frontend/config/API or fresh wider gate. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-healing-publication.md). Full six-area goal remains active.

**Next:** Global healing source/composition/crop/mask/Poisson resources and Content Aware initialization, normal Brush/Pencil/Eraser prepared gesture/symmetry, full-native resources, project history/source undo/reopen and every remaining six-area requirement.

**Open questions/gates:** Global dense buffers and individual native/allocator calls remain; patch overhead/device/peak-memory measurements open. Original Photoshop corpus unset/ignored, not passed; original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen gates remain. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and dirty work preserved.

**Commit:** None; uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign healing coverage staging and final cancellation

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Healing/Spot Healing stage coverage over the unchanged full native solve domain using stable/tail lookup. Whole-renderer clone/finish and duplicate base coverage are removed; native primary/dual/texture/dynamics/tail bits and pixels/damage agree.
- Reproduced and fixed final cancellation publishing new damage with an old document. Both publish together after the final check; original-target channel restoration polls rows. Healing and all three Spot Healing policies pass normal/restricted-channel cancellation checks.
- Third-prefix fixture stages **805 versus 1,394** coverage pixels for Healing and **2,304 versus 2,893** for each Spot policy. Counts exclude final damage coverage, source/solver/renderer buffers, total RAM and latency.
- Final **136 native Image passes / one authored gate ignored**, **172.71s**, no warnings; focused 44 retouch passes, cancellation and allocation checks pass. Distribution **413 notices / eight archives**, **461 frozen inputs unchanged**, whitespace and **475 retained hashes** pass. Two Rust paths and two attribution manifests changed/added; no frontend/config/API or fresh wider gate. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-healing-staging.md). Full six-area goal remains active.

**Next:** Healing source/solver/damage-coverage resources and remaining uninterruptible sections, full-native resource reliability, normal paint prepared gesture/symmetry, history-source/project undo/reopen and every remaining six-area requirement.

**Open questions/gates:** Global solves and individually uninterruptible calls remain; coverage traversal/device/peak-memory measurements remain. Original Photoshop corpus unset/ignored, not passed; original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen gates remain. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and dirty work preserved.

**Commit:** None; uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign indexed Smudge boundary and retention metadata

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Chronological carry-window summaries skip unaffected Smudge history and retain the exact native clipping/earliest-rewind predicate. Append/truncate/replay updates the index; node/record queries observe cancellation.
- Incremental checkpoint/current float pointer references replace whole-map accounting after every dab. Metadata owns no float Arcs; native copy-on-write and sixteen-checkpoint/64 MiB additional-payload/carry policy remain. Full-rescan byte counts and native pixel/target/HDR/tail/eviction/cancellation/prepared results agree.
- Synthetic late-edge query inspects **55 / 16,384 records**, **17 nodes**. A native **930-dab / 48-block** fixture inspects **2,228 local / 358 checkpoint entries**, tracking **2,228,224 extra payload bytes**. Counters exclude full reset/snapshot work, total RAM and latency/device guarantees.
- Final **132 native Image passes / one authored gate ignored**, **171.12s**, no warnings; initial eleven/refined twelve focused passes. Distribution **413 notices / eight archives**, **460 frozen inputs unchanged**, whitespace and **472 retained hashes** pass. Five Rust paths changed/added, two attribution manifests; no frontend/config/API or fresh wider gate. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-indexed-smudge.md). Full six-area goal remains active.

**Next:** Healing/Spot Healing native coverage cloning/dense domain/source/solver cost and final cancellation publication. Inspection found Healing installs its damage before the final check; install document/damage together and test that phase. Continue complete native resource reliability, normal paint prepared gesture/symmetry, history-source/project undo/reopen and all remaining six-area requirements.

**Open questions/gates:** Broad/scattered summaries can visit many candidates; native dependencies still require replay. Snapshot/eviction/reset visits maps; index/reference/current/source/transient memory stays outside extra-checkpoint accounting. Global healing and uninterruptible calls remain. Original Photoshop corpus unset/ignored, not passed; original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen gates remain. Prior computer-use denial respected; grid/layout/tokens, double-click Image entry, Companion and dirty work preserved.

**Commit:** None; uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-10 — Codex / XDesign tiled Smudge and transparent float bounds

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Smudge working/visible pixels and checkpoints share 64-pixel float tiles. Local carry windows retain exact full-prefix edges, native pickup/finger/alpha semantics and checkpoint rewind/eviction. Dense working copies and separate float-surface capture/restore are removed.
- Wide transparency tests found native opacity rounding in untouched pixels between dabs. Smudge and the seven sequential tools now publish added/removed bounds strips alongside dirty dabs/tails. Uncached output reads preserve those pixels without retaining whole-bounds source tiles. Exact native wide/target/HDR/tail/eviction/cancellation and prepared history/Fade/journal checks pass.
- Corrected synthetic short-append work: **18,768 / 727,609 output/bounds pixels for Smudge**, **18,929 / 729,316 for seven sequential tools**; largest output patch **4,096**, stable ROI **169** or **121/361**. Prior 6,561 sequential observation omitted required bounds-strip work and is historical. Counters exclude disposable-tail peak, total RAM and latency/device guarantees.
- Final **129 native Image passes / one authored gate ignored**, **170.68s**, no warnings; **38 focused retouch passes**, **110.97s**. Distribution **413 notices / eight archives**, **458 frozen inputs unchanged**, whitespace and **473 retained hashes** pass. Initial compile/transparent-gap/obsolete-work-bound failures are retained and corrected. Native-only changes; no fresh frontend/typecheck/build/wider gate. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-10-tiled-smudge.md). Full six-area goal remains active.

**Next:** Smudge boundary lookup/checkpoint pruning, global healing/inpaint resources and remaining uninterruptible work; full-native resource reliability, normal paint prepared gesture/symmetry and project history/source undo/reopen. Continue every Image options/RAW/PSD/prototype/media/native-spring/large-project/history/legacy/responsive/nested/export/collaboration/services/scripting/original/live requirement.

**Open questions/gates:** Current float tiles/source buffers/map metadata remain outside additional-checkpoint accounting. First publication visits new bounds; large windows/tails and boundary replay still require work. Original Photoshop corpus unset/ignored, not passed; original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen acceptance remains. Prior computer-use denial respected. Preserve grid/layout/tokens, double-click Image entry, Companion and dirty work.

**Commit:** None; changes remain uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-09 — Codex / XDesign tiled sequential float retouch

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Dodge, Burn, Sponge, Blur, Sharpen, Mixer Brush and Color Replacement now retain 64-pixel copy-on-write float working/visible tiles. Bounds growth is metadata-only; exact native dab/halo effects and cached immutable-source composition replace accumulated dense working copies. Disposable smoothing tails share stable tiles/carry and detach only changed blocks.
- Dirty output patches restore original pixels and apply native opacity/selection/transparency/alpha/channel policy, including contracted old tails. Native full damage, prepared completion, Fade/history/journal/slice behavior remain. Wide per-prefix comparisons, negative/HDR/subnormal float-bit retention, shared-tile isolation and in-work cancellation pass.
- Synthetic 1000-square fixtures for all seven tools observe **6,561 output pixels** per short append against **729,316 accumulated bounds pixels**; largest output patch **4,096**. Stable working ROI peak **121** for five tools or **361** for Blur/Sharpen. Counters exclude disposable-tail peak, composition buffers, total peak RAM and end-to-end latency; no hardware guarantee.
- Final **125 native Image passes / one authored gate ignored** in **157.11s**, zero compiler warnings; **54 frontend passes / three files**; distribution **413 notices / eight archives**. **457 frozen inputs** stayed unchanged; whitespace and **470 retained hashes** pass. Initial eight/refined thirteen sequential checks passed. Catalog remains 161 controls/107 smoke entries. No frontend/config/API signature changes or new TypeScript/build/wider gate. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-tiled-retouch.md). Full six-area goal remains active.

**Next:** Reduce Smudge dense working/visible copying and boundary replay while retaining exact native prefix extent/carry; then global Healing/Spot Healing and remaining uninterruptible phases. Continue full-native resources, normal Brush/Pencil/Eraser prepared gesture/symmetry context, history-source/project undo/reopen and all Image options/RAW/PSD/prototype/media/native-spring/large-project/history/legacy/responsive/nested/export/collaboration/services/scripting/original/live requirements.

**Open questions/gates:** Float tile/sampler metadata grows with stroke; large tips/halos/tails can touch many blocks. Global pruning and full-native fallback resources remain. Composition/effect calls, Create Texture/Proximity Match and coarsest inpaint initialization are uninterruptible within calls. Oracle PhotoCraft, not original Photoshop; 258-file authored corpus unset/ignored, not passed. Prior computer-use denial respected; original/device/tablet/pressure/IME/font/keyboard/accessibility/export-reopen acceptance remains. Preserve original grid/layout/tokens, double-click Image entry, Companion and dirty work.

**Commit:** None; changes remain uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-09 — Codex / XDesign sparse Clone and History Brush coverage

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Clone Stamp/History Brush feedback now uses retained native coverage lookup and sparse tail preview, repainting dirty 64-pixel patches for primary/dual changes and old/replacement smoothing tails. Each patch resets from immutable original pixels; no compounding opacity or stale contracted tail. Full native damage and prepared history/Fade/journal/slice behavior remain.
- Wide per-prefix comparisons pass every depth/color mode with scattering/dual tips/noise/wet edges/textures/selection/blending, masks/alpha/Quick Mask/single color/locks, affine clone sampling and current/below/all-layer sources. Cancellation after local work finishes preserves the previously published document/damage and original source.
- Synthetic 1600-square fixtures observe **1,681 coverage pixels / one patch** per short append without smoothing, or **23,313 / seven patches** with native default 10% smoothing, versus **2,114,116 accumulated bounds pixels**. Maximum dense coverage patch **4,096 pixels**; counters are not peak RAM or latency guarantees. Initial work-limit failure was an incorrect assumption about native lagging tails, corrected with explicit off/default cases.
- Final **120 native Image passes / one authored gate ignored** in **127.15s**, no warnings; **12 frontend passes / two files**; distribution **413 notices / eight archives**; whitespace and **469 retained hashes** pass on **444 frozen source inputs, two catalogs and ten materials**. Catalog remains 161 controls/107 smoke entries. No frontend/config/API signature changes or new TypeScript/build/wider gate. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-sparse-retouch.md). Full six-area goal remains active.

**Next:** Reduce sequential working/visible-region copying and source composition, then Smudge boundary cost and remaining uninterruptible phases without changing native carry/tails. Continue full-native resource reliability, normal Brush/Pencil/Eraser prepared context, history-source/project undo/reopen and all Image options/RAW/PSD/prototype/media/native-spring/large-project/history/legacy/responsive/nested/export/collaboration/services/scripting/original/live requirements.

**Open questions/gates:** Healing/Spot Healing still clone/read accumulated coverage and solve globally; sequential/Smudge working/composition/boundary scans and pruning remain. Transformed source buffers/retained coverage can exceed one patch; full native fallback retains complete replay, broader peak-memory/device acceptance open. Cooperative cancellation limitations remain. Oracle PhotoCraft, not original Photoshop; 258-file authored corpus unconfigured/ignored, not passed; prior computer-use denial respected. Preserve original grid/layout/tokens, double-click Image entry, Companion and dirty work.

**Commit:** None; changes remain uncommitted. No commits, dependencies, engine forks, migrations, releases, installed replacement or live-profile changes authorized/performed.

## 2026-10-09 — Codex / XDesign retouch admission, cancellation and desktop History Brush

**Branch:** validation/alpha-2026-09-14

**Changed:**
- All twelve retouch feedback tools share conservative preallocation dab admission. Coverage tools validate actual primary/dual/provisional-tail geometry before rasterization, plus healing padding/spot context and transformed clone-source bounds before region reads. Final prepared sample deltas pass the same checks; rejected prepared work retains ordinary native fallback without source/history/journal mutation.
- Retained draft cancellation flags signal release, expiry, replacement and eviction, including work outside the cache lock. Public raster Interrupt, PatchMatch and membrane APIs stop cooperative work. The seamless-clone boundary conversion remains bit-exact against the pinned native solver. Per-dab/row checks preserve last published feedback after cancel.
- Fixed an actual desktop History Brush preview gap discovered during bridge inspection: that command cleared history before source lookup. Its shared preview-session helper now retains history for History Brush and releases it for other tools. Native helper/opaque-source/PNG/nonmutation checks pass.
- Final **116 native Image passes / one authored gate ignored** in **106.00s**, zero compiler warnings; **12 frontend passes / two files**; distribution **413 notices / eight archives**; whitespace and **466 retained hashes** pass on **443 frozen source inputs, two catalogs and ten materials**. Static inventory remains 161 dedicated controls/107 smoke entries. Initial focused eleven checks passed with one import warning removed before final checks. TypeScript implementation/config unchanged; prior TypeScript/build/wider evidence historical, no rerun. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-retouch-admission.md). Full six-area goal remains active.

**Next:** Reduce accumulated coverage copying/source reads with native sparse/dirty Clone and History Brush feedback and exact tail replacement; then working-region/composition/boundary scans and uninterruptible sections. Continue normal Brush/Pencil/Eraser prepared completion, native history-source/project undo/reopen, remaining Image options/RAW/smart-filter/PSD and every prototype/media/native-spring/large-project/history/legacy/responsive/nested/export/collaboration/services/scripting/original/device requirement.

**Open questions/gates:** Admission limits feedback footprints/dabs, not measured total peak memory. Full native fallback remains unbounded by these feedback guards. Native composition/coverage application, Create Texture synthesis, Proximity Match search and coarsest membrane initialization inside public complete_with are uninterruptible within calls; no hardware cancellation-latency claim. Desktop helper checks are not live Tauri/device acceptance. Oracle PhotoCraft, not original Photoshop; 258-file authored corpus remains unconfigured/ignored, not passed; prior computer-use denial respected. Preserve grid/layout/tokens, double-click Image entry, Companion and dirty work.

**Commit:** None; changes remain uncommitted. No commits, dependencies, engine forks, migrations, releases, installed application replacement or live-profile changes authorized/performed.

## 2026-10-09 — Codex / XDesign prepared completion for twelve retouch tools

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Clone, Healing, Spot Healing, History Brush, Dodge, Burn, Sponge, Blur, Sharpen, Mixer Brush, Color Replacement and Smudge now transfer eligible finished feedback through the public native job API. Native completion hooks preserve Fade, slices, tool state, canonical results/journal and selection/channel policy. Coalesced gestures retain native undo/redo and history-limit behavior; stale, canceled, expired, rewritten and unavailable feedback falls back to ordinary native dispatch. Completed transfer events are drained.
- Exact native comparisons cover twelve tools across depths/color modes, soft selections, masks/alpha/Quick Mask, clone slots/transforms, History Brush, mixer reservoir/clean policy, explicit other layers, final sample deltas, coalescing/undo/redo, Fade, slices, journal replay and native save-event policy. Synthetic 4,097-sample commit-only observations were **2.337–7.030 ms prepared versus 10.359–431.995 ms full replay**; these exclude feedback, IPC, UI, saving and peak memory.
- Final **109 native Image passes / one authored gate ignored**, **56 frontend passes / four files across two runs**, TypeScript, distribution **413 notices / eight archives**, whitespace and **471 retained hashes** pass. **442 source inputs, two catalogs and ten compiler/attribution materials** stayed frozen during checks. The unmatched fourth filename in the first frontend command was followed by the correct ten-case stroke-preview run. Static inventory records 161 dedicated controls and 107 native smoke entries, without a parity claim. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-prepared-retouch.md). All six goal areas remain active.

**Next:** Bound final-delta allocations and dab/area admission before native preview work; add healing/inpainting interruption, reduce accumulated coverage/working/composition/boundary scans, and review Brush/Pencil/Eraser completion with their native gesture/symmetry context. Continue history-source/project undo/reopen, remaining Image options/RAW/smart-filter/PSD and every prototype/media/native-spring/large-project/history/legacy/responsive/nested/export/collaboration/services/scripting/original/device requirement.

**Open questions/gates:** Eligibility uses existing feedback bounds; full native fallback, final-delta admission, accumulated regions and total peak memory/hardware latency remain open. Native terminal job metadata is retained; own transfer events are drained. Oracle is pinned PhotoCraft, not original Photoshop. The 258-file authored corpus is unconfigured and its ignored check is not a pass. Prior computer-use denial respected; no production build/whole-frontend/bridge/FIG-worker/original/device rerun. Preserve original grid/layout/tokens, double-click Image entry and Companion work.

**Commit:** None; changes remain uncommitted. No commits, dependencies, migrations, releases, installed application replacement or live-profile changes authorized/performed.

## 2026-10-09 — Codex / XDesign History Brush sources and continuous feedback

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Added History Brush to the existing Retouch group, native blend/flow controls and a source selector for retained native past/current snapshots. Opaque weak-registry source IDs survive index shifts and explicitly refuse eviction/reopen/missing/locked targets; IDs stay out of saved presets and native journal parameters.
- History Brush retains native coverage generation across append batches, with disposable finish tails and source-format conversion. All twelve retouch feedback tools stream up to 65,536 accepted samples. Native prefix/depth/color/target/selection/lock/blend/smoothing/conversion/4,097-sample comparisons and normal final undo/Fade/journal pass; actual React editor checks cover source selection, stale refusal, percentage units and one native final gesture.
- Final **101 native Image passes / one authored gate ignored**, **175 frontend Image passes / 21 files**, TypeScript, distribution **413 notices / eight archives**, whitespace and **470 retained hashes** pass on **441 frozen source inputs plus two catalogs**. Static inventory now records 161 dedicated native controls and 104 smoke entries, without a parity-percentage claim. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-history-brush.md). Full six-area goal remains active; no production/native app replacement.

**Next:** Reduce accumulated retouch-region/coverage/boundary-scan/float-patch cost, add healing interruption and a prepared native commit that preserves journal/Fade/undo/tool state. Review public engine transaction/live-stroke APIs before adapting final semantics. Continue native history-source/project undo/reopen integration, remaining Image options/RAW/smart-filter/PSD and every prototype/media/native-spring/large-project/history/legacy/responsive/nested/export/collaboration/services/scripting/original/live requirement.

**Open questions/gates:** Native History Brush sources are session-only and not saved in image bundles. Historically locked pixel sources are refused to match the pinned final engine, pending original Photoshop acceptance. Coverage/source reads/composition still rescan accumulated regions and commit replays the whole stroke. Guards are not measured total peak memory or hardware latency. Oracle is PhotoCraft, not original Photoshop; 258-file corpus remains unconfigured and prior computer-use denial respected. No production build/whole-frontend/bridge/FIG-worker/original/device rerun; prior evidence historical. Preserve Companion entries, existing dirty work, original grid/layout/tokens.

**Commit:** None; no commits, dependencies, migrations, releases, installed application replacement or live-profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Codex / XDesign continuous Smudge and boundary rewind

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Smudge now retains the native dab generator/working/carry state and exact current-prefix extent, with disposable finish tails. It rewinds boundary-dependent earlier dabs from copy-on-write float tile/carry checkpoints; evicted history falls back to retained-dab replay without regenerating old input. All eleven existing retouch feedback tools stream up to 65,536 samples.
- Checkpoints every 64 dabs retain at most sixteen entries and evict after each dab against the 64 MiB additional-checkpoint/current-preview-checkpoint-carry guard. Native per-prefix depth/color/pressure/finger/transparency/targets/all-layer/HDR/dynamics/shrinking-tail/eviction comparisons and 4,097-sample integration pass; actual editor checks cover all eleven streamed tools and one native final commit.
- Final **92 native Image passes / one authored gate ignored**, **170 frontend Image passes / 20 files**, TypeScript, distribution **413 notices / eight archives**, whitespace and **460 retained hashes** pass on **437 frozen source inputs**. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-smudge.md). Full six-area goal remains active; no production/native app replacement.

**Next:** Add History Brush gesture/source controls and feedback: pinned `paint.historyBrush` exists but current toolbar/native preview omit it; select/validate the source history state and preserve target/depth/blend/undo behavior. Continue accumulated-region/boundary-scan/float-patch resources, healing interruption and prepared native commit, remaining Image options/RAW/smart-filter/PSD and every prototype/media/native-spring/large-project/history/legacy/responsive/nested/export/collaboration/services/scripting/original/live requirement.

**Open questions/gates:** Boundary-sensitive Smudge replay is required by the pinned algorithm. Checkpoint bytes exclude original/current patch surfaces and dense working/composition regions; resource guards are not measured total peak memory or hardware latency. Final native dispatch still replays the full stroke. Oracle is PhotoCraft, not original Photoshop; 258-file corpus unconfigured and prior computer-use denial respected. No production build/whole-frontend/bridge/FIG-worker/original/device rerun; previous evidence historical. Preserve Companion entries, all dirty work and original grid/layout/tokens.

**Commit:** None; no commits, dependencies, migrations, releases, installed application replacement or live-profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Codex / XDesign continuous sequential retouch

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Dodge, Burn, Sponge, Blur, Sharpen, Mixer Brush and Color Replacement now retain native dab generators, float working pixels and mixer carry between append batches. Stable dabs apply once; disposable finish tails and stroke opacity/selection stay outside retained paint. Ten retouch tools now stream up to 65,536 accepted samples; Smudge still replays bounded prefixes.
- Preserved native target/sampling/replacement/carry semantics and existing cancellation leases. Added conservative pre-allocation spatial/timed/primary/dual dab budgeting. All seven tools pass per-prefix depth/color/target/transparent/dynamics/options comparisons and 4,097-sample streams; actual editor tests cover all ten streamed tools and one native final gesture commit. Expanded upstream formula attribution with existing full grants.
- Final **86 native Image passes / one authored gate ignored**, **169 frontend Image passes / 20 files**, TypeScript, distribution **413 notices / eight archives**, whitespace and **460 retained hashes** pass on **436 frozen source inputs**. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-retouch-dabs.md). Full six-area goal remains active; no production/native app replacement.

**Next:** Implement Smudge's persistent generator/carried paint with exact rollback of boundary-dependent dabs when stroke bounds grow; verify expanding pressure/radius, reversal, sample-all/locks, provisional tails and long streams against the pinned command before enabling append feedback. Then accumulated-region retouch/healing resource cost, solver interruption and prepared native commit; remaining Image options/RAW/smart-filter/PSD and every prototype/media/native-spring/large-project/history/legacy/responsive/nested/export/collaboration/services/scripting/original/live requirement remain active.

**Open questions/gates:** Working-region growth/cloning/composition and native final dispatch still scan accumulated regions. Area/sample/tile/context/estimated-dab bounds are guards, not measured peak memory or hardware latency. Oracle is pinned PhotoCraft, not original Photoshop. The 258-file corpus remains unconfigured; prior computer-use denial respected. No production build/whole-frontend/bridge/FIG-worker/original/device rerun; previous evidence historical. Preserve Companion entries, all dirty work and original grid/layout/tokens.

**Commit:** None; no commits, dependencies, migrations, releases, installed application replacement or live-profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Codex / XDesign continuous clone and healing coverage

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Clone Stamp, Healing Brush and Spot Healing now retain PhotoCraft's native coverage generator, consume only new samples and keep provisional finish tails out of retained state. Streamed batches/overlap/viewport refresh support up to 65,536 retained samples. Healing/inpainting still solve the accumulated region; final native dispatch preserves undo/Fade/journal/scripts.
- Added source/tool/layer/channel context validation, canceled-work leases outside the shared solve lock and offscreen feedback guards. Native prefix/depth/color/target/sampling/solver/dynamics comparisons and all-three-tool 4,097-sample streams pass; actual editor tests verify batch offsets and one complete-gesture commit. Added upstream formula attribution with existing full grants.
- Final **77 native Image passes / one authored gate ignored**, **162 frontend Image passes / 20 files**, TypeScript, distribution **413 notices / eight archives**, whitespace and **459 retained hashes** pass on **435 frozen source inputs**. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-retouch-coverage.md). Full six-area goal remains active; no production/native app replacement.

**Next:** Implement persistent sequential dab generators/working pixels/carried paint for Mixer Brush, Color Replacement, Dodge, Burn, Sponge, Blur, Sharpen and Smudge; these eight still replay changed prefixes with a 2,048-sample cap. Preserve per-prefix native equivalence, provisional tails, opacity/selection/blending, sample-all-layer boundaries and cancellation. Then address whole-region healing resource/solver cancellation and prepared commit, remaining Image options/RAW/smart-filter/PSD, and all prototype/media/native-spring/large-project/history/legacy/responsive/nested/export/collaboration/services/scripting/original/live requirements.

**Open questions/gates:** Coverage is incremental, but healing solves/composition still rescan accumulated regions and commit runs the whole native command. Existing area/sample/tile/context bounds are not measured peak memory or hardware latency. Pixel oracle is pinned PhotoCraft, not authored Photoshop. The 258-file corpus remains unconfigured; prior computer-use denial respected. No production build/whole-frontend/bridge/FIG-worker/original/device rerun; previous evidence historical. Preserve Companion entries, all dirty work and grid/layout/tokens.

**Commit:** None; no commits, dependencies, migrations, releases, installed application replacement or live-profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Codex / XDesign continuous prototype Drag

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Connected On drag inspector/native FIG/portable/undo/clipboard contracts, primary mouse/touch/pen pointer leases and linear Smart/directional scrubbing. Present checkpoints route/history/overlays/models/variables/scroll/focus, queues release during preparation, and commits or restores the checkpoint across ordered actions and cancellation.
- Added nested interactive Scroll To, current-paint release continuity and authored physical-spring pointer-velocity handoff. Source-view replacement, generated clicks, reduced motion, failure reasons and temporarily inert host scrolling are covered. Standalone React exposes the host contract; whole-page routing remains open.
- Final **572 focused checks / 61 files**, standalone TypeScript and production build (**53.70s**) passed on **434 frozen inputs**. Production-worker regression **55 checks / 53 synthetic nodes**, distribution **413 notices / eight archives**, whitespace and **452 retained hashes** pass. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-drag.md). Full six-area goal remains active.

**Next:** Work on true continuous native Image retouch: changed clone/heal/retouch prefixes currently replay the entire stroke. Inspect pinned upstream algorithms and implement incremental accumulation with meaningful native equivalence/cancellation tests rather than treating identical-prefix reuse as continuity. Keep prototype media/actions/playheads, native spring/presets, original paint/layout/device and cross-animation velocity/rollback fidelity, large-project/history/legacy, responsive/nested export, collaboration/services/scripting and authored/live acceptance active.

**Open questions/gates:** Gesture start/velocity/prediction/commit thresholds and matched/fallback vectors are explicit XDesign policies pending original comparison. Local spring release carries drag velocity, but unrelated prior-animation trajectory/velocity and its rollback are not retained. Original pixels/browser/tablet/pressure/IME/fonts/keyboard/accessibility remain unverified; Photoshop corpus unconfigured and prior computer-use denial respected. No wider whole-frontend/native/bridge/original/live suite rerun. Preserve Companion progress, all dirty work and original grid/layout/tokens.

**Commit:** None; no commits, dependencies, migrations, releases, installed application replacement or live-profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Codex / XDesign interrupted visuals and seekable motion

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Present captures supported current visuals before canceling old motion and retains an inert visible cover during asynchronous preparation. Failure/Restart/disposal restore visibility; capturing the old motion no longer invalidates a new action sequence. Pointer/touch/key release resumes a paused visual while canceled future actions stay canceled.
- Added all-track pause/seek/resume, fresh completion-promise observation, endpoint completion without replay and cleanup on browser control failures. Composite snapshots retain background/foreground fragments, nested wrapper transforms/alpha/clips/scroll and inert media posters. Smart retargeting reads current wrapper alpha/circular radii and compatible flat/SVG paint; independent border colors restore correctly.
- Final **540 focused checks / 58 files**, source/test TypeScript and production build (**33.63s**) passed on **431 frozen inputs**. Production-worker regression **54 checks / 52 synthetic nodes**, distribution **413 notices / eight archives**, whitespace and **448 retained hashes** pass. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-interruption.md). Corrected README's stale claim that Smart playback was unconnected. Full six-area goal remains active.

**Next:** Connect continuous Drag authoring/native/portable transport and pointer observation to seekable motion, with progress/release/cancellation/commit/rollback. Current seek operates on authored timeline time; linear gesture scrubbing and trajectory/spring velocity handoff remain unfinished. Continue gradients/rich text/elliptical radii/strokes/complex paint, live media/playheads, native spring protocol/presets, exact layout/scroll/fixed/overlay/export fidelity and the other five areas: Image options/true continuous retouch/RAW/smart-filter/PSD, large imports/history/legacy conversion, responsive/nested/media export, collaboration/services/scripting and original/live acceptance.

**Open questions/gates:** Original browser/device composite, paint/layer-order/clip/easing fidelity remains unverified. Snapshot element/depth/text limits are guards, not measured memory/hardware acceptance. Standalone React still needs its navigation host. Photoshop corpus remains unconfigured; prior computer-use denial respected. No wider whole-frontend/native/bridge/original/live suite rerun. Preserve Companion progress and pre-existing dirty work; grid/layout/tokens unchanged.

**Commit:** None; no commits, dependencies, migrations, releases, installed app replacement or live profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Codex / XDesign Smart Animate playback and native transport

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Connected Present's matched-layer compositor: affine geometry/parent compensation, compatible solid/SVG/text colors, complex own-paint crossfades, detached branch paint order, fixed/directional matching, reduced motion and source isolation. Normalized host 2D transforms, kept moved clones inert, used posters for temporary videos and guarded aggregate keyframe allocation.
- Added Smart animate and directional matching authoring, supported Navigate/Back/Swap with guarded Open/Close combinations, native FIG `SMART_ANIMATE` and matching flags on all twenty directional families. Native undo/save/reopen/duplicate/snapshot/HTML clipboard and exact exported React retain action/geometry data. Present reports setup failures; cleanup preserves newer control/layout style updates.
- Final **522 focused checks / 57 files**, source/test TypeScript + production build (**1m48s**) passed on **429 frozen inputs**. Production importer worker **54 checks / 52 synthetic nodes**, distribution **413 notices / eight archives**, whitespace and **448 retained hashes** pass. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-smart-motion.md). The full six-area goal remains active; no replacement-completion claim.

**Next:** Preserve current composite/paint/geometry/velocity before controller cancellation and implement seekable continuous Drag with release/rollback. Numerical gradients, rich text/radii/strokes/complex paints, live video playheads, exact hierarchy/clip/scroll/fixed/overlay/easing and original visual comparisons remain open. Portable React retains payloads but still depends on its navigation host; whole-page router/compositor remains. Continue Image options/true continuous retouch/RAW/smart-filter/PSD, large imports/history/legacy conversion, responsive/nested/media export, collaboration/services/scripting and original/live acceptance. Review independent CSS border shorthand restoration before broadening motion styling.

**Open questions/gates:** Duplicate order/normalization/short rotations/clamps, Slide ratios, native spring protocol/presets and paint-mixing policies need originals. Layer/keyframe limits are guards, not measured hardware/memory acceptance. Controller still cancels to destination before the next snapshot; stored visual descriptors do not establish interruption continuity. Photoshop corpus remains unconfigured and prior computer-use denial remains respected. No whole-frontend/native/bridge/original/live suite rerun; prior results historical. Preserve Companion progress and existing dirty work; grid/layout/tokens unchanged.

**Commit:** None; no commits, dependencies, migrations, releases, installed app replacement or live profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Codex / XDesign Smart Animate geometry foundation

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Added typed native/portable motion descriptors for normalized vector/path shape, visible paints/stops/transforms/resources, local matrices, dimensions/radii and shadow fallback. Fixed root metadata rebasing to actual exported selection coordinates; exact generated React attaches cached semantic descriptors without source mutation.
- Implemented name/parent-hierarchy/duplicate-order matching and affine world interpolation with exact endpoints, short rotations and nested parent compensation. Snapshot integration captures current computed transforms/opacity and detached measured/native-fallback poses, preserves fractional/zero dimensions and excludes earlier outgoing snapshots while retaining current overlays.
- Final **492 focused checks / 54 files** and final source/test TypeScript + production build (**1m45s**) passed on **424 frozen inputs**. Production-worker regression **52 checks / 50 nodes**, distribution **413 notices / eight archives**, whitespace/evidence pass. [Acceptance](docs/architecture/xdesign/acceptance-2026-10-09-smart-geometry.md). **Smart Animate authoring/playback/native transport remains unconnected; no completion claim.**

**Next:** Connect the actual Smart Animate compositor immediately: paint/text/gradient interpolation, clipping/scroll/stacking, directional matched/fixed layers, supported overlay swaps, native FIG/clipboard/portable contracts. Normalize external surface transforms, capture computed variable-driven paints and preserve in-flight visual/velocity state before cancellation. Then continuous Drag scrubbing. All other prototype/native spring/media/dynamic-scroll/variable/export gaps and Image options/continuous retouch/RAW/smart-filter/PSD, large imports/history/legacy conversion, responsive/nested export, collaboration/services/scripting and original/live acceptance remain active.

**Open questions/gates:** Matching duplicate order, six-decimal structure quantization, short rotations and overshoot clamps need original Figma comparison. Snapshot bounds are guards, not measured memory/hardware acceptance. Native fallback and DOM fixtures do not establish live geometry fidelity. Photoshop corpus remains unconfigured and prior computer-use rejection remains respected. No native/bridge/whole-frontend/original harness rerun; previous results historical. Preserve concurrent Companion progress and all dirty work; no chrome/layout/token changes.

**Commit:** None; no commits, dependencies, migrations, releases, installed app replacement or live profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Codex / XDesign directional motion and physical springs

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Added distinct Push, Move in/out and Slide in/out in all four directions, corrected Dissolve-over-source behavior and explicit exit snapshot stacking, preserved stage/presentation geometry and alpha, and extended durations to ten seconds. Held route restoration now uses inverse transitions, including reversing default Push direction.
- Added bounded analytical physical spring authoring (mass/stiffness/damping/initial velocity), duration-from-settling, sampled WAAPI and elapsed-time portable Scroll To. Portable save/undo/reopen/duplicate/snapshot/HTML clipboard retain springs; exact emitted React and strict generated TSX are verified. Native FIG writes/reopens all twenty directional families/edges without plugin fallback. Native spring/preset fields remain preserved/refused; authored portable springs explicitly refuse FIG export until an original-file comparison establishes their parameter mapping.
- Final **469 focused checks / 50 files** (466 Pencil + three shared-dialog), standalone typecheck and production build (**50.52s**) passed on **416 frozen inputs**. Production worker **52 checks / 50 nodes**, distribution **413 notices / eight archives**, whitespace and retained hashes pass. [Acceptance and frozen evidence](docs/architecture/xdesign/acceptance-2026-10-09-motion.md).

**Next:** Continue the unchanged active six-area goal. Smart Animate name/hierarchy/geometry matching, matched/fixed directional layers and continuous Drag scrubbing are the next prototype work. Native spring transport/presets, exact Slide ratio and interrupted trajectory/velocity continuity still need implementation/original acceptance. Retain media actions/playhead/compositor, device/dynamic scrolling, portable page routing, native variable semantics and complex bindings. Image options/continuous retouch/RAW/smart-filter/PSD, large imports/history/legacy conversion, responsive/nested export, collaboration/services/scripting and original/live acceptance remain unfinished; native changed retouch prefixes still replay.

**Open questions/gates:** One-quarter Slide background travel and normalized spring settling thresholds are explicit XDesign assumptions, not Figma measurements. Original authored easing/geometry/variable/media and hardware pressure/IME/fonts/accessibility remain unverified. Photoshop corpus remains unconfigured; prior computer-use rejection remains in force with no alternate UI route. No broader frontend/native/bridge/original suite rerun for this scoped frontend change; previous results remain historical. No chrome tokens/layout changes. Preserve the concurrent Companion entry and existing dirty work.

**Commit:** None; no commits, dependencies, migrations, releases, installed application replacement or live profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Codex / XDesign reversible and video triggers

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Added While hovering/pressing with temporary route/history/overlay/scroll/focus checkpoints surviving replaced views, primary mouse/touch release and delay cancellation. Explicit later navigation, Restart, source/disposal and local manual scrolling discard stale checkpoints; control/session-variable state remains isolated and retained.
- Added one-way Mouse/touch down/up and actual video-clock hit/end triggers with ordered asynchronous queues, beyond-duration/end ordering, rewind and automatic suspension. Inspector/video guards, conflict validation, native undo/reopen, clipboard destination/resource transport, schema-native FIG fields and portable reversible-host jobs are implemented. Legacy repeated MOUSE_IN/MOUSE_OUT and continuous DRAG remain preserved/refused.
- Fixed remounted non-click focus restoration, synchronous host replacement, rejected completion cleanup, scroll callback compatibility, pending pointer blur/resize cancellation and aggregate active/preparing/checkpoint model accounting. Final focused **407 passed / 47 files**, final TypeScript/production build, production-worker **26 checks / 24 nodes**, distribution/whitespace pass. [Acceptance and frozen evidence](docs/architecture/xdesign/acceptance-2026-10-09-triggers.md).

**Next:** Continue the unchanged active six-area goal. Continuous drag transition scrubbing, Smart Animate/springs/push/move/slide-out, media actions/playhead/compositor, device/dynamic scrolling and portable page routing remain next prototype work. Advanced/native variable semantics and complex portable bindings still need implementation/acceptance. Image options/continuous retouch/RAW/smart-filter/PSD, large imports/history/legacy conversion, responsive/nested export, collaboration/services/scripting and original/live acceptance all remain unfinished. Inspect native LiveStroke/retouch integration when moving to sustained image feedback; changed retouch prefixes still replay.

**Open questions/gates:** Original authored timing/easing/coercion/layout/media comparisons and hardware pressure/IME/fonts/accessibility remain unverified. Photoshop corpus configuration is still absent. Prior computer-use rejection remains in force; no alternate UI route. No Rust/native/whole-frontend suite rerun for this scoped frontend increment; earlier results remain historical. No design tokens/layout changes. Preserve the concurrent Companion progress and all dirty work.

**Commit:** None; no commits, dependencies, release, installed application replacement or live profile changes authorized/performed. Changes remain uncommitted.

## 2026-10-09 — Claude / Companion 3D polish (in progress, nothing shipped)

**Branch:** validation/alpha-2026-09-14

**Changed:** No project files changed. `public/companion/companion.glb` is untouched. A scratch pipeline (session scratchpad, temporary) does per-texel zone classification (skin/hair/cloth/fur/ribbon/strap), Cycles AO bakes, procedural 3D-space PBR authoring (albedo/normal/ORM/hair-anisotropy at 4096→2048), MikkTSpace tangents and a gltf-transform graft into six MeshPhysical materials (sheen/clearcoat/anisotropy). The rig and all 19 clips stay intact. v3 preview renders well for skin, fur, straps and cloth ribs.

**Next:** (1) Finish the UV-overlap repack: 318 faces still overlap, probably within clusters, so split those clusters. Then re-bake AO in the new layout and duplicate the moved faces' vertices in the GLB. (2) Replace the hair/fur strand field with source-radial angular coordinates; the current frame-dot-position coordinates decorrelate and cause anisotropy patches and grain. (3) Material scope: once the asset drops emissive it needs env lighting. Add a scoped RoomEnvironment envMap on her materials in `CompanionScene.tsx` and `CharacterModel.tsx` only (other Meshy characters stay self-lit). (4) JPEG albedo/ORM to cut the ~25 MB size, then verify in the app.

**Open questions:** Is a GLB of about 20 MB acceptable for the companion?

**Commit:** None.

## 2026-10-09 — Codex / XDesign prototype variables and conditions

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Added Set variable, Set variable mode and ordered/nested Conditional actions with structured literal/variable/expression inspector controls, fourteen operators, bounded typed evaluation, lazy booleans, first-matching branches and branch/outer cancellation.
- Present materializes native scalar/color/visibility/font bindings on isolated model graphs, waits for DOM preparation, preserves explicit modes and session values across navigation, retains focus/controls/scroll/spent timers, recovers invalid binding failures and clears session state on Restart. Saved graphs remain unchanged.
- Protected recursive FIG GUID/action/expression/mode transport, action-only clipboard/alias dependencies, fresh cross-project variable/collection/mode references and atomic undo/redo. Portable React embeds the evaluator, updates supported CSS/simple-paint bindings before host actions, resizes bound root frames and refuses unsupported changing artwork/layout.
- Final wider frontend **2,327 passed / three skipped**, across 333 passing/three skipped files; final TypeScript/production build, production-worker **twenty checks / eighteen nodes**, license-material and whitespace checks pass. The earlier scoped **368/45** precedes final strict fixture/payload narrowing; final wider checks cover all 411 frozen source/test/config inputs. [Acceptance and evidence](docs/architecture/xdesign/acceptance-2026-10-09-variables.md).

**Next:** Continue the unchanged active six-area goal. Reversible hover/press, drag/media triggers, Smart Animate/springs/other transitions, device/dynamic scrolling and portable whole-page playback remain next prototype work. Advanced/native variable semantics and complex portable bindings still need work/acceptance. Image options/continuous retouch/RAW/smart-filter/PSD, larger imports/history/legacy conversion, responsive/media/nested export, collaboration/services/scripting and original/live acceptance all remain unfinished.

**Open questions:** Original Figma variable/condition coercion, assignment retention, modes/defaults/aliases, layout/timing/interruption; VAR_MODE_LOOKUP, native extra types/operators/external/node-field references; richer authoring-time type feedback and semantic validation; large target-list/variable/model-rebuild performance. Bounds and portable/HTML limits are explicit in acceptance. Photoshop corpus remains unconfigured, fonts/oracles/device acceptance remain unavailable/unverified, prior computer-use denial stays respected, and motion-token gap stays with Hermes.

**Commit:** None. Goal active, not complete/paused/blocked. Preserve all pre-existing dirty work. No dependencies, Rust/native bridge changes, native/authored harness reruns, releases, installed app replacement or live profile writes. No compiler/test inputs changed after the final freeze. First full frontend exposed excess editor-only portable definition fields; narrowed them and reran the final full frontend/build. Initial focus regression and fixture/API/typecheck issues are documented separately from final passing checks.


## 2026-10-09 — Codex / XDesign ordered action sequences

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Added inspector action ordering/removal and sequential Navigate/Back/Open/Close/Swap/Scroll To execution across screen lifetimes, with preparation and paired-animation waits, timer suspension, Stop actions, input/visibility/restart/source/unmount cancellation and failure recovery.
- Protected native undo/reopen, every-step duplicate/snapshot/HTML/FIG destination mapping, partial unresolved repair and native action arrays; portable local scroll sequences and asynchronous/whole-page host callbacks. Temporary source markers stay presentation-only, preserving stable component exports. Delayed sequences count trigger activations for loop protection, keep completed reactions spent across suspension, and allow manual retry after a declined activation.
- Final wider frontend: **2,295 passed / three skipped**, across 331 passing/three skipped files. The earlier **334/43** scoped and **90/4** timer/portable runs cover the final-review loop/spent-delay fixes; final frontend/build cover every final input. Production TypeScript/build, bundled-worker sixteen checks, distribution and whitespace pass. [Acceptance and 405 frozen source hashes](docs/architecture/xdesign/acceptance-2026-10-09-sequences.md).

**Next:** Continue the unchanged active six-area goal. Variable assignments/modes/expressions/conditions are next in prototype execution, alongside remaining reversible/deeper triggers/transitions/device and portable whole-page work. Image options/continuous retouch/RAW/smart-filter/PSD, large-file/history/conversion, responsive/media/nested export, collaboration/services/scripting and original/live acceptance remain unfinished.

**Open questions:** Native authored sequence timing/defaults/origins/interruption and larger action/interaction limits; device/dynamic scrolling and large inspector target-list performance. Sixty-four flat actions, sixteen interactions and 32 KiB metadata are explicit bounds. Original Photoshop corpus remains unconfigured, and fonts/playback oracles/device acceptance remain unverified. Prior UI denial remains respected without an alternate route. Motion-token gap remains with Hermes.

**Commit:** None. Goal active, not complete/paused/blocked; concrete progress and final checks, with all six areas still open. No dependencies, Rust/native bridge changes, native/authored-harness reruns, release, installed app replacement or live profile changes. Preserve all pre-existing dirty work. No compiler/test source changed after the final frontend/build input freeze.


## 2026-10-09 — Codex / XDesign scrolling and Scroll To

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Configured horizontal/vertical/both scrolling, starting offsets, fixed/sticky layers and local Scroll To with offsets/easing; remembered positions across screens/Back/overlays, reset/layout-matched preservation and Restart.
- Managed tabs/panels/groups retain controls inside scrollers; nested fixed frames scroll independently, fixed controls retain pointer/wheel access, animation cancellation and outgoing snapshots preserve scrolling. Browser alignment restores host ancestors with explicit instant writes.
- Protected native undo/project reopen, copied descendant targets and legacy fixed sections, fixed-only HTML clipboard enrichment, native FIG direction/offset/behavior/divider/action/arrival fields and portable React local playback.
- Final Pencil/shared-dialog: **289 passed / 41 files**; final wider frontend: **2,248 passed / three skipped**, across 329 passing/three skipped files. TypeScript/build, bundled-worker fifteen checks, distribution and whitespace pass. [Acceptance and 402 source hashes](docs/architecture/xdesign/acceptance-2026-10-09-scrolling.md).

**Next:** Continue the active six-area goal: action sequences/variables/conditions, reversible/deeper triggers/transitions and portable whole-page playback; remaining image/tool/RAW/PSD, large-file/history/conversion, responsive/media/nested-export, collaboration/services/scripting and authored/live acceptance. No area or full replacement is marked complete.

**Open questions:** Device viewport/automatic screen overflow, exact sticky/offset/retention/default/controlled-layout behavior and WebKit alignment/interruption need authored/device evidence. Scaled geometry fallback remains unverified for exact transformed/nested layouts. Original Photoshop corpus/fonts/playback oracles remain unavailable/unverified. Prior UI denial and dependency/release restrictions remain; no alternate route. Motion-token gap remains with Hermes.

**Commit:** None. Goal active, not complete/paused/blocked; pre-existing dirty work and installed application/profile preserved. No Rust/native bridge changes or native/authored-harness reruns; prior results remain historical. Only a worker verification float32 assertion changed after the passing frontend/build; final worker proof covers it.

## 2026-10-09 — Codex / XDesign stacked overlay workflows

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Open/Close/Swap actions, eight-deep overlay presentation, frame positioning/background/outside-click controls and trigger-relative offsets; underlay control/timer suspension, focus trapping/return, Restart and atomic preparation recovery.
- Project/undo, duplicate/snapshot/HTML clipboard and native FIG settings/action transport; portable React settings/origin callbacks. Cancellable overlay entrances/exits and snapshots preserve dimmed underlays. Unsupported scroll-reset semantics are explicitly preserved/refused.
- Final Pencil/shared-dialog: **261 passed / 39 files**. Wider frontend: **2,220 passed, three skipped**, before the final test mock annotation and imported scroll-reset rejection; final scoped checks/build cover both. TypeScript/production build, bundled worker and distribution checks pass. [Acceptance and 398 source hashes](docs/architecture/xdesign/acceptance-2026-10-09-overlays.md).

**Next:** Continue the active six-area completion goal: scroll/action sequences/variables, reversible/deeper triggers and transitions/portable playback, then remaining image/performance/export/services work and authored/live acceptance. No area or full replacement is marked complete.

**Open questions:** Original Figma overlay/timing/visual and Photoshop corpus/device acceptance remain gates. Manual Swap offset fidelity and exact dimming/interruption need authored comparisons; standalone export hosts still own routing. Payload/stack bounds are explicit, not large-project process-memory acceptance. Prior computer-use denial and dependency/release restrictions remain; no alternate UI route.

**Commit:** None. Goal active, not complete/paused/blocked. No Rust/native bridge changes or native/authored-harness reruns; preceding results remain historical. Pre-existing dirty work, installed app and live profile preserved.


Newest session first. Every session ends by adding an entry here (see the session routine in AGENTS.md).

## 2026-10-09 — Codex / XDesign persistent completion goal activated

**Branch:** validation/alpha-2026-09-14

**Changed:** At the owner's explicit `/goal` request, created an **active persistent goal** covering all six remaining XDesign areas, without a requested token budget. [Execution/acceptance plan](docs/architecture/xdesign/completion-goal.md) preserves the canvas/grid/Image workflow, records implementation versus authored/live acceptance, and carries forward repository/access restrictions. No implementation was changed in this goal-setup turn; the preceding 241-test/build/worker record remains the latest code evidence.

**Next:** Continue autonomously on remaining prototype runtime/authoring gaps, then image/performance/export/services work and acceptance. Continue independent work when one area lacks assets or access. Do not mark complete until all implementation and required acceptance are met; use the goal tool's repeated-blocker audit if ultimately at an impasse.

**Open questions:** Original authored prototype/Photoshop assets, native device access and service configuration remain gates. No alternate UI route, unapproved dependencies, external sends or production replacement. User is away; no repeated optional clarification while useful independent work remains.

**Commit:** None. Goal active, not paused/complete/blocked. Existing dirty work and installed application/profile preserved.

## 2026-10-09 — Codex / XDesign multiple prototype interactions

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Up to sixteen click, mouse enter/leave, delay and scoped key interactions per layer, with native undo/persistence, inspector authoring and supported imported arrays. Unsupported opaque interactions remain preserved and identified.
- Every supported destination reconnects through duplicate/snapshot/HTML clipboard and native FIG export. Multiple unresolved destinations can be repaired one at a time; new defaults avoid duplicate delays.
- Present adds directional/eased full-screen entrances, inert outgoing visual snapshots, pause/resume, zero-delay yielding, rapid-loop pause, stable route references and timer/keyboard cleanup. The 40px grid and existing component behaviors remain.
- Final Pencil: **241 passed / 37 files**. Wider frontend: **2,199 passed / three skipped** before the final seven runtime/inspector/test/CSS refinements; final Pencil and TypeScript/production build cover those. Bundled worker and distribution/whitespace checks pass. [Acceptance and source hashes](docs/architecture/xdesign/acceptance-2026-10-09-interactions.md).

**Next:** Action sequences, reversible hover/press, overlays/swap/scroll/variables and deeper transitions/media; Photoshop options/incremental retouch, large-file/history work and original authored/live acceptance. The five workstreams and full replacement remain unfinished.

**Open questions:** Original Figma prototype archives/playback oracles are needed to confirm archive timing/key/easing semantics; available passing Figma fixtures contain no interactions. The Photoshop corpus and original font/screenshot/live tablet/IME/accessibility acceptance remain unavailable/unverified. Prior computer-use denial respected; no alternate UI route. The motion-token gap remains with Hermes; authored transition parameters are document data.

**Commit:** None; owner has not authorized commits/pushes/releases or production replacement. Existing dirty work and installed app/profile preserved. No native code/dependency changes; earlier native/bridge/authored results are historical, not reruns.

## 2026-10-09 — Codex / XDesign prototype interoperability

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Present and React models read supported imported Figma click navigation/Back, including recovered legacy connections and page/flow start metadata. Unsupported interactions are identified; explicit removal survives persistence and native undo.
- Duplicate and clipboard paste reconnect copied screens in one native undo step. External cross-project destinations are marked unresolved. Local authored IDs remain distinct from colliding imported GUIDs.
- FIG export writes native actions/start GUIDs and remapped metadata, preserves unsupported imports, and refuses missing destinations. Added a worker importer around public engine APIs, with omitted page/legacy field recovery and existing worker URL adaptation in production worker builds.
- Full frontend: 2,167 passed, three skipped before the final identity correction; final Pencil: 206 passed across 34 files, including that correction and strict generated TSX. Final TypeScript/production build, bundled-worker execution and distribution checks passed. Four authored Figma consistency cases pass; Material3/NuxtUI still fail documented size limits. [Acceptance and 391 source hashes](docs/architecture/xdesign/acceptance-2026-10-09-prototypes.md).
- Nothing committed, installed or replaced; pre-existing dirty work preserved. Rust/bridges unchanged and not rerun.

**Next:**
- Deeper prototype triggers/actions, exact easing/interruption and copied opaque-reference handling; video compositor/device playback, responsive/nested export fidelity.
- Photoshop option depth/true retouch streaming, large-file imports/transactions and history compaction, followed by authored and live-device acceptance.

**Open questions/blocks:**
- Full Photoshop/Figma replacement and the five workstreams remain unfinished. The Photoshop corpus and original Figma screenshot/font oracles remain unavailable; live computer-use denial remains respected. The worker proof executes the production bundle in Node, not the WebView. Gold holds multiple full graphs and still peaks around 2GiB.

## 2026-10-09 — Codex / XDesign page presentation and video

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Added Present to the native Design workspace: whole-frame screens, XDesign-authored click/back links, starting screens, reduced-motion transitions, retained control values, Back/Restart, keyboard focus and project/source-edit guards. Reused the portable React model/runtime without evaluating generated code.
- Added embedded MP4/WebM/Ogg video import, native editing/export posters, Appearance playback controls, and playable media in Present and React export. Resources survive native graph persistence, undo, bounded selection cloning, local libraries and XDesign HTML clipboard paste after the source session closes.
- FIG refuses video projects until media transport is implemented; portable XDesign saves retain resources. Import/device/compositor limits and outstanding native Figma prototype translation are explicit in [page/media acceptance](docs/architecture/xdesign/acceptance-2026-10-09-media.md).
- Final frontend: 2,148 passed, three skipped; focused final media/export/clipboard/cleanup: 35 passed. TypeScript, final production frontend build and distribution checks passed (413 native notices/eight source archives); results are recorded in the linked acceptance artifact. The first broad run had one unrelated Intake-panel failure that passed in isolation and in the final broad rerun.
- Nothing committed or installed; pre-existing dirty work preserved. Rust/bridges unchanged; prior native/bridge evidence was not rerun.

**Next:**
- Continue native Figma prototype translation/deeper interactions, video compositing/crop and device playback, nested/responsive/export fidelity, true retouch streaming, large-file transactions/imports and history compaction.
- Run authored Photoshop/original Figma screenshot/font and live desktop/tablet/IME/accessibility acceptance when prerequisites permit.

**Open questions/blocks:**
- Full Photoshop/Figma parity and the five workstreams remain unfinished. Live computer use remains denied; Photoshop corpus and original Figma oracles remain unavailable. Video decoder tests simulate media events; actual device playback/audio is not verified. Two large Figma cases still fail current limits.

## 2026-10-09 — Codex / XDesign continuation

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Added standalone interactive React export for all fifteen configured behavior kinds, explicit inspector generation, bounded dependency cloning, mixed typography/theme colors/native artwork, stable control identities and complete staged Orion components.
- Added Try on canvas with an isolated native preview, viewport-only source hiding, cleanup/focus guards and real CanvasKit export/restoration pixel checks.
- Added immutable shared tile/blob bundles, incremental native directory saves, portable backup conversion, unique-content storage reporting and guarded old interrupted-save cleanup. Retouch drafts reuse identical prefixes across viewport changes; Liquify cancels excessive gestures visibly instead of silently truncating.
- Corrected final brush dispatch to preserve native channel/Fade/journal/script/undo semantics. It still renders the final native stroke again; the public upstream API has no prepared commit hook.
- Full frontend: 2,131 passed, three skipped. Native XDesign: 105 passed, one authored-corpus test explicitly ignored. Bridges: 73 passed. Strict generated-module typing, production build and distribution checks pass; the final offline desktop build and 385-file whitespace check pass. See the linked acceptance record.
- Nothing committed or installed. Pre-existing dirty work preserved. [Current acceptance and limits](docs/architecture/xdesign/acceptance-2026-10-09.md).

**Next:**
- Continue video paints/full-page playback and nested/responsive code fidelity; true retouch streaming, legacy bundle conversion/history compaction and large-file transactions/imports.
- Run the authored Photoshop corpus and original Figma font/screenshot comparisons when their prerequisites are available, then real desktop/tablet/IME/font/accessibility acceptance.

**Open questions/blocks:**
- Full Photoshop/Figma parity and all five requested workstreams remain unfinished. The 258 pinned Photoshop fixtures are absent; two large Figma cases fail current limits. Computer use was denied; no alternate UI route was used. No claim of live acceptance or whole-native-suite clearance.

## 2026-10-09 — Claude Code / claude-opus-5-5

**Branch:** validation/alpha-2026-09-14

**Changed:**
- Split the old CLAUDE.md project log into AGENTS.md (durable rules), PLAN.md (AAA rebuild tracker), PROGRESS.md (state, below) and design/ (Phase A tokens). CLAUDE.md is now a symlink to AGENTS.md. All content moved verbatim; backup in ~/ai/backup/2026-10-09/orion/.
- No code changes. Nothing committed; pre-existing dirty work untouched.

**Next:**
- Owner reviews the split.

**Open questions:**
- design/tokens.json has no motion tokens; the canon never defined them. Design owner (Hermes) to add.

## State carried over from CLAUDE.md (last edited 2026-10-06)

## Incubator / Orion Intake (2026-09-16)

**Incubator** (`@orion/incubator`) and Settings share local/public-GitHub acquisition, immutable Skill Codex versions/lifecycle, explicit Orion foreground activation (fresh Brain-only sessions, zero tools), consent-bound analysis and local history. Repository root documents never become installable skills; bounded package.json/requirements declarations are not resolved dependencies or compatibility proof. [Review plans](docs/architecture/capability-importer-review-plans.md) now capture owner target/approach/constraints, historical assessment and host-app snapshot with explicit local save/reload and copyable checklists; they have no execution, installation or grant authority. Skill update/rollback previews compare manifest and attribution changes before action. Skill Codex/Plugin Manager retain lifecycle ownership. [Local SDK intake](docs/architecture/capability-importer-local-packages.md) now installs prepared directory packages disabled, through bounded no-follow byte snapshots and distinct native commands; new identities only, no runtime startup or legacy fallback. [Manager updates](docs/architecture/capability-importer-package-updates.md) also publish captured bytes, bind approval to installed state and isolate old frame callbacks with activity/version guards. [Package recovery](docs/architecture/capability-importer-package-recovery.md) now journals manager publication, retains one previous version, and restores interrupted updates or reviewed rollbacks disabled with no old workspace grants; plugin data is not rolled back. Startup/explicit reload use a new native recovery command; failed recovery blocks mutation. [Journaled removal](docs/architecture/capability-importer-package-removal.md) now binds review to the installed version and commits retirement before recursive cleanup; uncertain removals never reactivate old code. [Isolated native SDK lifecycle](docs/architecture/capability-importer-native-lifecycle.md) now passed fresh schema31 startup, disabled install, explicit enable/function/denial, reviewed update, restart, disabled rollback, re-enable and reviewed removal with data retained. It exposed/fixed SDK inline scripts blocked by inherited production CSP: reuse the existing hash-pinned opaque evaluator with a navigation guard and readiness watchdog; shell CSP unchanged. 73 focused frontend + 5 Node + tsc; production binaries unchanged, proof app closed. This is sample-derived SDK acceptance, not broad security/skills/live-provider acceptance. [Workspace native checks](docs/architecture/capability-importer-workspace-acceptance.md) now pass gesture/mode gates, traversal/link denial, real writes, host/SDK revocation and rollback/restart re-consent using only a temporary folder; no rebuild/code changes. [Background native checks](docs/architecture/capability-importer-background-acceptance.md) passed disabled/startup behavior, folder-request denial, synchronous-error quarantine/restart, synthetic-marker safe-mode cancel/retry and rollback recovery; no rebuild/code change. [Native local skill checks](docs/architecture/capability-importer-skill-native-acceptance.md) passed stage/install/update/disabled persistence, rollback/re-enable/resource preview and confirmed removal/restart with exact bytes and no provider send. Old `/tmp` proof artifacts expired; durable Skill Proof evidence is under `~/.local/share/orion-proof/skills-20260928`. [Native Forge/selection checks](docs/architecture/capability-importer-forge-selection-acceptance.md) also passed attachment/restart, optional resources, consent reset, disabled/missing save refusal and explicit repair; fixture skill/agent removed, app closed. [ChatGPT preflight](docs/architecture/capability-importer-chatgpt-preflight.md) now confirms isolated owner sign-in and approved private Codex0.154.0 (global unchanged); fixed explicit CLI PATH precedence with3 native tests and one private rebuild, retaining the original binary. [Native synthetic ChatGPT checks](docs/architecture/capability-importer-chatgpt-native-acceptance.md) now pass context markers, five fresh zero-grant starts, missing-capacity draft refusal, active-use Disable refusal, early local Stop/retry and packaged broker denials (13 receipts); fixture removed/restarted, app closed. [Native Send guards](docs/architecture/capability-importer-native-send-guards.md) now pass over-budget/retry and disabled/missing agent refusal with retained drafts and zero new model starts. Cleanup now passed native default-model restoration, target-specific AX agent deletion and restart verification after focus loss; app closed, no imported fixture/agent remains. Prior synthetic chats/auth retained. [Native analysis/plans](docs/architecture/capability-importer-analysis-native-acceptance.md) now pass one explicitly reviewed synthetic Terra request with exact citations/zero observed tools, assessment and local skill/reuse plan saves, real restart/shared Settings reopening and removal Cancel. Local follow-up confirms assessment removal preserves the plan across restart, source discard blocks handoff, and plan Cancel/confirmed removal/restart; source/history/plans now empty, app closed, no new AI/install. Prior chats/auth/evidence retained. Streaming/cancel-race, real-source analysis, plan faults/Settings removals and broader provider/security checks remain open; bounded live Forge acceptance is recorded below. Actual startup crashes/remaining fault checks, power-loss/corruption/storage recovery and orphan cleanup remain open. [2048 fixtures](docs/architecture/capability-importer-2048-fixture.md) passed bounded gameplay/storage/keyboard guards and reviewed metadata lifecycle/removal; original code gone/data best8 retained. Separate labelled QA also passed native win/Keep going/game-over, real malformed-state refusal and simulated read/write/delay recovery (8 scenarios/41 snapshots/40 calls;19 focused tests). QA0.1.1 also passed real native invalid-key read/write refusals and explicit Retry recovery after reviewed control-code update (21 tests/4 cases/11 calls incl2 native errors). Owner-approved reversible filesystem read/write denial also passed with explicit Retry (3 cases/12 snapshots/7 calls), exact modes restored; independent timeout restoration checked in separate3s clone. Current/prior QA disabled, synthetic score4/best4/fresh-live config, proof/watchers closed; original data unchanged. Quota/corruption/power-loss/touch/fonts/races/functional game updates/broader safety open; no AI/dependencies/rebuild/product edit. Pending progress has no host dirty-close protection. The full platform is not done: remaining remote-tool/XDesign/Ripper fixtures and adapter acceptance are open; local engines need approved isolation/dependencies. No generic runtime, upstream parity or security-clearance claim; Ripper is not a sandbox. UI polish deferred. Next proposed feature: [E0 Orion-native imported-app appearance, then E1 preparation](docs/architecture/capability-importer-static-app-preparation.md); owner prioritizes stylistic cohesion before pinned2048 source→candidate→disabled install. E0 frontend now implements explicit UI opt-in, bounded read-only live theme data, scoped standard/2048 skin and durable Orion/Original preference; [SDK scope](docs/plugin-sdk/appearance.md). Focused tests/tsc/owned static checks pass. [Isolated native appearance checks](docs/architecture/capability-importer-appearance-native-acceptance.md) now pass actual2048 built-in themes/Original/transparency, New Game/save/restart and disabled persistence with five SDK calls; fixed WebKit board sizing, protected old profiles/binaries unchanged. Test endpoint disabled/closed; owner live review now has separate Appearance Proof open/fixture enabled. Owner accepted shown2048 visuals (“okay looks good”); native custom/layout/tile/focus checks remain. Owner approved E1; [recipe foundation](docs/architecture/capability-importer-static-app-recipe.md) now validates24pinned inputs and deterministically emits35-file inert candidate data with source/recipe/output hashes and regeneration checks (24frontend/38owned Node/tsc/notice gates). [Native source capture/persistence](docs/architecture/capability-importer-static-app-capture.md) now adds bounded shared public transport/jobs, immutable8-source schema32 table, cancellation/publication ordering and full reload/tamper checks (22new+12existing native/11capture+24generator/tsc pass, live test ignored). No live fetch/profile mutation/packaged build; owner live app untouched/uninspected. [Candidate staging/shared review](docs/architecture/capability-importer-static-app-staging.md) now adds immutable schema33 bytes/FK source retention, native fixed-byte + reconstructed manifest/provenance checks and real native fingerprint, shared explicit escaped review/Stop/stale guards (74frontend/10new+34existing native+8package/tsc/notice pass). [Reviewed disabled-install handoff](docs/architecture/capability-importer-static-app-install.md) now reuses the existing captured publisher/Manager registry, selected source/output/native fingerprint/rights/grants and reload/lease guards (73frontend/6new+10existing candidate+8package native/tsc/notices pass). Scratch inert publication only, no live/profile/build; fresh isolated end-to-end acceptance next, no universal converter/fault scope. Preserve dirty work and normal operation approvals. [Handoff](docs/architecture/capability-importer-handoff.md) · [scope](docs/architecture/capability-importer-scope.md) · [source audit](docs/architecture/capability-importer-repolens-audit.md).

**Agreed v1 complete (2026-10-02, bounded acceptance):** [generated2048 native gate](docs/architecture/capability-importer-v1-native-acceptance.md) passed intake/game/storage/theme/notices/restart/update/disabled rollback/removal. Separately approved [two actual Taste/Stitch live tests](docs/architecture/capability-importer-v1-live-acceptance.md) passed private ChatGPT/Terra plain-model and Forge, full111,157selectedbytes, fresh sessions and zero grants/calls/Action/fallback; replies persisted. Native fixtures removed, proof closed; data/backups/chats/auth retained. Two-turn consent exhausted. Protected artifacts exact; owner live profile uninspected. Not full-platform/security/legal/provider/fault clearance or shipped. No production replacement/commit/release. [Definition/limits](docs/architecture/capability-importer-v1-closeout.md).

**UI polish (2026-10-03):** Incubator/shared Settings now split source inspection, app preparation, imported skills and saved reviews into accessible workflows, with retained review state and restrained responsive controls. 71 focused UI tests/tsc/notices/private build/signature pass; native keyboard, review retention, narrow layout and Liquid/Ivory checks passed. Separate UI Proof left open with one staged-only fixture; **owner smoke test next**. No new AI send/install/production replacement/commit/release. [Smoke handoff/evidence](docs/architecture/capability-importer-ui-polish.md).

**Frontend redesign (2026-10-03):** owner requested a more polished, friendly Incubator beyond the initial form cleanup. Added a desktop workflow rail, separate GitHub/local source surfaces, honest empty states, file-browser review and progressive technical disclosures; mounts/leases/gates intact. 75 UI tests/tsc/notices/private build/signature pass. New Design Proof is open in background; native source layout checked, further input stopped on Chrome foreground. Owner accepted the direction (“looks good”); remaining native visual checks pending. Whole-product [research](docs/research/orion-frontend-2026.md) led to a material preview owner rejected as too matte: **preserve the original see-through Liquid, refine its look only.** [Correction](docs/architecture/frontend-liquid-refinement.md) restores icy 2.5% shell/2% reading/11px frost without darkening; typography/controls/radii/opaque renderer palettes retained. 42 tests/tsc/private build pass; owner preferred corrected look. Owner loved the [Dock direction](docs/architecture/dock-signal-rail.md); sparse [orb refinement](docs/architecture/dock-orb-rail.md) was hard to identify. Owner rejected the later orb/hybrid branches and returned to the first icons/layout; current [armoured Signal Rail](docs/architecture/dock-signal-rail.md#current-armoured-variant--study05) adds a machined-metal rim/end pieces around clear glass, original script exact. Owner now requests [selectable Dock styles](docs/architecture/dock-style-customization.md): first Signal default, Cyber armour option and bottom hover Notch based on new control-tray reference. Owner rejected mechanical Notch: current study uses invisible resting trigger and actual side-usage-notch CSS/curled geometry/rings/springs, no metal/tab in that mode;42 synthetic interaction/timer checks. Signal/Cyber unchanged. Owner accepted corrected Notch. Approved [placement/usage study](docs/architecture/dock-placement-study.md) now offers allthree Dock styles Bottom/Left/Right, separate usage placement or inset pausable top-down carousel, expanded-footprint conflict handling. Owner rejected broad sides: current revision56px icon-only→232px inward hover/focus/tap details, stable rows and compact usage badge; bottom unchanged.Owner called slim sides “almost there”; current taste refinement adds quieter satin corners, clearer type/focus/glyphs, outer-edge-fixed right icons and narrow preview-control concealment. 187synthetic checks/3timers/24owned snapshots; owner review next. Real Dock/Appearance/usage/persistence untouched. **Actual Dock unchanged**. No window/AI/lifecycle change. [Current preview/evidence](docs/architecture/capability-importer-ui-redesign.md). No AI/fetch/imported install/production promotion/commit/release.

## Archives Downloads (2026-10-05)

**Full Stacher7 parity is approved**, no renewed scope approval needed. **Owner confirms existing-clip main-library recovery worked**; do not redo conversion or inspect the derivative unnecessarily. P0: codec-aware H.264/AAC playback, original-preserving/tag-inheriting local copies, consent-bound handoff;14video/8audio formats, exact streams and clipping. P1 continuation: schema36/37 native defaults, independent duplicate archive (including generic-host collision repair), no-overwrite native-dialog export, actual local video posters, rate/retry/fragment controls and optional per-operation native browser-cookie consent with private leased scratch/cleanup/redaction. Local type/site tags and existing text-only AI consent unchanged; copies never invoke AI. P2 [queue/batch/playlist slice](docs/architecture/archives-downloads-queue.md): schema38 held/default-snapshot staging, explicit1–3-slot Run, bounded immutable anonymous playlist selection, real retained-byte pause/continuation, Stop/Retry/reorder/hold and no cold auto-run. **66frontend/59ordinary native/4synthetic engine fixtures/tsc/notices/diff pass**; fresh hidden full-schema1–38 native publication/queue controls/cold persistence and five blocked-IPC WK renders pass (not three real-site transfers/active native Pause/whole shell). **Actual cookie/keychain extraction and Save/Allow/default persistence dialogs are not accepted**; no agent-driven real-cookie/live-source/AI test. Normal dev watcher rebuilt/relaunched/applied36/37/38; metadata-only checks confirmed successful matching checksums. **Freeze new migrations immediately after registration while the watcher runs.** No manual production replacement/commit/release. Still open: pre-download/reusable destinations, remote/audio art, subtitles/chapters/embedding, configurable large-file/work limits (sampled shared4GiB/512MiB free-space guards implemented), SponsorBlock/subscriptions/scheduling and broader native/owner acceptance. Not full parity or a sandbox. Preserve dirty work. [Scope/evidence/backlog](docs/architecture/archives-downloads-stacher-parity.md) · [recovery](docs/architecture/archives-downloads-native-recovery.md) · [setup](docs/setup-media-downloads.md).

## Mobile companion (2026-09-15)

`archives-companion/` = native SwiftUI Archives iOS app + Mac sync helper. **0.2 (3) uploaded successfully to Apple for internal TestFlight**; processing/tester availability not yet verified (ASC browser signed out). Keychain pairing, authenticated v2 sync, explicit import review, backups/draft recovery and bounded opt-in Claude chat. Both apps must update together. 30 Swift tests + signed builds/resource checks passed; real-device/owner acceptance pending. No production helper launch or database changes. [Setup](archives-companion/README.md) · [receipt/artifacts/limits](archives-companion/docs/release-0.2.md).

## Current state (2026-09-11) — polish / shared AI routing

**Public alpha (2026-09-15):** user authorized commit/push and public prerelease `v0.1.0-alpha.1`. Baseline `86ec7cf` passed remote CI and user-reported fresh-Tahoe core/ChatGPT smoke checks. New install: minimal glass username→password or skip, creator-owned stock wallpaper, animations off, only three core apps enabled; Archives save status moved to quiet titlebar text. Existing preferences preserved. **User clarified 2026-09-16: focused tests/native inspection are allowed; keep turns short and cost-conscious, avoid repeated broad suites/builds**; publication uses existing automated release gates. Final minimal UI changes have no new human acceptance. [Release notes](docs/releases/v0.1.0-alpha.1.md).

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
