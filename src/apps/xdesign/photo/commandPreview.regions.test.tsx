import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePhotoCommandPreview, type PhotoPreviewRegion } from "./commandPreview";
import type { PhotoDocument } from "./types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const doc: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 800, height: 600, previewWidth: 80, previewHeight: 60, bundlePath: "", previewPath: "", originalPath: null };
const a: PhotoPreviewRegion = { x: 10, y: 12, width: 40, height: 30, scale: 4 };
const b: PhotoPreviewRegion = { x: 80, y: 12, width: 40, height: 30, scale: 4 };
let root: Root, container: HTMLDivElement, create: ReturnType<typeof vi.fn<(object: Blob | MediaSource) => string>>, revoke: ReturnType<typeof vi.fn<(url: string) => void>>;

function tile(region: PhotoPreviewRegion, png = "AQ==") { return { ...region, pixelWidth: Math.ceil(region.width / region.scale), pixelHeight: Math.ceil(region.height / region.scale), png }; }
function reply(regions: PhotoPreviewRegion[] = [], png = "AA==") { return { width: 80, height: 60, png, result: { applied: true }, ...(regions.length ? { tiles: regions.map(region => tile(region, "Ag==")), originalTiles: regions.map(region => tile(region, "Aw==")) } : {}) }; }
function Harness({ regions = [a], exposure = 1, automatic = false, enabled = true, viewKey = "image", width = doc.width }: { regions?: PhotoPreviewRegion[]; exposure?: number; automatic?: boolean; enabled?: boolean; viewKey?: string; width?: number }) {
  const preview = usePhotoCommandPreview({ ...doc, width, version: doc.version }, "project", "filter.blurGallery.fieldBlur", { exposure }, { automatic, enabled, delay: 100, viewKey, regions });
  return <div data-url={preview.url ?? ""} data-error={preview.error ?? ""} data-loading={preview.loading} data-stale={preview.stale}>
    <button disabled={preview.loading} onClick={() => void preview.preview()}>Preview</button>
    <span data-result={preview.result ? "yes" : "no"} />
    <output data-tiles={JSON.stringify(preview.tiles)} data-original={JSON.stringify(preview.originalTiles)} />
  </div>;
}
const render = async (props: Parameters<typeof Harness>[0] = {}) => act(async () => root.render(<Harness {...props} />));
const click = async () => act(async () => container.querySelector("button")!.click());
const urls = (name: "tiles" | "original") => JSON.parse(container.querySelector("output")!.getAttribute(`data-${name}`)!) as { url: string; x: number }[];
const baseURL = () => container.querySelector("[data-url]")!.getAttribute("data-url");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.invoke.mockReset();
  create = vi.fn().mockImplementation((_object: Blob | MediaSource) => `blob:${create.mock.calls.length}`); revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static override createObjectURL(object: Blob | MediaSource) { return create(object); } static override revokeObjectURL(url: string) { revoke(url); } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("region-backed native command previews", () => {
  it("keeps the same-parameter base preview while replacing filtered/original tiles for the latest pan", async () => {
    vi.useFakeTimers(); native.invoke.mockResolvedValueOnce(reply([a])).mockResolvedValueOnce(reply([b]));
    await render(); await click();
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "filter.blurGallery.fieldBlur", params: { exposure: 1 }, regions: [a] }));
    expect(baseURL()).toBe("blob:1"); expect(urls("tiles")).toMatchObject([{ x: 10, url: "blob:2" }]); expect(urls("original")).toMatchObject([{ x: 10, url: "blob:3" }]);
    await render({ regions: [b] });
    expect(baseURL()).toBe("blob:1"); expect(urls("tiles")).toEqual([]); expect(revoke).toHaveBeenCalledWith("blob:2"); expect(revoke).toHaveBeenCalledWith("blob:3");
    await act(async () => vi.advanceTimersByTime(100));
    expect(native.invoke).toHaveBeenCalledTimes(2); expect(native.invoke.mock.calls[1]![1].regions).toEqual([b]);
    expect(baseURL()).toBe("blob:1"); expect(urls("tiles")).toMatchObject([{ x: 80, url: "blob:4" }]); expect(urls("original")).toMatchObject([{ x: 80, url: "blob:5" }]);
  });

  it("coalesces viewport changes during an in-flight manual render and accepts its base but not obsolete tiles", async () => {
    vi.useFakeTimers(); let finish!: (value: unknown) => void;
    native.invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(reply([{ ...b, x: 140 }]));
    await render(); await click(); await render({ regions: [b] }); await render({ regions: [{ ...b, x: 140 }] });
    await act(async () => finish(reply([a])));
    expect(baseURL()).toBe("blob:1"); expect(urls("tiles")).toEqual([]); expect(create).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(100));
    expect(native.invoke).toHaveBeenCalledTimes(2); expect(native.invoke.mock.calls[1]![1].regions).toEqual([{ ...b, x: 140 }]);
    expect(urls("tiles")).toMatchObject([{ x: 140, url: "blob:2" }]);
  });

  it("refreshes regions after a successful manual preview without automatic parameter previewing", async () => {
    vi.useFakeTimers(); native.invoke.mockResolvedValueOnce(reply([a])).mockResolvedValueOnce(reply([b]));
    await render(); await click(); await render({ regions: [b] }); await act(async () => vi.advanceTimersByTime(100));
    expect(native.invoke).toHaveBeenCalledTimes(2); expect(native.invoke.mock.calls[1]![1]).toMatchObject({ params: { exposure: 1 }, regions: [b] });
    await render({ regions: [b], exposure: 2 }); await act(async () => vi.advanceTimersByTime(500));
    expect(native.invoke).toHaveBeenCalledTimes(2); expect(urls("tiles")).toEqual([]); expect(baseURL()).toBe("");
  });

  it("rejects mismatched, missing, oversized and invalid regions without publishing partial URLs or retrying", async () => {
    vi.useFakeTimers();
    const mismatched = reply([a]); mismatched.originalTiles![0]!.x += 1;
    const oversized = reply([a]); oversized.tiles![0]!.png = "A".repeat(2 * 1024 * 1024 + 1);
    native.invoke.mockResolvedValueOnce(mismatched).mockResolvedValueOnce({ ...reply([a]), originalTiles: undefined }).mockResolvedValueOnce(oversized);
    await render(); await click(); expect(container.textContent).toContain("Preview"); expect(container.querySelector("[data-error]")!.getAttribute("data-error")).toContain("mismatched region"); expect(create).not.toHaveBeenCalled();
    await click(); expect(container.querySelector("[data-error]")!.getAttribute("data-error")).toContain("invalid region"); expect(create).not.toHaveBeenCalled();
    await click(); expect(container.querySelector("[data-error]")!.getAttribute("data-error")).toContain("invalid region"); expect(create).not.toHaveBeenCalled();
    await render({ regions: [{ ...a, scale: 3 }] }); await click(); expect(container.querySelector("[data-error]")!.getAttribute("data-error")).toContain("regions are invalid");
    expect(native.invoke).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTime(500)); expect(native.invoke).toHaveBeenCalledTimes(3);
  });

  it("publishes no URLs when allocation fails and revokes every URL allocated by the failed response", async () => {
    native.invoke.mockResolvedValueOnce(reply([a]));
    create.mockImplementationOnce(() => "blob:partial-base").mockImplementationOnce(() => { throw new Error("URL allocation failed"); });
    await render(); await click();
    expect(container.querySelector("[data-error]")!.getAttribute("data-error")).toContain("URL allocation failed");
    expect(baseURL()).toBe(""); expect(urls("tiles")).toEqual([]); expect(revoke).toHaveBeenCalledWith("blob:partial-base");
  });

  it("hides detail tiles for fit without rendering another base preview", async () => {
    native.invoke.mockResolvedValueOnce(reply([a])); await render(); await click();
    expect(urls("tiles")).toHaveLength(1);
    await render({ regions: [] });
    expect(urls("tiles")).toEqual([]); expect(baseURL()).toBe("blob:1"); expect(native.invoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:2"); expect(revoke).toHaveBeenCalledWith("blob:3");
  });

  it("drops details on source, parameter, disable and unmount changes and ignores stale replies", async () => {
    let finish!: (value: unknown) => void; native.invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render(); await click(); await render({ regions: [b], viewKey: "other" }); await act(async () => finish(reply([a])));
    expect(create).not.toHaveBeenCalled(); expect(baseURL()).toBe("");
    native.invoke.mockResolvedValueOnce(reply([b])).mockResolvedValue(reply([a])); await click(); expect(urls("tiles")).toHaveLength(1);
    await render({ regions: [a], exposure: 2 }); expect(urls("tiles")).toEqual([]);
    await render({ regions: [a], exposure: 2, enabled: false }); expect(baseURL()).toBe("");
    await render({ regions: [a], exposure: 2, enabled: true }); await click();
    act(() => root.unmount()); expect(revoke).toHaveBeenCalledWith("blob:4");
  });
});

it('accepts paired images exceeding 2 MiB in total and checks the combined bound before decoding details', async () => {
  const region = { x: 0, y: 0, width: 512, height: 512, scale: 1 };
  const data = reply([region]);
  data.tiles![0]!.png = data.originalTiles![0]!.png = 'A'.repeat(2 * 1024 * 1024);
  const decode = vi.spyOn(globalThis, 'atob').mockReturnValue('\0');
  native.invoke.mockResolvedValueOnce(data);
  await render({ regions: [region] }); await click();
  expect(urls('tiles')).toHaveLength(1); expect(urls('original')).toHaveLength(1);
  const crowded = reply(Array.from({ length: 8 }, () => region), 'A'.repeat(24 * 1024 * 1024));
  for (const image of [...crowded.tiles!, ...crowded.originalTiles!]) image.png = 'A'.repeat(2 * 1024 * 1024);
  native.invoke.mockResolvedValueOnce(crowded); decode.mockClear(); const before = create.mock.calls.length;
  await render({ regions: Array.from({ length: 8 }, () => region) }); await click();
  expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toContain('invalid image data');
  expect(create).toHaveBeenCalledTimes(before); expect(decode).toHaveBeenCalledTimes(1);
  decode.mockRestore();
});

it('does not retry a failed automatic region preview until an explicit retry or a changed request', async () => {
  vi.useFakeTimers(); native.invoke.mockRejectedValueOnce(new Error('native refusal')).mockResolvedValueOnce(reply([a]));
  await render({ automatic: true }); await act(async () => vi.advanceTimersByTime(100));
  expect(native.invoke).toHaveBeenCalledOnce(); expect(baseURL()).toBe('');
  await act(async () => vi.advanceTimersByTime(1000)); expect(native.invoke).toHaveBeenCalledOnce();
  await click(); expect(baseURL()).toBe('blob:1'); expect(urls('tiles')).toHaveLength(1);
});

it('refuses fractional and out-of-u32 coordinates without invoking native work', async () => {
  for (const region of [{ ...a, x: .5 }, { ...a, width: 1.5 }, { ...a, y: 0x1_0000_0000 }]) {
    await render({ regions: [region] }); await click();
    expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toContain('regions are invalid');
  }
  expect(native.invoke).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
});

it('replaces an explicitly rerendered base and abandons replies when source dimensions change', async () => {
  native.invoke.mockResolvedValueOnce(reply([a])).mockResolvedValueOnce({ ...reply([a]), result: { refreshed: true } });
  await render(); await click(); await click();
  expect(baseURL()).toBe('blob:4'); expect(revoke).toHaveBeenCalledWith('blob:1');
  let finish!: (value: unknown) => void;
  native.invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await click(); const allocations = create.mock.calls.length;
  await render({ width: 700 }); await act(async () => finish(reply([a])));
  expect(baseURL()).toBe(''); expect(create).toHaveBeenCalledTimes(allocations);
});

it('abandons a pending render through a busy/disabled interval even when reenabled before its reply', async () => {
  let finish!: (value: unknown) => void;
  native.invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(reply([a]));
  await render(); await click(); await render({ enabled: false }); await render({ enabled: true });
  await act(async () => finish(reply([a])));
  expect(create).not.toHaveBeenCalled(); expect(baseURL()).toBe(''); expect(urls('tiles')).toEqual([]);
  await click(); expect(baseURL()).toBe('blob:1'); expect(urls('tiles')).toHaveLength(1);
});
