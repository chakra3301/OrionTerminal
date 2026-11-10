import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESIGN_TOOL_GROUPS, IMAGE_TOOL_GROUPS } from "./editorTools";

let chrome: typeof import("./EditorChrome"), root: Root, container: HTMLDivElement;
let availableWidth = 1100;
const measurements = new Set<() => void>();
function Panels() {
  const panels = chrome.useEditorPanels();
  return <section><chrome.PanelToggles panels={panels}/><div ref={panels.body} data-overlay={panels.overlay}>
    <aside id={panels.leftId} hidden={!panels.left} style={{ width: panels.leftWidth }}><chrome.PanelResize side="left" panels={panels}/></aside>
    <canvas aria-label="Persistent canvas"/>
    <aside id={panels.rightId} hidden={!panels.right} style={{ width: panels.rightWidth }}><chrome.PanelResize side="right" panels={panels}/></aside>
  </div></section>;
}
function Tools() {
  const [active, select] = useState("SELECT");
  return <><chrome.EditorToolRail groups={DESIGN_TOOL_GROUPS} active={active} select={select} label="Design tools"/><button onClick={() => select("STAR")}>Keyboard star</button></>;
}
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (element: HTMLElement) => act(() => element.click());
const key = (element: HTMLElement, value: string, shiftKey = false) => act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })));
function measure(width: number) { act(() => { availableWidth = width; for (const callback of measurements) callback(); }); }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetModules(); localStorage.clear(); availableWidth = 1100; measurements.clear();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe(element: HTMLElement) { Object.defineProperty(element, "clientWidth", { configurable: true, get: () => availableWidth }); measurements.add(this.callback); this.callback(); }
    disconnect() { measurements.delete(this.callback); }
  });
  chrome = await import("./EditorChrome");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("XDesign editor layout", () => {
  it("adapts to the editor width and respects an explicit panel choice in smaller windows", () => {
    act(() => root.render(<Panels/>));
    expect(button("Hide layers panel").getAttribute("aria-expanded")).toBe("true");
    measure(840); expect(button("Show layers panel")).toBeTruthy(); expect(button("Hide properties panel")).toBeTruthy();
    measure(620); expect(button("Show properties panel")).toBeTruthy();
    expect(container.querySelector("[data-overlay]")?.getAttribute("data-overlay")).toBe("true");
    click(button("Show layers panel")); measure(1100); measure(620);
    expect(button("Hide layers panel")).toBeTruthy(); expect(button("Show properties panel")).toBeTruthy();
  });
  it("keeps the canvas mounted and shares panel preferences between Design and Image layouts", () => {
    act(() => root.render(<><Panels/><Panels/></>));
    const canvases = [...container.querySelectorAll("canvas")];
    click(button("Hide layers panel"));
    expect(container.querySelectorAll('button[aria-label="Show layers panel"]')).toHaveLength(2);
    expect([...container.querySelectorAll("canvas")]).toEqual(canvases);
    expect(JSON.parse(localStorage.getItem("xd-editor-panels-v1")!).left).toBe(false);
  });
  it("resizes with the keyboard in the correct direction and bounds widths to preserve canvas space", () => {
    act(() => root.render(<Panels/>));
    const handle = container.querySelector<HTMLElement>('[aria-label="Resize properties panel"]')!;
    key(handle, "ArrowLeft"); expect(handle.getAttribute("aria-valuenow")).toBe("282");
    key(handle, "ArrowRight", true); expect(handle.getAttribute("aria-valuenow")).toBe("242");
    key(handle, "Home"); expect(handle.getAttribute("aria-valuenow")).toBe("220");
    key(handle, "End"); expect(handle.getAttribute("aria-valuenow")).toBe("360");
    measure(840); expect(Number(handle.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(Number(handle.getAttribute("aria-valuemax")));
    const saved = JSON.parse(localStorage.getItem("xd-editor-panels-v1")!);
    expect(saved.rightWidth).toBe(360);
  });
  it("drags panel boundaries and restores their default width on double-click", () => {
    act(() => root.render(<Panels/>));
    const handle = container.querySelector<HTMLElement>('[aria-label="Resize layers panel"]')!;
    handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => true; handle.releasePointerCapture = vi.fn();
    const pointer = (name: string, x: number) => act(() => { const event = new MouseEvent(name, { button: 0, clientX: x, bubbles: true }); Object.defineProperty(event, "pointerId", { value: 1 }); handle.dispatchEvent(event); });
    pointer("pointerdown", 200); pointer("pointermove", 260); pointer("pointerup", 260);
    expect(handle.getAttribute("aria-valuenow")).toBe("284"); expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    act(() => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(handle.getAttribute("aria-valuenow")).toBe("224");
  });
  it("restores a stored layout with validated panel widths", async () => {
    localStorage.setItem("xd-editor-panels-v1", JSON.stringify({ left: false, right: true, leftWidth: 2000, rightWidth: -20 }));
    vi.resetModules(); chrome = await import("./EditorChrome");
    act(() => root.render(<Panels/>));
    expect(button("Show layers panel")).toBeTruthy();
    expect(container.querySelector('[aria-label="Resize layers panel"]')?.getAttribute("aria-valuenow")).toBe("360");
    expect(container.querySelector('[aria-label="Resize properties panel"]')?.getAttribute("aria-valuenow")).toBe("220");
  });
});
describe("XDesign grouped tools and menus", () => {
  it("activates every shape variant and remembers variants chosen by a keyboard shortcut", () => {
    act(() => root.render(<Tools/>));
    click(button("Choose shape tools"));
    click([...container.querySelectorAll<HTMLButtonElement>("[role=menu] > button")].find(element => element.textContent === "Polygon")!);
    expect(button("Polygon").getAttribute("aria-pressed")).toBe("true");
    click(button("Move")); click(button("Polygon")); expect(button("Polygon").getAttribute("aria-pressed")).toBe("true");
    click([...container.querySelectorAll("button")].find(element => element.textContent === "Keyboard star")!);
    click(button("Move")); click(button("Star")); expect(button("Star").getAttribute("aria-pressed")).toBe("true");
  });
  it("opens a group on press-and-hold, chooses the row the press is released on, and closes from its triangle", () => {
    vi.useFakeTimers();
    try {
      act(() => root.render(<Tools/>));
      const pointer = (element: Element, type: string) => act(() => { element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })); });
      const menu = () => container.querySelector("[role=menu]");
      pointer(button("Rectangle"), "pointerdown");
      act(() => { vi.advanceTimersByTime(399); });
      expect(menu()).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      pointer([...container.querySelectorAll("[role=menu] > button")].find(element => element.textContent === "Polygon")!, "pointerup");
      expect(button("Polygon").getAttribute("aria-pressed")).toBe("true");
      expect(menu()).toBeNull();
      const triangle = button("Choose shape tools");
      pointer(triangle, "pointerdown"); click(triangle);
      expect(menu()).toBeTruthy();
      pointer(triangle, "pointerdown"); click(triangle);
      expect(menu()).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("keeps all image tools reachable in their groups", () => {
    act(() => root.render(<chrome.EditorToolRail groups={IMAGE_TOOL_GROUPS} active="paint.stroke" select={() => {}} label="Image tools"/>));
    const rows = [...container.querySelectorAll(".xd-editor-tool-button")].map(tool => tool.getAttribute("aria-label"));
    for (const flyout of container.querySelectorAll<HTMLButtonElement>(".xd-editor-tool-flyout")) { click(flyout); rows.push(...[...container.querySelectorAll("[role=menu] > button")].map(row => row.textContent)); }
    const tools = IMAGE_TOOL_GROUPS.flatMap(group => group.tools);
    for (const id of ["paint.pencil", "paint.mixerBrush", "paint.colorReplacement", "paint.cloneStamp", "paint.healingBrush", "paint.spotHealing", "paint.dodge", "paint.burn", "paint.sponge", "paint.blur", "paint.sharpen", "paint.smudge", "paint.gradient", "paint.bucket", "select.rect", "select.lasso", "select.magicWand", "straighten"]) expect(rows).toContain(tools.find(tool => tool.id === id)!.label);
    for (const name of ["Move Tool", "Horizontal Type Tool", "Crop Tool", "Eraser Tool"]) expect(button(name)).toBeTruthy();
  });
});
