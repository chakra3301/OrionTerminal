/**
 * Translate an agent's composed allow-list (Claude built-in names + `mcp__*`
 * refs) into the Orion tool names the provider-agnostic runtime exposes.
 * Runtime path only — the Claude path keeps passing literal built-in names.
 */
const BUILTIN_TO_ORION: Record<string, string[]> = {
  Edit: ["orion_apply_edit"],
  Write: ["orion_write_file"],
  Read: ["orion_read_file"],
  Grep: ["orion_search_files"],
  Glob: ["orion_search_files"],
  // Bash, WebSearch: intentionally omitted (deferred — instructions still apply).
};

export function mapToRuntimeTools(allowedTools: string[] | null): string[] {
  if (allowedTools === null) return ["mcp__orion"];
  const out = new Set<string>();
  for (const t of allowedTools) {
    if (t === "mcp__orion") {
      out.add("mcp__orion");
      continue;
    }
    if (t.startsWith("mcp__orion__")) {
      out.add(t.slice("mcp__orion__".length));
      continue;
    }
    if (t.startsWith("mcp__")) throw new Error("This connector supports Orion MCP only, not the selected external MCP server.");
    if (t.startsWith("orion_")) {
      out.add(t);
      continue;
    }
    const mapped = BUILTIN_TO_ORION[t];
    if (!mapped) throw new Error(`This connector does not support the selected ${t} tool. Choose a compatible connector or remove that grant.`);
    mapped.forEach((m) => out.add(m));
  }
  return [...out];
}
