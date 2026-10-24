import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilterThumbnail } from "./FilterThumbnail";

let root: Root, container: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = () => act(async () => root.render(<FilterThumbnail src="p.png" width={400} height={200} label="Gaussian Blur"/>));
const image = () => container.querySelector("img")!;
const click = (label: string) => act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
const pointer = (type: string, x: number, y: number) => act(async () => { const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }); Object.assign(event, { pointerId: 1 }); container.querySelector(".xd-photo-filter-thumbnail-frame")!.dispatchEvent(event); });

describe("filter dialog thumbnail", () => {
  it("starts at 100% and steps the zoom", async () => {
    await render();
    expect(container.textContent).toContain("100%");
    expect(image().style.width).toBe("400px");
    await click("Zoom in"); expect(container.textContent).toContain("200%"); expect(image().style.width).toBe("800px");
    await click("Zoom out"); await click("Zoom out"); expect(container.textContent).toContain("50%");
  });

  it("stops at the smallest and largest zoom", async () => {
    await render();
    for (let i = 0; i < 12; i++) await click("Zoom out");
    expect(container.querySelector<HTMLButtonElement>("[aria-label='Zoom out']")!.disabled).toBe(true);
    for (let i = 0; i < 20; i++) await click("Zoom in");
    expect(container.textContent).toContain("1600%");
    expect(container.querySelector<HTMLButtonElement>("[aria-label='Zoom in']")!.disabled).toBe(true);
  });

  it("pans by dragging", async () => {
    await render();
    const before = image().style.transform;
    await pointer("pointerdown", 50, 50); await pointer("pointermove", 30, 40); await pointer("pointerup", 30, 40);
    expect(image().style.transform).not.toBe(before);
    const [x, y] = image().style.transform.match(/-?[\d.]+/g)!.map(Number);
    expect(x).toBeCloseTo(-156, 3); expect(y).toBeCloseTo(-46, 3);
  });
});
