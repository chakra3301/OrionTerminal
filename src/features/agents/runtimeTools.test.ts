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

  it("rejects unsupported built-ins rather than silently dropping grants", () => {
    for (const tool of ["Bash", "WebSearch", "WebFetch", "Unknown"]) {
      expect(() => mapToRuntimeTools([tool, "Read"])).toThrow("does not support");
    }
  });

  it("keeps Orion but rejects unsupported external MCP servers", () => {
    expect(mapToRuntimeTools(["mcp__orion"])).toEqual(["mcp__orion"]);
    expect(() => mapToRuntimeTools(["mcp__orion", "mcp__other"])).toThrow("Orion MCP only");
  });

  it("keeps explicit orion_* tool names", () => {
    expect(mapToRuntimeTools(["orion_create_note"])).toEqual(["orion_create_note"]);
  });

  it("unrestricted exposes Orion tools; an explicit empty list stays tool-less", () => {
    expect(mapToRuntimeTools(null)).toEqual(["mcp__orion"]);
    expect(mapToRuntimeTools([])).toEqual([]);
  });

  it("dedupes (Grep+Glob both → orion_search_files once)", () => {
    expect(mapToRuntimeTools(["Grep", "Glob"])).toEqual(["orion_search_files"]);
  });
});
