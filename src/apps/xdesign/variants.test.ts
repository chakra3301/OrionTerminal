import { describe, expect, it } from "vitest";
import {
  variantProperties,
  resolveVariant,
  defaultSelection,
  type VariantMember,
} from "./variants";

const members: VariantMember[] = [
  { id: "a", variantProps: { State: "default", Size: "sm" } },
  { id: "b", variantProps: { State: "hover", Size: "sm" } },
  { id: "c", variantProps: { State: "default", Size: "lg" } },
  { id: "d", variantProps: { State: "hover", Size: "lg" } },
];

describe("variantProperties", () => {
  it("collects each property's ordered, de-duplicated values", () => {
    expect(variantProperties(members)).toEqual({
      State: ["default", "hover"],
      Size: ["sm", "lg"],
    });
  });
  it("ignores members with no variantProps", () => {
    expect(variantProperties([{ id: "x" }])).toEqual({});
  });
});

describe("resolveVariant", () => {
  it("returns the member matching the full selection", () => {
    expect(resolveVariant(members, { State: "hover", Size: "lg" })).toBe("d");
  });
  it("matches on the selected keys only", () => {
    // only State given → first member with State=hover
    expect(resolveVariant(members, { State: "hover" })).toBe("b");
  });
  it("falls back to the nearest member when no exact match exists", () => {
    // Size=xl doesn't exist; State=hover does → nearest is a hover member (b).
    expect(resolveVariant(members, { State: "hover", Size: "xl" })).toBe("b");
  });
  it("falls back to the first member when nothing matches", () => {
    expect(resolveVariant(members, { State: "gone", Size: "xl" })).toBe("a");
  });
  it("returns null for an empty set", () => {
    expect(resolveVariant([], { State: "hover" })).toBeNull();
  });
});

describe("defaultSelection", () => {
  it("uses the first member's props", () => {
    expect(defaultSelection(members)).toEqual({ State: "default", Size: "sm" });
  });
  it("is empty for an empty set", () => {
    expect(defaultSelection([])).toEqual({});
  });
});
