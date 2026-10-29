import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ state: null as unknown }));
const run = vi.hoisted(() => vi.fn(async (_command: string, _params?: Record<string, unknown>) => ({})));
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", () => ({ runPhotoCommand: run, usePhotoWorkspace: Object.assign((select: (s: { state: unknown; projectId: string }) => unknown) => select({ state: store.state, projectId: "project" }), { getState: () => ({ state: store.state, projectId: "project" }) }) }));
import { LayerStyleDialog } from "./LayerStyleDialog";
import { bakeGradient, type GradientMethod } from "./gradientMethod";
import type { PhotoDocument } from "./types";

const shadow = { type: "DropShadow", enabled: true, colors: {}, settings: { common: { enabled: true, blend: "Multiply", opacity: 0.75 }, color: { mode: "Rgb", c: [0, 0, 0, 0], alpha: 1 }, angle: 120, use_global_light: false, distance: 5, spread: 0, size: 5, noise: 0, anti_alias: false, contour: "Linear", knocks_out: true } };
const bevel = { type: "BevelEmboss", enabled: true, colors: {}, settings: { enabled: true, style: "InnerBevel", technique: "Smooth", depth: 1, up: true, size: 5, soften: 0, angle: 120, altitude: 30, use_global_light: false, gloss_contour: "Linear", highlight: { blend: "Screen", opacity: 0.75 }, highlight_color: { mode: "Rgb", c: [1, 1, 1, 0], alpha: 1 }, shadow: { blend: "Multiply", opacity: 0.75 }, shadow_color: { mode: "Rgb", c: [0, 0, 0, 0], alpha: 1 } } };
const layer = (items: unknown[]) => ({ id: 7, name: "L", blend: "Normal", opacity: 1, fill: 1, effects: { items } });
const withState = (items: unknown[], index = 3) => { store.state = { layers: [layer(items)], historySources: [{ id: `h${index}`, index, current: true }], globalLight: { angle: 120, altitude: 30 }, presets: { styles: [], patterns: [] } }; };

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

  it.each(["blending", "dropShadow"] as const)("separates the %s blend modes into Photoshop's groups", initial => {
    withState([shadow]); render(initial);
    expect([...q('[aria-label="Blend Mode"]').querySelectorAll("hr")].map(hr => hr.nextElementSibling!.textContent)).toEqual(["Darken", "Lighten", "Overlay", "Difference", "Hue"]);
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

  it("shows a colour being picked on the canvas before OK and drops it on Cancel", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return "blob:style"; } static override revokeObjectURL() {} });
    native.invoke.mockReset().mockResolvedValue({ width: 100, height: 100, png: "AA==" });
    const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
    const canvas = document.createElement("div"), image = () => canvas.querySelector("img")?.getAttribute("src") ?? null;
    withState([shadow]); act(() => root.render(<LayerStyleDialog layerId={7} initial="dropShadow" onClose={vi.fn()} document={photo} canvas={canvas}/>));
    click(byLabel("Set color of shadow"));
    const hex = document.querySelector<HTMLInputElement>('[aria-label="Hex color"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(hex, "FF8000"); hex.dispatchEvent(new Event("input", { bubbles: true })); hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "layer.layerStyle.editEffect", params: { layer: 7, index: 0, path: ["color"], value: { mode: "Rgb", c: [1, 128 / 255, 0, 0], alpha: 1 } } }));
    expect(image()).toBe("blob:style"); expect(run).not.toHaveBeenCalled();
    click([...document.querySelectorAll<HTMLButtonElement>('[aria-label="Set color of shadow"][role=dialog] button')].find(b => b.textContent === "Cancel")!);
    expect(run).not.toHaveBeenCalled(); expect(image()).toBeNull();
  });

  it("Gradient opens Photoshop's Gradient Editor, which shows stop edits on the canvas and commits them once on OK", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return "blob:style"; } static override revokeObjectURL() {} });
    native.invoke.mockReset().mockResolvedValue({ width: 100, height: 100, png: "AA==" });
    const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
    const black = { mode: "Rgb", c: [0, 0, 0, 0], alpha: 1 }, white = { mode: "Rgb", c: [1, 1, 1, 0], alpha: 1 };
    const gradient = { stops: [[0, black], [1, white]], opacity_stops: [], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] };
    const overlay = { type: "GradientOverlay", enabled: true, colors: {}, settings: { common: { enabled: true, blend: "Normal", opacity: 1 }, gradient, dither: false } };
    const canvas = document.createElement("div"), image = () => canvas.querySelector("img")?.getAttribute("src") ?? null;
    withState([overlay]); act(() => root.render(<LayerStyleDialog layerId={7} initial="gradientOverlay" onClose={vi.fn()} document={photo} canvas={canvas}/>));
    expect(container.querySelector('[aria-label="Stop 2 position"]')).toBeNull();
    click(byLabel("Edit gradient"));
    const editor = q('[role=dialog][aria-label="Gradient Editor"]');
    click(byLabel("Color stop 2"));
    await act(async () => { const location = byLabel("Color stop location") as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(location, "60"); location.dispatchEvent(new Event("input", { bubbles: true })); await vi.advanceTimersByTimeAsync(100); });
    const edited = { ...gradient, stops: [[0, black], [0.6, white]] };
    expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_command_preview", expect.objectContaining({ params: { layer: 7, index: 0, path: ["gradient"], value: edited } }));
    expect(image()).toBe("blob:style"); expect(run).not.toHaveBeenCalled();
    await act(async () => [...editor.querySelectorAll("button")].find(b => b.textContent === "OK")!.click());
    expect(run).toHaveBeenCalledOnce(); expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["gradient"], value: edited });
    expect(container.querySelector('[aria-label="Gradient Editor"]')).toBeNull();
  });

  it("the ▾ beside Gradient applies a preset in one step", async () => {
    const red = { mode: "Rgb", c: [1, 0, 0, 0], alpha: 1 };
    const gradient = { stops: [[0, red], [1, red]], opacity_stops: [], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] };
    const overlay = { type: "GradientOverlay", enabled: true, colors: {}, settings: { common: { enabled: true, blend: "Normal", opacity: 1 }, gradient, dither: false } };
    withState([overlay]);
    (store.state as { presets: Record<string, unknown> }).presets.gradients = [{ name: "Basics", presets: [{ name: "Black, White", stops: [[0, "#000000"], [1, "#ffffff"]], transparency: [[0, 100], [1, 100]] }] }];
    container.classList.add("xd-photo"); render("gradientOverlay" as "dropShadow");
    click(byLabel("Gradient presets"));
    click([...container.querySelectorAll<HTMLElement>(".xd-ge-presets button")].find(b => b.textContent === "Basics")!);
    await act(async () => byLabel("Black, White").click());
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["gradient"], value: { ...gradient, stops: [[0, { mode: "Rgb", c: [0, 0, 0, 0], alpha: 1 }], [1, { mode: "Rgb", c: [1, 1, 1, 0], alpha: 1 }]], opacity_stops: [] } });
    expect(container.querySelector(".xd-ge-presets")).toBeNull();
  });

  const rgb = (hex: string) => ({ mode: "Rgb", c: [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).concat(0), alpha: 1 });
  const baked = (stops: [number, string][], method: GradientMethod) => bakeGradient(stops, method).map(([t, hex]): [number, unknown] => [t, rgb(hex)]);
  const overlayOf = (gradient: unknown) => ({ type: "GradientOverlay", enabled: true, colors: {}, settings: { common: { enabled: true, blend: "Normal", opacity: 1 }, gradient, dither: false } });
  const choose = (label: string, value: string) => act(async () => { const pick = byLabel(label) as HTMLSelectElement; pick.value = value; pick.dispatchEvent(new Event("change", { bubbles: true })); });
  // The engine keeps positions as f32.
  const stored = (gradient: { stops: [number, unknown][] }) => ({ ...gradient, stops: gradient.stops.map(([t, color]) => [Math.fround(t), color]) });

  it("Method sends the overlay's stops baked, as the engine blends stops linearly, and reopens with the stops and Method the user set", async () => {
    const gradient = { stops: [[0, rgb("#000000")], [1, rgb("#ffffff")]] as [number, unknown][], opacity_stops: [], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] };
    withState([overlayOf(gradient)]); render("gradientOverlay" as "dropShadow");
    expect((byLabel("Method") as HTMLSelectElement).value).toBe("classic");
    await choose("Method", "perceptual");
    const sent = { ...gradient, stops: baked([[0, "#000000"], [1, "#ffffff"]], "perceptual") };
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["gradient"], value: sent });
    withState([overlayOf(stored(sent))]); render("gradientOverlay" as "dropShadow");
    expect((byLabel("Method") as HTMLSelectElement).value).toBe("perceptual");
    click(byLabel("Edit gradient"));
    expect(container.querySelector('[aria-label="Color stop 2"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Color stop 3"]')).toBeNull();
  });

  it("keeps the Method for a preset from ▾ and for Gradient Editor edits", async () => {
    const gradient = { stops: [[0, rgb("#ff0000")], [1, rgb("#0000ff")]] as [number, unknown][], opacity_stops: [], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] };
    withState([overlayOf(gradient)]); render("gradientOverlay" as "dropShadow");
    await choose("Method", "linear");
    withState([overlayOf(stored({ ...gradient, stops: baked([[0, "#ff0000"], [1, "#0000ff"]], "linear") }))]);
    (store.state as { presets: Record<string, unknown> }).presets.gradients = [{ name: "Basics", presets: [{ name: "Black, White", stops: [[0, "#000000"], [1, "#ffffff"]], transparency: [[0, 100], [1, 100]] }] }];
    container.classList.add("xd-photo"); render("gradientOverlay" as "dropShadow"); run.mockClear();
    click(byLabel("Gradient presets"));
    click([...container.querySelectorAll<HTMLElement>(".xd-ge-presets button")].find(b => b.textContent === "Basics")!);
    await act(async () => byLabel("Black, White").click());
    expect(run).toHaveBeenLastCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["gradient"], value: { ...gradient, stops: baked([[0, "#000000"], [1, "#ffffff"]], "linear"), opacity_stops: [] } });
    click(byLabel("Edit gradient")); click(byLabel("Color stop 2"));
    act(() => { const location = byLabel("Color stop location") as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(location, "60"); location.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => [...q('[role=dialog][aria-label="Gradient Editor"]').querySelectorAll("button")].find(b => b.textContent === "OK")!.click());
    expect(run).toHaveBeenLastCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["gradient"], value: { ...gradient, stops: baked([[0, "#ff0000"], [0.6, "#0000ff"]], "linear") } });
  });

  it.each([
    ["Stroke", "stroke", { size: 3, position: "Outside" }, true],
    ["Outer Glow", "outerGlow", { noise: 0, technique: "Softer", spread: 0, size: 5, contour: "Linear", anti_alias: false, range: 0.5, jitter: 0 }, false],
  ] as const)("%s with a gradient fill shows Method only where Photoshop does", (_, key, settings, shown) => {
    const gradient = { stops: [[0, rgb("#000000")], [1, rgb("#ffffff")]], opacity_stops: [], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] };
    withState([{ type: key === "stroke" ? "Stroke" : "OuterGlow", enabled: true, colors: {}, settings: { common: { enabled: true, blend: "Normal", opacity: 1 }, paint: { Gradient: gradient }, ...settings } }]);
    render(key as "dropShadow");
    expect(container.querySelector('[aria-label="Method"]') !== null).toBe(shown);
  });

  it("starts a new Gradient Overlay at Photoshop's Smooth Method", async () => {
    const gradient = { stops: [[0, rgb("#000000")], [1, rgb("#ffffff")]], opacity_stops: [], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] };
    withState([]);
    run.mockImplementation(async command => { if (command === "layer.layerStyle.gradientOverlay") withState([overlayOf(gradient)]); return {}; });
    try { await act(async () => { render("gradientOverlay" as "dropShadow"); }); } finally { run.mockImplementation(async () => ({})); }
    expect(run).toHaveBeenLastCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["gradient"], value: { ...gradient, stops: baked([[0, "#000000"], [1, "#ffffff"]], "smooth") } });
  });

  it("Reset to Default without a saved default puts a Gradient Overlay back at Photoshop's Smooth Method", async () => {
    localStorage.clear();
    const gradient = { stops: [[0, rgb("#000000")], [1, rgb("#ffffff")]], opacity_stops: [], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] };
    const edited = overlayOf({ ...gradient, angle: 45 });
    withState([edited]); render("gradientOverlay" as "dropShadow");
    run.mockImplementation(async command => { if (command === "layer.layerStyle.gradientOverlay") withState([edited, overlayOf(gradient)]); if (command === "layer.layerStyle.removeEffect") withState([edited]); return {}; });
    try { await act(async () => { [...container.querySelectorAll("button")].find(b => b.textContent === "Reset to Default")!.click(); }); } finally { run.mockImplementation(async () => ({})); }
    expect(run).toHaveBeenLastCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: [], value: { ...overlayOf(gradient).settings, gradient: { ...gradient, stops: baked([[0, "#000000"], [1, "#ffffff"]], "smooth") } } });
  });

  it("a stroke switched to Gradient starts at Photoshop's Smooth Method", () => {
    const yellow = { mode: "Rgb", c: [1, 1, 0.75, 0], alpha: 1 };
    withState([{ type: "Stroke", enabled: true, colors: {}, settings: { common: { enabled: true, blend: "Normal", opacity: 1 }, paint: { Color: yellow }, size: 3, position: "Outside" } }]); render("stroke" as "dropShadow");
    act(() => { const pick = byLabel("Fill Type") as HTMLSelectElement; pick.value = "Gradient"; pick.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["paint"], value: { Gradient: { stops: baked([[0, "#ffffbf"], [1, "#ffffbf"]], "smooth"), opacity_stops: [[0, 1], [1, 0]], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] } } });
  });

  it("a glow switched to Gradient fades its colour to transparent with opacity stops, as the engine ignores colour alpha", () => {
    const glow = { type: "OuterGlow", enabled: true, colors: {}, settings: { common: { enabled: true, blend: "Screen", opacity: 0.75 }, paint: { Color: { mode: "Rgb", c: [1, 1, 0.75, 0], alpha: 1 } }, noise: 0, technique: "Softer", spread: 0, size: 5, contour: "Linear", anti_alias: false, range: 0.5, jitter: 0 } };
    withState([glow]); render("outerGlow" as "dropShadow");
    act(() => { const pick = byLabel("Fill Type") as HTMLSelectElement; pick.value = "Gradient"; pick.dispatchEvent(new Event("change", { bubbles: true })); });
    const yellow = { mode: "Rgb", c: [1, 1, 0.75, 0], alpha: 1 };
    expect(run).toHaveBeenCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: ["paint"], value: { Gradient: { stops: [[0, yellow], [1, yellow]], opacity_stops: [[0, 1], [1, 0]], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] } } });
  });

  it("Cancel returns to the opening history step, leaving nothing to redo, and closes", async () => {
    withState([]); const onClose = render();
    store.state = { ...(store.state as object), historySources: [{ id: "h5", index: 5, current: true }] };
    await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Cancel")!.click());
    expect(run).toHaveBeenCalledWith("history.select", { id: "h3", discardRedo: true });
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

  it("OK records the dialog's edits as one Layer Style history step", async () => {
    withState([]); const onClose = render();
    store.state = { ...(store.state as object), historySources: [{ id: "h5", index: 5, current: true }] };
    await act(async () => q("button[type=submit]").click());
    expect(run.mock.calls).toEqual([["history.fold", { fromId: "h3", label: "Layer Style" }]]);
    expect(onClose).toHaveBeenCalled();
  });

  it("OK still folds the dialog's edits at the History limit, where a new step keeps the current index", async () => {
    withState([], 50); render();
    store.state = { ...(store.state as object), historySources: [{ id: "later", index: 50, current: true }] };
    await act(async () => q("button[type=submit]").click());
    expect(run.mock.calls).toEqual([["history.fold", { fromId: "h50", label: "Layer Style" }]]);
  });

  it("OK with Preview off brings the edits back before folding them", async () => {
    withState([]); render();
    store.state = { ...(store.state as object), historySources: [{ id: "h5", index: 5, current: true }] };
    const box = [...container.querySelectorAll(".xd-ps-dialog-buttons label")].find(label => label.textContent === "Preview")!.querySelector("input")!;
    await act(async () => box.click());
    store.state = { ...(store.state as object), historySources: [{ id: "h3", index: 3, current: true }] };
    run.mockImplementation(async (command, params) => { if (command === "history.select") store.state = { ...(store.state as object), historySources: [{ id: params!.id, current: true }] }; return {}; });
    await act(async () => q("button[type=submit]").click());
    expect(run.mock.calls).toEqual([["history.select", { id: "h3" }], ["history.select", { id: "h5" }], ["history.fold", { fromId: "h3", label: "Layer Style" }]]);
    run.mockImplementation(async () => ({}));
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

  it("starts a new effect from the default Make Default saved for its kind, switched on", async () => {
    localStorage.clear(); localStorage.setItem("xdesign.photo.layerStyleDefaults", JSON.stringify({ DropShadow: { ...shadow.settings, distance: 20, common: { ...shadow.settings.common, enabled: false } } }));
    withState([]);
    run.mockImplementation(async command => { if (command === "layer.layerStyle.dropShadow") withState([shadow]); return {}; });
    try { await act(async () => { render("dropShadow"); }); } finally { run.mockImplementation(async () => ({})); }
    expect(run).toHaveBeenLastCalledWith("layer.layerStyle.editEffect", { layer: 7, index: 0, path: [], value: { ...shadow.settings, distance: 20 } });
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

  it("dragging the image through the dialog's scrim moves the shadow, but not from beside the image", async () => {
    vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return "blob:style"; } static override revokeObjectURL() {} });
    native.invoke.mockReset().mockResolvedValue({ width: 100, height: 100, png: "AA==" });
    const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
    const canvas = document.createElement("div"); document.body.append(canvas);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} });
    withState([shadow]); act(() => root.render(<LayerStyleDialog layerId={7} initial="dropShadow" onClose={vi.fn()} document={photo} canvas={canvas}/>));
    const scrim = q(".xd-ps-dialog-scrim");
    await act(async () => { scrim.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 150, clientY: 10 })); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: 160, clientY: 10 })); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup")); });
    expect(run).not.toHaveBeenCalled();
    await act(async () => { scrim.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 50, clientY: 50 })); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 50 })); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup")); });
    canvas.remove();
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
