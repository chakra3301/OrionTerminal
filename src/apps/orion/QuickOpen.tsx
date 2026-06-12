import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import Fuse from "fuse.js";
import { FileText } from "lucide-react";
import { listProjectFiles } from "@/features/context/contextProviders";
import { useProjectStore } from "@/store/projectStore";
import { useWorkspace, allTabs } from "@/components/workspace/workspaceStore";
import { log } from "@/lib/log";

type QuickOpenState = {
  open: boolean;
  show: () => void;
  hide: () => void;
};

export const useQuickOpen = create<QuickOpenState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

type Entry = { path: string; rel: string };

// Frecency — in-memory is enough: it warms within a minute of real use.
const frecency = new Map<string, { count: number; last: number }>();

export function recordQuickOpen(path: string): void {
  const f = frecency.get(path);
  frecency.set(path, { count: (f?.count ?? 0) + 1, last: Date.now() });
}

function boost(path: string, openPaths: Set<string>): number {
  let b = 0;
  if (openPaths.has(path)) b += 0.3;
  const f = frecency.get(path);
  if (f) {
    b += Math.min(0.3, f.count * 0.06);
    const age = Date.now() - f.last;
    if (age < 60_000) b += 0.25;
    else if (age < 600_000) b += 0.15;
    else if (age < 3_600_000) b += 0.08;
  }
  return b;
}

function splitRel(rel: string): { dir: string; base: string } {
  const i = rel.lastIndexOf("/");
  return i === -1
    ? { dir: "", base: rel }
    : { dir: rel.slice(0, i + 1), base: rel.slice(i + 1) };
}

export function QuickOpen() {
  const open = useQuickOpen((s) => s.open);
  const hide = useQuickOpen((s) => s.hide);
  const project = useProjectStore((s) => s.active);
  const [files, setFiles] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !project) return;
    setQuery("");
    setHi(0);
    let cancelled = false;
    listProjectFiles(project.root_path)
      .then((f) => {
        if (!cancelled) setFiles(f);
      })
      .catch((e) => log.warn("quick-open file list failed", e));
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, project]);

  const openPaths = useMemo(() => {
    if (!open) return new Set<string>();
    const ws = useWorkspace.getState();
    const set = new Set<string>();
    for (const t of allTabs(ws.root)) {
      if (t.descriptor.kind === "file") set.add(t.descriptor.path);
    }
    return set;
  }, [open]);

  const fuse = useMemo(
    () => new Fuse(files, { keys: ["rel"], threshold: 0.45, includeScore: true }),
    [files],
  );

  const results = useMemo(() => {
    if (!open) return [];
    const q = query.trim();
    if (!q) {
      return [...files]
        .map((e) => ({ entry: e, rank: -boost(e.path, openPaths) }))
        .filter((r) => r.rank < 0)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 12)
        .map((r) => r.entry);
    }
    return fuse
      .search(q, { limit: 50 })
      .map((r) => ({ entry: r.item, rank: (r.score ?? 1) - boost(r.item.path, openPaths) }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 12)
      .map((r) => r.entry);
  }, [open, query, files, fuse, openPaths]);

  const idx = Math.min(hi, Math.max(0, results.length - 1));

  if (!open || !project) return null;

  const pick = (e: Entry) => {
    recordQuickOpen(e.path);
    useWorkspace
      .getState()
      .openTab({ kind: "file", path: e.path }, { label: splitRel(e.rel).base, preferRole: "editor" });
    hide();
  };

  return (
    <div className="or-qo-overlay" onMouseDown={hide}>
      <div className="or-qo-card" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="or-qo-input"
          value={query}
          placeholder="Go to file…"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setHi(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              hide();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const dir = e.key === "ArrowDown" ? 1 : -1;
              const n = results.length;
              if (n > 0) setHi((cur) => (Math.min(cur, n - 1) + dir + n) % n);
            } else if (e.key === "Enter" && results[idx]) {
              e.preventDefault();
              pick(results[idx]!);
            }
          }}
        />
        <div className="or-qo-list">
          {results.length === 0 && (
            <div className="or-qo-empty">
              {query ? "no matching files" : "type to search project files"}
            </div>
          )}
          {results.map((e, i) => {
            const { dir, base } = splitRel(e.rel);
            return (
              <button
                key={e.path}
                type="button"
                className={`or-qo-row${i === idx ? " hi" : ""}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  pick(e);
                }}
              >
                <FileText size={12} />
                <span className="or-qo-base">{base}</span>
                {dir && <span className="or-qo-dir">{dir}</span>}
                {openPaths.has(e.path) && <span className="or-qo-open">open</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
