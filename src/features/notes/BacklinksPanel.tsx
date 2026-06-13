import { useMemo, useState } from "react";
import { Link2, CornerDownRight, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useNotesStore } from "@/store/notesStore";
import { handleOrionUri, formatOrionUri } from "@/lib/orionProtocol";
import { computeBacklinks } from "@/features/notes/noteLinks";

/** Backlinks + unlinked-mentions footer for a note. Computed live from the
 * in-memory note set; collapses when there's nothing to show. */
export function BacklinksPanel({ noteId }: { noteId: string }) {
  const notes = useNotesStore((s) => s.notes);
  const [open, setOpen] = useState(true);

  const { linked, unlinked, title } = useMemo(() => {
    const target = notes.get(noteId);
    if (!target) return { linked: [], unlinked: [], title: "" };
    const all = [...notes.values()].map((n) => ({
      id: n.id,
      title: n.title || "Untitled",
      plaintext: n.plaintext ?? "",
      blocks: n.blocks,
    }));
    const res = computeBacklinks(all, { id: noteId, title: target.title || "" });
    return { ...res, title: target.title || "" };
  }, [notes, noteId]);

  if (linked.length === 0 && unlinked.length === 0) return null;
  const total = linked.length + unlinked.length;

  const go = (id: string) => handleOrionUri(formatOrionUri({ kind: "note", id }));

  return (
    <div className="ar-backlinks">
      <button type="button" className="ar-backlinks-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Link2 size={12} />
        <span>{total} linked reference{total === 1 ? "" : "s"}</span>
      </button>
      {open && (
        <div className="ar-backlinks-body">
          {linked.length > 0 && (
            <div className="ar-backlinks-group">
              <div className="ar-backlinks-label">Links to this page</div>
              {linked.map((n) => (
                <button key={n.id} type="button" className="ar-backlinks-item" onClick={() => go(n.id)}>
                  <FileText size={12} />
                  <span>{n.title}</span>
                </button>
              ))}
            </div>
          )}
          {unlinked.length > 0 && (
            <div className="ar-backlinks-group">
              <div className="ar-backlinks-label">
                Unlinked mentions{title ? ` of “${title}”` : ""}
              </div>
              {unlinked.map((n) => (
                <button key={n.id} type="button" className="ar-backlinks-item muted" onClick={() => go(n.id)}>
                  <CornerDownRight size={12} />
                  <span>{n.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
