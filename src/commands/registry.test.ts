import { afterEach, describe, expect, it, vi } from "vitest";
import { registry } from "./registry";

afterEach(() => registry._reset());

describe("command registry", () => {
  it("registers and runs a command", async () => {
    const fn = vi.fn();
    registry.register({ id: "test.run", label: "Test", run: fn });
    await registry.run("test.run");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("rejects duplicate ids", () => {
    registry.register({ id: "dup", label: "A", run: () => {} });
    expect(() =>
      registry.register({ id: "dup", label: "B", run: () => {} }),
    ).toThrow(/already registered/);
  });

  it("throws on unknown command", async () => {
    await expect(registry.run("nope")).rejects.toThrow(/unknown command/);
  });

  it("respects when() predicate", async () => {
    let allowed = false;
    const fn = vi.fn();
    registry.register({
      id: "gated",
      label: "Gated",
      when: () => allowed,
      run: fn,
    });
    await expect(registry.run("gated")).rejects.toThrow(/not available/);
    expect(fn).not.toHaveBeenCalled();
    allowed = true;
    await registry.run("gated");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("list returns a stable snapshot reference", () => {
    registry.register({ id: "a", label: "A", run: () => {} });
    const snap1 = registry.list();
    const snap2 = registry.list();
    expect(snap1).toBe(snap2);
    registry.register({ id: "b", label: "B", run: () => {} });
    expect(registry.list()).not.toBe(snap1);
    expect(registry.list().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("returns hotkey list", () => {
    registry.register({
      id: "x",
      label: "X",
      hotkey: "mod+x",
      run: () => {},
    });
    registry.register({ id: "y", label: "Y", run: () => {} });
    const hk = registry.hotkeys();
    expect(hk).toEqual([{ id: "x", hotkey: "mod+x" }]);
  });

  it("unregister removes a command", () => {
    const off = registry.register({ id: "z", label: "Z", run: () => {} });
    expect(registry.has("z")).toBe(true);
    off();
    expect(registry.has("z")).toBe(false);
  });

  it("notifies subscribers on register/unregister", () => {
    const fn = vi.fn();
    const off = registry.subscribe(fn);
    registry.register({ id: "n1", label: "N1", run: () => {} });
    registry.unregister("n1");
    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });
});
