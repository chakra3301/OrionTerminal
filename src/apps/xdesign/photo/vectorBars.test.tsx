import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VECTOR_TOOL_OPTIONS } from "./vectorToolPreferences";
import { ComponentOpSelect, CornerRadiusFields, FreeformFields, LineGear, MakeButtons, PathAlignMenu, PenFields, SelectScopeSelect, ShapeGear, SizeFields, VectorModeSelect } from "./vectorBars";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const byLabel = <T extends HTMLElement = HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const render = (node: React.ReactElement) => act(() => root.render(node));
const type = (label: string, value: string) => act(() => { const input = byLabel<HTMLInputElement>(label); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const enter = (label: string) => act(() => { byLabel(label).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
const press = (label: string) => act(() => { const button = byLabel(label); button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); button.click(); });
const choose = (label: string, value: string) => act(() => { const select = byLabel<HTMLSelectElement>(label); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
const menuRow = (label: string) => [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(row => row.textContent?.includes(label))!;

describe("W and H", () => {
  it("show the shape's size and commit a typed size once, keeping the ratio when linked", () => {
    const commit = vi.fn(), toggle = vi.fn();
    render(<SizeFields size={{ width: 50, height: 25 }} linked={false} toggleLink={toggle} commit={commit}/>);
    expect(byLabel<HTMLInputElement>("Shape width").value).toBe("50");
    type("Shape width", "1"); type("Shape width", "100"); expect(commit).not.toHaveBeenCalled(); enter("Shape width"); expect(commit).toHaveBeenLastCalledWith(100, 25);
    act(() => byLabel("Link shape width and height").click()); expect(toggle).toHaveBeenCalledTimes(1);
    render(<SizeFields size={{ width: 50, height: 25 }} linked toggleLink={toggle} commit={commit}/>);
    expect(byLabel("Link shape width and height").getAttribute("aria-pressed")).toBe("true");
    type("Shape height", "50"); enter("Shape height"); expect(commit).toHaveBeenLastCalledWith(100, 50); expect(commit).toHaveBeenCalledTimes(2);
    render(<SizeFields size={null} linked toggleLink={toggle} commit={commit}/>);
    expect(byLabel<HTMLInputElement>("Shape width").disabled).toBe(true); expect(byLabel<HTMLInputElement>("Shape width").value).toBe("0");
  });
});

describe("rectangle corner radii", () => {
  it("set all four corners together when linked and one corner at a time when not", () => {
    const change = vi.fn(), toggle = vi.fn();
    render(<CornerRadiusFields radii={[0, 0, 0, 0]} linked toggleLink={toggle} change={change}/>);
    type("Corner radius", "12"); enter("Corner radius"); expect(change).toHaveBeenLastCalledWith([12, 12, 12, 12]);
    press("Corner radii");
    type("Bottom right corner radius", "4"); enter("Bottom right corner radius"); expect(change).toHaveBeenLastCalledWith([4, 4, 4, 4]);
    render(<CornerRadiusFields radii={[4, 4, 4, 4]} linked={false} toggleLink={toggle} change={change}/>);
    type("Top right corner radius", "9"); enter("Top right corner radius"); expect(change).toHaveBeenLastCalledWith([4, 9, 4, 4]);
    act(() => byLabel("Link corner radius values").click()); expect(toggle).toHaveBeenCalled();
    render(<CornerRadiusFields radii={[4, 9, 4, 4]} linked={false} toggleLink={toggle} change={change}/>);
    expect(byLabel<HTMLInputElement>("Corner radius").value).toBe("");
  });
});

describe("shape gear", () => {
  it("offers Photoshop's Unconstrained, Square or Circle, Fixed Size, Proportional and From Center", () => {
    const change = vi.fn(), constraint = DEFAULT_VECTOR_TOOL_OPTIONS.constraint;
    render(<ShapeGear ellipse={false} constraint={constraint} change={change}/>);
    press("Shape options");
    expect(byLabel<HTMLInputElement>("Unconstrained").checked).toBe(true);
    expect(byLabel<HTMLInputElement>("Fixed width").disabled).toBe(true);
    act(() => byLabel("Square").click()); expect(change).toHaveBeenLastCalledWith({ ...constraint, kind: "square" });
    act(() => byLabel("From Center").click()); expect(change).toHaveBeenLastCalledWith({ ...constraint, fromCenter: true });
    render(<ShapeGear ellipse={false} constraint={{ ...constraint, kind: "fixedSize" }} change={change}/>);
    type("Fixed width", "640"); enter("Fixed width"); expect(change).toHaveBeenLastCalledWith({ ...constraint, kind: "fixedSize", width: 640 });
    render(<ShapeGear ellipse constraint={constraint} change={change}/>);
    expect(byLabel("Circle")).not.toBeNull(); expect(byLabel("Square")).toBeNull();
  });
});

describe("line gear", () => {
  it("sets Start and End arrowheads and their Width, Length and Concavity once each, within the host's ranges", () => {
    const change = vi.fn();
    render(<LineGear options={DEFAULT_VECTOR_TOOL_OPTIONS} change={change}/>);
    press("Line options");
    expect(byLabel<HTMLInputElement>("Start arrowhead").checked).toBe(false); expect(byLabel<HTMLInputElement>("Arrowhead width").value).toBe("500");
    act(() => byLabel("End arrowhead").click()); expect(change).toHaveBeenLastCalledWith("arrowEnd", true);
    type("Arrowhead width", "40"); expect(change).toHaveBeenCalledTimes(1); enter("Arrowhead width"); expect(change).toHaveBeenLastCalledWith("arrowWidth", 40);
    type("Arrowhead length", "9000"); enter("Arrowhead length"); expect(change).toHaveBeenLastCalledWith("arrowLength", 5000);
    type("Arrowhead concavity", "-80.4"); enter("Arrowhead concavity"); expect(change).toHaveBeenLastCalledWith("arrowConcavity", -50);
    expect(change).toHaveBeenCalledTimes(4);
  });
});

describe("path alignment", () => {
  it("runs one alignment and switches between Align To Selection and Canvas", async () => {
    const align = vi.fn(), alignTo = vi.fn();
    render(<PathAlignMenu value="selection" align={align} alignTo={alignTo}/>);
    await act(async () => byLabel("Path alignment").click());
    await act(async () => menuRow("Align right edges").click()); expect(align).toHaveBeenCalledWith("right");
    await act(async () => byLabel("Path alignment").click());
    await act(async () => menuRow("Align To Canvas").click()); expect(alignTo).toHaveBeenCalledWith("canvas");
  });
  it("keeps Align To Canvas reachable while there is nothing to align to the selection", async () => {
    const align = vi.fn(), alignTo = vi.fn();
    render(<PathAlignMenu value="selection" edgesDisabled align={align} alignTo={alignTo}/>);
    await act(async () => byLabel("Path alignment").click());
    expect(menuRow("Align left edges").getAttribute("aria-disabled") ?? String((menuRow("Align left edges") as HTMLButtonElement).disabled)).toBe("true");
    await act(async () => menuRow("Align left edges").click()); expect(align).not.toHaveBeenCalled();
    await act(async () => menuRow("Align To Canvas").click()); expect(alignTo).toHaveBeenCalledWith("canvas");
  });
});

describe("tool mode and Make", () => {
  it("offers Shape, Path and, where asked, Pixels", () => {
    const change = vi.fn(); render(<VectorModeSelect value="shape" pixels change={change}/>);
    const select = byLabel<HTMLSelectElement>("Pick tool mode");
    expect([...select.options].map(option => [option.value, option.disabled])).toEqual([["shape", false], ["path", false], ["pixels", false]]);
    choose("Pick tool mode", "path"); expect(change).toHaveBeenLastCalledWith("path");
    choose("Pick tool mode", "pixels"); expect(change).toHaveBeenLastCalledWith("pixels");
    render(<VectorModeSelect value="path" change={change}/>); expect(select.options).toHaveLength(2);
  });
  it("makes a selection, mask or shape from the path", () => {
    const make = vi.fn(); render(<MakeButtons mask make={make}/>);
    act(() => byLabel("Make selection from path").click()); act(() => byLabel("Make vector mask from path").click()); act(() => byLabel("Make shape from path").click());
    expect(make.mock.calls).toEqual([["selection"], ["mask"], ["shape"]]);
    render(<MakeButtons mask={false} make={make}/>); expect(byLabel<HTMLButtonElement>("Make vector mask from path").disabled).toBe(true);
    render(<MakeButtons disabled mask make={make}/>); expect(byLabel<HTMLButtonElement>("Make selection from path").disabled).toBe(true);
  });
});

describe("freeform pen", () => {
  it("types Curve Fit and the Magnetic options once each, within Photoshop's ranges", () => {
    const change = vi.fn(); render(<FreeformFields options={DEFAULT_VECTOR_TOOL_OPTIONS} change={change}/>);
    act(() => byLabel("Magnetic").click()); expect(change).toHaveBeenLastCalledWith("magnetic", true);
    press("Freeform pen options");
    expect(byLabel<HTMLInputElement>("Curve Fit").value).toBe("2"); expect(byLabel<HTMLInputElement>("Magnetic width").disabled).toBe(true);
    type("Curve Fit", "20"); enter("Curve Fit"); expect(change).toHaveBeenLastCalledWith("curveFit", 10);
    render(<FreeformFields options={{ ...DEFAULT_VECTOR_TOOL_OPTIONS, magnetic: true }} change={change}/>);
    type("Magnetic width", "300"); enter("Magnetic width"); expect(change).toHaveBeenLastCalledWith("magneticWidth", 256);
    type("Magnetic contrast", "40"); enter("Magnetic contrast"); expect(change).toHaveBeenLastCalledWith("magneticContrast", 40);
    type("Magnetic frequency", "80"); enter("Magnetic frequency"); expect(change).toHaveBeenLastCalledWith("magneticFrequency", 80);
    act(() => byLabel("Pen Pressure").click()); expect(change).toHaveBeenLastCalledWith("magneticPressure", true);
  });
});

describe("pen and path selection bars", () => {
  it("keeps Rubber Band in the pen gear and Auto Add/Delete on the bar", () => {
    const change = vi.fn(); render(<PenFields options={DEFAULT_VECTOR_TOOL_OPTIONS} change={change}/>);
    expect(byLabel<HTMLInputElement>("Auto Add/Delete").checked).toBe(true);
    act(() => byLabel("Auto Add/Delete").click()); expect(change).toHaveBeenLastCalledWith("autoAddDelete", false);
    press("Pen options"); expect(byLabel<HTMLInputElement>("Rubber Band").checked).toBe(false);
    act(() => byLabel("Rubber Band").click()); expect(change).toHaveBeenLastCalledWith("rubberBand", true);
  });
  it("offers the selected component's path operations without New Shape Layer, and Merge Shape Components", () => {
    const change = vi.fn(), merge = vi.fn(); render(<ComponentOpSelect value="combine" change={change} merge={merge}/>);
    const select = byLabel<HTMLSelectElement>("Path operation");
    expect([...select.options].map(option => option.textContent)).toEqual(["Combine Shapes", "Subtract Front Shape", "Intersect Shape Areas", "Exclude Overlapping Shapes", "Merge Shape Components"]);
    choose("Path operation", "exclude"); expect(change).toHaveBeenLastCalledWith("exclude");
    choose("Path operation", "merge"); expect(merge).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledTimes(1); expect(select.value).toBe("combine");
    render(<ComponentOpSelect value="combine" disabled change={change}/>); expect(select.disabled).toBe(true);
  });
  it("selects paths on the active layers or on all layers", () => {
    const change = vi.fn(); render(<SelectScopeSelect value="active" change={change}/>);
    const select = byLabel<HTMLSelectElement>("Select layers");
    expect([...select.options].map(option => option.textContent)).toEqual(["Active Layers", "All Layers"]);
    choose("Select layers", "all"); expect(change).toHaveBeenLastCalledWith("all");
  });
});
