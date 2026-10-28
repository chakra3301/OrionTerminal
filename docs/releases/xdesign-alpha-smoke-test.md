# XDesign — alpha smoke test

Status at commit `79d1169`, release build 23, 2026-10-27. The machine checks below were run by Claude on a scratch-HOME release instance with scratch files. Findings 1–4, 7 and 8 were then fixed in builds 24–25, and builds 26–27 add real previews on the Home page (builds 24–27, committed together on 2026-10-28). Finding 5 was fixed after build 27; 6 remains. **The owner ran the whole checklist on 2026-10-28 and reported everything fine** ("i did all the smoke test too and everything was fine"). It covers what scripted clicks can't judge: real photos, how the tools feel, and whether anything is confusing.

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
   - *Fixed in build 24*: the previewed result stays on the canvas until the applied image is shown. The same applies to the other dialogs that preview on the canvas this way.
2. **Shortcut focus**:
   - With focus in the XDesign header instead of the editor, ⌘L opens the shell's R.O.S.I.E. instead of Levels.
   - Other shortcuts probably do the same.
   - Clicking the canvas or editor tab fixes it.
   - *Fixed in build 24*: a click elsewhere in the XDesign window that leaves nothing focused returns focus to the image editor.
3. **First Save title**: ⌘S on an image that has no PSD yet opens a dialog titled "Export As". Photoshop shows Save As.
   - *Fixed in build 24*:
     - The dialog is titled Save As, with PSD first.
     - After Save As to a PSD, ⌘S saves straight there.
     - File › Save As… ⇧⌘S is new.
     - *Build 25*: the Save As location is saved with the project, so it survives a restart. Undo doesn't change it. A copied, exported or imported project drops it, so ⌘S there asks again.
4. **No progress on open**: opening a large project shows nothing for 6 s or more.
   - *Fixed in build 24*: a "Loading project…" status appears when opening or switching takes longer than half a second.
5. **Memory**: peaks around 2 GB during an adjustment on a 24 MP image.
   - *Fixed after build 27*: the engine converted the whole layer to float RGBA three times over. Image › Adjustments on a pixel layer now runs a band at a time. On a 6000×4000 layer the extra peak drops from about 1.56 GB to about 136 MB, with the same result, undo, history and Fade, and about the same time in a debug build.
   - Still on the old route: an adjustment with a single colour channel targeted (for example only Red in the Channels panel).
6. **One image per editor**: opening a second image replaces the one in the editor tab. The first image stays in the project.
   - *Not fixed*: the editor holds one document at a time. Photoshop-style document tabs are a larger change.
7. **Text thumbnail**: the Layers thumbnail of a text layer shows a checkerboard, not a "T".
   - *Fixed in build 24*: type layers show a "T".
8. **Text Properties**: the Properties panel for a text layer shows Transform. Photoshop's also shows Character and Paragraph. To confirm.
   - *Fixed in build 24*: the Character and Paragraph controls were there, but below Quick Actions and the other sections. They now sit right under Transform, as in Photoshop.

## Owner checklist (~30 minutes)

Use copies of your files, not originals. For each step, note anything **slow, confusing, broken, crashing or lost**, with a screenshot if you can.

**Open**
- [x] A real camera photo (JPEG or HEIC from your phone or camera; RAW if you have one).
- [x] A real layered PSD of yours, ideally with text, masks and adjustment layers. Compare the layers with Photoshop.

**Edit the photo**
- [x] Crop it, with a straighten and a ratio.
- [x] Apply Levels and Curves, both as direct edits and as adjustment layers.
- [x] Make a selection (Quick Selection or Object Selection), refine it, and add a layer mask from it. Paint the mask.
- [x] Remove a blemish with Spot Healing, then fix something with Clone Stamp.
- [x] Paint with the Brush: change size and hardness, and try Brush Settings (F5).
- [x] Add text: edit it, change font and size, then move it.
- [x] Add a shape, change its fill and stroke.
- [x] Undo and redo through several steps, and use the History panel.

**Save and export**
- [x] Save (⌘S) as PSD, close the project, reopen it and check the edits are all there.
- [x] Export PNG and JPEG (File › Export › Export As…).
- [x] Open the PSD in Photoshop and compare layers, text and look.

**Home page** (build 27)
- [x] Each Recent card shows a picture of its project: the image you were editing, or the board.
- [x] Save an image as a PSD (for example `r2c.psd`), then go Home: that project is at the top, named after the file ("r2c"), unless you'd already given it a name.
- [x] Open it again: you're back in the image editor on that image.
- [x] Close the image editor (⌘W), go Home and reopen: it opens on the board this time.
- [x] FX and 3D cards show their scene.
- [x] A Webpage, Deck or Motion project whose Claude page is open keeps its old card.
- [x] On a board with a large image, stop for 2 seconds, then keep working: nothing stutters. Do the same in an FX project a few times, then check its preview still plays.

**Overall**
- [x] Did anything feel slow compared with Photoshop?
- [x] Was anything hard to find, or did anything do something you didn't expect?
- [x] Did the app crash or lose work at any point?

## XDesign alpha limits

Text for the "Alpha limits" section of the release notes:

- XDesign's photo editor matches most of Photoshop's photo menus and tools. Missing:
  - The Artboard, Frame, Remove, Content-Aware Move and Art History Brush tools.
  - The anchor-point tools, vertical type and type masks, and Custom Shape.
  - Print, Revert and Close All. The File menu is the least complete.
- One image per editor session. Opening another image replaces the one being edited; earlier images stay in the project.
- Merge to HDR Pro has no preview, curve or presets. Photomerge and HDR Pro can't take a folder as a source.
- Large images (about 24 MP) work but need memory: about 1.3–1.6 GB with one open. Adjustments on a single colour channel can still peak near 2 GB.
- Batch, Droplets, Scripts and Package aren't available. Cloud, generative AI, video, 3D, Libraries and Timeline are out of scope.
