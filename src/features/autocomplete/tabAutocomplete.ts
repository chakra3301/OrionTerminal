import type { OnMount } from "@monaco-editor/react";
import type {
  editor,
  languages,
  Position,
  CancellationToken,
} from "monaco-editor";
import { ipc } from "@/lib/ipc";
import { useAutocomplete } from "@/store/autocompleteStore";
import { useDiagnosticsStore } from "@/store/diagnosticsStore";
import { recentEditContext } from "@/features/autocomplete/recentEdits";
import { log } from "@/lib/log";

type MonacoNs = Parameters<OnMount>[1];

const DEBOUNCE_MS = 180;
const PREFIX_CHARS = 2400;
const SUFFIX_CHARS = 1200;
const DIAG_SPAN_LINES = 20;
const CACHE_MAX = 64;

// position+content keyed LRU so backspace/retype shows the ghost instantly.
const cache = new Map<string, string>();

function cachePut(key: string, value: string) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let seq = 0;

export function registerTabAutocomplete(monaco: MonacoNs): void {
  const provider: languages.InlineCompletionsProvider = {
    provideInlineCompletions: async (
      model: editor.ITextModel,
      position: Position,
      _ctx: languages.InlineCompletionContext,
      token: CancellationToken,
    ) => {
      const empty = { items: [] as { insertText: string }[] };
      if (!useAutocomplete.getState().enabled) return empty;

      const path = model.uri.path;
      const prefix = model.getValueInRange({
        startLineNumber: Math.max(1, position.lineNumber - 200),
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      if (prefix.trim().length === 0) return empty;
      const lineCount = model.getLineCount();
      const endLine = Math.min(lineCount, position.lineNumber + 100);
      const suffix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: endLine,
        endColumn: model.getLineMaxColumn(endLine),
      });

      const trimmedPrefix = prefix.slice(-PREFIX_CHARS);
      const trimmedSuffix = suffix.slice(0, SUFFIX_CHARS);
      const key = `${path}|${trimmedPrefix}|${trimmedSuffix.slice(0, 200)}`;

      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached ? { items: [{ insertText: cached }] } : empty;
      }

      // Debounce inside the provider — Monaco cancels the token when a
      // newer keystroke supersedes this call.
      await sleep(DEBOUNCE_MS);
      if (token.isCancellationRequested) return empty;
      const mySeq = ++seq;

      const diagnostics = useDiagnosticsStore
        .getState()
        .markers.filter(
          (m) =>
            m.path === path &&
            Math.abs(m.startLineNumber - position.lineNumber) <= DIAG_SPAN_LINES,
        )
        .slice(0, 5)
        .map((m) => `line ${m.startLineNumber}: ${m.message}`)
        .join("\n");

      const started = performance.now();
      let text = "";
      try {
        text = await ipc.autocompleteRun({
          path,
          language: model.getLanguageId(),
          prefix: trimmedPrefix,
          suffix: trimmedSuffix,
          diagnostics: diagnostics || undefined,
          recentEdits: recentEditContext(path),
        });
      } catch (e) {
        // Errors stay quiet at the ghost layer (a failing autocomplete
        // must never interrupt typing) — but they're loggable.
        log.warn("autocomplete failed", e);
        return empty;
      }
      if (token.isCancellationRequested || mySeq !== seq) return empty;
      useAutocomplete.getState().reportLatency(performance.now() - started);

      cachePut(key, text);
      if (!text) return empty;
      return { items: [{ insertText: text }] };
    },
    disposeInlineCompletions: () => {},
  };
  monaco.languages.registerInlineCompletionsProvider("*", provider);
}
