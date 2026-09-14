import { beforeEach, describe, expect, it, vi } from "vitest";
const select = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn(async () => ({ rowsAffected: 1 })));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn(async () => ({ execute, select })) } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
import { invoke } from "@tauri-apps/api/core";
import { getAppState, setXDesignStateAtomic, updateNote } from "./db";

beforeEach(() => { vi.clearAllMocks(); select.mockReset().mockResolvedValue([]); execute.mockReset().mockResolvedValue({ rowsAffected: 1 }); });
describe("atomic XDesign state IPC", () => {
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
});
