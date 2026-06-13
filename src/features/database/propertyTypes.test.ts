import { describe, expect, it } from "vitest";
import {
  decodeMulti,
  encodeMulti,
  isChecked,
  asNumber,
  formatValue,
  compareValues,
  matchesFilter,
  type Property,
} from "./propertyTypes";

const sel: Property = {
  id: "p1",
  collectionId: "c",
  name: "Status",
  type: "status",
  options: [
    { id: "o1", name: "Todo", color: "#fff" },
    { id: "o2", name: "Doing", color: "#fff" },
    { id: "o3", name: "Done", color: "#fff" },
  ],
  position: 0,
};
const num: Property = { id: "p2", collectionId: "c", name: "N", type: "number", options: [], position: 1 };
const multi: Property = { ...sel, id: "p3", type: "multi_select" };

describe("value codec", () => {
  it("round-trips multi-select", () => {
    expect(decodeMulti(encodeMulti(["a", "b", "a"]))).toEqual(["a", "b"]);
    expect(decodeMulti("")).toEqual([]);
    expect(decodeMulti("garbage")).toEqual([]);
  });
  it("reads checkbox + number", () => {
    expect(isChecked("1")).toBe(true);
    expect(isChecked("0")).toBe(false);
    expect(asNumber("42")).toBe(42);
    expect(asNumber("")).toBeNull();
    expect(asNumber("x")).toBeNull();
  });
});

describe("formatValue", () => {
  it("formats select by option name", () => {
    expect(formatValue(sel, "o2")).toBe("Doing");
  });
  it("formats multi-select as a name list", () => {
    expect(formatValue(multi, encodeMulti(["o1", "o3"]))).toBe("Todo, Done");
  });
  it("formats checkbox", () => {
    expect(formatValue({ ...num, type: "checkbox" }, "1")).toBe("✓");
  });
});

describe("compareValues", () => {
  it("sorts numbers numerically", () => {
    expect(compareValues(num, "9", "10")).toBeLessThan(0);
  });
  it("sorts selects by option order", () => {
    expect(compareValues(sel, "o1", "o3")).toBeLessThan(0); // Todo before Done
  });
  it("sorts text case-insensitively", () => {
    const txt: Property = { ...num, type: "text" };
    expect(compareValues(txt, "apple", "Banana")).toBeLessThan(0);
  });
});

describe("matchesFilter", () => {
  it("is / is_not on select", () => {
    expect(matchesFilter(sel, "o2", { propertyId: "p1", op: "is", value: "o2" })).toBe(true);
    expect(matchesFilter(sel, "o2", { propertyId: "p1", op: "is_not", value: "o2" })).toBe(false);
  });
  it("is on multi-select checks membership", () => {
    const v = encodeMulti(["o1", "o2"]);
    expect(matchesFilter(multi, v, { propertyId: "p3", op: "is", value: "o2" })).toBe(true);
    expect(matchesFilter(multi, v, { propertyId: "p3", op: "is", value: "o3" })).toBe(false);
  });
  it("empty / not-empty", () => {
    expect(matchesFilter(num, "", { propertyId: "p2", op: "is_empty" })).toBe(true);
    expect(matchesFilter(num, "5", { propertyId: "p2", op: "is_not_empty" })).toBe(true);
  });
  it("contains on text", () => {
    const txt: Property = { ...num, type: "text" };
    expect(matchesFilter(txt, "Hello World", { propertyId: "p2", op: "contains", value: "world" })).toBe(true);
  });
});
