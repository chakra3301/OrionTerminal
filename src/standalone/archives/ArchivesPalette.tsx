import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { create } from "zustand";
import Fuse from "fuse.js";
import { Archive as ArchiveIcon, ChevronRight, Sparkles } from "lucide-react";
import { registry, type Command } from "@/commands/registry";
import { searchHybrid, isArchiveHitVisible } from "@/lib/searchHybrid";
import { routeToSearchHit } from "@/apps/archives/searchNav";
import type { SearchHit } from "@/lib/db";
import { log } from "@/lib/log";
import { formatHotkey } from "./hotkeyLabel";

/** The standalone app's ⌘K: archive search plus Archives commands. A leading
 * `>` limits it to commands, the same as Orion Studio's Spotlight. */
type PaletteState = { open: boolean; query: string; show: (query?: string) => void; hide: () => void };

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  query: "",
  show: (query = "") => set({ open: true, query }),
  hide: () => set({ open: false, query: "" }),
}));

type Entry = { id: string; kind: "archive" | "command"; label: string; hint?: string; hotkey?: string; run: () => void };

function hitHint(h: SearchHit): string {
  if (h.entityType === "chat") return "chat";
  if (h.entityType === "asset") return "asset";
  return h.noteKind ?? "note";
}

export function rankEntries(query: string, commands: Command[], hits: SearchHit[]): Entry[] {
  const commandsOnly = query.startsWith(">");
  const q = (commandsOnly ? query.slice(1) : query).trim();
  const available = commands.filter((c) => !c.when || c.when());
  const commandEntries: Entry[] = available.map((c) => ({
    id: `cmd:${c.id}`,
    kind: "command",
    label: c.label,
    hint: c.group,
    hotkey: c.hotkey ? formatHotkey(c.hotkey) : undefined,
    run: () => void registry.run(c.id).catch((e) => log.error("palette command failed", c.id, e)),
  }));
  const rankedCommands = q
    ? new Fuse(commandEntries, { keys: ["label", "hint"], threshold: 0.4 }).search(q).map((r) => r.item)
    : commandEntries;
  if (commandsOnly) return rankedCommands;
  const hitEntries: Entry[] = hits.filter(isArchiveHitVisible).map((h) => ({
    id: `hit:${h.entityType}:${h.entityId}`,
    kind: "archive",
    label: h.title || "Untitled",
    hint: hitHint(h),
    run: () => void routeToSearchHit(h).catch((e) => log.warn("palette open failed", e)),
  }));
  return [...hitEntries, ...rankedCommands.slice(0, q ? 8 : 40)];
}

export function ArchivesPalette() {
  const open = usePalette((s) => s.open);
  const query = usePalette((s) => s.query);
  const hide = usePalette((s) => s.hide);
  const commands = useSyncExternalStore((cb) => registry.subscribe(cb), () => registry.list(), () => registry.list());
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !q || q.startsWith(">")) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchHybrid(q, 12)
        .then((rows) => { if (!cancelled) setHits(rows); })
        .catch((e) => log.warn("palette search failed", e));
    }, 90);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query]);

  const entries = useMemo(() => rankEntries(query, commands, hits), [query, commands, hits]);
  useEffect(() => setSelected(0), [query]);

  if (!open) return null;
  const run = (e: Entry | undefined) => {
    if (!e) return;
    hide();
    e.run();
  };

  return (
    <div className="ot-spotlight-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="ot-spotlight" role="dialog" aria-label="Search Archives" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ot-spotlight-input">
          <Sparkles size={16} color="var(--neon-green)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => usePalette.setState({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); hide(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setSelected((i) => Math.min(i + 1, entries.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); run(entries[selected]); }
            }}
            placeholder={query.startsWith(">") ? "Search commands…" : "Search notes, journal, media, commands…"}
          />
          <span className="esc">ESC</span>
        </div>
        <div className="ot-spotlight-list scroll">
          {entries.length === 0 && <div className="ot-spotlight-empty">No results.</div>}
          {entries.map((e, i) => (
            <div
              key={e.id}
              className={`ot-spotlight-item${i === selected ? " selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(e)}
            >
              <span style={{ width: 14, display: "inline-flex", color: "var(--t-tertiary)" }}>
                {e.kind === "archive" ? <ArchiveIcon size={11} color="var(--neon-green)" /> : <ChevronRight size={11} />}
              </span>
              <span className="label">
                <div className="primary">{e.label}</div>
                {e.hint && <div className="secondary">{e.hint}</div>}
              </span>
              {e.hotkey && <span className="hotkey">{e.hotkey}</span>}
            </div>
          ))}
        </div>
        <div className="ot-spotlight-footer">
          <span>↑↓ nav · ↵ open · esc close</span>
          <span>&gt; commands only</span>
        </div>
      </div>
    </div>
  );
}
