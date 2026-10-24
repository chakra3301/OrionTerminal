# XDesign image editor: menu audit vs Photoshop 2026

> Audit of 2026-10-22, before that day's interaction fixes. `file:line` references are as of the audit and drift. Statements the fixes made stale are marked **[resolved 2026-10-22]**; the consolidated spec is [../photoshop-parity.md](../photoshop-parity.md).

Conventions. `PS` = `src/apps/xdesign/photo/PhotoStudio.tsx`, `EC` = `src/apps/xdesign/EditorChrome.tsx`, `ECSS` = `src/apps/xdesign/editorChrome.css`, `PCSS` = `src/apps/xdesign/photo/photoshop.css`. `MS` = `/tmp/ps_ref/menu_strings.txt`, `SC` = `/tmp/ps_ref/shortcuts.txt`. `Cat` = `docs/architecture/xdesign/photocraft-commands.json` ("host" = `hostDispatch:true`, runnable through `runPhotoCommand`). Item order, separators and anything not in MS/SC are `(from memory)`. Glyph order on Mac: ⌃ ⌥ ⇧ ⌘ then key. Status: ok / relabel / move / missing (= missing-but-capability-exists) / extra / shortcut-wrong.

## 1. Summary

1. No **File** and no **Type** menu. Place, Save and Export sit in Image (PS:663). `type.*` commands (host) have no menu.
2. **Edit** has no Undo/Redo (icon buttons only, PS:681), Clear, Free Transform, Transform submenu or Paste Special submenu. Labels are non-PS ("Copy pixels", "Paste in place").
3. **Image** has no Mode submenu (flat "Mode: RGB Color"), no Adjustments submenu, and no Image Size / Canvas Size / Crop / Trim / Reveal All / Apply Image / Calculations (these exist only as Document-panel buttons, PS:830-832). It holds File items and extras (Perspective Crop, Make independent).
4. **Layer** is flat. Missing: Layer Style, Layer Mask, New Fill/Adjustment Layer, Smart Objects, Rasterize, Align/Distribute, Matting, Rename, Hide Layers, Merge Down, Create Clipping Mask. Arrange is not a submenu, and "Lock All" is not "Lock Layers…".
5. **Filter** is a search box plus accordions inside a dropdown (PS:676, FilterBrowser.tsx:8-22) with non-PS categories ("Recent", "Gallery"). PS has Last Filter, Filter Gallery…, Liquify… and category submenus.
6. **No shortcut column.** About 25 PS shortcuts for existing features are not wired (list in 2.10), and ⇧⌘S is wrong (Export instead of Save As).
7. **Menu widget:** single-level dropdown, no submenus, no hover-to-switch, no ←/→, no type-ahead, no ARIA menu roles (EC:129-156).
8. **No context menus and no panel ≡ flyout menus** exist (no `onContextMenu` in `photo/*.tsx`).
9. **Window** is close to PS (alphabetical, checkmarks) but lists the non-PS "Document" panel, and choosing a checked panel does not close it (PS:367-372).
10. An options-bar "Select" dropdown duplicates menu items (PS:693).

## 2. Menu bar spec

**2.0 Top level.** Target: File, Edit, Image, Layer, Type, Select, Filter, View, Window (Help, Plugins, 3D skipped). XDesign has Edit, Image, Layer, Select, Filter, View, Window (PS:662-678): add File and Type. Ignore `&` mnemonics (Mac shows none). The home button (PS:660) is not a menu; keep it.

### 2.1 File (new)
Target: New… ⌘N | Open… ⌘O | Close ⌘W | Save ⌘S | Save As… ⇧⌘S | Export ▸ (Export As… ⌥⇧⌘W) | Place Embedded… | Place Linked…. Only include items the editor can reach (Open Question 1).

| Item | Status | XDesign |
|---|---|---|
| Place Embedded…, Place Linked… | move | in Image, PS:663. Labels match MS `File/PlaceEmbedded`, `PlaceLinked` |
| Save ⌘S | move, relabel | "Save to <file>" in Image, PS:663; ⌘S wired at PS:641 |
| Export As… ⌥⇧⌘W | move, relabel, shortcut-wrong | "Export image" in Image, PS:663; ⇧⌘S is wired to Export (PS:641) but SC says ⇧⌘S = Save As… |
| New…, Open…, Close | missing | `file.new` is a workspace adapter (Cat). `file.close`, `saveACopy`, `revert` are pending, so skip them |
| Make independent | extra | PS:663; no PS equivalent. Move to Layer > Smart Objects or drop |

### 2.2 Edit
Target: Undo ⌘Z | Redo ⇧⌘Z | Cut ⌘X | Copy ⌘C | Copy Merged ⇧⌘C | Paste ⌘V | Paste Special ▸ (Paste in Place ⇧⌘V, Paste Into ⌥⇧⌘V, Paste Outside) | Clear | Fill… ⇧F5 | Stroke… | Content-Aware Scale ⌥⇧⌘C | Puppet Warp | Perspective Warp | Free Transform ⌘T | Transform ▸ | Define Brush Preset… | Color Settings… ⇧⌘K | Assign Profile… | Convert to Profile…. Separators between those groups `(from memory)`. Toggle Last State and Fade are pending in Cat, so skip.

| Item | Status | XDesign (PS:662) |
|---|---|---|
| Undo / Redo | missing | icon buttons PS:681; keys at PS:640. Disable by `canUndo/canRedo` |
| Copy pixels, Cut pixels, Paste pixels, Copy merged | relabel, reorder | to Cut, Copy, Copy Merged, Paste (MS `Edit/Cut`, `Copy`, `CopyMerged`, `Paste`). PS puts Cut first. ⌘X/⌘C/⇧⌘C/⌘V are wired (PS:631) |
| Paste in place / into selection / outside selection | move, relabel | into Paste Special ▸: "Paste in Place", "Paste Into", "Paste Outside" (MS `PasteSpecial`, `PasteInPlaceRel`, `PasteInto`, `PasteOutside`). ⌥⇧⌘V is not wired |
| Clear | missing | `edit.clear` host; Delete key at PS:649 |
| Fill… | ok | Shift+F5 not wired |
| Stroke… | ok | |
| Content-Aware Scale… | relabel | PS shows no ellipsis (MS `Layer/FluidTransform`); add ⌥⇧⌘C (SC) |
| Puppet Warp, Perspective Warp | missing | `openGeometry` in Properties panel, PS:819 |
| Free Transform | missing | ⌘T wired PS:648. MS `Default/FreeTransform` |
| Transform ▸ | missing | MS `Transform/*`: Again ⇧⌘T, Scale, Rotate, Skew, Distort, Perspective, Warp, then Rotate 180°, Rotate 90° Clockwise, Rotate 90° Counter Clockwise, Flip Horizontal, Flip Vertical. Host: `edit.transform.*` |
| Define Brush Preset… | missing | `brush.defineFromSelection` host |
| Color Settings…, Assign Profile…, Convert to Profile… | missing | non-pending in Cat; UI is the Document panel, PS:833 |

### 2.3 Image
Target: Mode ▸ | Adjustments ▸ | Auto Tone ⇧⌘L, Auto Contrast ⌥⇧⌘L, Auto Color ⇧⌘B | Image Size… ⌥⌘I, Canvas Size… ⌥⌘C, Image Rotation ▸, Crop, Trim…, Reveal All | Apply Image…, Calculations…. (`image.duplicate` is pending: skip Duplicate….)

| Item | Status | XDesign (PS:663-666) |
|---|---|---|
| Mode ▸ | relabel, restructure | flat "Mode: RGB Color" etc. and "8 Bits/Channel". Target: RGB Color, Grayscale, CMYK Color, Lab Color, then 8/16/32 Bits/Channel (MS `Mode/*`). Keep the checkmarks |
| Adjustments ▸ | missing | `image.adjustments.*` are host; today only adjustment layers via the Adjustments panel (controls.ts:7). See below |
| Auto Tone/Contrast/Color | ok | labels match MS; add shortcuts |
| Shadows/Highlights…, Replace Color…, Match Color…, Desaturate, Equalize | move | into Adjustments ▸ |
| Image Size…, Canvas Size…, Crop, Trim…, Reveal All | missing | Document-panel buttons PS:830; `image.crop`, `image.trim`, `image.revealAll` host. SC: Image Size ⌥⌘I, Canvas Size ⌥⌘C, Reveal All ⌥⇧⌘X |
| Image Rotation ▸ | relabel, restructure | flat "Rotate 180°", "Rotate 90° Clockwise"… use the Edit > Transform wording. Target (from memory): 180°, 90° Clockwise, 90° Counter Clockwise, Arbitrary…, then Flip Canvas Horizontal, Flip Canvas Vertical. `image.rotation.arbitrary` is non-pending |
| Apply Image…, Calculations… | missing | PS:832; MS `Image/ApplyImage`, `Calculations` |
| Place…, Save to…, Export image | move | to File |
| Perspective Crop… | extra | a Crop-tool variant in PS, not a menu item (PS:663) |

**Adjustments ▸ target** (from memory): Brightness/Contrast…, Levels… ⌘L, Curves… ⌘M, Exposure… | Vibrance…, Hue/Saturation… ⌘U, Color Balance… ⌘B, Black & White… ⌥⇧⌘B, Photo Filter…, Channel Mixer…, Color Lookup… | Invert ⌘I, Posterize…, Threshold…, Gradient Map…, Selective Color… | Shadows/Highlights…, HDR Toning… | Desaturate ⇧⌘U, Match Color…, Replace Color…, Equalize. Wording per MS `Adjust/*`. XDesign's list labels "Brightness / Contrast", "Hue / Saturation" (controls.ts:8,14) have spaces around "/" that MS lacks: relabel.

### 2.4 Layer
Target (from memory): New ▸ | Duplicate Layer… | Delete ▸ | Rename Layer… | Layer Style ▸ | New Fill Layer ▸ | New Adjustment Layer ▸ | Layer Content Options… | Layer Mask ▸ | Vector Mask ▸ | Create Clipping Mask ⌥⌘G | Smart Objects ▸ | Rasterize ▸ | Group Layers ⌘G | Ungroup Layers ⇧⌘G | Hide Layers ⌘, | Arrange ▸ | Align ▸ | Distribute ▸ | Lock Layers… ⌘/ | Link Layers | Select Linked Layers | Merge Layers ⌘E | Merge Visible ⇧⌘E | Flatten Image | Matting ▸.

| Item | Status | XDesign (PS:667-671) |
|---|---|---|
| New Layer; Layer via Copy; Layer via Cut | move, relabel | into New ▸: Layer… ⇧⌘N, Layer from Background…, Group…, Group from Layers…, Layer via Copy ⌘J, Layer via Cut ⇧⌘J. ⇧⌘N not wired |
| Duplicate Layers | relabel | "Duplicate Layer…" (MS `DuplicateLayer`) |
| Delete Layers | relabel, move | Delete ▸ Layer / Hidden Layers (MS `Delete/*`; `layer.delete.hiddenLayers`) |
| Group Layers, Ungroup Layers | ok | add ⌘G / ⇧⌘G display (wired PS:647, PS:89) |
| Link / Unlink Layers | relabel | PS shows "Link Layers" or "Unlink Layers" depending on state (MS `LinkSelectedLayers`, `UnlinkSelectedLayers`). Add Select Linked Layers |
| Lock All / Unlock Layer | relabel | "Lock Layers…" ⌘/ opening a dialog (SC) |
| Bring to Front/Forward, Send Backward/to Back | move | into Arrange ▸ with ⇧⌘] ⌘] ⌘[ ⇧⌘[ (SC); add Reverse (`layer.arrange.reverse`). None wired |
| Merge Layers, Merge Visible, Flatten Image | ok | ⌘E / ⇧⌘E wired. Add Merge Down (`layer.mergeDown`); PS shows "Merge Down" when one layer is selected (MS `MergeDown`) |
| Create / Release Clipping Mask | missing | only "Clip to below" in Properties, PS:819 |
| Layer Style ▸ | missing | MS `LayerEffects/*`: Blending Options…, Drop Shadow…, Inner Shadow…, Outer Glow…, Inner Glow…, Bevel & Emboss…, Satin…, Color Overlay…, Gradient Overlay…, Pattern Overlay…, Stroke…, Copy/Paste/Clear Layer Style, Global Light…, Create Layer, Hide/Show All Effects, Scale Effects…. All in Cat |
| Layer Mask ▸ | missing | MS `LayerMask/*`: Reveal All, Hide All, From Transparency, Reveal/Hide Selection, Delete, Apply, Disable/Enable, Link/Unlink. Buttons at PS:826, 843 |
| New Fill / Adjustment Layer ▸ | missing | `layer.newFillLayer.*`, `layer.newAdjustmentLayer.*`; UI only via Adjustments panel |
| Smart Objects ▸ | missing | `layer.smartObjects.*`; UI is a Properties button, PS:819 |
| Rasterize ▸ | missing | `layer.rasterize.*`; MS `Rasterize/*` |
| Align ▸ / Distribute ▸ | missing | `layer.align.*`, `layer.distribute.*`; MS `Align/*`, `Distribute/*` |
| Rename Layer…, Hide Layers ⌘,, Matting ▸, Layer Content Options…, Vector Mask ▸ | missing | all in Cat (`layer.renameLayer`, `layer.hideLayers`, `layer.matting.*`) |

### 2.5 Type (new)
Target (from memory): Anti-Alias ▸ (None, Sharp, Crisp, Strong, Smooth) | Orientation ▸ (Horizontal, Vertical) | Create Work Path | Convert to Shape | Rasterize Type Layer | Convert to Paragraph Text / Point Text | Warp Text… | Update All Text Layers | Paste Lorem Ipsum. Wording per MS `Type/*`. Cat host: `type.createWorkPath`, `convertToShape`, `rasterizeTypeLayer`, `convertToParagraphText`, `convertToPointText`, `warpText`, `updateAllTextLayers`, `antiAlias.*`, `orientation.*`. Enable only for a text layer (`currentLayer.text`, PS:819). Entire menu is missing; UI today is "Edit text" and the Typography panel (PS:819-822).

### 2.6 Select
Target (from memory): All ⌘A | Deselect ⌘D | Reselect ⇧⌘D | Inverse ⇧⌘I | All Layers ⌥⌘A, Deselect Layers, Find Layers ⌥⇧⌘F, Isolate Layers | Color Range…, Focus Area…, Subject, Sky, Select and Mask… ⌥⌘R | Modify ▸, Grow, Similar | Transform Selection, Edit in Quick Mask Mode | Load Selection…, Save Selection….

| Item | Status | XDesign (PS:672-675) |
|---|---|---|
| All, Deselect, Reselect, Inverse | ok | shortcuts wired (PS:89), not displayed |
| Subject, Color Range…, Focus Area…, Select and Mask… | reorder | PS order is Color Range, Focus Area, Subject, then Sky. Add ⌥⌘R to Select and Mask (SC "Refine Edge…" ⌥⌘R; MS `SelectAndMask`) |
| Sky | missing | `select.sky` host (MS `Select/Sky`) |
| Border… Smooth… Expand… Contract… Feather… | move | flat (PS:674); put in Modify ▸ (MS `Modify/*`). Feather ⇧F6 (SC) |
| Grow, Similar, Transform Selection, Load Selection… | ok | PS:675 |
| Save Selection… | missing | `select.saveSelection`; UI only in Channels footer, PhotoChannels.tsx:30 |
| Edit in Quick Mask Mode | missing | Q key PS:650, button PS:731. Checkmark from `state.quickMask` |
| All Layers, Deselect Layers, Find Layers, Isolate Layers | missing | host in Cat |
| Options-bar "Select" dropdown | extra | PS:693 |

### 2.7 Filter
Target (from memory): Last Filter ⌃⌘F (SC) | Convert for Smart Filters (MS `Filter/NewSmartObject`) | Filter Gallery… | Lens Correction… ⇧⌘R | Liquify… ⇧⌘X | Blur ▸ | Blur Gallery ▸ | Distort ▸ | Noise ▸ | Pixelate ▸ | Render ▸ | Sharpen ▸ | Stylize ▸ | Video ▸ | Other ▸.

| Item | Status | XDesign |
|---|---|---|
| Whole menu | restructure | accordions inside a dropdown (PS:676, FilterBrowser.tsx:8-22, PCSS:141-146). Replace with real submenus. Keep the search in the Command Browser (PS:852) |
| Liquify | relabel | "Liquify…" ⇧⌘X (SC) |
| Develop image | unverified | closest PS item is "Camera Raw Filter…" ⇧⌘A (SC); otherwise extra |
| Recent category | move, relabel | `filter.lastFilter` in "Recent" (controls.ts:62): top-level "Last Filter", disabled until a filter has run |
| Gallery category | move, relabel | `filter.filterGallery` (galleryFilters.ts:53): top-level "Filter Gallery…" |
| Categories | relabel | XDesign has Blur, Sharpen, Noise, Recent, Distort, Blur Gallery, Pixelate, Render, Stylize, Video, Gallery, Other. Use only the PS names above |
| Item labels | relabel | dialog-opening filters get "…" (PS:676 passes none) |
| Convert for Smart Filters | missing | `layer.smartObjects.convertToSmartObject` |

### 2.8 View
Target: Proof Setup ▸ | Proof Colors ⌘Y | Gamut Warning ⇧⌘Y | Zoom In ⌘+ | Zoom Out ⌘- | Fit on Screen ⌘0 | 100% ⌘1 | 200%. Extras/Show/Rulers/Snap/Guides/Grid are skipped: XDesign has none.

| Item | Status | XDesign (PS:677) |
|---|---|---|
| Zoom In, Zoom Out, Fit on Screen, 100%, 200% | reorder | PS lists proof items first. Labels match MS. ⌘+/⌘=, ⌘-, ⌘0, ⌘1 wired (PS:624), not displayed. SC also has ⌥⌘0 = 100% |
| Proof Colors, Gamut Warning | ok | checkmarks via `aria-current`; ⌘Y/⇧⌘Y wired (PS:646) |
| Proof Setup | missing | `view.proofSetup` non-pending (MS `View/ProofSetup`) |

### 2.9 Window
Target: alphabetical panel list with checkmarks. XDesign panels: Adjustments, Brushes, Channels, Gradients, History, Layers, Navigator, Patterns, Paths, Properties, Shapes, Styles, Swatches, Tool Presets (all in MS `Window/*`).

| Item | Status | XDesign |
|---|---|---|
| Panel list and checkmarks | ok | `ALL_PANELS` sorted (PS:77); `aria-current` (PS:678) |
| Document | extra | PS:74; not a PS panel. Drop from the menu or fold into Properties |
| Click on checked panel | wrong | `openPanel` only opens (PS:367-372); PS closes it |
| Brushes | unverified | MS has "Brushes" and "Brush Settings"; XDesign's one panel (PS:800) is a mix |

### 2.10 Shortcuts
Wired: ⌘A ⌘D ⇧⌘D ⇧⌘I ⌘J ⇧⌘J ⌘E ⇧⌘E ⇧⌘G (PS:89, PS:642), ⌘G ⌘T (PS:647-648), ⌘Z ⇧⌘Z, ⌘S, clipboard keys (PS:631), ⌘Y ⇧⌘Y, zoom keys (PS:624), Delete, Q, X, D.
- shortcut-wrong: ⇧⌘S exports (SC: Save As…). ⌘E always does Merge Layers (PS: Merge Down for one layer).
- Not wired but in SC with a working command: ⇧F5, ⇧⌘N, ⌥⌘G, ⌘[ ⌘] ⇧⌘[ ⇧⌘], ⌘, , ⌘/, ⌥⌘A, ⌥⇧⌘F, ⌥⌘R, ⇧F6, ⇧⌘T, ⌥⇧⌘V, ⌥⌘I, ⌥⌘C, ⇧⌘L, ⌥⇧⌘L, ⇧⌘B, ⌘L, ⌘M, ⌘U, ⌘B, ⌘I, ⇧⌘U, ⌥⇧⌘B, ⇧⌘X, ⌃⌘F, ⌥⇧⌘C, ⇧⌘K.
- Implementation: generate both the key handler and the displayed glyphs from one table (extend `MENU_SHORTCUTS`, PS:89).

## 3. Context and flyout menus

XDesign has none. No `onContextMenu` in `src/apps/xdesign/photo/*.tsx`, no ≡ buttons in panel headers. The "flyout" (PS:797, `.xd-ps-flyout`) is a collapsed-panel popout, not a menu. Canvas and layer right-click behaviour today is unverified (probably the WebView default).

| Menu | Target items (MS strings unless noted) | Status |
|---|---|---|
| Layer row, pixel layer (`PixelLayerContext`, `LayersPaletteDefaultContext`) | Blending Options…, Rename Layer…, Duplicate Layer…, Delete Layer, Convert to Smart Object, Rasterize Layer, Create Clipping Mask, Link Layers, Select Linked Layers, Hide Layers, Merge Layers, Merge Visible, Flatten Image, New Group from Layers…, Copy/Paste/Clear Layer Style, Enable Layer Mask | missing |
| Layer row, group (`GroupLayerContext`) | New Group from Layers…, Ungroup Layers, Duplicate Layer…, Delete Layer, Blending Options…, Merge Layers | missing |
| Layer row, smart object (`SmartObjectLayerContext`) | Edit Contents, Replace Contents…, Export Contents…, Update Modified Content, Relink to File…, Convert to Layers, Rasterize Layer | missing |
| Layer row, type layer | Rasterize Type, Convert to Shape, Create Work Path, Warp Text… | missing (contents from memory) |
| Layers panel ≡ | New Layer…, New Group…, Duplicate Layer…, Delete Layer, Merge Down/Layers, Merge Visible, Flatten Image | missing; the bottom icon row (PS:843) stays |
| Channels ≡ | New Channel…, Duplicate Channel…, Delete Channel, New Spot Channel…, Merge Spot Channel, Split Channels, Merge Channels…, Channel Options… (Cat `channel.*`) | missing; buttons in PhotoChannels.tsx |
| Paths ≡ and Pen right-click (`Context/PenTool/*`) | Make Selection…, Fill Path…, Stroke Path…, Delete Path, Add/Delete Anchor Point, Create Vector Mask | missing; buttons in PhotoPaths.tsx |
| History ≡ | Step Forward, Step Backward (MS `Edit/StepForward`, `StepBackward`) | missing |
| Swatches / Gradients / Patterns / Brushes / Shapes ≡ | New…, Rename…, Delete, Import… (`ContextMenu/Gradients/*`, `Patterns/*`, `CustomShapes/*`) | missing; PresetPanels.tsx |
| Canvas, selection tools | Deselect, Select Inverse, Free Transform, Fill…, Stroke…, Layer via Copy/Cut (MS `ContextMenu/Deselect`, `SelectInverse`; rest from memory) | missing |
| Canvas, Crop tool (`Context/Crop/*`) | Crop, Cancel, Clear, Use Crop Box Aspect Ratio | missing; Enter/Esc handled at PS:622 |
| Canvas, Patch tool (`Context/PatchTool/*`) | Use Patch as Source, Use Patch as Destination, Load Selection… | missing |

## 4. Menu look and behaviour spec

Photoshop macOS values are `(from memory)`; the live app was not inspected.

| Aspect | Photoshop (macOS) | XDesign now | Spec / gap |
|---|---|---|---|
| Open and switch | click opens; with one open, hovering another title switches | each `EditorMenu` has its own state; click toggles only (EC:129-156) | shared `openIndex` in a MenuBar parent; hover-switch while open |
| Title content | text only | `Icon` + `ChevronDown` rendered, hidden by CSS (PCSS:14) | drop the icon prop |
| Bar | ~24px, 13px SF | min-height 30px, 12px (PCSS:10,13) | font 13px; height may stay 30px |
| Item row | ~22px, 13px | padding 4px, 12px (PCSS:16) | `height:22px; font-size:13px` |
| Row layout | check gutter ~14px, label, right-aligned shortcut, submenu arrow | label only; check is `::before` with `margin-left:-8px` (PCSS:18) | grid `[14px check][1fr label][auto shortcut][12px arrow]`, gutter on every row |
| Shortcut column | glyphs `⇧⌘Z`, `F5`, in secondary colour | none | render from one table, order ⌃⌥⇧⌘, colour `--xd-text-2` |
| Separator | 1px hairline, ~5px margin | `hr` 1px, margin 5px 8px (ECSS:23) | ok |
| Submenus | ▸ at right, open on hover (~200ms) or →, close on ← or Esc | none | nested Submenu component |
| Highlight | full-width accent fill, white text | `--xd-accent` bg (PCSS:17); dark theme `#0d99ff` (tokens.css:7184) | ok in dark; light-theme contrast unverified (lightThemes.css:59) |
| Disabled | dimmed, still visible | opacity .5 (ECSS:22); some items hidden by condition (`Make independent`, `Save to…`, PS:663) | show them disabled |
| Checkmark | ✓ gutter | `aria-current` + `::before` | `aria-checked` on `menuitemcheckbox/radio` |
| Keyboard | ↑↓ wrap, ←→ switch menu or submenu, Enter, Esc, type-ahead | ↑↓ Home End Esc only (EC:145-151) | add ←→, Enter, type-ahead |
| ARIA | NSMenu | plain `button`s (EC:153-154) | `role=menubar/menu/menuitem`, `aria-haspopup`, `aria-expanded` |
| Overflow | menus don't scroll | `max-height:min(70vh,640px); overflow-y:auto` (ECSS:19) | drop except for tall Filter submenus |
| Width | content-fit | `min-width:240px` (PCSS:140) | content-fit, min ~200px |
| Native menubar | n/a | in-app, tokens `--xd-panel`, `--xd-border`, `--r-sm` | keep |

## 5. Open questions

1. File menu scope: which of New/Open/Close can the editor reach? `file.new` is a workspace adapter and `file.close` is pending (Cat).
2. Order and separator positions for every PS menu are from memory (MS has no ordering).
3. Is "Develop image" the Camera Raw Filter? Does XDesign's "Brushes" panel correspond to Brushes or Brush Settings?
4. PS disabled-state rules (Reselect, Filter on text layers, Merge Down vs Merge Layers) are from memory. Cat `hostDispatch` says an action is runnable, not when it should be enabled.
5. Real canvas and layer right-click behaviour today: not run.
6. Light-theme highlight contrast: not computed.
7. "Capability exists" means Cat `integration != pending` and `hostDispatch:true`. The catalog's own `auditNote` says smoke tests do not prove parity, so spot-check Smart Objects, Matting, Align/Distribute, Rasterize and Layer Style before wiring them.
8. Cat lists `filter.lastFilter` as ⌥⌘F; SC lists ⌃⌘F for Last Filter. The spec follows SC.
