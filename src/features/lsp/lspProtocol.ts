/** Pure LSP <-> Monaco conversions. LSP positions are 0-based (line and
 * character); Monaco is 1-based (lineNumber and column). Kept separate from
 * the client so the arithmetic is unit-testable without a live server. */

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };

export type MonacoRangeLike = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export function toLspPosition(lineNumber: number, column: number): LspPosition {
  return { line: lineNumber - 1, character: column - 1 };
}

export function fromLspRange(r: LspRange): MonacoRangeLike {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

// LSP DiagnosticSeverity (1 Error … 4 Hint) -> Monaco MarkerSeverity.
const SEVERITY_MAP: Record<number, number> = { 1: 8, 2: 4, 3: 2, 4: 1 };

export function lspSeverityToMonaco(sev: number | undefined): number {
  return SEVERITY_MAP[sev ?? 1] ?? 8;
}

export type LspDiagnostic = {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
};

export type MonacoMarkerLike = MonacoRangeLike & {
  message: string;
  severity: number;
  source?: string;
  code?: string;
};

export function diagnosticToMarker(d: LspDiagnostic): MonacoMarkerLike {
  return {
    ...fromLspRange(d.range),
    message: d.message,
    severity: lspSeverityToMonaco(d.severity),
    ...(d.source ? { source: d.source } : {}),
    ...(d.code != null ? { code: String(d.code) } : {}),
  };
}

/** Absolute filesystem path -> file:// URI (encode each segment, keep the
 * slashes). Round-trips with `uriToPath`. */
export function pathToUri(path: string): string {
  const encoded = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `file://${encoded}`;
}

export function uriToPath(uri: string): string {
  const noScheme = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
  try {
    return decodeURIComponent(noScheme);
  } catch {
    return noScheme;
  }
}

/** LSP languageId for a path, or null when no server should handle it. */
export function lspLanguageId(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "typescriptreact";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "javascriptreact";
    case "py":
      return "python";
    case "rs":
      return "rust";
    default:
      return null;
  }
}
