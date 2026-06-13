import { useDatabase } from "@/store/databaseStore";
import { useArchives } from "@/apps/archives/useArchives";
import type { Note } from "@/store/notesStore";
import { formatValue } from "@/features/database/propertyTypes";

/** Card grid — title + a few property values per card. Image-forward when a
 * note has a leading line; otherwise a clean text card. */
export function GalleryView({ rows }: { rows: Note[] }) {
  const properties = useDatabase((s) => s.properties);
  const values = useDatabase((s) => s.values);
  const setOpenNoteId = useArchives((s) => s.setOpenNoteId);
  const setView = useArchives((s) => s.setView);
  const shown = properties.slice(0, 4);

  return (
    <div className="ar-db-gallery scroll">
      {rows.map((note) => {
        const cells = shown
          .map((p) => ({ p, text: formatValue(p, values.get(note.id)?.get(p.id) ?? "") }))
          .filter((c) => c.text);
        const excerpt = (note.plaintext ?? "").slice(0, 140);
        return (
          <button
            key={note.id}
            type="button"
            className="ar-db-tile"
            onClick={() => {
              setOpenNoteId(note.id);
              setView("notes");
            }}
          >
            <div className="ar-db-tile-title">{note.title || "Untitled"}</div>
            {excerpt && <div className="ar-db-tile-excerpt">{excerpt}</div>}
            {cells.length > 0 && (
              <div className="ar-db-tile-meta">
                {cells.map((c) => (
                  <span key={c.p.id} className="ar-db-card-chip">
                    {c.p.name}: {c.text}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
      {rows.length === 0 && <div className="ar-db-board-empty">No notes yet.</div>}
    </div>
  );
}
