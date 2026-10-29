import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHAPE_STYLE, type ShapeStyle } from "./shapeStyle";
import { CommitNumber, ShapeStyleFields } from "./ShapeStyleFields";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const byLabel = <T extends HTMLElement = HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const render = (node: React.ReactElement) => act(() => root.render(node));
const type = (label: string, value: string) => act(() => { const input = byLabel<HTMLInputElement>(label); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const key = (label: string, name: string) => act(() => { byLabel(label).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
const press = (label: string) => act(() => { const button = byLabel(label); button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); button.click(); });
const choose = (label: string, value: string) => act(() => { const select = byLabel<HTMLSelectElement>(label); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
const fields = (style: ShapeStyle, change: (patch: Partial<ShapeStyle>) => void) => render(<ShapeStyleFields style={style} foreground="#ff0000" background="#ffffff" change={change}/>);

describe("typed number fields", () => {
  it("commit on Enter or blur, not per keystroke, and Escape keeps the value", () => {
    const commit = vi.fn(); render(<CommitNumber label="Width" value={10} min={1} max={100} commit={commit}/>);
    type("Width", "4"); type("Width", "45"); expect(commit).not.toHaveBeenCalled();
    key("Width", "Enter"); expect(commit).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenLastCalledWith(45);
    type("Width", "500"); act(() => byLabel("Width").blur()); expect(commit).toHaveBeenLastCalledWith(100);
    type("Width", "7"); key("Width", "Escape"); expect(commit).toHaveBeenCalledTimes(2); expect(byLabel<HTMLInputElement>("Width").value).toBe("10");
    type("Width", ""); act(() => byLabel("Width").blur()); expect(commit).toHaveBeenCalledTimes(2);
  });
});

describe("shape fill and stroke type", () => {
  it("offers Photoshop's No Color, Solid Color, Gradient and Pattern, with Pattern off when there are no pattern presets", () => {
    const change = vi.fn(); fields(DEFAULT_SHAPE_STYLE, change);
    press("Shape fill type");
    expect(container.querySelector('[role="dialog"][aria-label="Fill"]')).not.toBeNull();
    expect(byLabel("Solid Color").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel<HTMLButtonElement>("Pattern").disabled).toBe(true);
    act(() => byLabel("No Color").click()); expect(change).toHaveBeenLastCalledWith({ fill: false });
    act(() => byLabel("Gradient").click()); expect(change).toHaveBeenLastCalledWith({ fill: true, fillKind: "gradient" });
    press("Shape stroke type");
    expect(container.querySelector('[role="dialog"][aria-label="Fill"]')).toBeNull();
    expect(byLabel("No Color").getAttribute("aria-pressed")).toBe("true");
    act(() => byLabel("Solid Color").click()); expect(change).toHaveBeenLastCalledWith({ stroke: true, strokeKind: "solid" });
  });
  it("picks a pattern fill's preset, angle and scale, one commit each, and names a shape's pattern that is not a preset", () => {
    const patterns = [{ id: "p1", name: "Bubbles" }, { id: "p2", name: "Grid" }], change = vi.fn();
    const withPatterns = (style: ShapeStyle) => render(<ShapeStyleFields style={style} foreground="#ff0000" background="#ffffff" patterns={patterns} change={change}/>);
    withPatterns(DEFAULT_SHAPE_STYLE); press("Shape fill type");
    expect(byLabel<HTMLButtonElement>("Pattern").disabled).toBe(false);
    act(() => byLabel("Pattern").click()); expect(change).toHaveBeenLastCalledWith({ fill: true, fillKind: "pattern", fillPattern: { id: "p1", name: "Bubbles", scale: 100, angle: 0 } });
    const pattern = { id: "p1", name: "Bubbles", scale: 100, angle: 0 }; withPatterns({ ...DEFAULT_SHAPE_STYLE, fillKind: "pattern", fillPattern: pattern });
    act(() => byLabel("Pattern").click()); expect(change).toHaveBeenLastCalledWith({ fill: true, fillKind: "pattern" });
    choose("Fill pattern", "p2"); expect(change).toHaveBeenLastCalledWith({ fillPattern: { ...pattern, id: "p2", name: "Grid" } });
    type("Fill pattern angle", "45"); key("Fill pattern angle", "Enter"); expect(change).toHaveBeenLastCalledWith({ fillPattern: { ...pattern, angle: 45 } });
    type("Fill pattern scale", "5000"); key("Fill pattern scale", "Enter"); expect(change).toHaveBeenLastCalledWith({ fillPattern: { ...pattern, scale: 1000 } });
    expect(change).toHaveBeenCalledTimes(5);
    withPatterns({ ...DEFAULT_SHAPE_STYLE, fillKind: "pattern", fillPattern: { ...pattern, id: "imported", name: "Imported" } });
    expect(byLabel<HTMLSelectElement>("Fill pattern").value).toBe("imported"); expect(byLabel<HTMLSelectElement>("Fill pattern").selectedOptions[0]!.textContent).toBe("Imported");
  });
  it("commits a picked colour once, when the colour picker closes", () => {
    const change = vi.fn(); fields(DEFAULT_SHAPE_STYLE, change);
    press("Shape fill type");
    const input = byLabel<HTMLInputElement>("Fill color"); expect(input.value).toBe("#ff0000");
    type("Fill color", "#123456"); type("Fill color", "#123457"); expect(change).not.toHaveBeenCalled();
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); }); expect(change).toHaveBeenCalledTimes(1); expect(change).toHaveBeenLastCalledWith({ fill: true, fillKind: "solid", fillColor: "#123457" });
  });
  it("edits a gradient fill's style, angle, scale and reverse", () => {
    const change = vi.fn(), style: ShapeStyle = { ...DEFAULT_SHAPE_STYLE, fillKind: "gradient" }, gradient = style.fillGradient; fields(style, change);
    press("Shape fill type");
    act(() => byLabel("Radial Gradient").click()); expect(change).toHaveBeenLastCalledWith({ fillGradient: { ...gradient, style: "radial" } });
    type("Fill gradient angle", "45"); expect(change).toHaveBeenCalledTimes(1); key("Fill gradient angle", "Enter"); expect(change).toHaveBeenLastCalledWith({ fillGradient: { ...gradient, angle: 45 } });
    type("Fill gradient scale", "400"); key("Fill gradient scale", "Enter"); expect(change).toHaveBeenLastCalledWith({ fillGradient: { ...gradient, scale: 150 } });
    act(() => byLabel("Reverse fill gradient").click()); expect(change).toHaveBeenLastCalledWith({ fillGradient: { ...gradient, reverse: true } });
  });
  it("types the stroke width as one commit and keeps it off with no stroke", () => {
    const change = vi.fn(); fields(DEFAULT_SHAPE_STYLE, change);
    expect(byLabel<HTMLInputElement>("Stroke width").disabled).toBe(true);
    fields({ ...DEFAULT_SHAPE_STYLE, stroke: true }, change);
    type("Stroke width", "1"); type("Stroke width", "12"); key("Stroke width", "Enter");
    expect(change).toHaveBeenCalledTimes(1); expect(change).toHaveBeenLastCalledWith({ strokeWidth: 12 });
  });
});

describe("stroke options", () => {
  it("picks a line preset, align, caps and corners", () => {
    const change = vi.fn(); fields({ ...DEFAULT_SHAPE_STYLE, stroke: true }, change);
    press("Stroke options");
    expect(container.querySelector('[role="dialog"][aria-label="Stroke Options"]')).not.toBeNull();
    expect(byLabel("Solid").getAttribute("aria-pressed")).toBe("true");
    act(() => byLabel("Dashed").click()); expect(change).toHaveBeenLastCalledWith({ dashes: [4, 2], cap: "butt" });
    choose("Stroke align", "outside"); expect(change).toHaveBeenLastCalledWith({ align: "outside" });
    choose("Stroke caps", "round"); expect(change).toHaveBeenLastCalledWith({ cap: "round" });
    choose("Stroke corners", "bevel"); expect(change).toHaveBeenLastCalledWith({ join: "bevel" });
  });
  it("sets dash and gap pairs in More Options", () => {
    const change = vi.fn(); fields({ ...DEFAULT_SHAPE_STYLE, stroke: true, dashes: [4, 2] }, change);
    press("Stroke options"); act(() => byLabel("More Options").click());
    expect(byLabel<HTMLInputElement>("Dashed Line").checked).toBe(true);
    expect(byLabel<HTMLInputElement>("Dash 1").value).toBe("4"); expect(byLabel<HTMLInputElement>("Gap 2").value).toBe("");
    type("Dash 2", "1"); key("Dash 2", "Enter"); expect(change).toHaveBeenLastCalledWith({ dashes: [4, 2, 1, 1] });
    act(() => byLabel("Dashed Line").click()); expect(change).toHaveBeenLastCalledWith({ dashes: [] });
    fields({ ...DEFAULT_SHAPE_STYLE, stroke: true }, change);
    expect(byLabel<HTMLInputElement>("Dash 1").disabled).toBe(true);
    act(() => byLabel("Dashed Line").click()); expect(change).toHaveBeenLastCalledWith({ dashes: [4, 2] });
  });
});
