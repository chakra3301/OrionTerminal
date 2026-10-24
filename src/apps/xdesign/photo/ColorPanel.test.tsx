import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../menuModel";
import { ColorPanel, colorPanelMenu, type ColorPanelMode } from "./ColorPanel";
import { hsbToRgb, rgbToHex } from "./colorModel";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const q = <T extends HTMLElement = HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
const byLabel = <T extends HTMLElement = HTMLElement>(label: string) => q<T>(`[aria-label="${label}"]`);
function box(element: HTMLElement) { element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} }); }
const pointer = (element: HTMLElement, type: string, x: number, y: number) => act(() => { element.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })); });
const key = (element: HTMLElement, name: string, shiftKey = false) => act(() => { element.dispatchEvent(new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true })); });
function type(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const enter = (input: HTMLElement) => key(input, "Enter");

function Harness({ initial = "#336699", mode = "hueCube", disabled = false, spies, addToSwatches }: { initial?: string; mode?: ColorPanelMode; disabled?: boolean; spies: Spies; addToSwatches?: (hex: string) => void }) {
  const [colors, setColors] = useState({ foreground: initial, background: "#ffffff" });
  return <ColorPanel foreground={colors.foreground} background={colors.background} disabled={disabled} mode={mode}
    change={(k, hex) => { spies.change(k, hex); setColors(c => ({ ...c, [k]: hex })); }} swap={spies.swap} reset={spies.reset} openPicker={spies.openPicker} addToSwatches={addToSwatches} />;
}
const spies = () => ({ change: vi.fn<(key: string, hex: string) => void>(), swap: vi.fn<() => void>(), reset: vi.fn<() => void>(), openPicker: vi.fn<(key: string) => void>() });
type Spies = ReturnType<typeof spies>;
const render = (props: Partial<Parameters<typeof Harness>[0]> = {}) => { const s = spies(); act(() => root.render(<Harness spies={s} {...props} />)); return s; };

describe("chips", () => {
  it("edits the foreground first, switches to an inactive chip and opens the picker from the active one", () => {
    const s = render();
    expect(byLabel("Foreground color").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel("Background color").getAttribute("aria-pressed")).toBe("false");
    act(() => byLabel("Background color").click());
    expect(byLabel("Background color").getAttribute("aria-pressed")).toBe("true");
    expect(s.openPicker).not.toHaveBeenCalled();
    act(() => byLabel("Background color").click());
    expect(s.openPicker).toHaveBeenCalledWith("background");
  });
  it("forwards swap and default", () => {
    const s = render();
    act(() => byLabel("Swap foreground and background colors").click());
    act(() => byLabel("Default foreground and background colors").click());
    expect(s.swap).toHaveBeenCalledOnce();
    expect(s.reset).toHaveBeenCalledOnce();
  });
  it("edits the background once it is active", () => {
    const s = render();
    act(() => byLabel("Background color").click());
    const field = byLabel("Saturation and brightness"); box(field);
    pointer(field, "pointerdown", 0, 100);
    expect(s.change).toHaveBeenLastCalledWith("background", "#000000");
  });
});

describe("hue cube", () => {
  it("maps the field pointer to saturation and brightness and keeps dragging", () => {
    const s = render({ initial: "#ff0000" });
    const field = byLabel("Saturation and brightness"); box(field);
    pointer(field, "pointerdown", 40, 30);
    expect(s.change).toHaveBeenLastCalledWith("foreground", rgbToHex(hsbToRgb([0, 40, 70])));
    expect(field.getAttribute("aria-valuetext")).toBe("S 40% B 70%");
    pointer(field, "pointermove", 100, 0);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#ff0000");
    const calls = s.change.mock.calls.length;
    pointer(field, "pointerup", 100, 0); pointer(field, "pointermove", 0, 0);
    expect(s.change.mock.calls.length).toBe(calls);
  });
  it("puts 360 at the top of the hue strip and 0 at the bottom", () => {
    const s = render({ initial: "#ff0000" });
    const strip = byLabel("Hue"); box(strip);
    expect(strip.getAttribute("aria-orientation")).toBe("vertical");
    expect(strip.getAttribute("aria-valuemin")).toBe("0");
    expect(strip.getAttribute("aria-valuemax")).toBe("360");
    pointer(strip, "pointerdown", 5, 50);
    expect(strip.getAttribute("aria-valuenow")).toBe("180");
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#00ffff");
    pointer(strip, "pointermove", 5, 0);
    expect(strip.getAttribute("aria-valuenow")).toBe("360");
    pointer(strip, "pointermove", 5, 100);
    expect(strip.getAttribute("aria-valuenow")).toBe("0");
  });
  it("steps by 1 with arrows and 10 with Shift", () => {
    const s = render({ initial: "#336699" });
    const field = byLabel("Saturation and brightness");
    const start = field.getAttribute("aria-valuetext");
    expect(start).toBe("S 67% B 60%");
    key(field, "ArrowRight"); expect(field.getAttribute("aria-valuetext")).toBe("S 68% B 60%");
    key(field, "ArrowUp", true); expect(field.getAttribute("aria-valuetext")).toBe("S 68% B 70%");
    key(field, "ArrowLeft", true); key(field, "ArrowDown");
    expect(field.getAttribute("aria-valuetext")).toBe("S 58% B 69%");
    const strip = byLabel("Hue");
    key(strip, "ArrowUp"); expect(strip.getAttribute("aria-valuenow")).toBe("211");
    key(strip, "ArrowDown", true); expect(strip.getAttribute("aria-valuenow")).toBe("201");
    expect(s.change).toHaveBeenCalledTimes(6);
  });
  it("keeps hue and saturation when brightness is dragged to black", () => {
    render({ initial: "#336699" });
    const field = byLabel("Saturation and brightness"), strip = byLabel("Hue"); box(field);
    expect(strip.getAttribute("aria-valuenow")).toBe("210");
    pointer(field, "pointerdown", 67, 40);
    pointer(field, "pointermove", 67, 100);
    expect(field.getAttribute("aria-valuetext")).toBe("S 67% B 0%");
    expect(strip.getAttribute("aria-valuenow")).toBe("210");
    pointer(field, "pointermove", 0, 50);
    expect(field.getAttribute("aria-valuetext")).toBe("S 0% B 50%");
    expect(strip.getAttribute("aria-valuenow")).toBe("210");
  });
  it("resyncs when the colour changes from outside", () => {
    const s = spies();
    act(() => root.render(<ColorPanel foreground="#ff0000" background="#fff" disabled={false} mode="hueCube" change={s.change} swap={s.swap} reset={s.reset} openPicker={s.openPicker} />));
    act(() => root.render(<ColorPanel foreground="#0000ff" background="#fff" disabled={false} mode="hueCube" change={s.change} swap={s.swap} reset={s.reset} openPicker={s.openPicker} />));
    expect(byLabel("Hue").getAttribute("aria-valuenow")).toBe("240");
  });
  it("samples the spectrum ramp into the active chip", () => {
    const s = render();
    const ramp = byLabel("Click to sample color"); box(ramp);
    expect(ramp.title).toBe("Click to sample color");
    pointer(ramp, "pointerdown", 0, 50);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#ff0000");
    pointer(ramp, "pointermove", 50, 0);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#ffffff");
  });
});

describe("slider modes", () => {
  it("commits rgb number fields on Enter or blur, clamped, and ignores invalid text", () => {
    const s = render({ mode: "rgb", initial: "#336699" });
    const red = byLabel<HTMLInputElement>("Red value");
    type(red, "300"); expect(s.change).not.toHaveBeenCalled();
    enter(red);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#ff6699");
    expect(red.value).toBe("255");
    type(red, "abc"); enter(red);
    expect(s.change).toHaveBeenCalledTimes(1);
    expect(red.value).toBe("255");
    const green = byLabel<HTMLInputElement>("Green value");
    type(green, "-5");
    act(() => { green.blur(); green.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#ff0099");
  });
  it("moves a channel from the range input", () => {
    const s = render({ mode: "rgb", initial: "#336699" });
    const range = byLabel<HTMLInputElement>("Blue");
    expect(range.max).toBe("255");
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(range, "16"); range.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#336610");
  });
  it("validates the hex field", () => {
    const s = render({ mode: "rgb", initial: "#336699" });
    const hex = byLabel<HTMLInputElement>("Hex color");
    expect(hex.value).toBe("336699");
    type(hex, "zzz"); enter(hex);
    expect(s.change).not.toHaveBeenCalled();
    expect(hex.value).toBe("336699");
    type(hex, "ABC"); enter(hex);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#aabbcc");
    expect(hex.value).toBe("aabbcc");
  });
  it("offers H, S and B rows with units and keeps hue at zero saturation", () => {
    render({ mode: "hsb", initial: "#336699" });
    expect(byLabel<HTMLInputElement>("Hue value").value).toBe("210");
    expect(byLabel<HTMLInputElement>("Saturation value").value).toBe("67");
    expect(container.textContent).toContain("°");
    const saturation = byLabel<HTMLInputElement>("Saturation value");
    type(saturation, "0"); enter(saturation);
    expect(byLabel<HTMLInputElement>("Hue value").value).toBe("210");
  });
  it("shows a single grayscale K row", () => {
    const s = render({ mode: "grayscale", initial: "#808080" });
    expect(container.querySelectorAll("input[type=range]")).toHaveLength(1);
    const k = byLabel<HTMLInputElement>("Black value");
    expect(k.value).toBe("50");
    type(k, "100"); enter(k);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#000000");
  });
  it("steps web sliders by 0x33, shows hex and warns for non-web colours", () => {
    const s = render({ mode: "web", initial: "#336699" });
    expect(byLabel<HTMLInputElement>("Red").step).toBe("51");
    expect(byLabel<HTMLInputElement>("Green value").value).toBe("66");
    expect(container.querySelector(".xd-color-warn")).toBeNull();
    const red = byLabel<HTMLInputElement>("Red value");
    type(red, "ff"); enter(red);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#ff6699");
    type(red, "7f"); enter(red);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#666699");
  });
  it("snaps from the web warning only in web mode", () => {
    const s = render({ mode: "web", initial: "#3a6a9f" });
    act(() => byLabel("Not a web color — snap to web safe").click());
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#336699");
    expect(container.querySelector(".xd-color-warn")).toBeNull();
    act(() => root.render(<Harness spies={s} mode="rgb" initial="#3a6a9f" />));
    expect(container.querySelector(".xd-color-warn")).toBeNull();
  });
});

describe("disabled", () => {
  it("disables every control", () => {
    render({ disabled: true });
    expect([...container.querySelectorAll("button")].every(b => b.disabled)).toBe(true);
    const field = byLabel("Saturation and brightness"); box(field);
    expect(field.getAttribute("aria-disabled")).toBe("true");
    const s = render({ disabled: true });
    pointer(byLabel("Saturation and brightness"), "pointerdown", 10, 10);
    key(byLabel("Hue"), "ArrowUp");
    pointer(byLabel("Click to sample color"), "pointerdown", 10, 10);
    expect(s.change).not.toHaveBeenCalled();
  });
  it("disables inputs in slider modes", () => {
    render({ disabled: true, mode: "rgb" });
    expect([...container.querySelectorAll("input")].every(i => i.disabled)).toBe(true);
  });
});

describe("brightness cube", () => {
  it("drives hue and saturation from the field and brightness from the strip", () => {
    const s = render({ mode: "brightnessCube", initial: "#ff0000" });
    const field = byLabel("Hue and saturation"), strip = byLabel("Brightness");
    box(field); box(strip);
    pointer(field, "pointerdown", 50, 0);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#00ffff");
    pointer(strip, "pointerdown", 0, 50);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#008080");
    expect(strip.getAttribute("aria-valuenow")).toBe("50");
    key(strip, "ArrowUp");
    expect(strip.getAttribute("aria-valuenow")).toBe("51");
  });
});

describe("color wheel", () => {
  it("picks hue on the ring and saturation/brightness in the square", () => {
    const s = render({ mode: "colorWheel", initial: "#ff0000" });
    const wheel = byLabel("Color wheel"); box(wheel);
    pointer(wheel, "pointerdown", 95, 50);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#80ff00");
    pointer(wheel, "pointerup", 95, 50);
    pointer(wheel, "pointerdown", 50, 50);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#607f40");
    expect(wheel.getAttribute("aria-valuetext")).toBe("H 90° S 50% B 50%");
  });
  it("offers the new-swatch button only with a handler", () => {
    render({ mode: "colorWheel" });
    expect(byLabel("Add a new swatch for this color")).toBeNull();
    const addToSwatches = vi.fn();
    render({ mode: "colorWheel", addToSwatches });
    act(() => byLabel("Add a new swatch for this color").click());
    expect(addToSwatches).toHaveBeenCalledWith("#336699");
  });
});

describe("cmyk and lab sliders", () => {
  it("shows C, M, Y, K percent rows and keeps a typed value", () => {
    const s = render({ mode: "cmyk", initial: "#ff0000" });
    expect(["Cyan", "Magenta", "Yellow", "Black"].map(n => byLabel<HTMLInputElement>(`${n} value`).value)).toEqual(["0", "100", "100", "0"]);
    const cyan = byLabel<HTMLInputElement>("Cyan value");
    type(cyan, "50"); enter(cyan);
    expect(s.change).toHaveBeenLastCalledWith("foreground", "#800000");
    expect(cyan.value).toBe("50");
  });
  it("shows L, a, b with signed ranges", () => {
    const s = render({ mode: "lab", initial: "#ffffff" });
    expect(byLabel<HTMLInputElement>("Lightness value").value).toBe("100");
    const a = byLabel<HTMLInputElement>("Lab a value");
    expect(a.value).toBe("0");
    expect(byLabel<HTMLInputElement>("Lab a").getAttribute("min")).toBe("-128");
    type(a, "-500"); enter(a);
    expect(a.value).toBe("-128");
    expect(s.change).toHaveBeenCalled();
  });
});

describe("colorPanelMenu", () => {
  const items = (mode: ColorPanelMode, setMode = vi.fn()) => ({ setMode, list: colorPanelMenu(mode, setMode, "#AABBCC") });
  it("lists radio modes with the current one checked", () => {
    const { list } = items("hsb");
    const modes = list.filter((e): e is MenuItem => e !== "-" && !!e.radio);
    expect(modes.map(m => m.label)).toEqual(["Hue Cube", "Brightness Cube", "Color Wheel", "Grayscale Slider", "RGB Sliders", "HSB Sliders", "CMYK Sliders", "Lab Sliders", "Web Color Sliders"]);
    expect(modes.filter(m => m.checked).map(m => m.label)).toEqual(["HSB Sliders"]);
    expect(list[9]).toBe("-");
  });
  it("sets the mode", () => {
    const { list, setMode } = items("hueCube");
    (list[8] as MenuItem).run!();
    expect(setMode).toHaveBeenCalledWith("web");
  });
  it("copies the colour as html and as a hex code, swallowing failures", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { list } = items("rgb");
    (list[10] as MenuItem).run!(); (list[11] as MenuItem).run!();
    expect(writeText.mock.calls).toEqual([['color="#aabbcc"'], ["aabbcc"]]);
    vi.stubGlobal("navigator", { clipboard: { writeText: () => { throw new Error("denied"); } } });
    expect(() => (list[11] as MenuItem).run!()).not.toThrow();
    vi.stubGlobal("navigator", {});
    expect(() => (list[10] as MenuItem).run!()).not.toThrow();
  });
});
