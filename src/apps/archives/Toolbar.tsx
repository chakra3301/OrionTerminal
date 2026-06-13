import { useRef } from "react";
import {
  Share2,
  Star,
  Plus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  FileDown,
  FileUp,
  Pencil,
  Trash2,
  RefreshCw,
  Database,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { promptText } from "@/components/PromptModal";
import { useArchives, type ArchivesView } from "@/apps/archives/useArchives";
import { useNotesStore, type Note } from "@/store/notesStore";
import { useAssetsStore } from "@/store/assetsStore";
import { useMoodBoardsStore } from "@/store/moodBoardsStore";
import {
  exportNoteAsMarkdown,
  exportArchiveBackup,
  importMarkdownFiles,
} from "@/apps/archives/exportImport";
import { log } from "@/lib/log";

const VIEW_LABEL: Record<ArchivesView, string> = {
  today: "Today",
  journal: "Journal",
  projects: "Projects",
  notes: "Notes",
  mood: "Mood boards",
  media: "Media library",
  favorites: "Favorites",
  chats: "Past chats",
  database: "Database",
  repolens: "RepoLens",
};

type ActiveItem =
  | { kind: "note"; note: Note; noun: string }
  | { kind: "board"; id: string; title: string; favorite: boolean };

export function ArchivesToolbar({
  view,
  sidebarOpen,
  chatOpen,
  onToggleSidebar,
  onToggleChat,
}: {
  view: ArchivesView;
  sidebarOpen: boolean;
  chatOpen: boolean;
  onToggleSidebar: () => void;
  onToggleChat: () => void;
}) {
  const notes = useNotesStore((s) => s.notes);
  const boards = useMoodBoardsStore((s) => s.boards);
  const openNoteId = useArchives((s) => s.openNoteId);
  const selectedNoteId = useArchives((s) => s.selectedNoteId);
  const openProjectId = useArchives((s) => s.openProjectId);
  const openBoardId = useArchives((s) => s.openBoardId);
  const setView = useArchives((s) => s.setView);

  const ctx = useContextMenu();
  const shareBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);

  // The single "current" item the toolbar acts on, derived from the view +
  // its open-item id. Null on dashboard / grid views (use right-click there).
  const active: ActiveItem | null = (() => {
    if (view === "notes" && openNoteId) {
      const n = notes.get(openNoteId);
      if (n) return { kind: "note", note: n, noun: "note" };
    }
    if (view === "journal" && selectedNoteId) {
      const n = notes.get(selectedNoteId);
      if (n) return { kind: "note", note: n, noun: "entry" };
    }
    if (view === "projects" && openProjectId) {
      const n = notes.get(openProjectId);
      if (n) return { kind: "note", note: n, noun: "project" };
    }
    if (view === "mood" && openBoardId) {
      const b = boards.get(openBoardId);
      if (b)
        return { kind: "board", id: b.id, title: b.title, favorite: b.favorite };
    }
    return null;
  })();

  const isFavorited =
    active?.kind === "note"
      ? active.note.favorite
      : active?.kind === "board"
        ? active.favorite
        : false;

  const toggleActiveFavorite = () => {
    if (!active) return;
    if (active.kind === "note")
      void useNotesStore.getState().toggleFavorite(active.note.id);
    else void useMoodBoardsStore.getState().toggleFavorite(active.id);
  };

  // ── New (per-view create) ──────────────────────────────────────────
  const createForView = async () => {
    const notesStore = useNotesStore.getState();
    const archives = useArchives.getState();
    try {
      switch (view) {
        case "journal": {
          const n = await notesStore.create(null, "journal");
          archives.setSelectedNoteId(n.id);
          break;
        }
        case "projects": {
          const n = await notesStore.create(null, "project");
          archives.setOpenProjectId(n.id);
          break;
        }
        case "mood": {
          const title = await promptText({
            title: "New mood board",
            placeholder: "Board name",
            confirmLabel: "Create",
          });
          if (title == null) return;
          const b = await useMoodBoardsStore.getState().create(title);
          archives.setOpenBoardId(b.id);
          break;
        }
        case "media": {
          await importMediaFiles();
          break;
        }
        default: {
          const n = await notesStore.create(null, "note");
          setView("notes");
          archives.setOpenNoteId(n.id);
        }
      }
    } catch (e) {
      log.error("toolbar create failed", e);
    }
  };

  const newLabel =
    view === "journal"
      ? "New entry"
      : view === "projects"
        ? "New project"
        : view === "mood"
          ? "New board"
          : view === "media"
            ? "Import media"
            : "New note";

  // ── Share (import / export) ─────────────────────────────────────────
  const openShareMenu = () => {
    if (!shareBtn.current) return;
    const items: MenuItem[] = [];
    if (active?.kind === "note") {
      items.push({
        label: `Export "${truncate(active.note.title || "Untitled")}" as Markdown…`,
        icon: <FileDown size={13} />,
        onClick: () =>
          void exportNoteAsMarkdown(active.note).catch((e) =>
            log.warn("export failed", e),
          ),
      });
      items.push({
        label: "Export as PDF…",
        icon: <FileDown size={13} />,
        onClick: () =>
          void import("@/features/notes/exportPdf").then((m) =>
            m.exportOpenNoteToPdf(),
          ),
      });
      items.push({ type: "separator" });
    }
    items.push({
      label: "Export Archives backup (JSON)…",
      icon: <Database size={13} />,
      onClick: () =>
        void exportArchiveBackup(
          Array.from(useNotesStore.getState().notes.values()),
        ).catch((e) => log.warn("backup failed", e)),
    });
    items.push({
      label: "Import notes…",
      icon: <FileUp size={13} />,
      onClick: () => {
        void (async () => {
          const ids = await importMarkdownFiles("note");
          if (ids.length > 0) {
            setView("notes");
            const first = ids[0];
            if (first) useArchives.getState().setOpenNoteId(first);
          }
        })();
      },
    });
    ctx.openFromButton(shareBtn.current, items);
  };

  // ── More (contextual + view actions) ────────────────────────────────
  const openMoreMenu = () => {
    if (!moreBtn.current) return;
    const items: MenuItem[] = [];
    if (active?.kind === "note") {
      const note = active.note;
      const noun = active.noun;
      items.push({
        label: `Rename ${noun}`,
        icon: <Pencil size={13} />,
        onClick: () => {
          void (async () => {
            const name = await promptText({
              title: `Rename ${noun}`,
              initialValue: note.title,
              placeholder: "Title",
              confirmLabel: "Rename",
            });
            if (name != null)
              await useNotesStore.getState().saveTitle(note.id, name);
          })();
        },
      });
      items.push({
        label: note.favorite ? "Remove from favorites" : "Add to favorites",
        icon: <Star size={13} />,
        onClick: toggleActiveFavorite,
      });
      items.push({ type: "separator" });
      items.push({
        label: `Delete ${noun}`,
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: () => {
          void (async () => {
            const ok = await confirmDialog(
              `Delete "${note.title || "Untitled"}"? This cannot be undone.`,
              { title: `Delete ${noun}`, kind: "warning" },
            );
            if (!ok) return;
            await useNotesStore.getState().remove(note.id);
            clearActiveSelection(view);
          })();
        },
      });
      items.push({ type: "separator" });
    } else if (active?.kind === "board") {
      items.push({
        label: "Rename board",
        icon: <Pencil size={13} />,
        onClick: () => {
          void (async () => {
            const name = await promptText({
              title: "Rename board",
              initialValue: active.title,
              placeholder: "Board name",
              confirmLabel: "Rename",
            });
            if (name != null)
              await useMoodBoardsStore.getState().rename(active.id, name);
          })();
        },
      });
      items.push({
        label: active.favorite ? "Remove from favorites" : "Add to favorites",
        icon: <Star size={13} />,
        onClick: toggleActiveFavorite,
      });
      items.push({ type: "separator" });
    }
    items.push({
      label: "Show favorites",
      icon: <Star size={13} />,
      onClick: () => setView("favorites"),
    });
    items.push({
      label: "Refresh",
      icon: <RefreshCw size={13} />,
      onClick: () => {
        void useNotesStore.getState().load();
        void useAssetsStore.getState().load();
        void useMoodBoardsStore.getState().load();
      },
    });
    ctx.openFromButton(moreBtn.current, items);
  };

  return (
    <div className="ar-toolbar">
      {ctx.menu}
      <button
        type="button"
        className="icon-btn"
        onClick={onToggleSidebar}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        {sidebarOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
      </button>
      <div className="crumb">
        <span>Archives 47</span>
        <span className="sep">/</span>
        <span className="here">{VIEW_LABEL[view]}</span>
      </div>
      <div style={{ flex: 1 }} />
      <button
        ref={shareBtn}
        type="button"
        className="icon-btn"
        title="Share · import / export"
        onClick={openShareMenu}
      >
        <Share2 size={13} />
      </button>
      <button
        type="button"
        className={`icon-btn${isFavorited ? " is-fav" : ""}`}
        title={
          active
            ? isFavorited
              ? "Remove from favorites"
              : "Add to favorites"
            : "Open an item to favorite it"
        }
        disabled={!active}
        onClick={toggleActiveFavorite}
      >
        <Star size={13} fill={isFavorited ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={newLabel}
        onClick={() => void createForView()}
      >
        <Plus size={13} />
      </button>
      <button
        ref={moreBtn}
        type="button"
        className="icon-btn"
        title="More options"
        onClick={openMoreMenu}
      >
        <MoreHorizontal size={13} />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={onToggleChat}
        title={chatOpen ? "Hide assistant" : "Show assistant"}
      >
        {chatOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
      </button>
    </div>
  );
}

function clearActiveSelection(view: ArchivesView) {
  const a = useArchives.getState();
  if (view === "notes") a.setOpenNoteId(null);
  else if (view === "journal") a.setSelectedNoteId(null);
  else if (view === "projects") a.setOpenProjectId(null);
}

function truncate(s: string, max = 28): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Native file picker → ingest the chosen files into the Media library. */
async function importMediaFiles() {
  const selection = await openDialog({
    title: "Import media",
    multiple: true,
    filters: [
      {
        name: "Media",
        extensions: [
          "png",
          "jpg",
          "jpeg",
          "gif",
          "webp",
          "bmp",
          "svg",
          "mp4",
          "mov",
          "webm",
          "mp3",
          "wav",
          "m4a",
          "pdf",
        ],
      },
    ],
  });
  if (!selection) return;
  const paths = Array.isArray(selection) ? selection : [selection];
  if (paths.length === 0) return;
  await useAssetsStore.getState().ingestPaths(paths);
}
