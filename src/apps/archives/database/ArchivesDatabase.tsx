import { useEffect, useMemo } from "react";
import { Table2, Columns3, LayoutGrid, Calendar, ArrowLeft, Plus, Settings2, ArrowUpDown, Filter as FilterIcon, X } from "lucide-react";
import { useDatabase } from "@/store/databaseStore";
import { useNotesStore } from "@/store/notesStore";
import { useCollectionsStore } from "@/store/collectionsStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { TableView, NewRowButton } from "./TableView";
import { BoardView } from "./BoardView";
import { GalleryView } from "./GalleryView";
import { CalendarView } from "./CalendarView";
import { shapeRows } from "@/features/database/grouping";
import { formatValue, type Filter } from "@/features/database/propertyTypes";
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

  const values = useDatabase((s) => s.values);

  const baseRows = useMemo(() => {
    if (!collectionId) return [];
    return [...notes.values()]
      .filter((n) => n.collectionId === collectionId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, collectionId]);

  const activeView = views.find((v) => v.id === activeViewId);

  // Apply the active view's filters + sort (board then groups the result).
  const rows = useMemo(() => {
    if (!activeView) return baseRows;
    const titleById = new Map(baseRows.map((n) => [n.id, n.title || "Untitled"]));
    return shapeRows(baseRows, {
      properties,
      filters: activeView.config.filters,
      sort: activeView.config.sort ?? null,
      getValue: (id, pid) => values.get(id)?.get(pid) ?? "",
      getTitle: (id) => titleById.get(id) ?? "",
    });
  }, [baseRows, activeView, properties, values]);

  if (!collectionId) return null;

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

  const activeFilters = activeView?.config.filters ?? [];
  const activeSort = activeView?.config.sort ?? null;

  const openSort = (el: HTMLElement) => {
    const toggle = (propertyId: string) => {
      const cur = activeSort;
      const dir = cur?.propertyId === propertyId && cur.dir === "asc" ? "desc" : "asc";
      void patchActiveView({ sort: { propertyId, dir } });
    };
    const items: MenuItem[] = [
      { label: "Name (title)", checked: activeSort?.propertyId === "__title__", onClick: () => toggle("__title__") },
      ...properties.map((p) => ({
        label: p.name + (activeSort?.propertyId === p.id ? (activeSort.dir === "asc" ? " ↑" : " ↓") : ""),
        checked: activeSort?.propertyId === p.id,
        onClick: () => toggle(p.id),
      })),
      ...(activeSort ? [{ type: "separator" } as MenuItem, { label: "Clear sort", danger: true, onClick: () => void patchActiveView({ sort: null }) } as MenuItem] : []),
    ];
    openFromButton(el, items);
  };

  const openFilter = (el: HTMLElement) => {
    const addFilter = (f: Filter) => void patchActiveView({ filters: [...activeFilters, f] });
    const items: MenuItem[] = [];
    for (const p of properties) {
      if (p.type === "select" || p.type === "status") {
        for (const o of p.options) {
          items.push({ label: `${p.name}: ${o.name}`, onClick: () => addFilter({ propertyId: p.id, op: "is", value: o.id }) });
        }
      } else if (p.type === "checkbox") {
        items.push({ label: `${p.name}: checked`, onClick: () => addFilter({ propertyId: p.id, op: "checked" }) });
      } else {
        items.push({ label: `${p.name}: not empty`, onClick: () => addFilter({ propertyId: p.id, op: "is_not_empty" }) });
      }
    }
    if (items.length === 0) items.push({ label: "Add a property first", disabled: true, onClick: () => {} });
    openFromButton(el, items);
  };

  const filterChipLabel = (f: Filter): string => {
    const p = properties.find((x) => x.id === f.propertyId);
    if (!p) return "filter";
    if (f.op === "checked") return `${p.name} ✓`;
    if (f.op === "is_not_empty") return `${p.name} set`;
    if (f.op === "is" && f.value) return `${p.name}: ${formatValue(p, f.value)}`;
    return p.name;
  };
  const removeFilter = (idx: number) =>
    void patchActiveView({ filters: activeFilters.filter((_, i) => i !== idx) });

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
        {activeFilters.map((f, i) => (
          <span key={i} className="ar-db-filterchip">
            {filterChipLabel(f)}
            <button type="button" onClick={() => removeFilter(i)}><X size={9} /></button>
          </span>
        ))}
        <div className="ar-db-bar-spacer" />
        <button type="button" className="ar-db-cfg" title="Filter" onClick={(e) => openFilter(e.currentTarget)}>
          <FilterIcon size={13} />
        </button>
        <button type="button" className={`ar-db-cfg${activeSort ? " on" : ""}`} title="Sort" onClick={(e) => openSort(e.currentTarget)}>
          <ArrowUpDown size={13} />
        </button>
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
