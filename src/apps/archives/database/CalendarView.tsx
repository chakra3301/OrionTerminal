import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDatabase } from "@/store/databaseStore";
import { useArchives } from "@/apps/archives/useArchives";
import type { Note } from "@/store/notesStore";
import { calendarCells, indexByDate, dateKey } from "@/features/database/grouping";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Month grid placing notes by a date property. dateProp from view config. */
export function CalendarView({ rows, dateProp }: { rows: Note[]; dateProp: string | null }) {
  const properties = useDatabase((s) => s.properties);
  const values = useDatabase((s) => s.values);
  const setOpenNoteId = useArchives((s) => s.setOpenNoteId);
  const setView = useArchives((s) => s.setView);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });

  const prop = properties.find((p) => p.id === dateProp && p.type === "date");

  const byDate = useMemo(() => {
    if (!prop) return new Map<string, Note[]>();
    return indexByDate(rows, (id) => values.get(id)?.get(prop.id) ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, prop, values]);

  const cells = useMemo(() => calendarCells(cursor.y, cursor.m), [cursor]);
  const todayKey = dateKey(new Date());

  if (!prop) {
    return (
      <div className="ar-db-board-empty">
        Add a Date property, then this calendar will place notes on it.
      </div>
    );
  }

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const shift = (d: number) => {
    setCursor((c) => {
      const nm = c.m + d;
      return { y: c.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
    });
  };

  return (
    <div className="ar-db-cal">
      <div className="ar-db-cal-bar">
        <button type="button" className="ar-db-back" onClick={() => shift(-1)}>
          <ChevronLeft size={13} />
        </button>
        <span className="ar-db-cal-month">{monthLabel}</span>
        <button type="button" className="ar-db-back" onClick={() => shift(1)}>
          <ChevronRight size={13} />
        </button>
      </div>
      <div className="ar-db-cal-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="ar-db-cal-weekday">{w}</div>
        ))}
      </div>
      <div className="ar-db-cal-grid scroll">
        {cells.map((cell) => {
          const items = byDate.get(cell.key) ?? [];
          return (
            <div
              key={cell.key}
              className={`ar-db-cal-cell${cell.inMonth ? "" : " out"}${cell.key === todayKey ? " today" : ""}`}
            >
              <div className="ar-db-cal-daynum">{cell.date.getDate()}</div>
              {items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="ar-db-cal-item"
                  onClick={() => {
                    setOpenNoteId(n.id);
                    setView("notes");
                  }}
                  title={n.title || "Untitled"}
                >
                  {n.title || "Untitled"}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
