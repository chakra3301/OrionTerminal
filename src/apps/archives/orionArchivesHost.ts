/**
 * Orion Studio's implementation of the Archives host: Archives is a window
 * in the in-canvas shell, Orion editor/XDesign/R.O.S.I.E chats open in their
 * own apps, and RepoLens website clones open in the Orion editor. Only Orion
 * imports this file; the standalone Archives 47 build never does.
 */
import { setArchivesHost } from "@/apps/archives/host";
import { useShell } from "@/shell/store/useShell";
import { appRegistry } from "@/plugins/appRegistry";
import { useChatStore } from "@/store/chatStore";
import { useAppChat, type AppChatMessage, type AppChatThread } from "@/store/appChatStore";
import { activeTabInFocusedPanel, allTabs, useWorkspace } from "@/components/workspace/workspaceStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useProjectStore } from "@/store/projectStore";
import { usePreviewStore } from "@/store/previewStore";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";
import type { ChatRow } from "@/lib/db";
import { setNoteViewSync } from "@/store/notesStore";
import { setOrionUriFallback } from "@/lib/orionProtocol";

// Stable per-rip dev-server port in an uncommon range (avoids the default 3000),
// so reopening the same clone reuses its port and different clones don't collide.
export function devPort(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 4300 + (h % 400);
}

function appChatMessages(messages: unknown): AppChatMessage[] {
  return Array.isArray(messages)
    ? (messages as Array<unknown>)
        .filter(
          (m): m is { id: string; role: "user" | "assistant"; content: string } =>
            !!m &&
            typeof m === "object" &&
            ((m as { role?: string }).role === "user" || (m as { role?: string }).role === "assistant") &&
            typeof (m as { content: unknown }).content === "string",
        )
        .map((m) => ({ id: typeof m.id === "string" ? m.id : crypto.randomUUID(), role: m.role, content: m.content }))
    : [];
}

async function openForeignChat(row: ChatRow, messages: unknown): Promise<boolean> {
  if (row.origin === "rosie") {
    const m = await import("@/features/rosie/rosieStore");
    await m.useRosie.getState().loadThread(row.id);
    m.useRosie.getState().openPanel();
    return true;
  }
  if (row.origin === "orion" || (!row.origin && row.project_id)) {
    if (!appRegistry.has("orion")) {
      log.warn("openChatById: Orion editor plugin is disabled", row.id);
      return true;
    }
    useChatStore.getState().setActive({
      id: row.id,
      title: row.title,
      sessionId: row.session_id,
      projectId: row.project_id,
      messages: Array.isArray(messages) ? (messages as never[]) : [],
      totalCostUsd: row.total_cost_usd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    useShell.getState().openApp("orion");
    useWorkspace.getState().openTab({ kind: "claude" });
    useLayoutStore.getState().setRightOpen(true);
    return true;
  }
  if (row.origin === "xdesign") {
    if (!appRegistry.has("xdesign")) {
      log.warn("openChatById: XDesign plugin is disabled", row.id);
      return true;
    }
    const restored: AppChatThread = {
      threadId: row.id,
      title: row.title,
      messages: appChatMessages(messages),
      running: false,
      pendingAssistantId: null,
      activeStreamId: null,
      sessionId: row.session_id,
      totalCostUsd: row.total_cost_usd,
      error: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    useAppChat.getState().restoreThread("xdesign", restored);
    useShell.getState().openApp("xdesign");
    return true;
  }
  return false;
}

async function openWebsiteClone(projectPath: string, ripId: string): Promise<void> {
  if (!appRegistry.has("orion")) {
    toast.warning("Enable the Orion editor plugin to open this clone");
    return;
  }
  await useProjectStore.getState().openProjectAtPath(projectPath);
  useShell.getState().openApp("orion");

  const port = devPort(ripId);
  const previewUrl = `http://localhost:${port}`;

  // The per-project workspace swap (App.tsx `useProjectScopedLayout`) hydrates
  // the new project's layout asynchronously after a DB read, so defer past it,
  // then build the clone's working view from scratch.
  setTimeout(() => {
    void (async () => {
      const { defaultOrionLayout } = await import("@/components/workspace/workspaceStore");
      useWorkspace.getState().resetLayout(defaultOrionLayout);
      const candidates = [`${projectPath}/src/app/page.tsx`, `${projectPath}/README.md`, `${projectPath}/package.json`];
      for (const path of candidates) {
        const exists = await ipc.pathExists(path).catch(() => false);
        if (exists) {
          useWorkspace.getState().openTab(
            { kind: "file", path },
            { label: path.split("/").pop() ?? "page.tsx", preferRole: "editor" },
          );
          break;
        }
      }
      useWorkspace.getState().openTab(
        { kind: "terminal", id: `webdev-${ripId}`, initialCommand: `npm run dev -- -p ${port}` },
        { label: "dev server" },
      );
      usePreviewStore.getState().setMode("web");
      usePreviewStore.getState().setUrl(previewUrl);
    })();
  }, 300);

  // The dev server takes a few seconds to compile; reload the preview as it
  // comes up so the iframe lands on the live clone without a manual reload.
  setTimeout(() => usePreviewStore.getState().reload(), 7000);
  setTimeout(() => usePreviewStore.getState().reload(), 14000);
  toast.info("Starting the clone's dev server — the preview will go live shortly.");
}

/** Returns a disposer that restores the previous Archives host. Note-tab sync
 * and the orion:// fallback stay installed: they only act on Orion workspace tabs. */
export function installOrionArchivesHost(): () => void {
  setOrionUriFallback((ref) => {
    if (!appRegistry.has("orion")) return false;
    if (ref.kind === "note") useWorkspace.getState().openTab({ kind: "note", noteId: ref.id });
    else if (ref.kind === "asset") useWorkspace.getState().openTab({ kind: "asset-detail", assetId: ref.id });
    else return false;
    return true;
  });
  setNoteViewSync({
    setLabel: (noteId, label) => {
      const ws = useWorkspace.getState();
      const tab = allTabs(ws.root).find((t) => t.descriptor.kind === "note" && t.descriptor.noteId === noteId);
      if (tab) ws.setLabel(tab.id, label);
    },
    closeNote: (noteId) => {
      const ws = useWorkspace.getState();
      for (const t of allTabs(ws.root)) {
        if (t.descriptor.kind === "note" && t.descriptor.noteId === noteId) ws.closeTab(t.id);
      }
    },
  });
  return setArchivesHost({
    reveal: () => {
      useShell.getState().openApp("archives");
    },
    canShowChatOrigin: (origin) =>
      (origin !== "orion" || appRegistry.has("orion")) && (origin !== "xdesign" || appRegistry.has("xdesign")),
    openForeignChat,
    openWebsiteClone,
    focusedNoteId: () => {
      const workspace = useWorkspace.getState();
      const tab = activeTabInFocusedPanel(workspace.root, workspace.focusedPanelId);
      return tab?.descriptor.kind === "note" ? tab.descriptor.noteId : null;
    },
    closeNoteViews: () => {
      const workspace = useWorkspace.getState();
      for (const tab of allTabs(workspace.root)) {
        if (tab.descriptor.kind === "note") workspace.closeTab(tab.id);
      }
    },
    productName: "Orion Studio",
  });
}
