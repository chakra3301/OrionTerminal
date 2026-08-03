import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAppState } from "@/lib/db";
import { registry } from "@/commands/registry";
import { appRegistry } from "@/plugins/appRegistry";
import { BUILTIN_APP_PLUGIN_IDS } from "@/plugins/builtinApps";
import { internalPluginHost } from "@/plugins/host";
import { useHermes, type HermesAgent } from "@/store/hermesStore";
import { usePluginManager } from "./pluginManagerStore";

vi.mock("@/lib/db", () => ({ setAppState: vi.fn(async () => {}) }));

function reset() {
  internalPluginHost.reset();
  appRegistry.clear();
  registry._reset();
  usePluginManager.setState({
    hydrated: false,
    disabledIds: [],
    busyIds: [],
    error: null,
  });
  useHermes.setState({ tasks: new Map(), agents: new Map(), loaded: false });
  vi.clearAllMocks();
}

beforeEach(reset);
afterEach(reset);

describe("plugin enablement persistence", () => {
  it("fails closed until persisted state is hydrated", () => {
    expect(usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.hermes)).toBe(false);
    expect(appRegistry.list()).toEqual([]);
  });

  it("defaults built-ins to enabled", () => {
    usePluginManager.getState().hydrate(null);
    expect(appRegistry.has("hermes")).toBe(true);
    expect(registry.has("app.openHermes")).toBe(true);
    expect(usePluginManager.getState().disabledIds).toEqual([]);
  });

  it("hydrates disabled plugins before shell restore", () => {
    usePluginManager.getState().hydrate({
      version: 1,
      disabled: [BUILTIN_APP_PLUGIN_IDS.hermes],
    });
    expect(appRegistry.has("hermes")).toBe(false);
    expect(registry.has("app.openHermes")).toBe(false);
    expect(usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.hermes)).toBe(false);
  });

  it("persists and disposes Hermes immediately", async () => {
    usePluginManager.getState().hydrate(null);
    const ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.hermes, false);
    expect(ok).toBe(true);
    expect(setAppState).toHaveBeenCalledWith("plugins.state", {
      version: 1,
      disabled: [BUILTIN_APP_PLUGIN_IDS.hermes],
    });
    expect(appRegistry.has("hermes")).toBe(false);
    expect(registry.has("app.openHermes")).toBe(false);
  });

  it("blocks disable while a Hermes agent is running", async () => {
    usePluginManager.getState().hydrate(null);
    const running = {
      id: "a1",
      taskId: "t1",
      status: "running",
    } as HermesAgent;
    useHermes.setState({ agents: new Map([[running.id, running]]) });
    const ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.hermes, false);
    expect(ok).toBe(false);
    expect(setAppState).not.toHaveBeenCalled();
    expect(appRegistry.has("hermes")).toBe(true);
    expect(usePluginManager.getState().error).toMatch(/Stop every running Hermes task/);
  });

  it("ignores persisted disable requests for migration-locked apps", () => {
    usePluginManager.getState().hydrate({
      version: 1,
      disabled: [BUILTIN_APP_PLUGIN_IDS.orion],
    });
    expect(usePluginManager.getState().disabledIds).toEqual([]);
    expect(appRegistry.has("orion")).toBe(true);
  });
});
