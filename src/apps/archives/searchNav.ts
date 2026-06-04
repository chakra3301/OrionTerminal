import { getChatById, type SearchHit } from "@/lib/db";
import { useArchives } from "@/apps/archives/useArchives";
import { useShell } from "@/shell/store/useShell";
import { useChatStore } from "@/store/chatStore";
import { useAppChat, type AppChatMessage, type AppChatThread } from "@/store/appChatStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { useLayoutStore } from "@/store/layoutStore";
import { log } from "@/lib/log";

/**
 * Resume a Claude conversation by chat id. Routes by `origin` first (set
 * since migration 0012), then falls back to `project_id`:
 *   - origin='xdesign' → useAppChat.threads.xdesign + open XDesign
 *   - origin='orion' or project_id set → useChatStore + open Orion claude tab
 *   - origin='archives' or null (legacy) → useAppChat.threads.archives + open Archives
 * Safe to call from anywhere (sidebar search, command palette, Past chats list).
 */
export async function openChatById(chatId: string): Promise<void> {
  const row = await getChatById(chatId);
  if (!row) {
    log.warn("openChatById: chat not found", chatId);
    return;
  }
  let messages: unknown = [];
  try {
    messages = JSON.parse(row.messages_json);
  } catch {
    messages = [];
  }

  // R.O.S.I.E lives in its own store + floating overlay. Resume there
  // directly rather than rebuilding the message shape for the app-chat path.
  if (row.origin === "rosie") {
    const m = await import("@/features/rosie/rosieStore");
    await m.useRosie.getState().loadThread(row.id);
    m.useRosie.getState().openPanel();
    return;
  }

  // Orion has a different message shape (tool blocks, etc.) — keep its
  // restore path distinct from the simple {role,content} app-chat path.
  if (row.origin === "orion" || (!row.origin && row.project_id)) {
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
    return;
  }

  const appChatMessages: AppChatMessage[] = Array.isArray(messages)
    ? (messages as Array<unknown>)
        .filter(
          (m): m is { id: string; role: "user" | "assistant"; content: string } =>
            !!m &&
            typeof m === "object" &&
            (("role" in (m as object) && (m as { role: string }).role === "user") ||
              (m as { role: string }).role === "assistant") &&
            typeof (m as { content: unknown }).content === "string",
        )
        .map((m) => ({
          id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
          role: m.role,
          content: m.content,
        }))
    : [];

  const restored: AppChatThread = {
    threadId: row.id,
    title: row.title,
    messages: appChatMessages,
    running: false,
    pendingAssistantId: null,
    activeStreamId: null,
    sessionId: row.session_id,
    totalCostUsd: row.total_cost_usd,
    error: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.origin === "xdesign") {
    useAppChat.getState().restoreThread("xdesign", restored);
    useShell.getState().openApp("xdesign");
    return;
  }
  useAppChat.getState().restoreThread("archives", restored);
  useShell.getState().openApp("archives");
}

/**
 * Navigate to a search hit. Shared between the Archives sidebar search and
 * the global Spotlight (⌘K) so both surfaces stay in sync about what
 * "opening" each entity kind means.
 */
export async function routeToSearchHit(hit: SearchHit): Promise<void> {
  const archives = useArchives.getState();

  if (hit.entityType === "asset") {
    useShell.getState().openApp("archives");
    archives.setView("media");
    archives.setPreviewingAssetId(hit.entityId);
    return;
  }

  if (hit.entityType === "chat") {
    await openChatById(hit.entityId);
    return;
  }

  // Notes — route by kind.
  useShell.getState().openApp("archives");
  switch (hit.noteKind) {
    case "project":
      archives.setView("projects");
      archives.setOpenProjectId(hit.entityId);
      return;
    case "journal":
      archives.setView("journal");
      archives.setSelectedNoteId(hit.entityId);
      return;
    case "note":
    default:
      archives.setView("notes");
      archives.setOpenNoteId(hit.entityId);
      return;
  }
}
