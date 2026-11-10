# XDesign vs Photoshop 2026: Image › Adjustments control depth

Audit date: 2026-10-28. This is a read-only audit. No repo file was edited, and Photoshop and .psd files were not touched.

## Method and conventions

- **XDesign evidence** paths are relative to `/Users/lucaorion/Orion_Terminal/src/apps/xdesign/photo/` unless prefixed.
  - `host:` means `/Users/lucaorion/Orion_Terminal/src-tauri/src/`.
  - `eng:` means the photocraft engine checkout at `~/.cargo/git/checkouts/photocraft-58992417ad0aec0a/47f9306/crates/`.
- **Host gate.** `command_supported()` (host:xdesign_photo.rs:798-830) passes every `image.*` and `layer.*` command. It does not hide any adjustment.
- **UI structure.** One renderer, `AdjustmentControls` (actionControls.tsx), serves both forms:
  - the modal dialog, `PhotoActionDialog`;
  - the adjustment-layer Properties panel, `AdjustmentProperties`.
  - The dialog passes a `toolSlot` (its button column) only for Levels, Curves, Brightness/Contrast, Exposure and Black & White. Some controls render only into that slot, so they do not exist in Properties.
- **Status values:**
  - **PRESENT**: matches Photoshop's control.
  - **PARTIAL**: the control exists but is limited or deviates.
  - **MISSING-UI**: the engine (or existing client maths) already accepts the parameter, so only UI work is needed.
  - **MISSING**: needs engine or algorithm work.
- **Effort:** S < 1 day, M = 1-3 days, L > 3 days.
- **Impact:** H/M/L for a working photo designer.
- **Photoshop reference.** helpx.adobe.com answered HTTP 403 to both WebFetch and curl. So the Photoshop side comes from:
  - helpx text quoted in search-engine extracts;
  - older official Adobe manuals (CS3/CS4);
  - third-party references, where named.
  - Anything none of these settles is marked **unverified**.
- **Out of scope:** cloud, AI and generative features, video, 3D, Libraries, and visual styling.

## Headline

159 Photoshop controls were audited across 25 sections (one shared section plus 24 command sections).

| Status | Count | Share |
|---|---|---|
| PRESENT | 112 | **70.4 %** |
| PARTIAL | 16 | 10.1 % |
| MISSING-UI | 17 | 10.7 % |
| MISSING | 14 | 8.8 % |

The counts are unweighted. A slider and a whole tone-mapping method each count as one control.

The 24 core per-pixel adjustment-layer kinds score about 88 %. These are Brightness/Contrast, Levels, Curves, Exposure, Vibrance, Hue/Saturation, Color Balance, Black & White, Photo Filter, Channel Mixer, Gradient Map, Selective Color, Invert, Posterize and Threshold. The gaps cluster in four places:

- the destructive dialogs (HDR Toning, Replace Color, Match Color);
- Color Lookup's non-LUT modes;
- the Auto Color Correction Options;
- the controls that exist only in the dialog's button column and so are absent in Properties.

---

## 0. Shared: dialog and Properties shell

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Preview checkbox (dialog) | PRESENT | PhotoActionDialog.tsx:128 | n/a | - | - |
| Built-in preset menu (Levels 8, Curves 9, Exposure 4, Hue/Sat 8, Channel Mixer 6, B&W 12) | PRESENT. Names match Photoshop's lists | adjustmentSettings.ts:22-56 | params only | - | - |
| Save Preset… / Load Preset… in Photoshop binary formats (.alv .acv .eap .ahu .blw .cha .asv) | PRESENT | adjustmentPresetFiles.ts:7-15; AdjustmentPresetRow.tsx:28-36,44-46 | n/a | - | - |
| User-saved presets listed in the Preset menu | MISSING-UI. Save writes a file anywhere, and the menu shows only built-ins plus Default/Custom | AdjustmentPresetRow.tsx:22-24,40-41 | n/a (needs a presets folder and enumeration over IPC) | M | M |
| Delete Current Preset | MISSING-UI (disabled) | AdjustmentPresetRow.tsx:45 | n/a | S | L |
| Clip to layer below | PRESENT | AdjustmentProperties.tsx:124 | yes | - | - |
| View previous state | PRESENT | AdjustmentProperties.tsx:125 | yes | - | - |
| Reset to adjustment defaults | PRESENT | AdjustmentProperties.tsx:116-129; PhotoActionDialog.tsx:128 | yes | - | - |
| Toggle layer visibility | PRESENT | AdjustmentProperties.tsx:116-129 | yes | - | - |
| Delete adjustment layer | PRESENT | AdjustmentProperties.tsx:116-129 | yes | - | - |

## 1. Brightness/Contrast

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Brightness -150..+150, default 0 | PRESENT | controls.ts:10 | eng:engine/src/adjust_params.rs:90 | - | - |
| Contrast -50..+100, default 0 | PRESENT | controls.ts:10 | adjust_params.rs:89-90 | - | - |
| Use Legacy | PARTIAL. The UI caps legacy Contrast at 99 although the engine accepts 100. Brightness stays ±150 in legacy, while a forum report says Photoshop's legacy Brightness is ±100 (unverified) | actionControls.tsx:129 | adjust_params.rs:88-89 (legacy -100..100) | S | L |
| Auto (dialog) | PRESENT. Solved client-side from the luminosity histogram | psAdjustControls.tsx:48-52; psAdjustMath.ts:8-17 | engine has no auto B/C (psAdjustMath.ts:8-9) | - | - |
| Auto (Properties) | MISSING-UI. `AutoBrightnessContrast` returns null without `toolSlot`. Whether Photoshop 2026's Properties panel has Auto is unverified | actionControls.tsx:129; psAdjustControls.tsx:49-51 | client maths exists | S | M |

## 2. Levels

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Preset menu (8 built-ins) | PRESENT | adjustmentSettings.ts:22-56 | params | - | - |
| Channel menu (RGB/R/G/B; CMYK; Lab; Gray) | PRESENT | actionControls.tsx:89-96 | adjust_params.rs:412-450 | - | - |
| Histogram | PRESENT | toneControls.tsx:101-122 | host invoke `xdesign_photo_histogram` | - | - |
| Input Black 0..253, Gamma 0.01..9.99, White 2..255 (sliders and fields) | PRESENT | controls.ts:11; toneControls.tsx:101-122 | adjust_params.rs:435-440 | - | - |
| Output Black/White 0..255 | PRESENT | controls.ts:11 | adjust_params.rs:441-442 | - | - |
| Black/gray/white eyedroppers (dialog and Properties) | PARTIAL. Works only in RGB documents in the Tauri build (`sampling = rgb && …`). In CMYK and Lab they are disabled | ToneTools.tsx:52,76,87-88,103 | sampling via host invoke `xdesign_photo_sample` | M | M |
| Double-click an eyedropper to set its target colour | MISSING-UI. Targets can be set only in Auto Options | ToneTools.tsx:76,122-126 | client (toneSampler.ts:38-57 already uses targets) | S | L |
| Auto | PRESENT. RGB uses client autoPatch; other modes use a channel auto range | ToneTools.tsx:64-73; toneSampler.ts:68-83; actionControls.tsx:93 | client maths | - | - |
| Options… (dialog button; Alt-click Auto in both forms) | PRESENT. The dialog's own defects are in section 24 | ToneTools.tsx:70-71,103 | - | - | - |
| Alt-drag black/white input to show clipping | PRESENT (RGB and Gray only) | ToneTools.tsx:44-47,105; toneControls.tsx:101-122 | client | - | - |

## 3. Curves

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Preset menu (9 built-ins) | PRESENT | adjustmentSettings.ts:22-56 | params | - | - |
| Channel menu | PRESENT | actionControls.tsx:89-96 | adjust_params.rs:508-531 | - | - |
| Edit points mode | PRESENT | ToneTools.tsx:79-82 | - | - | - |
| Draw (pencil) mode | PRESENT. Refitted to points | ToneTools.tsx:79-82; curveTools.ts:42-55 | engine stores points only | - | - |
| Smooth | PRESENT | ToneTools.tsx:77; curveTools.ts:63 | - | - | - |
| On-image adjustment tool | PRESENT (RGB, Tauri) | ToneTools.tsx:55-63 | - | - | - |
| Black/gray/white eyedroppers | PARTIAL. RGB only, as in Levels | ToneTools.tsx:52,76 | host sample | M | M |
| Double-click eyedropper to set its target colour | MISSING-UI | ToneTools.tsx:76 | client | S | L |
| Auto | PRESENT | ToneTools.tsx:64-73 | client | - | - |
| Options… | PRESENT (see section 24) | ToneTools.tsx:103 | - | - | - |
| Show Clipping checkbox | PARTIAL. Dialog only; the checkbox is rendered only in the slot aside. Alt-drag still works in Properties | ToneTools.tsx:85-86 | client | S | L |
| Curve Display Options in the dialog: Light (0-255) or Pigment/Ink %, simple or detailed grid, Channel Overlays, Histogram, Baseline, Intersection Line | PRESENT | ToneTools.tsx:90-102; curveTools.ts:5 | - | - | - |
| Curve Display Options in Properties (Photoshop has them in the panel menu) | MISSING-UI. The show flags persist from the dialog, but Light/Pigment cannot be switched in Properties | ToneTools.tsx:43,90 (only when `slot`) | - | S | M |
| Input/Output fields | PRESENT | toneControls.tsx:149-279 | - | - | - |
| Black/white point sliders under the graph | PRESENT | toneControls.tsx:149-279 | - | - | - |
| Point limit | PARTIAL. XDesign allows 19 points in total. Photoshop allows 16: 14 control points plus 2 endpoints (CS3/CS4 manuals and Photofocus; unverified for 2026). .acv round-trip with more than 16 points is unverified | curveTools.ts:42-43; toneSampler.ts:60-63; toneControls.tsx:149 | engine keeps 2-19 | S | L |
| Arrow-key nudging and point deletion | PRESENT | toneControls.tsx:257 | - | - | - |

## 4. Exposure

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Preset menu (Minus 1.0/2.0, Plus 1.0/2.0) | PRESENT | adjustmentSettings.ts:22-56 | params | - | - |
| Exposure -20..+20 | PRESENT | controls.ts:13 | adjust_params.rs:111 | - | - |
| Offset -0.5..+0.5 | PRESENT | controls.ts:13 | adjust_params.rs:111 | - | - |
| Gamma Correction 0.01..9.99, default 1.00 | PRESENT | controls.ts:13,79 | adjust_params.rs:111 | - | - |
| Black (Offset), gray and white (Exposure) eyedroppers in the dialog | PRESENT | psAdjustControls.tsx:33-41 | client | - | - |
| Eyedroppers in Properties | MISSING-UI. The slot-only portal returns null. Whether Photoshop's Properties panel has them is unverified | actionControls.tsx:129; psAdjustControls.tsx:39 | client | S | L |

## 5. Vibrance

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Vibrance -100..+100 | PRESENT | controls.ts:14 | adjust_params.rs:118 | - | - |
| Saturation -100..+100 | PRESENT | controls.ts:14 | adjust_params.rs:118 | - | - |

## 6. Hue/Saturation

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Preset menu (8 built-ins) | PRESENT | adjustmentSettings.ts:22-56 | params | - | - |
| Edit range (Master, Reds…Magentas) | PRESENT | hueSaturationControls.tsx:85 | adjust_params.rs:20,396-405 | - | - |
| Hue ±180 | PRESENT | controls.ts:15 | adjust_params.rs:393 | - | - |
| Saturation ±100 | PRESENT | controls.ts:15 | adjust_params.rs:394 | - | - |
| Lightness ±100 | PRESENT | controls.ts:15 | adjust_params.rs:394 | - | - |
| Colorize (Hue 0..360, Saturation 0..100) | PRESENT | actionControls.tsx:115 | adjust_params.rs:391-394 | - | - |
| Colorize takes its hue from the foreground colour (red if the foreground is black or white). Adobe Elements and older Photoshop help say so; the starting Saturation of 25 is unverified | MISSING-UI. Ticking Colorize keeps the current hue and clamps saturation at 0 or above | actionControls.tsx:115 | engine accepts hue and saturation | S | M |
| On-image tool (drag sets saturation, Cmd-drag sets hue) | PRESENT | hueSaturationControls.tsx:70-84 | client | - | - |
| Eyedropper / Add to Sample / Subtract from Sample | PRESENT | hueSaturationControls.tsx:67-97 | adjust_params.rs:401 (range bounds) | - | - |
| Colour bars with 4-handle range and falloff sliders | PRESENT | colorControls.tsx:76-95 | adjust_params.rs:401 | - | - |
| Range readout values | PRESENT | colorControls.tsx:76-95 | - | - | - |

## 7. Color Balance

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Tone: Shadows/Midtones/Highlights | PRESENT | actionControls.tsx:103 | adjust_params.rs:130 | - | - |
| Cyan-Red, Magenta-Green, Yellow-Blue ±100 | PRESENT | controls.ts:17 | adjust_params.rs:123-139 | - | - |
| Preserve Luminosity (on) | PRESENT | actionControls.tsx:109 | adjust_params.rs:139 | - | - |

## 8. Black & White

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Preset menu (12 built-ins) | PRESENT | adjustmentSettings.ts:22-56 | params | - | - |
| Reds 40, Yellows 60, Greens 40, Cyans 60, Blues 20, Magentas 80; each -200..300 % | PRESENT | controls.ts:16 | adjust_params.rs:142-153 | - | - |
| Auto | PRESENT (client-side) | blackWhiteControls.tsx:70-80; psAdjustMath.ts:58 | client | - | - |
| On-image tool | PRESENT | blackWhiteControls.tsx:36-67 | client | - | - |
| Tint checkbox and colour swatch (#e1d3b3, about H42 S20) | PRESENT | blackWhiteControls.tsx:36-67; adjustmentSettings.ts:67-92 | adjust_params.rs:151-152 | - | - |
| Tint Hue/Saturation sliders (dialog only, as in Photoshop) | PRESENT | blackWhiteControls.tsx:36-67 | colour param | - | - |

## 9. Photo Filter

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Filter menu (20 presets, Warming 85 to Underwater) | PRESENT | adjustmentSettings.ts:6-13 | eng adjust_params.rs:28-46 | - | - |
| Color swatch | PRESENT | colorControls.tsx:98-106 | adjust_params.rs:168 | - | - |
| Density, default 25 % | PRESENT. Minimum is 0; Photoshop's minimum of 1 % is unverified | controls.ts:18 | adjust_params.rs:171 (0..100) | - | - |
| Preserve Luminosity (on) | PRESENT | actionControls.tsx:129 | adjust_params.rs:172 | - | - |

## 10. Channel Mixer

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Preset menu (6 built-ins) | PRESENT | adjustmentSettings.ts:22-56 | params | - | - |
| Output Channel | PRESENT | actionControls.tsx:99-108 | adjust_params.rs:185 | - | - |
| Source Red/Green/Blue -200..+200 % | PRESENT | controls.ts:19 | adjust_params.rs:175-193 | - | - |
| Total readout and over-100 % warning | PRESENT | actionControls.tsx:108 | - | - | - |
| Constant -200..+200 % | PRESENT | controls.ts:19 | adjust_params.rs:190 | - | - |
| Monochrome | PRESENT | actionControls.tsx:99-111 | adjust_params.rs:180 | - | - |

## 11. Color Lookup

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| 3DLUT File menu with Photoshop's shipped looks (about 27 per third-party counts; unverified) | PARTIAL. Eight XDesign looks (Warm, Cool, Teal & Orange…) instead of Photoshop's list | controls.ts:69; actionControls.tsx:124 | eng:cms/src/lutfile.rs:219 (BUILTIN has 8) | M | M |
| Load 3D LUT… (.cube, .3dl, .look, .csp) | PARTIAL. No .csp | actionControls.tsx:124 | eng adjust_cmds.rs:70-113 (cube/3dl/look parse) | M | L |
| Abstract profile | MISSING (disabled: "Not supported by the image engine") | actionControls.tsx:125 | none (needs an ICC abstract-profile transform) | L | L |
| Device Link profile | MISSING (disabled) | actionControls.tsx:125 | none | L | L |
| Dither | PRESENT | actionControls.tsx:126 | adjust_cmds.rs:109 | - | - |
| Data Order (RGB/BGR) | MISSING | actionControls.tsx:123-126 | none (adjust_cmds.rs:70-113) | M | L |
| Table Order (RGB/BGR) | MISSING | actionControls.tsx:123-126 | none | M | L |

Interpolation (trilinear/tetrahedral) is an XDesign extra. It is not a Photoshop control and is not counted.

## 12. Invert

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Invert (no controls) | PRESENT | controls.ts:23; actionControls.tsx:129 | adjust_params.rs:82 | - | - |

## 13. Posterize

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Levels 2..255, default 4 | PRESENT | controls.ts:24 | adjust_params.rs:104 | - | - |

## 14. Threshold

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Histogram | PRESENT | toneControls.tsx:125-132; actionControls.tsx:98 | host histogram | - | - |
| Threshold Level 1..255, default 128 | PRESENT | controls.ts:24 | adjust_params.rs:97 | - | - |

## 15. Gradient Map

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Gradient picker with presets | PRESENT | psAdjustControls.tsx:55-60 | stops | - | - |
| Gradient Editor (solid, colour stops) | PRESENT | psAdjustControls.tsx:62-66 | adjust_params.rs:195-204 | - | - |
| Gradient Editor: Noise type | MISSING (option disabled) | GradientEditorDialog.tsx:208 | none | M | L |
| Gradient Editor: Smoothness | MISSING (fixed at 100: "The engine blends stops linearly") | GradientEditorDialog.tsx:209 | none | M | L |
| Dither | PRESENT | actionControls.tsx:120 | adjust_params.rs:204 | - | - |
| Reverse | PRESENT | actionControls.tsx:120 | adjust_params.rs:204 | - | - |
| Method (Perceptual, Linear, Classic, Smooth, Stripes) | PRESENT. Baked client-side into stops | actionControls.tsx:117-120; gradientMethod.ts:3,45,104 | no engine method param; client bake | - | - |

## 16. Selective Color

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Preset Save/Load (.asv) | PRESENT | adjustmentPresetFiles.ts:7-15 | params | - | - |
| Colors menu (Reds…Magentas, Whites, Neutrals, Blacks) | PRESENT | actionControls.tsx:99-111 | adjust_cmds.rs:24,37-64 | - | - |
| Cyan/Magenta/Yellow/Black ±100 % | PRESENT | controls.ts:21 | adjust_cmds.rs:51-60 | - | - |
| Method Relative/Absolute (Relative) | PRESENT | actionControls.tsx:110; adjustmentSettings.ts:67-92 | adjust_cmds.rs:42-47 | - | - |

## 17. Shadows/Highlights (destructive)

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Shadows Amount 35 %, Tone 50 %, Radius 30 px | PRESENT | imageCommands.ts:69 | adjust_cmds.rs:228-241 | - | - |
| Highlights Amount 0 %, Tone 50 %, Radius 30 px | PRESENT | imageCommands.ts:70 | adjust_cmds.rs:228-241 | - | - |
| Color +20 | PRESENT | imageCommands.ts:71 | adjust_cmds.rs:237 | - | - |
| Midtone 0 | PRESENT | imageCommands.ts:71 | adjust_cmds.rs:238 | - | - |
| Black Clip / White Clip 0.01 % | PRESENT | imageCommands.ts:72 | adjust_cmds.rs:239-240 | - | - |
| Show More Options | PRESENT | imageCommands.ts:68 | - | - | - |
| Preview | PRESENT | imageCommands.ts:68 | - | - | - |
| Load…/Save… | PARTIAL. XDesign JSON, not Photoshop's settings file (Photoshop's extension is unverified) | imageCommands.ts:68; ImageDialogs.tsx:113 | n/a | S | L |
| Save Defaults | MISSING-UI | imageCommands.ts:68 | n/a (client store) | S | L |

Photoshop's defaults and ranges for this dialog are unverified against helpx in this session. XDesign matches the engine spec (adjust_cmds.rs:357) and commonly cited Photoshop defaults.

## 18. HDR Toning (destructive, flattens)

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Preset menu (built-in looks; Photoshop's values unverified) | MISSING-UI | imageCommands.ts:91-95 | all parameters accepted (adjust_cmds.rs:301-337) | M | L |
| Load/Save preset | MISSING-UI (no `settingsFile`) | imageCommands.ts:91 | n/a | S | L |
| Method: Local Adaptation / Equalize Histogram / Exposure and Gamma / Highlight Compression | MISSING. Only Local Adaptation exists | imageCommands.ts:91-95 | none: hdr_toning is a single algorithm, adjust_cmds.rs:301-337 | M | M |
| Edge Glow Radius 1..500 px, Strength 0.1..4.0 | PRESENT | imageCommands.ts:92 | adjust_cmds.rs:309-310 | - | - |
| Edge Smoothness checkbox | MISSING | imageCommands.ts:91-95 | none | M | L |
| Gamma 0.1..2.0, Exposure -5..+5, Detail -100..300 % | PRESENT | imageCommands.ts:93 | adjust_cmds.rs:311-313 | - | - |
| Advanced: Shadow, Highlight, Vibrance, Saturation | PRESENT | imageCommands.ts:94 | adjust_cmds.rs:314-317 | - | - |
| Toning Curve and Histogram | MISSING-UI. The engine takes `curve` [[in,out]…] 0..255. Corner points are MISSING (engine) | imageCommands.ts:91-95 | adjust_cmds.rs:303-307 | M | M |
| Preview | MISSING-UI (no `preview` flag; every other destructive dialog has one) | imageCommands.ts:91 | command runs on any doc; preview pipeline exists for siblings | M | M |
| Slider controls | PARTIAL (numeric fields only; no `sliders` flag) | imageCommands.ts:91 | n/a | S | L |

## 19. Desaturate

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Desaturate (no controls, Shift+Cmd+U) | PRESENT | PhotoStudio.tsx:1398 | eng engine/src/commands.rs:722 | - | - |

## 20. Match Color (destructive)

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Ignore Selection when Applying Adjustment | MISSING | imageCommands.ts:78-86 | none. rgba_edit always blends through the selection (adjust_cmds.rs:157-170,292-296) | M | M |
| Luminance 1..200, default 100 | PRESENT | imageCommands.ts:80 | adjust_cmds.rs:273 | - | - |
| Color Intensity 1..200, default 100 | PRESENT | imageCommands.ts:80 | adjust_cmds.rs:274 | - | - |
| Fade 0..100, default 0 | PRESENT | imageCommands.ts:80 | adjust_cmds.rs:275 | - | - |
| Neutralize | PRESENT | imageCommands.ts:81 | adjust_cmds.rs:276 | - | - |
| Use Selection in Source to Calculate Colors | PRESENT | imageCommands.ts:82 | adjust_cmds.rs:282 | - | - |
| Use Selection in Target to Calculate Adjustment | PRESENT. The label reads "…Calculate Colors"; Photoshop's wording is unverified | imageCommands.ts:83 | adjust_cmds.rs:290 | - | - |
| Source (document) | PRESENT | imageCommands.ts:84 | adjust_cmds.rs:278-285 | - | - |
| Layer (source layer, or Merged) | MISSING-UI | imageCommands.ts:84-85 | `sourceLayer` accepted, adjust_cmds.rs:281 | S | M |
| Load Statistics… / Save Statistics… | MISSING | imageCommands.ts:78-86 | none (lab_stats is not serialisable through any command) | M | L |
| Preview | PRESENT | imageCommands.ts:79 | - | - | - |

## 21. Replace Color (destructive)

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Localized Color Clusters | MISSING | ImageDialogs.tsx:105-108 | replace_color has none (adjust_cmds.rs:244-251). select.colorRange already has `localized` (eng selection_cmds.rs:151,339) | M | M |
| Eyedropper | PRESENT | ImageDialogs.tsx:106 | `color` param | - | - |
| Add to Sample / Subtract from Sample eyedroppers | MISSING | ImageDialogs.tsx:106 | replace_color takes one colour. colorRange has `colors[]` and `subtractPoints` | M | H |
| Color swatch | PRESENT | imageCommands.ts:75 | adjust_cmds.rs:245 | - | - |
| Fuzziness 0..200, default 40 | PRESENT | imageCommands.ts:75 | adjust_cmds.rs:246 | - | - |
| Range (with Localized Color Clusters) | MISSING | - | colorRange has `range` | M | L |
| Selection / Image thumbnail | PRESENT | ImageDialogs.tsx:107-108 | colorRange mask preview | - | - |
| Replacement Hue ±180, Saturation ±100, Lightness ±100 | PRESENT | imageCommands.ts:76 | adjust_cmds.rs:247 | - | - |
| Result swatch | PRESENT | ImageDialogs.tsx:109 | client inverse | - | - |
| Load…/Save… | PARTIAL. JSON, not Photoshop's .axt | ImageDialogs.tsx:113 | n/a | S | L |
| Preview | PRESENT | imageCommands.ts:74 | - | - | - |

## 22. Equalize

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Equalize (no selection) | PRESENT | PhotoStudio.tsx:1401 | eng extra_cmds.rs:156-185,592 | - | - |
| Dialog with a selection: Equalize Selected Area Only (helpx) | PARTIAL. There is no dialog; the engine always does this | PhotoStudio.tsx:1401 | extra_cmds.rs:156-185 (histogram and mapping over covered pixels) | S | L |
| Equalize Entire Image Based on Selected Area (helpx) | MISSING | PhotoStudio.tsx:1401 | none (spec `{}`) | M | L |

## 23. Auto Tone / Auto Contrast / Auto Color

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Auto Tone (Shift+Cmd+L) | PARTIAL. Fixed 0.1 % per-channel clip. It ignores the Auto Options saved defaults for clipping and target colours, which Photoshop applies (helpx) | PhotoStudio.tsx:1404 | eng edit_cmds.rs:297-337,500 (params `{}`). UI-only fix: client autoPatch plus `image.adjustments.levels` | S | L |
| Auto Contrast (Alt+Shift+Cmd+L) | PARTIAL. Same | PhotoStudio.tsx:1405 | edit_cmds.rs:306-317,501 | S | L |
| Auto Color (Shift+Cmd+B) | PARTIAL. Its own median neutralisation; ignores saved targets, clipping and Snap Neutral Midtones | PhotoStudio.tsx:1406 | edit_cmds.rs:319-333,502 | S | L |

## 24. Auto Color Correction Options

| Photoshop control | XDesign status | Evidence | Engine support | Effort | Impact |
|---|---|---|---|---|---|
| Enhance Monochromatic Contrast | PRESENT | ToneTools.tsx:17-18,118 | client | - | - |
| Enhance Per Channel Contrast | PRESENT | ToneTools.tsx:17-18,118 | client | - | - |
| Find Dark & Light Colors | MISSING-UI (disabled) | ToneTools.tsx:18,118 | client maths (toneSampler.ts:68-83); no engine needed | M | M |
| Enhance Brightness and Contrast | MISSING-UI (disabled). The algorithm is unpublished, so it can only be approximated | ToneTools.tsx:18,118 | client | M | M |
| Snap Neutral Midtones | MISSING-UI (disabled) | ToneTools.tsx:119 | client | M | M |
| Target colours: Shadows, Midtones (128 grey), Highlights | PRESENT | ToneTools.tsx:122-126; toneSampler.ts:15 | client | - | - |
| Clip % for Shadows and Highlights (0..9.99) | PRESENT | ToneTools.tsx:113-114 | client | - | - |
| Save as defaults | PARTIAL. Saved to localStorage, but only Levels/Curves Auto read it; Image › Auto commands do not | ToneTools.tsx:84,127; toneSampler.ts:16-19 | - | S | L |
| Default algorithm | PARTIAL. XDesign uses Enhance Monochromatic Contrast. Photoshop CS6+ uses Enhance Brightness and Contrast per Photoshop Training Channel; Adobe's docs do not state it (unverified) | toneSampler.ts:15 | - | S | L |

---

## Wrong range, default or unit

Only cases where the code is unambiguous are listed. The Photoshop side is noted with its source quality.

1. **Auto Options default algorithm.** XDesign: `algorithm: "monochromatic"` (toneSampler.ts:15). Photoshop CS6+ default: Enhance Brightness and Contrast (third-party; unverified in Adobe docs). XDesign cannot match it because that algorithm is disabled.
2. **Brightness/Contrast Use Legacy.**
   - Contrast is clamped to -100..**99** (actionControls.tsx:129). The engine accepts -100..100 (eng adjust_params.rs:89).
   - Brightness stays -150..150 in legacy. A forum report says Photoshop's is -100..100 (unverified).
3. **Curves point limit.** XDesign allows 19 points (curveTools.ts:42-43; toneControls.tsx:149). Photoshop allows 16: 14 control points plus 2 endpoints, per the CS3/CS4 manuals and Photofocus (unverified for 2026).
4. **Photo Filter Density minimum.** 0 % (controls.ts:18); the engine allows 0..100. Photoshop's minimum is 1 % (unverified).
5. **Match Color label.** "Use Selection in Target to Calculate Colors" (imageCommands.ts:83). Photoshop's label is "…to Calculate Adjustment" (unverified).

Every other range and default checked matches the Adobe-documented or engine-spec values. That covers:

- B/C -150..150 / -50..100;
- Levels, Exposure, Hue/Sat, B&W (defaults 40/60/40/60/20/80);
- Posterize 4 and Threshold 128;
- Match Color 1..200 / 1..200 / 0..100;
- the HDR Toning ranges;
- the Shadows/Highlights defaults.

## Top gaps ranked by impact ÷ effort

Scoring: H=3, M=2, L=1 divided by S=1, M=2, L=3. Ties are broken by impact, then UI-only before engine work.

| # | Gap | Status | Effort | Impact | Evidence |
|---|---|---|---|---|---|
| 1 | Brightness/Contrast Auto absent in Properties | MISSING-UI | S | M | actionControls.tsx:129; psAdjustControls.tsx:49-51 |
| 2 | Colorize does not take the foreground hue | MISSING-UI | S | M | actionControls.tsx:115 |
| 3 | Curves Light/Pigment, Display Options and Show Clipping absent in Properties | MISSING-UI | S | M | ToneTools.tsx:85-90 |
| 4 | Match Color has no source Layer menu (engine has `sourceLayer`) | MISSING-UI | S | M | imageCommands.ts:84; eng adjust_cmds.rs:281 |
| 5 | Replace Color has one eyedropper; no Add/Subtract | MISSING | M | H | ImageDialogs.tsx:106; adjust_cmds.rs:244-251 |
| 6 | Auto Options: Find Dark & Light Colors and Snap Neutral Midtones disabled | MISSING-UI | M | M | ToneTools.tsx:18,119 |
| 7 | Auto Options: Enhance Brightness and Contrast disabled (likely Photoshop's default) | MISSING-UI | M | M | ToneTools.tsx:18; toneSampler.ts:15 |
| 8 | HDR Toning has no preview | MISSING-UI | M | M | imageCommands.ts:91 |
| 9 | HDR Toning has no Toning Curve (engine takes `curve`) | MISSING-UI | M | M | imageCommands.ts:91-95; adjust_cmds.rs:303-307 |
| 10 | User-saved presets never appear in the Preset menu | MISSING-UI | M | M | AdjustmentPresetRow.tsx:22-24,40-41 |
| 11 | Eyedroppers and on-image tool are RGB-only | PARTIAL | M | M | ToneTools.tsx:52 |
| 12 | Replace Color: no Localized Color Clusters or Range | MISSING | M | M | ImageDialogs.tsx:105-108; eng selection_cmds.rs:151 |
| 13 | Match Color: no Ignore Selection when Applying Adjustment | MISSING | M | M | adjust_cmds.rs:157-170,292-296 |
| 14 | HDR Toning: only Local Adaptation (three methods missing) | MISSING | M | M | adjust_cmds.rs:301-337 |
| 15 | Color Lookup: 8 XDesign looks instead of Photoshop's shipped LUT list | PARTIAL | M | M | controls.ts:69; eng cms/src/lutfile.rs:219 |

Next tier (score 1, low impact): Auto commands ignore saved defaults (UI-only via autoPatch plus Levels); Exposure eyedroppers in Properties; double-click eyedropper targets; Delete Current Preset; Shadows/Highlights Save Defaults; HDR Load/Save; the legacy-contrast cap; the Curves point cap. Then the L-effort items: Abstract/Device Link profiles, Data/Table Order, Noise gradients and Smoothness.

## Sources

- Adobe helpx, via search extracts only (the site returns HTTP 403 to automated fetches):
  - making-quick-tonal-adjustments.html (Auto algorithms; saved defaults govern Auto Tone/Contrast/Color; RGB 128 midtone target);
  - equalize-brightness-values-in-an-image.html (the two Equalize options);
  - apply-brightness-contrast-adjustment.html (-150..150 / -50..100);
  - match-color-in-different-images.html and save-and-apply-settings-in-match-color.html (Load/Save Statistics, Ignore Selection);
  - adjusting-hdr-exposure-toning.html (the four HDR methods, Edge Glow, Toning Curve Corner);
  - selecting-color-range-image.html (Localized Color Clusters, Range, plus/minus eyedroppers).
- Adobe Photoshop CS3/CS4 user manuals (manualsdir.com): 14 Curves control points; 0.1 % auto clip; Curve Display Options.
- Third-party: photoshoptrainingchannel.com (Enhance Brightness & Contrast is the CS6+ default); photofocus.com (16 Curves points); digital-photography-school.com and tourboxtech.com (Color Lookup Data Order/Table Order and look counts); community.adobe.com (legacy B/C range).
