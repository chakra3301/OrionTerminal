import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdjustmentControls, type Settings } from "./actionControls";
import { adjustmentDefaults } from "./adjustmentSettings";
import { ADJUSTMENTS } from "./controls";
import { editHueRange, hueOf, invertHueRange, nearestHueRange } from "./hueSaturationControls";
import { usePhotoWorkspace } from "./runtime";
import type { HistogramSource } from "./toneControls";
import type { PhotoDocument } from "./types";

const native = vi.hoisted(() => ({ tauri: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.tauri, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
const source: HistogramSource = { document: photo, layer: 7, below: true };
const action = ADJUSTMENTS.find(item => item.id === "hueSaturation")!;
const defaults = adjustmentDefaults(action, "RGB");
let root: Root, container: HTMLDivElement, outside: HTMLElement[] = [], shown: Settings;

function Fixture({ canvas }: { canvas?: HTMLElement }) {
  const [values, setValues] = useState<Settings>(() => adjustmentDefaults(action, "RGB")), [range, setRange] = useState("master");
  shown = { ...values, range };
  return <AdjustmentControls action={action} values={values} setValues={setValues} change={(key, value) => setValues(current => ({ ...current, [key]: value }))} locked={false} mode="RGB"
    channel="" setChannel={() => {}} range={range} setRange={setRange} loadingFile={false} setLoadingFile={() => {}} setLocalError={() => {}} source={canvas && source} canvas={canvas}/>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.tauri = false; native.invoke.mockReset();
  usePhotoWorkspace.setState({ projectId: "project" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); outside.splice(0).forEach(item => item.remove()); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = (canvas?: HTMLElement) => act(async () => root.render(<Fixture canvas={canvas}/>));
const by = <T extends HTMLElement = HTMLElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`)!;
const click = (label: string) => act(async () => by(label).click());
const swatch = (name: string) => document.querySelector<HTMLButtonElement>(`[role=radiogroup][aria-label="Adjustment Color range"] button[aria-label="${name}"]`)!;
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
const respond = (sample: number[] | null) => native.invoke.mockImplementation(async (command: string) => command === "xdesign_photo_sample" ? sample : null);
// The root clears its container on first render, so the stage lives beside it, as in the app.
const stage = () => {
  const frame = document.createElement("div"), image = document.createElement("div"), surface = document.createElement("canvas");
  frame.className = "xd-photo-stage"; image.className = "xd-photo-image"; image.append(surface); frame.append(image); document.body.append(frame); outside.push(frame);
  frame.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 } as DOMRect);
  image.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 } as DOMRect);
  return { image, surface };
};
const pointer = (target: Element, type: string, x: number, metaKey = false) => act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 150, metaKey })); });

describe("Hue/Saturation range edits", () => {
  it("reads a sample's hue and the range nearest it", () => {
    expect(hueOf([0, 0, 255])).toEqual({ hue: 240, saturation: 1 });
    expect(hueOf([128, 128, 128]).saturation).toBe(0);
    expect(nearestHueRange(defaults, 200)).toBe("cyans"); expect(nearestHueRange(defaults, 350)).toBe("reds");
  });

  it("samples, adds to and subtracts from a range, keeping its fades", () => {
    const blues = [195, 225, 255, 285];
    expect(editHueRange(blues, 200, "sample")).toEqual([155, 185, 215, 245]);
    expect(editHueRange(blues, 200, "add")).toEqual([170, 200, 255, 285]);
    expect(editHueRange(blues, 300, "add")).toEqual([195, 225, 300, 330]);
    expect(editHueRange(blues, 240, "add")).toEqual(blues);
    expect(editHueRange(blues, 200, "subtract")).toEqual([201, 231, 255, 285]);
    expect(editHueRange(blues, 270, "subtract")).toEqual([195, 225, 239, 269]);
    expect(editHueRange(blues, 100, "subtract")).toEqual(blues);
    expect(invertHueRange(blues)).toEqual([-105, -75, 195, 225]);
  });
});

describe("Photoshop 2026 Hue/Saturation layout", () => {
  it("picks a range from the swatches, splits an edited swatch and sets the range with the eyedroppers and Invert", async () => {
    native.tauri = true; respond([0, 128, 255]);
    const { image, surface } = stage(), tool = vi.fn(); surface.addEventListener("pointerdown", tool);
    await render(image);
    expect([...document.querySelectorAll('[aria-label="Adjustment Color range"] button')].map(item => item.getAttribute("aria-label"))).toEqual(["Master", "Reds", "Yellows", "Greens", "Cyans", "Blues", "Magentas"]);
    expect(by("Eyedropper")).toHaveProperty("disabled", true); expect(by("Adjustment Fade in")).toBeNull();
    await act(async () => swatch("Blues").click()); expect(shown.range).toBe("blues"); expect(by<HTMLInputElement>("Adjustment Fade in").value).toBe("195");
    expect(swatch("Blues").style.getPropertyValue("--xd-photo-swatch")).not.toContain("gradient");
    await act(async () => { const field = by<HTMLInputElement>("Adjustment Hue"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "-35"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(swatch("Blues").style.getPropertyValue("--xd-photo-swatch")).toContain("linear-gradient");
    await click("Eyedropper"); await pointer(surface, "pointerdown", 150); await settle();
    expect(tool).not.toHaveBeenCalled(); expect(shown.blues).toMatchObject({ hue: -35, range: [165, 195, 225, 255] });
    expect(by<HTMLInputElement>("Adjustment Fade in").value).toBe("165");
    await act(async () => [...document.querySelectorAll("button")].find(item => item.textContent === "Invert")!.click());
    expect(shown.blues).toMatchObject({ range: [-135, -105, 165, 195] });
    await click("Adjustment Colorize");
    expect(shown.range).toBe("master"); expect(swatch("Reds").disabled).toBe(true); expect(by("Eyedropper")).toHaveProperty("disabled", true); expect(by("On-image adjustment")).toHaveProperty("disabled", true);
  });

  it("drags in the image to set the nearest range's saturation, or its hue with ⌘", async () => {
    native.tauri = true; respond([255, 128, 0]);
    const { image, surface } = stage();
    await render(image); await click("On-image adjustment");
    await pointer(surface, "pointerdown", 150); await settle(); await pointer(surface, "pointermove", 175);
    expect(shown.range).toBe("yellows"); expect(swatch("Yellows").getAttribute("aria-checked")).toBe("true");
    expect(shown.yellows).toEqual({ hue: 0, saturation: 25, lightness: 0, range: [-15, 15, 45, 75] });
    await pointer(surface, "pointerup", 175); await pointer(surface, "pointermove", 300); expect(shown.yellows).toMatchObject({ saturation: 25 });
    respond([90, 90, 90]); await pointer(surface, "pointerdown", 150, true); await settle(); await pointer(surface, "pointermove", 100); await pointer(surface, "pointerup", 100);
    expect(shown.yellows).toMatchObject({ hue: 0, saturation: 25 });
    respond([255, 128, 0]); await pointer(surface, "pointerdown", 150, true); await settle(); await pointer(surface, "pointermove", 110); await pointer(surface, "pointerup", 110);
    expect(shown.yellows).toMatchObject({ hue: -40, saturation: 25 });
  });
});
