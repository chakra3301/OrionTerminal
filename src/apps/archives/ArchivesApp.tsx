import { useEffect, useRef, useState } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import {
  Sun,
  BookOpen,
  FolderKanban,
  StickyNote,
  Image,
  Film,
  MessageSquare,
  Star,
  ScanSearch,
} from "lucide-react";
import { ClaudeChat, type ClaudeChatMessage } from "@/components/ClaudeChat";
import { archivesClaude } from "@/apps/archives/claude";
import { useAppChat, registerStream, forgetStream } from "@/store/appChatStore";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { useArchives, type ArchivesView } from "@/apps/archives/useArchives";
import { useNotesStore } from "@/store/notesStore";
import { setNoteNavigator } from "@/lib/orionProtocol";
import { useAssetsStore } from "@/store/assetsStore";
import { useMoodBoardsStore } from "@/store/moodBoardsStore";
import { listAllChats, upsertChat } from "@/lib/db";
import { scheduleReindex } from "@/lib/embeddingIndexer";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { useFileDropZone } from "@/lib/fileDrop";
import { ArchivesToday } from "@/apps/archives/Today";
import { ArchivesNotes } from "@/apps/archives/Notes";
import { ArchivesJournal } from "@/apps/archives/Journal";
import { ArchivesProjects } from "@/apps/archives/Projects";
import { ArchivesMedia } from "@/apps/archives/Media";
import { ArchivesMood } from "@/apps/archives/Mood";
import { ArchivesChats } from "@/apps/archives/Chats";
import { ArchivesDatabase } from "@/apps/archives/database/ArchivesDatabase";
import { RepoLensView } from "@/apps/archives/repolens/RepoLensView";
import { ArchivesFavorites } from "@/apps/archives/Favorites";
import { ArchivesToolbar } from "@/apps/archives/Toolbar";
import { AssetPreviewModal } from "@/apps/archives/AssetPreviewModal";
import { SidebarCollections } from "@/apps/archives/SidebarCollections";
import { SidebarTags } from "@/apps/archives/SidebarTags";
import { SidebarSearch } from "@/apps/archives/SidebarSearch";

type NavItem = {
  key: ArchivesView;
  label: string;
  Icon: typeof Sun;
};

const LIBRARY: NavItem[] = [
  { key: "today", label: "Today", Icon: Sun },
  { key: "journal", label: "Journal", Icon: BookOpen },
  { key: "projects", label: "Projects", Icon: FolderKanban },
  { key: "repolens", label: "RepoLens", Icon: ScanSearch },
  { key: "notes", label: "Notes", Icon: StickyNote },
  { key: "mood", label: "Mood Boards", Icon: Image },
  { key: "media", label: "Media", Icon: Film },
  { key: "favorites", label: "Favorites", Icon: Star },
  { key: "chats", label: "Past chats", Icon: MessageSquare },
];


// Tracks which Archives thread ids have been persisted at least once during
// this session. The first persist of a brand-new thread bumps the sidebar's
// chats badge; subsequent updates don't increment again.
const knownChatIds = new Set<string>();

export function ArchivesApp() {
  const view = useArchives((s) => s.view);
  const setView = useArchives((s) => s.setView);
  const noteCount = useArchives((s) => s.noteCount);
  const chatCount = useArchives((s) => s.chatCount);
  const setCounts = useArchives((s) => s.setCounts);

  const notes = useNotesStore((s) => s.notes);
  const assets = useAssetsStore((s) => s.assets);
  const ingestPaths = useAssetsStore((s) => s.ingestPaths);
  const ingestBlobs = useAssetsStore((s) => s.ingestBlobs);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    setCounts({ notes: notes.size, assets: assets.size });
  }, [notes.size, assets.size, setCounts]);

  // Route orion://note clicks (from [[wikilinks]] / backlinks) within
  // Archives by the note's kind, instead of opening an Orion workspace tab.
  useEffect(() => {
    setNoteNavigator((id) => {
      const note = useNotesStore.getState().notes.get(id);
      if (!note) return false;
      const a = useArchives.getState();
      if (note.kind === "journal") {
        a.setView("journal");
        a.setSelectedNoteId(id);
      } else if (note.kind === "project") {
        a.setView("projects");
        a.setOpenProjectId(id);
      } else {
        a.setView("notes");
        a.setOpenNoteId(id);
      }
      return true;
    });
    return () => setNoteNavigator(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listAllChats(500)
      .then((chats) => {
        if (cancelled) return;
        setCounts({ chats: chats.length });
        for (const c of chats) knownChatIds.add(c.id);
      })
      .catch((e) => log.error("archives counts failed", e));
    return () => {
      cancelled = true;
    };
  }, [setCounts]);

  // Clipboard paste pipeline: when the user copies an image (screenshot,
  // copied from a browser, etc.) and pastes anywhere inside Archives, we
  // pull the blob out of clipboardData and ingest it. If a mood board is
  // currently open, the pasted assets also get added to that board so
  // ⌘V "just works" when capturing into a board.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const blobs: Array<{ blob: Blob; suggestedName: string }> = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        blobs.push({
          blob: file,
          suggestedName: file.name || "pasted",
        });
      }
      if (blobs.length === 0) return;
      e.preventDefault();
      void ingestAndMaybeAddToBoard(() => ingestBlobs(blobs));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [ingestBlobs]);

  // Native Finder drops are intercepted by Tauri (not DOM `onDrop`); they
  // come through the central orchestrator (see lib/fileDrop). Archives'
  // ingest behavior is its zone's drop handler — also routes assets into the
  // open mood board when Mood detail is visible.
  const shellRef = useRef<HTMLDivElement>(null);
  useFileDropZone(shellRef, "archives", (e) => {
    if (e.type === "enter") setDropActive(true);
    else if (e.type === "leave") setDropActive(false);
    else {
      setDropActive(false);
      if (e.paths.length > 0) {
        void ingestAndMaybeAddToBoard(() => ingestPaths(e.paths));
      }
    }
  });

  const thread = useAppChat((s) => s.threads.archives);
  const appendUser = useAppChat((s) => s.appendUser);
  const beginAssistant = useAppChat((s) => s.beginAssistant);
  const setError = useAppChat((s) => s.setError);
  const newThread = useAppChat((s) => s.newThread);

  // Debounced persist for Archives chats. Mirrors OrionClaudeRail's pattern
  // — write the whole thread row 600ms after the last mutation so streaming
  // doesn't thrash sqlite. Skips empty threads (the fresh thread that gets
  // created on app boot has zero messages and shouldn't show in Past chats).
  useEffect(() => {
    if (thread.messages.length === 0) return;
    const id = setTimeout(() => {
      const wasNew = !knownChatIds.has(thread.threadId);
      knownChatIds.add(thread.threadId);
      void upsertChat({
        id: thread.threadId,
        title: thread.title || thread.messages[0]?.content.slice(0, 80) || "Untitled",
        messages_json: JSON.stringify(thread.messages),
        searchable_text: thread.messages
          .map((m) => m.content)
          .filter(Boolean)
          .join("\n"),
        session_id: thread.sessionId,
        project_id: null,
        total_cost_usd: thread.totalCostUsd,
        origin: "archives",
        created_at: thread.createdAt,
        updated_at: thread.updatedAt,
      });
      scheduleReindex("chat", thread.threadId, () => {
        const cur = useAppChat.getState().threads.archives;
        if (!cur || cur.threadId !== thread.threadId) return null;
        const title =
          cur.title || cur.messages[0]?.content.slice(0, 80) || "Untitled";
        const body = cur.messages
          .map((m) => m.content)
          .filter(Boolean)
          .join("\n");
        return `${title}\n${body}`;
      });
      if (wasNew) {
        setCounts({ chats: useArchives.getState().chatCount + 1 });
      }
    }, 600);
    return () => clearTimeout(id);
  }, [thread, setCounts]);

  const handleSend = async (text: string) => {
    appendUser("archives", text);
    const chatId = thread.threadId;
    registerStream(chatId, "archives");
    beginAssistant("archives", chatId);
    try {
      const isFirstTurn = !thread.sessionId;
      const prompt = isFirstTurn
        ? `${archivesClaude.systemPrompt}\n\n---\n\n${text}`
        : text;
      await ipc.claudeSend(
        chatId,
        prompt,
        null,
        thread.sessionId,
        null,
        useModelPrefs.getState().modelFor("archives"),
      );
    } catch (e) {
      log.error("archives chat send failed", e);
      forgetStream(chatId);
      setError("archives", e instanceof Error ? e.message : String(e));
    }
  };

  const handleCancel = () => {
    void ipc.claudeCancel(thread.threadId);
  };

  const chatMessages: ClaudeChatMessage[] = thread.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    pending: m.pending,
  }));

  const subtitle = formatSubtitle(noteCount, chatCount);

  // Collapsible panels
  const sidebarRef = useRef<ImperativePanelHandle>(null);
  const chatRef = useRef<ImperativePanelHandle>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);

  // When a mood board is open, the drop overlay surfaces the board name so
  // the user knows their drop also adds to that board.
  const openBoardId = useArchives((s) => s.openBoardId);
  const openBoardTitle = useMoodBoardsStore((s) =>
    openBoardId ? s.boards.get(openBoardId)?.title ?? null : null,
  );
  const dropContextLabel =
    view === "mood" && openBoardTitle
      ? `Drop to add to "${openBoardTitle}"`
      : "Drop to capture";
  const dropContextHint =
    view === "mood" && openBoardTitle
      ? "Files land on this board · also copied to your Media library."
      : "Files land in Archives → Media. Drag-drop, paste, or use ⌘N to create a note.";

  const toggleSidebar = () => {
    const panel = sidebarRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };
  const toggleChat = () => {
    const panel = chatRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  return (
    <div className="ar-shell" ref={shellRef}>
      <AssetPreviewModal />
      {dropActive && (
        <div className="ar-drop-overlay" aria-hidden>
          <div className="ar-drop-card">
            <div className="title">{dropContextLabel}</div>
            <div className="hint">{dropContextHint}</div>
          </div>
        </div>
      )}
      <PanelGroup direction="horizontal" autoSaveId="archives-shell">
        <Panel
          ref={sidebarRef}
          id="ar-sidebar"
          order={1}
          collapsible
          collapsedSize={0}
          minSize={14}
          defaultSize={18}
          maxSize={32}
          onCollapse={() => setSidebarOpen(false)}
          onExpand={() => setSidebarOpen(true)}
        >
          <ArchivesSidebar
            view={view}
            setView={setView}
            noteCount={noteCount}
          />
        </Panel>

        {sidebarOpen && <PanelResizeHandle className="ot-resize-handle vertical" />}

        <Panel id="ar-main" order={2} minSize={30}>
          <main className="ar-main">
            <ArchivesToolbar
              view={view}
              sidebarOpen={sidebarOpen}
              chatOpen={chatOpen}
              onToggleSidebar={toggleSidebar}
              onToggleChat={toggleChat}
            />

            <div className="ar-view-host">
              {view === "today" && <ArchivesToday />}
              {view === "journal" && <ArchivesJournal />}
              {view === "projects" && <ArchivesProjects />}
              {view === "notes" && <ArchivesNotes />}
              {view === "mood" && <ArchivesMood />}
              {view === "media" && <ArchivesMedia />}
              {view === "favorites" && <ArchivesFavorites />}
              {view === "chats" && <ArchivesChats />}
              {view === "database" && <ArchivesDatabase />}
              {view === "repolens" && <RepoLensView />}
            </div>
          </main>
        </Panel>

        {chatOpen && <PanelResizeHandle className="ot-resize-handle vertical" />}

        <Panel
          ref={chatRef}
          id="ar-chat"
          order={3}
          collapsible
          collapsedSize={0}
          minSize={16}
          defaultSize={24}
          maxSize={44}
          onCollapse={() => setChatOpen(false)}
          onExpand={() => setChatOpen(true)}
        >
          <div className="ar-claude-pane">
            <ClaudeChat
              appId="archives"
              name={archivesClaude.name}
              subtitle={subtitle}
              accentColor={archivesClaude.accentColor}
              systemPrompt={archivesClaude.systemPrompt}
              openingLine={
                thread.messages.length === 0 ? archivesClaude.openingLine : undefined
              }
              suggestionChips={archivesClaude.suggestionChips}
              placeholder={thread.error ?? "Ask the archive…"}
              messages={chatMessages}
              running={thread.running}
              cost={thread.totalCostUsd}
              onSend={handleSend}
              onCancel={handleCancel}
              onNewChat={() => newThread("archives")}
            />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

function ArchivesSidebar({
  view,
  setView,
  noteCount,
}: {
  view: ArchivesView;
  setView: (v: ArchivesView) => void;
  noteCount: number;
}) {
  const chatCount = useArchives((s) => s.chatCount);
  return (
    <aside className="ar-sidebar scroll">
      <SidebarSearch />

      <div className="ar-section">Library</div>
      {LIBRARY.map((it) => {
        const Icon = it.Icon;
        return (
          <button
            type="button"
            key={it.key}
            className={`ar-nav${view === it.key ? " active" : ""}`}
            onClick={() => setView(it.key)}
          >
            <Icon size={14} />
            <span>{it.label}</span>
            <span className="badge">{badgeFor(it.key, noteCount, chatCount)}</span>
          </button>
        );
      })}

      <SidebarCollections />
      <SidebarTags />
    </aside>
  );
}


/**
 * Run an ingest action and, if Mood detail has a board open, also attach
 * the newly-created assets to that board. Centralizes the "drag/paste
 * captures to both Media AND the open board" rule so paste + native drop
 * share the same path.
 */
async function ingestAndMaybeAddToBoard(
  ingest: () => Promise<Array<{ id: string }>>,
) {
  const created = await ingest();
  if (created.length === 0) return;
  const archives = useArchives.getState();
  if (archives.view !== "mood" || !archives.openBoardId) return;
  const boardId = archives.openBoardId;
  const addAsset = useMoodBoardsStore.getState().addAsset;
  for (const a of created) {
    try {
      await addAsset(boardId, a.id);
    } catch (e) {
      log.warn("add-to-board after ingest failed", e);
    }
  }
}

function badgeFor(
  view: ArchivesView,
  noteCount: number,
  chatCount: number,
): string {
  switch (view) {
    case "notes":
      return noteCount.toString();
    case "chats":
      return chatCount > 0 ? chatCount.toString() : "";
    case "today":
      return new Date().toLocaleDateString([], { month: "short", day: "numeric" });
    default:
      return "";
  }
}

function formatSubtitle(notes: number, chats: number): string {
  const parts: string[] = [];
  parts.push(`${notes} ${notes === 1 ? "note" : "notes"}`);
  parts.push(`${chats} ${chats === 1 ? "thread" : "threads"}`);
  return `indexed · ${parts.join(" · ")}`;
}
