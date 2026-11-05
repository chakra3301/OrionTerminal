import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoTextGeometryDialog, textBoxGeometry, textWarpStyle } from "./PhotoTextGeometryDialog";
import { ImageTypographyPanel } from "./ImageTypographyPanel";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer } from "./types";

const native = vi.hoisted(() => ({ run: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
const image: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 300, height: 200, previewWidth: 300, previewHeight: 200, bundlePath: "", previewPath: "image.png", originalPath: null };
const layer: PhotoLayer = { id: 1, name: "Type", kind: "Text", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false, text: { text: "Styled text", font: "Arial", sizePt: 20, shape: { kind: "box", x: 10, y: 20, width: 100, height: 60 }, transform: [0, 1, -1, 0, 80, 30], warp: { style: "warpArcLower", bend: -40, horizontalDistortion: 20, verticalDistortion: -15, orientation: "vertical" } } };
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({}); native.invoke.mockReset();
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null, state: null });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const input = async (label: string, value: string) => act(async () => {
  const element = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true }));
});
const select = async (label: string, value: string) => act(async () => {
  const element = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  element.value = value; element.dispatchEvent(new Event("change", { bubbles: true }));
});
const click = async (label: string) => act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click());
const submit = () => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

const altReset = () => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true })); });
const resetClick = () => act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === "Reset")!.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true })); window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" })); });

describe("editable image text geometry", () => {
  it("Alt-Reset restores the opening geometry", async () => {
    const close = vi.fn(); await act(async () => root.render(<PhotoTextGeometryDialog kind="box" document={image} layer={layer} close={close}/>));
    await input("Text origin X (px)", "77"); await altReset(); await resetClick();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Text origin X (px)"]')!.value).toBe("60"); await submit(); expect(native.run).not.toHaveBeenCalled();
  });
  it("maps imported local box offsets through the full affine transform", () => {
    expect(textBoxGeometry(layer)).toMatchObject({ x: 60, y: 40, width: 100, height: 60, box: true });
    expect(textWarpStyle("warpArcLower")).toBe("arcLower"); expect(textWarpStyle("warpUnknown")).toBe("warpUnknown");
  });
  it("resizes a rotated paragraph with one native edit without replacing character styles or warp", async () => {
    const close = vi.fn(); await act(async () => root.render(<PhotoTextGeometryDialog kind="box" document={image} layer={layer} close={close}/>));
    await input("Paragraph width (px)", "140"); await submit();
    expect(native.run).toHaveBeenCalledOnce(); expect(native.run).toHaveBeenCalledWith("type.edit", { layer: 1, box: [60, 40, 140, 60] }); expect(close).toHaveBeenCalledOnce();
  });
  it("nudges box origin and dimensions from keyboard handles", async () => {
    await act(async () => root.render(<PhotoTextGeometryDialog kind="box" document={image} layer={layer} close={() => {}}/>));
    await act(async () => container.querySelector('[aria-label="Text origin handle"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
    await act(async () => container.querySelector('[aria-label="Paragraph size handle"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await submit(); expect(native.run).toHaveBeenCalledWith("type.edit", { layer: 1, box: [70, 40, 100, 61] });
  });
  it("moves point text relative to its baseline without converting it", async () => {
    await act(async () => root.render(<PhotoTextGeometryDialog kind="box" document={image} layer={{ ...layer, text: { ...layer.text!, shape: { kind: "point" } } }} close={() => {}}/>));
    expect(container.querySelector('[aria-label="Paragraph width (px)"]')).toBeNull();
    await input("Text origin X (px)", "100"); await submit(); expect(native.run).toHaveBeenCalledWith("type.edit", { layer: 1, move: [20, 0] });
  });
  it("preserves imported warp fields and commits only after Apply", async () => {
    await act(async () => root.render(<PhotoTextGeometryDialog kind="warp" document={image} layer={layer} close={() => {}}/>));
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Text warp style"]')!.value).toBe("arcLower");
    await input("Text warp bend (%)", "65"); expect(native.run).not.toHaveBeenCalled(); await submit();
    expect(native.run).toHaveBeenCalledWith("type.warpText", { layer: 1, style: "arcLower", bend: 65, horizontalDistortion: 20, verticalDistortion: -15, orientation: "vertical" });
  });
  it("keeps an unknown imported warp until explicitly removed and retains failed edits", async () => {
    const close = vi.fn(); await act(async () => root.render(<PhotoTextGeometryDialog kind="warp" document={image} layer={{ ...layer, text: { ...layer.text!, warp: { ...layer.text!.warp!, style: "warpUnknown" } } }} close={close}/>));
    expect(container.textContent).toContain("cancel to preserve it"); await submit(); expect(native.run).not.toHaveBeenCalled();
    native.run.mockRejectedValueOnce(new Error("Native edit failed")); await click("Remove warp"); await submit(); expect(container.textContent).toContain("Native edit failed"); expect(close).not.toHaveBeenCalled();
  });
  it("does not create a version for unchanged geometry and rejects invalid dimensions or busy edits", async () => {
    const close = vi.fn(); await act(async () => root.render(<PhotoTextGeometryDialog kind="box" document={image} layer={layer} close={close}/>));
    await submit(); expect(close).toHaveBeenCalledOnce(); expect(native.run).not.toHaveBeenCalled();
    await input("Paragraph width (px)", "0"); await submit(); expect(native.run).not.toHaveBeenCalled();
    await input("Paragraph width (px)", "120"); await act(async () => usePhotoWorkspace.setState({ busy: true })); await submit(); expect(native.run).not.toHaveBeenCalled();
  });
  it("opens controls from Typography and converts text through the native preserving action", async () => {
    await act(async () => root.render(<div className="xd-photo"><aside><ImageTypographyPanel layer={layer} document={image}/></aside></div>));
    await click("Convert to point text"); expect(native.run).toHaveBeenCalledWith("type.convertToPointText", { layer: 1 });
    await click("Warp text…"); expect(container.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe("Warp text");
    expect(container.querySelector('[role="dialog"]')!.closest("aside")).toBeNull();
    expect(container.querySelector('.xd-photo-dialog-scrim')!.parentElement!.className).toBe("xd-photo");
    await select("Text warp style", "flag"); await click("Cancel"); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(native.run).toHaveBeenCalledOnce();
  });
  it("resizes in the imported local axes, ignores other pointers, and rolls back canceled gestures", async () => {
    await act(async () => root.render(<PhotoTextGeometryDialog kind="box" document={image} layer={layer} close={() => {}}/>));
    const stage = container.querySelector<SVGSVGElement>('[aria-label="Text geometry canvas"]')!;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200 }) as DOMRect;
    stage.setPointerCapture = vi.fn(); stage.hasPointerCapture = () => true; stage.releasePointerCapture = vi.fn();
    const event = (type: string, x: number, y: number, id = 7) => { const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }); Object.defineProperty(event, "pointerId", { value: id }); return event; };
    const handle = container.querySelector('[aria-label="Paragraph size handle"]')!;
    await act(async () => handle.dispatchEvent(event("pointerdown", 0, 140)));
    await act(async () => handle.dispatchEvent(event("pointerdown", 10, 150, 8)));
    await act(async () => stage.dispatchEvent(event("pointermove", -20, 180, 8)));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Paragraph width (px)"]')!.value).toBe("100");
    await act(async () => stage.dispatchEvent(event("pointermove", -20, 180)));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Paragraph width (px)"]')!.value).toBe("140");
    await act(async () => stage.dispatchEvent(event("pointercancel", -20, 180)));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Paragraph width (px)"]')!.value).toBe("100");
    await act(async () => handle.dispatchEvent(event("pointerdown", 0, 140)));
    await act(async () => stage.dispatchEvent(event("pointermove", -20, 180)));
    await act(async () => stage.dispatchEvent(event("pointerup", -30, 200)));
    await submit(); expect(native.run).toHaveBeenCalledWith("type.edit", { layer: 1, box: [60, 40, 160, 90] });
  });
});
