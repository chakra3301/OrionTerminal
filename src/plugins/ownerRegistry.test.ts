import { describe, expect, it, vi } from "vitest";
import { DisposableScope } from "./contracts";
import { InternalPluginHost } from "./host";
import { OwnerRegistry } from "./ownerRegistry";

type Item = { id: string; order: number };

describe("owner-aware contribution registry", () => {
  it("tracks owners and bulk-disposes one owner's contributions", () => {
    const registry = new OwnerRegistry<Item>("test", (a, b) => a.order - b.order);
    registry.register("@orion/one", { id: "one.a", order: 2 });
    registry.register("@orion/one", { id: "one.b", order: 1 });
    registry.register("@orion/two", { id: "two.a", order: 3 });

    expect(registry.list().map((item) => item.id)).toEqual(["one.b", "one.a", "two.a"]);
    expect(registry.ownerOf("one.a")).toBe("@orion/one");
    expect(registry.disposeOwner("@orion/one")).toBe(2);
    expect(registry.list().map((item) => item.id)).toEqual(["two.a"]);
  });

  it("rejects invalid owners, invalid ids, and cross-owner collisions", () => {
    const registry = new OwnerRegistry<Item>("view");
    expect(() => registry.register("BAD OWNER", { id: "valid", order: 0 })).toThrow(/invalid plugin id/);
    expect(() => registry.register("@orion/one", { id: "bad id", order: 0 })).toThrow(/invalid contribution id/);
    registry.register("@orion/one", { id: "shared", order: 0 });
    expect(() => registry.register("@orion/two", { id: "shared", order: 0 })).toThrow(/owned by @orion\/one/);
  });

  it("returns idempotent disposables and stable snapshots", () => {
    const registry = new OwnerRegistry<Item>("test");
    const disposable = registry.register("@orion/one", { id: "one", order: 0 });
    const snapshot = registry.list();
    expect(registry.list()).toBe(snapshot);
    disposable.dispose();
    disposable.dispose();
    expect(registry.list()).toEqual([]);
    expect(registry.list()).not.toBe(snapshot);
  });

  it("notifies once for an owner bulk-disposal", () => {
    const registry = new OwnerRegistry<Item>("test");
    registry.register("@orion/one", { id: "one", order: 0 });
    registry.register("@orion/one", { id: "two", order: 0 });
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.disposeOwner("@orion/one");
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("plugin disposal", () => {
  it("continues cleanup after one disposer throws", () => {
    const calls: string[] = [];
    const scope = new DisposableScope();
    scope.add(() => calls.push("first"));
    scope.add(() => {
      calls.push("broken");
      throw new Error("cleanup failed");
    });
    scope.add(() => calls.push("last"));

    scope.dispose();
    expect(calls).toEqual(["last", "broken", "first"]);
    expect(scope.errors()).toHaveLength(1);
  });

  it("deactivates all contributions owned by an internal plugin", () => {
    const registry = new OwnerRegistry<Item>("test");
    const host = new InternalPluginHost();
    host.activate({
      id: "@orion/pilot",
      activate: ({ pluginId, subscriptions }) => {
        subscriptions.add(registry.register(pluginId, { id: "pilot.app", order: 0 }));
        subscriptions.add(registry.register(pluginId, { id: "pilot.command", order: 1 }));
      },
    });
    expect(host.isActive("@orion/pilot")).toBe(true);
    expect(registry.list()).toHaveLength(2);
    expect(host.deactivate("@orion/pilot")).toEqual([]);
    expect(registry.list()).toEqual([]);
  });
});
