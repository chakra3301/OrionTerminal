import { beforeEach, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ipc", () => ({ ipc: { saveFileAtomic: save } }));
vi.mock("@/lib/db", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/features/context/codebaseIndexer", () => ({ scheduleCodeFileReindex: vi.fn() }));
import { useTabsStore } from "@/store/tabsStore";
import { saveFileBuffer } from "./saveFileBuffer";
import { clearOrionActivities, orionActivityReason } from "./runtimeActivity";
const store = () => useTabsStore.getState();
beforeEach(() => { save.mockReset().mockResolvedValue(undefined); useTabsStore.setState({ fileBuffers: {} }); clearOrionActivities(); store().markLoaded("fixture", "original"); });
it("acknowledges the written snapshot, never newer edits", async () => {
  let release!: () => void; save.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
  store().updateBuffer("fixture", "first"); const pending = saveFileBuffer("fixture");
  await vi.waitFor(() => expect(release).toBeDefined()); store().updateBuffer("fixture", "newer"); release(); await pending;
  expect(store().fileBuffers.fixture).toMatchObject({ original: "first", contents: "newer" });
  await saveFileBuffer("fixture"); expect(store().fileBuffers.fixture).toMatchObject({ original: "newer", contents: "newer" });
});
it("still marks dirty when an edit is undone while a different snapshot saves", async () => {
  let release!: () => void; save.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
  store().updateBuffer("fixture", "written"); const pending = saveFileBuffer("fixture");
  await vi.waitFor(() => expect(release).toBeDefined()); store().updateBuffer("fixture", "original"); release(); await pending;
  expect(store().fileBuffers.fixture).toMatchObject({ original: "written", contents: "original" });
});
it("serializes same-path saves and retains the activity lease until all settle", async () => {
  let release!: () => void; save.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
  store().updateBuffer("fixture", "first"); const first = saveFileBuffer("fixture"); await vi.waitFor(() => expect(release).toBeDefined());
  store().updateBuffer("fixture", "second"); const second = saveFileBuffer("fixture"); await Promise.resolve();
  expect(save).toHaveBeenCalledOnce(); expect(orionActivityReason()).toMatch(/saving files/);
  release(); await first; await second;
  expect(save.mock.calls.map((c) => c[1])).toEqual(["first", "second"]); expect(orionActivityReason()).toBeNull();
});
it("retains dirty contents on failure and the queue permits retry", async () => {
  save.mockRejectedValueOnce(new Error("disk full")); store().updateBuffer("fixture", "draft");
  expect(await saveFileBuffer("fixture")).toBe(false); expect(store().fileBuffers.fixture).toMatchObject({ original: "original", contents: "draft" });
  expect(await saveFileBuffer("fixture")).toBe(true); expect(store().fileBuffers.fixture?.original).toBe("draft");
});
