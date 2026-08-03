import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/commands/registry";
import { useShell } from "@/shell/store/useShell";
import { appRegistry } from "./appRegistry";
import {
  BUILTIN_APP_PLUGIN_IDS,
  deactivateBuiltinAppPlugin,
  ensureBuiltinAppPlugins,
} from "./builtinApps";
import { internalPluginHost } from "./host";

beforeEach(() => {
  internalPluginHost.reset();
  appRegistry.clear();
  registry._reset();
  useShell.setState({ windows: [], focusedWindowId: null, maxZ: 10 });
});

afterEach(() => {
  internalPluginHost.reset();
  appRegistry.clear();
  registry._reset();
  useShell.setState({ windows: [], focusedWindowId: null, maxZ: 10 });
});

describe("built-in app plugins", () => {
  it("bootstrap through the same owned app and command contracts", () => {
    ensureBuiltinAppPlugins();
    expect(appRegistry.list().map((app) => app.id)).toEqual([
      "archives",
      "orion",
      "xdesign",
      "command",
      "hermes",
    ]);
    expect(appRegistry.ownerOf("hermes")).toBe(BUILTIN_APP_PLUGIN_IDS.hermes);
    expect(registry.ownerOf("app.openHermes")).toBe(BUILTIN_APP_PLUGIN_IDS.hermes);
  });

  it("deactivating Hermes removes its app, command, and open window", () => {
    ensureBuiltinAppPlugins();
    const windowId = useShell.getState().openApp("hermes");
    expect(useShell.getState().windows.some((windowState) => windowState.id === windowId)).toBe(true);

    expect(deactivateBuiltinAppPlugin(BUILTIN_APP_PLUGIN_IDS.hermes)).toEqual([]);
    expect(appRegistry.has("hermes")).toBe(false);
    expect(registry.has("app.openHermes")).toBe(false);
    expect(useShell.getState().windows.some((windowState) => windowState.app === "hermes")).toBe(false);
    expect(() => useShell.getState().openApp("hermes")).toThrow(/unknown or disabled app/);
  });
});
