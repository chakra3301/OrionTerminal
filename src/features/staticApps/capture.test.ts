// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import fixture from "./__fixtures__/source2048.json";
import summaryFixture from "./__fixtures__/capture2048-summary.json";
import { parseCaptureList, parseCaptureSummary, staticCaptures, validateCapture } from "./capture";
import { sourceForPreparation } from "./source";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const record = () => ({ summary: structuredClone(summaryFixture), packet: structuredClone(fixture.sourcePacket) });
beforeEach(() => invoke.mockReset());
describe("immutable native source capture, not installation authority", () => {
  it("revalidates complete pinned bytes and the native serialization/hash golden", async () => {
    const value = record(), validated = await validateCapture(value);
    expect(validated.summary.captureHash).toBe("e134ed3f1e27d9ff1f1f94a2c5e438700096b68aa9f8b1e82fb8ffb26d699557");
    expect(validated.source.sourceHash).toBe(value.summary.sourceHash); expect(sourceForPreparation(validated.source).size).toBe(24);
    expect(Object.isFrozen(validated.summary)).toBe(true); expect(Object.isFrozen(validated.summary.origins[0])).toBe(true);
    expect(invoke).not.toHaveBeenCalled(); expect(validated).not.toHaveProperty("permissions");
  });
  it("detaches packet and summary before its first await", async () => {
    const value = record(), pending = validateCapture(value); value.packet.files[0]!.dataBase64 = "changed"; value.summary.origins[0]!.tree = "b".repeat(40); value.summary.captureHash = "f".repeat(64);
    expect((await pending).summary.captureHash).toBe(summaryFixture.captureHash);
  });
  it("rejects forged source/capture identity, changed bytes and missing inputs", async () => {
    for (const mutate of [
      (r: ReturnType<typeof record>) => { r.summary.sourceHash = "f".repeat(64); },
      (r: ReturnType<typeof record>) => { r.summary.captureHash = "f".repeat(64); },
      (r: ReturnType<typeof record>) => { r.summary.createdAt++; },
      (r: ReturnType<typeof record>) => { r.packet.files.pop(); },
      (r: ReturnType<typeof record>) => { r.packet.files[0]!.dataBase64 = "f".repeat(r.packet.files[0]!.dataBase64.length); },
    ]) { const r = record(); mutate(r); await expect(validateCapture(r)).rejects.toThrow(); }
  });
  it("rejects versions, unknown repositories/refs/trees and duplicate/incomplete origins", () => {
    for (const mutate of [
      (s: typeof summaryFixture) => { s.schemaVersion = 2; },
      (s: typeof summaryFixture) => { s.recipeId = "other"; },
      (s: typeof summaryFixture) => { s.id = s.id.toLowerCase(); },
      (s: typeof summaryFixture) => { s.origins[0]!.requestedRef = "HEAD"; },
      (s: typeof summaryFixture) => { s.origins[0]!.url = "https://private.example/repo"; },
      (s: typeof summaryFixture) => { s.origins.find((o) => o.url.endsWith("/2048"))!.tree = "b".repeat(40); },
      (s: typeof summaryFixture) => { s.origins[0] = { ...s.origins[1]! }; },
      (s: typeof summaryFixture) => { s.origins.pop(); },
      (s: typeof summaryFixture) => { s.totalBytes++; },
      (s: typeof summaryFixture) => { s.createdAt = Number.MAX_SAFE_INTEGER + 1; },
    ]) { const s = structuredClone(summaryFixture); mutate(s); expect(() => parseCaptureSummary(s)).toThrow(); }
  });
  it("refuses unknown fields/accessors/sparse packets without invoking getters", async () => {
    const getter = vi.fn(() => []), r = record(); Object.defineProperty(r.packet, "files", { get: getter });
    await expect(validateCapture(r)).rejects.toThrow(); expect(getter).not.toHaveBeenCalled();
    const s = { ...summaryFixture, extra: true }; expect(() => parseCaptureSummary(s)).toThrow();
    const sparse = record(); delete sparse.packet.files[0]; await expect(validateCapture(sparse)).rejects.toThrow();
    await expect(validateCapture({ ...record(), authority: true })).rejects.toThrow();
  });
  it("bounds and detaches lists without evicting or mutating input", () => {
    expect(() => parseCaptureList(Array(9).fill(summaryFixture))).toThrow(); expect(() => parseCaptureList([summaryFixture, summaryFixture])).toThrow();
    const list = [structuredClone(summaryFixture)], parsed = parseCaptureList(list); list[0]!.origins[0]!.url = "changed";
    expect(parsed[0]!.origins[0]!.url).toBe(summaryFixture.origins[0]!.url); expect(Object.isFrozen(parsed)).toBe(true);
  });
  it("fetch is an explicit fixed-recipe operation; cancellation uses the same bounded job", async () => {
    invoke.mockResolvedValueOnce(record()).mockResolvedValueOnce(undefined);
    const job = "01M3R357PETNKJ71CQ5M5F0B2X"; await staticCaptures.fetch(job); await staticCaptures.cancel(job);
    expect(invoke.mock.calls).toEqual([["intake_static_fetch", { recipeId: "2048-classic-v1", jobId: job }], ["intake_static_cancel", { jobId: job }]]);
  });
  it("rejects invalid job IDs before invoking native code", async () => { await expect(staticCaptures.fetch("bad")).rejects.toThrow(); await expect(staticCaptures.cancel("bad")).rejects.toThrow(); expect(invoke).not.toHaveBeenCalled(); });
  it("read binds the selected exact capture and snapshots selection before awaiting", async () => {
    const selected = parseCaptureSummary(summaryFixture); invoke.mockResolvedValueOnce(record());
    const validated = await staticCaptures.read(selected); expect(validated.summary).toEqual(selected); expect(invoke).toHaveBeenCalledWith("intake_static_read", { id: selected.id, expectedHash: selected.captureHash });
    invoke.mockResolvedValueOnce(record()); await expect(staticCaptures.read({ ...selected, captureHash: "a".repeat(64) })).rejects.toThrow("changed since selection");
  });
  it("list/discard use separate commands with no preparation/install/enable fallback", async () => {
    invoke.mockResolvedValueOnce([summaryFixture]).mockResolvedValueOnce(undefined);
    const saved = await staticCaptures.list(); await staticCaptures.discard(saved[0]!);
    expect(invoke.mock.calls).toEqual([["intake_static_list"], ["intake_static_discard", { id: summaryFixture.id, expectedHash: summaryFixture.captureHash }]]);
  });
  it("does not retry uncertain persistence or swallow native failures", async () => { invoke.mockRejectedValueOnce(new Error("commit could not be confirmed")); await expect(staticCaptures.fetch(summaryFixture.id)).rejects.toThrow("commit could not be confirmed"); expect(invoke).toHaveBeenCalledTimes(1); });
});
