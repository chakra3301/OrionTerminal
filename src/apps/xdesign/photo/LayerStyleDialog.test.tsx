import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ state: null as unknown }));
const run = vi.hoisted(() => vi.fn(async (_command: string, _params?: Record<string, unknown>) => ({})));
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", () => ({ runPhotoCommand: run, usePhotoWorkspace: Object.assign((select: (s: { state: unknown; projectId: string }) => unknown) => select({ state: store.state, projectId: "project" }), { getState: () => ({ state: store.state, projectId: "project" }) }) }));
import { LayerStyleDialog } from "./LayerStyleDialog";
import type { PhotoDocument } from "./types";

const shadow = { type: "DropShadow", enabled: true, colors: {}, settings: { common: { enabled: true, blend: "Multiply", opacity: 0.75 }, color: { mode: "Rgb", c: [0, 0, 0, 0], alpha: 1 }, angle: 120, use_global_light: false, distance: 5, spread: 0, size: 5, noise: 0, anti_alias: false, contour: "Linear", knocks_out: true } };
const bevel = { type: "BevelEmboss", enabled: true, colors: {}, settings: { enabled: true, style: "InnerBevel", technique: "Smooth", depth: 1, up: true, size: 5, soften: 0, angle: 120, altitude: 30, use_global_light: false, gloss_contour: "Linear", highlight: { blend: "Screen", opacity: 0.75 }, highlight_color: { mode: "Rgb", c: [1, 1, 1, 0], alpha: 1 }, shadow: { blend: "Multiply", opacity: 0.75 }, shadow_color: { mode: "Rgb", c: [0, 0, 0, 0], alpha: 1 } } };
const layer = (items: unknown[]) => ({ id: 7, name: "L", blend: "Normal", opacity: 1, fill: 1, effects: { items } });
const withState = (items: unknown[], index = 3) => { store.state = { layers: [layer(items)], historySources: [{ index, current: true }], globalLight: { angle: 120, altitude: 30 }, presets: { styles: [], patterns: [] } }; };

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); run.mockClear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const q = (selector: string) => container.querySelector<HTMLElement>(selector)!;
const byLabel = (label: string) => q(`[aria-label="${label}"]`);
const render = (initial?: "blending" | "dropShadow") => { const onClose = vi.fn(); act(() => root.render(<LayerStyleDialog layerId={7} initial={initial} onClose={onClose}/>)); return onClose; };
const click = (element: HTMLElement) => act(() => element.click());

describe("LayerStyleDialog", () => {
  it("opens on Blending Options with the Photoshop groups", () => {
    withState([]); render();
    expect(q("[role=dialog]").getAttribute("aria-label")).toBe("Layer Style");
    expect([...container.querySelectorAll("legend")].map(l => l.textContent)).toEqual(["General Blending", "Advanced Blending", "Blend If"]);
  });

  it("lists the effects in Photoshop order", () => {
    withState([]); render();
    const names = [...container.querySelectorAll(".xd-ls-name")].map(n => n.textContent);
    expect(names.slice(2, 6)).toEqual(["Bevel & Emboss", "Contour", "Texture", "Stroke"]);
    expect(names.at(-1)).toBe("Drop Shadow");
  });

  it("opens an existing effect's pane when asked", () => {
    withState([shadow]); render("dropShadow");
    expect(q(".xd-ls-pane h4").textContent).toBe("Drop Shadow");
    expect(run).not.toHaveBeenCalled();
  });

  it("adds a missing initial effect so there is something to edit", () => {
    withState([]); render("dropShadow");
    expect(run).toHaveBeenCalledWith("layer.layerStyle.dropShadow", { layer: 7, add: true });
  });

  it("toggles an effect through the host adapter", () => {
    withState([shadow]); render();
    click(byLabel("Drop Shadow"));
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["common", "enabled"], value: false });
  });

  it("shows a slider drag on the canvas and commits it once on release", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return "blob:style"; } static override revokeObjectURL() {} });
    native.invoke.mockReset().mockResolvedValue({ width: 100, height: 100, png: "AA==" });
    let shown!: () => void; const untilShown = vi.fn((work: Promise<unknown>) => work.then(() => new Promise<void>(resolve => { shown = resolve; })));
    const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
    const canvas = document.createElement("div"), image = () => canvas.querySelector("img")?.getAttribute("src") ?? null;
    withState([shadow]); act(() => root.render(<LayerStyleDialog layerId={7} initial="dropShadow" onClose={vi.fn()} document={photo} canvas={canvas} untilShown={untilShown}/>));
    const slider = byLabel("Distance slider") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "20"); slider.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "layer.layerStyle.editEffect", params: { layer: 7, index: 0, path: ["distance"], value: 20 } }));
    expect(image()).toBe("blob:style"); expect(run).not.toHaveBeenCalled();
    await act(async () => { slider.dispatchEvent(new Event("pointerup", { bubbles: true })); });
    expect(run).toHaveBeenCalledOnce(); expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["distance"], value: 20 });
    expect(image()).toBe("blob:style");
    await act(async () => shown()); expect(image()).toBeNull();
  });

  it("Cancel returns to the opening history step and closes", () => {
    withState([]); const onClose = render();
    store.state = { ...(store.state as object), historySources: [{ index: 5, current: true }] };
    click([...container.querySelectorAll("button")].find(b => b.textContent === "Cancel")!);
    expect(run).toHaveBeenCalledWith("history.select", { index: 3 });
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape cancels even when focus is outside the dialog, as after a click on a button in WebKit", () => {
    withState([]); const onClose = render();
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });

  it("OK keeps the edits", () => {
    withState([]); const onClose = render();
    click(q("button[type=submit]"));
    expect(run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("names the first list row Blending Options and offers + on every multi-instance effect", () => {
    withState([]); render();
    expect([...container.querySelectorAll(".xd-ls-name")][1]!.textContent).toBe("Blending Options");
    expect([...container.querySelectorAll(".xd-ls-plus")].map(b => b.getAttribute("aria-label"))).toEqual(["Add another Stroke", "Add another Inner Shadow", "Add another Color Overlay", "Add another Gradient Overlay", "Add another Drop Shadow"]);
    click(byLabel("Add another Stroke"));
    expect(run).toHaveBeenCalledWith("layer.layerStyle.stroke", { layer: 7, add: true });
  });

  it("shows the current effects on a preview swatch", () => {
    withState([shadow]); render("dropShadow");
    expect(q(".xd-ls-sample > i").getAttribute("style")).toContain("box-shadow");
    withState([{ ...shadow, enabled: false }]); render("dropShadow");
    expect(q(".xd-ls-sample > i").getAttribute("style") ?? "").not.toContain("box-shadow");
  });

  it("picks the bevel direction with Up and Down radios", () => {
    withState([bevel]); render("blending"); click([...container.querySelectorAll<HTMLElement>(".xd-ls-name")].find(n => n.textContent === "Bevel & Emboss")!);
    const [up, down] = [...container.querySelectorAll<HTMLInputElement>("input[name=xd-ls-direction]")];
    expect([up!.checked, down!.checked]).toEqual([true, false]);
    click(down!);
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["up"], value: false });
  });

  it("sets Angle and Altitude together from one globe", async () => {
    withState([bevel]); render("blending"); click([...container.querySelectorAll<HTMLElement>(".xd-ls-name")].find(n => n.textContent === "Bevel & Emboss")!);
    const globe = byLabel("Angle and altitude globe");
    globe.getBoundingClientRect = () => ({ left: 0, top: 0, width: 24, height: 24, right: 24, bottom: 24, x: 0, y: 0, toJSON() {} });
    await act(async () => { globe.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 22, clientY: 12 })); });
    await act(async () => { globe.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })); });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: [], value: { ...bevel.settings, angle: 0, altitude: 0 } });
  });

  it("Make Default keeps an effect's settings and Reset to Default restores them in one step", async () => {
    localStorage.clear(); withState([shadow]); render("dropShadow");
    click([...container.querySelectorAll("button")].find(b => b.textContent === "Make Default")!);
    expect(JSON.parse(localStorage.getItem("xdesign.photo.layerStyleDefaults")!).DropShadow).toEqual(shadow.settings);
    await act(async () => { [...container.querySelectorAll("button")].find(b => b.textContent === "Reset to Default")!.click(); });
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: [], value: shadow.settings });
  });

  it("dragging the image moves the selected shadow", async () => {
    vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return "blob:style"; } static override revokeObjectURL() {} });
    native.invoke.mockReset().mockResolvedValue({ width: 100, height: 100, png: "AA==" });
    const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
    const canvas = document.createElement("div"); document.body.append(canvas);
    withState([shadow]); act(() => root.render(<LayerStyleDialog layerId={7} initial="dropShadow" onClose={vi.fn()} document={photo} canvas={canvas}/>));
    await act(async () => { canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 0 })); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup")); });
    canvas.remove();
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: [], value: { ...shadow.settings, angle: 161, distance: 13 } });
  });

  it("dragging the image moves a gradient overlay's centre across the layer, and Reset Alignment puts it back", async () => {
    vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return "blob:style"; } static override revokeObjectURL() {} });
    native.invoke.mockReset().mockResolvedValue({ width: 100, height: 100, png: "AA==" });
    const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
    const gradient = { stops: [[0, { mode: "Rgb", c: [0, 0, 0, 0], alpha: 1 }], [1, { mode: "Rgb", c: [1, 1, 1, 0], alpha: 1 }]], opacity_stops: [], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0.1, 0] };
    const overlay = { type: "GradientOverlay", enabled: true, colors: {}, settings: { common: { enabled: true, blend: "Normal", opacity: 1 }, gradient, dither: false } };
    const canvas = document.createElement("div"); document.body.append(canvas);
    withState([overlay]); (store.state as { layers: Record<string, unknown>[] }).layers[0]!.bounds = [10, 10, 40, 20];
    act(() => root.render(<LayerStyleDialog layerId={7} initial="gradientOverlay" onClose={vi.fn()} document={photo} canvas={canvas}/>));
    await act(async () => { canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: -5 })); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup")); });
    canvas.remove();
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: [], value: { ...overlay.settings, gradient: { ...gradient, offset: [0.35, -0.25] } } });
    run.mockClear(); await act(async () => [...container.querySelectorAll("button")].find(item => item.textContent === "Reset Alignment")!.click());
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["gradient", "offset"], value: [0, 0] });
  });
});
