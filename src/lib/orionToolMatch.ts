/** Matchers for the Orion MCP write-tools, used by EventBridge to decide
 * which in-memory store to re-hydrate after a tool_result lands. Pure +
 * standalone so the matching is unit-tested.
 *
 * IMPORTANT: claude-code namespaces MCP tools as `mcp__<server>__<tool>` in
 * its tool_use blocks (e.g. `mcp__orion__orion_create_note`), so we match by
 * SUFFIX, not exact name. A prior bug matched bare names and silently broke
 * note cache invalidation — the tests here lock that in. */

const NOTE_WRITE = [
  "orion_create_note",
  "orion_update_note_body",
  "orion_delete_note",
];
const MOOD_WRITE = ["orion_create_mood_board", "orion_add_to_mood_board"];
const ASSET_WRITE = ["orion_attach_tag"];

function endsWithAny(name: string, suffixes: string[]): boolean {
  return suffixes.some((s) => name === s || name.endsWith(`__${s}`));
}

export function isOrionNoteWriteTool(name: string): boolean {
  return endsWithAny(name, NOTE_WRITE);
}
export function isOrionMoodWriteTool(name: string): boolean {
  return endsWithAny(name, MOOD_WRITE);
}
export function isOrionAssetWriteTool(name: string): boolean {
  return endsWithAny(name, ASSET_WRITE);
}
