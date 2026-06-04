import { useEffect, useRef, useState } from "react";
import { Plus, X as XIcon, Trash2, Check } from "lucide-react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import {
  useCollectionsStore,
  sortCollections,
  COLLECTION_PALETTE,
  type Collection,
} from "@/store/collectionsStore";
import { useNotesStore } from "@/store/notesStore";
import { useArchives } from "@/apps/archives/useArchives";
import { log } from "@/lib/log";

export function SidebarCollections() {
  const collectionsMap = useCollectionsStore((s) => s.collections);
  const create = useCollectionsStore((s) => s.create);
  const remove = useCollectionsStore((s) => s.remove);
  const setColor = useCollectionsStore((s) => s.setColor);
  const rename = useCollectionsStore((s) => s.rename);
  const selectedId = useArchives((s) => s.selectedCollectionId);
  const setSelected = useArchives((s) => s.setSelectedCollectionId);

  const collections = sortCollections(collectionsMap);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commitNew = async () => {
    const name = draft.trim();
    setAdding(false);
    setDraft("");
    if (!name) return;
    try {
      await create(name);
    } catch (e) {
      log.error("collection create failed", e);
    }
  };

  const handleDelete = async (c: Collection) => {
    const ok = await confirmDialog(
      `Delete collection "${c.name}"? Items stay; they just become uncollected.`,
      { title: "Delete collection", kind: "warning" },
    );
    if (!ok) return;
    if (selectedId === c.id) setSelected(null);
    await remove(c.id);
    // Sweep in-memory notes whose collectionId pointed at this row — the DB
    // FK clears them server-side (ON DELETE SET NULL), but the in-memory map
    // doesn't know yet.
    const ns = useNotesStore.getState().notes;
    const updated = new Map(ns);
    for (const [id, note] of ns) {
      if (note.collectionId === c.id) {
        updated.set(id, { ...note, collectionId: null });
      }
    }
    useNotesStore.setState({ notes: updated });
  };

  return (
    <>
      <div className="ar-section ar-section-row">
        <span>Collections</span>
        <button
          type="button"
          className="ar-section-add"
          onClick={() => setAdding(true)}
          title="New collection"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* "All" pseudo-entry — clears the filter. */}
      <button
        type="button"
        className={`ar-nav${selectedId === null ? " active" : ""}`}
        onClick={() => setSelected(null)}
      >
        <span className="ar-nav-swatch" style={{ background: "transparent", border: "1px dashed rgba(255,255,255,0.25)", boxShadow: "none" }} />
        <span>All collections</span>
      </button>

      {adding && (
        <div className="ar-collection-new">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Name…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitNew();
              } else if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
          />
          <button
            type="button"
            className="ar-collection-confirm"
            onClick={() => void commitNew()}
            disabled={!draft.trim()}
            title="Create"
          >
            <Check size={11} />
          </button>
          <button
            type="button"
            className="ar-collection-cancel"
            onClick={() => {
              setAdding(false);
              setDraft("");
            }}
            title="Cancel"
          >
            <XIcon size={11} />
          </button>
        </div>
      )}

      {collections.map((c) => (
        <CollectionRow
          key={c.id}
          collection={c}
          active={selectedId === c.id}
          onSelect={() => setSelected(selectedId === c.id ? null : c.id)}
          onRename={(name) => void rename(c.id, name)}
          onSetColor={(color) => void setColor(c.id, color)}
          onDelete={() => void handleDelete(c)}
        />
      ))}
    </>
  );
}

function CollectionRow({
  collection,
  active,
  onSelect,
  onRename,
  onSetColor,
  onDelete,
}: {
  collection: Collection;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onSetColor: (color: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(collection.name);
  const [colorOpen, setColorOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(collection.name), [collection.name]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== collection.name) onRename(draft.trim());
    else setDraft(collection.name);
  };

  return (
    <div className={`ar-collection-row${active ? " active" : ""}`}>
      <button
        type="button"
        className="ar-collection-swatch-btn"
        onClick={(e) => {
          e.stopPropagation();
          setColorOpen((o) => !o);
        }}
        title="Change color"
      >
        <span
          className="ar-nav-swatch"
          style={{
            background: collection.color,
            boxShadow: `0 0 6px ${collection.color}`,
          }}
        />
      </button>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft(collection.name);
              setEditing(false);
            }
          }}
          className="ar-collection-input"
        />
      ) : (
        <button
          type="button"
          className="ar-collection-label"
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          title={collection.name}
        >
          {collection.name}
        </button>
      )}
      <div className="ar-collection-actions">
        <button
          type="button"
          className="ar-collection-action danger"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          <Trash2 size={10} />
        </button>
      </div>
      {colorOpen && (
        <div className="ar-collection-color-pop">
          {COLLECTION_PALETTE.map((c) => (
            <button
              type="button"
              key={c}
              className="ar-collection-color-dot"
              style={{
                background: c,
                boxShadow:
                  c === collection.color
                    ? `0 0 0 2px var(--bg-1), 0 0 0 3px ${c}`
                    : `0 0 6px ${c}`,
              }}
              onClick={() => {
                onSetColor(c);
                setColorOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
