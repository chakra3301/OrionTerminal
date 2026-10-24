import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CropRatioFields, DistributeMenu, GradientPresetSelect, PathOpSelect, ShapeStyleFields, TypeBar, shapeStyleParams, typeStyleParams } from "./toolBars";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
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
  it("applies presets, clears to Unconstrained and swaps the pair", () => {
    const apply = vi.fn(), clear = vi.fn();
    render(<CropRatioFields values={{ style: "fixedRatio", ratioWidth: 16, ratioHeight: 9 }} ratios={ratios} original={[800, 600]} disabled={false} apply={apply} clear={clear} />);
    expect(byLabel<HTMLSelectElement>("Crop ratio").value).toBe("16 : 9");
    choose(byLabel<HTMLSelectElement>("Crop ratio"), "original"); expect(apply).toHaveBeenLastCalledWith(800, 600);
    act(() => byLabel("Swap crop ratio").click()); expect(apply).toHaveBeenLastCalledWith(9, 16);
    choose(byLabel<HTMLSelectElement>("Crop ratio"), "none"); expect(clear).toHaveBeenCalled();
  });
  it("hides the pair while unconstrained", () => {
    render(<CropRatioFields values={{ style: "normal" }} ratios={ratios} original={[800, 600]} disabled={false} apply={vi.fn()} clear={vi.fn()} />);
    expect(container.querySelector('[aria-label="Crop ratio width"]')).toBeNull();
  });
});

describe("DistributeMenu and GradientPresetSelect", () => {
  it("reveals distribute commands behind the ... button", () => {
    const run = vi.fn(); render(<DistributeMenu disabled={false} run={run} />);
    expect(container.querySelector('[aria-label="Distribute vertically"]')).toBeNull();
    act(() => byLabel("More alignment and distribute options").click()); act(() => byLabel("Distribute vertically").click());
    expect(run).toHaveBeenCalledWith("layer.distribute.vertically");
  });
  it("selects a gradient by preset and group", () => {
    const select = vi.fn(), current = { name: "A", stops: [[0, "foreground"], [1, "background"]] as [number, string][], transparency: [] as [number, number][] };
    render(<GradientPresetSelect current={current} groups={[{ name: "Basics", presets: [current, { ...current, name: "B" }] }]} foreground="#fff" background="#000" disabled={false} select={select} />);
    choose(byLabel<HTMLSelectElement>("Gradient preset"), "Basics/B"); expect(select).toHaveBeenCalledWith("B", "Basics");
  });
});
