import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/db", () => ({ getAppState: db.get, setAppState: db.set }));
import { parsePluginStylePreferences, usePluginAppearance } from "./pluginAppearanceStore";
beforeEach(() => { vi.resetAllMocks(); db.get.mockResolvedValue(null); db.set.mockResolvedValue(undefined); usePluginAppearance.setState({ loaded: false, busy: false, modes: {}, error: null }); });
it("loads legacy absence without writing, preserves per-app choices", async () => {
  await usePluginAppearance.getState().load(); expect(db.set).not.toHaveBeenCalled();
  await usePluginAppearance.getState().change("dev.test.app", "original"); expect(usePluginAppearance.getState().modes).toEqual({ "dev.test.app": "original" });
  expect(db.set).toHaveBeenCalledWith("plugins.appearance", { version: 1, modes: { "dev.test.app": "original" } });
});
it("does not publish a mode until durable save acknowledges", async () => {
  await usePluginAppearance.getState().load(); let resolve!: () => void; db.set.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
  const pending = usePluginAppearance.getState().change("dev.test.app", "original"); await Promise.resolve(); expect(usePluginAppearance.getState().modes).toEqual({});
  resolve(); await pending; expect(usePluginAppearance.getState().modes["dev.test.app"]).toBe("original");
});
it("failed save preserves previous choice and exposes retry", async () => {
  db.get.mockResolvedValue({ version: 1, modes: { "dev.test.app": "original" } }); await usePluginAppearance.getState().load(); db.set.mockRejectedValue(new Error("disk failure"));
  await usePluginAppearance.getState().change("dev.test.app", "orion"); expect(usePluginAppearance.getState().modes["dev.test.app"]).toBe("original"); expect(usePluginAppearance.getState().error).toContain("wasn't saved");
});
it("failed/unknown hydration blocks writes until explicit reload", async () => {
  db.get.mockResolvedValue({ version: 2, modes: {} }); await usePluginAppearance.getState().load(); await usePluginAppearance.getState().change("dev.test.app", "original"); expect(db.set).not.toHaveBeenCalled(); expect(usePluginAppearance.getState().loaded).toBe(false);
  db.get.mockResolvedValue(null); await usePluginAppearance.getState().load(); expect(usePluginAppearance.getState().loaded).toBe(true);
});
it("ordered changes retain other plugin identities", async () => {
  await usePluginAppearance.getState().load(); await Promise.all([usePluginAppearance.getState().change("dev.one", "orion"), usePluginAppearance.getState().change("dev.two", "original")]);
  expect(usePluginAppearance.getState().modes).toEqual({ "dev.one": "orion", "dev.two": "original" });
});
it("uses canonical scoped/single-character package identities and blocks full-store writes without eviction", async () => {
  expect(parsePluginStylePreferences({ version: 1, modes: { "@author/app": "original", a: "orion" } })).toEqual({ "@author/app": "original", a: "orion" });
  usePluginAppearance.setState({ loaded: true, modes: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`dev.app${i}`, "orion" as const])) });
  await usePluginAppearance.getState().change("dev.new", "original"); expect(db.set).not.toHaveBeenCalled(); expect(Object.keys(usePluginAppearance.getState().modes)).toHaveLength(256);
});
it.each([{ version: 1, modes: { "../escape": "orion" } }, { version: 1, modes: { "dev.x": "url()" } }, { version: 1, modes: [], extra: 2 }, { version: 9, modes: {} }])("rejects malformed preference data", value => expect(() => parsePluginStylePreferences(value)).toThrow());
