import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MatrixCanvas } from "./MatrixCanvas";

const activity = vi.hoisted(() => ({ active: false }));
vi.mock("@/components/effects/useVisualActivity", () => ({
  useVisualActivity: () => ({ ref: useRef(null), active: activity.active }),
}));
vi.mock("@/shell/store/useShell", () => ({ useShell: () => false }));
let root: Root, host: HTMLDivElement;
const ctx = { fillRect: vi.fn(), fillText: vi.fn(), setTransform: vi.fn(), fillStyle: "", shadowColor: "", shadowBlur: 0, font: "", textBaseline: "" };
const schedule = vi.fn(() => 7), cancel = vi.fn(), disconnect = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  activity.active = false; vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", schedule); vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 180 } as DOMRect);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("paints a settled reduced-motion frame sized to its container, not the viewport", async () => {
  await act(async () => root.render(<MatrixCanvas hue={140} preview />));
  expect(ctx.fillText).toHaveBeenCalled(); expect(schedule).not.toHaveBeenCalled();
  const canvas = host.querySelector("canvas")!;
  expect(canvas.width).toBe(Math.round(320 * Math.min(2, Math.max(1, window.devicePixelRatio || 1))));
  expect(canvas.style.width).toBe("100%");
});
it("repaints changed colors even while animation is paused", async () => {
  await act(async () => root.render(<MatrixCanvas hue={140} preview />));
  const before = ctx.fillText.mock.calls.length;
  await act(async () => root.render(<MatrixCanvas hue={260} preview />));
  expect(ctx.fillText.mock.calls.length).toBeGreaterThan(before);
  expect(ctx.shadowColor).toContain("260"); expect(schedule).not.toHaveBeenCalled();
});
it("cancels motion and observers when visibility pauses the renderer", async () => {
  activity.active = true;
  await act(async () => root.render(<MatrixCanvas hue={140} />));
  expect(schedule).toHaveBeenCalledTimes(1);
  activity.active = false;
  await act(async () => root.render(<MatrixCanvas hue={140} />));
  expect(cancel).toHaveBeenCalledWith(7); expect(disconnect).toHaveBeenCalled();
  expect(schedule).toHaveBeenCalledTimes(1);
});
