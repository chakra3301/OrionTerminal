import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchArchive } from "./db";
import { useArchiveSearchRevision } from "./archiveSearchRevision";
const m = vi.hoisted(() => ({ invoke: vi.fn(), select: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: m.invoke }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: async () => ({ select: m.select }) } }));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
beforeEach(() => { m.invoke.mockReset().mockResolvedValue(false); m.select.mockReset().mockResolvedValue([{ entity_id: "saved", entity_type: "asset", title: "Generated", snip: "quasar captions", note_kind: null, chat_origin: null }]); });
describe("shared caption freshness", () => {
  it("validates matching native caption revisions before reading ranked shared snippets", async () => {
    const hits = await searchArchive("quasar", 24);
    expect(m.invoke).toHaveBeenCalledWith("media_download_refresh_caption_matches", { query: "quasar*" });
    expect(m.invoke.mock.invocationCallOrder[0]).toBeLessThan(m.select.mock.invocationCallOrder[0]!);
    expect(hits[0]!.snippet).toBe("quasar captions");
  });
  it("fails closed rather than returning unvalidated caption snippets", async () => {
    m.invoke.mockRejectedValueOnce(new Error("Native freshness check unavailable"));
    await expect(searchArchive("quasar")).rejects.toThrow("Native freshness check unavailable");
    expect(m.select).not.toHaveBeenCalled();
  });
  it("invalidates other mounted index displays after native stale-cache pruning", async () => {
    m.invoke.mockResolvedValueOnce(true); const before = useArchiveSearchRevision.getState().revision;
    await searchArchive("quasar"); expect(useArchiveSearchRevision.getState().revision).toBeGreaterThan(before);
  });
});
