import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Search, X, Keyboard } from "lucide-react";
import { useKeybindingsStore } from "@/store/keybindingsStore";
import { registry, type Command } from "@/commands/registry";

function useCommandsSnapshot(): Command[] {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.list(),
    () => registry.list(),
  );
}

function formatHotkey(hk: string): string {
  if (!hk) return "";
  const isMac = /Mac|iP/.test(navigator.platform);
  return hk
    .split("+")
    .map((p) => {
      const k = p.toLowerCase();
      if (k === "mod") return isMac ? "⌘" : "Ctrl";
      if (k === "shift") return isMac ? "⇧" : "Shift";
      if (k === "alt") return isMac ? "⌥" : "Alt";
      if (k === "ctrl") return isMac ? "⌃" : "Ctrl";
      if (k === "meta") return isMac ? "⌘" : "Win";
      if (k === "left") return "←";
      if (k === "right") return "→";
      if (k === "up") return "↑";
      if (k === "down") return "↓";
      return k.length === 1 ? k.toUpperCase() : k;
    })
    .join(isMac ? "" : "+");
}

export function KeybindingsOverlay() {
  const open = useKeybindingsStore((s) => s.open);
  const hide = useKeybindingsStore((s) => s.hide);
  const commands = useCommandsSnapshot();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  const grouped = useMemo(() => {
    const bound = commands.filter((c) => !!c.hotkey);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? bound.filter((c) => {
          if (c.label.toLowerCase().includes(q)) return true;
          if ((c.group ?? "").toLowerCase().includes(q)) return true;
          if (formatHotkey(c.hotkey ?? "").toLowerCase().includes(q)) return true;
          if ((c.hotkey ?? "").toLowerCase().includes(q)) return true;
          return false;
        })
      : bound;
    const m = new Map<string, Command[]>();
    for (const c of filtered) {
      const key = c.group ?? "Other";
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [commands, query]);

  if (!open) return null;

  return (
    <div
      className="ot-kb-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div
        className="ot-kb-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <header className="ot-kb-header">
          <Keyboard size={14} color="var(--neon-cyan)" />
          <span className="ot-kb-title">Keyboard shortcuts</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="icon-btn" onClick={hide} title="Close (Esc)">
            <X size={14} />
          </button>
        </header>
        <div className="ot-kb-search">
          <Search size={12} />
          <input
            type="text"
            placeholder="Search shortcuts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            spellCheck={false}
          />
        </div>
        <div className="ot-kb-body scroll">
          {grouped.length === 0 ? (
            <div className="ot-kb-empty">No matches.</div>
          ) : (
            grouped.map(([group, cmds]) => (
              <div key={group} className="ot-kb-group">
                <div className="ot-kb-group-label">{group}</div>
                {cmds.map((c) => (
                  <div key={c.id} className="ot-kb-row">
                    <span className="label">{c.label}</span>
                    <span className="hk">{formatHotkey(c.hotkey ?? "")}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <footer className="ot-kb-footer">
          <span className="kbd">⌘/</span> opens this anytime · <span className="kbd">⌘K</span> for command palette
        </footer>
      </div>
    </div>
  );
}
