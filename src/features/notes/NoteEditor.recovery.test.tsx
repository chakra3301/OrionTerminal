import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ update: vi.fn(), editors: [] as Array<{ document: unknown[]; change?: () => void; off: ReturnType<typeof vi.fn> }> }));
vi.mock("@/lib/db", () => ({ updateNote: fixture.update, logActivity: vi.fn(async () => {}), getAppState: vi.fn(async () => null) }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/embeddingIndexer", () => ({ scheduleReindex: vi.fn(), removeEntityEmbedding: vi.fn(async () => {}) }));
vi.mock("./noteAutoTag", () => ({ scheduleNoteAutoTag: vi.fn() }));
vi.mock("@/components/workspace/workspaceStore", () => ({ useWorkspace: { getState: () => ({ root: {} }) }, allTabs: () => [] }));
vi.mock("@/lib/fileDrop", () => ({ useFileDropZone: vi.fn() }));
vi.mock("@/store/assetsStore", () => ({ useAssetsStore: { getState: () => ({ assets: new Map() }) } }));
vi.mock("./editorBridge", () => ({ registerNoteEditor: vi.fn(), unregisterNoteEditor: vi.fn() }));
vi.mock("./NoteEditorAi", () => ({ NoteAiControllers: () => null }));
vi.mock("./BacklinksPanel", () => ({ BacklinksPanel: () => null }));
vi.mock("./visualizer/BlueprintCanvas", () => ({ BlueprintCanvas: () => null }));
vi.mock("./noteSchema", () => ({ noteSchema: {} }));
vi.mock("@blocknote/mantine", () => ({ BlockNoteView: () => <div data-body /> }));
vi.mock("@blocknote/react", async () => {
  const { useMemo } = await import("react");
  return { useCreateBlockNote: (options: { initialContent?: unknown[] }) => useMemo(() => {
    const editor = { document: options.initialContent ?? [], change: undefined as (() => void) | undefined, off: vi.fn(),
      onChange(callback: () => void) { this.change = callback; return this.off; } };
    fixture.editors.push(editor); return editor;
  }, []) };
});
import { useNotesStore, type Note } from "@/store/notesStore";
import { NoteEditor } from "./NoteEditor";

let root: Root, host: HTMLDivElement;
const body = (text: string) => [{ id: "body", type: "paragraph", content: [{ type: "text", text, styles: {} }] }];
function note(id: string): Note { return { id, title: id, blocks: body(id), plaintext: id, kind: "note", location: "", collectionId: null, parentId: null, favorite: false, tags: [], createdAt: 1, updatedAt: 1 }; }
function input() { return host.querySelector<HTMLInputElement>('[data-orion-note-title]')!; }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); fixture.update.mockReset().mockResolvedValue(undefined); fixture.editors.length = 0;
  useNotesStore.setState({ notes: new Map([["a", note("a")], ["b", note("b")]]), loaded: true, pendingWrites: new Set(), saving: new Set(), deleting: new Set(), drafts: new Map(), saveErrors: new Map() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it("stages a title before debounce and flushes the correct note on navigation", async () => {
  await act(async () => root.render(<NoteEditor noteId="a" />));
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "Title draft");
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(useNotesStore.getState().get("a")?.title).toBe("Title draft");
  expect(useNotesStore.getState().pendingWrites.has("a")).toBe(true); expect(fixture.update).not.toHaveBeenCalled();
  await act(async () => root.render(<NoteEditor noteId="b" />));
  expect(input().value).toBe("b"); expect(fixture.update).toHaveBeenCalledExactlyOnceWith("a", expect.objectContaining({ title: "Title draft" }));
  expect(fixture.editors).toHaveLength(2); expect(fixture.editors[0]!.off).toHaveBeenCalledOnce();
});

it("retains a failed body across editor remount and exposes a working retry button", async () => {
  fixture.update.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => root.render(<NoteEditor noteId="a" />));
  await act(async () => { fixture.editors[0]!.document = body("Retained body"); fixture.editors[0]!.change!(); });
  expect(useNotesStore.getState().get("a")?.plaintext).toBe("Retained body"); expect(fixture.update).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(510));
  expect(host.textContent).toContain("status : unsaved"); expect(host.querySelector('[aria-label="Retry save"]')).not.toBeNull();
  await act(async () => root.render(<NoteEditor noteId="b" />));
  await act(async () => root.render(<NoteEditor noteId="a" />));
  expect(fixture.editors.at(-1)!.document).toEqual(body("Retained body"));
  expect(fixture.update).toHaveBeenCalledOnce();
  await act(async () => host.querySelector<HTMLButtonElement>(".note-save-status button")!.click());
  expect(fixture.update).toHaveBeenLastCalledWith("a", expect.objectContaining({ plaintext: "Retained body" }));
  expect(host.querySelector(".note-save-status")).toBeNull();
});

it("does not save a stale or unchanged editor merely because it unmounts", async () => {
  await act(async () => root.render(<NoteEditor noteId="a" />));
  fixture.editors[0]!.document = body("not a user edit");
  await act(async () => root.render(<NoteEditor noteId="b" />));
  expect(fixture.update).not.toHaveBeenCalled(); expect(useNotesStore.getState().get("a")?.plaintext).toBe("a");
});

it("does not mount an editable blank body for a corrupt stored note", async () => {
  useNotesStore.setState({ notes: new Map([["a", { ...note("a"), readError: "Stored body invalid; restore a backup" }]]) });
  await act(async () => root.render(<NoteEditor noteId="a" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Stored body invalid");
  expect(fixture.editors).toHaveLength(0); expect(fixture.update).not.toHaveBeenCalled();
});
