# XDesign — alpha smoke test

Status at commit `79d1169`, release build 23, 2026-10-27. The machine checks below were run by Claude on a scratch-HOME release instance with scratch files. **The owner checklist has not been run yet.** It covers what scripted clicks can't judge: real photos, how the tools feel, and whether anything is confusing.

## Already verified (machine checks)

### PSD round trip, with Photoshop as the reference: pass

- **Source**: a 2400×1600 PSD made in Photoshop with a group, a layer mask, a drop shadow, a Screen layer at 80%, 110 pt editable text, a solid-colour fill layer and a Brightness/Contrast adjustment layer.
- **Open**: it opens in XDesign in under 3.8 s.
- **Save as PSD, reopen in Photoshop**:
  - The layer tree is identical: same layers, blend modes, opacity, mask, effect, editable text, fill and adjustment.
  - Photoshop's render of XDesign's PSD is pixel-identical to the original (max difference 0).
- **XDesign's own flattened PNG** is within 5/255 of Photoshop's render (mean 1.14, nothing above 8).
- **Edit round trip**: the "Sun" layer was set to 50% opacity and saved. Photoshop reads 50%, and only the Sun region changes.

### 24 MP image (6000×4000 JPEG): pass, with findings

| Step | Time | Notes |
|---|---|---|
| Open | ~3.5 s | ~609 MB resident |
| Levels preview | under 0.8 s | |
| Levels OK → result shown | ~4.1 s | Peak ~2 GB resident; see finding 1 |
| Undo Levels | ~2.6 s | |
| Brush stroke | immediate | |
| Undo stroke | under 0.9 s | |
| Save PSD | 3.9 s | 145 MB. The test image is noise, so the RLE composite doesn't compress. |
| Save project (.xdesign) | 5.9 s | 216 MB |
| Reopen project | 6–17 s | No progress shown; see finding 4 |
| Reopen image in editor | ~3.7 s | |
| Export JPEG | 3.85 s | The Levels result is correct |

- **Persistence**: edits and undo history survived save, close and reopen of the project. This includes the Photoshop-made image's Sun at 50%.
- **Memory**: the app sits at 1.3–1.6 GB with the 24 MP image open (test machine: 18 GB RAM).

### Findings

1. **Levels flicker**: on a large image, clicking OK in Levels shows the unadjusted image for about 4 s before the result appears.
2. **Shortcut focus**:
   - With focus in the XDesign header instead of the editor, ⌘L opens the shell's R.O.S.I.E. instead of Levels.
   - Other shortcuts probably do the same.
   - Clicking the canvas or editor tab fixes it.
3. **First Save title**: ⌘S on an image that has no PSD yet opens a dialog titled "Export As". Photoshop shows Save As.
4. **No progress on open**: opening a large project shows nothing for 6 s or more.
5. **Memory**: peaks around 2 GB during an adjustment on a 24 MP image.
6. **One image per editor**: opening a second image replaces the one in the editor tab. The first image stays in the project.
7. **Text thumbnail**: the Layers thumbnail of a text layer shows a checkerboard, not a "T".
8. **Text Properties**: the Properties panel for a text layer shows Transform. Photoshop's also shows Character and Paragraph. To confirm.

## Owner checklist (~30 minutes)

Use copies of your files, not originals. For each step, note anything **slow, confusing, broken, crashing or lost**, with a screenshot if you can.

**Open**
- [ ] A real camera photo (JPEG or HEIC from your phone or camera; RAW if you have one).
- [ ] A real layered PSD of yours, ideally with text, masks and adjustment layers. Compare the layers with Photoshop.

**Edit the photo**
- [ ] Crop it, with a straighten and a ratio.
- [ ] Apply Levels and Curves, both as direct edits and as adjustment layers.
- [ ] Make a selection (Quick Selection or Object Selection), refine it, and add a layer mask from it. Paint the mask.
- [ ] Remove a blemish with Spot Healing, then fix something with Clone Stamp.
- [ ] Paint with the Brush: change size and hardness, and try Brush Settings (F5).
- [ ] Add text: edit it, change font and size, then move it.
- [ ] Add a shape, change its fill and stroke.
- [ ] Undo and redo through several steps, and use the History panel.

**Save and export**
- [ ] Save (⌘S) as PSD, close the project, reopen it and check the edits are all there.
- [ ] Export PNG and JPEG (File › Export › Export As…).
- [ ] Open the PSD in Photoshop and compare layers, text and look.

**Overall**
- [ ] Did anything feel slow compared with Photoshop?
- [ ] Was anything hard to find, or did anything do something you didn't expect?
- [ ] Did the app crash or lose work at any point?

## XDesign alpha limits

Text for the "Alpha limits" section of the release notes:

- XDesign's photo editor matches most of Photoshop's photo menus and tools. Missing:
  - The Artboard, Frame, Remove, Content-Aware Move and Art History Brush tools.
  - The anchor-point tools, vertical type and type masks, and Custom Shape.
  - Print, Save As, Revert and Close All. The File menu is the least complete.
- One image per editor session. Opening another image replaces the one being edited; earlier images stay in the project.
- The first ⌘S on a new image opens a dialog titled "Export As". Save to PSD to keep layers.
- Merge to HDR Pro has no preview, curve or presets. Photomerge and HDR Pro can't take a folder as a source.
- Large images (about 24 MP) work but need memory: up to ~2 GB during adjustments.
  - After Levels or a similar adjustment, the old image can show for a few seconds before the result.
  - Large projects open with no progress indicator.
- Keyboard shortcuts reach the editor only when it has focus. Click the canvas if a shortcut opens something else.
- Text-layer thumbnails show a checkerboard instead of a "T".
- Batch, Droplets, Scripts and Package aren't available. Cloud, generative AI, video, 3D, Libraries and Timeline are out of scope.
