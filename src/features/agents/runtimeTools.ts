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
  if (!allowedTools) return [];
  const out = new Set<string>();
  for (const t of allowedTools) {
    if (t === "mcp__orion") {
      out.add("mcp__orion");
      continue;
    }
    if (t.startsWith("mcp__")) continue; // non-Orion MCP not dispatched in-process
    if (t.startsWith("orion_")) {
      out.add(t);
      continue;
    }
    const mapped = BUILTIN_TO_ORION[t];
    if (mapped) mapped.forEach((m) => out.add(m));
  }
  return [...out];
}
