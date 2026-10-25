import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { humanBytes, ImageCommandDialog, ImageExportDialog, ImageSizeDialog, ImageTrimDialog, replacedColor, replacementFor } from "./ImageDialogs";
import { FADE, matchColorCommand, REPLACE_COLOR, SHADOWS_HIGHLIGHTS, STROKE } from "./imageCommands";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoState } from "./types";

const native = vi.hoisted(() => ({ run: vi.fn(), save: vi.fn(), open: vi.fn(), write: vi.fn(), read: vi.fn(), invoke: vi.fn(), tauri: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.tauri, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: native.save, open: native.open }));
vi.mock("../../../lib/ipc", () => ({ ipc: { saveFileAtomic: native.write, readFile: native.read } }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
const background = { id: 1, name: "Background", kind: "Raster", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false, locks: { transparency: true, pixels: false, position: true, all: false } };
const state: PhotoState = { name: "Shot", width: 400, height: 300, mode: "Rgb", depth: 8, resolution: 72, activeLayer: 1, hasSelection: false, selectionBounds: null, layers: [background], canUndo: false, canRedo: false };
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({}); native.tauri = false; native.invoke.mockReset(); native.save.mockReset(); native.open.mockReset(); native.write.mockReset().mockResolvedValue(undefined); native.read.mockReset();
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null, state });
  container = document.createElement("div"); container.className = "xd-photo"; document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const field = <T extends Element = HTMLInputElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
const submit = () => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const input = (label: string, value: string) => act(async () => { const element = field(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
const select = (label: string, value: string) => act(async () => { const element = field<HTMLSelectElement>(label); element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
const blur = (label: string) => act(async () => { field(label).dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
const click = (element: Element, init: MouseEventInit = {}) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })); });
const readouts = () => [...container.querySelectorAll(".xd-ps-dialog-readout")].map(line => line.textContent);

describe("Photoshop command dialogs", () => {
  it("separates Fade's blend modes into Photoshop's groups", async () => {
    await act(async () => root.render(<ImageCommandDialog command={FADE} close={vi.fn()}/>));
    expect([...field<HTMLSelectElement>("Mode").querySelectorAll("hr")].map(hr => hr.nextElementSibling!.textContent)).toEqual(["Darken", "Lighten", "Overlay", "Difference", "Hue"]);
  });
  it("groups Stroke like Photoshop, remembers the last values and resets to them with Alt", async () => {
    const close = vi.fn();
    await act(async () => root.render(<ImageCommandDialog command={STROKE} close={close}/>));
    expect(container.querySelector("h3")!.textContent).toBe("Stroke");
    expect([...container.querySelectorAll("legend")].map(legend => legend.textContent)).toEqual(["Stroke", "Location", "Blending"]);
    expect([...container.querySelectorAll(".xd-ps-dialog-unit")].map(unit => unit.textContent)).toEqual(["px", "%"]);
    expect([...container.querySelectorAll(".xd-ps-dialog-buttons button")].map(button => button.textContent)).toEqual(["OK", "Cancel"]);
    await input("Width", "3"); await click(container.querySelector('input[type="radio"][value="outside"]')!); await submit();
    expect(native.run).toHaveBeenLastCalledWith("edit.stroke", { width: 3, location: "outside", opacity: 100 }); expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(<ImageCommandDialog key="again" command={STROKE} close={close}/>));
    expect(field("Width").value).toBe("3"); expect(container.querySelector<HTMLInputElement>('input[type="radio"][value="outside"]')!.checked).toBe(true);
    await input("Width", "9");
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true })); });
    expect(button("Reset")).toBeDefined(); await click(button("Reset"), { altKey: true });
    expect(field("Width").value).toBe("3"); expect(close).toHaveBeenCalledOnce();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" })); });
    await click(button("Cancel")); expect(close).toHaveBeenCalledTimes(2);
  });
  it("names repeated labels by their group and pairs adjustment fields with sliders", async () => {
    await act(async () => root.render(<ImageCommandDialog command={SHADOWS_HIGHLIGHTS} close={vi.fn()}/>));
    expect(field("Shadows Amount").value).toBe("35"); expect(field("Highlights Amount").value).toBe("0"); expect(field("Shadows Amount slider").type).toBe("range");
    await click(field("Show More Options"));
    await input("Highlights Radius slider", "80"); expect(field("Highlights Radius").value).toBe("80");
  });
  it("shows only the two Amounts until Show More Options is on, then Black and White Clip too", async () => {
    await act(async () => root.render(<ImageCommandDialog command={SHADOWS_HIGHLIGHTS} close={vi.fn()}/>));
    expect([...container.querySelectorAll("legend")].map(legend => legend.textContent)).toEqual(["Shadows", "Highlights"]);
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(2);
    expect(field("Show More Options").checked).toBe(false); expect(button("Load…")).toBeDefined(); expect(button("Save…")).toBeDefined();
    expect(container.querySelector(".xd-ps-dialog")!.classList.contains("is-scroll")).toBe(true);
    await click(field("Show More Options"));
    expect([...container.querySelectorAll("legend")].map(legend => legend.textContent)).toEqual(["Shadows", "Highlights", "Adjustments"]);
    expect(field("Black Clip").value).toBe("0.01"); expect(field("White Clip").value).toBe("0.01");
    await input("Black Clip", "0.5"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.adjustments.shadowsHighlights", expect.objectContaining({ shadowAmount: 35, blackClip: 0.5, whiteClip: 0.01 }));
  });
  it("saves settings to and loads them from a JSON file, opening the extra options when they differ", async () => {
    await act(async () => root.render(<ImageCommandDialog command={SHADOWS_HIGHLIGHTS} close={vi.fn()}/>));
    await input("Shadows Amount", "60"); native.save.mockResolvedValue("/tmp/s.json"); await click(button("Save…"));
    expect(native.write).toHaveBeenCalledWith("/tmp/s.json", expect.stringContaining('"shadowAmount": 60'));
    native.open.mockResolvedValue("/tmp/l.json"); native.read.mockResolvedValue(JSON.stringify({ shadowAmount: 10, whiteClip: 3, midtone: 999 }));
    await click(button("Load…"));
    expect(field("Show More Options").checked).toBe(true); expect(field("Shadows Amount").value).toBe("10"); expect(field("White Clip").value).toBe("3"); expect(field("Midtone").value).toBe("0");
    native.read.mockResolvedValue("[1]"); await click(button("Load…")); expect(container.querySelector('[role="alert"]')!.textContent).toContain("not a settings file");
  });
  it("previews live while values change and stops when Preview is off", async () => {
    native.tauri = true; native.invoke.mockResolvedValue({ width: 1, height: 1, png: "AAAA" });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: vi.fn() }));
    const document_ = { id: "d", version: "v1", name: "Shot", width: 400, height: 300, previewPath: "/p.png" } as never;
    await act(async () => root.render(<ImageCommandDialog command={SHADOWS_HIGHLIGHTS} document={document_} canvas={container} close={vi.fn()}/>));
    const previewBox = () => container.querySelector<HTMLInputElement>(".xd-ps-dialog-buttons input[type=checkbox]")!;
    expect(previewBox().checked).toBe(true);
    await act(async () => { await new Promise(done => setTimeout(done, 300)); });
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "image.adjustments.shadowsHighlights", params: expect.objectContaining({ shadowAmount: 35 }) }));
    expect(container.querySelector("img.xd-photo-canvas-preview")).not.toBeNull();
    await input("Shadows Amount", "70"); await act(async () => { await new Promise(done => setTimeout(done, 400)); });
    expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_command_preview", expect.objectContaining({ params: expect.objectContaining({ shadowAmount: 70 }) }));
    await click(previewBox()); expect(container.querySelector("img.xd-photo-canvas-preview")).toBeNull();
  });
  it("lists the Match Color destination and gates the selection statistics", async () => {
    await act(async () => root.render(<ImageCommandDialog command={matchColorCommand([{ id: "a", version: "1", name: "Sunset" }])} close={vi.fn()}/>));
    expect(container.querySelector(".xd-ps-dialog-readout")!.textContent).toBe("Target: Shot (Background, RGB/8)");
    expect(field("Use Selection in Target to Calculate Colors").disabled).toBe(true); expect(field("Use Selection in Source to Calculate Colors").disabled).toBe(true);
    await select("Source", "a"); expect(field("Use Selection in Source to Calculate Colors").disabled).toBe(false);
    await click(field("Use Selection in Source to Calculate Colors")); expect(field("Use Selection in Source to Calculate Colors").checked).toBe(true);
    await click(field("Use Selection in Source to Calculate Colors"));
  });
  it("converts the Replace Color result swatch both ways and defaults to the foreground color", async () => {
    expect(replacedColor("#ff0000", 120, 0, 0)).toBe("#00ff00"); expect(replacedColor("#808080", 0, 0, 100)).toBe("#ffffff");
    expect(replacementFor("#ff0000", "#00ff00")).toEqual({ hue: 120, saturation: 0, lightness: 0 });
    await act(async () => root.render(<ImageCommandDialog command={REPLACE_COLOR} initial={{ color: "#336699" }} close={vi.fn()}/>));
    expect(field("Color").value).toBe("#336699");
    await input("Hue", "120"); expect(field("Result").value).toBe(replacedColor("#336699", 120, 0, 0));
    await input("Result", "#ff0000"); expect(Number(field("Hue").value)).not.toBe(120);
    expect(button("Load…")).toBeDefined();
  });
  it("drops a remembered source image once it is no longer open", async () => {
    await act(async () => root.render(<ImageCommandDialog command={matchColorCommand([{ id: "a", version: "1", name: "Sunset" }])} close={vi.fn()}/>));
    expect([...field<HTMLSelectElement>("Source").options].map(option => option.text)).toEqual(["None", "Sunset"]);
    await select("Source", "a"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.adjustments.matchColor", { luminance: 100, intensity: 100, fade: 0, neutralize: false, useSelectionInSource: false, useSelectionInTarget: false, sourcePhoto: { id: "a", version: "1" } });
    await act(async () => root.render(<ImageCommandDialog key="closed" command={matchColorCommand([])} close={vi.fn()}/>));
    expect(field<HTMLSelectElement>("Source").value).toBe("");
  });
});

describe("Image Size", () => {
  it("keeps proportions, reports the new size and picks the reduction method automatically", async () => {
    await act(async () => root.render(<ImageSizeDialog state={state} canvas={false} close={vi.fn()}/>));
    expect(readouts()).toEqual(["Image Size: 352K", "Dimensions: 400 px × 300 px"]);
    await input("Width", "200");
    expect(field("Height").value).toBe("150"); expect(readouts()).toEqual(["Image Size: 88K (was 352K)", "Dimensions: 200 px × 150 px"]);
    await submit(); expect(native.run).toHaveBeenLastCalledWith("image.imageSize", { width: 200, height: 150, resolution: 72, resample: "lanczos" });
  });
  it("changes only the resolution when Resample is off", async () => {
    await act(async () => root.render(<ImageSizeDialog state={state} canvas={false} close={vi.fn()}/>));
    await select("Width unit", "in"); expect(field("Width").value).toBe("5.56");
    await click(field("Resample"));
    expect(field("Height").disabled).toBe(true); expect(field<HTMLButtonElement>("Constrain aspect ratio").getAttribute("aria-pressed")).toBe("true");
    await input("Width", "2"); expect(field("Resolution").value).toBe("200");
    await submit(); expect(native.run).toHaveBeenLastCalledWith("image.imageSize", { width: 400, height: 300, resolution: 200, resample: "none" });
  });
  it("holds print size when the resolution changes with Resample on", async () => {
    await act(async () => root.render(<ImageSizeDialog state={state} canvas={false} close={vi.fn()}/>));
    await select("Width unit", "in"); await input("Resolution", "144");
    expect(readouts()[1]).toBe("Dimensions: 800 px × 600 px");
    await click(field("Constrain aspect ratio")); await input("Height", "100"); expect(readouts()[1]).toBe("Dimensions: 800 px × 100 px");
    await select("Resample method", "nearest"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.imageSize", { width: 800, height: 100, resolution: 144, resample: "nearest" });
  });
  it("fits a preset turned to the image's orientation and falls back to Custom once edited", async () => {
    await act(async () => root.render(<ImageSizeDialog state={state} canvas={false} close={vi.fn()}/>));
    await select("Fit To", "4 x 6 in 300 ppi");
    expect(readouts()[1]).toBe("Dimensions: 1600 px × 1200 px"); expect(field("Width").value).toBe("5.33"); expect(field("Resolution").value).toBe("300");
    await select("Fit To", "original"); expect(readouts()[1]).toBe("Dimensions: 400 px × 300 px");
    await select("Fit To", "640 x 480 px 72 ppi"); await input("Width", "320");
    expect(field<HTMLSelectElement>("Fit To").value).toBe("custom");
    await submit(); expect(native.run).toHaveBeenLastCalledWith("image.imageSize", { width: 320, height: 240, resolution: 72, resample: "lanczos" });
  });
});

describe("Canvas Size", () => {
  it("converts Relative values, anchors the growth and extends with the background color", async () => {
    await act(async () => root.render(<ImageSizeDialog state={state} canvas close={vi.fn()}/>));
    expect([...container.querySelectorAll("legend")].map(legend => legend.textContent)).toEqual(["Current Size: 352K", "New Size: 352K"]);
    expect(field<HTMLSelectElement>("Canvas extension color").value).toBe("background");
    await click(field("Relative")); expect(field("Width").value).toBe("0");
    await input("Width", "100"); await blur("Width"); await click(field("Relative")); expect(field("Width").value).toBe("500");
    await click(field("Anchor top left"));
    expect(field("Anchor top left").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".xd-ps-dialog-anchors svg")).toHaveLength(3);
    await act(async () => root.render(<ImageSizeDialog state={{ ...state, tools: { foreground: [1, 0, 0, 1], background: [0, 0, 1, 1] } }} canvas close={vi.fn()}/>));
    expect(field("Canvas extension custom color").value).toBe("#0000ff");
    await select("Canvas extension color", "foreground"); expect(field("Canvas extension custom color").value).toBe("#ff0000");
    await input("Canvas extension custom color", "#123456"); expect(field<HTMLSelectElement>("Canvas extension color").value).toBe("other"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.canvasSize", { width: 500, height: 300, anchor: "topLeft", extensionColor: "#123456" });
  });
  it("offers no extension color without a Background layer", async () => {
    await act(async () => root.render(<ImageSizeDialog state={{ ...state, layers: [{ ...background, name: "Layer 0", locks: undefined }] }} canvas close={vi.fn()}/>));
    expect(field<HTMLSelectElement>("Canvas extension color").disabled).toBe(true);
    expect(humanBytes(6016 * 6016 * 4)).toBe("138.1M"); expect(humanBytes(3 * 1024 ** 3)).toBe("3.00G");
  });
});

describe("Export As", () => {
  it("exports through the native save panel with the chosen quality", async () => {
    const choose = vi.fn().mockResolvedValue(undefined); native.save.mockResolvedValue("/tmp/Shot.jpg");
    await act(async () => root.render(<ImageExportDialog name="Shot.psd" choose={choose} close={vi.fn()}/>));
    expect(container.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe("Export As");
    await select("Format", "jpg"); await input("Quality", "70"); await click(button("Export"));
    expect(native.save).toHaveBeenCalledWith({ defaultPath: "Shot.jpg", filters: [{ name: "JPEG", extensions: ["jpg", "jpeg"] }] });
    expect(choose).toHaveBeenCalledWith("/tmp/Shot.jpg", 70);
  });
});

describe("Trim dialog", () => {
  const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  it("offers Photoshop's Based On and Trim Away, with Transparent Pixels only when the image can be transparent", async () => {
    await act(async () => root.render(<ImageTrimDialog state={state} close={vi.fn()}/>));
    expect([...container.querySelectorAll("legend")].map(legend => legend.textContent)).toEqual(["Based On", "Trim Away"]);
    expect(radios().map(radio => [radio.value, radio.disabled, radio.checked])).toEqual([["transparent", true, false], ["topLeft", false, true], ["bottomRight", false, false]]);
    expect([...container.querySelectorAll(".xd-ps-dialog-checks input")].map(box => [box.getAttribute("aria-label"), (box as HTMLInputElement).checked])).toEqual([["Top", true], ["Bottom", true], ["Left", true], ["Right", true]]);
    await act(async () => root.render(<ImageTrimDialog key="layers" state={{ ...state, layers: [{ ...background, id: 2, name: "Layer 1", locks: undefined }] }} close={vi.fn()}/>));
    expect(radios()[0]!.disabled).toBe(false); expect(radios()[0]!.checked).toBe(true);
  });
  it("runs image.trim with the chosen base and sides, and remembers them", async () => {
    const close = vi.fn();
    await act(async () => root.render(<ImageTrimDialog state={state} close={close}/>));
    await click(radios()[2]!); await click(field("Left")); await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.trim", { basedOn: "bottomRight", top: true, bottom: true, left: false, right: true }); expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(<ImageTrimDialog key="again" state={state} close={close}/>));
    expect(radios()[2]!.checked).toBe(true); expect(field("Left").checked).toBe(false);
    for (const side of ["Top", "Bottom", "Right"]) await click(field(side));
    expect(button("OK").disabled).toBe(true);
  });
});

describe("Dialog positions", () => {
  it("reopens a moved dialog where it was left", async () => {
    const drag = (x: number, y: number) => act(async () => {
      const header = container.querySelector("header")!, form = container.querySelector("form")!;
      form.parentElement!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 } as DOMRect);
      form.getBoundingClientRect = () => ({ left: 300, top: 200, right: 500, bottom: 400, width: 200, height: 200 } as DOMRect);
      const at = (type: string, cx: number, cy: number) => header.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: cx, clientY: cy }));
      at("pointerdown", 10, 10); at("pointermove", 10 + x, 10 + y); at("pointerup", 10 + x, 10 + y);
    });
    await act(async () => root.render(<ImageCommandDialog command={STROKE} close={vi.fn()}/>));
    await drag(40, 25);
    expect(container.querySelector("form")!.style.transform).toBe("translate(40px, 25px)");
    await act(async () => root.render(<div key="other"><ImageCommandDialog command={STROKE} close={vi.fn()}/></div>));
    expect(container.querySelector("form")!.style.transform).toBe("translate(40px, 25px)");
    await act(async () => root.render(<ImageSizeDialog state={state} canvas={false} close={vi.fn()}/>));
    expect(container.querySelector("form")!.style.transform).toBe("translate(0px, 0px)");
  });
});

describe("Image Size resample list", () => {
  it("uses Photoshop's wording for the methods the engine can run", async () => {
    await act(async () => root.render(<ImageSizeDialog state={state} canvas={false} close={vi.fn()}/>));
    expect([...field<HTMLSelectElement>("Resample method").options].map(option => [option.value, option.text])).toEqual([
      ["automatic", "Automatic"], ["preserveDetails", "Preserve Details (enlargement)"], ["lanczos", "Bicubic Sharper (reduction)"], ["bicubic", "Bicubic (smooth gradients)"], ["nearest", "Nearest Neighbor (hard edges)"], ["bilinear", "Bilinear"]]);
  });
});

describe("Image Size preview", () => {
  it("shows a thumbnail that follows the new proportions", async () => {
    const document_ = { id: "d", version: "v1", name: "Shot", width: 400, height: 300, previewPath: "/p.png" } as never;
    await act(async () => root.render(<ImageSizeDialog state={state} document={document_} canvas={false} close={vi.fn()}/>));
    const thumb = () => container.querySelector<HTMLImageElement>(".xd-ps-dialog-thumb img")!;
    expect([thumb().width, thumb().height]).toEqual([160, 120]);
    await click(field("Constrain aspect ratio")); await input("Width", "100");
    expect(Number(field("Width").value)).toBe(100); expect(Number(field("Height").value)).toBe(300);
    expect(thumb().width / thumb().height).toBeCloseTo(100 / 300, 1);
  });
});
