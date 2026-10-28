# XDesign document tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photoshop-style document tabs in the XDesign image editor: every open image keeps a tab, with its own zoom and view, until it is closed.

**Architecture:** Tabs are front-end only. The photo workspace store gains a tab list that a store subscription keeps in step with the active placement, so every opener adds its tab without being edited. A new `photo/tabs.ts` owns switching and closing, routed through the existing openers (`editImage`, `editPencilImage`, `resumeSmartContents`), which already reuse the native cache. `photoResume` gains an optional tab list so a reopened project restores the strip, loading only the active tab.

**Tech Stack:** React 19, TypeScript, Zustand, vitest. No Rust changes.

**Spec:** `docs/superpowers/specs/2026-10-28-xdesign-document-tabs-design.md`

## Global Constraints

- No new dependencies, no new design tokens (closest existing token; gaps go to PROGRESS.md), no photocraft edits.
- Rust unchanged; the allow-list keeps `file.close*` and `document.activate` blocked.
- A `photoResume` without `tabs` is one tab. Archives, copies and imports still drop `photoResume`.
- The busy lock stays global: switching and closing are refused (no-op) while an image operation runs.
- Comments only for a non-obvious why. Code style matches the file being edited (dense one-liners in `PhotoStudio.tsx`).
- No commits for F6 (owner has not authorised them): every "Commit" step is replaced by a ledger line.

## Review Focus

1. **Switching to a tab on another legacy page.** The page switch must not make the vanish check close the outgoing tab before the new one shows (Task 1 test `switches page to a legacy tab on another page`).
2. **A background tab whose placement was deleted on the board** while the editor was closed. Expect it gone from the strip and the Window menu when the editor next opens (Task 3 test `drops a background tab whose image was deleted`).
3. **Closing the active tab with smart-object contents open.** Expect today's behaviour (save contents, back to the parent), not a tab close (Task 1 test `closing the active tab with contents open saves them first`).
4. **⌘W / ⌥⌘W while busy.** Expect the key to be swallowed, never reaching the native Close Window (Task 3 test `swallows close shortcuts while busy`).
5. **A saved project with more tabs than the validator allows, or a malformed tab list.** Expect the tracker never to write a list the loader rejects, and the loader to reject malformed lists (Task 2 tests `caps the remembered tab list` and `rejects a malformed tab list`).

---

### Task 1: Tab model and actions

**Files:**
- Modify: `src/apps/xdesign/photo/types.ts` (next to `PhotoResume`, ~L147)
- Modify: `src/apps/xdesign/photo/runtime.ts:16-41` (store), `:281-294` (`editImage`), `:319-344` (`createImages`)
- Create: `src/apps/xdesign/photo/tabs.ts`
- Test: `src/apps/xdesign/photo/tabs.test.ts`

**Interfaces:**
- Produces (types.ts): `export type PhotoTab = { source: "legacy" | "pencil"; placementId: string }`; `export const PHOTO_TAB_LIMIT = 64`.
- Produces (runtime.ts): store fields `tabs: OpenPhotoTab[]`, `tabProject: string | null`, method `leave(): void` (as `close()` but keeps `tabs`/`tabProject`); `close()` also clears `tabs` and `tabProject`. `export type OpenPhotoTab = PhotoTab & { draftId?: string; label?: string; view?: TabView }`, `export type TabView = { documentId: string; zoom: number; center: [number, number] }`. `export function addPhotoTabs(source, placementIds: string[], projectId: string): void`.
- Produces (tabs.ts): `sameTab(a: PhotoTab, b: PhotoTab): boolean`, `tabKey(tab: PhotoTab): string`, `activeTab(): PhotoTab | null`, `tabDocumentId(tab: PhotoTab): string | null`, `liveTabs(): OpenPhotoTab[]`, `activateTab(tab: PhotoTab): Promise<void>`, `cycleTab(step: 1 | -1): Promise<void>`, `closeTab(tab?: PhotoTab): Promise<void>`, `closeAllTabs(): void`, `closeOtherTabs(): void`, `closeVanishedTab(): void`, `leaveImageEditor(): void`, `rememberTab(tab: PhotoTab, patch: { label?: string; view?: TabView }): void`, `pruneTabs(): void`.

- [ ] **Step 1: Write the failing tests** in `tabs.test.ts` (mock `@tauri-apps/api/core` invoke like `runtimeNewImages.test.ts`; mock `./runtime`'s `editImage`/`resumeSmartContents`/`finishSmartContents` and `../pencil/runtime`'s `editPencilImage` as `vi.fn` that set the workspace like the real openers do):
  - `adds a tab for every image opened and keeps one per placement`: open A, B, A → `tabs` is `[A, B]`, active A.
  - `a different project starts a new tab list`: workspace with tabProject P1 opens an image in P2 → tabs `[that one]`, `tabProject` P2.
  - `close clears the tabs, leave keeps them`: after `leave()`, `shapeId` null and tabs kept; after `close()`, tabs `[]` and `tabProject` null.
  - `creates a tab per new image`: `addPhotoTabs("legacy",[x,y],P)` appends both in order, skipping one already present.
  - `activates a tab through its opener`: legacy tab → `editImage(placementId)`; pencil tab → `editPencilImage(placementId)`; active tab → no call.
  - `switching away keeps open contents and coming back reopens them`: active A with `smartTrail[0].childId = D` and a draft `D` in `photoDrafts`; activate B then A → `resumeSmartContents("D")` called, A's `draftId` cleared after.
  - `closing the active tab activates its right neighbour, else its left`: tabs `[A,B,C]` active B → close → C active, tabs `[A,C]`; close C → A active; close A → `closeImageEditor` path: `shapeId` null, tabs `[]`, `photoResume` null.
  - `closing a background tab only removes it`: tabs `[A,B]` active A → `closeTab(B)` → no opener call, tabs `[A]`.
  - `closing the active tab with contents open saves them first`: trail open → `finishSmartContents(true)` called, tabs unchanged.
  - `close all and close others`: `closeOtherTabs()` → `[active]`; `closeAllTabs()` → editor closed, tabs `[]`, `photoResume` null.
  - `cycles with wrap`: `[A,B,C]` active C → `cycleTab(1)` → A; `cycleTab(-1)` from A → C.
  - `refuses to switch or close while busy`: `busy:true` → `activateTab`, `closeTab`, `closeAllTabs`, `closeOtherTabs` change nothing and call no opener.
  - `the vanished active tab hands over to its neighbour`: tabs `[A,B]` active A, A's shape removed → `closeVanishedTab()` → tabs `[B]` and `editImage(B)` called; with no neighbour → `close()`.
  - `leaving keeps the tabs and forgets the resume`: `leaveImageEditor()` → `shapeId` null, tabs kept, `photoResume` null.
  - `switches page to a legacy tab on another page` (real `editImage`, mocked invoke): tab B's shape on page 2, active page 1 → after `activateTab(B)` the active page is page 2 and `shapeId` B. Also tested: `tabDocumentId` finds B's document while page 1 is active and returns null after B is deleted.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run src/apps/xdesign/photo/tabs.test.ts` Expected: FAIL (module `./tabs` not found).
- [ ] **Step 3: Implement.**
  - types.ts: `PhotoTab`, `PHOTO_TAB_LIMIT`.
  - runtime.ts: store fields and `leave`; a module-level `usePhotoWorkspace.subscribe` that, when `(source, shapeId)` changes to a non-null placement, calls `addPhotoTabs(source,[shapeId],projectId)`. `addPhotoTabs` replaces the list when `projectId !== tabProject`. `createImages` calls `addPhotoTabs` with every created placement before its final `setState`. `editImage` finds the shape on any page (`pages` with the active page read from `shapes`) and, after `receive`, switches page when it isn't active, before `applyPhotoDocument`, as `resumeSmartContents` does.
  - tabs.ts: as in Interfaces. `activateTab` records the outgoing tab's `draftId` (`smartTrail[0]?.childId`, else none) before opening; opens with `resumeSmartContents(draftId)` when that draft still exists, else the source's opener; clears the target's `draftId` after. `closeTab` on the active tab with no trail awaits the neighbour's activation before removing the tab, so a failed switch leaves it open; with no neighbour it calls `closeImageEditor()` from `resume.ts`. `closeVanishedTab` is a no-op while busy or when the active tab is no longer listed; it removes it, then activates the neighbour, and calls `close()` if that fails. `tabDocumentId`: legacy → the shape's `photoDocumentId` on any page; pencil → `pencilPhotoDocumentId`. `liveTabs` keeps the active tab plus tabs with a document. `pruneTabs` sets `tabs` to `liveTabs()` when they differ.
- [ ] **Step 4: Run to verify they pass.** Run: `npx vitest run src/apps/xdesign/photo/tabs.test.ts src/apps/xdesign/photo/runtimeNewImages.test.ts src/apps/xdesign/photo/resume.test.ts` Expected: PASS.
- [ ] **Step 5: Ledger** (no commit).

### Task 2: Remembered tabs

**Files:**
- Modify: `src/apps/xdesign/photo/types.ts:147-153` (`PhotoResume`, `validatePhotoResume`)
- Modify: `src/apps/xdesign/photo/resume.ts` (`startOpenImageTracking`, `resumeImageEditor`)
- Modify: `src/apps/xdesign/XDesignApp.tsx:159` (project switch)
- Test: `src/apps/xdesign/photo/resume.test.ts`

**Interfaces:**
- Consumes: `PhotoTab`, `PHOTO_TAB_LIMIT`, store `tabs`/`tabProject`, `sameTab`, `tabDocumentId` (Task 1).
- Produces: `PhotoResume = PhotoTab & { documentId: string; tabs?: PhotoTab[] }`.

- [ ] **Step 1: Write the failing tests** in `resume.test.ts`:
  - `remembers the tab list when more than one tab is open`: tabs `[A,B]` active B → `photoResume` is `{source,placementId:B,documentId,tabs:[A,B]}` (plain `{source,placementId}` entries); one tab → no `tabs` key (today's shape).
  - `caps the remembered tab list`: 70 tabs → `photoResume.tabs.length === PHOTO_TAB_LIMIT` and `validatePhotoResume` accepts it.
  - `rejects a malformed tab list`: `validatePhotoResume` throws for `tabs` not an array, longer than the limit, or with an entry missing `placementId`, with a bad `source`, or a `placementId` over 128 characters; accepts a resume without `tabs`.
  - `restores every live tab and opens only the active one`: `photoResume` `{..., placementId:B, tabs:[A,B,C]}`, C deleted → `editImage` called once with B; store `tabs` `[A,B]`, active B.
  - `a resume without tabs restores one tab`.
  - `switching projects clears tabs left by Back to design` (XDesignApp effect, tested at store level by asserting the effect's condition through a rendered `XDesignApp` only if its test harness exists; otherwise unit-test an exported `staleTabProject(activeId)` helper in `tabs.ts`).
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run src/apps/xdesign/photo/resume.test.ts` Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement.** Validator: optional `tabs`, array of at most `PHOTO_TAB_LIMIT` valid tabs. Tracker: writes `tabs` (first `PHOTO_TAB_LIMIT`, stripped to `source`/`placementId`) only when there are two or more; its "unchanged" check compares the tab keys too. `resumeImageEditor`: after the active image opens and the workspace still shows it, sets `tabs` to the remembered list deduplicated, filtered to live tabs plus the active one (appended if missing). XDesignApp: the close effect also fires when `tabProject` is set and differs from the active project.
- [ ] **Step 4: Run to verify they pass.** Run: `npx vitest run src/apps/xdesign/photo/resume.test.ts src/apps/xdesign/photo/tabs.test.ts` Expected: PASS.
- [ ] **Step 5: Ledger** (no commit).

### Task 3: The tab strip, menus and shortcuts

**Files:**
- Modify: `src/apps/xdesign/photo/PhotoStudio.tsx` (L505-513 vanish effect, L525 fit effect, measureView ~L533, L1265-1268 File menu, L1661-1669 Window menu, L1673 `layerKeys`, L1920 busy return, L1959 house button, L2010-2013 strip)
- Modify: `src/apps/xdesign/photo/photoshop.css:41-46`
- Test: create `src/apps/xdesign/photo/PhotoStudio.tabs.test.tsx` (harness copied from `fileMenu.studio.test.tsx`, two placements, `./tabs` real, `./runtime` `editImage` mocked to set the workspace)

**Interfaces:**
- Consumes: everything Task 1 produces.

- [ ] **Step 1: Write the failing tests:**
  - `shows a tab per open image in a tablist, the active one with zoom and detail`: two tabs → `[role=tablist] [role=tab]` count 2; active `aria-selected="true"` text matches `/^Portrait @ \d+% \(/`; background tab text is exactly its document name.
  - `clicking a background tab switches to it and its label is kept`: click tab B → `editImage(B)` called; after the workspace shows B, tab A's text is the label it had when active.
  - `each tab closes on its own`: click B's `Close Second` → tabs `[A]`, no opener call; click `Close image` on A → editor closed.
  - `keeps zoom per tab and fits a tab seen for the first time`: zoom A to 200% (View › Zoom In twice or `setZoom` via menu), switch to B (fits, not 200%), back to A → A's label shows `@ 200%`.
  - `File menu: Close All ⌥⌘W and Close Others ⌥⌘P after Close`: order `Close`, `Close All`, `Close Others`; shortcuts `⌥⌘W`, `⌥⌘P`; Close Others disabled with one tab; keys ⌥⌘W / ⌥⌘P run them.
  - `⌃Tab and ⌃⇧Tab move between tabs with wrap`.
  - `Window menu lists every open image with a check on the active one`; choosing the other one calls `editImage`.
  - `Back to design keeps the tabs`: click `Back to design` → `shapeId` null, tabs kept, `photoResume` null.
  - `drops a background tab whose image was deleted`: delete B's shape → strip shows only A; Window menu lists only A; store `tabs` `[A]`.
  - `the active image vanishing hands over to the next tab`: delete A's shape → `editImage(B)` called.
  - `tabs are disabled while busy`: `busy:true, quiet:false` → clicking B calls nothing; close buttons disabled.
  - `swallows close shortcuts while busy`: `busy:true` → ⌘W and ⌥⌘W keydowns are `defaultPrevented`.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run src/apps/xdesign/photo/PhotoStudio.tabs.test.tsx` Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Strip: `role="tablist" aria-label="Open images"`; one `role="tab"` per `liveTabs()` entry (subscribe to `tabs`, `shapes`, `pages` so stale tabs re-filter); active as today; background `aria-selected="false"`, `aria-disabled={busy}`, click → `activateTab`, label `tab.label ?? documentName`, close button `Close ${name}`; an effect calls `pruneTabs()` when the live list is shorter than the store's.
  - Views: `measureView` also stores `{documentId, zoom, center}` (centre of the visible area) in a ref. The fit effect becomes: when the shown document changes, `rememberTab(previous tab, {label, view})` for the outgoing one (view only if measured for that document), then restore the incoming tab's `view` when its `documentId` matches (`setZoom` + `viewCenter`, or `centerView` when the zoom is unchanged, like `fitLayers`), else `fit()`.
  - Vanish effect: `closeVanishedTab()` instead of `close()`.
  - File menu: `Close All` (`Alt+Mod+W`, `closeAllTabs`) and `Close Others` (`Alt+Mod+P`, `closeOtherTabs`, enabled with 2+ tabs) right after Close; Close itself → `closeTab()`.
  - Window menu: the document radio becomes one radio per live tab; the active one keeps today's focus-window action, others `activateTab`. Update the Window comment (Arrange still off).
  - `layerKeys`: add `Ctrl+Tab` → `cycleTab(1)`, `Ctrl+Shift+Tab` → `cycleTab(-1)`.
  - Busy return: swallow `Mod+W`/`Alt+Mod+W` (`e.code==="KeyW"` with ⌘ or ⌃) before returning.
  - House button without a trail → `leaveImageEditor()`.
  - CSS: background tab muted with existing tokens (`--xd-panel` background, `--xd-text-3` text); tabs `min-width: 0` so the strip shrinks instead of overflowing; active tab `flex: none`.
- [ ] **Step 4: Run to verify they pass, plus the pinned studio tests.** Run: `npx vitest run src/apps/xdesign/photo/PhotoStudio.tabs.test.tsx src/apps/xdesign/photo/fileMenu.studio.test.tsx src/apps/xdesign/photo/PhotoStudio.tools.test.tsx src/apps/xdesign/photo/PhotoStudio.layout.test.tsx` then `npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 5: Ledger** (no commit).

### Task 4: Docs

**Files:**
- Modify: `docs/releases/xdesign-alpha-smoke-test.md` (finding 6, status line, alpha-limits "One image per editor session" and "Close All" lines)
- Modify: `PROGRESS.md`, `CLAUDE_LOG_ARCHIVE.md` (new top entries; note no commit, build 28 predates F6, token gaps if any)

- [ ] **Step 1:** Finding 6 → "*Fixed after build 28*: …" describing tabs; limits: drop the one-image line, add the eviction limit; File menu line no longer lists Close All.
- [ ] **Step 2:** PROGRESS.md and archive entries.
- [ ] **Step 3: Verify** with `git diff --stat` (only intended files) and the full focused test set from Tasks 1-3 once more. Expected: PASS.
