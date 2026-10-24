import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AdjustmentControls, type Settings } from "./actionControls";
import { adjustmentDefaults } from "./adjustmentSettings";
import { ADJUSTMENTS } from "./controls";
import { usePhotoWorkspace } from "./runtime";
import { autoLevels, curveLut, type HistogramSource } from "./toneControls";
import { clippingPixels, toneLuts } from "./toneClipping";
import type { PhotoDocument } from "./types";

const native = vi.hoisted(() => ({ tauri: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.tauri, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
const source: HistogramSource = { document: photo, layer: 7, below: true };
let root: Root, container: HTMLDivElement, outside: HTMLElement[] = [], changed: Mock<(key: string, value: unknown) => void>, shown: Settings;

function Fixture({ id, mode = "RGB", initial = {}, from, canvas, slot }: { id: string; mode?: string; initial?: Settings; from?: HistogramSource; canvas?: HTMLElement; slot?: HTMLElement }) {
  const action = ADJUSTMENTS.find(item => item.id === id)!;
  const [values, setValues] = useState<Settings>(() => ({ ...adjustmentDefaults(action, mode), ...initial })), [channel, setChannel] = useState("");
  shown = values;
  return <AdjustmentControls action={action} values={values} setValues={setValues} change={(key, value) => { changed(key, value); setValues(current => ({ ...current, [key]: value })); }} locked={false} mode={mode}
    channel={channel} setChannel={setChannel} range="master" setRange={() => {}} loadingFile={false} setLoadingFile={() => {}} setLocalError={() => {}} source={from} canvas={canvas} toolSlot={slot}/>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.tauri = false; native.invoke.mockReset(); changed = vi.fn();
  usePhotoWorkspace.setState({ projectId: "project" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); outside.splice(0).forEach(item => item.remove()); vi.unstubAllGlobals(); vi.useRealTimers(); });
// The root clears its container on first render, so a stage or button column lives beside it, as in the app.
const beside = <T extends HTMLElement>(item: T) => { document.body.append(item); outside.push(item); return item; };
const render = (props: Parameters<typeof Fixture>[0]) => act(async () => root.render(<Fixture {...props}/>));
const by = <T extends Element = HTMLElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`)!;
const strips = () => [...container.querySelectorAll<HTMLElement>(".xd-photo-tone-strip")].map(strip => { strip.getBoundingClientRect = () => ({ left: 0, top: 0, width: 255, height: 14 } as DOMRect); strip.setPointerCapture = vi.fn(); return strip; });
const pointer = (target: Element, type: string, x: number) => act(async () => { target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x }), { pointerId: 3 })); });
const key = (label: string, key: string, shiftKey = false) => act(async () => { by(label).dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })); });
const value = (label: string) => by<HTMLInputElement>(label).value;
const histogram = (lo: number, hi: number) => Array.from({ length: 256 }, (_, level) => level >= lo && level <= hi ? 50 : 0);
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });

describe("Photoshop tone controls", () => {
  it("drags the Levels triangles, keeping black two levels under white", async () => {
    await render({ id: "levels" });
    const [input, output] = strips();
    await pointer(by("Adjustment Gamma slider"), "pointerdown", 127.5); await pointer(input!, "pointermove", 63.75); await pointer(input!, "pointerup", 63.75);
    expect(value("Adjustment Gamma")).toBe("2.00");
    await pointer(input!, "pointerdown", 230); expect(value("Adjustment Input white")).toBe("230");
    await pointer(input!, "pointermove", 1); await pointer(input!, "pointerup", 1); expect(value("Adjustment Input white")).toBe("2");
    const calls = changed.mock.calls.length; await key("Adjustment Input black slider", "ArrowRight"); expect(changed).toHaveBeenCalledTimes(calls);
    await key("Adjustment Output white slider", "ArrowLeft", true); expect(value("Adjustment Output white")).toBe("245");
    await pointer(output!, "pointerdown", 30); expect(value("Adjustment Output black")).toBe("30");
  });

  it("moves the Threshold triangle and marks the level on the histogram", async () => {
    await render({ id: "threshold" });
    await pointer(strips()[0]!, "pointerdown", 64); expect(value("Adjustment Threshold")).toBe("64");
    await key("Adjustment Threshold slider", "ArrowRight"); expect(changed).toHaveBeenLastCalledWith("level", 65);
    expect(container.querySelector(".xd-photo-threshold-line")!.getAttribute("d")).toBe("M65.5 0V100");
  });

  it("reads the settled histogram and sets Auto levels and curves from it", async () => {
    native.tauri = true; native.invoke.mockResolvedValue([histogram(20, 230), histogram(30, 200), histogram(0, 255), histogram(0, 255)]);
    await render({ id: "levels", from: source });
    expect(native.invoke).not.toHaveBeenCalled(); await settle();
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_histogram", { projectId: "project", photoId: "photo", version: "v1", layer: 7, below: true, space: "rgb" });
    expect(container.querySelector(".xd-photo-levels-histogram path")).not.toBeNull();
    await act(async () => [...container.querySelectorAll("button")].find(item => item.textContent === "Auto")!.click());
    expect([value("Adjustment Input black"), value("Adjustment Input white"), value("Adjustment Gamma")]).toEqual(["20", "230", "1.00"]);
    await act(async () => root.render(null)); await render({ id: "curves", from: source }); await settle();
    await act(async () => { const select = by<HTMLSelectElement>("Adjustment Channel"); select.value = "red"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => [...container.querySelectorAll("button")].find(item => item.textContent === "Auto")!.click());
    expect(shown).toMatchObject({ points: [[20, 0], [230, 255]], red: [[0, 0], [255, 255]] });
    expect(container.querySelector(".xd-photo-curve-histogram")).not.toBeNull();
  });

  it.each([["an image preview", { width: 1, height: 1, png: "AA==" }], ["short channels", [[1, 2, 3]]]])("ignores %s instead of a histogram", async (_, response) => {
    native.tauri = true; native.invoke.mockResolvedValue(response);
    await render({ id: "levels", from: source }); await settle();
    expect(container.querySelector(".xd-photo-levels-histogram path")).toBeNull();
    expect([...container.querySelectorAll("button")].find(item => item.textContent === "Auto")!.disabled).toBe(true);
  });

  it("asks for CMYK and Lab histograms in their own channels", async () => {
    native.tauri = true; native.invoke.mockRejectedValue(new Error("Image changed"));
    await render({ id: "levels", mode: "CMYK", from: source }); await settle();
    expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_histogram", expect.objectContaining({ space: "cmyk" }));
    await act(async () => root.render(null)); await render({ id: "curves", mode: "Lab", from: { document: photo, below: false } }); await settle();
    expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_histogram", expect.objectContaining({ layer: null, below: false, space: "lab" }));
  });
});

describe("Levels and Curves eyedroppers and Auto options", () => {
  const stage = () => {
    const frame = document.createElement("div"), image = document.createElement("div"), surface = document.createElement("canvas");
    frame.className = "xd-photo-stage"; image.className = "xd-photo-image"; image.append(surface); frame.append(image); beside(frame);
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 } as DOMRect);
    image.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 } as DOMRect);
    return { image, surface };
  };
  const press = (target: Element, x: number, y: number) => act(async () => { target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })); });
  const respond = (sample: number[] | null) => native.invoke.mockImplementation(async (command: string) => command === "xdesign_photo_sample" ? sample : [histogram(20, 230), histogram(30, 200), histogram(10, 240), histogram(0, 255)]);

  it("sets each channel's black point from a click on the image, out of reach of the canvas tools", async () => {
    native.tauri = true; respond([40, 60, 80]);
    const { image, surface } = stage(), tool = vi.fn(); surface.addEventListener("pointerdown", tool);
    await render({ id: "levels", from: source, canvas: image }); await settle();
    await press(surface, 150, 150); expect(tool).toHaveBeenCalledTimes(1);
    await act(async () => by<HTMLButtonElement>("Sample in image to set black point").click());
    expect(by("Sample in image to set black point").getAttribute("aria-pressed")).toBe("true");
    await press(surface, 150, 250); await press(surface, 50, 50);
    expect(tool).toHaveBeenCalledTimes(2);
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_sample", { projectId: "project", photoId: "photo", version: "v1", layer: 7, below: true, x: 25, y: 75, width: 1, height: 1 });
    expect(native.invoke.mock.calls.filter(([command]) => command === "xdesign_photo_sample")).toHaveLength(1);
    expect([shown.red, shown.green, shown.blue].map(channel => (channel as Settings).inBlack)).toEqual([40, 60, 80]);
    expect(shown.inBlack).toBe(0);
    await act(async () => by<HTMLButtonElement>("Sample in image to set black point").click());
    await press(surface, 150, 150); expect(tool).toHaveBeenCalledTimes(3);
  });

  it("adds a curve point at the pressed pixel's level and drags it with the on-image tool", async () => {
    native.tauri = true; respond([40, 60, 80]);
    const { image, surface } = stage(), tool = vi.fn(); surface.addEventListener("pointerdown", tool);
    const move = (y: number, type = "pointermove") => act(async () => { surface.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 150, clientY: y })); });
    await render({ id: "curves", from: source, canvas: image }); await settle();
    await act(async () => by<HTMLButtonElement>("On-image adjustment").click());
    expect(container.querySelector(".xd-photo-tone-column")!.contains(by("On-image adjustment"))).toBe(true);
    await press(surface, 150, 150); await settle();
    expect(tool).not.toHaveBeenCalled(); expect(shown.points).toEqual([[0, 0], [60, 60], [255, 255]]);
    await move(130); expect(shown.points).toEqual([[0, 0], [60, 80], [255, 255]]);
    await move(130, "pointerup"); await move(100); expect(shown.points).toEqual([[0, 0], [60, 80], [255, 255]]);
    respond([62, 62, 62]); await press(surface, 150, 150); await settle(); await move(160);
    expect(shown.points).toEqual([[0, 0], [60, 70], [255, 255]]);
    await move(160, "pointerup");
    await act(async () => { const select = by<HTMLSelectElement>("Adjustment Channel"); select.value = "blue"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    respond([10, 20, 200]); await press(surface, 150, 150); await settle(); await move(150, "pointerup");
    expect(shown.blue).toEqual([[0, 0], [200, 200], [255, 255]]); expect(shown.points).toEqual([[0, 0], [60, 70], [255, 255]]);
    await act(async () => by<HTMLButtonElement>("Sample in image to set black point").click());
    expect(by("On-image adjustment").getAttribute("aria-pressed")).toBe("false");
  });

  it("puts Auto, Options… and the eyedroppers in a dialog's button column and applies the chosen algorithm live", async () => {
    native.tauri = true; respond(null);
    const slot = beside(document.createElement("div"));
    await render({ id: "levels", from: source, slot }); await settle();
    const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent === text)!;
    expect(slot.contains(button("Auto"))).toBe(true); expect(slot.contains(by("Sample in image to set gray point"))).toBe(true);
    await act(async () => button("Options…").click());
    const radio = (text: string) => [...document.querySelectorAll<HTMLLabelElement>("[aria-label='Algorithms'] label")].find(label => label.textContent === text)!.querySelector("input")!;
    expect(radio("Enhance Monochromatic Contrast").checked).toBe(true); expect(radio("Find Dark & Light Colors").disabled).toBe(true);
    await act(async () => radio("Enhance Per Channel Contrast").click());
    expect(shown).toMatchObject({ inBlack: 0, inWhite: 255, red: { inBlack: 30, inWhite: 200 }, green: { inBlack: 10, inWhite: 240 } });
    await act(async () => button("Cancel").click());
    expect(document.querySelector("[aria-label='Auto Color Correction Options']")).toBeNull(); expect(shown.red).toMatchObject({ inBlack: 0 });
    await act(async () => button("Options…").click()); await act(async () => radio("Enhance Per Channel Contrast").click()); await act(async () => button("OK").click());
    await act(async () => { root.render(null); }); await render({ id: "levels", from: source, slot }); await settle();
    await act(async () => button("Auto").click());
    expect(shown.red).toMatchObject({ inBlack: 30, inWhite: 200 });
  });
});

describe("Curves tools and display options", () => {
  beforeEach(() => { localStorage.clear(); native.tauri = true; native.invoke.mockImplementation(async () => [histogram(20, 230), histogram(30, 200), histogram(10, 240), histogram(0, 255)]); });
  const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent === text)!;
  const check = (text: string) => [...document.querySelectorAll<HTMLLabelElement>("label")].find(label => label.textContent === text)!.querySelector("input")!;
  // The plot's 265 units are 265 pixels from the corner, so a level is a pixel, 5 in from the left and up from 260.
  const plot = () => { const svg = by<SVGSVGElement>("Adjustment curve"); svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 265, height: 265 } as DOMRect); svg.setPointerCapture = vi.fn(); return svg; };
  const at = (target: Element, type: string, x: number, y: number, altKey = false) => act(async () => { target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x + 5, clientY: 260 - y, altKey }), { pointerId: 4 })); });
  const grid = () => document.querySelector(".xd-photo-curve-grid")!.getAttribute("d")!;

  it("draws the curve with the pencil and smooths it", async () => {
    const slot = beside(document.createElement("div"));
    await render({ id: "curves", from: source, slot }); await settle();
    expect(by("Edit points to modify the curve").getAttribute("aria-pressed")).toBe("true");
    expect(button("Smooth").disabled).toBe(true); expect(slot.contains(button("Smooth"))).toBe(true);
    await act(async () => by<HTMLButtonElement>("Draw to modify the curve").click());
    expect(document.querySelector(".xd-photo-curve-point")).toBeNull(); expect(by<HTMLInputElement>("Curve input").disabled).toBe(true);
    const svg = plot();
    await at(svg, "pointerdown", 0, 128); await at(svg, "pointermove", 255, 128); await at(svg, "pointerup", 255, 128);
    expect(shown.points).toEqual([[0, 128], [255, 128]]);
    await at(svg, "pointerdown", 0, 0); await at(svg, "pointermove", 127, 0); await at(svg, "pointerup", 127, 0);
    const drawn = shown.points as [number, number][];
    expect(drawn.length).toBeGreaterThan(2); expect(drawn.length).toBeLessThanOrEqual(19);
    expect(curveLut(drawn)[64]).toBeCloseTo(0, 0); expect(curveLut(drawn)[200]).toBeCloseTo(128, 0);
    await act(async () => button("Smooth").click());
    expect(shown.points).not.toEqual(drawn); expect(curveLut(shown.points as [number, number][])[127]).toBeGreaterThan(curveLut(drawn)[127]!);
  });

  it("shows ink percentages for Pigment, and keeps the Show options and grid size for next time", async () => {
    const slot = beside(document.createElement("div"));
    await render({ id: "curves", from: source, slot }); await settle();
    expect(check("Light (0-255)").checked).toBe(true); expect(by<HTMLInputElement>("Curve input").value).toBe("0");
    await act(async () => check("Pigment/Ink %").click());
    expect(by<HTMLInputElement>("Curve input").value).toBe("100");
    expect(document.querySelector(".xd-photo-curve-under")!.contains(by("Sample in image to set black point"))).toBe(true);
    expect(document.querySelector(".xd-photo-curve-histogram")).not.toBeNull(); expect(grid()).toContain("M0 255L255 0");
    await act(async () => check("Histogram").click()); await act(async () => check("Baseline").click());
    expect(document.querySelector(".xd-photo-curve-histogram")).toBeNull(); expect(grid()).not.toContain("M0 255L255 0");
    await act(async () => by<HTMLButtonElement>("Show detailed grid").click()); expect(grid()).toContain("M0 25.5H255");
    await at(plot(), "pointerdown", 100, 40, true); expect(grid()).not.toContain("M0 25.5H255");
    await at(plot(), "pointerup", 100, 40); expect(shown.points).toEqual([[0, 0], [255, 255]]);
    await act(async () => by<HTMLButtonElement>("Show detailed grid").click());
    await act(async () => { root.render(null); }); await render({ id: "curves", from: source, slot, mode: "CMYK" }); await settle();
    expect(check("Pigment/Ink %").checked).toBe(true); expect(check("Histogram").checked).toBe(false); expect(by("Show detailed grid").getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the eyedroppers and tools in a column beside the graph in Properties", async () => {
    await render({ id: "curves", from: source }); await settle();
    const column = container.querySelector(".xd-photo-tone-column")!;
    for (const label of ["Sample in image to set white point", "Edit points to modify the curve", "Draw to modify the curve"]) expect(column.contains(by(label))).toBe(true);
    expect(column.contains(button("Smooth"))).toBe(true); expect(container.querySelector(".xd-photo-tone-head")!.contains(button("Auto"))).toBe(true);
    expect(document.querySelector(".xd-photo-curve-display")).toBeNull();
  });
});

describe("Show Clipping", () => {
  const stage = () => {
    const frame = document.createElement("div"), image = document.createElement("div");
    frame.className = "xd-photo-stage"; image.className = "xd-photo-image"; frame.append(image); beside(frame);
    image.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 } as DOMRect);
    return image;
  };
  // Black, then a pixel with red at 40 and blue at the top.
  const pixels = () => { const bytes = new Uint8Array(8 + 8); bytes.set([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 255, 40, 200, 255, 255]); return bytes.buffer; };
  const drawn: number[][] = [];
  beforeEach(() => {
    localStorage.clear(); native.tauri = true; drawn.length = 0;
    native.invoke.mockImplementation(async (command: string) => command === "xdesign_photo_tone_pixels" ? pixels() : [histogram(0, 255), histogram(0, 255), histogram(0, 255), histogram(0, 255)]);
    vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ putImageData: (image: ImageData) => drawn.push([...image.data]) }) as never);
  });
  afterEach(() => vi.restoreAllMocks());
  const drag = (target: Element, type: string, x: number, altKey: boolean) => act(async () => { target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, altKey }), { pointerId: 5 })); });
  const overlay = (image: HTMLElement) => image.querySelector(".xd-photo-clipping");

  it("shows the clipped channels while Alt-dragging the Levels input triangles", async () => {
    const image = stage();
    await render({ id: "levels", from: source, canvas: image }); await settle();
    const [input] = strips();
    await drag(input!, "pointerdown", 50, false); await drag(input!, "pointermove", 50, false);
    expect(overlay(image)).toBeNull(); await drag(input!, "pointerup", 50, false);
    await drag(input!, "pointerdown", 50, true); await settle();
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_tone_pixels", { projectId: "project", photoId: "photo", version: "v1", layer: 7, below: true, size: 256 });
    expect(overlay(image)).not.toBeNull();
    expect(drawn.at(-1)).toEqual([0, 0, 0, 255, 0, 255, 255, 255]);
    await drag(input!, "pointermove", 30, true); expect(drawn.at(-1)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    await drag(input!, "pointermove", 255, true); await drag(input!, "pointerup", 255, true); expect(overlay(image)).toBeNull();
    await drag(input!, "pointerdown", 255, true); expect(drawn.at(-1)).toEqual([0, 0, 0, 255, 0, 0, 255, 255]);
    expect(native.invoke.mock.calls.filter(([command]) => command === "xdesign_photo_tone_pixels")).toHaveLength(1);
  });

  it("shows clipping while dragging a Curves end point with Show Clipping on, and one channel in black and white", async () => {
    const image = stage(), slot = beside(document.createElement("div"));
    await render({ id: "curves", from: source, canvas: image, slot }); await settle();
    const axis = () => strips()[0]!;
    await drag(axis(), "pointerdown", 40, false); await settle(); expect(overlay(image)).toBeNull(); await drag(axis(), "pointerup", 40, false);
    const box = [...document.querySelectorAll<HTMLLabelElement>("label")].find(label => label.textContent === "Show Clipping")!.querySelector("input")!;
    expect(document.querySelector(".xd-photo-curve-under")!.contains(box)).toBe(true);
    await act(async () => box.click());
    await drag(axis(), "pointerdown", 40, false); await settle();
    expect(drawn.at(-1)).toEqual([0, 0, 0, 255, 0, 255, 255, 255]);
    await drag(axis(), "pointerup", 40, false); expect(overlay(image)).toBeNull();
    await act(async () => { const select = by<HTMLSelectElement>("Adjustment Channel"); select.value = "green"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await drag(axis(), "pointerdown", 200, false); expect(drawn.at(-1)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});

describe("tone math shared with the engine", () => {
  it("composes the clipping display's levels as the engine does: Levels' composite first, Curves' last", () => {
    const levels = toneLuts("levels", { outWhite: 128, red: { inWhite: 100 } }, ["red", "green"]);
    expect(levels[0]![150]).toBeLessThan(levels[0]![255]!); expect(levels[0]![200]).toBeCloseTo(levels[0]![255]!, 6); expect(levels[1]![255]).toBeCloseTo(128, 6);
    const curves = toneLuts("curves", { points: [[0, 0], [100, 255]], red: [[0, 0], [255, 128]] }, ["red", "composite"]);
    expect(curves[0]![150]).toBeLessThan(255); expect(curves[0]![210]).toBe(255); expect(curves[1]![100]).toBe(255);
    const image = { width: 3, height: 1, rgba: Uint8Array.from([0, 0, 0, 255, 10, 200, 255, 255, 255, 255, 255, 0]) }, identity = toneLuts("levels", {}, ["red", "green", "blue"]);
    expect([...clippingPixels(image, identity, "shadows", [0, 1, 2])]).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    expect([...clippingPixels(image, identity, "highlights", [0, 1, 2])]).toEqual([0, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    expect([...clippingPixels(image, toneLuts("levels", { green: { inBlack: 200 } }, ["green"]), "shadows", [1])]).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  });


  it("clips a tenth of a percent at each end for Auto and keeps the range three levels wide", () => {
    const bins = new Array<number>(256).fill(0); bins[0] = 4; bins[1] = 6; bins[2] = 100; bins[254] = 1; bins[255] = 10; bins[128] = 10000 - 121;
    expect(autoLevels(bins)).toEqual([2, 254]);
    const flat = new Array<number>(256).fill(0); flat[128] = 1000; expect(autoLevels(flat)).toEqual([128, 130]);
    expect(autoLevels(new Array<number>(256).fill(0))).toBeNull();
  });

  it("draws the natural cubic spline through every point", () => {
    curveLut([[0, 0], [255, 255]]).forEach((output, input) => expect(output).toBeCloseTo(input, 9));
    curveLut([[0, 255], [255, 0]]).forEach((output, input) => expect(output).toBeCloseTo(255 - input, 9));
    const lifted = curveLut([[0, 0], [128, 192], [255, 255]]);
    expect(lifted[128]).toBeCloseTo(192, 9); expect(lifted.every((output, input) => !input || output >= lifted[input - 1]!)).toBe(true);
    expect(curveLut([[60, 20], [200, 240]]).slice(0, 61).every(output => Math.abs(output - 20) < 1e-9)).toBe(true);
  });
});
