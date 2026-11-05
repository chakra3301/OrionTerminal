// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SidecarTools } from "./SidecarTools";
import { useArchiveSearchRevision } from "@/lib/archiveSearchRevision";
import type { AssetExtras } from "./sidecarTypes";

const api = vi.hoisted(() => ({ inspect: vi.fn(), export: vi.fn(), index: vi.fn(), clear: vi.fn(), cancel: vi.fn(), search: vi.fn(), route: vi.fn() }));
vi.mock("./sidecarTypes", () => ({ sidecarApi: api }));
vi.mock("../searchNav", () => ({ routeToSearchHit: api.route }));
vi.mock("../runtimeActivity", () => ({ withArchivesActivity: (_key: string, _why: string, work: () => Promise<unknown>) => work() }));

const details = (assetId = "saved-A"): AssetExtras => ({ reviewId: "native-review", assetId, title: "Generated clip", duration: 4, tracks: [{ index: 3, codec: "mov_text", language: "pt-BR", title: "Portuguese", supported: true }, { index: 8, codec: "hdmv_pgs_subtitle", language: "und", title: "", supported: false }], chapters: [{ start: 0, end: 4, title: "Generated" }], indexed: null });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((r, e) => { resolve = r; reject = e; }); return { promise, resolve, reject }; }
let host: HTMLDivElement; let root: Root;
const text = () => host.textContent ?? "";
function button(label: string) { const b = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === label); if (!b) throw new Error(`Missing button ${label}`); return b; }
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function mount(assetId = "saved-A") { await act(async () => root.render(<SidecarTools assetId={assetId} />)); }
async function query(value: string) { await act(async () => { const input = host.querySelector("input")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.values(api).forEach((m) => m.mockReset());
  api.inspect.mockResolvedValue(details()); api.export.mockResolvedValue(null); api.index.mockResolvedValue({ streamIndex: 3, language: "pt-BR", cues: 2, stale: false }); api.clear.mockResolvedValue(undefined); api.cancel.mockResolvedValue(undefined); api.search.mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await mount();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("saved-file sidecars", () => {
  it("offers chapter seeking only after explicit saved-file inspection and never starts playback",async()=>{
    const seek=vi.fn();await act(async()=>root.render(<SidecarTools assetId="saved-A" onSeek={seek}/>));
    expect(host.textContent).not.toContain("Jump to chapter");expect(seek).not.toHaveBeenCalled();
    await click("Inspect saved file");await click("Generated");expect(seek).toHaveBeenCalledExactlyOnceWith(0);expect(api.index).not.toHaveBeenCalled();expect(api.export).not.toHaveBeenCalled();
  });
  it("performs no inspection, extraction or query merely by rendering or opening the disclosure", async () => {
    await act(async () => { host.querySelector("summary")!.click(); });
    expect(api.inspect).not.toHaveBeenCalled(); expect(api.search).not.toHaveBeenCalled(); expect(api.export).not.toHaveBeenCalled(); expect(api.index).not.toHaveBeenCalled();
    expect(text()).toContain("No remote access, cookies, AI");
  });
  it("exports only a native reviewed actual track, without destination-path input", async () => {
    await click("Inspect saved file");
    expect(api.inspect).toHaveBeenCalledWith(expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/), "saved-A");
    expect(host.querySelectorAll("select option")[1]!.hasAttribute("disabled")).toBe(true);
    await click("Export VTT…");
    expect(api.export).toHaveBeenCalledWith(expect.any(String), "native-review", "vtt", 3);
    expect(api.index).not.toHaveBeenCalled(); expect(text()).toContain("Save canceled. No sidecar or search-index change.");
  });
  it("indexes and clears only on explicit actions and invalidates caption search results", async () => {
    await click("Inspect saved file"); const before = useArchiveSearchRevision.getState().revision;
    await click("Index selected captions");
    expect(api.index).toHaveBeenCalledWith(expect.any(String), "native-review", 3);
    expect(useArchiveSearchRevision.getState().revision).toBeGreaterThan(before); expect(text()).toContain("2 indexed cues");
    await click("Clear caption index");
    expect(api.clear).toHaveBeenCalledWith(expect.any(String), "saved-A"); expect(text()).toContain("Original media and exports kept.");
  });
  it("cancels outstanding work and rejects a late result for a different asset", async () => {
    const pending = deferred<AssetExtras>(); api.inspect.mockReturnValue(pending.promise);
    await click("Inspect saved file"); const id = api.inspect.mock.calls[0]![0];
    await mount("saved-B"); expect(api.cancel).toHaveBeenCalledWith(id);
    await act(async () => pending.resolve(details("saved-A")));
    expect(host.querySelector("select")).toBeNull(); expect(text()).not.toContain("Portuguese");
    api.inspect.mockResolvedValue(details("saved-B")); await click("Inspect saved file"); expect(api.inspect.mock.calls[1]![1]).toBe("saved-B");
  });
  it("requests cancellation on unmount without starting another operation", async () => {
    const pending = deferred<AssetExtras>(); api.inspect.mockReturnValue(pending.promise);
    await click("Inspect saved file"); const id = api.inspect.mock.calls[0]![0];
    await act(async () => root.render(<div />)); expect(api.cancel).toHaveBeenCalledWith(id);
    await act(async () => pending.resolve(details())); expect(api.export).not.toHaveBeenCalled();
  });
  it("keeps Cancel reachable during a native Save dialog and reports finishing refusals", async () => {
    await click("Inspect saved file"); const pending = deferred<string | null>(); api.export.mockReturnValue(pending.promise);
    await click("Export SRT…"); api.cancel.mockRejectedValue(new Error("Finishing the sidecar/index publication. Wait for it to finish."));
    await click("Cancel operation"); expect(text()).toContain("Finishing the sidecar/index publication");
    await act(async () => pending.resolve(null)); expect(api.index).not.toHaveBeenCalled();
  });
  it("ignores cancellation replies for finished operations and different assets", async () => {
    const first = deferred<AssetExtras>(); const lateCancel = deferred<void>(); api.inspect.mockReturnValueOnce(first.promise); api.cancel.mockReturnValueOnce(lateCancel.promise);
    await click("Inspect saved file"); await click("Cancel operation");
    await act(async () => first.resolve(details()));
    const next = deferred<string | null>(); api.export.mockReturnValueOnce(next.promise); await click("Export VTT…");
    await act(async () => lateCancel.resolve()); expect(text()).not.toContain("Cancel requested");
    const oldRefusal = deferred<void>(); api.cancel.mockReturnValueOnce(oldRefusal.promise); await click("Cancel operation");
    await mount("saved-B"); await act(async () => oldRefusal.reject(new Error("Old publication refusal")));
    expect(text()).not.toContain("Old publication refusal");
    await act(async () => next.resolve(null));
  });
  it("does not let old keyword responses replace a newer query and routes explicit hits", async () => {
    const pending = deferred<Array<{ assetId: string; title: string; snippet: string }>>(); api.search.mockReturnValueOnce(pending.promise);
    await query("old words"); await click("Search"); await query("quasar");
    api.search.mockResolvedValue([{ assetId: "saved-B", title: "Generated match", snippet: "quasar inside captions" }]); await click("Search");
    await act(async () => pending.resolve([{ assetId: "old", title: "Stale hit", snippet: "wrong" }]));
    expect(text()).toContain("Generated match"); expect(text()).not.toContain("Stale hit");
    await act(async () => host.querySelector<HTMLButtonElement>(".ar-sidecar-results button")!.click());
    expect(api.route).toHaveBeenCalledWith(expect.objectContaining({ entityId: "saved-B", entityType: "asset" }));
  });
  it("invalidates another mounted panel's index status without automatic file access", async () => {
    await act(async () => root.render(<><SidecarTools assetId="saved-A" /><SidecarTools assetId="saved-A" /></>));
    const panels = host.querySelectorAll(".ar-sidecars");
    for (const panel of panels) await act(async () => (panel.querySelector("button") as HTMLButtonElement).click());
    const localButton = (panel: Element, label: string) => Array.from(panel.querySelectorAll("button")).find((b) => b.textContent === label)!;
    const calls = api.inspect.mock.calls.length;
    await act(async () => localButton(panels[0]!, "Index selected captions").click());
    expect(panels[0]!.textContent).toContain("2 indexed cues");
    expect(panels[1]!.textContent).toContain("Caption index changed elsewhere");
    expect(localButton(panels[1]!, "Clear caption index").disabled).toBe(false);
    expect(api.inspect).toHaveBeenCalledTimes(calls);
  });
  it("releases search busy state when an index revision invalidates a pending search", async () => {
    const pending = deferred<Array<never>>(); api.search.mockReturnValueOnce(pending.promise);
    await query("quasar"); await click("Search"); expect(button("Search").disabled).toBe(true);
    await act(async () => useArchiveSearchRevision.getState().changed()); expect(button("Search").disabled).toBe(false);
    await act(async () => pending.resolve([])); expect(text()).not.toContain("No current indexed media matches.");
  });
});
