import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdjustmentControls, type Settings } from "./actionControls";
import { adjustmentDefaults } from "./adjustmentSettings";
import { hsbHex, hsbOf } from "./blackWhiteControls";
import { ADJUSTMENTS } from "./controls";
import { autoBlackWhite } from "./psAdjustMath";
import { usePhotoWorkspace } from "./runtime";
import type { HistogramSource } from "./toneControls";
import type { PhotoDocument } from "./types";

const native = vi.hoisted(() => ({ tauri: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.tauri, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
const source: HistogramSource = { document: photo, layer: 7, below: true };
const action = ADJUSTMENTS.find(item => item.id === "blackWhite")!;
let root: Root, container: HTMLDivElement, outside: HTMLElement[] = [], shown: Settings;

function Fixture({ canvas, slot, dialog }: { canvas: HTMLElement; slot?: HTMLElement; dialog: boolean }) {
  const [values, setValues] = useState<Settings>(() => adjustmentDefaults(action, "RGB"));
  shown = values;
  return <AdjustmentControls action={action} values={values} setValues={setValues} change={(key, value) => setValues(current => ({ ...current, [key]: value }))} locked={false} mode="RGB"
    channel="" setChannel={() => {}} range="master" setRange={() => {}} loadingFile={false} setLoadingFile={() => {}} setLocalError={() => {}} source={source} canvas={canvas} toolSlot={slot} psSliders={dialog}/>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.tauri = true; native.invoke.mockReset();
  usePhotoWorkspace.setState({ projectId: "project" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); outside.splice(0).forEach(item => item.remove()); vi.unstubAllGlobals(); vi.useRealTimers(); });
// The root clears its container on first render, so the stage and button column live beside it, as in the app.
const beside = <T extends HTMLElement>(item: T) => { document.body.append(item); outside.push(item); return item; };
const stage = () => {
  const frame = document.createElement("div"), image = document.createElement("div"), surface = document.createElement("canvas");
  frame.className = "xd-photo-stage"; image.className = "xd-photo-image"; image.append(surface); frame.append(image); beside(frame);
  frame.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 } as DOMRect);
  image.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 } as DOMRect);
  return { image, surface };
};
const by = <T extends HTMLElement = HTMLElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`)!;
const input = (label: string, value: string) => act(async () => { const field = by<HTMLInputElement>(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent === text)!;
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
const pointer = (target: Element, type: string, x: number) => act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 150 })); });
// One row of reds from black to full red.
const redRamp = () => { const bytes = new Uint8Array(8 + 256 * 4), view = new DataView(bytes.buffer); view.setUint32(0, 256, true); view.setUint32(4, 1, true); for (let r = 0; r < 256; r++) bytes.set([r, 0, 0, 255], 8 + r * 4); return bytes; };
const respond = (sample: number[]) => native.invoke.mockImplementation(async (command: string) => command === "xdesign_photo_sample" ? sample : command === "xdesign_photo_tone_pixels" ? redRamp().buffer : null);

describe("Black & White tint and Auto", () => {
  it("converts the tint between hex and HSB", () => {
    expect(hsbOf("#e1d3b3")).toMatchObject({ brightness: 225 / 255 }); expect(Math.round(hsbOf("#e1d3b3").hue)).toBe(42); expect(Math.round(hsbOf("#e1d3b3").saturation * 100)).toBe(20);
    expect([hsbHex(0, 1, 1), hsbHex(240, .5, 1), hsbHex(120, 1, .5)]).toEqual(["#ff0000", "#8080ff", "#008000"]);
  });

  it("spreads the grays as evenly as the sliders allow", () => {
    expect(autoBlackWhite(redRamp().subarray(8))).toEqual([100, 60, 40, 60, 20, 80]);
    expect(autoBlackWhite(new Uint8Array([90, 90, 90, 255, 200, 200, 200, 255]))).toEqual([40, 60, 40, 60, 20, 80]);
  });
});

describe("Photoshop Black & White layout", () => {
  it("puts Hue and Saturation under Tint and Auto in the dialog's button column, with the on-image tool always on", async () => {
    respond([0, 0, 255]);
    const { image, surface } = stage(), slot = beside(document.createElement("div")), tool = vi.fn(); surface.addEventListener("pointerdown", tool);
    await act(async () => root.render(<Fixture canvas={image} slot={slot} dialog/>));
    expect(by("On-image adjustment")).toBeNull(); expect(slot.contains(button("Auto"))).toBe(true);
    expect([by<HTMLInputElement>("Adjustment Hue").value, by<HTMLInputElement>("Adjustment Saturation").value]).toEqual(["42", "20"]);
    expect(by("Adjustment Hue").matches(":disabled")).toBe(true); expect(by<HTMLInputElement>("Adjustment Tint color").disabled).toBe(true);
    await act(async () => by("Adjustment Tint").click());
    expect(by("Adjustment Hue").matches(":disabled")).toBe(false);
    await input("Adjustment Hue", "200"); expect(shown.tintColor).toBe("#b4d2e1");
    await input("Adjustment Saturation", "0"); expect(shown.tintColor).toBe("#e1e1e1"); expect(by<HTMLInputElement>("Adjustment Hue").value).toBe("200");
    await pointer(surface, "pointerdown", 150); await settle(); await pointer(surface, "pointermove", 180); await pointer(surface, "pointerup", 180);
    expect(tool).not.toHaveBeenCalled(); expect(shown.blues).toBe(50);
    await act(async () => button("Auto").click()); await settle();
    expect(shown).toMatchObject({ reds: 100, yellows: 60, blues: 20 });
  });

  it("puts the on-image tool, Tint and Auto in one Properties row", async () => {
    respond([255, 255, 0]);
    const { image, surface } = stage();
    await act(async () => root.render(<Fixture canvas={image} dialog={false}/>));
    const row = by("On-image adjustment").parentElement!;
    expect(row.contains(by("Adjustment Tint"))).toBe(true); expect(row.contains(button("Auto"))).toBe(true); expect(by("Adjustment Hue")).toBeNull();
    await pointer(surface, "pointerdown", 150); await settle(); await pointer(surface, "pointerup", 150); expect(shown.yellows).toBe(60);
    await act(async () => by("On-image adjustment").click());
    await pointer(surface, "pointerdown", 150); await settle(); await pointer(surface, "pointermove", 130); await pointer(surface, "pointerup", 130);
    expect(shown.yellows).toBe(40);
  });
});
