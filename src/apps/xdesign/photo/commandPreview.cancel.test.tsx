import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { usePhotoCommandPreview, type PhotoPreviewRegion } from "./commandPreview";
import type { PhotoDocument } from "./types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const source: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 80, height: 60, previewWidth: 80, previewHeight: 60, bundlePath: "", previewPath: "", originalPath: null };
const a: PhotoPreviewRegion = { x: 0, y: 0, width: 20, height: 20, scale: 1 };
const b: PhotoPreviewRegion = { x: 30, y: 10, width: 20, height: 20, scale: 1 };
let root: Root, container: HTMLDivElement, create: Mock<(object: Blob | MediaSource) => string>, revoke: Mock<(url: string) => void>;

function Harness({ exposure = 1, version = "v1", photoId = "photo", viewKey = "view", enabled = true, cancelable = true, regions = [] as PhotoPreviewRegion[], workspace = false, automatic = false }: { exposure?: number; version?: string; photoId?: string; viewKey?: string; enabled?: boolean; cancelable?: boolean; regions?: PhotoPreviewRegion[]; workspace?: boolean; automatic?: boolean }) {
  const doc = { ...source, id: photoId, version };
  const command = workspace ? "image.applyImage" : regions.length ? "filter.blurGallery.fieldBlur" : "filter.cameraRaw";
  const params = workspace ? { document: { photoId: "other", version: "v1" }, exposure } : { exposure };
  const preview = usePhotoCommandPreview(doc, "project", command, params, { enabled, cancelable, viewKey, regions, automatic, delay: 100 });
  return <div data-url={preview.url ?? ""} data-error={preview.error ?? ""}><button onClick={() => void preview.preview()}>Preview</button></div>;
}

const cancelArgs = (args: Record<string, unknown>) => ({ projectId: args.projectId, photoId: args.photoId, version: args.version, command: args.command, params: {}, requestId: args.requestId, cancel: true });

const render = async (props: Parameters<typeof Harness>[0] = {}) => act(async () => root.render(<Harness {...props} />));
const click = async () => act(async () => container.querySelector("button")!.click());

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.invoke.mockReset();
  create = vi.fn<(object: Blob | MediaSource) => string>().mockImplementation(() => `blob:${create.mock.calls.length}`); revoke = vi.fn<(url: string) => void>();
  vi.stubGlobal("URL", class extends URL { static override createObjectURL(object: Blob | MediaSource) { return create(object); } static override revokeObjectURL(url: string) { revoke(url); } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("cancelable native command previews", () => {
  it("cancels an invalidated request once, suppresses its stale pixels, then allows the latest request", async () => {
    let finish!: (value: unknown) => void;
    native.invoke.mockImplementation((_name: string, args: Record<string, unknown>) => args.cancel ? Promise.resolve() : native.invoke.mock.calls.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ width: 80, height: 60, png: "AA==" }));
    await render(); await click();
    const original = native.invoke.mock.calls[0]![1];
    expect(original).toMatchObject({ command: "filter.cameraRaw", params: { exposure: 1 }, requestId: expect.any(String) });
    await render({ exposure: 2 });
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(native.invoke.mock.calls[1]).toEqual(["xdesign_photo_command_preview", cancelArgs(original)]);
    await act(async () => finish({ width: 80, height: 60, png: "AQ==" }));
    expect(create).not.toHaveBeenCalled();
    await click();
    expect(native.invoke).toHaveBeenCalledTimes(3);
    expect(native.invoke.mock.calls[2]![1]).toMatchObject({ params: { exposure: 2 }, requestId: expect.any(String) });
    expect(native.invoke.mock.calls[2]![1].requestId).not.toBe(original.requestId);
    expect(container.querySelector("[data-url]")?.getAttribute("data-url")).toBe("blob:1");
  });

  it("cancels on source, view, and enabled invalidation and sends at most one cancel per request", async () => {
    let finish!: (value: unknown) => void;
    native.invoke.mockImplementation((_name: string, args: Record<string, unknown>) => args.cancel ? Promise.resolve() : new Promise(resolve => { finish = resolve; }));
    await render(); await click();
    await render({ photoId: "other" });
    expect(native.invoke).toHaveBeenCalledTimes(2);
    const original = native.invoke.mock.calls[0]![1];
    expect(native.invoke.mock.calls[1]![1]).toEqual(cancelArgs(original));
    await render({ photoId: "other", viewKey: "mask" });
    expect(native.invoke).toHaveBeenCalledTimes(2);
    await act(async () => finish({ width: 80, height: 60, png: "AA==" }));
    await click();
    await render({ photoId: "other", viewKey: "mask", enabled: false });
    expect(native.invoke).toHaveBeenCalledTimes(4);
    expect(native.invoke.mock.calls[3]![1]).toEqual(cancelArgs(native.invoke.mock.calls[2]![1]));
  });

  it("does not cancel region-only pans, legacy requests, or channel-workspace previews", async () => {
    let finish!: (value: unknown) => void;
    native.invoke.mockImplementationOnce((_name: string, _args: Record<string, unknown>) => { finish = () => {}; return new Promise(resolve => { finish = resolve; }); }).mockResolvedValue({ width: 80, height: 60, png: "AA==" });
    await render({ regions: [a] }); await click();
    const original = native.invoke.mock.calls[0]![1];
    expect(original.requestId).toEqual(expect.any(String));
    await render({ regions: [b] });
    expect(native.invoke).toHaveBeenCalledOnce();
    await act(async () => finish({ width: 80, height: 60, png: "AA==" }));
    expect(native.invoke).toHaveBeenCalledOnce();

    await render({ regions: [], exposure: 3, cancelable: false }); await click();
    expect(native.invoke.mock.calls.at(-1)![1].requestId).toBeUndefined();
    const legacyCount = native.invoke.mock.calls.length;
    await render({ regions: [], exposure: 4, cancelable: false });
    expect(native.invoke).toHaveBeenCalledTimes(legacyCount);

    await render({ workspace: true }); await click();
    expect(native.invoke.mock.calls.at(-1)![0]).toBe("xdesign_photo_channel_operation");
    expect(native.invoke.mock.calls.at(-1)![1].requestId).toBeUndefined();
    const workspaceCount = native.invoke.mock.calls.length;
    await render({ workspace: true, version: "v2" });
    expect(native.invoke).toHaveBeenCalledTimes(workspaceCount);
  });

  it("lets a live render finish while the controls move, but still cancels it when the image changes", async () => {
    vi.useFakeTimers(); let finish!: (value: unknown) => void;
    native.invoke.mockImplementation((_name: string, args: Record<string, unknown>) => args.cancel ? Promise.resolve() : new Promise(resolve => { finish = resolve; }));
    await render({ automatic: true }); await act(async () => vi.advanceTimersByTime(100));
    await render({ automatic: true, exposure: 2 }); await render({ automatic: true, exposure: 3 });
    expect(native.invoke).toHaveBeenCalledOnce();
    await act(async () => finish({ width: 80, height: 60, png: "AA==" }));
    expect(container.querySelector("[data-url]")?.getAttribute("data-url")).toBe("blob:1");
    await act(async () => vi.advanceTimersByTime(0));
    expect(native.invoke.mock.calls[1]![1]).toMatchObject({ params: { exposure: 3 } });
    await render({ automatic: true, exposure: 3, version: "v2" });
    expect(native.invoke.mock.calls[2]![1]).toEqual(cancelArgs(native.invoke.mock.calls[1]![1]));
  });

  it("cancels on unmount and ignores a late response", async () => {
    let finish!: (value: unknown) => void;
    native.invoke.mockImplementation((_name: string, args: Record<string, unknown>) => args.cancel ? Promise.resolve() : new Promise(resolve => { finish = resolve; }));
    await render(); await click();
    const original = native.invoke.mock.calls[0]![1];
    act(() => root.unmount());
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(native.invoke.mock.calls[1]![1]).toEqual(cancelArgs(original));
    root = createRoot(container);
    await act(async () => finish({ width: 80, height: 60, png: "AA==" }));
    expect(create).not.toHaveBeenCalled();
  });
});
