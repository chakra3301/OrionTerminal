import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ insertNote: vi.fn(async () => {}), updateNote: vi.fn(), listNotes: vi.fn(), listAllNoteTags: vi.fn() }));
vi.mock("@/lib/embeddingIndexer", () => ({ scheduleReindex: vi.fn(), removeEntityEmbedding: vi.fn() }));
import { collectDrafts, createDraftWriter } from "./draftJournal";
import { useNotesStore, type Note } from "@/store/notesStore";
import { useTabsStore } from "@/store/tabsStore";
import { restoreNoteCopy } from "./RecoveryPanel";
import { insertNote } from "@/lib/db";
const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(151);
it("collects actual staged note title/body and all dirty loaded buffers, not saved files", () => {
  const note: Note = { id, title: "before", blocks: [], plaintext: "", kind: "note", parentId: null, location: "", collectionId: null, tags: [], favorite: false, createdAt: 1, updatedAt: 1 };
  useNotesStore.setState({ notes: new Map([[id, note]]), drafts: new Map(), pendingWrites: new Set(), deleting: new Set() });
  useNotesStore.getState().stageTitle(id, "draft");
  useNotesStore.getState().stageBlocks(id, [{ type: "paragraph", content: [{ type: "text", text: "body" }] }]);
  useTabsStore.setState({ fileBuffers: {} });
  useTabsStore.getState().markLoaded("/clean", "same"); useTabsStore.getState().markLoaded("/dirty", "old"); useTabsStore.getState().updateBuffer("/dirty", "new");
  const captured = JSON.parse(collectDrafts());
  expect(captured).toHaveLength(2); expect(captured[0]).toMatchObject({ kind: "note", id, title: "draft", plaintext: "body" });
  expect(captured[1]).toEqual({ kind: "file", path: "/dirty", contents: "new" });
});
it("coalesces before writing and cannot acknowledge newer edits with an older completion", async () => {
  vi.useFakeTimers(); let finish!: () => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
  const status = vi.fn(); const writer = createDraftWriter(write, status);
  writer.update("one"); writer.update("two"); await tick(); expect(write).toHaveBeenCalledWith(1, "two");
  writer.update("three"); await tick(); expect(write).toHaveBeenCalledOnce();
  finish(); await Promise.resolve(); await Promise.resolve();
  expect(write).toHaveBeenLastCalledWith(2, "three"); expect(status).toHaveBeenLastCalledWith(false, null); writer.dispose();
});
it("keeps failure visible and retries the newest snapshot rather than the failed one", async () => {
  vi.useFakeTimers(); const write = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined), status = vi.fn();
  const writer = createDraftWriter(write, status); writer.update("old"); await tick(); expect(status).toHaveBeenLastCalledWith(true, expect.stringContaining("not written"));
  writer.update("new"); writer.retry(); await Promise.resolve(); expect(write).toHaveBeenLastCalledWith(2, "new"); writer.dispose();
});
it("retries a clearing snapshot after an uncertain acknowledgment even if it equals the old baseline", async () => {
  vi.useFakeTimers(); const write = vi.fn().mockRejectedValueOnce(new Error("lost reply")).mockResolvedValue(undefined);
  const writer = createDraftWriter(write, vi.fn()); writer.update("dirty"); await tick(); writer.update("[]"); writer.retry(); await Promise.resolve();
  expect(write).toHaveBeenLastCalledWith(2, "[]"); writer.dispose();
});
it("clears saved drafts in order and stops queued writes after disposal", async () => {
  vi.useFakeTimers(); const write = vi.fn(async () => {}), status = vi.fn(); const writer = createDraftWriter(write, status);
  writer.update("dirty"); await tick(); writer.update("[]"); await tick(); expect(write).toHaveBeenLastCalledWith(2, "[]");
  writer.update("late"); writer.dispose(); await tick(); expect(write).toHaveBeenCalledTimes(2);
});
it("restores with one insert and a fresh identity, never updating the source note", async () => {
  const next = await restoreNoteCopy({ kind: "note", id, title: "draft", blocksJson: "[]", plaintext: "", noteKind: "journal" });
  expect(next).not.toBe(id);
  expect(insertNote).toHaveBeenCalledWith(expect.objectContaining({ id: next, title: "Recovered · draft", kind: "journal", blocks_json: "[]", parent_id: null, collection_id: null }));
});
