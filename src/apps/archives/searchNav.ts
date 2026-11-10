import { getChatById, type SearchHit } from "@/lib/db";
import { useArchives } from "@/apps/archives/useArchives";
import { archivesHost, revealArchives } from "@/apps/archives/host";
import { useAppChat, type AppChatMessage, type AppChatThread } from "@/store/appChatStore";
import { log } from "@/lib/log";

/**
 * Resume a conversation by chat id. Archives chats (origin 'archives', or a
 * legacy null origin without a project) restore into the Archives rail.
 * Anything else goes to the host: in Orion Studio that opens the owning app
 * (Orion editor, XDesign, R.O.S.I.E); the standalone app has none.
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

  const ownChat = row.origin === "archives" || (!row.origin && !row.project_id);
  if (!ownChat) {
    if (!(await archivesHost().openForeignChat(row, messages))) {
      log.warn("openChatById: no app can open this chat", chatId, row.origin);
    }
    return;
  }

  const appChatMessages: AppChatMessage[] = Array.isArray(messages)
    ? (messages as Array<unknown>)
        .filter(
          (m): m is { id: string; role: "user" | "assistant"; content: string } =>
            !!m &&
            typeof m === "object" &&
            ((m as { role?: string }).role === "user" || (m as { role?: string }).role === "assistant") &&
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
  useAppChat.getState().restoreThread("archives", restored);
  revealArchives();
}

/**
 * Navigate to a search hit. Shared between the Archives sidebar search and
 * the global palette (⌘K) so both surfaces stay in sync about what
 * "opening" each entity kind means.
 */
export async function routeToSearchHit(hit: SearchHit): Promise<void> {
  const archives = useArchives.getState();

  if (hit.entityType === "asset") {
    revealArchives();
    archives.setView("media");
    archives.setPreviewingAssetId(hit.entityId);
    return;
  }

  if (hit.entityType === "chat") {
    await openChatById(hit.entityId);
    return;
  }

  // Notes — route by kind.
  revealArchives();
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
