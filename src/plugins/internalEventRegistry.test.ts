import { afterEach, describe, expect, it, vi } from "vitest";
import { internalEventRegistry } from "./internalEventRegistry";

afterEach(() => internalEventRegistry.clear());

describe("internal event contributions", () => {
  it("dispatches only matching events and disposes by registration token", () => {
    const first = vi.fn();
    const second = vi.fn();
    const disposable = internalEventRegistry.register("@orion/test", {
      id: "test.first",
      event: "test:event",
      handle: first,
    });
    internalEventRegistry.register("@orion/other", {
      id: "test.second",
      event: "other:event",
      handle: second,
    });

    internalEventRegistry.dispatch("test:event", { ok: true });
    expect(first).toHaveBeenCalledWith({ ok: true });
    expect(second).not.toHaveBeenCalled();

    disposable.dispose();
    internalEventRegistry.dispatch("test:event", { ok: false });
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("rejects blank event names", () => {
    expect(() =>
      internalEventRegistry.register("@orion/test", {
        id: "test.blank",
        event: "   ",
        handle: vi.fn(),
      }),
    ).toThrow(/must not be empty/);
  });
});
