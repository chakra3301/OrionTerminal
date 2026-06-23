// Pure: scan a message body for openable artifacts (absolute file paths and
// http(s) URLs) so the chat can render "Open" affordances instead of making
// the Commander hunt the filesystem. No IO.

export type CcSegment =
  | { type: "text"; value: string }
  | { type: "path"; value: string; open: "file" | "reveal" }
  | { type: "url"; value: string };

// Absolute macOS/unix paths or ~-paths; stop at whitespace, quotes, backticks,
// or a trailing sentence punctuation. Captures nested project paths.
const PATH_RE = /(?:~|\/Users\/|\/tmp\/|\/private\/)[^\s"'`)\]]*[^\s"'`)\].,;:]/g;
const URL_RE = /https?:\/\/[^\s"'`)\]]+[^\s"'`)\].,;:]/g;

// Files we'd rather open in their default app (browser/preview) than reveal.
const OPEN_EXT = /\.(html?|png|jpe?g|gif|webp|svg|pdf|md|mov|mp4)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

/** True for a file-path segment that points at a renderable image. */
export function isImageArtifact(seg: CcSegment): boolean {
  return seg.type === "path" && IMAGE_EXT.test(seg.value);
}

// Sentinel for the auto-attached artifacts block appended by a finished run.
// Each following line is ONE full absolute path (may contain spaces, e.g.
// macOS "Application Support"), so we don't regex-extract these.
export const ARTIFACT_MARKER = "\u27e6artifacts\u27e7";

/** Split a persisted body into its prose and the auto-attached artifact paths. */
export function splitArtifactBlock(body: string): {
  prose: string;
  artifacts: string[];
} {
  const idx = body.indexOf(ARTIFACT_MARKER);
  if (idx === -1) return { prose: body, artifacts: [] };
  const prose = body.slice(0, idx).trimEnd();
  const artifacts = body
    .slice(idx + ARTIFACT_MARKER.length)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return { prose, artifacts };
}

export type CcPathSegment = Extract<CcSegment, { type: "path" }>;

/** Build a path segment from a raw (possibly space-containing) absolute path. */
export function pathSegment(value: string): CcPathSegment {
  return { type: "path", value, open: OPEN_EXT.test(value) ? "file" : "reveal" };
}

type Hit = { start: number; end: number; seg: CcSegment };

/** Split a message body into renderable segments, extracting artifact links. */
export function parseArtifacts(body: string): CcSegment[] {
  const hits: Hit[] = [];

  for (const m of body.matchAll(URL_RE)) {
    const value = m[0];
    hits.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + value.length,
      seg: { type: "url", value },
    });
  }
  for (const m of body.matchAll(PATH_RE)) {
    const value = m[0];
    const start = m.index ?? 0;
    // Skip paths that fall inside an already-captured URL (e.g. localhost path).
    if (hits.some((h) => start >= h.start && start < h.end)) continue;
    hits.push({
      start,
      end: start + value.length,
      seg: {
        type: "path",
        value,
        open: OPEN_EXT.test(value) ? "file" : "reveal",
      },
    });
  }

  if (hits.length === 0) return [{ type: "text", value: body }];
  hits.sort((a, b) => a.start - b.start);

  const out: CcSegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue; // overlap guard
    if (h.start > cursor) {
      out.push({ type: "text", value: body.slice(cursor, h.start) });
    }
    out.push(h.seg);
    cursor = h.end;
  }
  if (cursor < body.length) {
    out.push({ type: "text", value: body.slice(cursor) });
  }
  return out;
}

/** Short, human label for an artifact (basename for paths, host for URLs). */
export function artifactLabel(seg: CcSegment): string {
  if (seg.type === "text") return seg.value;
  if (seg.type === "url") {
    try {
      const u = new URL(seg.value);
      return u.host + (u.pathname !== "/" ? u.pathname : "");
    } catch {
      return seg.value;
    }
  }
  const parts = seg.value.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || seg.value;
}
