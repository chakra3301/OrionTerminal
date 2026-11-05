import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColorPickerDialog } from "./ColorPickerDialog";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const q = <T extends HTMLElement = HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
const byLabel = <T extends HTMLElement = HTMLElement>(label: string) => q<T>(`[aria-label="${label}"]`);
const button = (text: string) => [...container.querySelectorAll("button")].find(b => b.textContent === text)!;
const click = (element: HTMLElement) => act(() => element.click());
function type(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const enter = (element: HTMLElement) => act(() => { element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
const altKey = (type: "keydown" | "keyup", altKey: boolean) => act(() => { window.dispatchEvent(new KeyboardEvent(type, { key: "Alt", altKey })); });
function setup(extra: { addToSwatches?: (hex: string) => void; color?: string; preview?: (hex: string) => void } = {}) {
  const props = { close: vi.fn(), choose: vi.fn() };
  act(() => root.render(<ColorPickerDialog title="Color Picker (Foreground Color)" color={extra.color ?? "#336699"} addToSwatches={extra.addToSwatches} preview={extra.preview} {...props} />));
  return props;
}
const hex = () => byLabel<HTMLInputElement>("Hex color");

describe("ColorPickerDialog", () => {
  it("is a titled modal dialog", () => {
    setup();
    const dialog = q("[role=dialog]");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Color Picker (Foreground Color)");
    expect(q("h3").textContent).toBe("Color Picker (Foreground Color)");
    expect(hex().value).toBe("336699");
  });

  it("chooses the edited colour only on OK", () => {
    const { choose, close } = setup();
    type(hex(), "FF8000"); enter(hex());
    expect(choose).not.toHaveBeenCalled();
    expect(q<HTMLButtonElement>("button[type=submit]").textContent).toBe("OK");
    click(button("OK"));
    expect(choose).toHaveBeenCalledWith("#ff8000");
    expect(close).not.toHaveBeenCalled();
  });

  it("reports each draft colour as it changes so the canvas can preview it before OK", () => {
    const preview = vi.fn();
    setup({ preview });
    expect(preview).not.toHaveBeenCalled();
    act(() => { byLabel("Color field").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true })); });
    expect(preview).toHaveBeenCalledOnce();
    type(hex(), "FF8000"); enter(hex());
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenLastCalledWith("#ff8000");
  });

  it("closes without choosing on Cancel", () => {
    const { choose, close } = setup();
    type(hex(), "ff8000"); enter(hex());
    click(button("Cancel"));
    expect(close).toHaveBeenCalledOnce();
    expect(choose).not.toHaveBeenCalled();
  });

  it("closes on Escape and submits on Enter from a slider", () => {
    const { choose, close } = setup();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(close).toHaveBeenCalledOnce();
    enter(byLabel("Color field"));
    expect(choose).toHaveBeenCalledWith("#336699");
  });

  it("turns Cancel into Reset while Alt is held and restores the original", () => {
    const { close } = setup();
    type(hex(), "ff0000"); enter(hex());
    altKey("keydown", true);
    expect(button("Reset")).toBeTruthy();
    expect(container.textContent).not.toContain("Cancel");
    act(() => { button("Reset").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true })); });
    expect(close).not.toHaveBeenCalled();
    expect(hex().value).toBe("336699");
    altKey("keyup", false);
    expect(button("Cancel")).toBeTruthy();
  });

  it("reverts to the current colour when it is clicked", () => {
    setup();
    type(hex(), "ff0000"); enter(hex());
    expect(byLabel("New color").style.background).toBe("rgb(255, 0, 0)");
    click(byLabel("Current color. Click to revert"));
    expect(hex().value).toBe("336699");
    expect(byLabel("New color").style.background).toBe("rgb(51, 102, 153)");
  });

  it("changes the strip and field axes with the channel radios", () => {
    setup({ color: "#336699" });
    const strip = () => q("[aria-orientation=vertical]");
    expect(strip().getAttribute("aria-label")).toBe("Hue strip");
    expect(strip().getAttribute("aria-valuemax")).toBe("360");
    expect(byLabel("Color field").getAttribute("aria-valuetext")).toBe("S 67% B 60%");
    click(byLabel("Saturation channel"));
    expect(strip().getAttribute("aria-label")).toBe("Saturation strip");
    expect(strip().getAttribute("aria-valuemax")).toBe("100");
    expect(strip().getAttribute("aria-valuenow")).toBe("67");
    expect(byLabel("Color field").getAttribute("aria-valuetext")).toBe("H 210° B 60%");
    click(byLabel("Red channel"));
    expect(strip().getAttribute("aria-valuemax")).toBe("255");
    expect(strip().getAttribute("aria-valuenow")).toBe("51");
    expect(byLabel("Color field").getAttribute("aria-valuetext")).toBe("B 153 G 102");
    click(byLabel("Blue channel"));
    expect(byLabel("Color field").getAttribute("aria-valuetext")).toBe("R 51 G 102");
  });

  it("keeps hex and RGB and HSB fields in sync", () => {
    setup();
    const red = byLabel<HTMLInputElement>("Red");
    type(red, "300"); enter(red);
    expect(red.value).toBe("255");
    expect(hex().value).toBe("ff6699");
    type(hex(), "00ff00"); enter(hex());
    expect([red.value, byLabel<HTMLInputElement>("Green").value, byLabel<HTMLInputElement>("Blue").value]).toEqual(["0", "255", "0"]);
    expect([byLabel<HTMLInputElement>("Hue").value, byLabel<HTMLInputElement>("Saturation").value, byLabel<HTMLInputElement>("Brightness").value]).toEqual(["120", "100", "100"]);
    const brightness = byLabel<HTMLInputElement>("Brightness");
    type(brightness, "50"); enter(brightness);
    expect(hex().value).toBe("008000");
    type(hex(), "xyz"); enter(hex());
    expect(hex().value).toBe("008000");
  });

  it("keeps hue when brightness goes to zero", () => {
    setup();
    const brightness = byLabel<HTMLInputElement>("Brightness");
    type(brightness, "0"); enter(brightness);
    expect(hex().value).toBe("000000");
    expect(byLabel<HTMLInputElement>("Hue").value).toBe("210");
    expect(byLabel<HTMLInputElement>("Saturation").value).toBe("67");
  });

  it("moves values from the field and strip by keyboard", () => {
    setup();
    const field = byLabel("Color field"), strip = q("[aria-orientation=vertical]");
    act(() => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true })); });
    expect(field.getAttribute("aria-valuetext")).toBe("S 67% B 70%");
    act(() => { strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(strip.getAttribute("aria-valuenow")).toBe("209");
  });

  it("draws non-hue fields on a canvas without throwing when there is no context", () => {
    setup();
    expect(container.querySelector("canvas")).toBeNull();
    click(byLabel("Saturation channel"));
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("paints canvas pixels when a context exists", () => {
    const put = vi.fn();
    const context = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: put };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => context) as never);
    setup();
    click(byLabel("Red channel"));
    expect(put).toHaveBeenCalled();
    const data = put.mock.calls.at(-1)![0].data as Uint8ClampedArray;
    expect([...data.slice(0, 4)]).toEqual([51, 255, 0, 255]);
    vi.restoreAllMocks();
  });

  it("snaps with Only Web Colors and stays snapped while on", () => {
    setup({ color: "#3a6a9f" });
    expect(byLabel("Not a web color — snap to web safe")).toBeTruthy();
    const checkbox = q<HTMLInputElement>(".xd-color-webonly input");
    click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(hex().value).toBe("336699");
    expect(container.querySelector(".xd-color-warn")).toBeNull();
    type(hex(), "3a6a9f"); enter(hex());
    expect(hex().value).toBe("336699");
    click(checkbox);
    type(hex(), "3a6a9f"); enter(hex());
    expect(hex().value).toBe("3a6a9f");
    click(byLabel("Not a web color — snap to web safe"));
    expect(hex().value).toBe("336699");
  });

  it("adds the draft to swatches and stays open, only when supported", () => {
    const addToSwatches = vi.fn();
    const { close, choose } = setup({ addToSwatches });
    type(hex(), "ff8000"); enter(hex());
    click(button("Add to Swatches"));
    expect(addToSwatches).toHaveBeenCalledWith("#ff8000");
    expect(close).not.toHaveBeenCalled();
    expect(choose).not.toHaveBeenCalled();
    setup();
    expect(container.textContent).not.toContain("Add to Swatches");
  });

  it("has Lab fields (radio) and CMYK fields (no radio) after R/G/B", () => {
    setup({ color: "#ff0000" });
    expect(byLabel<HTMLInputElement>("Lightness").value).toBe("54");
    expect(byLabel<HTMLInputElement>("Lab a").value).toBe("81");
    expect(byLabel<HTMLInputElement>("Lab b").value).toBe("70");
    expect(["Cyan", "Magenta", "Yellow", "Black"].map(n => byLabel<HTMLInputElement>(n).value)).toEqual(["0", "100", "100", "0"]);
    expect(byLabel("Lightness channel")).toBeTruthy();
    expect(byLabel("Cyan channel")).toBeNull();
    expect(container.querySelectorAll("input[type=radio]")).toHaveLength(9);
  });

  it("drives the field and strip from the chosen Lab channel", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    setup({ color: "#ff0000" });
    click(byLabel("Lightness channel"));
    expect(byLabel("Lightness strip").getAttribute("aria-valuenow")).toBe("54");
    expect(byLabel("Color field").getAttribute("aria-valuemin")).toBe("-128");
    click(byLabel("Lab a channel"));
    expect(byLabel("Lab a strip").getAttribute("aria-valuemin")).toBe("-128");
    vi.restoreAllMocks();
  });

  it("edits through Lab and CMYK fields without drifting the typed value", () => {
    const { choose } = setup({ color: "#ffffff" });
    const l = byLabel<HTMLInputElement>("Lightness");
    type(l, "50"); enter(l);
    expect(l.value).toBe("50");
    expect(hex().value).toBe("777777");
    const cyan = byLabel<HTMLInputElement>("Cyan");
    type(cyan, "100"); enter(cyan);
    expect(cyan.value).toBe("100");
    expect(hex().value).toBe("007777");
    const black = byLabel<HTMLInputElement>("Black");
    type(black, "100"); enter(black);
    expect(hex().value).toBe("000000");
    expect(cyan.value).toBe("100");
    click(q<HTMLButtonElement>("button[type=submit]"));
    expect(choose).toHaveBeenCalledWith("#000000");
  });
});
