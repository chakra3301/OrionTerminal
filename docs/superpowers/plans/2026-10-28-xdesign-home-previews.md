# XDesign Home Previews and Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home cards show a real picture of each project, a saved image moves its project to the top and names a default-named project after the file, and reopening a project goes straight back into the image editor.

**Architecture:**
- **Capture and storage:** previews are captured only while a project is open. Capture is idle-gated, throttled and tied to the project id. The PNGs are stored by a small Rust module, one file per project, under `assets/xdesign-previews/`. Home reads them through the asset protocol with a revision query. It no longer needs every project's full doc.
- **Resume:** the open image is project-level state (`photoResume`) beside `photoDocuments`, so undo can't touch it.
- **Naming:** names follow Save As through a `nameFromFile` flag on the registry entry.

**Tech Stack:** Tauri 2, React 19, TypeScript, Zustand, Vitest (jsdom), Rust (`cargo test --lib`).

**Spec:** `docs/superpowers/specs/2026-10-28-xdesign-home-previews-design.md` (owner-approved 2026-10-28). Read it first; this plan argues from it.

## Global Constraints

- **Repo:** `~/Orion_Terminal`, branch `validation/alpha-2026-09-14`.
- **No commits or pushes:** the owner hasn't authorised them for this work. Each task's last step replaces "Commit" with a check: `git status --short` lists only the task's files beside the existing dirty work. Preserve that pre-existing dirty work.
- **Untouchable code:** no new dependencies. No edits to the photocraft engine or `node_modules`.
- **Design tokens:** never invent them. Use the closest existing token, and log any gap in the `PROGRESS.md` open questions for Hermes.
- **Comments:** only for a non-obvious why.
- **Atomic writes:** `.tmp` + rename, in Rust through `crate::fs_ops::atomic_write_bytes(&str, &[u8])`.
- **Rust gate:** `cargo test --lib`, not `cargo check`.
- **Test cost:** focused test files per task. Broad runs once, in Task 6.
- **Default names:** "Untitled", "Untitled design", "Webpage", "Deck", "Motion", "Image", "Imported design", "Recovered design", alone or followed by a space and a number.
- **Preview rules:**
  - Fit, not crop, centred.
  - What you'll see when you open the project.
  - The card may be one capture behind; speed wins over exactness.
  - No capture while a project's Claude page (`htmlArtifact`) is open; that card keeps today's thumbnail.
- **Live checks:**
  - Only on the scratch-HOME release instance (`HOME=/tmp/xd-release-home CFFIXED_USER_HOME=/tmp/xd-release-home`), with the `/tmp/pstest` guards.
  - Never the owner's projects, the dev instance, or `/Applications/Orion Terminal.app`.
  - Never touch `pfp.psd`.

## Review Focus

1. **Switching projects while a capture runs** (fast tab clicks, Home mid-capture, a new project opening after import): no picture may land on another project's card. Pinned in Task 4: "never puts a picture on another project's card when you switch mid-capture".
2. **The remembered image is gone or no longer matches:** its placement was undone away, its Pencil node deleted, its photo link changed, or the engine refuses to open it. The project opens on the board with no toast and no error state. Pinned in Task 2: "opens on the board, quietly, when the image is gone".
3. **Awkward Save As paths:** Windows separators, a dot-only file name, a name another project already has, or saving again under the project's own current name. Expected results: a sensible name, and no "r2c 3" creep. Pinned in Task 1: "takes the name from any path and ignores names that would be empty" and "numbers a taken name and doesn't count the project itself".
4. **A preview file deleted on disk or unreadable by the asset protocol:** the card shows the old thumbnail, not a broken image. Pinned in Task 5: "keeps the old thumbnail without a preview, and when the file can't be shown".
5. **A capture comes due mid-stroke or mid-operation:** it waits and never starts during continuous input or a busy image or design operation. Pinned in Task 4: "waits while you paint, drag or type" and "doesn't capture during an image or design operation, then catches up".

## File map

| File | Responsibility |
|---|---|
| `src/apps/xdesign/projectsStore.ts` | Registry flag `nameFromFile`; `DEFAULT_PROJECT_NAME`; `noteImageSaved`; `photoResume` in `XDDoc`; settles the preview when leaving; deletes the preview with the project |
| `src/apps/xdesign/photo/runtime.ts` | `exportImage` reports saved files to `noteImageSaved` |
| `src/apps/xdesign/photo/types.ts` | `PhotoResume` type and validator |
| `src/apps/xdesign/store.ts` | `photoResume` field, hydrate and reset |
| `src/apps/xdesign/photo/resume.ts` (new) | Track the open image, close the editor on purpose, resume on open |
| `src/apps/xdesign/photo/PhotoStudio.tsx` | User close sites call `closeImageEditor` |
| `src/apps/xdesign/XDesignApp.tsx` | Starts the trackers; resumes on activation |
| `src/apps/xdesign/pluginContributions.ts` | Autosave also watches `photoResume` |
| `src-tauri/src/xdesign_preview.rs` (new), `lib.rs` | Preview files: write, list, delete |
| `src-tauri/src/xdesign_archive.rs` | Archives drop `photoResume` |
| `src/apps/xdesign/projectPreview.ts` (new) | Preview store, scheduling, guards, IPC |
| `src/apps/xdesign/previewCapture.ts` (new) | Which picture each project kind gives |
| `src/apps/xdesign/previewImage.ts` (new) | Load a file as a bitmap; scale to a PNG |
| `src/apps/xdesign/pencil/runtime.ts` | `capturePencilPreview` |
| `src/apps/xdesign/XDesignHome.tsx`, `src/styles/tokens.css` | Card shows the stored preview; docs load only where needed |

Test commands run from the repo root: `npx vitest run <files>`. Rust: `cd src-tauri && cargo test --lib <filter>`.

---

### Task 1: Saved images move the project to the top and name it

**Files:**
- Modify:
  - `src/apps/xdesign/projectsStore.ts`:
    - `XDProjectMeta` at 48-55
    - store type near 286
    - `readRegistry` at 291-302
    - `renameProject` at 561-567
    - new action beside `renameProject`
  - `src/apps/xdesign/photo/runtime.ts`: `exportImage` at 484-493
- Test: `src/apps/xdesign/projectsStore.test.ts`, `src/apps/xdesign/photo/savePaths.test.ts`

**Interfaces:**
- Produces:
  - `XDProjectMeta.nameFromFile?: true`, set only when the name came from an image Save As.
  - `export const DEFAULT_PROJECT_NAME: RegExp`, from `projectsStore.ts`.
  - `useXDProjects.getState().noteImageSaved(projectId: string, path: string, saveAs: boolean): Promise<void>`

**Decision:** every successful image file write bumps `updatedAt`: ⌘S, Save As, Save a Copy and Export alike. Only `saveAs === true` renames, and that is only the editor's Save As dialog (`exportOpen==="save"`). PhotoStudio's call sites stay as they are.

- [ ] **Step 1: Write the failing tests** in a new `describe("image saves")` in `projectsStore.test.ts`. Use the file's existing `@/lib/db` mock and `ready: true` setup. Seed the registry with A `{ name: "Untitled design", updatedAt: 1 }` and B `{ name: "Other", updatedAt: 5 }`, where `meta(id)` reads it from `useXDProjects.getState().registry`.

```ts
it("names a default-named project after its Save As file and moves it to the top", async () => {
  await useXDProjects.getState().noteImageSaved(A, "/Users/me/Desktop/photoshop/r2c.psd", true);
  expect(meta(A)).toMatchObject({ name: "r2c", nameFromFile: true });
  expect(meta(A).updatedAt).toBeGreaterThan(5);
});
it("keeps following later Save As until the owner renames it", async () => {
  await noteImageSaved(A, "/x/r2c.psd", true); await noteImageSaved(A, "/x/r2c-final.png", true);
  expect(meta(A).name).toBe("r2c-final");
  await useXDProjects.getState().renameProject(A, "Poster");
  expect(meta(A).name).toBe("Poster"); expect("nameFromFile" in meta(A)).toBe(false);
  await noteImageSaved(A, "/x/new.psd", true); expect(meta(A).name).toBe("Poster");
});
it("only Save As renames; ⌘S, copies and exports just move it to the top", async () => {
  await noteImageSaved(A, "/x/r2c.psd", false);
  expect(meta(A).name).toBe("Untitled design"); expect(meta(A).updatedAt).toBeGreaterThan(5);
});
it("numbers a taken name and doesn't count the project itself", async () => {
  // B renamed to "r2c" first
  await noteImageSaved(A, "/x/r2c.psd", true); expect(meta(A).name).toBe("r2c 2");
  await noteImageSaved(A, "/x/r2c.psd", true); expect(meta(A).name).toBe("r2c 2");
});
it("recognises only the app's default names", async () => {
  // each renamed: "Untitled","Untitled 3","Untitled design","Untitled design 2","Webpage","Deck 4","Motion","Image","Imported design","Recovered design 2"
  // each unchanged: "My Deck","Deck two","Untitled-1","FX Scene","3D Model"
});
it("takes the name from any path and ignores names that would be empty", async () => {
  await noteImageSaved(A, "C:\\Users\\me\\r2c.psd", true); expect(meta(A).name).toBe("r2c");
  // fresh default-named C: "/x/.psd" → name unchanged, updatedAt still bumped
});
it("refuses a project list whose name-origin flag isn't true", async () => {
  // stored registry entry with nameFromFile: "yes" → init() sets loadError, registry not overwritten
});
```

  Add these to `savePaths.test.ts`, replacing `noteImageSaved` with a `vi.fn` through `useXDProjects.setState` and restoring it in `afterEach`:

```ts
it("tells the project list about each saved image file, after it's written", async () => {
  invoke.mockResolvedValue([]);
  await exportImage("/Users/me/Renamed.psd", undefined, true);
  expect(noteImageSaved).toHaveBeenLastCalledWith(projectId, "/Users/me/Renamed.psd", true);
  await exportImage("/Users/me/Flat.jpg", 90);
  expect(noteImageSaved).toHaveBeenLastCalledWith(projectId, "/Users/me/Flat.jpg", false);
  invoke.mockRejectedValueOnce(new Error("disk full"));
  await expect(exportImage("/Users/me/Fail.psd", undefined, true)).rejects.toThrow("disk full");
  expect(noteImageSaved).toHaveBeenCalledTimes(2);
});
it("still reports the save when the project list can't be updated", async () => {
  invoke.mockResolvedValue(["warning"]); noteImageSaved.mockRejectedValueOnce(new Error("registry busy"));
  await expect(exportImage("/Users/me/A.psd", undefined, true)).resolves.toEqual(["warning"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/apps/xdesign/projectsStore.test.ts src/apps/xdesign/photo/savePaths.test.ts`
  Expected: FAIL, because `noteImageSaved` is not a function.

- [ ] **Step 3: Implement.**
  - **`DEFAULT_PROJECT_NAME`:** `/^(Untitled|Untitled design|Webpage|Deck|Motion|Image|Imported design|Recovered design)( \d+)?$/`.
  - **`readRegistry`:** rejects an entry whose `nameFromFile` is neither undefined nor `true`.
  - **`renameProject`:** drops the key with destructuring, not `nameFromFile: undefined`.
  - **`noteImageSaved`:** goes through `updateRegistry`, not `projectChange`. It runs inside a photo operation, which `projectChange` would refuse.
    - It always sets `updatedAt: Date.now()`.
    - When `saveAs` is true and the name is default or `nameFromFile`, it takes the stem: the last `/` or `\` segment with its final extension removed, then trimmed. A non-empty stem renames the project to `uniqueName(registry without this project, stem)` and sets `nameFromFile: true`.
  - **`exportImage`:** after the `xdesign_photo_export` invoke succeeds, awaits `useXDProjects.getState().noteImageSaved(projectId, path, saveAs)`. On failure it calls `log.warn` (the logger `XDesignHome.tsx` uses) and still returns the warnings.

- [ ] **Step 4: Run the tests to verify they pass**

  Run the Step 2 command, plus `src/apps/xdesign/photo/PhotoStudio.tools.test.tsx`.
  Expected: all PASS, with the existing `exported` expectations unchanged.

- [ ] **Step 5: Check the changed files:** `git status --short` shows only this task's four files added to the existing dirty set. No commit.

---

### Task 2: Reopening goes back into the image editor

**Files:**
- Create: `src/apps/xdesign/photo/resume.ts`
- Modify:
  - `src/apps/xdesign/photo/types.ts`, beside `validatePhotoSavePaths` at 143
  - `src/apps/xdesign/store.ts`: state type at 279, hydrate param at 407, initial value at 500, hydrate at 1164 and 1184
  - `src/apps/xdesign/projectsStore.ts`: `XDDoc` at 32-44, `snapshotActiveDoc` at 111-133, `validateDesignDoc` at 135-161
  - `src/apps/xdesign/pluginContributions.ts:392`
  - `src/apps/xdesign/photo/PhotoStudio.tsx`: 1266, 1958, 2010
  - `src/apps/xdesign/XDesignApp.tsx`: near 150-157
  - `src-tauri/src/xdesign_archive.rs:48` and its test near 542-554
- Test:
  - Create `src/apps/xdesign/photo/resume.test.ts`, copying the `beforeEach` from `savePaths.test.ts`.
  - Modify `src/apps/xdesign/photo/PhotoStudio.tools.test.tsx`.

**Interfaces:**
- Consumes:
  - `editImage(shapeId)` in `photo/runtime.ts`
  - `editPencilImage(nodeId)` and `pencilPhotoDocumentId(nodeId)` in `pencil/runtime.ts`
- Produces:
  - `export type PhotoResume = { source: "legacy" | "pencil"; placementId: string; documentId: string }`, in `photo/types.ts`
  - `export function validatePhotoResume(value: unknown): asserts value is PhotoResume`, in `photo/types.ts`
  - `useXDesign` state `photoResume: PhotoResume | null`, and `XDDoc.photoResume?: PhotoResume | null`
  - From `photo/resume.ts`:
    - `startOpenImageTracking(): () => void`
    - `closeImageEditor(): void`
    - `resumableImage(): PhotoResume | null`, which Task 4 uses
    - `resumeImageEditor(projectId: string): Promise<void>`

**Rules:**
- **`validatePhotoResume`:**
  - It checks only the shape of the value: `source` is one of the two values, `placementId` is a non-empty string of at most 128 characters, and `documentId` passes the `ID` regex in `types.ts`.
  - It doesn't cross-check `photoDocuments`. A dangling value falls back at resume time instead of refusing to load the project.
  - `validateDesignDoc` calls it when `photoResume` is neither undefined nor null.
- **Tracking:** `startOpenImageTracking` subscribes to `usePhotoWorkspace`. It writes `photoResume = { source, placementId: shapeId, documentId }` only when all of these hold:
  - `shapeId` and `documentId` are set.
  - The workspace `projectId` equals `activeId`.
  - The project isn't `transitioning`.
  - `smartTrail` is empty, so the parent image stays remembered while smart object contents are open.
  - The value differs from the current one.
- **Closing on purpose:** `closeImageEditor` returns without doing anything while `busy`. Otherwise it calls `close()` first, then sets `photoResume: null`.
- **Automatic closes keep it:** the automatic closes (`PhotoStudio.tsx:508`, `XDesignApp.tsx:157`, `runtime.ts:275`) stay as `close()` and keep `photoResume`.
- **`resumableImage`** returns the current `photoResume` only if its image still exists:
  - **Legacy:** a `shapes` entry with that id, `kind === "image"` and `photoDocumentId === documentId`.
  - **Pencil:** `pencilPhotoDocumentId(placementId) === documentId`.
  - **Both:** `photoDocuments[documentId]` exists.
- **`resumeImageEditor(projectId)`:**
  - It does nothing in these cases:
    - The project isn't active.
    - The workspace is already open on this project.
    - `photoResume` is null.
    - The source is Pencil and no Pencil editor is mounted yet.
  - Otherwise it opens the image with `editImage` or `editPencilImage`.
  - If `resumableImage()` is null, or the open rejects, it sets `photoResume: null` and `usePhotoWorkspace.error: null`, but only while the same project is still active and not transitioning. It shows no toast.
- **`XDesignApp`:**
  - `useEffect(() => startOpenImageTracking(), [])`.
  - A resume effect on `[activeId, transitioning, imageReady]` calls `resumeImageEditor(activeId)` once per activation. A ref holds the id last resumed and is reset when `activeId` is null. The effect runs only when not `transitioning` and `imageReady` (line 153).
- **PhotoStudio:** the three user close sites replace `usePhotoWorkspace.getState().close()` with `closeImageEditor()`. The smart-contents branch stays.
- **Persistence:**
  - `snapshotActiveDoc` writes `photoResume: s.photoResume`.
  - `hydrate` reads `snapshot.photoResume ?? null`, and the reset branch sets `null`.
  - Line 392 also compares `state.photoResume !== previous.photoResume`.
- **Archives:** `local_only` also removes `"photoResume"`, so copies, exports and imports open on the board.

- [ ] **Step 1: Write the failing tests** in `resume.test.ts`. Mock `./runtime` as `PhotoStudio.tools.test.tsx` does: the original module plus `editImage: vi.fn()`. Mock `../pencil/runtime` the same way: the original plus `editPencilImage: vi.fn()` and `pencilPhotoDocumentId: vi.fn()`. Use the real stores.

```ts
it("remembers the open image with the project, through undo and a restart", () => {
  // tracking started; workspace open on shape/doc → photoResume {source:"legacy",placementId:shape,documentId:doc.id}
  // applyPhotoDocument(new version) + undo → unchanged
  // snapshot → JSON → validateDesignDoc → hydrate(null) → null → hydrate(snapshot) → equal
});
it("forgets it when you close the editor, and undo doesn't bring it back", () => {
  // closeImageEditor() → workspace documentId null, photoResume null; undo → null
  // with busy:true → closeImageEditor() leaves both untouched
});
it("keeps it through the automatic close on a project switch", () => { /* close() → unchanged */ });
it("keeps the image itself while its smart object contents are open", () => { /* smartTrail non-empty, other documentId → unchanged */ });
it("doesn't record an editor left open on another project", () => { /* workspace projectId ≠ activeId, or transitioning → unchanged */ });
it("reopens straight into the image editor on the remembered image", async () => {
  // legacy → editImage(shape); pencil (pencilPhotoDocumentId → doc.id, editor mounted) → editPencilImage(node)
});
it("opens on the board, quietly, when the image is gone", async () => {
  // placement missing; documentId mismatch; editImage rejects → each: photoResume null, workspace error null,
  // toast.error not called, editImage not called in the first two
});
it("leaves it alone for a project that's no longer active, or a Pencil board still loading", async () => { /* unchanged, no open */ });
it("validates the remembered image's shape", () => {
  // validateDesignDoc rejects photoResume: {source:"x",…}, {placementId:""}, {documentId:"not-an-id"}, [] ; accepts null and a dangling valid one
});
```

  `PhotoStudio.tools.test.tsx`: add `it("Close and the house button forget the open image")`, which sets `photoResume`, then presses Mod+W and expects `null`. It reopens, sets `photoResume` again, clicks "Back to design", and expects `null`.

  `xdesign_archive.rs`: in the existing photoSavePaths test, also set `doc["photoResume"]`, and assert it is absent on each of the same export, import, crafted-archive and clone outputs.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/apps/xdesign/photo/resume.test.ts src/apps/xdesign/photo/PhotoStudio.tools.test.tsx`
  Expected: FAIL, because `./resume` is not found.

- [ ] **Step 3: Implement** the rules above.

- [ ] **Step 4: Run the tests to verify they pass**

  Run the Step 2 command, plus `src/apps/xdesign/photo/savePaths.test.ts src/apps/xdesign/projectsStore.test.ts` and `cd src-tauri && cargo test --lib xdesign_archive`.
  Expected: all PASS.

- [ ] **Step 5: Check the changed files:** `git status --short` shows only this task's files added. No commit.

---

### Task 3: Preview files on disk

**Files:**
- Create: `src-tauri/src/xdesign_preview.rs`
- Modify: `src-tauri/src/lib.rs`, the `mod` list near line 6 and the command list near 550
- Test: in-module `#[cfg(test)] mod tests`

**Interfaces:**
- Produces Tauri commands, called with camelCase args from JS:
  - `xdesign_preview_write(project_id: String, png: Vec<u8>) -> Result<PreviewEntry, String>`
  - `xdesign_preview_list() -> Result<HashMap<String, PreviewEntry>, String>`
  - `xdesign_preview_delete(project_id: String) -> Result<(), String>`
- `PreviewEntry { path: String, revision: u64 }` derives `Serialize` with `rename_all = "camelCase"`.
- Pure helpers that take `dir: &Path`: `write_preview(dir, id, png)`, `list_previews(dir)`, `delete_preview(dir, id)`.

**Rules:**
- **Directory:** `app_data_dir()/assets/xdesign-previews/`. That is inside the existing asset scope `$APPDATA/assets/**`, and outside `assets/xdesign`, so the photo-storage sweep never sees it.
- **File name:** `<ULID>.png`, using the canonical form `ulid::Ulid::from_string(id)?.to_string()`.
- **Accepted bytes:** must start with `\x89PNG\r\n\x1a\n` and be at most `4 * 1024 * 1024` bytes.
- **Write:** through `crate::fs_ops::atomic_write_bytes`.
- **`revision`:** the file's mtime in microseconds.
- **List:** a missing directory gives an empty map. Anything not named `<ULID>.png` is skipped.
- **Delete:** a missing file is `Ok`.

- [ ] **Step 1: Write the failing tests**, using the temp-dir pattern from `asset.rs` `snapshot_tests`.
  - `writes_one_preview_per_project_and_lists_it`:
    - Two writes for one id give a list of length 1, the file holds the second bytes, and the second revision is at least the first.
    - A lower-case id writes the same upper-case file.
  - `refuses_bad_ids_non_png_and_oversized_previews`:
    - `"../x"`, `"not-a-ulid"`, `b"GIF89a…"`, and PNG magic padded to `4 MiB + 1` all give `Err`.
    - The directory has no `.png` files afterwards.
  - `list_skips_strays_and_delete_tolerates_missing`:
    - `notes.txt`, `<ULID>.png.tmp` and `nope.png` are not listed.
    - Deleting twice gives `Ok` both times.
    - Listing a missing directory gives an empty map.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd src-tauri && cargo test --lib xdesign_preview`
  Expected: FAIL to compile, because the helpers are missing.

- [ ] **Step 3: Implement the module and register the three commands.**

- [ ] **Step 4: Run the tests to verify they pass**

  Run the Step 2 command.
  Expected: 3 passed.

- [ ] **Step 5: Check the changed files:** `git status --short`. No commit.

---

### Task 4: Capturing previews while a project is open

**Files:**
- Create:
  - `src/apps/xdesign/projectPreview.ts`
  - `src/apps/xdesign/previewCapture.ts`
  - `src/apps/xdesign/previewImage.ts`
- Modify:
  - `src/apps/xdesign/pencil/runtime.ts`: add after `exportPencilContents`, around 497
  - `src/apps/xdesign/projectsStore.ts`: `openProject` at 521, `closeTab` at 533, `goHome` at 555, `deleteProject` at 569
  - `src/apps/xdesign/XDesignApp.tsx`
- Test:
  - Create `src/apps/xdesign/projectPreview.test.ts` and `src/apps/xdesign/previewCapture.test.ts`
  - Modify `src/apps/xdesign/projectsStore.test.ts`

**Interfaces:**
- Consumes:
  - Task 3's commands.
  - Task 2's `resumableImage()`.
  - Existing:
    - `computeExportBounds` and `renderPngBytes` (`exportXD.ts`)
    - `renderFxSnapshot` (`fx/fxExport.ts`, using the scene from the store `snapshotFxDoc` reads)
    - `getModelRenderBridge` (`model3d/modelRenderBridge.ts`)
    - `useHtmlArtifact` (`projectId`, `open`)
- Produces:

```ts
// projectPreview.ts
export const PREVIEW_MAX_EDGE = 640, PREVIEW_IDLE_MS = 1500, PREVIEW_THROTTLE_MS = 15_000, PREVIEW_LEAVE_BUDGET_MS = 400;
export type PreviewEntry = { path: string; revision: number };
export const useProjectPreviews: UseBoundStore<StoreApi<{ entries: Record<string, PreviewEntry>; loaded: boolean;
  load(): Promise<void>; noteWritten(id: string, entry: PreviewEntry): void; forget(id: string): void }>>;
export function startPreviewTracking(): () => void;
export function settlePreview(projectId: string, budgetMs?: number): Promise<void>;
export function deleteProjectPreview(projectId: string): Promise<void>;
// previewCapture.ts
export type PreviewPicture = Uint8Array | "clear" | null;   // bytes → store; "clear" → delete stored; null → can't draw now
export function captureProjectPicture(projectId: string, maxEdge: number): Promise<PreviewPicture>;
// previewImage.ts
export function loadImageBitmap(path: string): Promise<ImageBitmap>;            // fetch(convertFileSrc(path)) → createImageBitmap
export function scaleToPng(source: CanvasImageSource, width: number, height: number, maxEdge: number): Promise<Uint8Array>;
// pencil/runtime.ts
export function capturePencilPreview(maxEdge: number): Promise<Uint8Array | "empty" | null>;
```

**Scheduling (`projectPreview.ts`):** the tests below don't determine all of this.
- **Dirty set:** `startPreviewTracking` subscribes to `useXDProjects` and adds the active id to a dirty `Set` in two cases: when the id becomes active, and when its registry `updatedAt` changes. Autosave flushes and Task 1's image saves both bump `updatedAt`.
- **Input:** listeners on `window` for `pointerdown`, `pointermove`, `keydown` and `wheel` (capture, passive) record the last input time.
- **The timer:** a single timer starts a capture for the active project only when all of these hold. Otherwise it re-arms for the earliest moment they could:
  - The project is dirty.
  - No capture is in flight.
  - The project isn't `transitioning`.
  - Neither `usePhotoWorkspace.busy` nor `usePencilWorkspace.busy` is set.
  - There has been no input for `PREVIEW_IDLE_MS`.
  - `PREVIEW_THROTTLE_MS` has passed since the last capture started. The first capture after tracking starts isn't throttled.
- **A capture:**
  - It removes the id from dirty and records `{ projectId, abandoned: false }`.
  - It awaits `(await import("./previewCapture")).captureProjectPicture(id, PREVIEW_MAX_EDGE)`.
  - If the job was abandoned, or `activeId !== projectId`, it writes nothing and re-marks the project dirty.
  - `null` re-marks it dirty and re-arms the timer.
  - `"clear"` invokes `xdesign_preview_delete` and calls `forget`.
  - Bytes invoke `xdesign_preview_write` with `{ projectId, png: Array.from(bytes) }` and call `noteWritten`.
  - Errors call `log.warn` and re-mark it dirty.
- **`settlePreview(id, budget = PREVIEW_LEAVE_BUDGET_MS)`:**
  - If `id` is dirty and nothing is in flight, it starts a capture now. That ignores idle, throttle and `transitioning`, but still skips a busy photo or Pencil operation.
  - It then waits for the in-flight capture for up to `budget` ms. On timeout it marks that job abandoned and returns.
- **Other rules:**
  - Captures don't use `trackXDesignActivity`, so a background capture never blocks a project switch or shows its "wait" error.
  - With `isTauri()` false, everything is a no-op.
  - The cleanup returned by `startPreviewTracking` removes the listeners, subscription and timer, and resets the dirty set, in-flight job and last-capture time. Tests depend on this.
- **`load()`** invokes `xdesign_preview_list` and sets `loaded: true`. On failure it keeps empty entries and still sets `loaded: true`.
- **`deleteProjectPreview(id)`** calls `forget(id)`, then invokes `xdesign_preview_delete` as best effort, calling `log.warn` on failure.

**Choosing the picture (`previewCapture.ts`):** the first match wins.
1. `useXDProjects.getState().activeId !== projectId`: `null`.
2. The project's Claude page is open (`useHtmlArtifact` `projectId === projectId && open`): `"clear"`. Nothing is drawn.
3. Kind `fx`: `renderFxSnapshot(scene, 0, w, h)`, with `w×h` the scene's `width×height` fitted so the long edge is at most `maxEdge`. Its blob becomes bytes, and a `null` blob gives `null`.
4. Kind `model`: `getModelRenderBridge()?.captureReviewShot()`. No bridge or no canvas gives `null`. Otherwise `scaleToPng(canvas, canvas.width, canvas.height, maxEdge)`.
5. `resumableImage()` is set: `loadImageBitmap(photoDocuments[documentId].previewPath)`, then `scaleToPng(bitmap, bitmap.width, bitmap.height, maxEdge)`, then `bitmap.close()`.
6. `useXDesign.getState().pencilDocument` is set: `capturePencilPreview(maxEdge)`, where `"empty"` gives `"clear"`.
7. Legacy board: `computeExportBounds(shapes, new Set())`. `null` gives `"clear"`. Otherwise `renderPngBytes(bounds, maxEdge)`, where `null` gives `null`, and bytes come back as a `Uint8Array`.

**`scaleToPng`:** draws onto a canvas sized to fit `maxEdge` without upscaling, then encodes with `toBlob("image/png")`.

**`capturePencilPreview`:**
- **What it renders:** the top-level children of the current page in the live `editor.graph`, using the raster tail of `exportPencilContents` (around 489-494): `io.computeContentBounds`, `expandRasterBounds`, `renderer.prepareForExport` with `restore`, and `withRasterBoundsPadding` with `renderDesignNodes(..., { format: "PNG", scale, quality: .95 })`.
- **Scale:** `min(1, maxEdge / longest edge of the expanded bounds)`.
- **What it skips:** `withPencilTask`, `trackXDesignActivity`, `withCanvasResourceRead` and the full-resolution image fetch. The canvas's own image bytes are plenty at 640 px.
- **Returns:**
  - `null` when there's no editor or renderer, or the editor changed across an await.
  - `"empty"` when there are no children or no bounds.
- **If `prepareForExport` can't take the live graph:** clone it with `deserializeGraph(serializeGraph(...))` as export does, still without the image fetch.
- **Testing:** CanvasKit doesn't run in jsdom, so this function has no unit test. The Task 6 live check covers it.

**`projectsStore.ts`:**
- **Leaving a project:** add `async function leaveActive()`. It reads `activeId`, awaits `flushActive()`, then `await settlePreview(id)`. It replaces `await flushActive()` in `openProject`, `goHome`, and in `closeTab` when the tab being closed is active. The settle then sees the flush's `updatedAt` bump, while the project is still active and before the next project hydrates.
- **Deleting a project:** after `commitProjectState` succeeds, `deleteProject` awaits `deleteProjectPreview(id)`.
- **`XDesignApp.tsx`:** `useEffect(() => startPreviewTracking(), [])`.

- [ ] **Step 1: Write the failing tests.**

  `projectPreview.test.ts`:
  - Use fake timers.
  - Mock `./previewCapture`.
  - Mock `@tauri-apps/api/core` as `{ invoke, isTauri: () => true, convertFileSrc: p => p }`.
  - Call `startPreviewTracking()` in `beforeEach` and its cleanup in `afterEach`.
  - Make A active, and "save" by bumping A's `updatedAt` through `useXDProjects.setState`.

```ts
it("captures the open project once it's saved and you've stopped working", async () => {
  // pointermove at t0; +1000ms → capture not called; +600ms → captureProjectPicture(A, 640)
  // invoke("xdesign_preview_write", { projectId: A, png: [...bytes] }); entries[A] equals the reply
});
it("waits while you paint, drag or type", async () => { /* pointermove every 500ms for 10s → no capture; then +1500ms → one */ });
it("doesn't capture during an image or design operation, then catches up", async () => {
  // usePhotoWorkspace busy → none; usePencilWorkspace busy → none; both clear → one capture
});
it("captures at most every 15 seconds", async () => { /* two saves 1s apart → 1 capture until 15s after the first */ });
it("never puts a picture on another project's card when you switch mid-capture", async () => {
  // capture returns a deferred; settlePreview(A) + advance 400ms → settles; activeId = B; resolve with bytes → no write
  // variant without settle: activeId = B before resolving → no write; A is captured again when it's next active
});
it("waits for a quick capture when you leave", async () => {
  // input just happened; settlePreview(A) starts a capture at once; it resolves in 100ms → write for A happens before settle resolves
});
it("removes the stored preview instead of capturing while a Claude page is open", async () => {
  // capture → "clear" → invoke("xdesign_preview_delete", { projectId: A }); entries[A] undefined
});
it("tries again later when the canvas isn't ready", async () => { /* null, then bytes → second capture after the throttle */ });
it("lists stored previews for the home page", async () => { /* load() → entries from xdesign_preview_list, loaded true; rejection → {} and loaded true */ });
```

  `previewCapture.test.ts`:
  - Mock `./exportXD`, `./fx/fxExport`, `./model3d/modelRenderBridge`, `./previewImage` and `./photo/resume` (`resumableImage`).
  - Mock `./pencil/runtime` as the original plus `capturePencilPreview`.
  - Set stores directly.

```ts
it("shows the image you were editing, not the board", async () => { /* loadImageBitmap(doc.previewPath); scaleToPng(bitmap,w,h,640); board renderers not called */ });
it("keeps today's thumbnail while the project's Claude page is open, and draws the board once it's closed", async () => { /* "clear", nothing drawn; open:false → board */ });
it("draws Pencil boards and clears an empty one", async () => { /* bytes → bytes; "empty" → "clear"; null → null */ });
it("draws a legacy board whole, fit to 640", async () => { /* computeExportBounds(shapes, new Set()); renderPngBytes(bounds, 640); no bounds → "clear" */ });
it("draws FX at the start of the timeline, fit to 640", async () => { /* 1920×1080 scene → renderFxSnapshot(scene, 0, 640, 360) */ });
it("draws 3D from the open viewport, and nothing when it isn't mounted", async () => {});
it("draws nothing for a project that isn't the active one", async () => { /* null, no renderer called */ });
```

  `projectsStore.test.ts`: mock `./projectPreview` as `{ settlePreview: vi.fn(async () => {}), deleteProjectPreview: vi.fn(async () => {}) }`.

```ts
it("lets the leaving project's preview finish after it's saved and before the next project loads", async () => {
  // for openProject(B), goHome(), closeTab(active): settlePreview called with A while activeId === A,
  // and after A's registry updatedAt was bumped by the flush
});
it("deletes a project's preview with it, only once the delete is committed", async () => {
  // deleteProjectPreview(id) called; with setXDesignStateAtomic rejecting once → not called
});
```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/apps/xdesign/projectPreview.test.ts src/apps/xdesign/previewCapture.test.ts src/apps/xdesign/projectsStore.test.ts`
  Expected: FAIL, because the modules aren't found.

- [ ] **Step 3: Implement** the three modules, `capturePencilPreview`, the `projectsStore` changes and the `XDesignApp` effect.

- [ ] **Step 4: Run the tests to verify they pass**

  Run the Step 2 command.
  Expected: all PASS.

- [ ] **Step 5: Check the changed files:** `git status --short`. No commit.

---

### Task 5: Home cards show the stored preview

**Files:**
- Modify:
  - `src/apps/xdesign/XDesignHome.tsx`: `ProjectCard` at 104-117, the docs effect at 221-233, and a new mount effect
  - `src/styles/tokens.css`: beside `.xd-thumb-svg` at 7425
- Test: create `src/apps/xdesign/XDesignHome.previews.test.tsx`, copying the render setup from `ProjectImportRecovery.runtime.test.tsx`

**Interfaces:**
- Consumes: `useProjectPreviews` and `PreviewEntry` from Task 4.

**Rules:**
- **On mount:** `XDesignHome` calls `useProjectPreviews.getState().load()`.
- **The card:**
  - With an entry that hasn't failed at its current revision, it renders `<img className="xd-home-card-image" src={`${convertFileSrc(entry.path)}?v=${entry.revision}`} alt="" draggable={false} decoding="async" />`.
  - Its `onError` records that revision as failed, which falls back to the thumbnail.
  - Otherwise it renders `<ProjectThumb doc={doc} />`.
  - The badges stay after it in the DOM.
- **Loading docs:** only once `loaded` is true, and only for projects with `projectKind(m) === "design"` and no entry. The load re-runs when the registry or the set of ids with entries changes.
- **CSS:** `.xd-home-card-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; }`. It sets no colour or spacing, so it needs no tokens.

- [ ] **Step 1: Write the failing tests.**
  - Mock `@tauri-apps/api/core` so that `xdesign_preview_list` returns `{ [A]: { path: "/p/A.png", revision: 7 } }`.
  - Mock `loadDoc` in `./projectsStore` as `vi.fn(async () => null)`.
  - Set up the registry as A (design), C (design) and F (fx).

```ts
it("shows each project's stored preview, fitted, with its revision", async () => {
  // A's card: img.xd-home-card-image with src "/p/A.png?v=7"
});
it("keeps the old thumbnail without a preview, and when the file can't be shown", async () => {
  // C's card has no img and renders ProjectThumb (.xd-thumb-svg or .xd-thumb-empty); fire "error" on A's img → ProjectThumb
});
it("only reads full documents for design projects that have no preview", async () => {
  // loadDoc called with C only, after the list resolved
});
```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run src/apps/xdesign/XDesignHome.previews.test.tsx`
  Expected: FAIL, because no `img` is rendered.

- [ ] **Step 3: Implement** the rules above.

- [ ] **Step 4: Run the tests to verify they pass**

  Run the Step 2 command, plus `src/apps/xdesign/ProjectImportRecovery.runtime.test.tsx`.
  Expected: all PASS.

- [ ] **Step 5: Check the changed files:** `git status --short`. No commit.

---

### Task 6: Gates, build 26, owner checklist, logs

**Files:**
- Modify:
  - `docs/releases/xdesign-alpha-smoke-test.md`: status line, and a new "Home page" checklist block after "Save and export"
  - `PROGRESS.md`
  - `CLAUDE_LOG_ARCHIVE.md`

- [ ] **Step 1: Typecheck.** Run `npm run typecheck`. Expected: exit 0.

- [ ] **Step 2: Focused tests.** Run the test files from Tasks 1, 2, 4 and 5 together, plus `src/apps/xdesign/htmlArtifact.test.ts`. Expected: all PASS.

- [ ] **Step 3: Rust gate.** Run `cd src-tauri && cargo test --lib`. Expected: all pass, with 3 more tests than build 25's 1439.

- [ ] **Step 4: Build 26.** Run `npm run tauri build -- --bundles app`. Expected: exit 0. Don't replace `/Applications/Orion Terminal.app`.

- [ ] **Step 5: Live check on the scratch-HOME release instance.**
  - **The flow:**
    1. Make a Blank canvas, place an image and open it in the image editor.
    2. Paint, then Save As `/tmp/pstest/r2c.psd`.
    3. Go Home. Expect a card named **r2c**, at the top, showing the painted image.
    4. Open it. Expect it back in the image editor on that image.
    5. Press ⌘W, go Home and reopen. Expect the board.
    6. After about 2 s idle, go Home. Expect the board picture.
  - **If UI automation is still blocked** (no Accessibility access): only confirm the instance starts, then quit, and say the flow is left to the owner checklist.

- [ ] **Step 6: Docs.**
  - **Smoke-test doc:**
    - Status line becomes "builds 24–26".
    - The Home block: each card shows its project, a saved image's project goes to the top with the file's name, reopening resumes the image, ⌘W lands on the board next time, FX and 3D cards show their scene, and a Claude page project keeps its old card.
  - **`PROGRESS.md`:** the entry has what changed, gates with counts, next step ("the owner tests build 26"), open questions, branch, and "uncommitted".
  - **`CLAUDE_LOG_ARCHIVE.md`:** a matching entry.

- [ ] **Step 7: Check the changed files:** `git status --short`. No commit. Ask the owner before any commit or push.

---

## Self-review

- **Spec coverage:**

  | Spec item | Task |
  |---|---|
  | Goal 1: previews for every kind, fit, what you'll see | Tasks 4 and 5 |
  | Goal 2: kept current, one behind allowed | Task 4 scheduling and settle |
  | Goal 3: saving goes to the top | Task 1 |
  | Goal 4: resume, user close clears, missing image falls back quietly | Task 2 |
  | Goal 5: names follow Save As | Task 1 |
  | Non-goal: Claude pages | Task 4 step 2 of the picture choice, and its test |
  | Non-goal: previews not in archives | Task 3's directory is outside the archive allowlist |
  | Constraint: delete commit limit | the preview is deleted after the commit, not inside it |
  | Constraint: WebGL | one FX snapshot at a time, disposed, and its context released, by `renderFxSnapshot`; none per card |
  | Anti-goal: home load cost | Task 5 doc loading |

- **Calls the plan makes:**
  - Every image file write bumps `updatedAt` (Task 1 Decision).
  - `photoResume` is dropped from archives.
  - FX is captured at time 0, 3D at the review angle, and a board shows its whole current page.
  - Leaving a project during a smart object edit resumes the parent image.
- **Type consistency:** `PhotoResume`, `resumableImage`, `PreviewEntry`, `PreviewPicture`, `noteImageSaved(projectId, path, saveAs)` and `capturePencilPreview(maxEdge)` are named the same in every task that uses them.
