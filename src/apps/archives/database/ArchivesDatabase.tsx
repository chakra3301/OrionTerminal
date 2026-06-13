import { useEffect, useMemo } from "react";
import { Table2, Columns3, LayoutGrid, Calendar, ArrowLeft, Plus, Settings2 } from "lucide-react";
import { useDatabase } from "@/store/databaseStore";
import { useNotesStore } from "@/store/notesStore";
import { useCollectionsStore } from "@/store/collectionsStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { TableView, NewRowButton } from "./TableView";
import { BoardView } from "./BoardView";
import { GalleryView } from "./GalleryView";
import { CalendarView } from "./CalendarView";
import type { ViewType } from "@/features/database/databaseDb";

const VIEW_ICON: Record<ViewType, typeof Table2> = {
  table: Table2,
  board: Columns3,
  gallery: LayoutGrid,
  calendar: Calendar,
};

/** Renders a collection AS a database: a view-tab bar + the active view. */
export function ArchivesDatabase() {
  const collectionId = useArchives((s) => s.databaseCollectionId);
  const setView = useArchives((s) => s.setView);
  const load = useDatabase((s) => s.load);
  const loadedFor = useDatabase((s) => s.collectionId);
  const views = useDatabase((s) => s.views);
  const properties = useDatabase((s) => s.properties);
  const activeViewId = useDatabase((s) => s.activeViewId);
  const setActiveView = useDatabase((s) => s.setActiveView);
  const addView = useDatabase((s) => s.addView);
  const removeView = useDatabase((s) => s.removeView);
  const patchActiveView = useDatabase((s) => s.patchActiveView);
  const notes = useNotesStore((s) => s.notes);
  const collection = useCollectionsStore((s) =>
    collectionId ? s.collections.get(collectionId) : undefined,
  );
  const { openFromButton, menu } = useContextMenu();

  useEffect(() => {
    if (collectionId && loadedFor !== collectionId) void load(collectionId);
  }, [collectionId, loadedFor, load]);

  const rows = useMemo(() => {
    if (!collectionId) return [];
    return [...notes.values()]
      .filter((n) => n.collectionId === collectionId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, collectionId]);

  if (!collectionId) return null;
  const activeView = views.find((v) => v.id === activeViewId);

  const openAddView = (el: HTMLElement) => {
    const items: MenuItem[] = (["table", "board", "gallery", "calendar"] as ViewType[]).map(
      (t) => {
        const Icon = VIEW_ICON[t];
        return {
          label: t[0]!.toUpperCase() + t.slice(1),
          icon: <Icon size={13} />,
          onClick: () => void addView(t[0]!.toUpperCase() + t.slice(1), t),
        };
      },
    );
    openFromButton(el, items);
  };

  // Config menu: board groupBy / calendar dateProp + delete view.
  const openConfig = (el: HTMLElement) => {
    if (!activeView) return;
    const items: MenuItem[] = [];
    if (activeView.type === "board") {
      const selects = properties.filter((p) => p.type === "select" || p.type === "status");
      items.push(
        ...(selects.length
          ? selects.map((p) => ({
              label: p.name,
              checked: activeView.config.groupBy === p.id,
              onClick: () => void patchActiveView({ groupBy: p.id }),
            }))
          : [{ label: "Add a Select/Status property first", disabled: true } as MenuItem]),
        { type: "separator" },
      );
    } else if (activeView.type === "calendar") {
      const dates = properties.filter((p) => p.type === "date");
      items.push(
        ...(dates.length
          ? dates.map((p) => ({
              label: p.name,
              checked: activeView.config.groupBy === p.id,
              onClick: () => void patchActiveView({ groupBy: p.id }),
            }))
          : [{ label: "Add a Date property first", disabled: true } as MenuItem]),
        { type: "separator" },
      );
    }
    items.push({
      label: "Delete view",
      danger: true,
      disabled: views.length <= 1,
      onClick: () => void removeView(activeView.id),
    });
    openFromButton(el, items);
  };

  return (
    <div className="ar-db">
      <div className="ar-db-bar">
        <button type="button" className="ar-db-back" title="Back to notes" onClick={() => setView("notes")}>
          <ArrowLeft size={13} />
        </button>
        <span className="ar-db-name" style={{ color: collection?.color }}>
          {collection?.name ?? "Database"}
        </span>
        <div className="ar-db-viewtabs">
          {views.map((v) => {
            const Icon = VIEW_ICON[v.type];
            return (
              <button
                key={v.id}
                type="button"
                className={`ar-db-viewtab${v.id === activeViewId ? " active" : ""}`}
                onClick={() => setActiveView(v.id)}
              >
                <Icon size={11} />
                {v.name}
              </button>
            );
          })}
          <button type="button" className="ar-db-addview" title="Add view" onClick={(e) => openAddView(e.currentTarget)}>
            <Plus size={12} />
          </button>
        </div>
        <div className="ar-db-bar-spacer" />
        {activeView && (activeView.type === "board" || activeView.type === "calendar") && (
          <button type="button" className="ar-db-cfg" title="Configure view" onClick={(e) => openConfig(e.currentTarget)}>
            <Settings2 size={13} />
          </button>
        )}
        <span className="ar-db-count">{rows.length} {rows.length === 1 ? "item" : "items"}</span>
        <NewRowButton collectionId={collectionId} />
      </div>

      {activeView?.type === "table" && <TableView rows={rows} />}
      {activeView?.type === "board" && (
        <BoardView rows={rows} groupBy={activeView.config.groupBy ?? null} />
      )}
      {activeView?.type === "gallery" && <GalleryView rows={rows} />}
      {activeView?.type === "calendar" && (
        <CalendarView rows={rows} dateProp={activeView.config.groupBy ?? null} />
      )}
      {menu}
    </div>
  );
}
