import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CROP_PRESETS_KEY, cropPresetName } from "./CropPresets";
import { CropRatioFields, DistributeMenu, PathOpSelect, ShapeStyleFields, TypeBar, cropSizePixels, shapeStyleParams, typeStyleParams } from "./toolBars";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.removeItem(CROP_PRESETS_KEY); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const byLabel = <T extends HTMLElement = HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const render = (node: React.ReactElement) => act(() => root.render(node));
const choose = (el: HTMLSelectElement, value: string) => act(() => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });

describe("tool bar helpers", () => {
  it("maps type styles to weight/italic and only resets them when restyling", () => {
    expect(typeStyleParams("Regular")).toEqual({});
    expect(typeStyleParams("Regular", true)).toEqual({ weight: 400, italic: false });
    expect(typeStyleParams("Bold Italic")).toEqual({ weight: 700, italic: true });
  });
  it("sends no fill as null and a stroke only when enabled", () => {
    expect(shapeStyleParams({ fill: true, stroke: false, strokeColor: "#000000", strokeWidth: 3 }, "#ff0000")).toEqual({ fill: "#ff0000" });
    expect(shapeStyleParams({ fill: false, stroke: true, strokeColor: "#112233", strokeWidth: 5 }, "#ff0000")).toEqual({ fill: null, stroke: { color: "#112233", width: 5 } });
  });
});

describe("TypeBar", () => {
  it("reports each control as a patch", () => {
    const patch = vi.fn(), warp = vi.fn();
    render(<TypeBar font="Arial" size={48} style="Regular" align="left" antialias="smooth" orientation="horizontal" fonts={{ listId: "f", list: null }} warpDisabled={false} patch={patch} warp={warp} />);
    choose(byLabel<HTMLSelectElement>("Text font style"), "Bold"); expect(patch).toHaveBeenLastCalledWith({ style: "Bold" });
    choose(byLabel<HTMLSelectElement>("Text anti-aliasing"), "crisp"); expect(patch).toHaveBeenLastCalledWith({ antialias: "crisp" });
    act(() => byLabel("Center text").click()); expect(patch).toHaveBeenLastCalledWith({ align: "center" });
    act(() => byLabel("Vertical type").click()); expect(patch).toHaveBeenLastCalledWith({ orientation: "vertical" });
    act(() => byLabel("Create warped text").click()); expect(warp).toHaveBeenCalled();
  });
});

describe("shape bar fields", () => {
  it("toggles fill/stroke and keeps stroke inputs disabled until stroke is on", () => {
    const change = vi.fn();
    render(<ShapeStyleFields style={{ fill: true, stroke: false, strokeColor: "#000000", strokeWidth: 3 }} change={change} />);
    expect(byLabel<HTMLInputElement>("Stroke width").disabled).toBe(true);
    act(() => byLabel("Shape stroke").click()); expect(change).toHaveBeenLastCalledWith({ stroke: true });
  });
  it("lists the path operations", () => {
    const change = vi.fn(); render(<PathOpSelect value="new" change={change} />);
    choose(byLabel<HTMLSelectElement>("Path operation"), "subtract"); expect(change).toHaveBeenCalledWith("subtract");
  });
});

describe("CropRatioFields", () => {
  const ratios = [["1 : 1 (Square)", 1, 1], ["16 : 9", 16, 9]] as const;
  it("applies presets, clears to Ratio and swaps the pair", () => {
    const apply = vi.fn(), clear = vi.fn();
    render(<CropRatioFields values={{ style: "fixedRatio", ratioWidth: 16, ratioHeight: 9 }} ratios={ratios} original={[800, 600]} resolution={72} disabled={false} apply={apply} applySize={vi.fn()} clear={clear} />);
    expect(byLabel<HTMLSelectElement>("Crop ratio").value).toBe("16 : 9");
    choose(byLabel<HTMLSelectElement>("Crop ratio"), "original"); expect(apply).toHaveBeenLastCalledWith(800, 600);
    act(() => byLabel("Swap crop ratio").click()); expect(apply).toHaveBeenLastCalledWith(9, 16);
    choose(byLabel<HTMLSelectElement>("Crop ratio"), "none"); expect(clear).toHaveBeenCalled();
  });
  it("reads Ratio with Photoshop's empty pair while unconstrained and applies the pair once both sides are typed", () => {
    const apply = vi.fn(), typeIn = (label: string, value: string) => act(() => { const input = byLabel<HTMLInputElement>(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    render(<CropRatioFields values={{ style: "normal" }} ratios={ratios} original={[800, 600]} resolution={72} disabled={false} apply={apply} applySize={vi.fn()} clear={vi.fn()} />);
    const select = byLabel<HTMLSelectElement>("Crop ratio");
    expect(select.selectedOptions[0]!.textContent).toBe("Ratio"); expect(select.closest("label")).toBeNull();
    expect([byLabel<HTMLInputElement>("Crop ratio width").value, byLabel<HTMLInputElement>("Crop ratio height").value]).toEqual(["", ""]);
    typeIn("Crop ratio width", "4"); expect(apply).not.toHaveBeenCalled(); expect(byLabel<HTMLInputElement>("Crop ratio width").value).toBe("4");
    act(() => byLabel("Swap crop ratio").click()); expect(byLabel<HTMLInputElement>("Crop ratio height").value).toBe("4");
    typeIn("Crop ratio width", "5"); expect(apply).toHaveBeenLastCalledWith(5, 4);
  });
});

describe("W x H x Resolution crops", () => {
  const ratios = [["16 : 9", 16, 9]] as const;
  const typeIn = (label: string, value: string) => act(() => { const input = byLabel<HTMLInputElement>(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  it("turns the sizes into target pixels at the set resolution, or the image's when it is empty", () => {
    expect(cropSizePixels({ style: "size", sizeWidth: 4, sizeWidthUnit: "in", sizeHeight: 5, sizeHeightUnit: "in", resolution: 300, resolutionUnit: "in" }, 72)).toEqual({ width: 1200, height: 1500, ppi: 300 });
    expect(cropSizePixels({ style: "size", sizeWidth: 1024, sizeWidthUnit: "px", sizeHeight: 768, sizeHeightUnit: "px", resolution: 0 }, 72)).toEqual({ width: 1024, height: 768, ppi: 72 });
    expect(cropSizePixels({ style: "size", sizeWidth: 10, sizeWidthUnit: "cm", sizeHeight: 50, sizeHeightUnit: "mm", resolution: 100, resolutionUnit: "cm" }, 72)).toEqual({ width: 1000, height: 500, ppi: 254 });
    expect(cropSizePixels({ style: "size", sizeWidth: 4, sizeHeight: 0 }, 72)).toBeNull();
    expect(cropSizePixels({ style: "fixedRatio", sizeWidth: 4, sizeHeight: 5 }, 72)).toBeNull();
  });
  it("shows Photoshop's width, height and resolution fields, applying a typed length on Enter or blur", () => {
    const applySize = vi.fn();
    render(<CropRatioFields values={{ style: "size", sizeWidth: 4, sizeWidthUnit: "in", sizeHeight: 5, sizeHeightUnit: "in", resolution: 300, resolutionUnit: "in" }} ratios={ratios} original={[800, 600]} resolution={72} disabled={false} apply={vi.fn()} applySize={applySize} clear={vi.fn()} />);
    const select = byLabel<HTMLSelectElement>("Crop ratio");
    expect(select.value).toBe("4 x 5 in 300 ppi");
    expect([...select.options].map(option => option.textContent)).toEqual(["Ratio", "W x H x Resolution", "Original Ratio", "16 : 9", "Front Image", "4 x 5 in 300 ppi", "8.5 x 11 in 300 ppi", "1024 x 768 px 92 ppi", "1280 x 800 px 113 ppi", "1366 x 768 px 135 ppi", "New Crop Preset…", "Delete Crop Preset…"]);
    expect([byLabel<HTMLInputElement>("Crop width").value, byLabel<HTMLInputElement>("Crop height").value, byLabel<HTMLInputElement>("Crop resolution").value, byLabel<HTMLSelectElement>("Crop resolution unit").value]).toEqual(["4 in", "5 in", "300", "in"]);
    byLabel("Crop width").focus(); typeIn("Crop width", "1024 px"); expect(applySize).not.toHaveBeenCalled();
    act(() => { byLabel("Crop width").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })); }); expect(applySize).toHaveBeenLastCalledWith({ sizeWidth: 1024, sizeWidthUnit: "px" });
    typeIn("Crop height", "6"); act(() => { byLabel("Crop height").dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); expect(applySize).toHaveBeenLastCalledWith({ sizeHeight: 6, sizeHeightUnit: "in" });
    typeIn("Crop height", "six"); act(() => { byLabel("Crop height").dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); expect(applySize).toHaveBeenCalledTimes(2); expect(byLabel<HTMLInputElement>("Crop height").value).toBe("5 in");
    act(() => byLabel("Swap crop size").click()); expect(applySize).toHaveBeenLastCalledWith({ sizeWidth: 5, sizeWidthUnit: "in", sizeHeight: 4, sizeHeightUnit: "in" });
    choose(byLabel<HTMLSelectElement>("Crop resolution unit"), "cm"); expect(applySize).toHaveBeenLastCalledWith({ resolution: 118.11, resolutionUnit: "cm" });
    act(() => byLabel("Clear crop size").click()); expect(applySize).toHaveBeenLastCalledWith({ sizeWidth: 0, sizeHeight: 0, resolution: 0 });
    choose(select, "Front Image"); expect(applySize).toHaveBeenLastCalledWith({ style: "size", sizeWidth: 800, sizeWidthUnit: "px", sizeHeight: 600, sizeHeightUnit: "px", resolution: 72, resolutionUnit: "in" });
    choose(select, "size"); expect(applySize).toHaveBeenLastCalledWith({ style: "size", sizeWidth: 0, sizeHeight: 0, resolution: 0 });
  });
});

describe("crop presets", () => {
  const ratios = [["16 : 9", 16, 9]] as const;
  const typeIn = (label: string, value: string) => act(() => { const input = byLabel<HTMLInputElement>(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  const dialogs = () => [...container.querySelectorAll<HTMLFormElement>('[role="dialog"]')];
  const press = (text: string) => act(() => [...dialogs().at(-1)!.querySelectorAll("button")].find(button => button.textContent === text)!.click());
  const pick = (select: HTMLSelectElement, text: string) => choose(select, [...select.options].find(option => option.textContent === text)!.value);
  it("names a new preset the way Photoshop fills in the New Crop Preset dialog", () => {
    expect(cropPresetName({ style: "normal" })).toBe("Unconstrained");
    expect(cropPresetName({ style: "fixedRatio", ratioWidth: 16, ratioHeight: 9 })).toBe("16 : 9");
    expect(cropPresetName({ style: "size", sizeWidth: 800, sizeWidthUnit: "px", sizeHeight: 600, sizeHeightUnit: "px", resolution: 72, resolutionUnit: "in" })).toBe("800 x 600 px 72 ppi");
    expect(cropPresetName({ style: "size", sizeWidth: 4, sizeWidthUnit: "in", sizeHeight: 600, sizeHeightUnit: "px", resolution: 28.346, resolutionUnit: "cm" })).toBe("4 in x 600 px 28.346 ppcm");
    expect(cropPresetName({ style: "size", sizeWidth: 4, sizeWidthUnit: "in", sizeHeight: 0, resolution: 28.346, resolutionUnit: "cm" })).toBe("4 in W 28.346 ppcm");
  });
  it("converts the resolution to px/cm at Photoshop's three decimals", () => {
    const applySize = vi.fn();
    render(<CropRatioFields values={{ style: "size", sizeWidth: 800, sizeWidthUnit: "px", sizeHeight: 600, sizeHeightUnit: "px", resolution: 72, resolutionUnit: "in" }} ratios={ratios} original={[800, 600]} resolution={72} disabled={false} apply={vi.fn()} applySize={applySize} clear={vi.fn()} />);
    choose(byLabel<HTMLSelectElement>("Crop resolution unit"), "cm"); expect(applySize).toHaveBeenLastCalledWith({ resolution: 28.346, resolutionUnit: "cm" });
  });
  it("saves the current crop from New Crop Preset…, lists it after the sizes and selects it", () => {
    render(<CropRatioFields values={{ style: "fixedRatio", ratioWidth: 16, ratioHeight: 9 }} ratios={ratios} original={[800, 600]} resolution={72} disabled={false} apply={vi.fn()} applySize={vi.fn()} clear={vi.fn()} />);
    const select = byLabel<HTMLSelectElement>("Crop ratio");
    expect([...select.options].slice(-3).map(option => [option.textContent, option.disabled])).toEqual([["1366 x 768 px 135 ppi", false], ["New Crop Preset…", false], ["Delete Crop Preset…", true]]);
    pick(select, "New Crop Preset…");
    expect(select.selectedOptions[0]!.textContent).toBe("16 : 9");
    expect(dialogs().map(dialog => dialog.querySelector("h3")!.textContent)).toEqual(["New Crop Preset"]);
    const name = byLabel<HTMLInputElement>("Crop preset name");
    expect(name.value).toBe("16 : 9"); expect(document.activeElement).toBe(name); expect([name.selectionStart, name.selectionEnd]).toEqual([0, 6]);
    typeIn("Crop preset name", "  "); press("OK");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("You must specify a name for the crop preset."); expect(dialogs()).toHaveLength(1);
    typeIn("Crop preset name", "Wide"); press("OK");
    expect(dialogs()).toEqual([]);
    expect([...select.options].slice(-4).map(option => [option.textContent, option.disabled])).toEqual([["1366 x 768 px 135 ppi", false], ["Wide", false], ["New Crop Preset…", false], ["Delete Crop Preset…", false]]);
    expect(select.selectedOptions[0]!.textContent).toBe("Wide");
    expect(JSON.parse(localStorage.getItem(CROP_PRESETS_KEY)!)).toEqual([{ name: "Wide", values: { style: "fixedRatio", ratioWidth: 16, ratioHeight: 9 } }]);
  });
  it("applies a saved preset and deletes one or all of them after Photoshop's confirmation", () => {
    const print = { style: "size", sizeWidth: 4, sizeWidthUnit: "in", sizeHeight: 5, sizeHeightUnit: "in", resolution: 300, resolutionUnit: "in" };
    localStorage.setItem(CROP_PRESETS_KEY, JSON.stringify([{ name: "Wide", values: { style: "fixedRatio", ratioWidth: 16, ratioHeight: 9 } }, { name: "Print", values: print }]));
    const apply = vi.fn(), applySize = vi.fn();
    render(<CropRatioFields values={{ style: "normal" }} ratios={ratios} original={[800, 600]} resolution={72} disabled={false} apply={apply} applySize={applySize} clear={vi.fn()} />);
    const select = byLabel<HTMLSelectElement>("Crop ratio");
    pick(select, "Wide"); expect(apply).toHaveBeenLastCalledWith(16, 9);
    pick(select, "Print"); expect(applySize).toHaveBeenLastCalledWith(print);
    pick(select, "Delete Crop Preset…");
    expect(dialogs().map(dialog => dialog.querySelector("h3")!.textContent)).toEqual(["Delete Crop Preset"]);
    expect([...byLabel<HTMLSelectElement>("Crop preset to delete").options].map(option => option.textContent)).toEqual(["Wide", "Print", "All Crop Presets"]);
    press("Delete");
    expect(dialogs()).toHaveLength(2); expect(dialogs()[1]!.textContent).toContain("Do you really want to delete the crop preset 'Wide'?");
    press("No"); expect(dialogs()).toHaveLength(1);
    press("Delete"); press("Yes");
    expect(dialogs()).toEqual([]); expect([...select.options].map(option => option.textContent)).not.toContain("Wide");
    expect(JSON.parse(localStorage.getItem(CROP_PRESETS_KEY)!)).toEqual([{ name: "Print", values: print }]);
    pick(select, "Delete Crop Preset…"); pick(byLabel<HTMLSelectElement>("Crop preset to delete"), "All Crop Presets"); press("Delete");
    expect(dialogs()[1]!.textContent).toContain("Do you really want to delete all the crop presets?");
    press("Yes");
    expect(dialogs()).toEqual([]); expect([...select.options].find(option => option.textContent === "Delete Crop Preset…")!.disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(CROP_PRESETS_KEY)!)).toEqual([]);
  });
});

describe("DistributeMenu", () => {
  it("reveals distribute commands behind the ... button", () => {
    const run = vi.fn(); render(<DistributeMenu disabled={false} run={run} />);
    expect(container.querySelector('[aria-label="Distribute vertically"]')).toBeNull();
    act(() => byLabel("More alignment and distribute options").click()); act(() => byLabel("Distribute vertically").click());
    expect(run).toHaveBeenCalledWith("layer.distribute.vertically");
  });
});
