import { act } from "react";
import { createRoot } from "react-dom/client";
import { Search } from "lucide-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DockIcon } from "./DockIcon";
import { RosieOrb } from "./RosieOrb";
import { drawIcon } from "./iconCanvas";
import { drawOrb } from "./orbCanvas";

vi.mock("./iconCanvas", () => ({
  canvas: () => document.createElement("canvas"),
  loadMask: vi.fn(async () => ({})), prep: vi.fn(() => ({})), drawIcon: vi.fn(),
}));
vi.mock("./orbCanvas", () => ({ drawOrb: vi.fn() }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, now: number, sequence: number;
let frames: Map<number, FrameRequestCallback>;
let hidden: boolean;
beforeEach(() => {
  now = 0; sequence = 0; frames = new Map(); hidden = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++sequence, fn); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as ReturnType<HTMLCanvasElement["getContext"]>);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(drawIcon).mockClear(); vi.mocked(drawOrb).mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function advance(count: number) {
  for (let i = 0; i < count; i++) {
    now += 16;
    const pending = [...frames.values()]; frames.clear();
    act(() => { for (const callback of pending) callback(now); });
  }
}

it("stops icon frames after reveal and pointer tilt settle, including under a stationary hover", async () => {
  const render = (lifted: boolean) => act(async () => root.render(<button><DockIcon Icon={Search} lifted={lifted} reduced={false} /></button>));
  await render(false);
  expect(frames.size).toBe(0);
  await render(true); advance(100);
  expect(frames.size).toBe(0);
  act(() => host.querySelector("button")!.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 10 })));
  advance(100);
  const settled = vi.mocked(drawIcon).mock.calls.length;
  expect(frames.size).toBe(0); advance(5);
  expect(drawIcon).toHaveBeenCalledTimes(settled);
  await render(false);
  expect(frames.size).toBe(1);
  act(() => root.unmount());
  expect(frames.size).toBe(0);
  root = createRoot(host);
});

it("uses a bounded 120ms plain reveal when motion is reduced", async () => {
  await act(async () => root.render(<button><DockIcon Icon={Search} lifted={false} reduced /></button>));
  await act(async () => root.render(<button><DockIcon Icon={Search} lifted reduced /></button>));
  advance(4);
  expect(vi.mocked(drawIcon).mock.lastCall?.[0].r).toBeCloseTo(64 / 120);
  advance(4);
  expect(vi.mocked(drawIcon).mock.lastCall?.[0].r).toBe(1);
  expect(frames.size).toBe(0);
});

it("keeps only the orb drawing at rest and stops it when hidden or unmounted", () => {
  act(() => root.render(<RosieOrb reduced={false} />));
  advance(3); expect(drawOrb).toHaveBeenCalledTimes(3);
  hidden = true; act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(frames.size).toBe(0); advance(3); expect(drawOrb).toHaveBeenCalledTimes(3);
  hidden = false; act(() => document.dispatchEvent(new Event("visibilitychange")));
  advance(1); expect(drawOrb).toHaveBeenCalledTimes(4);
  act(() => root.unmount()); expect(frames.size).toBe(0);
  root = createRoot(host);
});
