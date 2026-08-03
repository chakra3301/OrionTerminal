import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registry } from "@/commands/registry";
import { useShell } from "@/shell/store/useShell";
import { appRegistry } from "./appRegistry";
import {
  BUILTIN_APP_PLUGIN_IDS,
  deactivateBuiltinAppPlugin,
  ensureBuiltinAppPlugins,
} from "./builtinApps";
import { internalPluginHost } from "./host";
import { internalEventRegistry } from "./internalEventRegistry";
import { COMMAND_CENTER_EVENT_IDS } from "@/apps/command/pluginContributions";
import { newRun } from "@/apps/command/ccRun";
import { useCommand } from "@/store/commandStore";

vi.mock("@/lib/log", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function reset() {
  internalPluginHost.reset();
  appRegistry.clear();
  registry._reset();
  internalEventRegistry.clear();
  useShell.setState({ windows: [], focusedWindowId: null, maxZ: 10 });
  useCommand.setState({ activeRun: null, planning: false, dispatching: false });
}

beforeEach(reset);
afterEach(reset);

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

  it("deactivating Command Center removes its app, command, event handlers, and window", () => {
    ensureBuiltinAppPlugins();
    const windowId = useShell.getState().openApp("command");
    useCommand.setState({
      activeRun: newRun("run-1", "profile-1", "channel-1"),
    });
    internalEventRegistry.dispatch("cc:event", {
      runId: "run-1",
      event: { kind: "assistant", text: 47 },
    });
    expect(useCommand.getState().activeRun?.text).toBe("");
    internalEventRegistry.dispatch("cc:event", {
      runId: "run-1",
      event: { kind: "assistant", text: "before disable" },
    });
    expect(useCommand.getState().activeRun?.text).toBe("before disable");
    expect(internalEventRegistry.ownerOf(COMMAND_CENTER_EVENT_IDS.stream)).toBe(
      BUILTIN_APP_PLUGIN_IDS.command,
    );

    expect(deactivateBuiltinAppPlugin(BUILTIN_APP_PLUGIN_IDS.command)).toEqual([]);
    expect(appRegistry.has("command")).toBe(false);
    expect(registry.has("app.openCommandCenter")).toBe(false);
    expect(internalEventRegistry.has(COMMAND_CENTER_EVENT_IDS.stream)).toBe(false);
    expect(internalEventRegistry.has(COMMAND_CENTER_EVENT_IDS.exit)).toBe(false);
    expect(useShell.getState().windows.some((windowState) => windowState.id === windowId)).toBe(false);

    internalEventRegistry.dispatch("cc:event", {
      runId: "run-1",
      event: { kind: "assistant", text: "after disable" },
    });
    expect(useCommand.getState().activeRun?.text).toBe("before disable");
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
