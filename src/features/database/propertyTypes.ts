/** Typed-property model for collection databases (Phase 2.3). Pure value
 * encode/decode/format/compare logic, kept separate from the store + DB so
 * it's unit-testable without SQLite. */

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "checkbox"
  | "url";

export type SelectOption = { id: string; name: string; color: string };

export type Property = {
  id: string;
  collectionId: string;
  name: string;
  type: PropertyType;
  options: SelectOption[];
  position: number;
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  status: "Status",
  date: "Date",
  checkbox: "Checkbox",
  url: "URL",
};

/** Palette for select/status option chips (theme-accent friendly). */
export const OPTION_COLORS = [
  "#39ff88", "#00e0ff", "#e6ff3a", "#ff3ea5", "#b14cff",
  "#ff8a3d", "#9ab0a8", "#6ad5ff",
];

// ── Value codec ─────────────────────────────────────────────────────────────
// Raw DB cell is always a string. Typed JS views derive from it.

export function decodeMulti(raw: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function encodeMulti(ids: string[]): string {
  return JSON.stringify([...new Set(ids)]);
}

export function isChecked(raw: string): boolean {
  return raw === "1" || raw === "true";
}

export function asNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Human-readable cell text for compact displays (board cards, gallery). */
export function formatValue(prop: Property, raw: string): string {
  switch (prop.type) {
    case "checkbox":
      return isChecked(raw) ? "✓" : "";
    case "select":
    case "status":
      return prop.options.find((o) => o.id === raw)?.name ?? "";
    case "multi_select":
      return decodeMulti(raw)
        .map((id) => prop.options.find((o) => o.id === id)?.name ?? "")
        .filter(Boolean)
        .join(", ");
    case "number": {
      const n = asNumber(raw);
      return n === null ? "" : String(n);
    }
    case "date":
      if (!raw) return "";
      return new Date(raw).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    default:
      return raw;
  }
}

/** Comparable key for sorting a column. Numbers/dates compare numerically;
 * selects by option position; everything else case-insensitively. */
export function compareKey(prop: Property, raw: string): number | string {
  switch (prop.type) {
    case "number":
      return asNumber(raw) ?? Number.NEGATIVE_INFINITY;
    case "date":
      return raw ? new Date(raw).getTime() : Number.NEGATIVE_INFINITY;
    case "checkbox":
      return isChecked(raw) ? 1 : 0;
    case "select":
    case "status": {
      const idx = prop.options.findIndex((o) => o.id === raw);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    }
    default:
      return formatValue(prop, raw).toLowerCase();
  }
}

export function compareValues(prop: Property, a: string, b: string): number {
  const ka = compareKey(prop, a);
  const kb = compareKey(prop, b);
  if (typeof ka === "number" && typeof kb === "number") return ka - kb;
  return String(ka).localeCompare(String(kb));
}

// ── Filtering ───────────────────────────────────────────────────────────────

export type FilterOp = "is" | "is_not" | "contains" | "is_empty" | "is_not_empty" | "checked" | "unchecked";

export type Filter = { propertyId: string; op: FilterOp; value?: string };

export function matchesFilter(prop: Property, raw: string, f: Filter): boolean {
  const empty =
    prop.type === "multi_select" ? decodeMulti(raw).length === 0 : raw.trim() === "";
  switch (f.op) {
    case "is_empty":
      return empty;
    case "is_not_empty":
      return !empty;
    case "checked":
      return isChecked(raw);
    case "unchecked":
      return !isChecked(raw);
    case "is":
      return prop.type === "multi_select"
        ? decodeMulti(raw).includes(f.value ?? "")
        : raw === (f.value ?? "");
    case "is_not":
      return prop.type === "multi_select"
        ? !decodeMulti(raw).includes(f.value ?? "")
        : raw !== (f.value ?? "");
    case "contains":
      return formatValue(prop, raw)
        .toLowerCase()
        .includes((f.value ?? "").toLowerCase());
    default:
      return true;
  }
}
