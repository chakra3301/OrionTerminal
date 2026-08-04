import type { DisposableScope } from "@/plugins/contracts";
import { internalActionRegistry } from "@/plugins/internalActionRegistry";
import { internalEventRegistry } from "@/plugins/internalEventRegistry";
import { appRegistry } from "@/plugins/appRegistry";
import { registerOrionCommands } from "@/commands/builtins";
import { useShell } from "@/shell/store/useShell";
import { useProjectStore } from "@/store/projectStore";
import { useWorkspace, allTabs } from "@/components/workspace/workspaceStore";
import type { LayoutNode } from "@/components/workspace/types";
import { useLayoutStore } from "@/store/layoutStore";
import { usePreviewStore, type PreviewState } from "@/store/previewStore";
import { useAutocomplete } from "@/store/autocompleteStore";
import { useTerminalStore } from "@/store/terminalStore";
import { useChatStore, type ContentBlock } from "@/store/chatStore";
import { useInlineEditStore } from "@/store/inlineEditStore";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { useTabsStore, isFileTabDirty } from "@/store/tabsStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { getAppState, getWorkspaceLayout, setWorkspaceLayout, upsertChat } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { scheduleReindex } from "@/lib/embeddingIndexer";
import { ensureOrionTheme } from "@/apps/orion/monacoTheme";
import { hasLiveTerminals } from "@/apps/orion/terminalActivity";
import { startGitWatch, resetGitRuntime } from "@/store/gitStore";
import { startCodebaseIndexing, stopCodebaseIndexing } from "@/features/context/codebaseIndexer";
import { onPassExit } from "@/features/agents/twoPassCoordinator";
import { stopAllLsp } from "@/features/lsp/lspManager";
import {
  clearOrionActivities,
  orionActivityReason,
  setOrionActivity,
  trackOrionActivity,
} from "@/apps/orion/runtimeActivity";

export const ORION_CONTRIBUTION_IDS = {
  switchProjectAction: "switch_project",
  openFileAction: "open_file",
  runTerminalAction: "run_in_terminal",
  stagedEditAction: "staged_edit",
  inlineDeltaEvent: "orion.inline.delta",
  inlineFinalEvent: "orion.inline.final",
  inlineDoneEvent: "orion.inline.done",
  inlineErrorEvent: "orion.inline.error",
  claudeEvent: "orion.claude.event",
  claudeExitEvent: "orion.claude.exit",
  fileRefreshEvent: "orion.file.refresh",
} as const;

let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
let chatSaveTimer: ReturnType<typeof setTimeout> | null = null;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(
  value: unknown,
  name: string,
  max: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0) || value.length > max) {
    throw new Error(`${name} must be ${allowEmpty ? "a" : "a non-empty"} string of at most ${max} characters`);
  }
  return value;
}

async function sanitizeLayout(node: LayoutNode): Promise<LayoutNode> {
  if (node.kind === "panel") {
    const keptTabs: typeof node.tabs = [];
    for (const tab of node.tabs) {
      if (tab.descriptor.kind === "note" && !appRegistry.has("archives")) continue;
      if (tab.descriptor.kind === "file") {
        try {
          if (await ipc.pathExists(tab.descriptor.path)) keptTabs.push(tab);
        } catch {
          // Drop unreadable files from restored state.
        }
      } else {
        keptTabs.push(tab);
      }
    }
    const activeTabId =
      keptTabs.find((tab) => tab.id === node.activeTabId)?.id ?? keptTabs[0]?.id ?? null;
    return { ...node, tabs: keptTabs, activeTabId };
  }
  return {
    ...node,
    children: await Promise.all(node.children.map(sanitizeLayout)),
  };
}

function chatSearchableText(): string {
  const chat = useChatStore.getState().active;
  if (!chat) return "";
  const parts: string[] = [];
  for (const message of chat.messages) {
    for (const block of message.blocks) {
      if (block.type === "text" && block.text) parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function scheduleChatSave(): void {
  if (chatSaveTimer) clearTimeout(chatSaveTimer);
  const active = useChatStore.getState().active;
  if (!active) {
    setOrionActivity("chat-save-pending", false, "");
    return;
  }
  setOrionActivity(
    "chat-save-pending",
    true,
    "Wait for the Orion conversation to finish saving before disabling the plugin.",
  );
  chatSaveTimer = setTimeout(() => {
    chatSaveTimer = null;
    const chat = useChatStore.getState().active;
    if (!chat) {
      setOrionActivity("chat-save-pending", false, "");
      return;
    }
    void trackOrionActivity(
      "chat-save",
      "Wait for the Orion conversation to finish saving before disabling the plugin.",
      async () => {
        await upsertChat({
          id: chat.id,
          title: chat.title,
          messages_json: JSON.stringify(chat.messages),
          searchable_text: chatSearchableText(),
          session_id: chat.sessionId,
          project_id: chat.projectId,
          total_cost_usd: chat.totalCostUsd,
          origin: "orion",
          created_at: chat.createdAt,
          updated_at: chat.updatedAt,
        });
        scheduleReindex("chat", chat.id, () => {
          const current = useChatStore.getState().active;
          return current?.id === chat.id
            ? `${current.title || "Untitled chat"}\n${chatSearchableText()}`
            : null;
        });
      },
    )
      .catch((error) => log.warn("orion chat save failed", error))
      .finally(() => setOrionActivity("chat-save-pending", false, ""));
  }, 600);
}

function flushLayout(projectId: string): void {
  const workspace = useWorkspace.getState();
  void trackOrionActivity(
    "layout-save",
    "Wait for the Orion workspace layout to finish saving before disabling the plugin.",
    () => setWorkspaceLayout(projectId, workspace.root, workspace.focusedPanelId),
  ).catch((error) => log.warn("Orion workspace layout save failed", error));
}

function startProjectScopedLayout(): () => void {
  let currentProjectId = useProjectStore.getState().active?.id ?? null;
  let disposed = false;

  const unsubscribeWorkspace = useWorkspace.subscribe(() => {
    if (!currentProjectId) return;
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
    setOrionActivity(
      "layout-save-pending",
      true,
      "Wait for the Orion workspace layout to finish saving before disabling the plugin.",
    );
    layoutSaveTimer = setTimeout(() => {
      layoutSaveTimer = null;
      setOrionActivity("layout-save-pending", false, "");
      if (currentProjectId) flushLayout(currentProjectId);
    }, 400);
  });

  const unsubscribeProject = useProjectStore.subscribe((state) => {
    const nextId = state.active?.id ?? null;
    if (nextId === currentProjectId) return;
    if (layoutSaveTimer) {
      clearTimeout(layoutSaveTimer);
      layoutSaveTimer = null;
      setOrionActivity("layout-save-pending", false, "");
    }
    if (currentProjectId) flushLayout(currentProjectId);
    currentProjectId = nextId;
    if (!nextId) return;
    void trackOrionActivity(
      "layout-load",
      "Wait for the Orion workspace layout to finish loading before disabling the plugin.",
      async () => {
        const loaded = await getWorkspaceLayout<LayoutNode>(nextId);
        if (disposed || useProjectStore.getState().active?.id !== nextId) return;
        if (loaded) {
          useWorkspace.getState().hydrate(
            await sanitizeLayout(loaded.layout),
            loaded.focusedPanelId,
          );
        } else {
          const { defaultOrionLayout } = await import("@/components/workspace/workspaceStore");
          useWorkspace.getState().resetLayout(defaultOrionLayout);
        }
      },
    ).catch((error) => log.warn("Orion workspace layout swap failed", error));
  });

  return () => {
    disposed = true;
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
    layoutSaveTimer = null;
    setOrionActivity("layout-save-pending", false, "");
    unsubscribeWorkspace();
    unsubscribeProject();
  };
}

function startFsWatcher(): () => void {
  let active = true;
  const sync = (root: string | null) => {
    void ipc.fsWatchSetRoot(root).catch((error) => log.warn("fs watch", error));
  };
  sync(useProjectStore.getState().active?.root_path ?? null);
  const unsubscribe = useProjectStore.subscribe((state) => {
    if (active) sync(state.active?.root_path ?? null);
  });
  return () => {
    active = false;
    unsubscribe();
    sync(null);
  };
}

async function switchProjectAction(value: unknown): Promise<void> {
  const payload = record(value);
  const query = boundedString(payload?.name_or_id, "name_or_id", 512).trim();
  await trackOrionActivity(
    "project-switch",
    "Wait for Orion to finish switching projects before disabling the plugin.",
    async () => {
      const store = useProjectStore.getState();
      await store.loadRecents();
      const lower = query.toLowerCase();
      const match =
        useProjectStore.getState().recents.find((project) => project.id === query) ??
        useProjectStore.getState().recents.find((project) => project.name === query) ??
        useProjectStore.getState().recents.find((project) => project.name.toLowerCase() === lower) ??
        useProjectStore.getState().recents.find((project) => project.name.toLowerCase().includes(lower));
      if (!match) throw new Error(`project not found: ${query}`);
      await store.switchToProject(match);
      useShell.getState().openApp("orion");
    },
  );
}

function openFileAction(value: unknown): void {
  const payload = record(value);
  const raw = boundedString(payload?.path, "path", 32_768).trim();
  const project = useProjectStore.getState().active;
  const absolute = /^([a-zA-Z]:)?[\\/]/.test(raw);
  const path = absolute || !project ? raw : `${project.root_path}/${raw}`.replace(/\/+/g, "/");
  useShell.getState().openApp("orion");
  useWorkspace.getState().openTab(
    { kind: "file", path },
    { label: path.split(/[\\/]/).pop() ?? path, preferRole: "editor" },
  );
}

async function runTerminalAction(value: unknown): Promise<void> {
  const payload = record(value);
  const command = boundedString(payload?.command, "command", 20_000).trim();
  useShell.getState().openApp("orion");
  useWorkspace.getState().openTab({ kind: "terminal" }, { preferRole: "terminal" });
  const start = Date.now();
  while (Date.now() - start < 3_000) {
    const ptyId = useTerminalStore.getState().ptyId;
    if (ptyId) {
      await ipc.terminalWrite(ptyId, `${command}\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("terminal did not start within 3 seconds");
}

function stagedEditAction(value: unknown): void {
  const payload = record(value);
  const path = boundedString(payload?.path, "path", 32_768).trim();
  const updated = boundedString(payload?.updated, "updated", 5_000_000, true);
  const original = payload?.original === undefined
    ? ""
    : boundedString(payload.original, "original", 5_000_000, true);
  if (payload?.is_new !== undefined && typeof payload.is_new !== "boolean") {
    throw new Error("is_new must be a boolean");
  }
  usePendingEdits.getState().stage({
    path,
    original,
    updated,
    isNew: payload?.is_new === true,
  });
  void import("@/features/aiEdits/checkpoints").then((module) =>
    module.captureForStagedEdit({ path, original, isNew: payload?.is_new === true }),
  );
  useTabsStore.getState().markLoaded(path, updated);
  useFileTreeRefresh.getState().bump();
  useShell.getState().openApp("orion");
  useWorkspace.getState().openTab({ kind: "diff-review", path });
}

function inlineEvent(kind: "delta" | "final" | "done" | "error", value: unknown): void {
  const payload = record(value);
  const streamId = boundedString(payload?.streamId, "streamId", 256);
  const state = useInlineEditStore.getState();
  if (state.streamId !== streamId) return;
  if (kind === "done") state.finishStream();
  else if (kind === "error") state.setError(boundedString(payload?.message, "message", 20_000, true));
  else if (kind === "delta") state.appendDelta(boundedString(payload?.text, "text", 1_000_000, true));
  else state.setFinal(boundedString(payload?.text, "text", 5_000_000, true));
}

type UserToolResult = {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
};

function findToolName(toolUseId: string): string | null {
  const active = useChatStore.getState().active;
  if (!active) return null;
  for (const message of active.messages) {
    for (const block of message.blocks) {
      if (block.type === "tool_use" && block.id === toolUseId) return block.name;
    }
  }
  return null;
}

function handleClaudeEvent(value: unknown): void {
  const envelope = record(value);
  const chatId = boundedString(envelope?.chatId, "chatId", 256);
  const event = record(envelope?.event);
  const type = boundedString(event?.type, "event.type", 128);
  const store = useChatStore.getState();
  if (!store.active || store.active.id !== chatId) return;

  if (type === "system") {
    if (event?.subtype === "init" && typeof event.session_id === "string") {
      store.setSessionId(event.session_id);
    }
    return;
  }
  if (type === "assistant") {
    const message = record(event?.message);
    const content = message?.content;
    if (Array.isArray(content)) {
      const blocks = content.filter((block): block is ContentBlock => {
        const candidate = record(block);
        return candidate?.type === "text" || candidate?.type === "tool_use";
      });
      store.onAssistantBlocks(blocks);
    }
    return;
  }
  if (type === "user") {
    const message = record(event?.message);
    const content = message?.content;
    if (!Array.isArray(content)) return;
    let refresh = false;
    for (const candidate of content) {
      const block = record(candidate);
      if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const result = block as UserToolResult;
      if (!result.is_error && ["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(findToolName(result.tool_use_id) ?? "")) {
        refresh = true;
      }
      store.onToolResult(result.tool_use_id, {
        content: result.content,
        isError: result.is_error,
      });
    }
    if (refresh) useFileTreeRefresh.getState().bump();
    return;
  }
  if (type === "result") {
    if (typeof event?.total_cost_usd === "number") store.addCost(event.total_cost_usd);
    const errors = event?.errors;
    if (event?.is_error === true && Array.isArray(errors) && store.active) {
      const previous =
        store.active.messages.find((message) => message.id === store.pendingAssistantId)?.blocks ?? [];
      store.onAssistantBlocks([
        ...previous,
        { type: "text", text: errors.filter((item): item is string => typeof item === "string").join("\n") },
      ]);
    }
    store.finishTurn();
    return;
  }
  if (type === "stderr" && typeof event?.text === "string") {
    log.warn("[claude stderr]", event.text);
  }
}

function handleClaudeExit(value: unknown): void {
  const payload = record(value);
  const chatId = boundedString(payload?.chatId, "chatId", 256);
  const error = payload?.error === null || payload?.error === undefined
    ? null
    : boundedString(payload.error, "error", 20_000, true);
  const store = useChatStore.getState();
  if (!store.active || store.active.id !== chatId) return;
  if (onPassExit(chatId, error)) return;
  store.finishTurn();
  store.setRunning(false);
  if (error) log.warn("[claude exit]", error);
}

function disposeOrionRuntime(): void {
  if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
  if (chatSaveTimer) clearTimeout(chatSaveTimer);
  layoutSaveTimer = null;
  chatSaveTimer = null;
  stopCodebaseIndexing();
  resetGitRuntime();
  stopAllLsp();
  useInlineEditStore.getState().reset();
  useTerminalStore.setState({ ptyId: null, open: false });
  useChatStore.setState({ active: null, running: false, pendingAssistantId: null });
  useProjectStore.setState({ active: null, recents: [] });
  clearOrionActivities();
}

export function orionDisableReason(): string | null {
  if (useChatStore.getState().running) {
    return "Wait for the Orion AI response to finish before disabling the plugin.";
  }
  if (useInlineEditStore.getState().visible || useInlineEditStore.getState().streaming) {
    return "Accept, reject, or close the Orion inline edit before disabling the plugin.";
  }
  if (hasLiveTerminals()) {
    return "Close every Orion terminal and interactive agent session before disabling the plugin.";
  }
  if (usePendingEdits.getState().order.length > 0) {
    return "Accept or reject every pending Orion file change before disabling the plugin.";
  }
  const workspace = useWorkspace.getState();
  const buffers = useTabsStore.getState().fileBuffers;
  if (allTabs(workspace.root).some((tab) => isFileTabDirty(tab, buffers))) {
    return "Save or close every modified Orion file before disabling the plugin.";
  }
  return orionActivityReason();
}

export async function loadOrionPluginData(): Promise<void> {
  const [
    panelSizes,
    sidebarOpen,
    rightOpen,
    workspaceLayout,
    focusedPanelId,
    lastProjectId,
    terminalOpen,
    terminalHeight,
    preview,
    tabAutocomplete,
  ] = await Promise.all([
    getAppState<{ sidebar: number; main: number; right: number }>("panel_sizes"),
    getAppState<boolean>("sidebar_open"),
    getAppState<boolean>("right_rail_open"),
    getAppState<LayoutNode>("workspace.layout"),
    getAppState<string>("workspace.focusedPanel"),
    getAppState<string>("last_project_id"),
    getAppState<boolean>("terminal_open"),
    getAppState<number>("terminal_height"),
    getAppState<PreviewState>("preview"),
    getAppState<boolean>("tab_autocomplete"),
  ]);

  useLayoutStore.getState().hydrate({
    ...(panelSizes ? { sizes: panelSizes } : {}),
    ...(typeof sidebarOpen === "boolean" ? { sidebarOpen } : {}),
    ...(typeof rightOpen === "boolean" ? { rightOpen } : {}),
  });
  if (preview) usePreviewStore.getState().hydrate(preview);
  useAutocomplete.getState().hydrate(tabAutocomplete);
  if (typeof terminalHeight === "number") useTerminalStore.getState().setHeight(terminalHeight);
  if (typeof terminalOpen === "boolean") useTerminalStore.getState().setOpen(terminalOpen);

  let layout = workspaceLayout;
  let focused = focusedPanelId ?? null;
  if (lastProjectId) {
    const projectLayout = await getWorkspaceLayout<LayoutNode>(lastProjectId);
    if (projectLayout) {
      layout = projectLayout.layout;
      focused = projectLayout.focusedPanelId;
    }
  }
  if (layout) useWorkspace.getState().hydrate(await sanitizeLayout(layout), focused);
  if (lastProjectId) await useProjectStore.getState().hydrateFromId(lastProjectId);
  else await useProjectStore.getState().loadRecents();
  await ensureOrionTheme();
}

export function registerOrionContributions(
  ownerId: string,
  subscriptions: DisposableScope,
): void {
  subscriptions.add(disposeOrionRuntime);
  subscriptions.add(startProjectScopedLayout());
  subscriptions.add(startFsWatcher());
  subscriptions.add(startGitWatch());
  subscriptions.add(startCodebaseIndexing());
  subscriptions.add(useChatStore.subscribe(scheduleChatSave));
  registerOrionCommands(ownerId, subscriptions);

  const actions = [
    { id: ORION_CONTRIBUTION_IDS.switchProjectAction, handle: switchProjectAction },
    { id: ORION_CONTRIBUTION_IDS.openFileAction, handle: openFileAction },
    { id: ORION_CONTRIBUTION_IDS.runTerminalAction, handle: runTerminalAction },
    { id: ORION_CONTRIBUTION_IDS.stagedEditAction, handle: stagedEditAction },
  ];
  for (const action of actions) subscriptions.add(internalActionRegistry.register(ownerId, action));

  const events = [
    { id: ORION_CONTRIBUTION_IDS.inlineDeltaEvent, event: "orion.inline.delta", handle: (value: unknown) => inlineEvent("delta", value) },
    { id: ORION_CONTRIBUTION_IDS.inlineFinalEvent, event: "orion.inline.final", handle: (value: unknown) => inlineEvent("final", value) },
    { id: ORION_CONTRIBUTION_IDS.inlineDoneEvent, event: "orion.inline.done", handle: (value: unknown) => inlineEvent("done", value) },
    { id: ORION_CONTRIBUTION_IDS.inlineErrorEvent, event: "orion.inline.error", handle: (value: unknown) => inlineEvent("error", value) },
    { id: ORION_CONTRIBUTION_IDS.claudeEvent, event: "orion.claude.event", handle: handleClaudeEvent },
    { id: ORION_CONTRIBUTION_IDS.claudeExitEvent, event: "orion.claude.exit", handle: handleClaudeExit },
  ];
  for (const event of events) subscriptions.add(internalEventRegistry.register(ownerId, event));

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  subscriptions.add(() => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  });
  subscriptions.add(
    internalEventRegistry.register(ownerId, {
      id: ORION_CONTRIBUTION_IDS.fileRefreshEvent,
      event: "orion.file.refresh",
      handle: () => {
        if (refreshTimer) return;
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          useFileTreeRefresh.getState().bump();
        }, 750);
      },
    }),
  );
}
