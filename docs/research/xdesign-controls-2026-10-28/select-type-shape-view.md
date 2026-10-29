# XDesign photo vs Photoshop 2026: options-bar depth audit (select, crop, analysis, pen/path, type, shape, view, free transform)

Date: 2026-10-28 · Read-only audit; no repo file was edited · Follows the tool-coverage audit in `CLAUDE_LOG_ARCHIVE.md` (section starting line 848). Only tools that already exist in XDesign are covered; generative/AI, cloud, video, 3D and Libraries are out of scope. Visual styling is ignored.

## Paths used in evidence

- `photo/` = `~/Orion_Terminal/src/apps/xdesign/photo/`
- `host/` = `~/Orion_Terminal/src-tauri/src/`
- `engine/` = `~/.cargo/git/checkouts/photocraft-58992417ad0aec0a/47f9306/crates/engine/src/`
- `vector/` = `~/.cargo/git/checkouts/photocraft-58992417ad0aec0a/47f9306/crates/vector/src/`

The host allows the engine command prefixes used below (`select.`, `layer.`, `shape.`, `path.`, `slice.`, `count.`, `notes.`, `tools.` and others) in `host/xdesign_photo.rs:798` (`command_supported`), so an engine command listed as "yes" is reachable from the frontend.

## Status legend

- **PRESENT**: the control exists and behaves like Photoshop's.
- **PARTIAL**: the control exists but is missing entries, options or behaviour.
- **MISSING-UI**: there is no UI, but the engine already supports it, or the feature is client-side only and needs no engine work ("n/a (client)"). "(emulable)" means no dedicated engine parameter exists, but existing commands can produce the result.
- **MISSING**: needs engine work.

Effort S/M/L and impact H/M/L are given for gaps only; PRESENT rows show "–".

## Photoshop reference and how far it is verified

Adobe's helpx pages returned HTTP 403 to both WebFetch and curl, so the reference comes from web-search extracts of the pages below plus Photoshop's long-standing option lists. Any detail the extracts did not settle is marked "unverified" in the Photoshop column.

- Object Selection (Mode Rectangle/Lasso, Object Finder, Hard Edge, Sample All Layers): https://www.adobe.com/learn/photoshop/web/object-selection-tool
- Crop options (Use Classic Mode, Auto Center Preview, Show Cropped Area, Enable Crop Shield colour/opacity, Delete Cropped Pixels): https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html
- Shape options bar (mode, fill, stroke, W/H, path ops/align/arrange, gear with path thickness/colour and constraints): https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/create-shapes.html (403; search extract only)
- Pen settings: https://helpx.adobe.com/uk/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html (403)
- Star shapes (sides, corner radius): https://helpx.adobe.com/ph_en/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html
- Line tool (Weight; gear Arrowheads Start/End, Width, Length, Concavity −50..50%): https://helpx.adobe.com/th_th/photoshop/using/line-tool.html
- Path Selection (Select Active Layers/All Layers, path ops/align/arrange): https://helpx.adobe.com/photoshop/using/tool-techniques/path-selection-tool.html
- Zoom (Resize Windows to Fit, Zoom All Windows, Scrubby Zoom, Fit Screen, Fill Screen): https://helpx.adobe.com/photoshop/using/tool-techniques/zoom-tool.html
- Select and Mask: https://helpx.adobe.com/photoshop/how-to/make-precise-selections-in-select-mask.html (search extract only)
- Constrain Path Dragging (moved under Preferences > Workspace, or hidden by the narrow options bar): https://community.adobe.com/questions-712/where-is-constrain-path-dragging-in-photoshop-2024-1159194

## Headline

**128 of 215 in-scope Photoshop controls are PRESENT (59.5%, about 60%).** The other 87 are 15 PARTIAL, 58 MISSING-UI and 14 MISSING. These counts come from the status column of the tables below.

About four in five gaps (70 of 87) need no engine work: the 58 MISSING-UI rows plus 12 PARTIAL rows. The 3 PARTIAL rows that do need engine work are New Document output, platform anti-alias modes and the extra interpolation modes. The weakest areas are the vector tools: Pen family 1/12, Path Selection 0/9 and Shapes 8/26. In all three the engine already accepts most of the missing parameters (stroke align, caps, joins and dashes; gradient and pattern fills; per-corner radii; path ops; rect resize). The selection, crop and analysis bars are close to complete.

---

## 1. Move

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Auto-Select checkbox | PRESENT | `photo/PhotoStudio.tsx:2010` | n/a | – | – |
| Auto-Select target Layer / Group | PRESENT | `photo/PhotoStudio.tsx:2010` | n/a | – | – |
| Show Transform Controls | PRESENT | `photo/PhotoStudio.tsx:2011` | n/a | – | – |
| Align buttons (Left, Horizontal Centers, Right, Top, Vertical Centers, Bottom) | PRESENT | `photo/PhotoStudio.tsx:147`, `:2012` | yes: `layer.align.*` (`engine/layer_multi_cmds.rs:765`) | – | – |
| "…" popover: Distribute (6) and Distribute Spacing (2) | PRESENT | `photo/toolBars.tsx:179-186` (8 entries) | yes (`engine/layer_multi_cmds.rs:765-792`) | – | – |
| "…" popover: Align To Selection / Canvas | MISSING-UI | `photo/PhotoStudio.tsx:2012` calls `layer.align.${edge}` with no params | yes: `"to":"auto\|layers\|selection\|canvas"` (`engine/layer_multi_cmds.rs:752`) | S | M |

## 2. Rectangular and Elliptical Marquee

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Selection mode New / Add / Subtract / Intersect | PRESENT | `photo/PhotoStudio.tsx:2004`, `photo/OptionsBarControls.tsx:45` | yes: `select.rect` mode (`engine/commands.rs:320`) | – | – |
| Feather (px) | PRESENT | `photo/PaintToolOptions.tsx:27`, `:50` (0–1000) | yes: feather | – | – |
| Anti-alias (Elliptical only; greyed for Rectangular) | PRESENT | `photo/PaintToolOptions.tsx:50` (ellipse only) | yes: antiAlias | – | – |
| Style Normal / Fixed Ratio / Fixed Size | PRESENT | `photo/PaintToolOptions.tsx:31`, `photo/selectionGesture.ts:19-39` | client gesture maths | – | – |
| Width / Height fields | PRESENT | `photo/PaintToolOptions.tsx:31` | client | – | – |
| Swap width and height button | MISSING-UI | `photo/PaintToolOptions.tsx:31` (no swap) | n/a (client) | S | L |
| Select and Mask… button | PRESENT | `photo/PhotoStudio.tsx:2025` (disabled with no selection, see "Wrong ranges") | yes: `select.refineEdge` | – | – |

Extra control: "Draw from center" (`photo/PaintToolOptions.tsx:31`) is not on Photoshop's bar, where Alt-drag does this. It does no harm, but Photoshop has no such control.

## 3. Single Row and Single Column Marquee

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Selection mode | PRESENT | `photo/PhotoStudio.tsx:2004` | yes | – | – |
| Feather (Anti-alias and Style are greyed in Photoshop; unverified) | PRESENT | `photo/PaintToolOptions.tsx:50` | yes | – | – |
| Select and Mask… button | PRESENT | `photo/PhotoStudio.tsx:2025` | yes | – | – |

## 4. Lasso and Polygonal Lasso

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Selection mode | PRESENT | `photo/PhotoStudio.tsx:2004` | yes: `select.lasso` (`engine/selection_cmds.rs:353`) | – | – |
| Feather | PRESENT | `photo/PaintToolOptions.tsx:51` | yes | – | – |
| Anti-alias | PRESENT | `photo/PaintToolOptions.tsx:51` | yes | – | – |
| Select and Mask… button | PRESENT | `photo/PhotoStudio.tsx:2025` | yes | – | – |

## 5. Magnetic Lasso

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Selection mode | PRESENT | `photo/PhotoStudio.tsx:2004` | yes | – | – |
| Feather | PRESENT | `photo/PaintToolOptions.tsx:52` | yes | – | – |
| Anti-alias | PRESENT | `photo/PaintToolOptions.tsx:52` | yes | – | – |
| Width 1–256 px, default 10 | PRESENT | `photo/PaintToolOptions.tsx:52`, `photo/MagneticLassoOverlay.tsx:21-22` | host tracer `host/xdesign_photo_magnetic.rs` | – | – |
| Contrast 1–100 %, default 10 | PRESENT | `photo/PaintToolOptions.tsx:52`, `photo/magneticLasso.ts:27-28` | host | – | – |
| Frequency 0–100, default 57 | PRESENT | `photo/PaintToolOptions.tsx:52` | host | – | – |
| Use tablet pressure to change width | PRESENT | `photo/PaintToolOptions.tsx:52`, `photo/magneticLasso.ts:142` | host | – | – |
| Select and Mask… button | PRESENT | `photo/PhotoStudio.tsx:2025` | yes | – | – |

## 6. Object Selection

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Selection mode | PRESENT | `photo/PhotoStudio.tsx:2004` | yes: `select.object` mode (`engine/smartselect_cmds.rs:237`) | – | – |
| Object Finder toggle (hover highlight, refresh, show all objects) | MISSING | none | no: `select.object` takes only a rect | L | M |
| Object Finder settings gear (overlay colour/opacity, Object Subtract; exact 2026 entries unverified) | MISSING | none | no | M | L |
| Mode: Rectangle / Lasso | PARTIAL | Rectangle only: `photo/selectionGesture.ts:72` | rect only (`engine/smartselect_cmds.rs:237`); Lasso emulable as `select.object` on the lasso's bounding box, then intersect with `select.lasso` | M | M |
| Sample All Layers | PRESENT | `photo/PaintToolOptions.tsx:54` | yes: sampleAllLayers | – | – |
| Hard Edge | MISSING | none | no parameter | M | M |
| Select Subject (the Device/Cloud choice is out of scope) | PRESENT | `photo/PhotoStudio.tsx:2025` | yes: `select.subject` (`engine/smartselect_cmds.rs:245`) | – | – |
| Select and Mask… button | PRESENT | `photo/PhotoStudio.tsx:2025` | yes | – | – |

Wrong controls: Object Selection shows the marquee Style, W/H and "Draw from center" fields (`photo/PaintToolOptions.tsx:54` spreads `rectangle`). Photoshop has none of these on this tool.

## 7. Quick Selection

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Mode New / Add / Subtract (no Intersect) | PRESENT | `photo/PhotoStudio.tsx:2004` (3 modes) | yes (`engine/smartselect_cmds.rs:229`) | – | – |
| Brush size | PRESENT | `photo/PaintToolOptions.tsx:53` (1–5000, default 30) | yes: size | – | – |
| Brush picker: Hardness, Spacing, Angle, Roundness, Size control Pen Pressure / Stylus Wheel | MISSING | size only; no `BrushPresetPicker` (it is used only when `brushTool` is true, `photo/PhotoStudio.tsx:1993`) | no: `select.quick` takes only `size` | M | L |
| Sample All Layers | PRESENT | `photo/PaintToolOptions.tsx:53` | yes | – | – |
| Enhance Edge | PRESENT | `photo/PaintToolOptions.tsx:53`, `photo/selectionGesture.ts:79` | yes | – | – |
| Select Subject | PRESENT | `photo/PhotoStudio.tsx:2025` | yes | – | – |
| Select and Mask… button | PRESENT | `photo/PhotoStudio.tsx:2025` | yes | – | – |

## 8. Magic Wand

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Selection mode | PRESENT | `photo/PhotoStudio.tsx:2004` | yes | – | – |
| Sample Size (Point, 3×3 … 101×101 Average) | MISSING | `photo/selectionGesture.ts:80` sends none | no: `select.magicWand` takes only x, y (`engine/selection_cmds.rs:331`) | M | M |
| Tolerance 0–255, default 32 | PRESENT | `photo/PaintToolOptions.tsx:49` | yes | – | – |
| Anti-alias | PRESENT | `photo/PaintToolOptions.tsx:49` | yes | – | – |
| Contiguous | PRESENT | `photo/PaintToolOptions.tsx:49` | yes | – | – |
| Sample All Layers | PRESENT | `photo/PaintToolOptions.tsx:49` | yes | – | – |
| Select Subject | PRESENT | `photo/PhotoStudio.tsx:2025` | yes | – | – |
| Select and Mask… button | PRESENT | `photo/PhotoStudio.tsx:2025` | yes | – | – |

## 9. Select and Mask (depth)

XDesign implements this as a modal dialog (`photo/SelectionDialog.tsx`), not as Photoshop's full workspace with its own toolbar and options bar.

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| View Mode list: Onion Skin, Marching Ants, Overlay, On Black, On White, Black & White, On Layers | PARTIAL | `photo/SelectionDialog.tsx:95`: mask, overlay, black, white, transparent, result. No Marching Ants and no Onion Skin transparency | client preview | S | L |
| Show Edge (J) | MISSING | none | no edge-band preview | M | L |
| Show Original (P) | PARTIAL | Preview checkbox only (`photo/SelectionDialog.tsx:73`, `photo/photoDialog.tsx:60`) | client | S | L |
| High Quality Preview / Real-time Refinement | MISSING-UI | preview is capped at 16 MP (`photo/SelectionDialog.tsx:29`, `:96`) | n/a (host preview setting) | M | L |
| View settings: overlay Opacity, Color, Indicates | MISSING-UI | none | n/a (client) | S | L |
| Refine Mode: Color Aware / Object Aware | MISSING | none | no mode parameter in `select.refineEdge` (`engine/smartselect_cmds.rs:253`) | L | M |
| Edge Detection Radius | PRESENT | `photo/selectionSettings.ts:19` (0–250) | yes: radius | – | – |
| Smart Radius | PRESENT | `photo/SelectionDialog.tsx:100` | yes | – | – |
| Smooth | PRESENT | `photo/selectionSettings.ts:20` | yes | – | – |
| Feather | PRESENT | `photo/selectionSettings.ts:21` (0–1000 px, see "Wrong ranges") | yes | – | – |
| Contrast | PRESENT | `photo/selectionSettings.ts:22` | yes | – | – |
| Shift Edge | PRESENT | `photo/selectionSettings.ts:23` | yes | – | – |
| Clear Selection button | MISSING-UI | none | yes: `select.deselect` | S | L |
| Invert button | MISSING-UI | none | yes: `select.inverse` (`engine/selection_cmds.rs:306`) | S | M |
| Decontaminate Colors and Amount | PRESENT | `photo/SelectionDialog.tsx:100` | yes | – | – |
| Output To: Selection, Layer Mask, New Layer, New Layer with Layer Mask, New Document, New Document with Layer Mask | PARTIAL | `photo/selectionSettings.ts:14` has the first 4 only | the 4 are supported; New Document needs engine work (`layer.duplicate` cannot target another document) | M | L |
| Remember Settings | PRESENT | `photo/SelectionDialog.tsx:104` | client | – | – |
| Presets (Save / Load) | MISSING-UI | none | n/a (client) | S | L |
| Reset (Alt + Cancel) | PRESENT | `photo/photoDialog.tsx:58` | client | – | – |
| Quick Selection tool inside the workspace | MISSING-UI | none | yes: `select.quick` | M | M |
| Refine Edge Brush (with erase) | PRESENT | `photo/SelectionDialog.tsx:97` | host `host/xdesign_photo_selection_brush.rs` | – | – |
| Brush tool (paint add/subtract) | MISSING-UI | none | emulable through `select.editInQuickMaskMode` and paint (unverified inside the dialog) | M | M |
| Object Selection tool inside the workspace | MISSING-UI | none | yes: `select.object` | M | L |
| Lasso / Polygonal Lasso inside the workspace | MISSING-UI | none | yes: `select.lasso` | M | L |
| Hand / Zoom inside the workspace | MISSING-UI | none | n/a (client) | M | L |
| Options bar: Select Subject | MISSING-UI | none in the dialog | yes: `select.subject` | S | M |
| Options bar: Refine Hair | MISSING | none | no | L | M |
| Options bar: Sample All Layers | PRESENT | `photo/SelectionDialog.tsx:100` | yes | – | – |

## 10. Crop

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Preset menu: Ratio, W x H x Resolution, Original Ratio, 1:1, 4:5, 5:7, 2:3, 16:9, Front Image, 5 size presets, New / Delete Crop Preset | PRESENT | `photo/toolBars.tsx:94-111`, `:63`, `photo/PhotoStudio.tsx:181` | client | – | – |
| Ratio W / H fields | PRESENT | `photo/toolBars.tsx:147-161` | client | – | – |
| Swap W and H | PRESENT | `photo/toolBars.tsx:129` | client | – | – |
| Resolution with px/in or px/cm | PRESENT | `photo/toolBars.tsx:131`, `photo/PaintToolOptions.tsx:30` | yes | – | – |
| Clear | PRESENT | `photo/toolBars.tsx:134` | client | – | – |
| Straighten | PRESENT | `photo/PhotoStudio.tsx:2026` | yes | – | – |
| Overlay list: Rule of Thirds, Grid, Diagonal, Triangle, Golden Ratio, Golden Spiral | PRESENT | `photo/CropOverlay.tsx:9-16` | client | – | – |
| Auto Show / Always Show / Never Show Overlay | PRESENT | `photo/CropOverlay.tsx:18` | client | – | – |
| Cycle Overlay / Cycle Orientation | PRESENT | `photo/PhotoStudio.tsx:487`, `:2027` | client | – | – |
| Gear: Use Classic Mode | MISSING-UI | `photo/PhotoStudio.tsx:2028` (absent) | n/a (client) | M | L |
| Gear: Auto Center Preview | MISSING-UI | `photo/PhotoStudio.tsx:2028` (absent) | n/a (client) | M | L |
| Gear: Show Cropped Area | PRESENT | `photo/PhotoStudio.tsx:2028` | client | – | – |
| Gear: Enable Crop Shield | PRESENT | `photo/PhotoStudio.tsx:2028` | client | – | – |
| Gear: shield Color (Match Canvas / Custom) | MISSING-UI | `photo/PhotoStudio.tsx:2028` (absent) | n/a (client) | S | L |
| Gear: shield Opacity | PARTIAL | `photo/PhotoStudio.tsx:2028`: 25/50/75/100 % presets only (Photoshop's free-entry field is unverified) | client | S | L |
| Gear: Auto Adjust Opacity | MISSING-UI | `photo/PhotoStudio.tsx:2028` (absent) | n/a (client) | S | L |
| Delete Cropped Pixels | PRESENT | `photo/PaintToolOptions.tsx:57`, `photo/PhotoStudio.tsx:2029` | yes | – | – |
| Fill: Background (default) / Content-Aware Fill (Generative Expand is out of scope) | PRESENT | `photo/toolBars.tsx:164-177` | yes: `edit.contentAwareFill` allowed by the host | – | – |
| Reset / Cancel / Commit | PRESENT | `photo/PhotoStudio.tsx:2033` | client | – | – |

## 11. Perspective Crop

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| W / swap / H | PRESENT | `photo/toolBars.tsx:138-145` (via `CropSizeFields`) | yes | – | – |
| Resolution with unit | PRESENT | `photo/toolBars.tsx:131` | yes | – | – |
| Front Image | PRESENT | `photo/toolBars.tsx:141` | client | – | – |
| Clear | PRESENT | `photo/toolBars.tsx:134` | client | – | – |
| Show Grid | PRESENT | `photo/toolBars.tsx:143`, `photo/PaintToolOptions.tsx:58` | client | – | – |
| Cancel / Commit on the bar | PARTIAL | in the Properties-panel `PerspectiveCropDialog` (`photo/PhotoStudio.tsx:2122`), not on the bar | client | S | L |

## 12. Slice

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Style Normal / Fixed Aspect Ratio / Fixed Size | PRESENT | `photo/AnalysisTools.tsx:255` | client | – | – |
| Width / Height | PRESENT | `photo/AnalysisTools.tsx:256-257` | client | – | – |
| Slices From Guides | MISSING-UI | `photo/AnalysisTools.tsx:251-258` (absent) | yes: `slice.fromGuides` | S | L |

## 13. Slice Select

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Arrange: Bring to Front / Forward / Backward / Send to Back | MISSING | none | no stacking parameter in `slice.set` (`engine/slice_cmds.rs:466`) | M | L |
| Promote | PRESENT | `photo/AnalysisTools.tsx:263` | yes: `slice.promote` | – | – |
| Divide Slice… | PRESENT | `photo/AnalysisTools.tsx:264` | yes: `slice.divide` | – | – |
| Align (6) | MISSING-UI | none | emulable: `slice.set` rect | M | L |
| Distribute (6) | MISSING-UI | none | emulable: `slice.set` rect | M | L |
| Hide Auto Slices | PRESENT | `photo/AnalysisTools.tsx:265` | client | – | – |
| Slice Options | PRESENT | `photo/AnalysisTools.tsx:266` | yes: `slice.set` | – | – |

## 14. Eyedropper

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Sample Size: Point, 3, 5, 11, 31, 51, 101 Average | PRESENT | `photo/PhotoStudio.tsx:152`, `:2018` | client | – | – |
| Sample: Current Layer, Current & Below, All Layers | PRESENT | `photo/PhotoStudio.tsx:2016` | client | – | – |
| Sample: All Layers No Adjustments, Current & Below No Adjustments (2026 list unverified) | MISSING | `photo/PhotoStudio.tsx:2016` (absent) | needs a composite that skips adjustment layers; engine support unverified | M | L |
| Show Sampling Ring | PRESENT | `photo/PhotoStudio.tsx:2017` | client | – | – |

## 15. Color Sampler

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Sample Size | PRESENT | `photo/PhotoStudio.tsx:2018` | client | – | – |
| Clear All | PRESENT | `photo/PhotoStudio.tsx:148-150`, `:2019` | client | – | – |

## 16. Ruler

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| X, Y, W, H, A, L1, L2 readout | PRESENT | `photo/AnalysisTools.tsx:221-225` | yes | – | – |
| Use Measurement Scale | MISSING-UI | none on the bar; the scale can be set from the menu (`photo/PhotoStudio.tsx:1430`) | yes: `image.analysis.setMeasurementScale` | S | L |
| Straighten Layer | PRESENT | `photo/AnalysisTools.tsx:226` | yes | – | – |
| Clear | PRESENT | `photo/AnalysisTools.tsx:227` | yes | – | – |

## 17. Note

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Author | PRESENT | `photo/AnalysisTools.tsx:246` | yes | – | – |
| Color | PRESENT | `photo/AnalysisTools.tsx:247` | yes | – | – |
| Clear All | PRESENT | `photo/AnalysisTools.tsx:248` | yes: `notes.delete` all | – | – |
| Show / Hide Notes panel | PRESENT | `photo/PhotoStudio.tsx:2015` (`toggleNotes`) | client | – | – |

## 18. Count

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Count readout | PRESENT | `photo/AnalysisTools.tsx:234` | yes | – | – |
| Count Group menu | PRESENT | `photo/AnalysisTools.tsx:235` | yes: `count.setGroup` | – | – |
| Group visibility / New group / Delete group | PRESENT | `photo/AnalysisTools.tsx:236-238` | yes | – | – |
| Clear | PRESENT | `photo/AnalysisTools.tsx:239` | yes | – | – |
| Count Group Color | PRESENT | `photo/AnalysisTools.tsx:240` | yes | – | – |
| Marker Size 1–10 | PRESENT | `photo/AnalysisTools.tsx:241` | yes | – | – |
| Label Size 8–72 | PRESENT | `photo/AnalysisTools.tsx:242` | yes | – | – |

## 19. Pen, Freeform Pen and Curvature Pen

Rows apply to all three tools unless the row names one.

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Mode Shape / Path (Photoshop offers no Pixels mode for pens) | PRESENT | `photo/PhotoStudio.tsx:1998`, `:182` | yes | – | – |
| Make: Selection… / Mask / Shape (Path mode) | MISSING-UI | the buttons exist only on Path Selection (`photo/PhotoStudio.tsx:2020`) | yes: `path.toSelection`, `layer.vectorMask.fromPath`, `shape.create` kind path | S | H |
| Fill / Stroke (Shape mode) | PARTIAL | `photo/PhotoStudio.tsx:1999` uses `ShapeStyleFields`; gaps as in table 22 | yes (see table 22) | M | M |
| Path operations | PARTIAL | applied in Shape mode only (`photo/PhotoStudio.tsx:1128`); Path mode calls `path.set` with no op (`:1132`) | yes: `path.set` op (`engine/vector_cmds.rs:1305`) | S | M |
| Path alignment | MISSING-UI | none | emulable: rewrite the path with `path.set` / `shape.edit` | M | L |
| Path arrangement | MISSING-UI | none | emulable: reorder subpaths with `path.set` | M | L |
| Gear: path Thickness and Color | MISSING-UI | none | n/a (client overlay) | S | L |
| Gear: Rubber Band (Pen, Curvature; unverified for Curvature) | MISSING-UI | rubber band exists only for Shift-click painting (`photo/PhotoStudio.tsx:932`) | n/a (client) | S | M |
| Auto Add/Delete (Pen) | MISSING-UI | `photo/PathEditOverlay.tsx:1-63` drags anchors and handles only; it cannot add, delete or convert points | emulable: `path.set` with edited knots | M | H |
| Align Edges (Shape mode) | MISSING-UI | none | n/a (snap coordinates client-side) | S | L |
| Freeform: Curve Fit (0.5–10 px, default 2; unverified) | MISSING-UI | fixed `1.5/zoom` tolerance at `photo/PhotoStudio.tsx:1067` | n/a (client `simplifyPath`) | S | M |
| Freeform: Magnetic checkbox with Width, Contrast, Frequency and Pen Pressure | MISSING-UI | none for pens | host tracer exists (`host/xdesign_photo_magnetic.rs`, used by Magnetic Lasso) | M | M |

## 20. Path Selection and Direct Selection

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Select: Active Layers / All Layers | MISSING-UI | none; the target is the active Shape layer or selected path (`photo/PhotoStudio.tsx:635`) | n/a (client hit-test; `path.list`) | M | M |
| Fill / Stroke / stroke width (shape layers) | PARTIAL | `photo/PhotoStudio.tsx:2020` (`ShapeStyleFields`; solid colours only) | yes (see table 22) | M | M |
| W / link / H | MISSING-UI | none | yes: `shape.edit` rect, `path.transform` (`engine/vector_cmds.rs:1257`, `:1315`) | S | M |
| Path operations on the selected component, and Merge Shape Components | MISSING-UI | `PathOpSelect` is shown only for shape and pen tools (`photo/PhotoStudio.tsx:1999`) | yes: `shape.edit` op + subpath (`engine/vector_cmds.rs:1257`) | S | M |
| Path alignment | MISSING-UI | none | emulable: `shape.edit` path replace | M | M |
| Path arrangement | MISSING-UI | none | emulable: `shape.edit` path replace | M | L |
| Gear: path Thickness and Color | MISSING-UI | none | n/a (client) | S | L |
| Align Edges | MISSING-UI | none | n/a (client snap) | S | L |
| Constrain Path Dragging (now in Preferences > Workspace per the community thread; unverified) | MISSING-UI | `photo/PathEditOverlay.tsx:1-63` | n/a (client) | M | L |

Placement difference: XDesign puts Make: Selection… / Mask / Shape on this bar (`photo/PhotoStudio.tsx:2020`). In Photoshop they belong to the Pen tools in Path mode; whether they also appear on Path Selection's bar is unverified.

## 21. Horizontal Type

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Text orientation toggle | PRESENT | `photo/toolBars.tsx:34` | yes | – | – |
| Font family | PRESENT | `photo/toolBars.tsx:35`, `photo/fontFamilies.tsx:5-13` (system families via `xdesign_font_families`) | yes | – | – |
| Font style (the family's real faces) | PARTIAL | fixed Regular / Italic / Bold / Bold Italic (`photo/toolBars.tsx:10`, `:36`) | yes: `type.fonts` lists faces with weight and italic (`engine/type_cmds.rs:719-730`); `fontStyle`, `weight` 100..900 (`:116`, `:124`, `:481`) | S | H |
| Font size (pt) | PRESENT | `photo/toolBars.tsx:37` (range note under "Wrong ranges") | yes | – | – |
| Anti-aliasing: None, Sharp, Crisp, Strong, Smooth, plus the platform LCD entries | PARTIAL | `photo/toolBars.tsx:11` has the 5 standard entries; no platform entries | engine has 5 only (`engine/type_cmds.rs:628-633`); platform modes need engine work | M | L |
| Alignment Left / Center / Right | PRESENT | `photo/toolBars.tsx:25`, `:39` | yes | – | – |
| Text color | PRESENT | `photo/toolBars.tsx:40` | yes: `type.setStyle` color | – | – |
| Create Warped Text | PRESENT | `photo/toolBars.tsx:41` | yes | – | – |
| Toggle Character and Paragraph panels | MISSING-UI | none on the bar (`photo/CharacterPanel.tsx` exists) | n/a (client) | S | M |
| Cancel / Commit edits | MISSING-UI | none on the bar; the only Apply/Cancel pair is the selection transform (`photo/PhotoStudio.tsx:2031`) | n/a (client) | S | M |

## 22. Shape tools (Rectangle, Ellipse, Triangle, Polygon, Line)

The first 17 rows are shared by all five tools.

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Mode Shape / Path / Pixels | PARTIAL | Shape only; the mode select is for `PEN_TOOLS` (`photo/PhotoStudio.tsx:1998`) | emulable: Path through `path.set`, Pixels through `path.fill` (`engine/vector_cmds.rs:1305`, `:1363`) | M | M |
| Fill on/off | PRESENT | `photo/toolBars.tsx:47` | yes | – | – |
| Fill type: No Color / Solid (own colour) / Gradient / Pattern | PARTIAL | a checkbox that always uses the foreground colour (`photo/toolBars.tsx:20`, `:47`) | yes: fill `#hex\|gradient\|pattern\|null` (`engine/vector_cmds.rs:1240`) | M | H |
| Stroke on/off and colour | PRESENT | `photo/toolBars.tsx:48-49` | yes | – | – |
| Stroke type: Gradient / Pattern | MISSING-UI | colour input only (`photo/toolBars.tsx:49`) | yes: stroke color accepts the fill form (`engine/vector_cmds.rs:1239`) | M | M |
| Stroke width | PRESENT | `photo/toolBars.tsx:50` (0–1000 px) | yes | – | – |
| Stroke Options: Align Inside / Center / Outside | MISSING-UI | `photo/toolBars.tsx:20` sends color and width only | yes: stroke `align` (`engine/vector_cmds.rs:1239`) | S | H |
| Stroke Options: Caps Butt / Round / Square | MISSING-UI | same | yes: `cap` | S | M |
| Stroke Options: Corners Miter / Round / Bevel | MISSING-UI | same | yes: `join`, `miterLimit` | S | M |
| Stroke Options: Solid / Dashed / Dotted presets and More Options (dash/gap ×3) | MISSING-UI | same | yes: `dashes`, `dashOffset` | M | H |
| W / link / H | MISSING-UI | none | yes: `shape.edit` rect (`engine/vector_cmds.rs:1257`) | S | M |
| Path operations: New Layer, Combine, Subtract, Intersect, Exclude, Merge Shape Components | PRESENT | `photo/toolBars.tsx:12`, `:53-58`, `photo/PhotoStudio.tsx:1999` | yes: `addTo` + `op` | – | – |
| Path alignment | MISSING-UI | none | emulable: `shape.edit` path replace | M | M |
| Path arrangement | MISSING-UI | none | emulable: `shape.edit` path replace | M | L |
| Gear: path Thickness and Color | MISSING-UI | none | n/a (client) | S | L |
| Gear: Unconstrained / Square / Fixed Size / Proportional / From Center | MISSING-UI | shapes already go through `gestureRectangle` (`photo/PhotoStudio.tsx:1073`), which handles fixedSize, fixedRatio and fromCenter (`photo/selectionGesture.ts:19-39`), but shape tools have no fields | n/a (client) | S | M |
| Align Edges | PARTIAL | always on in effect: `gestureRectangle` rounds to whole pixels (`photo/selectionGesture.ts:32-35`); no toggle, and line/polygon behaviour unverified | n/a (client) | S | L |
| Rectangle: corner radius (single field) | PRESENT | `photo/PhotoStudio.tsx:2000` | yes | – | – |
| Rectangle: per-corner radii (Photoshop's Properties panel) | MISSING-UI | single `radii:cornerRadius` (`photo/PhotoStudio.tsx:1077`) | yes: `radii:[tl,tr,br,bl]` (`engine/vector_cmds.rs:1247`) | S | M |
| Triangle: corner radius | MISSING | triangle is a 3-sided polygon (`photo/PhotoStudio.tsx:1076`) | no: `polygon()` has no radius (`vector/shapes.rs:96`) | M | M |
| Polygon: Number of sides | PRESENT | `photo/PhotoStudio.tsx:2001` (3–100) | yes: sides 3..100 | – | – |
| Polygon: corner radius (bar placement unverified; star page documents a corner radius) | MISSING | none | no (`vector/shapes.rs:96`) | M | L |
| Polygon: Star Ratio | PRESENT | `photo/PhotoStudio.tsx:2001` (1–100 %; Photoshop puts it in the gear, unverified) | yes: starRatio 0..1 | – | – |
| Polygon: Smooth Star Indents | MISSING | none | no | M | L |
| Line: Weight | PRESENT | `photo/PhotoStudio.tsx:2002` (1–1000 px) | yes: weight | – | – |
| Line: Arrowheads Start / End, Width, Length, Concavity (gear) | MISSING | none | no arrowhead support anywhere in the engine | M | M |

## 23. Hand

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Scroll All Windows (only matters when several documents are visible) | MISSING-UI | none | n/a (client) | S | L |
| 100% | PRESENT | `photo/PhotoStudio.tsx:2024` | client | – | – |
| Fit Screen | PRESENT | `photo/PhotoStudio.tsx:2024` | client | – | – |
| Fill Screen | PRESENT | `photo/PhotoStudio.tsx:2024` | client | – | – |

## 24. Rotate View

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Rotation Angle | PRESENT | `photo/PhotoStudio.tsx:2023` (−180..180°) | client | – | – |
| Reset View | PRESENT | `photo/PhotoStudio.tsx:2023` | client | – | – |
| Rotate All Windows | MISSING-UI | none | n/a (client) | S | L |

## 25. Zoom

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Zoom In / Zoom Out | PRESENT | `photo/PhotoStudio.tsx:2021` | client | – | – |
| Resize Windows to Fit (floating windows only) | MISSING-UI | none | n/a (client) | S | L |
| Zoom All Windows | MISSING-UI | none | n/a (client) | S | L |
| Scrubby Zoom | PRESENT | `photo/PhotoStudio.tsx:2022` | client | – | – |
| 100% | PRESENT | `photo/PhotoStudio.tsx:2024` | client | – | – |
| Fit Screen | PRESENT | `photo/PhotoStudio.tsx:2024` | client | – | – |
| Fill Screen | PRESENT | `photo/PhotoStudio.tsx:2024` | client | – | – |

## 26. Free Transform bar

| Photoshop control | XDesign status | evidence `file:line` | engine support | effort S/M/L | designer impact H/M/L |
|---|---|---|---|---|---|
| Reference point locator (and its show checkbox) | MISSING-UI | `photo/FreeTransformBar.tsx:18-29`; no pivot in `photo/freeTransform.ts:11` | n/a (client matrix maths) | M | M |
| X / Y | PRESENT | `photo/FreeTransformBar.tsx:19` (px) | client | – | – |
| Relative positioning (Δ) toggle | MISSING-UI | none | n/a (client) | S | L |
| W (%) / link / H (%) | PRESENT | `photo/FreeTransformBar.tsx:20-22` | client | – | – |
| Angle | PRESENT | `photo/FreeTransformBar.tsx:23` | client | – | – |
| H / V skew | PRESENT | `photo/FreeTransformBar.tsx:24` | client | – | – |
| Interpolation: Nearest Neighbor, Bilinear, Bicubic, Bicubic Smoother, Bicubic Sharper, Bicubic Automatic (2026 list unverified) | PARTIAL | first 3 only (`photo/freeTransform.ts:10`) | engine takes `bicubic\|bilinear\|nearest` only | M | L |
| Switch between Free Transform and Warp | MISSING-UI | none on the bar (`photo/warpSession.ts` exists) | yes (warp exists) | S | M |
| Cancel / Commit | PRESENT | `photo/FreeTransformBar.tsx:26-29` | client | – | – |

## Not counted

The tool preset picker on every tool is decorative: `photo/PhotoStudio.tsx:1992` shows an icon and chevron with no picker, and the engine has no `tools.preset*` command. A client-side store like the crop presets (`useCropPresets`, `photo/toolBars.tsx:95`) could provide it. Effort M, impact M.

---

## Wrong ranges, defaults, units and options

Where the code makes it clear:

1. **Object Selection shows the wrong fields.** Its bar shows the marquee Style, W/H and "Draw from center" fields (`photo/PaintToolOptions.tsx:54`), which are not Object Selection controls. They should be replaced by Mode, Hard Edge and Object Finder.
2. **Character panel anti-aliasing (`photo/CharacterPanel.tsx:26`).** It offers "Windows LCD" and "Windows", but the engine maps any value other than none, sharp, crisp or strong to Smooth (`engine/type_cmds.rs:628-633`). Picking either one silently saves Smooth. On macOS, Photoshop would show Mac LCD / Mac (unverified).
3. **Type font style is a fixed list.** It shows Regular, Italic, Bold and Bold Italic for every family (`photo/toolBars.tsx:10`). The family's real faces are ignored, although `type.fonts` returns them.
4. **Marquee "Draw from center" (`photo/PaintToolOptions.tsx:31`) is not a Photoshop bar control.** Photoshop uses Alt; XDesign also honours Alt (`photo/selectionGesture.ts:31`).
5. **Make buttons are on the wrong bar.** Make: Selection… / Mask / Shape is on Path Selection and Direct Selection (`photo/PhotoStudio.tsx:2020`), not on the Pen tools in Path mode where Photoshop puts it.
6. **Pen Path mode ignores the path operation.** `path.set` is called with no op (`photo/PhotoStudio.tsx:1132`), although the engine accepts one.

Likely, but the Photoshop docs could not confirm (unverified):

7. **Type size is 1–10000 pt** (`photo/toolBars.tsx:37`). Photoshop's commonly cited limits are 0.01–1296 pt.
8. **Select and Mask Feather is 0–1000 px** (`photo/selectionSettings.ts:21`). Photoshop's slider appears to stop at 250 px.
9. **Select and Mask… needs a selection.** The button is disabled with no selection (`photo/PhotoStudio.tsx:2025`, `!hasSelection`), but Photoshop opens the workspace with an empty selection.
10. **Crop Shield Opacity** offers fixed 25/50/75/100 % choices (`photo/PhotoStudio.tsx:2028`). Photoshop has a free percentage field.

## Top gaps ranked by impact ÷ effort

Scores use H=3, M=2, L=1 for impact and S=1, M=2, L=3 for effort. Ties are broken by how many tools the gap affects.

| # | Gap | Status | Effort | Impact | Evidence |
|---|---|---|---|---|---|
| 1 | Shape Stroke Options: Align, Caps, Corners | MISSING-UI | S | H | `photo/toolBars.tsx:20`; `engine/vector_cmds.rs:1239` |
| 2 | Make: Selection… / Mask / Shape on the Pen tools | MISSING-UI | S | H | `photo/PhotoStudio.tsx:2020` (Path Selection only) |
| 3 | Type font style from the family's real faces | PARTIAL | S | H | `photo/toolBars.tsx:10`; `engine/type_cmds.rs:719-730` |
| 4 | W / link / H on shape tools and Path Selection | MISSING-UI | S | M | `engine/vector_cmds.rs:1257` |
| 5 | Shape gear constraints (Square / Fixed Size / Proportional / From Center) | MISSING-UI | S | M | `photo/selectionGesture.ts:19-39` |
| 6 | Move: Align To Selection / Canvas | MISSING-UI | S | M | `photo/PhotoStudio.tsx:2012`; `engine/layer_multi_cmds.rs:752` |
| 7 | Path operations in Pen Path mode | PARTIAL | S | M | `photo/PhotoStudio.tsx:1128`, `:1132`; `engine/vector_cmds.rs:1305` |
| 8 | Path Selection: path ops on the selected component, and Merge | MISSING-UI | S | M | `engine/vector_cmds.rs:1257` |
| 9 | Rectangle per-corner radii | MISSING-UI | S | M | `photo/PhotoStudio.tsx:1077`; `engine/vector_cmds.rs:1247` |
| 10 | Free Transform ↔ Warp switch on the bar | MISSING-UI | S | M | `photo/FreeTransformBar.tsx:18-29` |
| 11 | Select and Mask: Invert | MISSING-UI | S | M | `engine/selection_cmds.rs:306` |
| 12 | Type: Cancel / Commit on the bar | MISSING-UI | S | M | `photo/toolBars.tsx:32-43` |
| 13 | Type: Character / Paragraph panel toggle | MISSING-UI | S | M | `photo/toolBars.tsx:32-43` |
| 14 | Freeform Pen: Curve Fit | MISSING-UI | S | M | `photo/PhotoStudio.tsx:1067` |
| 15 | Select and Mask: Select Subject inside the dialog | MISSING-UI | S | M | `engine/smartselect_cmds.rs:245` |

Next by score:

- Pen Rubber Band (S/M).
- Three H-impact gaps at M effort:
  - shape Fill type: No Color / own colour / Gradient / Pattern (`photo/toolBars.tsx:47`, `engine/vector_cmds.rs:1240`);
  - stroke dash presets and More Options (`engine/vector_cmds.rs:1239`);
  - Pen Auto Add/Delete (`photo/PathEditOverlay.tsx:1-63`).

The most valuable gaps that need engine work: Magic Wand Sample Size, Object Selection Hard Edge, Line arrowheads, Triangle and Polygon corner radius, and Select and Mask Object Aware / Refine Hair.
