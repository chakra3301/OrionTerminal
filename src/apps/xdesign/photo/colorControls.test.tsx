import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AdjustmentControls, type Settings } from "./actionControls";
import { adjustmentDefaults } from "./adjustmentSettings";
import { canonicalHueRange, hueSaturationColor, hueWeight } from "./colorControls";
import { ADJUSTMENTS } from "./controls";
import { usePhotoWorkspace } from "./runtime";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
let root: Root, container: HTMLDivElement, changed: Mock<(key: string, value: unknown) => void>;

function Fixture({ id, initial = {}, range: start = "master" }: { id: string; initial?: Settings; range?: string }) {
  const action = ADJUSTMENTS.find(item => item.id === id)!;
  const [values, setValues] = useState<Settings>(() => ({ ...adjustmentDefaults(action, "RGB"), ...initial })), [channel, setChannel] = useState(""), [range, setRange] = useState(start);
  return <AdjustmentControls action={action} values={values} setValues={setValues} change={(key, value) => { changed(key, value); setValues(current => ({ ...current, [key]: value })); }} locked={false} mode="RGB"
    channel={channel} setChannel={setChannel} range={range} setRange={setRange} loadingFile={false} setLoadingFile={() => {}} setLocalError={() => {}}/>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); changed = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); usePhotoWorkspace.setState({ state: null }); });
const render = (props: Parameters<typeof Fixture>[0]) => act(async () => root.render(<Fixture {...props}/>));
const by = <T extends Element = HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const strip = (selector: string, width: number) => { const element = container.querySelector<HTMLElement>(selector)!; element.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 16, bottom: 16 } as DOMRect); element.setPointerCapture = vi.fn(); return element; };
const pointer = (target: Element, type: string, x: number, y = 8) => act(async () => { target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }), { pointerId: 5 })); });
const key = (label: string, key: string, shiftKey = false) => act(async () => { by(label).dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })); });
const input = (label: string, next: string) => act(async () => { const element = by<HTMLInputElement | HTMLSelectElement>(label); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!; setter.call(element, next); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
const value = (label: string) => by<HTMLInputElement>(label).value;
const radios = () => [...container.querySelectorAll<HTMLInputElement>('[aria-label="Adjustment Use"] input[type=radio]')];

describe("Photoshop colour adjustment controls", () => {
  it("drags the Hue/Saturation range bars inside one turn around the chosen colours", async () => {
    await render({ id: "hueSaturation", range: "blues" });
    expect(["Fade in", "Full strength start", "Full strength end", "Fade out"].map(label => value(`Adjustment ${label}`))).toEqual(["195", "225", "255", "285"]);
    expect(by("Adjustment Saturation slider").style.getPropertyValue("--xd-photo-track")).toContain("hsl(240 100% 50%)");
    await input("Adjustment Hue", "60"); expect(by("Adjustment Saturation slider").style.getPropertyValue("--xd-photo-track")).toContain("hsl(300 100% 50%)");
    // The bar starts half a turn before the range centre, 240°, so x = (deg - 60) / 360 * 255.
    const bar = strip(".xd-photo-hue-range .xd-photo-tone-strip", 255), at = (deg: number) => (deg - 60) / 360 * 255;
    await pointer(by("Adjustment Full strength start slider"), "pointerdown", at(225)); await pointer(bar, "pointermove", at(270)); await pointer(bar, "pointerup", at(270));
    expect(changed).toHaveBeenLastCalledWith("blues", expect.objectContaining({ range: [195, 255, 255, 285] }));
    await pointer(by("Adjustment Fade in slider"), "pointerdown", at(195)); await pointer(bar, "pointermove", 0); await pointer(bar, "pointerup", 0);
    expect(value("Adjustment Fade in")).toBe("60");
    await pointer(by("Adjustment Fade out slider"), "pointerdown", at(285)); await pointer(bar, "pointermove", 255); await pointer(bar, "pointerup", 255);
    expect(value("Adjustment Fade out")).toBe("419");
    await key("Adjustment Full strength end slider", "ArrowLeft", true); expect(value("Adjustment Full strength end")).toBe("255");
    await key("Adjustment Fade out slider", "ArrowLeft"); expect(value("Adjustment Fade out")).toBe("418");
  });

  it("hides the range bars for Master", async () => {
    await render({ id: "hueSaturation" });
    expect(container.querySelectorAll(".xd-photo-hue-spectrum")).toHaveLength(2);
    expect(container.querySelector(".xd-photo-hue-range")).toBeNull(); expect(by("Adjustment Fade in")).toBeNull();
  });

  it("shows the Gradient Map as a swatch that opens the Gradient Editor without opacity stops, previewing live and restoring on Cancel", async () => {
    container.classList.add("xd-photo");
    await render({ id: "gradientMap", initial: { stops: [[0, "#000000"], [1, "#ffffff"]], method: "classic" } });
    expect([...container.querySelectorAll("input[type=checkbox], select")].map(field => field.getAttribute("aria-label"))).toEqual(["Adjustment Dither", "Adjustment Reverse", "Adjustment Method"]);
    await act(async () => by<HTMLButtonElement>("Edit gradient").click());
    const editor = container.querySelector<HTMLElement>('[role=dialog][aria-label="Gradient Editor"]')!;
    expect(editor).not.toBeNull(); expect(by("Opacity stops")).toBeNull();
    await act(async () => by<HTMLElement>("Color stop 2").click()); await input("Color stop location", "60");
    expect(changed).toHaveBeenLastCalledWith("stops", [[0, "#000000"], [.6, "#ffffff"]]);
    await act(async () => [...editor.querySelectorAll("button")].find(button => button.textContent === "Cancel")!.click());
    expect(changed).toHaveBeenLastCalledWith("stops", [[0, "#000000"], [1, "#ffffff"]]); expect(editor.isConnected).toBe(false);
  });

  it("keeps the Gradient Editor's stops on OK", async () => {
    container.classList.add("xd-photo");
    await render({ id: "gradientMap", initial: { stops: [[0, "#000000"], [1, "#ffffff"]], method: "classic" } });
    await act(async () => by<HTMLButtonElement>("Edit gradient").click());
    await act(async () => by<HTMLElement>("Color stop 2").click()); await input("Color stop location", "60");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Gradient Editor"] button[type=submit]')!.click());
    expect(changed).toHaveBeenLastCalledWith("stops", [[0, "#000000"], [.6, "#ffffff"]]); expect(container.querySelector('[aria-label="Gradient Editor"]')).toBeNull();
  });

  it("picks a Gradient Map preset from the menu beside the swatch", async () => {
    usePhotoWorkspace.setState({ state: { tools: { foreground: [1, 0, 0, 1], background: [0, 0, 1, 1] }, presets: { gradients: [{ name: "Basics", presets: [{ name: "Mono", stops: [[0, "#102030"], [1, "#f0e0d0"]], transparency: [] }] }] } } as never });
    container.classList.add("xd-photo"); await render({ id: "gradientMap", initial: { stops: [[0, "#000000"], [1, "#ffffff"]], method: "classic" } });
    await act(async () => by<HTMLButtonElement>("Gradient presets").click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".xd-ge-folder")].find(folder => folder.textContent === "Basics")!.click());
    await act(async () => by<HTMLButtonElement>("Mono").click());
    expect(changed).toHaveBeenLastCalledWith("stops", [[0, "#102030"], [1, "#f0e0d0"]]); expect(by("Mono")).toBeNull();
  });

  it("closes the gradient presets when the swatch opens the Gradient Editor", async () => {
    container.classList.add("xd-photo"); await render({ id: "gradientMap", initial: { stops: [[0, "#000000"], [1, "#ffffff"]], method: "classic" } });
    await act(async () => by<HTMLButtonElement>("Gradient presets").click());
    expect(container.querySelector(".xd-ge-pick-presets")).not.toBeNull();
    await act(async () => by<HTMLButtonElement>("Edit gradient").click());
    expect(container.querySelector(".xd-ge-pick-presets")).toBeNull(); expect(container.querySelector('[aria-label="Gradient Editor"]')).not.toBeNull();
  });

  it("picks a Photo Filter by name or any colour", async () => {
    await render({ id: "photoFilter" });
    expect(radios().map(radio => radio.checked)).toEqual([true, false]);
    expect(by<HTMLSelectElement>("Adjustment Filter").selectedOptions[0]!.textContent).toBe("Warming Filter (85)");
    expect(by<HTMLInputElement>("Adjustment Filter color").disabled).toBe(true);
    await input("Adjustment Filter", "Cooling 80"); expect(changed).toHaveBeenLastCalledWith("color", "#006dff");
    await act(async () => radios()[1]!.click());
    expect(by<HTMLSelectElement>("Adjustment Filter").disabled).toBe(true);
    await input("Adjustment Filter color", "#123456"); expect(changed).toHaveBeenLastCalledWith("color", "#123456");
    expect(by<HTMLSelectElement>("Adjustment Filter").selectedOptions[0]!.textContent).toBe("Custom");
    await act(async () => radios()[0]!.click()); expect(changed).toHaveBeenLastCalledWith("color", "#ec8a00");
  });

  it("totals the Channel Mixer source channels and warns above 100%", async () => {
    await render({ id: "channelMixer", initial: { red: [80, 40, 10, 0] } });
    expect(by("Channel total").textContent).toBe("+130%"); expect(by("Total is above 100%")).not.toBeNull();
    await input("Adjustment Green", "-10");
    expect(by("Channel total").textContent).toBe("+80%"); expect(by("Total is above 100%")).toBeNull();
  });

  it("puts the two colours at the ends of each Color Balance slider", async () => {
    await render({ id: "colorBalance", range: "midtones" });
    expect([...container.querySelectorAll(".xd-photo-balance-row")].map(row => [...row.querySelectorAll(":scope > span")].map(span => span.textContent))).toEqual([["Cyan", "Red"], ["Magenta", "Green"], ["Yellow", "Blue"]]);
    expect(container.querySelector<HTMLInputElement>(".xd-photo-balance-row input[type=range]")!.style.getPropertyValue("--xd-photo-track")).toBe("linear-gradient(90deg,#00ffff,#ff0000)");
  });
});

describe("Hue/Saturation math shared with the engine", () => {
  it("canonicalises ranges into one increasing turn centred in -30..330", () => {
    expect(canonicalHueRange([315, 345, 15, 45])).toEqual([-45, -15, 15, 45]);
    expect(canonicalHueRange([195, 225, 255, 285])).toEqual([195, 225, 255, 285]);
    expect(canonicalHueRange([0, 10, 5, 20])).toEqual([0, 10, 359, 359]);
    expect(canonicalHueRange("blues")).toEqual([-45, -15, 15, 45]);
  });

  it("weights hues by the fade and full-strength bands", () => {
    const blues = [195, 225, 255, 285];
    expect([240, 210, 270, 0, 195 + 360].map(deg => hueWeight(blues, deg))).toEqual([1, .5, .5, 0, 0]);
  });

  it("colours the lower bar by the engine's formula", () => {
    expect(hueSaturationColor(0, {})).toBe("rgb(255,0,0)");
    expect(hueSaturationColor(0, { hue: 120 })).toBe("rgb(0,255,0)");
    expect(hueSaturationColor(0, { lightness: 100 })).toBe("rgb(255,255,255)");
    expect(hueSaturationColor(0, { colorize: true, hue: 240, saturation: 0 })).toBe("rgb(96,96,159)");
    const blues = { blues: { hue: 60, saturation: 0, lightness: 0, range: [195, 225, 255, 285] } };
    expect([hueSaturationColor(240, blues), hueSaturationColor(0, blues)]).toEqual(["rgb(255,0,255)", "rgb(255,0,0)"]);
  });
});
