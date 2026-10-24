import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasDraftPreview, layerPropsDraft, type CanvasDraft } from "./CanvasDraftPreview";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument } from "./types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: native.invoke, convertFileSrc: (path: string) => path }));
const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
let root: Root, container: HTMLDivElement, canvas: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return "blob:draft"; } static override revokeObjectURL() {} });
  native.invoke.mockReset().mockResolvedValue({ width: 100, height: 100, png: "AA==" });
  usePhotoWorkspace.setState({ projectId: "project", state: null });
  container = document.createElement("div"); canvas = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = async (draft: CanvasDraft | null, document = photo) => {
  await act(async () => root.render(<CanvasDraftPreview document={document} draft={draft} canvas={canvas}/>));
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
};
const shown = () => canvas.querySelector("img")?.getAttribute("src") ?? null;

describe("canvas draft preview", () => {
  it("shows a scrub on the canvas and keeps the last frame while the commit lands", async () => {
    await render(null);
    expect(native.invoke).not.toHaveBeenCalled(); expect(shown()).toBeNull();
    await render(layerPropsDraft({ layer: 3, opacity: 40 }));
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "layer.setProps", params: { layer: 3, opacity: .4 } }));
    expect(shown()).toBe("blob:draft");
    await render(layerPropsDraft({ layer: 3, opacity: 40, committing: true }), { ...photo, version: "v2" });
    expect(native.invoke).toHaveBeenCalledTimes(1); expect(shown()).toBe("blob:draft");
    await render(null, { ...photo, version: "v2" });
    expect(shown()).toBeNull();
  });

  it("maps layer Fill separately from Opacity", () => {
    expect(layerPropsDraft({ layer: 3, fill: 25 })).toEqual({ command: "layer.setProps", committing: undefined, params: { layer: 3, fill: .25 } });
  });
});
