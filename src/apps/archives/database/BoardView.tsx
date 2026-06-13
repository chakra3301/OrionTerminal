import { useMemo, useState } from "react";
import { useDatabase } from "@/store/databaseStore";
import { useArchives } from "@/apps/archives/useArchives";
import type { Note } from "@/store/notesStore";
import { groupRows } from "@/features/database/grouping";
import { formatValue, type Property } from "@/features/database/propertyTypes";

const DRAG_MIME = "application/x-orion-db-note";

/** Kanban grouped by a select/status property. Drag cards between columns to
 * set the value. groupBy comes from the active view config. */
export function BoardView({ rows, groupBy }: { rows: Note[]; groupBy: string | null }) {
  const properties = useDatabase((s) => s.properties);
  const values = useDatabase((s) => s.values);
  const setValue = useDatabase((s) => s.setValue);
  const setOpenNoteId = useArchives((s) => s.setOpenNoteId);
  const setView = useArchives((s) => s.setView);
  const [dragId, setDragId] = useState<string | null>(null);

  const groupProp = properties.find(
    (p) => p.id === groupBy && (p.type === "select" || p.type === "status"),
  );
  const chipProps = properties.filter((p) => p.id !== groupProp?.id).slice(0, 4);

  const getValue = (id: string) => values.get(id)?.get(groupProp?.id ?? "") ?? "";
  const groups = useMemo(
    () => (groupProp ? groupRows(rows, groupProp, getValue) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, groupProp, values],
  );

  if (!groupProp) {
    return (
      <div className="ar-db-board-empty">
        Add a Select or Status property, then group this board by it.
      </div>
    );
  }

  const drop = (optionId: string) => {
    if (dragId) void setValue(dragId, groupProp.id, optionId);
    setDragId(null);
  };

  return (
    <div className="ar-db-board scroll">
      {groups.map((g) => (
        <div
          key={g.key}
          className="ar-db-col"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(g.option?.id ?? "")}
        >
          <div className="ar-db-col-head">
            {g.option ? (
              <span
                className="ar-db-chip"
                style={{
                  background: `${g.option.color}22`,
                  borderColor: `${g.option.color}66`,
                  color: g.option.color,
                }}
              >
                {g.option.name}
              </span>
            ) : (
              <span className="ar-db-empty">No {groupProp.name}</span>
            )}
            <span className="ar-db-col-count">{g.items.length}</span>
          </div>
          <div className="ar-db-col-body">
            {g.items.map((note) => (
              <BoardCard
                key={note.id}
                note={note}
                chipProps={chipProps}
                values={values}
                onOpen={() => {
                  setOpenNoteId(note.id);
                  setView("notes");
                }}
                onDragStart={() => setDragId(note.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BoardCard({
  note,
  chipProps,
  values,
  onOpen,
  onDragStart,
}: {
  note: Note;
  chipProps: Property[];
  values: Map<string, Map<string, string>>;
  onOpen: () => void;
  onDragStart: () => void;
}) {
  const cells = chipProps
    .map((p) => ({ p, text: formatValue(p, values.get(note.id)?.get(p.id) ?? "") }))
    .filter((c) => c.text);
  return (
    <div
      className="ar-db-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, note.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onClick={onOpen}
    >
      <div className="ar-db-card-title">{note.title || "Untitled"}</div>
      {cells.length > 0 && (
        <div className="ar-db-card-meta">
          {cells.map((c) => (
            <span key={c.p.id} className="ar-db-card-chip">
              {c.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
