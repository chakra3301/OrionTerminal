import { beforeEach, describe, expect, it, vi } from "vitest";
const select = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn(async () => ({ rowsAffected: 1 })));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn(async () => ({ execute, select })) } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
import { invoke } from "@tauri-apps/api/core";
import { getAppState, setAppState, setXDesignStateAtomic, updateNote } from "./db";

beforeEach(() => { vi.clearAllMocks(); select.mockReset().mockResolvedValue([]); execute.mockReset().mockResolvedValue({ rowsAffected: 1 }); });
describe("atomic XDesign state IPC", () => {
  it("saves design documents and automatic checkpoints through one native transaction",async()=>{
    const document={pages:[],activePageId:"page"};
    await setAppState("xdesign.project.01ARZ3NDEKTSV4RRFFQ69G5FAV",document);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("xdesign_state_save",{projectId:"01ARZ3NDEKTSV4RRFFQ69G5FAV",document:JSON.stringify(document)});
    expect(execute).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("history disk full"));
    await expect(setAppState("xdesign.project.01ARZ3NDEKTSV4RRFFQ69G5FAV",document)).rejects.toThrow("history disk full");
  });
  it("binds note metadata with body updates and rejects a disappeared row", async () => {
    await updateNote("note", { title: "Title", plaintext: "Body", blocks_json: "[]", collection_id: null, favorite: 1, updated_at: 2 });
    expect(execute).toHaveBeenLastCalledWith(expect.stringContaining("collection_id = $4, favorite = $5"), ["Title", "[]", "Body", null, 1, 2, "note"]);
    execute.mockResolvedValueOnce({ rowsAffected: 0 });
    await expect(updateNote("missing", { title: "Keep draft", updated_at: 3 })).rejects.toThrow(/no longer exists/);
  });
  it("distinguishes missing project state from corrupt JSON without changing legacy readers", async () => {
    expect(await getAppState("xdesign.projects", true)).toBeNull();
    for (const value of ["{truncated", "null"]) {
      select.mockResolvedValue([{ value }]);
      await expect(getAppState("xdesign.projects", true)).rejects.toThrow(/not been overwritten/);
      expect(await getAppState("xdesign.projects")).toBeNull();
    }
    select.mockResolvedValue([{ value: '{"registry":[]}' }]);
    expect(await getAppState("xdesign.projects", true)).toEqual({ registry: [] });
  });
  it("sends registry and document changes through one native transaction", async () => {
    await setXDesignStateAtomic([
      { key: "xdesign.projects", value: { registry: [] } },
      { key: "xdesign.project.01ARZ3NDEKTSV4RRFFQ69G5FAV", value: null },
    ]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("xdesign_state_commit", { writes: [
      { key: "xdesign.projects", value: '{"registry":[]}' },
      { key: "xdesign.project.01ARZ3NDEKTSV4RRFFQ69G5FAV", value: null },
    ] });
  });
  it("propagates transaction failure rather than claiming a saved state", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("commit failed"));
    await expect(setXDesignStateAtomic([{ key: "xdesign.projects", value: { registry: [] } }])).rejects.toThrow("commit failed");
  });
  it('includes the managed asset receipt in the registry transaction', async () => {
    const receipt = { projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' };
    await setXDesignStateAtomic([{ key: 'xdesign.projects', value: { registry: [] } }], receipt);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('xdesign_state_commit', { writes: [{ key: 'xdesign.projects', value: '{"registry":[]}' }], importReceipt: receipt });
  });
});
