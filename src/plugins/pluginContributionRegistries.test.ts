import { afterEach, describe, expect, it, vi } from "vitest";
import { internalActionRegistry } from "./internalActionRegistry";
import { overlayRegistry } from "./overlayRegistry";

afterEach(() => {
  internalActionRegistry.clear();
  overlayRegistry.clear();
});

describe("plugin contribution registries", () => {
  it("routes an internal action only while its owner registration is active", async () => {
    const handle = vi.fn(async (payload: unknown) => ({ payload }));
    const registration = internalActionRegistry.register("@orion/test", {
      id: "test.action",
      handle,
    });

    await expect(internalActionRegistry.dispatch("test.action", 47)).resolves.toEqual({
      handled: true,
      value: { payload: 47 },
    });
    registration.dispose();
    await expect(internalActionRegistry.dispatch("test.action", 47)).resolves.toEqual({
      handled: false,
    });
  });

  it("keeps overlays ordered and owner-attributed", () => {
    const Overlay = () => null;
    overlayRegistry.register("@orion/later", {
      id: "overlay.later",
      order: 20,
      component: Overlay,
    });
    overlayRegistry.register("@orion/first", {
      id: "overlay.first",
      order: 10,
      component: Overlay,
    });

    expect(overlayRegistry.list().map((overlay) => overlay.id)).toEqual([
      "overlay.first",
      "overlay.later",
    ]);
    expect(overlayRegistry.ownerOf("overlay.first")).toBe("@orion/first");
  });
});
