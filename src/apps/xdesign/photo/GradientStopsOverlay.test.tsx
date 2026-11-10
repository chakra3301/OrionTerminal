import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GradientStopsOverlay } from "./GradientStopsOverlay";
import type { GradientFill } from "./types";

const fill: GradientFill = { style: "linear", angle: 0, scale: 100, offset: [0, 0], reverse: false, dither: false, align: true, from: [100, 100], to: [300, 100], stops: [[0, "#ff0000"], [.5, "#00ff00"], [1, "#0000ff"]], transparency: [], midpoints: [.25] };
const commit = vi.fn(async (_id: string, _params: Record<string, unknown>) => undefined);
let root: Root, container: HTMLDivElement;
const render = (disabled = false) => act(() => root.render(<div className="xd-photo"><GradientStopsOverlay width={800} height={600} zoom={1} fill={fill} layer={4} disabled={disabled} commit={commit}/></div>));
const q = <T extends Element = Element>(selector: string) => container.querySelector<T>(selector)!;
const line = () => q<SVGLineElement>('[aria-label="Gradient line"]');
const fire = async (target: Element, type: string, [clientX, clientY]: [number, number], button = 0) => { await act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX, clientY })); }); };
const gesture = async (points: [number, number][]) => { await fire(line(), "pointerdown", points[0]!); for (const point of points.slice(1)) await fire(q("svg"), "pointermove", point); await fire(q("svg"), "pointerup", points.at(-1)!); };
const stopEdit = (params: Record<string, unknown>) => ["gradient.fill.stop", { layer: 4, kind: "color", ...params }];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); commit.mockClear();
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Live Gradient stops on the canvas", () => {
  it("draws the line with each colour stop in its colour and a diamond at each midpoint", () => {
    render();
    expect(["Color stop 1", "Color stop 2", "Color stop 3"].map(label => { const stop = q(`[aria-label="${label}"]`); return [stop.getAttribute("cx"), stop.getAttribute("fill")]; })).toEqual([["100", "#ff0000"], ["200", "#00ff00"], ["300", "#0000ff"]]);
    expect(q('[aria-label="Color midpoint 1"]').getAttribute("d")).toBe("M125 95L130 100L125 105L120 100Z");
    expect(q('[aria-label="Color midpoint 2"]')).not.toBeNull();
  });

  it("adds a stop where the line is clicked, in one gradient.fill.stop", async () => {
    render();
    await gesture([[160, 102], [161, 102]]);
    expect(commit.mock.calls).toEqual([stopEdit({ action: "add", location: .3 })]);
  });

  it("moves a dragged stop, showing it on the way, and removes a stop dragged off the line", async () => {
    render();
    await fire(line(), "pointerdown", [200, 100]); await fire(q("svg"), "pointermove", [250, 104]);
    expect(q('[aria-label="Color stop 2"]').getAttribute("cx")).toBe("250");
    await fire(q("svg"), "pointerup", [250, 104]);
    await fire(line(), "pointerdown", [300, 100]); await fire(q("svg"), "pointermove", [300, 140]);
    expect(q('[aria-label="Color stop 3"]').getAttribute("class")).toContain("is-leaving");
    await fire(q("svg"), "pointerup", [300, 140]);
    await gesture([[125, 100], [175, 100]]);
    expect(commit.mock.calls).toEqual([stopEdit({ action: "move", index: 1, location: .75 }), stopEdit({ action: "delete", index: 2 }), stopEdit({ action: "midpoint", index: 0, location: .75 })]);
  });

  it("recolors a stop from the Color Picker on a double-click or a right-click, in one command", async () => {
    render();
    await fire(line(), "dblclick", [300, 100]);
    const picker = document.querySelector<HTMLElement>('.xd-photo [role=dialog][aria-label="Color Picker (Stop Color)"]')!;
    const hex = picker.querySelector<HTMLInputElement>('[aria-label="Hex color"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(hex, "123456"); hex.dispatchEvent(new Event("input", { bubbles: true })); hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await act(async () => [...picker.querySelectorAll("button")].find(button => button.textContent === "OK")!.click());
    expect(commit.mock.calls).toEqual([stopEdit({ action: "color", index: 2, color: "#123456" })]);
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 100 });
    await act(async () => { line().dispatchEvent(menu); });
    expect(menu.defaultPrevented).toBe(true);
    const again = document.querySelector<HTMLElement>('[aria-label="Color Picker (Stop Color)"]')!;
    await act(async () => [...again.querySelectorAll("button")].find(button => button.textContent === "OK")!.click());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[aria-label="Color Picker (Stop Color)"]')).toBeNull();
  });

  it("does nothing for a click on a stop, a drag along the line, or any press while busy", async () => {
    render();
    await gesture([[200, 100], [202, 101]]);
    await gesture([[160, 100], [190, 100]]);
    render(true);
    await gesture([[160, 102], [161, 102]]);
    await gesture([[200, 100], [250, 100]]);
    await fire(line(), "dblclick", [300, 100]);
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Color Picker (Stop Color)"]')).toBeNull();
  });
});
