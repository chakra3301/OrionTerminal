import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderClosed, X as XIcon } from "lucide-react";
import {
  useCollectionsStore,
  sortCollections,
} from "@/store/collectionsStore";
import { useNotesStore } from "@/store/notesStore";

/**
 * Small inline chip rendered on the note editor surface (Projects pages,
 * Journal entries, Notes detail). Click → dropdown of all collections + an
 * "Uncollected" option. The chip color tracks the assigned collection so
 * pages have an at-a-glance grouping marker.
 */
export function NoteCollectionChip({ noteId }: { noteId: string }) {
  const note = useNotesStore((s) => s.notes.get(noteId));
  const saveCollection = useNotesStore((s) => s.saveCollection);
  const collectionsMap = useCollectionsStore((s) => s.collections);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const collections = sortCollections(collectionsMap);
  const current = note?.collectionId
    ? collectionsMap.get(note.collectionId)
    : null;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!note) return null;

  return (
    <div className="ar-note-collection" ref={ref}>
      <button
        type="button"
        className={`ar-note-collection-chip${current ? " has-value" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Assign collection"
        style={
          current
            ? {
                background: `color-mix(in srgb, ${current.color} 14%, transparent)`,
                borderColor: `color-mix(in srgb, ${current.color} 40%, transparent)`,
                color: current.color,
              }
            : undefined
        }
      >
        {current ? (
          <span
            className="ar-nav-swatch"
            style={{
              background: current.color,
              boxShadow: `0 0 6px ${current.color}`,
            }}
          />
        ) : (
          <FolderClosed size={11} />
        )}
        <span>{current ? current.name : "Uncollected"}</span>
        <ChevronDown size={10} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div className="ar-note-collection-menu">
          <button
            type="button"
            className="ar-note-collection-item"
            onClick={() => {
              void saveCollection(noteId, null);
              setOpen(false);
            }}
          >
            <XIcon size={11} color="var(--t-tertiary)" />
            <span>Uncollected</span>
          </button>
          {collections.length === 0 && (
            <div className="ar-note-collection-empty">
              No collections yet. Make one from the sidebar.
            </div>
          )}
          {collections.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`ar-note-collection-item${
                c.id === note.collectionId ? " active" : ""
              }`}
              onClick={() => {
                void saveCollection(noteId, c.id);
                setOpen(false);
              }}
            >
              <span
                className="ar-nav-swatch"
                style={{
                  background: c.color,
                  boxShadow: `0 0 6px ${c.color}`,
                }}
              />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
