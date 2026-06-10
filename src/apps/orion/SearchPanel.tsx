import { useEffect, useRef, useState } from "react";
import { Search, CaseSensitive, Loader2 } from "lucide-react";
import { ipc, type FileMatches } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { useEditorNavStore } from "@/store/editorNavStore";
import { log } from "@/lib/log";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function relativeTo(root: string, p: string): string {
  return p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, "") : p;
}

export function OrionSearchPanel() {
  const project = useProjectStore((s) => s.active);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<FileMatches[]>([]);
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const root = project?.root_path;
    if (!root || query.trim().length < 2) {
      setResults([]);
      setRan(false);
      return;
    }
    const id = ++reqId.current;
    setBusy(true);
    const t = setTimeout(() => {
      ipc
        .searchInFiles(root, query, caseSensitive)
        .then((r) => {
          if (id !== reqId.current) return;
          setResults(r);
          setRan(true);
        })
        .catch((e) => log.error("search failed", e))
        .finally(() => {
          if (id === reqId.current) setBusy(false);
        });
    }, 180);
    return () => clearTimeout(t);
  }, [query, caseSensitive, project?.root_path]);

  const jump = (path: string, line: number, column: number) => {
    useWorkspace.getState().openTab({ kind: "file", path });
    useEditorNavStore.getState().reveal(path, line, column);
  };

  const totalMatches = results.reduce((n, f) => n + f.matches.length, 0);

  return (
    <div className="or-search">
      <div className="or-search-bar">
        <Search size={13} color="var(--t-tertiary)" />
        <input
          ref={inputRef}
          className="or-search-input"
          value={query}
          placeholder="Search in files…"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={`or-search-toggle${caseSensitive ? " active" : ""}`}
          title="Match case"
          onClick={() => setCaseSensitive((v) => !v)}
        >
          <CaseSensitive size={14} />
        </button>
        {busy && <Loader2 size={13} className="or-spin" color="var(--neon-cyan)" />}
      </div>

      {ran && (
        <div className="or-search-summary">
          {totalMatches} {totalMatches === 1 ? "result" : "results"} in{" "}
          {results.length} {results.length === 1 ? "file" : "files"}
        </div>
      )}

      <div className="or-search-results">
        {results.map((f) => (
          <div key={f.path} className="or-search-group">
            <div
              className="or-search-file"
              title={f.path}
              onClick={() =>
                jump(
                  f.path,
                  f.matches[0]?.line ?? 1,
                  f.matches[0]?.column ?? 1,
                )
              }
            >
              <span className="or-search-name">{basename(f.path)}</span>
              <span className="or-search-dir">
                {relativeTo(project?.root_path ?? "", f.path)
                  .split(/[\\/]/)
                  .slice(0, -1)
                  .join("/")}
              </span>
              <span className="or-search-count">{f.matches.length}</span>
            </div>
            {f.matches.map((m, i) => (
              <button
                key={i}
                type="button"
                className="or-search-row"
                onClick={() => jump(f.path, m.line, m.column)}
              >
                <span className="or-search-line">{m.line}</span>
                <span className="or-search-preview">{m.preview.trim()}</span>
              </button>
            ))}
          </div>
        ))}
        {ran && results.length === 0 && (
          <div className="or-search-empty">No results</div>
        )}
      </div>
    </div>
  );
}
