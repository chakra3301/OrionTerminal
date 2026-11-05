import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { SelectionDialog } from "./SelectionDialog";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoState } from "./types";
import type { SelectionWorkflow } from "./selectionSettings";
import { SELECTION_PREFERENCES_KEY } from "./selectionPreferences";
const native = vi.hoisted(() => ({ invoke: vi.fn(), enabled: false }));
const command = vi.hoisted(() => vi.fn(async (_id: string, _params: Record<string, unknown> = {}) => undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => native.enabled, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: command }));
let root: Root, container: HTMLDivElement, doc: PhotoDocument, close: ReturnType<typeof vi.fn<() => void>>, create: ReturnType<typeof vi.fn<() => string>>, revoke: ReturnType<typeof vi.fn<(url: string) => void>>;
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === name || button.textContent === name)!;
const click = (name: string) => act(async () => button(name).click());
const mount = (kind: Exclude<SelectionWorkflow, "color">) => act(async () => root.render(<SelectionDialog kind={kind} document={doc} close={close}/>));
const pick = (name: string, value: string) => act(async () => { const input = container.querySelector<HTMLSelectElement>(`[aria-label="${name}"]`)!; input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
const number = (name: string, value: number) => act(async () => { const input = container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value)); input.dispatchEvent(new Event("input", { bubbles: true })); });
const previewBox = () => [...container.querySelectorAll(".xd-ps-dialog-buttons label")].find(label => label.textContent === "Preview")!.querySelector("input")!;
const altReset = async () => {
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true })); });
  await act(async () => { button("Reset").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true })); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" })); });
};
const toggle = (name: string) => act(async () => container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!.click());
const image = () => { const img = container.querySelector<HTMLImageElement>(".xd-photo-selection-image img")!; vi.spyOn(img, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect); return img; };
const stroke = async (extra: MouseEventInit = {}) => { const img = image(); for (const [type, clientX, clientY] of [["pointerdown", 50, 75], ["pointermove", 100, 100], ["pointerup", 150, 125]] as const) await act(async () => img.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY, ...extra }))); };
const value = (name: string) => container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
const historyAt = (index: number) => act(async () => usePhotoWorkspace.setState(workspace => ({ state: { ...workspace.state!, historySources: [{ id: "open", index, label: "Open", current: true, available: true }] } })));
// What the host's reply does: a new image version and history step (and the parent re-rendering with it) before the command settles.
const advance = () => { const version = ulid(); doc = { ...doc, version }; usePhotoWorkspace.setState(workspace => ({ stateVersion: version, busy: false, quiet: false, state: { ...workspace.state!, hasSelection: true, historySources: [{ id: version, index: (workspace.state!.historySources?.find(source => source.current)?.index ?? 0) + 1, label: "Edit", current: true, available: true }] } })); root.render(<SelectionDialog kind="refine" document={doc} close={close}/>); };
const editing = () => command.mockImplementation(async (id: string) => { if (["select.quick", "select.subject", "select.inverse"].includes(id)) advance(); return undefined; });
beforeEach(() => {
  localStorage.removeItem(SELECTION_PREFERENCES_KEY);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); command.mockReset(); command.mockResolvedValue(undefined); native.invoke.mockReset(); native.invoke.mockResolvedValue({ width: 64, height: 48, png: "AA==" }); native.enabled = false;
  close = vi.fn(); create = vi.fn(() => "blob:selection"); revoke = vi.fn(); vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return create(); } static override revokeObjectURL(url: string) { revoke(url); } });
  const id = ulid(), version = ulid(); doc = { id, version, name: "Selection image", width: 64, height: 48, previewWidth: 64, previewHeight: 48, bundlePath: "", previewPath: "/image.png", originalPath: null };
  const state: PhotoState = { name: "Selection image", width: 64, height: 48, mode: "RGB", depth: 16, resolution: 72, hasSelection: true, selectionBounds: [0, 0, 32, 48], activeLayer: 1, layers: [{ id: 1, name: "Pixels", kind: "Raster", hasPixels: true, visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false }], tools: { foreground: [.123456, 1.2, -.1, .75], background: [1, 1, 1, 1] }, canUndo: false, canRedo: false, viewKey: "composite", features: { selectionEdgeBrush: true } };
  usePhotoWorkspace.setState({ documentId: id, projectId: ulid(), state, stateVersion: version, busy: false, error: null }); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); usePhotoWorkspace.getState().close(); });
describe("native selection workspaces", () => {
  it("requires advertised native edge support and keeps global refinement usable with older binaries", async () => {
    await act(async () => usePhotoWorkspace.setState(workspace => ({ state: { ...workspace.state!, features: undefined } }))); await mount("refine");
    expect(container.textContent).toContain("requires the updated XDesign image engine"); expect(button("Brush at coordinate").disabled).toBe(true); expect(button("Refine Edge Brush Tool").disabled).toBe(true); expect(button("OK").disabled).toBe(false);
    await click("OK"); expect(command.mock.lastCall![1]).not.toHaveProperty("edgeBrushes");
  });
  it("previews and applies local refine/erase strokes with draft undo and keyboard coordinates", async () => {
    await mount("refine"); await number("Selection edge brush size", 12); await number("Selection edge X", 13); await number("Selection edge Y", 16); await click("Brush at coordinate");
    await toggle("Erase selection refinements"); await number("Selection edge X", 15); await click("Brush at coordinate");
    await act(async () => previewBox().click()); expect(native.invoke.mock.lastCall![1].params.edgeBrushes).toEqual([{ size: 12, erase: false, points: [[13, 16]] }, { size: 12, erase: true, points: [[15, 16]] }]);
    expect(command).not.toHaveBeenCalled(); await click("Undo edge stroke"); await click("OK"); expect(command.mock.lastCall![1]!.edgeBrushes).toEqual([{ size: 12, erase: false, points: [[13, 16]] }]);
    await click("Clear edge strokes"); await click("OK"); expect(command.mock.lastCall![1]).not.toHaveProperty("edgeBrushes");
  });
  it("captures reference-image strokes, cancels drafts and keeps remembered strokes image-local", async () => {
    await mount("refine"); await click("Refine Edge Brush Tool"); const image = container.querySelector<HTMLImageElement>(".xd-photo-selection-image img")!; vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
    const pointer = async (type: string, extra: MouseEventInit = {}) => act(async () => image.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: 50, clientY: 75, ...extra })));
    await pointer("pointerdown"); expect(button("OK").disabled).toBe(true); await pointer("pointermove", { clientX: 100, clientY: 100 }); await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))); expect(close).not.toHaveBeenCalled(); expect(button("OK").disabled).toBe(false);
    await pointer("pointerdown"); await pointer("pointercancel"); await click("OK"); expect(command.mock.lastCall![1]).not.toHaveProperty("edgeBrushes");
    await pointer("pointerdown", { altKey: true }); await pointer("pointermove", { clientX: 100, clientY: 100 }); await pointer("pointerup", { clientX: 150, clientY: 125 }); await toggle("Remember selection settings"); await click("OK");
    expect(command.mock.lastCall![1]!.edgeBrushes).toEqual([{ size: 30, erase: true, points: [[16, 16], [32, 24], [48, 32]] }]);
    expect(localStorage.getItem(SELECTION_PREFERENCES_KEY)).not.toContain("points");
  });
  it("remembers successful native settings and view on reopening, while cancel/reset/failure remain drafts", async () => {
    await mount("refine"); await number("Selection Radius (px)", 2.5); await number("Selection edge brush size", 44); await pick("Selection preview view", "overlay"); await toggle("Remember selection settings"); command.mockRejectedValueOnce(new Error("Failed")); await click("OK"); expect(localStorage.getItem(SELECTION_PREFERENCES_KEY)).toBeNull();
    await click("OK"); await act(async () => root.render(null)); await mount("refine"); expect(container.querySelector<HTMLInputElement>('[aria-label="Selection Radius (px)"]')!.value).toBe("2.5"); expect(container.querySelector<HTMLInputElement>('[aria-label="Selection edge brush size"]')!.value).toBe("44"); expect(container.querySelector<HTMLSelectElement>('[aria-label="Selection preview view"]')!.value).toBe("overlay");
    const saved = localStorage.getItem(SELECTION_PREFERENCES_KEY); await number("Selection Radius (px)", 9); await altReset(); expect(container.querySelector<HTMLInputElement>('[aria-label="Selection Radius (px)"]')!.value).toBe("2.5"); await click("Cancel"); expect(localStorage.getItem(SELECTION_PREFERENCES_KEY)).toBe(saved);
    await toggle("Remember selection settings"); await click("OK"); expect(JSON.parse(localStorage.getItem(SELECTION_PREFERENCES_KEY)!).workflows.refine).toBeUndefined();
  });
  it("applies every refine control with native units and explicit decontaminated output", async () => {
    await mount("refine"); expect(container.querySelector('[aria-label="Selection Decontamination (%)"]')).toBeNull(); await number("Selection Radius (px)", 2.5); await number("Selection Smooth", 12.25); await number("Selection Feather (px)", 3.5); await number("Selection Contrast (%)", 28); await number("Selection Shift edge (%)", -17); await toggle("Selection Smart radius"); await toggle("Selection Sample all layers"); await toggle("Selection Decontaminate colors");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Selection Output to"]')!.value).toBe("newLayerWithMask"); await number("Selection Decontamination (%)", 42); await click("OK"); expect(command).toHaveBeenCalledWith("select.refineEdge", { radius: 2.5, smooth: 12.25, feather: 3.5, contrast: 28, shiftEdge: -17, smartRadius: true, sampleAllLayers: true, decontaminate: true, amount: 42, output: "newLayerWithMask" }); expect(close).toHaveBeenCalledOnce();
  });
  it("blocks invalid selection/layer outputs while retaining the dialog", async () => {
    await act(async () => usePhotoWorkspace.setState(state => ({ state: { ...state.state!, hasSelection: false } }))); await mount("refine"); expect(button("OK").disabled).toBe(true); expect(container.textContent).toContain("Make a selection");
    await act(async () => usePhotoWorkspace.setState(state => ({ state: { ...state.state!, hasSelection: true, layers: state.state!.layers.map(layer => ({ ...layer, kind: "Text", hasPixels: false })) } }))); await pick("Selection Output to", "newLayer"); expect(button("OK").disabled).toBe(true); expect(container.textContent).toContain("layer with pixels"); await pick("Selection Output to", "layerMask"); expect(button("OK").disabled).toBe(false);
  });
  it("keeps focus fractions precise and combines the result by the chosen mode", async () => {
    await mount("focus"); await number("Selection Focus range", .375); await number("Selection Image noise", .125); await toggle("Selection Sample all layers"); await pick("Selection Mode", "intersect"); await click("OK"); expect(command).toHaveBeenCalledWith("select.focusArea", { range: .375, noise: .125, sampleAllLayers: false, mode: "intersect" });
  });
  it("retains values/errors after failure and prevents edits/cancel while busy", async () => {
    await mount("refine"); await number("Selection Feather (px)", 3); command.mockRejectedValueOnce(new Error("Native selection failed")); await click("OK"); expect(close).not.toHaveBeenCalled(); expect(container.textContent).toContain("Native selection failed"); await act(async () => usePhotoWorkspace.setState({ busy: true })); expect(button("Cancel").disabled).toBe(true); await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))); expect(close).not.toHaveBeenCalled(); await act(async () => usePhotoWorkspace.setState({ busy: false })); await altReset(); expect(container.querySelector<HTMLInputElement>('[aria-label="Selection Feather (px)"]')!.value).toBe("0"); await click("Cancel"); expect(close).toHaveBeenCalledOnce();
  });
  it("paints Quick Selection strokes that add or subtract (Alt flips the mode), remembers the size and is inert while busy", async () => {
    await mount("refine"); expect(button("Quick Selection Tool").getAttribute("aria-pressed")).toBe("true"); expect(button("Add to selection").getAttribute("aria-pressed")).toBe("true");
    expect(value("Selection quick selection size").value).toBe("30");
    await number("Selection quick selection size", 12); await stroke(); expect(command).toHaveBeenLastCalledWith("select.quick", { points: [[16, 16], [32, 24], [48, 32]], size: 12, mode: "add", sampleAllLayers: false });
    await stroke({ altKey: true }); expect(command.mock.lastCall).toEqual(["select.quick", expect.objectContaining({ mode: "subtract" })]);
    await click("Subtract from selection"); await toggle("Selection Sample all layers"); await stroke(); expect(command.mock.lastCall).toEqual(["select.quick", expect.objectContaining({ mode: "subtract", sampleAllLayers: true })]);
    await stroke({ altKey: true }); expect(command.mock.lastCall).toEqual(["select.quick", expect.objectContaining({ mode: "add" })]); expect(container.textContent).toContain("0 edge strokes"); expect(close).not.toHaveBeenCalled();
    await toggle("Remember selection settings"); await click("OK"); await act(async () => root.render(null)); await mount("refine"); expect(value("Selection quick selection size").value).toBe("12");
    await act(async () => usePhotoWorkspace.setState({ busy: true })); command.mockClear(); await stroke(); expect(command).not.toHaveBeenCalled();
    for (const name of ["Quick Selection Tool", "Refine Edge Brush Tool", "Add to selection", "Subtract from selection", "Select Subject", "Invert"]) expect(button(name).disabled).toBe(true);
    expect(value("Selection quick selection size").disabled).toBe(true);
  });
  it("paints the selection with the Brush Tool, one select.brush step per stroke at its own size and hardness, Alt flipping the mode and no layers sampled", async () => {
    await mount("refine"); await click("Brush Tool"); expect(button("Brush Tool").getAttribute("aria-pressed")).toBe("true"); expect(button("Brush Tool").disabled).toBe(false);
    expect(value("Selection quick selection size")).toBeNull(); expect(value("Selection brush tool size").value).toBe("30"); expect(value("Selection brush tool hardness").value).toBe("100");
    await number("Selection brush tool size", 20); await number("Selection brush tool hardness", 50); await stroke();
    expect(command.mock.calls).toEqual([["select.brush", { points: [[16, 16], [32, 24], [48, 32]], size: 20, hardness: 50, mode: "add" }]]);
    await stroke({ altKey: true }); expect(command.mock.lastCall).toEqual(["select.brush", expect.objectContaining({ mode: "subtract" })]);
    await click("Subtract from selection"); await toggle("Selection Sample all layers"); await stroke(); expect(command.mock.lastCall).toEqual(["select.brush", expect.objectContaining({ mode: "subtract" })]); expect(command.mock.lastCall![1]).not.toHaveProperty("sampleAllLayers");
    expect(container.textContent).toContain("0 edge strokes"); await click("Quick Selection Tool"); expect(value("Selection quick selection size").value).toBe("30"); await click("Brush Tool");
    await number("Selection brush tool hardness", 101); command.mockClear(); await stroke(); expect(command).not.toHaveBeenCalled(); await number("Selection brush tool hardness", 50);
    await toggle("Remember selection settings"); await click("OK"); await act(async () => root.render(null)); await mount("refine"); await click("Brush Tool");
    expect(value("Selection brush tool size").value).toBe("20"); expect(value("Selection brush tool hardness").value).toBe("50");
    await act(async () => usePhotoWorkspace.setState({ busy: true })); command.mockClear(); await stroke(); expect(command).not.toHaveBeenCalled();
    expect(button("Brush Tool").disabled).toBe(true); expect(value("Selection brush tool size").disabled).toBe(true); expect(value("Selection brush tool hardness").disabled).toBe(true);
  });
  it("inverts and selects the subject in place, staying open across its own edits even when the image settles first", async () => {
    await mount("refine"); let settle!: () => void;
    command.mockImplementationOnce(() => { usePhotoWorkspace.setState({ busy: true, quiet: true }); return new Promise<undefined>(resolve => { settle = () => resolve(undefined); }); });
    await click("Invert"); expect(command).toHaveBeenLastCalledWith("select.inverse", {}); await act(async () => advance()); expect(close).not.toHaveBeenCalled();
    await act(async () => settle()); expect(close).not.toHaveBeenCalled(); expect(button("OK").disabled).toBe(false);
    editing(); await toggle("Selection Sample all layers"); await click("Select Subject"); expect(command).toHaveBeenLastCalledWith("select.subject", { sampleAllLayers: true }); expect(close).not.toHaveBeenCalled();
    await act(async () => usePhotoWorkspace.setState({ stateVersion: ulid() })); expect(close).toHaveBeenCalled();
  });
  it("folds its edits and the refinement into one Select and Mask step on OK and rolls them back on Cancel, leaving untouched sessions alone", async () => {
    await historyAt(4); editing(); await mount("refine"); await click("Invert"); await stroke(); await click("OK");
    expect(command.mock.calls.map(call => call[0])).toEqual(["select.inverse", "select.quick", "select.refineEdge", "history.fold"]); expect(command).toHaveBeenLastCalledWith("history.fold", { fromId: "open", label: "Select and Mask" }); expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null)); command.mockClear(); close.mockClear(); await historyAt(4); await mount("refine"); await click("Select Subject"); await click("Cancel");
    expect(command).toHaveBeenLastCalledWith("history.select", { id: "open", discardRedo: true }); expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null)); command.mockClear(); await historyAt(4); await mount("refine"); await click("OK"); await mount("refine"); await click("Cancel"); expect(command.mock.calls.map(call => call[0])).toEqual(["select.refineEdge"]);
  });
  it("opens without a selection, where Invert and OK wait for the one its tools make", async () => {
    await act(async () => usePhotoWorkspace.setState(workspace => ({ state: { ...workspace.state!, hasSelection: false } }))); editing(); await mount("refine");
    expect(button("OK").disabled).toBe(true); expect(button("Invert").disabled).toBe(true); expect(button("Select Subject").disabled).toBe(false); expect(container.textContent).toContain("Make a selection to refine.");
    await stroke(); expect(command).toHaveBeenLastCalledWith("select.quick", expect.objectContaining({ mode: "add" })); expect(button("OK").disabled).toBe(false); expect(button("Invert").disabled).toBe(false); expect(close).not.toHaveBeenCalled();
  });
  it.each(["version", "project", "view", "document"])("closes stale %s selection workspaces without applying", async boundary => {
    await mount("focus"); await act(async () => usePhotoWorkspace.setState(state => boundary === "version" ? { stateVersion: ulid() } : boundary === "project" ? { projectId: ulid() } : boundary === "document" ? { documentId: ulid() } : { state: { ...state.state!, viewKey: "alpha" } })); expect(close).toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
  });
});
