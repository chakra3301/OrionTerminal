import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelCompositeDialog, type ChannelCompositeKind } from "./ChannelCompositeDialog";
import { CHANNEL_BLENDS, changeSourceLayer, sourceChoices } from "./channelSources";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoState } from "./types";

const native = vi.hoisted(() => ({ enabled: false, run: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
const photo: PhotoDocument = { id: "photo", version: "v1", name: "Portrait", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
const raster = { id: 7, name: "Portrait pixels", kind: "Raster", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: true, hasVectorMask: true, hasPixels: true };
const state: PhotoState = { name: "Portrait", width: 100, height: 100, mode: "RGB", depth: 16, resolution: 72, activeLayer: 7, hasSelection: true, selectionBounds: [0, 0, 100, 100], layers: [raster, { ...raster, id: 9, name: "Type group", kind: "Group", hasPixels: false, hasMask: false, hasVectorMask: false, children: [{ ...raster, id: 11, name: "Label", kind: "Text", hasPixels: false }] }], channels: { composite: "RGB", colors: ["Red", "Green", "Blue"].map(name => ({ name, visible: true })), alpha: [{ index: 0, name: "Red", visible: false, spot: null }, { index: 1, name: "Spot detail", visible: false, spot: { color: "#00ff00" } }], target: { kind: "composite" } }, quickMask: true, viewKey: "composite", canUndo: true, canRedo: false };
let root: Root, container: HTMLDivElement, canvas: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.enabled = false; native.run.mockReset().mockResolvedValue({}); native.invoke.mockReset();
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null, state: structuredClone(state) });
  container = document.createElement("div"); canvas = document.createElement("div"); document.body.append(container, canvas); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); canvas.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const render = (kind: ChannelCompositeKind, close = vi.fn(), doc = photo, mask = false) => act(async () => root.render(<ChannelCompositeDialog kind={kind} document={doc} mask={mask} canvas={canvas} close={close}/>));
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
const click = (text: string) => act(async () => button(text).click());
const previewBox = () => [...container.querySelectorAll(".xd-ps-dialog-buttons label")].find(label => label.textContent === "Preview")?.querySelector("input")!;
const preview = async () => { if (!previewBox().checked) await act(async () => previewBox().click()); };
const altReset = async () => {
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true })); });
  await act(async () => { button("Reset").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true })); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" })); });
};
const submit = () => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const input = (label: string, value: string) => act(async () => { const element = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
const select = (label: string, value: string) => act(async () => { const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
const toggle = (label: string) => act(async () => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!.click());

describe("native channel compositing controls", () => {
  it("uses numeric channel references so saved-channel names cannot collide with colors", () => {
    const choices = sourceChoices(state, { layer: 7, channel: "composite", invert: false });
    expect(choices.find(choice => choice.key === "color:0")!.channel).toEqual({ color: 0 });
    expect(choices.find(choice => choice.key === "alpha:0")!.channel).toBe(0);
    expect(choices.find(choice => choice.key === "alpha:0")!.label).not.toBe(choices.find(choice => choice.key === "color:0")!.label);
    expect(choices.map(choice => choice.key)).toContain("vectorMask");
    expect(choices.map(choice => choice.key)).toContain("selection");
    const nonpixel = changeSourceLayer(state, { layer: 7, channel: "composite", invert: false }, 11);
    expect(nonpixel.channel).toBe(0); expect(sourceChoices(state, nonpixel).some(choice => choice.key === "composite")).toBe(false);
    const merged = changeSourceLayer(state, { layer: 7, channel: "mask", invert: true }, "merged");
    expect(merged).toEqual({ layer: "merged", channel: "composite", invert: true });
  });
  it("routes one Apply Image to the active mask with an inverted source and optional compositing mask", async () => {
    const close = vi.fn(); await render("apply", close, photo, true);
    await select("Source layer", "7"); await select("Source channel", "color:1"); await toggle("Source invert");
    await select("Channel blending", "subtract"); await input("Channel opacity (%)", "65"); await input("Channel scale", "1.5"); await input("Channel offset", "-20");
    await toggle("Use compositing mask"); await select("Mask channel", "alpha:1"); await toggle("Mask invert"); await toggle("Preserve transparency"); await submit();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Preserve transparency"]')!.disabled).toBe(true);
    expect(native.run).toHaveBeenCalledOnce(); expect(native.run).toHaveBeenCalledWith("image.applyImage", { source: { layer: 7, channel: { color: 1 }, invert: true }, blending: "subtract", opacity: 65, scale: 1.5, offset: -20, preserveTransparency: false, target: "mask", mask: { layer: "merged", channel: 1, invert: true } }); expect(close).toHaveBeenCalledOnce();
  });
  it("preserves arithmetic settings while omitting inactive masks and scales", async () => {
    await render("apply"); await select("Channel blending", "add"); await input("Channel scale", "1.75"); await input("Channel offset", "12"); await toggle("Use compositing mask"); await toggle("Use compositing mask"); await select("Channel blending", "screen"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.applyImage", { source: { layer: "merged", channel: "composite", invert: false }, blending: "screen", opacity: 100, preserveTransparency: false });
    await select("Channel blending", "add"); expect(container.querySelector<HTMLInputElement>('[aria-label="Channel scale"]')!.value).toBe("1.75");
    expect(container.querySelectorAll('[aria-label="Channel blending"] option')).toHaveLength(CHANNEL_BLENDS.length);
    await input("Channel scale", "");await select("Channel blending", "screen");expect(button("OK").disabled).toBe(false);
  });
  it("keeps independent calculation sources and supports swapping and named channel output", async () => {
    await render("calculations"); await select("Source 1 channel", "alpha:0"); await select("Source 2 layer", "7"); await select("Source 2 channel", "mask"); await toggle("Source 2 invert"); await click("Swap sources"); await input("Result channel name", "  Soft detail  "); await submit();
    expect(native.run).toHaveBeenCalledWith("image.calculations", { source1: { layer: 7, channel: "mask", invert: true }, source2: { layer: "merged", channel: 0, invert: false }, blending: "multiply", opacity: 100, result: "newChannel", name: "Soft detail" });
    expect(container.querySelector('[aria-label="Calculation result"] option[value="newDocument"]')).not.toBeNull();
  });
  it("produces a selection without leaking a previous channel name and resets every source", async () => {
    await render("calculations"); await input("Result channel name", "💡".repeat(200)); expect(button("OK").disabled).toBe(true);await select("Calculation result", "selection"); await submit();
    expect(native.run).toHaveBeenCalledWith("image.calculations", expect.objectContaining({ result: "selection" })); expect(native.run.mock.lastCall![1]).not.toHaveProperty("name");
    await altReset(); expect(container.querySelector<HTMLSelectElement>('[aria-label="Calculation result"]')!.value).toBe("newChannel"); expect(container.querySelector<HTMLInputElement>('[aria-label="Result channel name"]')!.value).toBe("");
  });
  it.each(["new", "add", "subtract", "intersect"])("loads source coverage with %s selection operation", async operation => {
    await render("load"); await select("Source layer", "11"); await select("Source channel", "vectorMask"); await toggle("Source invert"); await select("Selection operation", operation); await submit();
    expect(native.run).toHaveBeenCalledWith("select.loadSelection", { layer: 11, channel: "vectorMask", invert: true, operation });
  });
  it("previews real coverage using the frozen document/view and cancels without an edit", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:coverage"); const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    native.invoke.mockResolvedValue({ width: 100, height: 100, png: "AA==" }); const close = vi.fn();
    await render("calculations", close); await select("Calculation result", "selection"); await preview();
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "image.calculations", version: "v1", viewKey: "composite", params: expect.objectContaining({ result: "selection" }) }));
    expect(canvas.querySelector("img.xd-photo-canvas-preview")!.getAttribute("src")).toBe("blob:coverage"); expect(container.querySelector("img")).toBeNull();
    await act(async () => previewBox().click()); expect(canvas.querySelector("img")).toBeNull(); await click("Cancel"); expect(close).toHaveBeenCalledOnce(); expect(native.run).not.toHaveBeenCalled();
    act(() => root.unmount()); root = createRoot(container); expect(revoke).toHaveBeenCalledWith("blob:coverage");
  });
  it("rejects invalid arithmetic settings and failed edits while retaining controls", async () => {
    const close = vi.fn(); await render("apply", close); await select("Channel blending", "add"); await input("Channel scale", ""); await submit(); expect(native.run).not.toHaveBeenCalled(); expect(button("OK").disabled).toBe(true);
    await input("Channel scale", "3"); await submit(); expect(native.run).not.toHaveBeenCalled(); await input("Channel scale", "1.5"); native.run.mockRejectedValue(new Error("Layer is locked")); await submit(); expect(close).not.toHaveBeenCalled(); expect(container.textContent).toContain("Layer is locked");
  });
  it("blocks Apply when the current target changes or the image exceeds the compositing bound", async () => {
    await render("apply"); await act(async () => usePhotoWorkspace.setState({ state: { ...state, viewKey: "alpha:1" } })); await submit(); expect(native.run).not.toHaveBeenCalled(); expect(container.textContent).toContain("edit target changed");
    act(() => root.unmount()); root = createRoot(container); await render("calculations", vi.fn(), { ...photo, width: 17000, height: 17000 }); await submit(); expect(native.run).not.toHaveBeenCalled(); expect(container.textContent).toContain("256 megapixel");
  });
  it("keeps the dialog open while an edit is busy and rejects missing source references", async () => {
    const close = vi.fn(); await render("apply", close); await select("Source channel", "alpha:1");
    await act(async () => usePhotoWorkspace.setState({ state: { ...state, channels: { ...state.channels!, alpha: [] } } })); await submit(); expect(native.run).not.toHaveBeenCalled();
    await act(async () => usePhotoWorkspace.setState({ busy: true })); await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(close).not.toHaveBeenCalled(); expect(button("Cancel").disabled).toBe(true);
  });
});
