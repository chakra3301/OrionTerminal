import {
  matchesFilter,
  compareValues,
  type Property,
  type SelectOption,
  type Filter,
} from "./propertyTypes";

export type SortSpec = { propertyId: string; dir: "asc" | "desc" } | null;

/** Filter (ALL must pass) then sort a row set by a view's config. Title is a
 * pseudo-property id "__title__" for sorting. Pure — getValue/getTitle keep
 * it store-free and testable. */
export function shapeRows<T extends { id: string }>(
  rows: T[],
  opts: {
    properties: Property[];
    filters?: Filter[];
    sort?: SortSpec;
    getValue: (id: string, propertyId: string) => string;
    getTitle: (id: string) => string;
  },
): T[] {
  const propById = new Map(opts.properties.map((p) => [p.id, p]));
  let out = rows;

  for (const f of opts.filters ?? []) {
    const prop = propById.get(f.propertyId);
    if (!prop) continue;
    out = out.filter((r) => matchesFilter(prop, opts.getValue(r.id, f.propertyId), f));
  }

  const sort = opts.sort;
  if (sort) {
    const dir = sort.dir === "desc" ? -1 : 1;
    const prop = propById.get(sort.propertyId);
    out = out.slice().sort((a, b) => {
      if (sort.propertyId === "__title__") {
        return dir * opts.getTitle(a.id).localeCompare(opts.getTitle(b.id));
      }
      if (!prop) return 0;
      return dir * compareValues(prop, opts.getValue(a.id, prop.id), opts.getValue(b.id, prop.id));
    });
  }
  return out;
}

/** Pure view-shaping helpers (board grouping, calendar grid). No store/DB so
 * they're unit-testable. `getValue(noteId)` returns the raw cell string. */

export type Group<T> = { key: string; option: SelectOption | null; items: T[] };

/** Group rows by a select/status property's option. Items with no/unknown
 * value fall into a trailing `null`-option group. Empty option groups are
 * KEPT (a kanban shows empty columns you can drag into). */
export function groupRows<T extends { id: string }>(
  rows: T[],
  prop: Property,
  getValue: (id: string) => string,
): Group<T>[] {
  const byOption = new Map<string, T[]>();
  for (const o of prop.options) byOption.set(o.id, []);
  const none: T[] = [];
  for (const r of rows) {
    const v = getValue(r.id);
    const bucket = byOption.get(v);
    if (bucket) bucket.push(r);
    else none.push(r);
  }
  const groups: Group<T>[] = prop.options.map((o) => ({
    key: o.id,
    option: o,
    items: byOption.get(o.id) ?? [],
  }));
  groups.push({ key: "__none__", option: null, items: none });
  return groups;
}

export type CalendarCell = { date: Date; inMonth: boolean; key: string };

/** A 6-row (42-cell) month grid starting on Sunday, including trailing/leading
 * days from adjacent months. */
export function calendarCells(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({
      date: d,
      inMonth: d.getMonth() === month,
      key: dateKey(d),
    });
  }
  return cells;
}

/** Local YYYY-MM-DD (matches the <input type=date> value the cells store). */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Index rows by their date-property day. A raw value may be a full ISO or a
 * YYYY-MM-DD; we key on the leading 10 chars. */
export function indexByDate<T extends { id: string }>(
  rows: T[],
  getValue: (id: string) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const raw = getValue(r.id);
    if (!raw) continue;
    const key = raw.slice(0, 10);
    const arr = out.get(key);
    if (arr) arr.push(r);
    else out.set(key, [r]);
  }
  return out;
}
