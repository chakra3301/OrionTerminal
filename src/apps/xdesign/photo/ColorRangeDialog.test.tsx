import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { ColorRangeDialog } from "./ColorRangeDialog";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoState } from "./types";
import { SELECTION_PREFERENCES_KEY } from "./selectionPreferences";
const native = vi.hoisted(() => ({ invoke: vi.fn(), enabled: false }));
const command = vi.hoisted(() => vi.fn(async (_id: string, _params: Record<string, unknown> = {}) => undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => native.enabled, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: command }));
let root: Root, container: HTMLDivElement, doc: PhotoDocument, close: ReturnType<typeof vi.fn<() => void>>, create: ReturnType<typeof vi.fn<() => string>>, canvas: HTMLDivElement | null;
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
const query = <T extends Element>(name: string) => container.querySelector<T>(`[aria-label="${name}"]`)!;
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === name || button.textContent === name)!;
const click = (name: string, init: MouseEventInit = {}) => act(async () => button(name).dispatchEvent(new MouseEvent("click", { bubbles: true, ...init })));
const mount = () => act(async () => root.render(<ColorRangeDialog document={doc} canvas={canvas} close={close}/>));
const pick = (name: string, value: string) => act(async () => { const input = query<HTMLSelectElement>(name); input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
const number = (name: string, value: number) => act(async () => { const input = query<HTMLInputElement>(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value)); input.dispatchEvent(new Event("input", { bubbles: true })); });
const toggle = (name: string) => act(async () => query<HTMLInputElement>(name).click());
const pointer = (target: Element, type: string, init: MouseEventInit) => act(async () => target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...init })));
const key = (type: "keydown" | "keyup", init: KeyboardEventInit) => act(async () => window.dispatchEvent(new KeyboardEvent(type, init)));
const settle = () => act(() => vi.advanceTimersByTimeAsync(200));
const thumbnail = () => container.querySelector<HTMLImageElement>(".xd-photo-color-range-thumb img")!;
const lastPreview = () => native.invoke.mock.lastCall![1] as { selectionView: string; params: Record<string, unknown> };
beforeEach(() => {
  localStorage.removeItem(SELECTION_PREFERENCES_KEY);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); command.mockReset(); command.mockResolvedValue(undefined); native.invoke.mockReset(); native.invoke.mockResolvedValue({ width: 64, height: 48, png: "AA==" }); native.enabled = false; canvas = null;
  let urls = 0; close = vi.fn(); create = vi.fn(() => `blob:${++urls}`); vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return create(); } static override revokeObjectURL() {} });
  const id = ulid(), version = ulid(); doc = { id, version, name: "Selection image", width: 64, height: 48, previewWidth: 64, previewHeight: 48, bundlePath: "", previewPath: "/image.png", originalPath: null };
  const state: PhotoState = { name: "Selection image", width: 64, height: 48, mode: "RGB", depth: 16, resolution: 72, hasSelection: true, selectionBounds: [0, 0, 32, 48], activeLayer: 1, layers: [{ id: 1, name: "Pixels", kind: "Raster", hasPixels: true, visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false }], tools: { foreground: [.123456, 1.2, -.1, .75], background: [1, 1, 1, 1] }, canUndo: false, canRedo: false, viewKey: "composite" };
  usePhotoWorkspace.setState({ documentId: id, projectId: ulid(), state, stateVersion: version, busy: false, error: null }); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); canvas?.parentElement?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); usePhotoWorkspace.getState().close(); });
const documentWindow = () => {
  const stage = document.createElement("div"); stage.className = "xd-photo-stage"; canvas = document.createElement("div"); canvas.className = "xd-photo-image"; stage.append(canvas); document.body.append(stage);
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(rect(0, 0, 600, 600)); vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect(100, 100, 640, 480));
};

describe("Color Range", () => {
  it("starts from the foreground color and, like Photoshop, reads the composite within the active selection", async () => {
    localStorage.setItem(SELECTION_PREFERENCES_KEY, JSON.stringify({ schemaVersion: 1, workflows: { color: { options: { sampleAllLayers: false, mode: "add" }, view: "mask", brushSize: 30 } } }));
    await mount(); expect(query("Select").textContent).toContain("Out Of Gamut"); expect(button("Cancel")).toBeTruthy();
    await click("OK"); expect(command).toHaveBeenCalledWith("select.colorRange", { select: "sampledColors", colors: [[.123456, 1.2, -.1, .75]], fuzziness: 40, localized: false, invert: false, sampleAllLayers: true, mode: "intersect" }); expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null)); await act(async () => usePhotoWorkspace.setState(state => ({ state: { ...state.state!, hasSelection: false } }))); await mount(); await click("OK");
    expect(command.mock.lastCall![1]).toMatchObject({ sampleAllLayers: true, mode: "replace" });
  });
  it("renders the grayscale thumbnail live and draws mattes on the document, reusing the mask for Grayscale", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); native.enabled = true; documentWindow(); await mount(); await settle();
    expect(native.invoke).toHaveBeenCalledTimes(1); expect(lastPreview().selectionView).toBe("mask"); expect(thumbnail().alt).toBe("Color Range selection"); expect(thumbnail().getAttribute("src")).toBe("blob:1");
    expect(canvas!.querySelector("img")).toBeNull();
    await pick("Selection Preview", "black"); await settle(); expect(lastPreview().selectionView).toBe("black"); expect(canvas!.querySelector("img")!.getAttribute("src")).toBe("blob:2"); expect(canvas!.querySelector("img")!.className).toBe("xd-photo-canvas-preview");
    const calls = native.invoke.mock.calls.length; await pick("Selection Preview", "mask"); await settle(); expect(native.invoke).toHaveBeenCalledTimes(calls); expect(canvas!.querySelector("img")!.getAttribute("src")).toBe("blob:1");
    await number("Fuzziness", 80); await settle(); expect(lastPreview().params.fuzziness).toBe(80);
    await pick("Selection Preview", "none"); expect(canvas!.querySelector("img")).toBeNull();
    await key("keydown", { key: "Meta", metaKey: true }); expect(thumbnail().alt).toBe("Color Range image"); expect(query<HTMLInputElement>("Image").checked).toBe(true);
    await key("keyup", { key: "Meta" }); expect(thumbnail().alt).toBe("Color Range selection"); await toggle("Image"); expect(thumbnail().getAttribute("src")).toBe("/image.png");
  });
  it("samples the thumbnail and the visible document with the eyedroppers, Shift adding and Alt subtracting", async () => {
    documentWindow(); await mount(); vi.spyOn(thumbnail(), "getBoundingClientRect").mockReturnValue(rect(0, 0, 200, 200));
    await pointer(thumbnail(), "pointerdown", { clientX: 50, clientY: 20 }); await pointer(thumbnail(), "pointerdown", { clientX: 50, clientY: 75 });
    await pointer(thumbnail(), "pointerdown", { clientX: 100, clientY: 75, shiftKey: true }); await pointer(thumbnail(), "pointerdown", { clientX: 150, clientY: 75, altKey: true });
    const scrim = container.querySelector(".xd-ps-dialog-scrim")!; await click("Add to Sample"); expect(button("Add to Sample").getAttribute("aria-pressed")).toBe("true");
    await pointer(scrim, "pointermove", { clientX: 420, clientY: 340 }); expect(scrim.classList).toContain("xd-photo-eyedropper-cursor");
    await pointer(scrim, "pointerdown", { clientX: 420, clientY: 340 }); await pointer(scrim, "pointerdown", { clientX: 700, clientY: 340 });
    await toggle("Localized Color Clusters"); await number("Range", 25); await number("Fuzziness", 50); await click("OK");
    expect(command).toHaveBeenCalledWith("select.colorRange", { select: "sampledColors", points: [[16, 16], [32, 16], [32, 24]], subtractPoints: [[48, 16]], fuzziness: 50, localized: true, range: 25, sampleAllLayers: true, invert: false, mode: "intersect" });
  });
  it("subtracts from the starting foreground sample", async () => {
    await mount(); vi.spyOn(thumbnail(), "getBoundingClientRect").mockReturnValue(rect(0, 0, 200, 200)); await click("Subtract from Sample"); await pointer(thumbnail(), "pointerdown", { clientX: 100, clientY: 75 });
    await click("OK"); expect(command.mock.lastCall![1]).toMatchObject({ colors: [[.123456, 1.2, -.1, .75]], subtractPoints: [[32, 16]] });
  });
  it("disables what each Select choice does not use and applies hue and tonal presets", async () => {
    await mount(); await number("Fuzziness", 150); await pick("Select", "blues");
    expect(query<HTMLInputElement>("Fuzziness").disabled).toBe(true); expect(query<HTMLInputElement>("Range").disabled).toBe(true); expect(button("Eyedropper Tool").disabled).toBe(true); expect(query<HTMLInputElement>("Localized Color Clusters").disabled).toBe(true);
    await click("OK"); expect(command).toHaveBeenLastCalledWith("select.colorRange", { select: "blues", sampleAllLayers: true, invert: false, mode: "intersect" });
    await act(async () => root.render(null)); await mount(); expect(query<HTMLSelectElement>("Select").value).toBe("blues"); await pick("Select", "midtones");
    await number("Range low", 170); await number("Range high", 90); expect(button("OK").disabled).toBe(true); await number("Range low", 70); await number("Fuzziness", 15); await toggle("Invert");
    await click("OK"); expect(command).toHaveBeenLastCalledWith("select.colorRange", { select: "midtones", tonalRange: [70, 90], fuzziness: 15, sampleAllLayers: true, invert: true, mode: "intersect" });
    await act(async () => root.render(null)); await mount(); await pick("Select", "highlights"); await number("Range", 200); await click("OK"); expect(command).toHaveBeenLastCalledWith("select.colorRange", expect.objectContaining({ select: "highlights", tonalRange: 200 }));
  });
  it("turns Cancel into Reset while Alt is held, restoring the values the dialog opened with", async () => {
    await mount(); await number("Fuzziness", 120); await toggle("Invert"); await key("keydown", { key: "Alt", altKey: true }); expect(button("Reset")).toBeTruthy();
    await click("Reset", { altKey: true }); expect(close).not.toHaveBeenCalled(); expect(query<HTMLInputElement>("Fuzziness").value).toBe("40"); expect(query<HTMLInputElement>("Invert").checked).toBe(false);
    await key("keyup", { key: "Alt" }); await click("Cancel"); expect(close).toHaveBeenCalledOnce(); expect(localStorage.getItem(SELECTION_PREFERENCES_KEY)).toBeNull();
  });
  it("remembers settings and the Selection Preview choice after OK only", async () => {
    await mount(); await number("Fuzziness", 64); await pick("Selection Preview", "overlay"); command.mockRejectedValueOnce(new Error("Native selection failed")); await click("OK");
    expect(container.textContent).toContain("Native selection failed"); expect(localStorage.getItem(SELECTION_PREFERENCES_KEY)).toBeNull(); await click("OK");
    await act(async () => root.render(null)); await mount(); expect(query<HTMLInputElement>("Fuzziness").value).toBe("64"); expect(query<HTMLSelectElement>("Selection Preview").value).toBe("overlay");
  });
  it("moves by its title bar and stays inside the workspace", async () => {
    await mount(); const form = container.querySelector<HTMLFormElement>("form")!, header = form.querySelector("header")!;
    vi.spyOn(form, "getBoundingClientRect").mockReturnValue(rect(500, 56, 400, 400)); vi.spyOn(container.querySelector(".xd-ps-dialog-scrim")!, "getBoundingClientRect").mockReturnValue(rect(0, 0, 1000, 800));
    await pointer(header, "pointerdown", { clientX: 600, clientY: 60 }); await pointer(header, "pointermove", { clientX: 550, clientY: 90 }); expect(form.style.transform).toBe("translate(-50px, 30px)");
    await pointer(header, "pointermove", { clientX: 900, clientY: 0 }); expect(form.style.transform).toBe("translate(100px, -56px)"); await pointer(header, "pointerup", {});
    await pointer(header, "pointermove", { clientX: 0, clientY: 0 }); expect(form.style.transform).toBe("translate(100px, -56px)");
  });
  it.each(["version", "project", "view", "document"])("closes when the %s changes without applying", async boundary => {
    await mount(); await act(async () => usePhotoWorkspace.setState(state => boundary === "version" ? { stateVersion: ulid() } : boundary === "project" ? { projectId: ulid() } : boundary === "document" ? { documentId: ulid() } : { state: { ...state.state!, viewKey: "alpha" } })); expect(close).toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
  });
  it("does not allocate late preview images after closing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); native.enabled = true; let finish!: (reply: unknown) => void; native.invoke.mockReturnValueOnce(new Promise(resolve => finish = resolve));
    await mount(); await settle(); await act(async () => root.unmount()); root = createRoot(container); await act(async () => finish({ width: 64, height: 48, png: "AA==" })); expect(create).not.toHaveBeenCalled();
  });
});
