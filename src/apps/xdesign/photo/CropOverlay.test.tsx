import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CropOverlay, cropAddedCanvas, type CropBox } from "./CropOverlay";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const BOX: CropBox = { x: 100, y: 100, width: 200, height: 100 };
// The svg spans 800 × 600 screen pixels for an 800 × 600 image, so client coordinates are image pixels.
function resize(handle: string, from: [number, number], to: [number, number], props: { ratio?: number } = {}, keys: { shiftKey?: boolean; altKey?: boolean } = {}) {
  const change = vi.fn();
  act(() => root.render(<CropOverlay width={800} height={600} zoom={1} box={BOX} change={change} {...props} />));
  const svg = container.querySelector<SVGSVGElement>("svg")!;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  svg.setPointerCapture = vi.fn(); svg.hasPointerCapture = () => false;
  act(() => { container.querySelector(`[aria-label="Crop handle ${handle}"]`)!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: from[0], clientY: from[1] })); });
  act(() => { svg.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: to[0], clientY: to[1], ...keys })); });
  return change.mock.lastCall?.[0];
}

describe("CropOverlay handle drags", () => {
  it("resize freely without a ratio", () => {
    expect(resize("bottom right", [300, 200], [400, 220])).toEqual({ x: 100, y: 100, width: 300, height: 120 });
  });
  it("hold a set ratio from the opposite corner, as Photoshop does", () => {
    expect(resize("bottom right", [300, 200], [400, 220], { ratio: 2 })).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    expect(resize("top left", [100, 100], [80, 100], { ratio: 2 })).toEqual({ x: 80, y: 90, width: 220, height: 110 });
  });
  it("grow the other side about the centre when a side handle is dragged with a ratio", () => {
    expect(resize("right", [300, 150], [340, 150], { ratio: 2 })).toEqual({ x: 100, y: 90, width: 240, height: 120 });
  });
  it("keep the box's own shape while Shift is held", () => {
    expect(resize("bottom right", [300, 200], [400, 220], {}, { shiftKey: true })).toEqual({ x: 100, y: 100, width: 300, height: 150 });
  });
  it("resize from the centre while Option is held", () => {
    expect(resize("right", [300, 150], [340, 150], {}, { altKey: true })).toEqual({ x: 60, y: 100, width: 280, height: 100 });
  });
});

describe("cropAddedCanvas", () => {
  it("is null while the box stays on the image, straight or rotated", () => {
    expect(cropAddedCanvas({ x: 100, y: 50, width: 200, height: 200 }, 0, 800, 600)).toBeNull();
    expect(cropAddedCanvas({ x: 0, y: 0, width: 800, height: 600 }, 0, 800, 600)).toBeNull();
    expect(cropAddedCanvas({ x: 100, y: 50, width: 200, height: 200 }, 90, 800, 600)).toBeNull();
  });
  it("gives the image's corners in the cropped canvas once the box reaches past it", () => {
    expect(cropAddedCanvas({ x: 50, y: -20, width: 600, height: 600 }, 0, 800, 600)).toEqual([[-50, 20], [750, 20], [750, 620], [-50, 620]]);
    expect(cropAddedCanvas({ x: 0, y: 0, width: 800, height: 600 }, 90, 800, 600)).toEqual([[100, 700], [100, -100], [700, -100], [700, 700]]);
  });
});
