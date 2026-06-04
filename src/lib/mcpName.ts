/** Normalize a user-typed MCP server name to a claude-safe key: lowercase,
 * non-alphanumerics collapsed to underscores, trimmed, capped at 40 chars.
 * Pure — extracted so it's unit-testable independent of the store. */
export function safeMcpName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
