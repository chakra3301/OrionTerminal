import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdjustmentProperties, addAdjustmentLayer, adjustmentActionFor } from "./AdjustmentProperties";
import { ADJUSTMENTS } from "./controls";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer } from "./types";

const native = vi.hoisted(() => ({ run: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
const make = (kind: string, params: Record<string, unknown> = {}, extra: Partial<PhotoLayer> = {}): PhotoLayer => ({ id: 7, name: "Adjustment 1", kind: "Adjustment", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false, adjustment: {}, adjustmentKind: kind, adjustmentParams: params, ...extra } as PhotoLayer);
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({}); native.invoke.mockReset();
  usePhotoWorkspace.setState({ projectId: "project", busy: false, quiet: false, error: null, state: null });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = (layer: PhotoLayer) => act(async () => root.render(<AdjustmentProperties layer={layer} document={photo}/>));
const by = (label: string) => container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(`[aria-label="${label}"]`)!;
const slide = (label: string, value: string) => act(async () => { const element = by(label) as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });

describe("adjustment layer properties", () => {
  it("maps a layer to its adjustment and ignores imported ones", () => {
    expect(adjustmentActionFor(make("levels"))).toBe(ADJUSTMENTS.find(action => action.id === "levels"));
    expect(adjustmentActionFor(make("unsupported"))).toBeUndefined();
    expect(adjustmentActionFor({ ...make("levels"), adjustment: undefined })).toBeUndefined();
  });

  it("creates the layer immediately with defaults", async () => {
    await addAdjustmentLayer(ADJUSTMENTS.find(action => action.id === "vibrance")!);
    expect(native.run).toHaveBeenCalledWith("layer.newAdjustmentLayer.vibrance", {});
  });

  it("shows the header, preset and levels groups like Photoshop", async () => {
    await render(make("levels"));
    expect(container.querySelector(".xd-photo-adjustment-header")!.textContent).toContain("Levels");
    expect((by("Preset") as HTMLSelectElement).value).toBe("Default");
    expect([...container.querySelectorAll(".xd-ps-dialog-subhead")].map(item => item.textContent)).toEqual(["Input Levels:", "Output Levels:"]);
    expect(container.querySelector("select[aria-label='Preset']")).not.toBeNull();
  });

  it("has no preset menu where Photoshop has none", async () => {
    await render(make("vibrance"));
    expect(container.querySelector("[aria-label='Preset']")).toBeNull();
  });

  it("commits one setAdjustment after the slider settles, not per move", async () => {
    await render(make("brightnessContrast", { brightness: 0, contrast: 0 }));
    await slide("Adjustment Brightness slider", "10"); await slide("Adjustment Brightness slider", "20"); await slide("Adjustment Brightness slider", "30");
    expect(native.run).not.toHaveBeenCalled();
    await settle();
    expect(native.run).toHaveBeenCalledTimes(1);
    expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", expect.objectContaining({ layer: 7, brightness: 30, contrast: 0 }));
  });

  it("waits for the pointer to be released before committing a drag", async () => {
    await render(make("brightnessContrast", { brightness: 0, contrast: 0 }));
    const slider = by("Adjustment Brightness slider");
    await act(async () => { slider.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await slide("Adjustment Brightness slider", "40"); await settle();
    expect(native.run).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("pointerup")); }); await settle();
    expect(native.run).toHaveBeenCalledTimes(1);
  });

  it("shows the drag on the canvas as it moves and keeps the last frame until the commit is shown", async () => {
    vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return "blob:draft"; } static override revokeObjectURL() {} });
    native.invoke.mockResolvedValue({ width: 100, height: 100, png: "AA==" });
    let shown!: () => void; const untilShown = vi.fn((work: Promise<unknown>) => work.then(() => new Promise<void>(resolve => { shown = resolve; })));
    const canvas = document.createElement("div");
    await act(async () => root.render(<AdjustmentProperties layer={make("brightnessContrast", { brightness: 0, contrast: 0 })} document={photo} canvas={canvas} untilShown={untilShown}/>));
    await act(async () => { by("Adjustment Brightness slider").dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await slide("Adjustment Brightness slider", "40"); await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "layer.setAdjustment", params: expect.objectContaining({ layer: 7, brightness: 40 }) }));
    expect(canvas.querySelector("img")?.getAttribute("src")).toBe("blob:draft"); expect(native.run).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("pointerup")); }); await settle();
    expect(native.run).toHaveBeenCalledTimes(1); expect(untilShown).toHaveBeenCalledOnce(); expect(canvas.querySelector("img")?.getAttribute("src")).toBe("blob:draft");
    await act(async () => shown()); expect(canvas.querySelector("img")).toBeNull();
  });

  it("keeps the controls enabled while a quiet edit runs", async () => {
    usePhotoWorkspace.setState({ busy: true, quiet: true });
    await render(make("brightnessContrast", { brightness: 0, contrast: 0 }));
    expect(by("Adjustment Brightness slider").hasAttribute("disabled")).toBe(false);
  });

  it("applies a Curves preset", async () => {
    usePhotoWorkspace.setState({ state: { mode: "RGB" } as never });
    await render(make("curves", { points: [[0, 0], [255, 255]], red: [[0, 0], [255, 255]], green: [[0, 0], [255, 255]], blue: [[0, 0], [255, 255]] }));
    await act(async () => { const select = by("Preset") as HTMLSelectElement; select.value = "Darker (RGB)"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", expect.objectContaining({ layer: 7, points: [[0, 0], [130, 101], [255, 255]] }));
  });

  it("adopts undo from the layer when nothing is pending", async () => {
    await render(make("brightnessContrast", { brightness: 5, contrast: 0 }));
    await render(make("brightnessContrast", { brightness: 0, contrast: 0 }));
    expect((by("Adjustment Brightness") as HTMLInputElement).value).toBe("0");
  });

  it("runs the footer actions through existing commands", async () => {
    await render(make("invert"));
    await act(async () => by("Clip to layer below").click());
    await act(async () => by("Reset to adjustment defaults").click());
    await act(async () => by("Toggle layer visibility").click());
    await act(async () => by("Delete this adjustment layer").click());
    expect(native.run.mock.calls.map(call => call[0])).toEqual(["layer.createClippingMask", "layer.setAdjustment", "layer.setProps", "layer.delete"]);
    expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", { layer: 7 });
    expect(native.run).toHaveBeenCalledWith("layer.setProps", { layer: 7, visible: false });
  });

  it("releases a clipped layer", async () => {
    await render(make("invert", {}, { clipped: true }));
    await act(async () => by("Release clipping mask").click());
    expect(native.run).toHaveBeenCalledWith("layer.releaseClippingMask", { layer: 7 });
  });
});
