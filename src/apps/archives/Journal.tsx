import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Sparkles, MapPin, Star } from "lucide-react";
import { useNotesStore } from "@/store/notesStore";
import { useArchives } from "@/apps/archives/useArchives";
import { NoteEditor } from "@/features/notes/NoteEditor";
import { NoteCollectionChip } from "@/apps/archives/NoteCollectionChip";
import { NoteTagsRow } from "@/apps/archives/NoteTagsRow";
import { useContextMenu } from "@/components/ContextMenu";
import { noteMenuItems } from "@/apps/archives/itemMenus";
import { log } from "@/lib/log";

function formatStamp(ms: number): string {
  const d = new Date(ms);
  return d
    .toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .toUpperCase();
}

function formatDateHero(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  const date = d
    .toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return { date, time };
}

export function ArchivesJournal() {
  const notes = useNotesStore((s) => s.notes);
  const loaded = useNotesStore((s) => s.loaded);
  const pendingWrites = useNotesStore((s) => s.pendingWrites);
  const saveLocation = useNotesStore((s) => s.saveLocation);
  const selectedNoteId = useArchives((s) => s.selectedNoteId);
  const setSelectedNoteId = useArchives((s) => s.setSelectedNoteId);
  const ctx = useContextMenu();

  const selectedCollectionId = useArchives((s) => s.selectedCollectionId);

  const ordered = useMemo(() => {
    const all = Array.from(notes.values())
      .filter((n) => n.kind === "journal")
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return selectedCollectionId
      ? all.filter((n) => n.collectionId === selectedCollectionId)
      : all;
  }, [notes, selectedCollectionId]);

  useEffect(() => {
    if (selectedNoteId && notes.has(selectedNoteId)) return;
    const first = ordered[0];
    setSelectedNoteId(first?.id ?? null);
  }, [selectedNoteId, ordered, notes, setSelectedNoteId]);

  const createAndOpen = async () => {
    try {
      const note = await useNotesStore.getState().create(null, "journal");
      setSelectedNoteId(note.id);
    } catch (e) {
      log.error("note create failed", e);
    }
  };

  // Don't gate on loaded — the empty state covers it. The previous gate
  // could stick when `load()` failed silently. (Now load() always flips
  // loaded=true even on error, but keeping this permissive is healthier.)
  if (!loaded && notes.size === 0) {
    return <div className="ar-journal-loading">Loading notes…</div>;
  }

  if (ordered.length === 0) {
    return (
      <div className="ar-empty-state ar-journal-empty">
        <Sparkles size={20} color="var(--neon-green)" />
        <div className="title">Nothing in the journal yet.</div>
        <div className="hint">
          Start the first entry — Claude will start spotting patterns once you
          write a few.
        </div>
        <button
          type="button"
          className="ar-new-btn"
          onClick={() => void createAndOpen()}
        >
          <Plus size={12} /> New entry
        </button>
      </div>
    );
  }

  const selected = selectedNoteId ? notes.get(selectedNoteId) : null;

  return (
    <div className="ar-journal">
      {ctx.menu}
      <aside className="ar-journal-rail scroll">
        <div className="ar-journal-rail-head">
          <span>Entries</span>
          <button
            type="button"
            className="ar-rail-add"
            onClick={() => void createAndOpen()}
            title="New entry (⌘N)"
          >
            <Plus size={11} />
          </button>
        </div>
        {ordered.map((n) => {
          const active = n.id === selectedNoteId;
          const dirty = pendingWrites.has(n.id);
          return (
            <button
              type="button"
              key={n.id}
              className={`ar-journal-rail-item${active ? " active" : ""}`}
              onClick={() => setSelectedNoteId(n.id)}
              onContextMenu={(e) =>
                ctx.openAt(
                  e,
                  noteMenuItems(n, {
                    noun: "entry",
                    onOpen: () => setSelectedNoteId(n.id),
                    onDeleted: () => {
                      if (selectedNoteId === n.id) setSelectedNoteId(null);
                    },
                  }),
                )
              }
            >
              <div className="title">
                {n.favorite && (
                  <Star
                    size={10}
                    fill="currentColor"
                    style={{ color: "var(--neon-yellow)", marginRight: 4 }}
                  />
                )}
                {n.title.trim() || "Untitled"}
                {dirty && (
                  <span className="dot" style={{ color: "var(--neon-yellow)" }}>
                    {" "}
                    ●
                  </span>
                )}
              </div>
              <div className="stamp">{formatStamp(n.updatedAt)}</div>
              {n.location && (
                <div className="location">
                  <MapPin size={9} /> {n.location}
                </div>
              )}
            </button>
          );
        })}
      </aside>
      <div className="ar-journal-editor note-page">
        {selected ? (
          <>
            <JournalMetaBanner
              entry={selected}
              onLocationChange={(loc) => void saveLocation(selected.id, loc)}
            />
            <div className="ar-note-meta-bar">
              <NoteCollectionChip noteId={selected.id} />
              <NoteTagsRow noteId={selected.id} />
            </div>
            <NoteEditor key={selected.id} noteId={selected.id} />
          </>
        ) : (
          <div className="ar-empty-state" style={{ flex: 1 }}>
            <div className="title">No entry selected.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function JournalMetaBanner({
  entry,
  onLocationChange,
}: {
  entry: { createdAt: number; location: string };
  onLocationChange: (location: string) => void;
}) {
  const { date, time } = formatDateHero(entry.createdAt);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.location);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(entry.location);
  }, [entry.location]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== entry.location) onLocationChange(trimmed);
  };

  return (
    <header className="journal-meta">
      <div className="journal-meta-date">{date}</div>
      <div className="journal-meta-row">
        <span className="journal-meta-time">{time}</span>
        <span className="journal-meta-sep">·</span>
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            className="journal-meta-location-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setDraft(entry.location);
                setEditing(false);
              }
            }}
            placeholder="Add a location"
          />
        ) : (
          <button
            type="button"
            className={`journal-meta-location${entry.location ? "" : " empty"}`}
            onClick={() => setEditing(true)}
            title="Set location"
          >
            <MapPin size={11} />
            {entry.location || "Add location"}
          </button>
        )}
      </div>
    </header>
  );
}
