import { useTabsStore } from "@/store/tabsStore";

/** Ring buffer of recent edit locations across files. Cursor's Tab model
 * treats recent-edit history as first-class context — it's what lets a
 * completion anticipate the NEXT step of an in-progress refactor (change a
 * signature here, complete the call-site fix there). */

type RecentEdit = {
  path: string;
  line: number;
  ts: number;
};

const MAX = 20;
const THROTTLE_MS = 1000;
const SNIPPET_SPAN = 6;

const ring: RecentEdit[] = [];

export function recordEdit(path: string, line: number): void {
  const last = ring[ring.length - 1];
  // Collapse keystroke streams: same file+line within a second is one edit.
  if (
    last &&
    last.path === path &&
    Math.abs(last.line - line) <= 1 &&
    Date.now() - last.ts < THROTTLE_MS
  ) {
    last.line = line;
    last.ts = Date.now();
    return;
  }
  ring.push({ path, line, ts: Date.now() });
  if (ring.length > MAX) ring.shift();
}

/** Compact context block: the last few distinct edit sites (newest first),
 * plus a small snippet around the most recent edit in a DIFFERENT file —
 * the strongest signal for ripple edits. */
export function recentEditContext(currentPath: string): string | undefined {
  if (ring.length === 0) return undefined;

  const seen = new Set<string>();
  const sites: RecentEdit[] = [];
  for (let i = ring.length - 1; i >= 0 && sites.length < 4; i--) {
    const e = ring[i]!;
    const key = `${e.path}:${e.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push(e);
  }
  if (sites.length === 0) return undefined;

  const lines = sites.map((e) => `${shortPath(e.path)}:${e.line}`);
  let out = `Recent edit locations (newest first): ${lines.join(", ")}`;

  const other = sites.find((e) => e.path !== currentPath);
  if (other) {
    const buf = useTabsStore.getState().fileBuffers[other.path];
    if (buf?.loaded) {
      const all = buf.contents.split("\n");
      const start = Math.max(0, other.line - 1 - SNIPPET_SPAN);
      const end = Math.min(all.length, other.line - 1 + SNIPPET_SPAN);
      const snippet = all.slice(start, end).join("\n");
      if (snippet.trim()) {
        out += `\n\nJust edited in ${shortPath(other.path)} (around line ${other.line}):\n${snippet}`;
      }
    }
  }
  return out;
}

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.slice(-2).join("/");
}
