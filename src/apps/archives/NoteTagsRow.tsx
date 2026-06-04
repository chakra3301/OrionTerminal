import { useEffect, useRef, useState } from "react";
import { Tag, X as XIcon, Plus } from "lucide-react";
import { useNotesStore } from "@/store/notesStore";

/**
 * Manual tag input rendered on the note editor surface next to the
 * collection chip. Existing tags show as removable violet pills; the input
 * accepts lowercase single-word/hyphenated tags (Enter or comma to commit).
 */
export function NoteTagsRow({ noteId }: { noteId: string }) {
  const note = useNotesStore((s) => s.notes.get(noteId));
  const addTag = useNotesStore((s) => s.addTag);
  const removeTag = useNotesStore((s) => s.removeTag);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  if (!note) return null;

  const commit = (value: string) => {
    const cleaned = value
      .trim()
      .toLowerCase()
      .replace(/^#+/, "")
      .replace(/\s+/g, "-");
    if (!cleaned) {
      setDraft("");
      setAdding(false);
      return;
    }
    void addTag(noteId, cleaned);
    setDraft("");
  };

  return (
    <div className="ar-note-tags">
      {note.tags.map((t) => (
        <span key={t} className="ar-media-tag ar-note-tag">
          #{t}
          <button
            type="button"
            className="ar-note-tag-remove"
            onClick={() => void removeTag(noteId, t)}
            title={`Remove #${t}`}
          >
            <XIcon size={9} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            commit(draft);
            setAdding(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            } else if (
              e.key === "Backspace" &&
              draft === "" &&
              note.tags.length > 0
            ) {
              e.preventDefault();
              void removeTag(noteId, note.tags[note.tags.length - 1]!);
            }
          }}
          placeholder="add tag…"
          className="ar-note-tag-input"
        />
      ) : (
        <button
          type="button"
          className="ar-note-tag-add"
          onClick={() => setAdding(true)}
          title="Add tag"
        >
          {note.tags.length === 0 ? (
            <>
              <Tag size={9} /> add tag
            </>
          ) : (
            <Plus size={10} />
          )}
        </button>
      )}
    </div>
  );
}
