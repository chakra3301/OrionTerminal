import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteRow } from "@/lib/db";
const db = vi.hoisted(() => ({
  listNotes: vi.fn(), listAllNoteTags: vi.fn(async () => new Map()),
  updateNote: vi.fn(), insertNote: vi.fn(), deleteNote: vi.fn(), logActivity: vi.fn(async () => {}),
  upsertTagsByName: vi.fn(), attachNoteTags: vi.fn(), detachNoteTagByName: vi.fn(),
}));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/embeddingIndexer", () => ({ scheduleReindex: vi.fn(), removeEntityEmbedding: vi.fn(async () => {}) }));
vi.mock("@/features/notes/noteAutoTag", () => ({ scheduleNoteAutoTag: vi.fn() }));
vi.mock("@/components/workspace/workspaceStore", () => ({ useWorkspace: { getState: () => ({ root: {} }) }, allTabs: () => [] }));
import { useNotesStore } from "./notesStore";

const rows = new Map<string, NoteRow>();
function row(id: string): NoteRow { return { id, title: "Original", blocks_json: "[]", plaintext: "", parent_id: null, kind: "note", location: "", collection_id: null, favorite: 0, created_at: 1, updated_at: 1 }; }
const blocks = (text: string) => [{ id: "block", type: "paragraph", content: [{ type: "text", text, styles: {} }] }];
const store = () => useNotesStore.getState();
beforeEach(async () => {
  rows.clear(); rows.set("a", row("a")); rows.set("b", row("b")); vi.clearAllMocks();
  db.listNotes.mockReset().mockImplementation(async () => structuredClone([...rows.values()]));
  db.updateNote.mockReset().mockImplementation(async (id, patch) => {
    if (!rows.has(id)) throw new Error("note no longer exists");
    rows.set(id, { ...rows.get(id)!, ...patch });
  });
  db.deleteNote.mockReset().mockImplementation(async (id) => { rows.delete(id); });
  useNotesStore.setState({ notes: new Map(), loaded: false, loadError: null, pendingWrites: new Set(), saving: new Set(), deleting: new Set(), drafts: new Map(), saveErrors: new Map() });
  await store().load();
});

describe("note save recovery", () => {
  it("stages title/body immediately and writes them together on flush", async () => {
    store().stageTitle("a", "Draft title"); store().stageBlocks("a", blocks("draft body"));
    expect(store().pendingWrites.has("a")).toBe(true); expect(db.updateNote).not.toHaveBeenCalled();
    expect(store().get("a")).toMatchObject({ title: "Draft title", plaintext: "draft body" });
    await store().flushNote("a");
    expect(db.updateNote).toHaveBeenCalledOnce(); expect(rows.get("a")).toMatchObject({ title: "Draft title", plaintext: "draft body" });
    expect(store().pendingWrites.size).toBe(0);
  });

  it("retains failed body/title patches across refresh and retries the entire latest draft", async () => {
    db.updateNote.mockRejectedValueOnce(new Error("disk full"));
    await expect(store().saveBlocks("a", blocks("Keep this body"))).rejects.toThrow("disk full");
    store().stageTitle("a", "Keep this title");
    await store().load();
    expect(store().get("a")).toMatchObject({ title: "Keep this title", plaintext: "Keep this body" });
    expect(store().saving.size).toBe(0); expect(store().pendingWrites.has("a")).toBe(true);
    expect(store().saveErrors.get("a")).toMatch(/disk full/);
    await store().flushNote("a");
    expect(rows.get("a")).toMatchObject({ title: "Keep this title", plaintext: "Keep this body" });
    expect(store().pendingWrites.size).toBe(0); expect(store().saveErrors.size).toBe(0);
  });

  it("serializes one note, keeps overlapping work pending, and lets other notes save", async () => {
    let release!: () => void;
    db.updateNote.mockImplementationOnce((id, patch) => new Promise<void>((resolve) => {
      release = () => { rows.set(id, { ...rows.get(id)!, ...patch }); resolve(); };
    }));
    const first = store().saveBlocks("a", blocks("older"));
    await vi.waitFor(() => expect(release).toBeDefined());
    store().stageBlocks("a", blocks("newer"));
    await store().saveTitle("b", "Independent");
    release(); await first;
    expect(store().pendingWrites.has("a")).toBe(true); expect(store().get("a")?.plaintext).toBe("newer");
    await store().flushNote("a");
    expect(rows.get("a")?.plaintext).toBe("newer"); expect(rows.get("b")?.title).toBe("Independent");
    expect(store().pendingWrites.size).toBe(0);
  });

  it("does not clear pending state when the first of two queued writes finishes", async () => {
    let firstDone!: () => void, secondDone!: () => void;
    db.updateNote.mockImplementationOnce(() => new Promise<void>((r) => { firstDone = r; }))
      .mockImplementationOnce(() => new Promise<void>((r) => { secondDone = r; }));
    const first = store().saveTitle("a", "First");
    await vi.waitFor(() => expect(firstDone).toBeDefined());
    const second = store().saveTitle("a", "Second");
    await Promise.resolve();
    expect(db.updateNote).toHaveBeenCalledOnce(); expect(secondDone).toBeUndefined();
    firstDone(); await first;
    await vi.waitFor(() => expect(secondDone).toBeDefined());
    expect(store().pendingWrites.has("a")).toBe(true); expect(store().saving.has("a")).toBe(true);
    secondDone(); await second; expect(store().pendingWrites.size).toBe(0);
  });

  it("a queued metadata edit survives a failed body write and persists its retained patch", async () => {
    db.updateNote.mockRejectedValueOnce(new Error("offline"));
    const bodySave = store().saveBlocks("a", blocks("retained"));
    const collectionSave = store().saveCollection("a", "collection");
    await expect(bodySave).rejects.toThrow(); await collectionSave;
    await store().toggleFavorite("a", true);
    await store().saveLocation("a", "Home"); await store().saveParent("a", "b");
    expect(rows.get("a")).toMatchObject({ plaintext: "retained", collection_id: "collection", favorite: 1, location: "Home", parent_id: "b" });
    expect(store().pendingWrites.size).toBe(0);
  });

  it("clones staged bodies so caller mutation cannot change the persisted snapshot", async () => {
    const body = blocks("snapshot"); store().stageBlocks("a", body); body[0]!.content[0]!.text = "mutated";
    await store().flushNote("a"); expect(rows.get("a")?.plaintext).toBe("snapshot");
    expect(store().get("a")?.blocks).toEqual(blocks("snapshot"));
  });

  it("does not apply a stale refresh over a save completed while loading", async () => {
    let release!: (rows: NoteRow[]) => void;
    const stale = structuredClone([...rows.values()]);
    db.listNotes.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const load = store().load(); await store().saveTitle("a", "Saved while loading");
    release(stale); await load; expect(store().get("a")?.title).toBe("Saved while loading");
  });

  it("keeps the newer refresh when requests finish out of order", async () => {
    let release!: (rows: NoteRow[]) => void;
    db.listNotes.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = store().load(); rows.set("a", { ...row("a"), title: "Newest" }); await store().load();
    release([row("a")]); await old; expect(store().get("a")?.title).toBe("Newest");
  });

  it("serializes deletion after an in-flight save and prevents late editor saves", async () => {
    let release!: () => void;
    db.updateNote.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const save = store().saveTitle("a", "In flight"); await vi.waitFor(() => expect(release).toBeDefined());
    const remove = store().remove("a");
    expect(() => store().stageTitle("a", "Too late")).toThrow(/being deleted/);
    expect(db.deleteNote).not.toHaveBeenCalled(); release(); await save; await remove;
    await store().flushNote("a");
    expect(rows.has("a")).toBe(false); expect(store().get("a")).toBeUndefined(); expect(store().pendingWrites.size).toBe(0);
  });

  it("keeps a failed draft on failed deletion and does not resurrect successful deletion via refresh", async () => {
    store().stageTitle("a", "Keep draft"); db.deleteNote.mockRejectedValueOnce(new Error("delete failed"));
    await expect(store().remove("a")).rejects.toThrow(); expect(store().get("a")?.title).toBe("Keep draft");
    expect(store().pendingWrites.has("a")).toBe(true);
    let release!: (rows: NoteRow[]) => void; const stale = structuredClone([...rows.values()]);
    db.listNotes.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const load = store().load(); await store().remove("a"); release(stale); await load;
    expect(store().get("a")).toBeUndefined(); expect(store().pendingWrites.size).toBe(0);
  });

  it("surfaces load failure without erasing memory and can retry", async () => {
    db.listNotes.mockRejectedValueOnce(new Error("read failed")); await store().load();
    expect(store().loadError).toMatch(/read failed/); expect(store().get("a")?.title).toBe("Original");
    await store().load(); expect(store().loadError).toBeNull();
  });

  it("refuses to overwrite a malformed stored body with an empty note", async () => {
    rows.set("a", { ...row("a"), blocks_json: "{broken" }); await store().load();
    expect(store().get("a")?.readError).toMatch(/invalid/);
    expect(() => store().stageBlocks("a", [])).toThrow(/invalid/);
    expect(db.updateNote).not.toHaveBeenCalled(); expect(rows.get("a")?.blocks_json).toBe("{broken");
  });
});
