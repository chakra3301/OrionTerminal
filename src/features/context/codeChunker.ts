/** Declaration-aware line chunking for the codebase semantic index. Pure —
 * no AST, no Monaco: a top-level-declaration regex decides where chunks may
 * begin, line budgets decide where they must. Mirrors the "functions,
 * classes, logical blocks" granularity the research found in Cursor. */

export type CodeChunk = {
  idx: number;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  text: string;
};

/** Lines a chunk aims for / may never exceed. */
const TARGET_LINES = 40;
const MAX_LINES = 70;
/** Don't start a new chunk before this many lines, even at a declaration —
 * keeps tiny helpers grouped with their neighbors. */
const MIN_LINES = 12;
/** Files whose average line is this long are minified/generated — skip. */
const MINIFIED_AVG_LINE = 300;

// Top-level declaration starts across the languages we ship in: TS/JS,
// Rust, Python, Go, Swift, C-family, CSS blocks, markdown headings.
const DECL = new RegExp(
  "^(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?" +
    "(?:function\\b|class\\b|interface\\b|type\\s+\\w+\\s*=|enum\\b|" +
    "const\\s+\\w+\\s*=|let\\s+\\w+\\s*=|" +
    "(?:pub\\s+)?(?:async\\s+)?fn\\b|impl\\b|struct\\b|trait\\b|mod\\b|" +
    "def\\s+\\w|class\\s+\\w|" +
    "func\\b|" +
    "#{1,3}\\s|" +
    "[.#@:\\[\\w-]+\\s*\\{\\s*$)",
);

export function looksMinified(content: string): boolean {
  const len = content.length;
  if (len === 0) return false;
  const lines = content.split("\n").length;
  return len / lines > MINIFIED_AVG_LINE;
}

/** Chunk file content into ordered, non-overlapping line ranges. */
export function chunkCode(content: string): CodeChunk[] {
  const lines = content.split("\n");
  if (content.trim().length === 0) return [];

  const chunks: CodeChunk[] = [];
  let start = 0; // 0-based index of current chunk start

  const flush = (endExclusive: number) => {
    const text = lines.slice(start, endExclusive).join("\n");
    if (text.trim().length > 0) {
      chunks.push({
        idx: chunks.length,
        startLine: start + 1,
        endLine: endExclusive,
        text,
      });
    }
    start = endExclusive;
  };

  for (let i = 1; i < lines.length; i++) {
    const size = i - start;
    if (size >= MAX_LINES) {
      flush(i);
      continue;
    }
    if (size >= MIN_LINES && DECL.test(lines[i]!)) {
      // Prefer breaking at a declaration once past the target size; below
      // target, only break if the chunk has real content already.
      if (size >= TARGET_LINES || size >= MIN_LINES) {
        flush(i);
      }
    }
  }
  flush(lines.length);
  return chunks;
}

/** Text embedded for a chunk — path header improves retrieval a lot. */
export function chunkEmbedText(relPath: string, chunk: CodeChunk): string {
  return `${relPath} (lines ${chunk.startLine}-${chunk.endLine})\n${chunk.text}`;
}
