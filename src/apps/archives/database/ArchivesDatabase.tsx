import { useEffect, useMemo } from "react";
import { Table2, ArrowLeft } from "lucide-react";
import { useDatabase } from "@/store/databaseStore";
import { useNotesStore } from "@/store/notesStore";
import { useCollectionsStore } from "@/store/collectionsStore";
import { useArchives } from "@/apps/archives/useArchives";
import { TableView, NewRowButton } from "./TableView";

/** Renders a collection AS a database: a view-tab bar + the active view.
 * Slice 2.3b ships the Table view; board/gallery/calendar arrive in 2.3c. */
export function ArchivesDatabase() {
  const collectionId = useArchives((s) => s.databaseCollectionId);
  const setView = useArchives((s) => s.setView);
  const load = useDatabase((s) => s.load);
  const loadedFor = useDatabase((s) => s.collectionId);
  const views = useDatabase((s) => s.views);
  const activeViewId = useDatabase((s) => s.activeViewId);
  const setActiveView = useDatabase((s) => s.setActiveView);
  const notes = useNotesStore((s) => s.notes);
  const collection = useCollectionsStore((s) =>
    collectionId ? s.collections.get(collectionId) : undefined,
  );

  useEffect(() => {
    if (collectionId && loadedFor !== collectionId) void load(collectionId);
  }, [collectionId, loadedFor, load]);

  // Rows = notes filed in this collection.
  const rows = useMemo(() => {
    if (!collectionId) return [];
    return [...notes.values()]
      .filter((n) => n.collectionId === collectionId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, collectionId]);

  if (!collectionId) return null;
  const activeView = views.find((v) => v.id === activeViewId);

  return (
    <div className="ar-db">
      <div className="ar-db-bar">
        <button
          type="button"
          className="ar-db-back"
          title="Back to notes"
          onClick={() => setView("notes")}
        >
          <ArrowLeft size={13} />
        </button>
        <span className="ar-db-name" style={{ color: collection?.color }}>
          {collection?.name ?? "Database"}
        </span>
        <div className="ar-db-viewtabs">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`ar-db-viewtab${v.id === activeViewId ? " active" : ""}`}
              onClick={() => setActiveView(v.id)}
            >
              <Table2 size={11} />
              {v.name}
            </button>
          ))}
        </div>
        <div className="ar-db-bar-spacer" />
        <span className="ar-db-count">{rows.length} {rows.length === 1 ? "item" : "items"}</span>
        <NewRowButton collectionId={collectionId} />
      </div>

      {activeView?.type === "table" && <TableView rows={rows} />}
    </div>
  );
}
