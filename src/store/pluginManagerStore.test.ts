import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAppState } from "@/lib/db";
import { registry } from "@/commands/registry";
import { appRegistry } from "@/plugins/appRegistry";
import { BUILTIN_APP_PLUGIN_IDS } from "@/plugins/builtinApps";
import { internalPluginHost } from "@/plugins/host";
import { useHermes, type HermesAgent } from "@/store/hermesStore";
import { useCommand } from "@/store/commandStore";
import { newRun } from "@/apps/command/ccRun";
import { internalEventRegistry } from "@/plugins/internalEventRegistry";
import { internalActionRegistry } from "@/plugins/internalActionRegistry";
import { overlayRegistry } from "@/plugins/overlayRegistry";
import { useAppChat } from "@/store/appChatStore";
import {
  clearArchivesActivities,
  setArchivesActivity,
} from "@/apps/archives/runtimeActivity";
import { XDESIGN_CONTRIBUTION_IDS } from "@/apps/xdesign/pluginContributions";
import {
  clearXDesignActivities,
  setXDesignActivity,
} from "@/apps/xdesign/runtimeActivity";
import { usePluginManager } from "./pluginManagerStore";

vi.mock("@/lib/db", () => ({ setAppState: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

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
  useCommand.setState({
    activeRun: null,
    planning: false,
    dispatching: false,
    proposedPlan: null,
    loaded: false,
  });
  internalEventRegistry.clear();
  internalActionRegistry.clear();
  overlayRegistry.clear();
  clearArchivesActivities();
  clearXDesignActivities();
  const threads = useAppChat.getState().threads;
  useAppChat.setState({
    threads: {
      ...threads,
      archives: {
        ...threads.archives,
        running: false,
        pendingAssistantId: null,
        activeStreamId: null,
      },
      xdesign: {
        ...threads.xdesign,
        running: false,
        pendingAssistantId: null,
        activeStreamId: null,
      },
    },
  });
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

  it("hydrates Archives as disabled before contributions or windows restore", () => {
    usePluginManager.getState().hydrate({
      version: 1,
      disabled: [BUILTIN_APP_PLUGIN_IDS.archives],
    });

    expect(appRegistry.has("archives")).toBe(false);
    expect(registry.has("note.quickCapture")).toBe(false);
    expect(internalActionRegistry.has("open_note")).toBe(false);
    expect(overlayRegistry.ownerOf("archives.overlay.ask")).toBeUndefined();
  });

  it("persists and disposes Archives contributions immediately", async () => {
    usePluginManager.getState().hydrate(null);
    expect(registry.ownerOf("note.quickCapture")).toBe(BUILTIN_APP_PLUGIN_IDS.archives);
    expect(internalActionRegistry.has("open_note")).toBe(true);
    expect(overlayRegistry.ownerOf("archives.overlay.ask")).toBe(
      BUILTIN_APP_PLUGIN_IDS.archives,
    );

    const ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.archives, false);

    expect(ok).toBe(true);
    expect(setAppState).toHaveBeenCalledWith("plugins.state", {
      version: 1,
      disabled: [BUILTIN_APP_PLUGIN_IDS.archives],
    });
    expect(appRegistry.has("archives")).toBe(false);
    expect(registry.has("note.quickCapture")).toBe(false);
    expect(internalActionRegistry.has("open_note")).toBe(false);
    expect(overlayRegistry.ownerOf("archives.overlay.ask")).toBeUndefined();
  });

  it("blocks Archives disable while its Claude rail is running", async () => {
    usePluginManager.getState().hydrate(null);
    const threads = useAppChat.getState().threads;
    useAppChat.setState({
      threads: {
        ...threads,
        archives: { ...threads.archives, running: true },
      },
    });

    const ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.archives, false);

    expect(ok).toBe(false);
    expect(setAppState).not.toHaveBeenCalled();
    expect(appRegistry.has("archives")).toBe(true);
    expect(usePluginManager.getState().error).toMatch(/Claude response/);
  });

  it("blocks Archives disable while owned background work is active", async () => {
    usePluginManager.getState().hydrate(null);
    setArchivesActivity("learn", true, "Archives Learn is running.");

    const ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.archives, false);

    expect(ok).toBe(false);
    expect(setAppState).not.toHaveBeenCalled();
    expect(appRegistry.has("archives")).toBe(true);
    expect(usePluginManager.getState().error).toBe("Archives Learn is running.");
  });

  it("persists and disposes XDesign commands and bridge actions", async () => {
    usePluginManager.getState().hydrate(null);
    expect(registry.ownerOf("xdesign.present")).toBe(BUILTIN_APP_PLUGIN_IDS.xdesign);
    expect(internalActionRegistry.ownerOf(XDESIGN_CONTRIBUTION_IDS.applyAction)).toBe(
      BUILTIN_APP_PLUGIN_IDS.xdesign,
    );

    const ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.xdesign, false);

    expect(ok).toBe(true);
    expect(setAppState).toHaveBeenCalledWith("plugins.state", {
      version: 1,
      disabled: [BUILTIN_APP_PLUGIN_IDS.xdesign],
    });
    expect(appRegistry.has("xdesign")).toBe(false);
    expect(registry.has("xdesign.present")).toBe(false);
    expect(internalActionRegistry.has(XDESIGN_CONTRIBUTION_IDS.applyAction)).toBe(false);
  });

  it("blocks XDesign disable during Claude and owned background work", async () => {
    usePluginManager.getState().hydrate(null);
    const threads = useAppChat.getState().threads;
    useAppChat.setState({
      threads: {
        ...threads,
        xdesign: { ...threads.xdesign, running: true },
      },
    });
    let ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.xdesign, false);
    expect(ok).toBe(false);
    expect(usePluginManager.getState().error).toMatch(/XDesign Claude response/);

    useAppChat.setState({
      threads: {
        ...useAppChat.getState().threads,
        xdesign: { ...useAppChat.getState().threads.xdesign, running: false },
      },
    });
    usePluginManager.setState({ error: null });
    setXDesignActivity("image", true, "XDesign image generation is running.");
    ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.xdesign, false);
    expect(ok).toBe(false);
    expect(usePluginManager.getState().error).toBe("XDesign image generation is running.");
    expect(setAppState).not.toHaveBeenCalled();
  });

  it("persists and disposes Command Center and its event handlers", async () => {
    usePluginManager.getState().hydrate(null);
    expect(internalEventRegistry.ownerOf("command-center.event.stream")).toBe(
      BUILTIN_APP_PLUGIN_IDS.command,
    );

    const ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.command, false);

    expect(ok).toBe(true);
    expect(setAppState).toHaveBeenCalledWith("plugins.state", {
      version: 1,
      disabled: [BUILTIN_APP_PLUGIN_IDS.command],
    });
    expect(appRegistry.has("command")).toBe(false);
    expect(registry.has("app.openCommandCenter")).toBe(false);
    expect(internalEventRegistry.has("command-center.event.stream")).toBe(false);
  });

  it("restores Command Center runtime state when persistence fails", async () => {
    usePluginManager.getState().hydrate(null);
    vi.mocked(setAppState).mockRejectedValueOnce(new Error("disk unavailable"));

    const ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.command, false);

    expect(ok).toBe(false);
    expect(usePluginManager.getState().disabledIds).toEqual([]);
    expect(appRegistry.has("command")).toBe(true);
    expect(registry.has("app.openCommandCenter")).toBe(true);
    expect(internalEventRegistry.has("command-center.event.stream")).toBe(true);
    expect(useCommand.getState().loaded).toBe(true);
    expect(setAppState).toHaveBeenLastCalledWith("plugins.state", {
      version: 1,
      disabled: [],
    });
  });

  it("blocks disable while Command Center is planning or running agents", async () => {
    usePluginManager.getState().hydrate(null);
    useCommand.setState({ planning: true });
    let ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.command, false);
    expect(ok).toBe(false);
    expect(setAppState).not.toHaveBeenCalled();
    expect(usePluginManager.getState().error).toMatch(/planning and agent runs/);

    usePluginManager.setState({ error: null });
    useCommand.setState({
      planning: false,
      activeRun: newRun("run-1", "profile-1", "channel-1"),
    });
    ok = await usePluginManager
      .getState()
      .setEnabled(BUILTIN_APP_PLUGIN_IDS.command, false);
    expect(ok).toBe(false);
    expect(setAppState).not.toHaveBeenCalled();
    expect(appRegistry.has("command")).toBe(true);
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
