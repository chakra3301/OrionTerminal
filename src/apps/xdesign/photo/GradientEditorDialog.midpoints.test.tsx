import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ state: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("./runtime", () => ({ runPhotoCommand: vi.fn(async () => ({})), controlsLocked: () => false, usePhotoWorkspace: Object.assign((select: (s: { state: unknown; projectId: string }) => unknown) => select({ state: store.state, projectId: "project" }), { getState: () => ({ state: store.state, projectId: "project" }) }) }));
import { GradientEditorDialog, type EditedGradient } from "./GradientEditorDialog";
import { runPhotoCommand } from "./runtime";

const presets = { gradient: { name: "Custom", stops: [], transparency: [] }, styles: [], gradients: [{ name: "Basics", presets: [{ name: "Black, White", stops: [[0, "#000000"], [1, "#ffffff"]], transparency: [] }, { name: "Bent", stops: [[0, "#000000"], [.5, "#808080"], [1, "#ffffff"]], transparency: [], midpoints: [.3, .7] }] }] };
const three: EditedGradient<string> = { stops: [[0, "#000000"], [.5, "#808080"], [1, "#ffffff"]], opacity: [], midpoints: [.25, .8] };
let root: Root, container: HTMLDivElement;
const preview = vi.fn(), choose = vi.fn(), close = vi.fn();
const render = (gradient: EditedGradient<string>) => act(() => root.render(<GradientEditorDialog gradient={gradient} hex={c => c} color={c => c} preview={preview} choose={choose} close={close}/>));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); preview.mockClear(); choose.mockClear(); close.mockClear();
  store.state = { presets, tools: { foreground: [0, 0, 0, 1], background: [1, 1, 1, 1] } };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const byLabel = <T extends HTMLElement = HTMLElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`);
const click = (element: HTMLElement | null) => act(() => element!.click());
const type = (input: HTMLInputElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const pointer = (target: Element, kind: string, clientX: number, clientY = 8) => act(() => { target.dispatchEvent(new MouseEvent(kind, { bubbles: true, button: 0, clientX, clientY })); });
const press = (target: Element, key: string, shiftKey = false) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })); });
const strip = () => { const element = byLabel("Color stops")!; element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 16, right: 200, bottom: 16, x: 0, y: 0, toJSON() {} }); return element; };
const diamonds = () => [...byLabel("Color stops")!.querySelectorAll<HTMLElement>(".xd-ge-midpoint")].map(diamond => [diamond.getAttribute("aria-label"), diamond.style.left]);
const lastMidpoints = () => (preview.mock.lastCall![0] as EditedGradient<string>).midpoints;

describe("Gradient Editor colour midpoints", () => {
  it("shows the diamonds beside the selected colour stop; a selected diamond's Location is its share of the segment", () => {
    render(three);
    expect(diamonds()).toEqual([]);
    click(byLabel("Color stop 2"));
    expect(diamonds()).toEqual([["Color midpoint 1", "12.5%"], ["Color midpoint 2", "90%"]]);
    click(byLabel("Color midpoint 1"));
    expect(byLabel("Color midpoint 1")!.getAttribute("aria-pressed")).toBe("true");
    expect(diamonds().map(([label]) => label)).toEqual(["Color midpoint 1", "Color midpoint 2"]);
    const location = byLabel<HTMLInputElement>("Color midpoint location")!;
    expect(location.value).toBe("25");
    expect(byLabel<HTMLButtonElement>("Stop color")!.disabled).toBe(true);
    expect(byLabel<HTMLButtonElement>("Delete color stop")!.disabled).toBe(true);
    type(location, "40");
    expect(preview).toHaveBeenLastCalledWith({ stops: three.stops, opacity: [], midpoints: [.4, .8] });
    type(location, "99");
    expect(lastMidpoints()).toEqual([.95, .8]);
    click(document.querySelector<HTMLElement>('[role=dialog][aria-label="Gradient Editor"] .xd-ps-dialog-buttons button'));
    expect(choose).toHaveBeenCalledWith({ stops: three.stops, opacity: [], midpoints: [.95, .8] }, "Custom");
  });

  it("drags a diamond along its segment without adding a stop, and arrow keys nudge it", () => {
    render(three); const colors = strip();
    click(byLabel("Color stop 3"));
    const diamond = byLabel("Color midpoint 2")!;
    pointer(diamond, "pointerdown", 180); pointer(diamond, "pointermove", 150);
    expect(lastMidpoints()).toEqual([.25, .5]);
    pointer(diamond, "pointermove", 200); pointer(diamond, "pointerup", 200);
    expect(lastMidpoints()).toEqual([.25, .95]);
    expect(colors.querySelectorAll(".xd-ge-stop")).toHaveLength(3);
    press(byLabel("Color midpoint 2")!, "ArrowLeft");
    expect(lastMidpoints()).toEqual([.25, .94]);
    press(byLabel("Color midpoint 2")!, "ArrowLeft", true);
    expect(lastMidpoints()).toEqual([.25, .84]);
  });

  it("keeps each midpoint with the stop before it as stops move, go or come, and resets them for a preset", () => {
    render(three); const colors = strip();
    click(byLabel("Color stop 1")); type(byLabel<HTMLInputElement>("Color stop location")!, "75");
    expect(preview).toHaveBeenLastCalledWith({ stops: [[.5, "#808080"], [.75, "#000000"], [1, "#ffffff"]], opacity: [], midpoints: [.8, .25] });
    click(byLabel("Delete color stop"));
    expect(preview).toHaveBeenLastCalledWith({ stops: [[.5, "#808080"], [1, "#ffffff"]], opacity: [], midpoints: [.8] });
    pointer(colors, "pointerdown", 150); pointer(colors, "pointerup", 150);
    expect(lastMidpoints()).toEqual([]);
    click(byLabel("Color stop 1")); click(byLabel("Color midpoint 1")); type(byLabel<HTMLInputElement>("Color midpoint location")!, "20");
    expect(lastMidpoints()).toEqual([.2, .5]);
    click([...document.querySelectorAll<HTMLElement>(".xd-ge-folder")].find(folder => folder.textContent === "Basics")!); click(byLabel("Black, White"));
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0, "#000000"], [1, "#ffffff"]], opacity: [], midpoints: [] });
  });

  it("saves the midpoints with New and takes a saved gradient's own midpoints when it is picked", () => {
    render(three);
    click([...document.querySelectorAll<HTMLButtonElement>(".xd-ge-line button")].find(button => button.textContent === "New")!);
    expect(runPhotoCommand).toHaveBeenLastCalledWith("gradient.presets.new", { name: "Custom", stops: three.stops, transparency: [[0, 100], [1, 100]], midpoints: [.25, .8] });
    click([...document.querySelectorAll<HTMLElement>(".xd-ge-folder")].find(folder => folder.textContent === "Basics")!); click(byLabel("Bent"));
    expect(preview).toHaveBeenLastCalledWith({ stops: three.stops, opacity: [], midpoints: [.3, .7] });
    click(byLabel("Black, White"));
    expect(lastMidpoints()).toEqual([]);
    click([...document.querySelectorAll<HTMLButtonElement>(".xd-ge-line button")].find(button => button.textContent === "New")!);
    expect(runPhotoCommand).toHaveBeenLastCalledWith("gradient.presets.new", { name: "Black, White", stops: [[0, "#000000"], [1, "#ffffff"]], transparency: [[0, 100], [1, 100]] });
  });

  it("shows no diamonds where the gradient keeps no midpoints, as on Gradient Map's gradients", () => {
    render({ stops: three.stops, opacity: [] });
    click(byLabel("Color stop 2"));
    expect(diamonds()).toEqual([]);
    expect(byLabel("Color midpoint location")).toBeNull();
    type(byLabel<HTMLInputElement>("Color stop location")!, "40");
    expect(preview.mock.lastCall![0]).not.toHaveProperty("midpoints");
    click([...document.querySelectorAll<HTMLElement>(".xd-ge-folder")].find(folder => folder.textContent === "Basics")!); click(byLabel("Bent"));
    expect(preview.mock.lastCall![0]).not.toHaveProperty("midpoints");
  });
});
