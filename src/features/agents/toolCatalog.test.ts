import { describe, it, expect } from "vitest";
import { BUILTIN_TOOLS, mcpToolGrants, allToolGrants } from "./toolCatalog";
import type { ToolGrant } from "./agentTypes";

describe("toolCatalog", () => {
  it("exposes the built-in Claude tools as grants", () => {
    expect(BUILTIN_TOOLS.map((t) => t.name)).toContain("WebSearch");
    expect(BUILTIN_TOOLS.every((t) => t.kind === "builtin")).toBe(true);
  });

  it("maps enabled MCP servers to mcp grants", () => {
    const grants = mcpToolGrants([
      { id: "1", name: "playwright", enabled: true, config: { command: "x" } },
      { id: "2", name: "off", enabled: false, config: { command: "y" } },
    ]);
    expect(grants).toEqual([{ kind: "mcp", server: "playwright" }]);
  });

  it("dedupes builtin + mcp grants into one catalog", () => {
    const cat = allToolGrants([{ id: "1", name: "playwright", enabled: true, config: { command: "x" } }]);
    const keys = cat.map((g: ToolGrant) => (g.kind === "builtin" ? `b:${g.name}` : `m:${g.server}`));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("m:playwright");
  });
});
