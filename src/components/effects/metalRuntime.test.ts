import { expect, it, vi } from "vitest";
vi.mock("metal-fx", () => ({ createInstance: vi.fn(options => ({ ...options, visible: true })), destroyInstance: vi.fn() }));
import { createInstance, destroyInstance } from "metal-fx";
import { keepMetalRendererWarm } from "./metalRuntime";

it("retains exactly one invisible paused lease until document teardown", () => {
  keepMetalRendererWarm(); keepMetalRendererWarm();
  expect(createInstance).toHaveBeenCalledTimes(1);
  const keeper = vi.mocked(createInstance).mock.results[0]!.value;
  expect(keeper.visible).toBe(false); expect(keeper.paused).toBe(true);
  expect(keeper.cssWidth).toBe(1); expect(keeper.cssHeight).toBe(1);
  expect(destroyInstance).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("pagehide"));
  expect(destroyInstance).toHaveBeenCalledWith(keeper);
});
