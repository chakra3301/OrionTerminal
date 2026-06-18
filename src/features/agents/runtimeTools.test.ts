import { describe, it, expect } from "vitest";
import { mapToRuntimeTools } from "./runtimeTools";

describe("mapToRuntimeTools", () => {
  it("maps built-in edit grants to Orion tools", () => {
    const out = mapToRuntimeTools(["Edit", "Write", "Read", "Grep", "Glob"]);
    expect(out).toContain("orion_apply_edit");
    expect(out).toContain("orion_write_file");
    expect(out).toContain("orion_read_file");
    expect(out).toContain("orion_search_files");
  });

  it("drops Bash and WebSearch", () => {
    const out = mapToRuntimeTools(["Bash", "WebSearch", "Read"]);
    expect(out).toEqual(["orion_read_file"]);
  });

  it("keeps mcp__orion verbatim and drops other mcp servers", () => {
    const out = mapToRuntimeTools(["mcp__orion", "mcp__other"]);
    expect(out).toEqual(["mcp__orion"]);
  });

  it("keeps explicit orion_* tool names", () => {
    expect(mapToRuntimeTools(["orion_create_note"])).toEqual(["orion_create_note"]);
  });

  it("null or empty → empty list", () => {
    expect(mapToRuntimeTools(null)).toEqual([]);
    expect(mapToRuntimeTools([])).toEqual([]);
  });

  it("dedupes (Grep+Glob both → orion_search_files once)", () => {
    expect(mapToRuntimeTools(["Grep", "Glob"])).toEqual(["orion_search_files"]);
  });
});
