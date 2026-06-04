import { useMemo } from "react";
import { ChevronRight, ChevronDown, FileText } from "lucide-react";
import { useState } from "react";
import { useNotesStore, type Note } from "@/store/notesStore";
import {
  useWorkspace,
  activeTabInFocusedPanel,
} from "@/components/workspace/workspaceStore";
import { registry } from "@/commands/registry";
import { cn } from "@/lib/cn";

function NoteRow({
  note,
  depth,
  childrenMap,
}: {
  note: Note;
  depth: number;
  childrenMap: Map<string | null, Note[]>;
}) {
  const [open, setOpen] = useState(true);
  const openTab = useWorkspace((s) => s.openTab);
  const activeTab = useWorkspace((s) =>
    activeTabInFocusedPanel(s.root, s.focusedPanelId),
  );

  const children = childrenMap.get(note.id) ?? [];
  const hasChildren = children.length > 0;
  const isActive =
    activeTab?.descriptor.kind === "note" &&
    activeTab.descriptor.noteId === note.id;
  const label = note.title.trim() || "Untitled";

  return (
    <div>
      <button
        type="button"
        onClick={() => openTab({ kind: "note", noteId: note.id }, { label })}
        className={cn(
          "w-full flex items-center gap-1 px-1 py-0.5 text-sm hover:bg-bg-hover rounded text-left",
          isActive && "bg-bg-hover text-fg",
          !isActive && "text-fg-muted",
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        title={label}
      >
        {hasChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="cursor-pointer"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <FileText size={12} className="shrink-0 text-fg-subtle" />
        <span
          className={cn(
            "truncate",
            !note.title.trim() && "italic text-fg-subtle",
          )}
        >
          {label}
        </span>
      </button>
      {open && hasChildren && (
        <div>
          {children.map((c) => (
            <NoteRow
              key={c.id}
              note={c}
              depth={depth + 1}
              childrenMap={childrenMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function NotesTree() {
  const notes = useNotesStore((s) => s.notes);
  const loaded = useNotesStore((s) => s.loaded);

  const { roots, childrenMap } = useMemo(() => {
    const map = new Map<string | null, Note[]>();
    for (const n of notes.values()) {
      const key = n.parentId;
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return { roots: map.get(null) ?? [], childrenMap: map };
  }, [notes]);

  return (
    <div className="border-t border-border">
      <header className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-mono uppercase tracking-wider text-fg-subtle">
          Notes
        </span>
        <button
          type="button"
          className="text-fg-subtle hover:text-fg text-xs"
          title="New note (⌘N)"
          onClick={() => registry.run("note.new")}
        >
          +
        </button>
      </header>
      <div className="p-1 font-mono text-[13px]">
        {!loaded ? (
          <div className="px-2 py-1 text-xs text-fg-subtle">Loading…</div>
        ) : roots.length === 0 ? (
          <div className="px-2 py-1 text-xs text-fg-subtle italic">
            No notes yet. ⌘N to create one.
          </div>
        ) : (
          roots.map((n) => (
            <NoteRow key={n.id} note={n} depth={0} childrenMap={childrenMap} />
          ))
        )}
      </div>
    </div>
  );
}
