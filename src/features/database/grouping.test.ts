import { describe, expect, it } from "vitest";
import { groupRows, calendarCells, dateKey, indexByDate, shapeRows } from "./grouping";
import type { Property } from "./propertyTypes";

const status: Property = {
  id: "p",
  collectionId: "c",
  name: "Status",
  type: "status",
  options: [
    { id: "todo", name: "Todo", color: "#fff" },
    { id: "done", name: "Done", color: "#fff" },
  ],
  position: 0,
};

describe("groupRows", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const vals: Record<string, string> = { a: "todo", b: "done", c: "" };
  const get = (id: string) => vals[id] ?? "";

  it("buckets rows by option and keeps empty columns", () => {
    const g = groupRows(rows, status, get);
    expect(g.map((x) => x.key)).toEqual(["todo", "done", "__none__"]);
    expect(g[0]!.items.map((r) => r.id)).toEqual(["a"]);
    expect(g[1]!.items.map((r) => r.id)).toEqual(["b"]);
    expect(g[2]!.items.map((r) => r.id)).toEqual(["c"]); // unset -> none group
  });

  it("puts unknown option values into the none group", () => {
    const g = groupRows([{ id: "x" }], status, () => "ghost-option");
    expect(g.at(-1)!.items.map((r) => r.id)).toEqual(["x"]);
  });
});

describe("calendarCells", () => {
  it("returns 42 cells starting on a Sunday", () => {
    const cells = calendarCells(2026, 5); // June 2026
    expect(cells).toHaveLength(42);
    expect(cells[0]!.date.getDay()).toBe(0);
  });

  it("flags which cells are in the target month", () => {
    const cells = calendarCells(2026, 5);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(30); // June has 30 days
    expect(inMonth[0]!.key).toBe("2026-06-01");
  });
});

describe("shapeRows", () => {
  const num: Property = { id: "n", collectionId: "c", name: "N", type: "number", options: [], position: 0 };
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const nums: Record<string, string> = { a: "3", b: "1", c: "2" };
  const titles: Record<string, string> = { a: "Apple", b: "Cherry", c: "Banana" };
  const getValue = (id: string) => nums[id] ?? "";
  const getTitle = (id: string) => titles[id] ?? "";

  it("sorts ascending by a number property", () => {
    const out = shapeRows(rows, { properties: [num], sort: { propertyId: "n", dir: "asc" }, getValue, getTitle });
    expect(out.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts descending", () => {
    const out = shapeRows(rows, { properties: [num], sort: { propertyId: "n", dir: "desc" }, getValue, getTitle });
    expect(out.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts by title pseudo-property", () => {
    const out = shapeRows(rows, { properties: [num], sort: { propertyId: "__title__", dir: "asc" }, getValue, getTitle });
    expect(out.map((r) => r.id)).toEqual(["a", "c", "b"]); // Apple, Banana, Cherry
  });

  it("filters by a numeric not-empty + keeps order when no sort", () => {
    const out = shapeRows(
      [{ id: "a" }, { id: "x" }],
      { properties: [num], filters: [{ propertyId: "n", op: "is_not_empty" }], getValue, getTitle },
    );
    expect(out.map((r) => r.id)).toEqual(["a"]); // x has no value
  });

  it("returns rows unchanged with no filters/sort", () => {
    const out = shapeRows(rows, { properties: [num], getValue, getTitle });
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("dateKey + indexByDate", () => {
  it("formats a local date key", () => {
    expect(dateKey(new Date(2026, 5, 3))).toBe("2026-06-03");
  });
  it("indexes rows by their date day (ISO or short)", () => {
    const idx = indexByDate(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      (id) => ({ a: "2026-06-03", b: "2026-06-03T10:00:00Z", c: "" })[id] ?? "",
    );
    expect(idx.get("2026-06-03")!.map((r) => r.id)).toEqual(["a", "b"]);
    expect(idx.has("")).toBe(false);
  });
});
