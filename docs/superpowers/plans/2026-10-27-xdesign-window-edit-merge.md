# XDesign Window menu, Edit customisation and merge automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the owner's four next gaps against Photoshop 2026: the Window menu layout and its missing panels, Edit's Keyboard Shortcuts/Menus/Toolbar customisation, Photomerge and Merge to HDR Pro, and the gaps a fresh menu comparison finds.

**Architecture:** Menus stay `MenuSpec[]` built in `PhotoStudio.tsx`; customisation is a persisted override store applied to those specs before both `MenuBar` and `findShortcut`, so what a menu shows is what a key does. The merge commands join the native new-document path (`xdesign_photo_documents.rs`), which runs them in a throwaway session and publishes each result as its own photo.

**Tech Stack:** React 19 + TypeScript + Zustand + Vitest (jsdom); Tauri 2 + Rust (`cargo test --lib`); photocraft engine at the pinned rev (read-only).

**Spec:** Owner request 2026-10-27 ("lets do 1-4") + Photoshop 2026 menu dump `/tmp/pstest/ps_menus.txt` (Window, Edit sections) + engine specs in `docs/architecture/xdesign/photocraft-commands.json`.

## Global Constraints

- No new dependencies (npm or Cargo); no photocraft or node_modules edits.
- Never invent tokens; nearest existing token, gap logged in PROGRESS.md.
- Comments only for a non-obvious why.
- Out of scope: cloud/AI/generative, video, 3D, Libraries, Materials, Comments, Version History, Content Credentials, Writing Tools/AutoFill (macOS system items).
- Keep blocked: `file.automate.batch`, `file.scripts.browse`, `file.automate.runDroplet`, `file.automate.createDroplet`, `file.scripts.scriptEventsManager`, `file.closeAll`, `file.closeOthers`, `file.package`.
- Single document, single view: Arrange items needing a second document or view are listed disabled, never faked.
- Photoshop labels, order and shortcuts verbatim from the dump (⌥⇧⌘K, ⌥⇧⌘M, F5 Brush Settings, ⌃⌘M Minimize).

## Review Focus

- A customised shortcut that collides with an existing one: the dialog must name the conflict and the old binding must stop firing.
- A shortcut removed in Keyboard Shortcuts must stop dispatching, not only stop displaying.
- A hidden menu item (Menus tab) must not be reachable by its shortcut either, as in Photoshop.
- Photomerge/HDR with fewer than two sources, a directory, or an oversized file must be refused natively before the engine reads anything.
- Glyphs panel on a font whose bytes cannot be loaded (null from `xdesign_font_load`) must show an empty state, not throw.

---

### Task 1: Window menu in Photoshop's order with Brush Settings, Clone Source and Glyphs panels

**Files:**
- Modify: `src/apps/xdesign/photo/PhotoStudio.tsx` (STRIP_PANELS, PANEL_KEYS, Window menu, flyout bodies, BrushSettingsToggle target)
- Modify: `src/apps/xdesign/photo/BrushPanel.tsx` (split: `BrushPanel` presets only, new `BrushSettingsPanel`)
- Create: `src/apps/xdesign/photo/GlyphsPanel.tsx`, `src/apps/xdesign/photo/fontCmap.ts`
- Test: `src/apps/xdesign/photo/PhotoStudio.layout.test.tsx`, `src/apps/xdesign/photo/fontCmap.test.ts`

**Interfaces:**
- Produces: `fontCodepoints(bytes: Uint8Array): number[]` (sorted BMP+SMP code points from cmap 4/12); `GlyphsPanel({ family, style, insert }: { family: string; style: string; insert: (text: string) => void })`; `BrushSettingsPanel({ state, changed })`.

- [ ] Test: Window menu top-level labels start `["Arrange","Workspace"]`, panels alphabetical incl. `Brush Settings` (F5), `Clone Source`, `Glyphs`; Brushes has no shortcut; then `Application Frame` (checked, disabled), `Options`, `Tools`, `Contextual Task Bar`; last row is the document name, checked.
- [ ] Test: Arrange ▸ Minimize (`Ctrl+Mod+M`) minimises the xdesign shell window; Bring All to Front focuses it; tile/n-up/float/match/New Window rows disabled.
- [ ] Test: Workspace ▸ `Keyboard Shortcuts & Menus…` opens the Task 2 dialog.
- [ ] Test: F5 opens the Brush Settings flyout containing `Shape Dynamics · Size · Control`; the options-bar toggle opens Brush Settings.
- [ ] Test: Clone Source flyout shows the slot select and overlay controls with any tool.
- [ ] Test: `fontCodepoints` on a synthetic format-4 and format-12 cmap.
- [ ] Implement, run focused suites, typecheck.

### Task 2: Keyboard Shortcuts, Menus and Toolbar customisation

**Files:**
- Create: `src/apps/xdesign/photo/customization.ts` (store + `customizeMenus`), `src/apps/xdesign/photo/CustomizeDialogs.tsx`
- Modify: `PhotoStudio.tsx` (Edit menu end, apply `customizeMenus` before MenuBar and findShortcut, tool rail groups from toolbar store)
- Test: `src/apps/xdesign/photo/customization.test.ts`, `PhotoStudio.layout.test.tsx`

**Interfaces:**
- Produces: `useCustomization` (persisted: `shortcuts: Record<path,string|null>`, `menus: Record<path,{hidden?:boolean;color?:MenuColor}>`, `toolbar: {groups: string[][]; extra: string[]} | null`); `customizeMenus(specs: MenuSpec[], c): MenuSpec[]`; `menuPaths(specs): {path:string; item:MenuItem}[]`; `shortcutConflict(specs, path, shortcut): string | null`.

- [ ] Test: override replaces display and binding; `null` removes both; hidden items vanish from menus and findShortcut; conflict names the other path.
- [ ] Test: Edit menu ends `Keyboard Shortcuts…` (`Alt+Shift+Mod+K`), `Menus…` (`Alt+Shift+Mod+M`), `Toolbar…`; each opens its dialog; Toolbar moves a tool to Extra Tools and the rail drops it; Restore Defaults restores.
- [ ] Implement, run focused suites, typecheck.

### Task 3: Photomerge and Merge to HDR Pro

**Files:**
- Modify: `src-tauri/src/xdesign_photo_documents.rs` (COMMANDS, source-path admission, result size check, tests)
- Modify: `src/apps/xdesign/photo/runtime.ts` (`NEW_IMAGE_COMMANDS`)
- Create: `src/apps/xdesign/photo/MergeDialogs.tsx`
- Modify: `PhotoStudio.tsx` (File › Automate order: Batch… off, PDF Presentation… off, Create Droplet… off, —, Crop and Straighten Photos, Contact Sheet II… off, —, Conditional Mode Change…, Fit Image…, Lens Correction… off, Merge to HDR Pro…, Photomerge…)
- Test: Rust tests in the same file; `src/apps/xdesign/photo/MergeDialogs.test.tsx`

- [ ] Rust test: paths must be 2..=64 regular files under `MAX_INPUT_BYTES` (or ≥1 plus `useOpenDocuments`); folders refused; photomerge of two overlapping crops of the source publishes one document; results over `MAX_PIXELS` refused.
- [ ] TS test: Photomerge dialog sends `{paths, useOpenDocuments, layout, blend, vignetteRemoval, geometricCorrection, contentAwareFill}`; HDR sends `{paths, useOpenDocuments, align, removeGhosts, mode, method, …}`; OK disabled under two sources.
- [ ] `cargo test --lib xdesign_photo_documents`, focused vitest, typecheck.

### Task 4: Fresh comparison pass

- [ ] Re-dump XDesign menus (`/tmp/pstest/menu_dump_now.sh`), diff against `ps_menus.txt`, fix the cheap structural/wording gaps (View › Guides ▸, Image › Analysis › Set Measurement Scale ▸, Type › Panels ▸, Smart Filter toggles, label ellipses) with tests; log the rest in PROGRESS.md.

### Task 5: Verify, release build, live check, docs, commit and push

- [ ] Typecheck, focused suites, `cargo test --lib`; one release build; scratch-instance live check of Window/Edit/Automate; PROGRESS.md + archive entry; commit everything (incl. menu-scroll work) and push.
