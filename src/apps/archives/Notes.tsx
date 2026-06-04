import { useMemo, useState } from "react";
import { Plus, Search, ArrowLeft, Trash2, Star } from "lucide-react";
import { useNotesStore, type Note } from "@/store/notesStore";
import { useArchives } from "@/apps/archives/useArchives";
import { NoteEditor } from "@/features/notes/NoteEditor";
import { NoteCollectionChip } from "@/apps/archives/NoteCollectionChip";
import { NoteTagsRow } from "@/apps/archives/NoteTagsRow";
import { useContextMenu } from "@/components/ContextMenu";
import { noteMenuItems } from "@/apps/archives/itemMenus";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { log } from "@/lib/log";

function noteAccent(idx: number): string {
  return ["green", "cyan", "magenta", "yellow", "violet"][idx % 5]!;
}

function formatRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function ArchivesNotes() {
  const notes = useNotesStore((s) => s.notes);
  const removeNote = useNotesStore((s) => s.remove);
  const [query, setQuery] = useState("");
  // Lifted to useArchives so external code (sidebar search, command palette)
  // can deep-link into a specific note via setOpenNoteId.
  const openNoteId = useArchives((s) => s.openNoteId);
  const setOpenNoteId = useArchives((s) => s.setOpenNoteId);
  const ctx = useContextMenu();

  const openNote = openNoteId ? notes.get(openNoteId) : null;

  const selectedCollectionId = useArchives((s) => s.selectedCollectionId);
  const selectedTag = useArchives((s) => s.selectedTag);

  const filtered = useMemo(() => {
    let all = Array.from(notes.values())
      .filter((n) => n.kind === "note")
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (selectedCollectionId) {
      all = all.filter((n) => n.collectionId === selectedCollectionId);
    }
    if (selectedTag) {
      all = all.filter((n) => n.tags.includes(selectedTag));
    }
    if (!query.trim()) return all;
    const needle = query.toLowerCase();
    return all.filter(
      (n) =>
        n.title.toLowerCase().includes(needle) ||
        n.plaintext.toLowerCase().includes(needle),
    );
  }, [notes, query, selectedCollectionId, selectedTag]);

  const now = Date.now();

  const createAndOpen = async () => {
    try {
      const note = await useNotesStore.getState().create(null, "note");
      setOpenNoteId(note.id);
    } catch (e) {
      log.error("note create failed", e);
    }
  };

  const handleDelete = async () => {
    if (!openNote) return;
    const ok = await confirmDialog(
      `Delete "${openNote.title || "Untitled"}"? This cannot be undone.`,
      { title: "Delete note", kind: "warning" },
    );
    if (!ok) return;
    await removeNote(openNote.id);
    setOpenNoteId(null);
  };

  // ── Editor view ──────────────────────────────────────────────
  if (openNote) {
    return (
      <div className="ar-notes-detail">
        <div className="ar-notes-detail-bar">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setOpenNoteId(null)}
            title="Back to notes"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="ar-notes-detail-crumb">
            <span style={{ color: "var(--t-tertiary)" }}>Notes</span>
            <span style={{ color: "var(--t-faint)", margin: "0 6px" }}>/</span>
            <span>{openNote.title.trim() || "Untitled"}</span>
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="icon-btn ar-notes-danger"
            onClick={() => void handleDelete()}
            title="Delete note"
          >
            <Trash2 size={13} />
          </button>
        </div>
        <div className="note-page ar-notes-editor">
          <div className="ar-note-meta-bar">
            <NoteCollectionChip noteId={openNote.id} />
            <NoteTagsRow noteId={openNote.id} />
          </div>
          <NoteEditor key={openNote.id} noteId={openNote.id} />
        </div>
      </div>
    );
  }

  // ── Grid view ────────────────────────────────────────────────
  return (
    <div className="ar-notes scroll">
      {ctx.menu}
      <div className="ar-notes-toolbar">
        <div className="ar-notes-search">
          <Search size={12} color="var(--t-tertiary)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter notes…"
          />
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="ar-new-btn"
          onClick={() => void createAndOpen()}
          title="New note (⌘N)"
        >
          <Plus size={12} /> New note
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="ar-empty-state">
          <div className="title">No notes yet.</div>
          <div className="hint">⌘N to create your first one.</div>
        </div>
      ) : (
        <div className="ar-notes-grid">
          {filtered.map((n, i) => {
            const accent = noteAccent(i);
            const preview = n.plaintext.slice(0, 240);
            return (
              <button
                type="button"
                key={n.id}
                className="ar-note-card"
                onClick={() => setOpenNoteId(n.id)}
                onContextMenu={(e) =>
                  ctx.openAt(
                    e,
                    noteMenuItems(n, {
                      onOpen: () => setOpenNoteId(n.id),
                      onDeleted: () => {
                        if (openNoteId === n.id) setOpenNoteId(null);
                      },
                    }),
                  )
                }
                title={n.title || "Untitled"}
              >
                <div className="row">
                  <span className={`tag ${accent}`}>#note</span>
                  {n.favorite && (
                    <span className="ar-fav-badge" title="Favorite">
                      <Star size={11} fill="currentColor" />
                    </span>
                  )}
                  <span className="when">{formatRelative(n.updatedAt, now)}</span>
                </div>
                <div className="title">{n.title.trim() || "Untitled"}</div>
                <div className="preview">
                  {preview || (
                    <span style={{ color: "var(--t-faint)", fontStyle: "italic" }}>
                      (empty)
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Suppress unused — `Note` type is exported above for typing call sites.
export type { Note };
