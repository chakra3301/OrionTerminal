# XDesign image editor: document tabs (smoke-test finding 6)

Date: 2026-10-28. Branch `validation/alpha-2026-09-14`. The owner asked for this ("lets do that", after "F6 ... Photoshop-style document tabs") and skipped the design questions ("skip question"), so every decision below not quoted from the owner is Claude's call and is marked **(call)**.

## Intent

Today the image editor shows one image. Opening another image replaces it in the editor; the first stays in the project but disappears from view. Photoshop keeps every open document as a tab above the canvas and lets you switch between them. XDesign should do the same, so working on two or more images doesn't mean going back to the board each time.

## Goals

1. **Opening adds a tab.** Every way of opening an image while the editor is open, or while it has tabs left from earlier in the session, adds a tab and makes it active, instead of replacing the image: XDesign File › Open image / PSD, New image, New image from clipboard, double-clicking a board image, a Pencil image, Duplicate, Crop and Straighten, Photomerge and Merge to HDR Pro (each result gets a tab, the last one active).
2. **One tab per placement.** Opening an image that already has a tab switches to that tab. A tab is identified by its placement: `source` plus the legacy shape id or the Pencil node id **(call)**. That's the same identity `photoResume` already uses.
3. **The tab strip** (`.xd-ps-doctabs`) shows every tab in the order it was opened, with `role="tablist"`.
   - The active tab shows today's label, `name @ zoom% (detail)`.
   - Background tabs show the label they had when last active. A tab restored on reopen and not yet viewed shows the document name only **(call)**.
   - Clicking a tab switches to it. Each tab has its own close button. Tabs are disabled while an image operation runs, like the rest of the controls.
4. **Switching keeps each tab's view.** Zoom and the point at the centre of the view are kept per tab. A tab shown for the first time fits on screen as today **(call)**. Tools, brush, colours and panels stay as they are, as in Photoshop.
5. **Closing:**
   - The tab's close button and File › Close (⌘W) close the active tab. If it has smart-object contents open, they first save the contents and return to the parent, as today.
   - Closing the active tab activates the tab to its right, or else to its left **(call)**. Closing the last tab leaves the editor, as Close does today.
   - **File › Close All (⌥⌘W)** and **File › Close Others (⌥⌘P)** are added. They were blocked only because there was one document **(call; reverses the earlier "stay blocked")**.
   - Closing never loses work, because every edit is already in the project. So there's no save prompt, as today.
6. **Back to design** (the house button) leaves the editor but keeps its tabs for the rest of the time the project is open **(call)**. Double-clicking another board image comes back to the editor with the earlier tabs plus the new one.
7. **Switching projects** clears the tabs, as it clears the image today. Reopening the project restores every tab, with the same one active, as long as the editor was open when the project was left. Only the active tab is loaded; the others load when clicked **(call)**.
8. **Keyboard and menus:**
   - ⌃Tab and ⌃⇧Tab move to the next and previous tab, wrapping around (Photoshop's shortcut).
   - The studio's Window menu lists every open document, with a check on the active one. Choosing one switches to it.
   - Window › Arrange stays disabled **(call)**.
9. **Stale tabs drop out.** A background tab whose placement no longer exists, for example because it was deleted on the board, disappears from the strip and from what's remembered.

## Non-goals

- Tiled or floating document windows (Window › Arrange, Float in Window, New Window for…).
- Dragging tabs to reorder, or dragging layers between tabs.
- Smart-object contents as their own tab. They keep working inside the tab that opened them; switching away keeps their draft, and coming back reopens them.
- Two tabs for the same placement.
- New studio File › New/Open items. The XDesign File menu already has them, and now they add tabs.
- A Rust command to unload closed tabs. The existing cache (8 images or 512 MiB, least recently edited first) keeps governing memory.

## Anti-goals

These would make this a failure even if it technically works:

- Losing an edit, an undo step or a smart-contents draft by switching or closing tabs.
- ⌘W, Close All or Close Others ever reaching the native Close Window and quitting the app.
- Slower opening or switching than reopening the same image is today.
- Breaking the single-image flows the owner already checked, apart from the intended tab behaviour: resume after reopening, Home previews, Save/Save As, drafts.

## Constraints

- No new dependencies, no new design tokens (style the strip with existing ones and note any gap in PROGRESS.md), no photocraft edits.
- The Rust side stays as it is. One engine session per image, cached; the command allow-list keeps `file.close*` and `document.activate` blocked, and tabs are front-end only.
- Saved projects stay readable: a `photoResume` without a tab list is one tab. Project archives, copies and imports still drop `photoResume`.
- The busy lock stays global. Only one image operation runs at a time, whichever tab it's in.

## Known limits

- A ninth open tab, or a 512 MiB total, evicts the least recently edited image from memory. Switching back to it reloads from disk, taking about as long as opening it. Its History panel snapshots are lost; its undo history isn't.
- Switching tabs closes any open dialog, as opening another image does today.

## Left to the builder

The store shape and how openers record tabs, the label cache, where tab views are kept, and how stale tabs are detected. These must fit the existing patterns in `photo/runtime.ts`, `photo/resume.ts` and `PhotoStudio.tsx`, and must be covered by focused tests: vitest for the store and the resume logic, and studio tests for the strip, the menus and the shortcuts.
