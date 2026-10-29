import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdjustmentProperties, addAdjustmentLayer, adjustmentActionFor } from "./AdjustmentProperties";
import { ADJUSTMENTS } from "./controls";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer } from "./types";

const native = vi.hoisted(() => ({ run: vi.fn(), invoke: vi.fn(), tauri: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.tauri, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
const make = (kind: string, params: Record<string, unknown> = {}, extra: Partial<PhotoLayer> = {}): PhotoLayer => ({ id: 7, name: "Adjustment 1", kind: "Adjustment", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false, adjustment: {}, adjustmentKind: kind, adjustmentParams: params, ...extra } as PhotoLayer);
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({}); native.invoke.mockReset(); native.tauri = false;
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

  it("solves Auto Brightness/Contrast in Properties as one history step, and disables it while busy", async () => {
    const dark = Array.from({ length: 256 }, (_, level) => level >= 20 && level <= 100 ? 10 : 0);
    native.tauri = true; native.invoke.mockImplementation(async (command: string) => command === "xdesign_photo_histogram" ? [dark] : null);
    await render(make("brightnessContrast", { brightness: 0, contrast: 0, legacy: false })); await settle();
    const auto = [...container.querySelectorAll("button")].find(button => button.textContent === "Auto")!;
    expect(auto.disabled).toBe(false);
    await act(async () => auto.click()); await settle();
    expect(native.run).toHaveBeenCalledTimes(1);
    const params = native.run.mock.calls[0]![1] as { brightness: number; contrast: number };
    expect(native.run.mock.calls[0]![0]).toBe("layer.setAdjustment"); expect(params.brightness).toBeGreaterThan(20); expect(params.contrast).toBeGreaterThan(20);
    await act(async () => usePhotoWorkspace.setState({ busy: true, quiet: false }));
    expect(auto.disabled).toBe(true);
  });

  it("colorizes from the foreground in one history step", async () => {
    usePhotoWorkspace.setState({ state: { mode: "RGB", tools: { foreground: [1, 0, 0, 1], background: [1, 1, 1, 1] } } as never });
    await render(make("hueSaturation", { colorize: false, hue: 0, saturation: 0, lightness: 10 }));
    await act(async () => (by("Adjustment Colorize") as HTMLInputElement).click()); await settle();
    expect(native.run).toHaveBeenCalledTimes(1);
    expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", expect.objectContaining({ layer: 7, colorize: true, hue: 0, saturation: 25, lightness: 10 }));
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

  it("holds a Gradient Map edit while the Gradient Editor is open and commits it once on OK", async () => {
    container.classList.add("xd-photo");
    await render(make("gradientMap", { stops: [[0, "#000000"], [1, "#ffffff"]] }));
    await act(async () => by("Edit gradient").click());
    await act(async () => (by("Color stop 2") as HTMLElement).click()); await slide("Color stop location", "40"); await slide("Color stop location", "60");
    await act(async () => { by("Color stop location").dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    await settle();
    expect(native.run).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Gradient Editor"] button[type=submit]')!.click()); await settle();
    expect(native.run).toHaveBeenCalledOnce();
    expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", expect.objectContaining({ layer: 7, stops: [[0, "#000000"], [.6, "#ffffff"]] }));
  });

  it("commits nothing when the Gradient Editor is cancelled", async () => {
    container.classList.add("xd-photo");
    await render(make("gradientMap", { stops: [[0, "#000000"], [1, "#ffffff"]] }));
    await act(async () => by("Edit gradient").click());
    await act(async () => (by("Color stop 2") as HTMLElement).click()); await slide("Color stop location", "60");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Gradient Editor"] button')].find(button => button.textContent === "Cancel")!.click()); await settle();
    expect(native.run).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Gradient Editor"]')).toBeNull();
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
