import { afterEach, describe, expect, it, vi } from "vitest";
import { watchArchiveCaptionChanges } from "./archiveCaptionEvents";
import { useArchiveSearchRevision } from "./archiveSearchRevision";

const m = vi.hoisted(() => ({ listen: vi.fn(), off: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: m.listen }));
let releases: Array<() => void> = [];
afterEach(async () => { releases.forEach((stop) => stop()); releases = []; await Promise.resolve(); m.listen.mockReset(); m.off.mockReset(); });

describe("native caption cache invalidations", () => {
  it("shares a subscription and invalidates only the affected asset without reading files", async () => {
    m.listen.mockResolvedValue(m.off);
    releases.push(watchArchiveCaptionChanges(), watchArchiveCaptionChanges());
    expect(m.listen).toHaveBeenCalledTimes(1);
    const event = m.listen.mock.calls[0]![1] as (event: { payload: unknown }) => void;
    const before = useArchiveSearchRevision.getState().revision;
    const assetId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    event({ payload: [assetId] });
    expect(useArchiveSearchRevision.getState()).toMatchObject({ revision: before + 1, assetId });
    event({ payload: [] }); expect(useArchiveSearchRevision.getState().assetId).toBeNull();
    const revision = useArchiveSearchRevision.getState().revision;
    event({ payload: ["not a native ID"] }); event({ payload: "bad event" }); event({ payload: Array(257).fill(assetId) });
    expect(useArchiveSearchRevision.getState().revision).toBe(revision);
    releases[0]!(); await Promise.resolve(); expect(m.off).not.toHaveBeenCalled();
    releases[1]!(); await Promise.resolve(); expect(m.off).toHaveBeenCalledTimes(1);
    event({ payload: [] }); expect(useArchiveSearchRevision.getState().revision).toBe(revision);
  });
  it("ignores an old registration while its asynchronous unsubscribe is outstanding", async () => {
    let ready!: (off: () => void) => void;
    m.listen.mockReturnValueOnce(new Promise<() => void>((resolve) => { ready = resolve; })).mockResolvedValue(m.off);
    const stop = watchArchiveCaptionChanges(); releases.push(stop); stop();
    releases.push(watchArchiveCaptionChanges());
    const old = m.listen.mock.calls[0]![1] as (event: { payload: string[] }) => void;
    const current = m.listen.mock.calls[1]![1] as (event: { payload: string[] }) => void;
    const before = useArchiveSearchRevision.getState().revision;
    old({ payload: [] }); expect(useArchiveSearchRevision.getState().revision).toBe(before);
    current({ payload: [] }); expect(useArchiveSearchRevision.getState().revision).toBe(before + 1);
    ready(m.off); await Promise.resolve(); await Promise.resolve(); expect(m.off).toHaveBeenCalledTimes(1);
  });
});
