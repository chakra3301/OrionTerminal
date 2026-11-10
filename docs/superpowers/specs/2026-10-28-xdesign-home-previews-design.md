# XDesign home: real project previews and picking up where you left off

Date: 2026-10-28. Owner request, branch `validation/alpha-2026-09-14`. Uncommitted: commits aren't authorised for this work.

## Why

The owner opened a PSD, edited it, used Save As to make `r2c.psd`, and went back to the XDesign home page. What they expect, in their words: "seeing that project r2c at the top and a preview of the content like the image that i was working on, when i click it it should basically pick right back up from the last save." And for previews: "yes every project".

What they actually get today:

- The card is called **Untitled design**. Saving a file never renames the project.
- The thumbnail is a grey box. `ProjectThumb.tsx` draws rough shape boxes from `doc.pages`, and every image comes out grey. Pencil boards ("Blank canvas", the default), FX scenes and 3D models always show an empty card.
- Clicking the card opens the design board. They have to find the image and open it again, because which image was open in the image editor isn't saved.

The goal is the Photoshop Home feel: a recent file looks like itself, and clicking it puts you back to work.

## Goals

1. **Real previews for every project kind.** Each card shows a picture of the project's actual contents: legacy design boards, Pencil boards, images being edited, FX scenes and 3D models. The one exception is pages Claude built (see Non-goals).
   - **What it shows:** the picture is what you'll see when you open the project. If you left it in the image editor, it's that image as of its latest version. Otherwise it's the board, scene or model.
   - **Fit:** the whole picture is visible, centred in the card.
2. **The preview stays current.** It updates as the project is saved, including autosave. If keeping it exactly current would make going home or editing slower, speed wins: the card can be one capture behind and catches up the next time the project is open.
3. **Saving puts the project at the top.** Recent is already sorted by `updatedAt`, and autosave already bumps it (`flushActive`). Saving the image to a file now also counts as activity, so a ⌘S with no new edits still moves the project to the top. Today that ⌘S doesn't change the doc, so it doesn't bump `updatedAt`.
4. **Picking back up.** If you left the project while editing an image, opening the project goes straight back into the image editor on that image, at its latest version, without stopping at the board first.
   - **Closing the editor yourself** clears this, so next time you land on the board. That covers ⌘W, the house button and the tab's ×.
   - **If the image is gone**, because it was deleted or undone away, the project just opens on the board, quietly.
   - **Other project kinds:** design, FX and 3D already reopen to their own editors and stay as they are.
5. **Default names follow the file.** When Save As writes a file and the project still has a name the app gave it, the project is renamed to the file's name without its extension, so `r2c.psd` gives **r2c**.
   - **Name taken:** if another project already has that name, the usual numbering applies (`r2c 2`).
   - **What counts as a name the app gave it:** "Untitled", "Untitled design", "Webpage", "Deck", "Motion", "Image", "Imported design" and "Recovered design", alone or followed by a space and a number.
   - **Later Save As:** a name that came from a Save As keeps following later ones (`r2c-final.psd` gives **r2c-final**), the way Photoshop's document title follows the file. This needs a record of where the name came from.
   - **A name you chose is never changed.** Renaming the project yourself stops it following the file.
   - **What triggers it:** only the image editor's Save As does this, meaning ⇧⌘S or a ⌘S that asks where to save. Export, Quick Export and File → Save project file… (`.xdesign`) don't.

## Non-goals

- **No pictures of Claude-built pages, for now.** Webpage, Deck and Motion projects open to the HTML page Claude built (`htmlArtifact`, shown over the board when its saved `open` flag is set). Nothing in the app can take a picture of that page yet. So while a project's page is open, its card keeps today's thumbnail, and no capture runs for it. If the page is closed, the board is what you see, so the board is captured as usual. Owner decision: "leave it as is for now then for those".
- **No recent-files list.** This doesn't add a list of image files opened outside projects, like Photoshop's file list. The home page stays a list of projects.
- **No background rendering, and nothing special for existing projects.** The home page doesn't open projects in the background to draw previews. The owner is deleting all current projects, so a project gets its preview the first time it's captured. Until then, its card shows what it shows today.
- **No per-image previews.** Several images in one project, and smoke-test finding 6 (one image per editor), are unchanged.
- **Previews aren't carried in archives.** Exported, copied and imported projects don't bring a preview with them; it's made the first time they're opened.
- **No extra restoring in the image editor.** Zoom, scroll position, selected layer and tool aren't restored unless the engine's saved view already does so. Undo history keeps whatever persistence it has today.

## Anti-goals

Any of these makes it a failure, even if the features work:

- **Editing gets slower.** Making a preview must never cause a visible hitch while painting, dragging or typing. The home page must not get slower to open either, and it's already heavy (see Constraints).
- **A card shows the wrong project.** No preview may ever land on another project's card, including during fast project switches, imports or clones.
- **Reopening shows an error or an empty editor** because the remembered image no longer exists.
- **A name the owner typed gets overwritten.**
- **Undo changes things it shouldn't.** Undo must never bring back an old remembered image or an old name.

## Constraints

- **Repo rules** (CLAUDE.md):
  - No new dependencies.
  - No edits to the photocraft engine or `node_modules`.
  - Never invent design tokens; card styling uses existing tokens.
  - Comments only for a non-obvious why.
  - Atomic file writes (`.tmp` + rename).
  - The Rust gate is `cargo test --lib`.
  - Focused tests, not repeated broad suites.
- **Undo snapshots:** undo restores whole `photoDocuments` snapshots (`store.ts`, `photoHistoryState`). The remembered open image is project-level state, so it lives beside `photoDocuments` and `photoSavePaths`, not on a photo document.
- **Project switching:** this is guarded by `trackXDesignActivity` and `transitioning`. Preview capture and the resume state must be tied to the project id they were made for, and dropped if the active project has changed.
- **Storage:** previews are images, so they don't go in the SQLite docs, which are already several MB.
  - **Delete commit:** `deleteProject` already uses the 4-write limit of `xdesign_state.rs commit_with_import`, so a preview can't be one more key in that commit.
  - **Photo storage cleanup:** the startup sweep in `xdesign_photo_storage.rs` ignores names that aren't ULIDs. A preview file needs its own cleanup when its project is deleted, or a sweep that removes previews whose project no longer exists.
- **Archives:** the allowlist is `xdesign_archive.rs asset_relative`, which drops unknown files. That fits the non-goal of not carrying previews.
- **Home page load cost:** `XDesignHome.tsx` loads every project's full doc on every registry change, and each save bumps `updatedAt`. Showing a stored preview must not need the full doc. The old shape drawing stays only as a fallback for legacy design projects that have no preview yet.
- **WebGL context limits:** FX rendering shares one WebGL context (`fx/fxThumbs.ts`) because of browser context limits. Preview capture for FX and 3D must not create a WebGL context per card.

## How each kind can be drawn (from the code today)

- **Legacy design board:** `exportXD.ts renderPngBytes`. Only while the board is mounted. It embeds every placed image at full resolution before drawing, so a board with a large image can take seconds.
- **Pencil board:** `renderDesignNodes` (`pencil/proceduralPaints.ts`), used by `pencil/runtime.ts` export. It runs synchronously on the main thread. Only while the editor and renderer are live.
- **Image in the editor:** the current version's preview PNG (at most 2048 px) is already on disk at `photoDocuments[id].previewPath`. No rendering is needed; scale it down.
- **FX scene:** `fx/fxExport.ts renderFxSnapshot(scene, time, w, h)`. Works headless.
- **3D model:** `model3d/ModelViewport.tsx CaptureBridge`. Only while the viewport is mounted.

So previews are captured while the project is open, and stored.

## Decided

- **Real previews for all project kinds.** Owner decision.
- **The project goes to the top after a save.** Owner decision.
- **Reopening goes straight back into the image editor** on the image you were editing. Owner confirmed.
- **Default project names follow the Save As file name.** Owner confirmed.
- **Webpage, Deck and Motion page previews are out for now.** Those cards stay as they are today. Owner decision.
- **No catch-up for existing projects.** The owner is deleting them. The owner approved the rest of the design on 2026-10-28, including the calls below.

## Calls to check

These are Claude's calls. The owner can overrule any of them.

- The preview is captured while the project is open, after saves and throttled. Leaving the project waits for a capture only if it's quick. Speed wins over an exactly current card (goal 2), because the anti-goals rule out a slower home page.
- Any Save As format renames a default-named project, not just PSD, and later Save As keeps the name following the file. That's what Photoshop's document title does.
- Saving the `.xdesign` project file doesn't rename the project.
- Previews aren't carried in exported, copied or imported projects; they're made on first open.
- The preview shows the whole picture (fit, not crop).

## Left to the builder

- Preview format (PNG or JPEG) and size. The card is 16:10 and at least 220 px wide, so roughly a 640 px long edge, small enough to load instantly.
- The throttle interval.
- Where previews are stored, with command names. Probably one file per project under the existing `assets/xdesign/<projectId>/` folder, written atomically by a new Rust command with a size and file-type check.
- How cards avoid showing a cached old preview: a version in the URL, a data URL, or similar.
- How previews are cleaned up when a project is deleted.
- How the remembered image is stored: legacy shape id, or Pencil node id plus photo document id. It's validated on load like `photoSavePaths`. Whether it travels in archives is also the builder's call: it's harmless once validated, and dropping it with `local_only` is the simplest option.
- Where the single list of default names lives.
- What reopening does if you left while editing a smart object's contents, which part of a board to frame, and the FX time and 3D camera used for capture.
- Which tests prove each goal and anti-goal. At minimum: no preview written to another project during a switch; resume is cleared on close and survives undo; a typed name is never renamed; a missing image falls back to the board.
