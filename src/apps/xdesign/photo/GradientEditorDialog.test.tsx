import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ state: null as unknown }));
const run = vi.hoisted(() => vi.fn(async (_command: string, _params?: Record<string, unknown>) => ({})));
const files = vi.hoisted(() => ({ open: vi.fn(async () => "/tmp/mine.grd" as string | null) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: files.open }));
vi.mock("./runtime", () => ({ runPhotoCommand: run, controlsLocked: () => false, usePhotoWorkspace: Object.assign((select: (s: { state: unknown; projectId: string }) => unknown) => select({ state: store.state, projectId: "project" }), { getState: () => ({ state: store.state, projectId: "project" }) }) }));
import { GradientEditorDialog } from "./GradientEditorDialog";

type C = { mode: string; c: number[]; alpha: number };
const black: C = { mode: "Rgb", c: [0, 0, 0, 0], alpha: 1 }, white: C = { mode: "Rgb", c: [1, 1, 1, 0], alpha: 1 };
const hex = (color: C) => `#${color.c.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
const color = (value: string, from?: C): C => ({ mode: "Rgb", c: [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255).concat(0), alpha: from?.alpha ?? 1 });
const presets = { gradient: { name: "Custom", stops: [], transparency: [] }, styles: [], gradients: [
  { name: "Basics", presets: [{ name: "Foreground to Transparent", stops: [[0, "foreground"], [1, "foreground"]], transparency: [[0, 100], [1, 0]] }, { name: "Black, White", stops: [[0, "#000000"], [1, "#ffffff"]], transparency: [[0, 100], [1, 100]] }] },
  { name: "Blues", presets: [{ name: "Blue 1", stops: [[0, "#0000ff"], [1, "#00ffff"]], transparency: [] }] },
] };

let root: Root, container: HTMLDivElement;
const preview = vi.fn(), choose = vi.fn(), close = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); run.mockClear(); preview.mockClear(); choose.mockClear(); close.mockClear();
  store.state = { presets, tools: { foreground: [1, 0, 0, 1], background: [1, 1, 1, 1] } };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root.render(<GradientEditorDialog gradient={{ stops: [[0, black], [1, white]], opacity: [] }} hex={hex} color={color} preview={preview} choose={choose} close={close}/>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const byLabel = <T extends HTMLElement = HTMLElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`)!;
const editor = () => document.querySelector<HTMLElement>('[role=dialog][aria-label="Gradient Editor"]')!;
const button = (text: string, within: ParentNode = editor()) => [...within.querySelectorAll("button")].find(b => b.textContent === text)!;
const click = (element: HTMLElement) => act(() => element.click());
const type = (input: HTMLInputElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const pointer = (target: Element, kind: string, clientX: number, clientY: number) => act(() => { target.dispatchEvent(new MouseEvent(kind, { bubbles: true, button: 0, clientX, clientY })); });
const press = (target: Element, key: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const strip = (label: string) => { const element = byLabel(label); element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 16, right: 200, bottom: 16, x: 0, y: 0, toJSON() {} }); return element; };

describe("GradientEditorDialog", () => {
  it("lays out Photoshop's Gradient Editor with no stop selected", () => {
    expect(editor()).toBeTruthy();
    expect([...editor().querySelectorAll(".xd-ps-dialog-buttons button")].map(b => b.textContent)).toEqual(["OK", "Cancel", "Import…", "Export…"]);
    expect(button("Export…").disabled).toBe(true);
    expect(byLabel<HTMLInputElement>("Gradient name").value).toBe("Custom");
    expect(button("New")).toBeTruthy();
    const kind = byLabel<HTMLSelectElement>("Gradient Type");
    expect(kind.value).toBe("Solid"); expect([...kind.options].find(option => option.text === "Noise")!.disabled).toBe(true);
    expect([...editor().querySelectorAll("[aria-expanded]")].filter(b => b.closest(".xd-ge-presets")).map(b => [b.textContent, b.getAttribute("aria-expanded")])).toEqual([["Basics", "false"], ["Blues", "false"]]);
    expect(byLabel("Opacity stops").querySelectorAll("[role=button]")).toHaveLength(2);
    expect(byLabel("Color stops").querySelectorAll("[role=button]")).toHaveLength(2);
    expect(byLabel<HTMLButtonElement>("Stop color").disabled).toBe(true);
    expect(byLabel<HTMLInputElement>("Stop opacity").disabled).toBe(true);
  });

  it("previews a colour stop's new Location live and commits the gradient once on OK", () => {
    click(byLabel("Color stop 2"));
    const location = byLabel<HTMLInputElement>("Color stop location");
    expect(location.disabled).toBe(false); expect(location.value).toBe("100");
    type(location, "60");
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0, black], [0.6, white]], opacity: [] });
    expect(choose).not.toHaveBeenCalled();
    click(button("OK"));
    expect(choose).toHaveBeenCalledOnce(); expect(choose).toHaveBeenCalledWith({ stops: [[0, black], [0.6, white]], opacity: [] }, "Custom");
  });

  it("Cancel closes without committing", () => {
    click(byLabel("Color stop 2")); type(byLabel("Color stop location"), "60");
    click(button("Cancel"));
    expect(close).toHaveBeenCalled(); expect(choose).not.toHaveBeenCalled();
  });

  it("adds a colour stop where you click under the bar, and deletes it when dragged down off the bar", () => {
    const colors = strip("Color stops");
    pointer(colors, "pointerdown", 100, 8); pointer(colors, "pointerup", 100, 8);
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0, black], [0.5, color("#808080")], [1, white]], opacity: [] });
    expect(byLabel("Color stop 2").getAttribute("aria-pressed")).toBe("true");
    pointer(byLabel("Color stop 2"), "pointerdown", 100, 8); pointer(colors, "pointermove", 100, 60); pointer(colors, "pointerup", 100, 60);
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0, black], [1, white]], opacity: [] });
    click(byLabel("Color stop 1"));
    expect(byLabel<HTMLButtonElement>("Delete color stop").disabled).toBe(true);
  });

  it("adds an opacity stop where you click above the bar and previews its Opacity", () => {
    const opacity = strip("Opacity stops");
    pointer(opacity, "pointerdown", 50, 8); pointer(opacity, "pointerup", 50, 8);
    expect(byLabel("Opacity stop 2").getAttribute("aria-pressed")).toBe("true");
    type(byLabel("Stop opacity"), "40");
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0, black], [1, white]], opacity: [[0, 1], [0.25, 0.4], [1, 1]] });
  });

  it("draws opacity stops black when opaque and white when clear, as Photoshop does", () => {
    const square = (n: number) => byLabel(`Opacity stop ${n}`).querySelector("rect")!.getAttribute("fill");
    expect(square(1)).toBe("rgb(0,0,0)");
    click(byLabel("Opacity stop 2")); type(byLabel("Stop opacity"), "0");
    expect(square(2)).toBe("rgb(255,255,255)");
  });

  it("keeps keyboard focus on a stop an arrow key moves past its neighbour", () => {
    click(byLabel("Color stop 2")); type(byLabel("Color stop location"), "0.5");
    const first = byLabel("Color stop 1"); act(() => first.focus());
    press(first, "ArrowRight");
    expect(document.activeElement).toBe(byLabel("Color stop 2"));
    expect(byLabel("Color stop 2").getAttribute("aria-pressed")).toBe("true");
    press(document.activeElement!, "ArrowRight");
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0.005, white], [0.02, black]], opacity: [] });
  });

  it("moves keyboard focus to the previous stop after Delete", () => {
    const colors = strip("Color stops");
    pointer(colors, "pointerdown", 100, 8); pointer(colors, "pointerup", 100, 8);
    const middle = byLabel("Color stop 2"); act(() => middle.focus());
    press(middle, "Delete");
    expect(byLabel("Color stops").querySelectorAll("[role=button]")).toHaveLength(2);
    expect(document.activeElement).toBe(byLabel("Color stop 1"));
  });

  it("lets a stop's Location be emptied while typing", () => {
    click(byLabel("Color stop 2"));
    const location = byLabel<HTMLInputElement>("Color stop location");
    type(location, ""); expect(location.value).toBe("");
    type(location, "75");
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0, black], [0.75, white]], opacity: [] });
  });

  it("opens the Color Picker from the Color swatch, previewing the stop's colour live and keeping it on OK", async () => {
    click(byLabel("Color stop 1")); click(byLabel("Stop color"));
    const picker = document.querySelector<HTMLElement>('[role=dialog][aria-label="Color Picker (Stop Color)"]')!;
    const field = picker.querySelector<HTMLInputElement>('[aria-label="Hex color"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "FF8000"); field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0, color("#ff8000")], [1, white]], opacity: [] });
    click(button("OK", picker));
    expect(document.querySelector('[aria-label="Color Picker (Stop Color)"]')).toBeNull();
    click(button("OK"));
    expect(choose).toHaveBeenCalledWith({ stops: [[0, color("#ff8000")], [1, white]], opacity: [] }, "Custom");
  });

  it("uses a preset's stops and name, and New saves the gradient under the typed name", () => {
    click(button("Basics")); click(byLabel("Foreground to Transparent"));
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0, color("#ff0000")], [1, color("#ff0000")]], opacity: [[0, 1], [1, 0]] });
    expect(byLabel<HTMLInputElement>("Gradient name").value).toBe("Foreground to Transparent");
    type(byLabel("Gradient name"), "Mine"); click(button("New"));
    expect(run).toHaveBeenCalledWith("gradient.presets.new", { name: "Mine", stops: [[0, "#ff0000"], [1, "#ff0000"]], transparency: [[0, 100], [1, 0]] });
  });

  it("has no opacity stops for a gradient without transparency, as Gradient Map's editor in Photoshop", () => {
    act(() => root.render(<GradientEditorDialog key="opaque" transparency={false} gradient={{ stops: [[0, black], [1, white]], opacity: [] }} hex={hex} color={color} preview={preview} choose={choose} close={close}/>));
    expect(document.querySelector('[aria-label="Opacity stops"]')).toBeNull();
    expect(byLabel("Color stops").querySelectorAll("[role=button]")).toHaveLength(2);
    expect(byLabel<HTMLInputElement>("Stop opacity").disabled).toBe(true);
    click(button("Basics")); click(byLabel("Foreground to Transparent"));
    expect(preview).toHaveBeenLastCalledWith({ stops: [[0, color("#ff0000")], [1, color("#ff0000")]], opacity: [] });
  });

  it("offers Photoshop's presets gear menu and imports .grd files", async () => {
    click(byLabel("Preset options"));
    expect([...document.querySelectorAll("[role=menu] [role^=menuitem]")].map(item => item.textContent)).toEqual(["Text Only", "Small Thumbnail", "Large Thumbnail", "Small List", "Large List", "Append Default Gradients…", "Import Gradients…", "Export Selected Gradients…"]);
    click([...document.querySelectorAll<HTMLElement>("[role=menu] [role^=menuitem]")].find(item => item.textContent === "Append Default Gradients…")!);
    expect(run).toHaveBeenCalledWith("gradient.presets.reset", { append: true });
    await act(async () => button("Import…").click());
    expect(run).toHaveBeenCalledWith("gradient.presets.importGrd", { path: "/tmp/mine.grd" });
  });
});
