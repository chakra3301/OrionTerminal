/** Pure formatters for R.O.S.I.E's tool chips. Extracted from Rosie.tsx so
 * the gnarly cases (mcp-prefixed names, escaped-JSON results, array-shaped
 * tool_result content) are unit-tested. */

/** Strip MCP server prefix so chips read as `orion_list_recent_notes`
 * instead of `mcp__orion__orion_list_recent_notes`. Built-in claude-code
 * tools (Bash, Read, etc.) pass through unchanged. */
export function prettyToolName(raw: string): string {
  const m = raw.match(/^mcp__[^_]+__(.+)$/);
  return m ? m[1]! : raw;
}

/** Render a tool result for the chip detail. claude-code delivers
 * tool_result content as a string or an array of {type:"text",text}
 * blocks; our MCP tools return JSON-as-string. Normalize → if it parses as
 * JSON, pretty-print it (so we don't show escaped `{\"ok\":true}`); else
 * show the raw text. Capped so a huge Bash dump doesn't blow out the panel. */
export function formatToolResult(result: unknown): string {
  if (result === undefined || result === null) return "";
  let text: string;
  if (typeof result === "string") {
    text = result;
  } else if (Array.isArray(result)) {
    text = result
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text: unknown }).text)
          : typeof b === "string"
            ? b
            : JSON.stringify(b),
      )
      .join("\n");
  } else {
    text = JSON.stringify(result, null, 2);
  }
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      text = JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      /* leave as-is */
    }
  }
  return text.length > 2000 ? text.slice(0, 2000) + "\n… (truncated)" : text;
}
