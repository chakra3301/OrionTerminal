import { afterEach, expect, it, vi } from "vitest";
import { subscribeOrb } from "./orbFrames";

afterEach(() => vi.unstubAllGlobals());
it("shares one frame loop and cancels it when the last visible orb leaves", () => {
  const pending = new Map<number, FrameRequestCallback>(); let seq = 0;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { pending.set(++seq, fn); return seq; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  const a = vi.fn(), b = vi.fn(), stopA = subscribeOrb(a), stopB = subscribeOrb(b);
  expect(pending.size).toBe(1);
  const step = () => { const frames = [...pending.values()]; pending.clear(); frames.forEach((fn) => fn(16)); };
  step(); expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledOnce(); expect(pending.size).toBe(1);
  stopA(); step(); expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledTimes(2);
  stopB(); expect(pending.size).toBe(0);
});

it("does not duplicate the loop when an orb mounts during a frame", () => {
  const pending = new Map<number, FrameRequestCallback>(); let seq = 0, stopB = () => {};
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { pending.set(++seq, fn); return seq; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  const stopA = subscribeOrb(() => { stopB = subscribeOrb(() => {}); });
  const frames = [...pending.values()]; pending.clear(); frames.forEach((fn) => fn(16));
  expect(pending.size).toBe(1); stopA(); stopB(); expect(pending.size).toBe(0);
});
