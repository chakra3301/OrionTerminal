import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Fuse from "fuse.js";
import { Search, Sparkles, Archive as ArchiveIcon, Folder, Clock } from "lucide-react";
import { useShell } from "@/shell/store/useShell";
import { appRegistry, useAppDescriptors, type AppId } from "@/plugins/appRegistry";
import { registry, type Command } from "@/commands/registry";
import { useProjectStore } from "@/store/projectStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { ipc, type TreeNode } from "@/lib/ipc";
import { type SearchHit, recentActivity, type ActivityEntry } from "@/lib/db";
import { searchHybrid } from "@/lib/searchHybrid";
import { routeToSearchHit } from "@/apps/archives/searchNav";
import { usePluginManager } from "@/store/pluginManagerStore";
import { BUILTIN_APP_PLUGIN_IDS } from "@/plugins/builtinApps";
import { log } from "@/lib/log";
import { ThemeBorder } from "@/components/effects/ThemeBorder";

type SpotlightKind =
  | "app"
  | "command"
  | "file"
  | "chat"
  | "note"
  | "archive"
  | "project"
  | "activity";

type SpotlightEntry = {
  kind: SpotlightKind;
  id: string;
  label: string;
  hint?: string;
  hotkey?: string;
  appId?: AppId;
  filePath?: string;
  commandId?: string;
  run: () => void;
};

function flattenFiles(node: TreeNode | null, root: string, out: string[]) {
  if (!node) return;
  if (!node.is_dir) {
    out.push(node.path.startsWith(root) ? node.path.slice(root.length + 1) : node.path);
  }
  if (node.children) for (const c of node.children) flattenFiles(c, root, out);
}

function formatHotkey(hk?: string): string {
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
      if (k === "left") return "←";
      if (k === "right") return "→";
      if (k === "up") return "↑";
      if (k === "down") return "↓";
      return k.length === 1 ? k.toUpperCase() : k;
    })
    .join(isMac ? "" : "+");
}

function useCommandSnapshot(): Command[] {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.list(),
    () => registry.list(),
  );
}

export function Spotlight() {
  const open = useShell((s) => s.spotlightOpen);
  const close = useShell((s) => s.closeSpotlight);
  const openApp = useShell((s) => s.openApp);
  const focusedId = useShell((s) => s.focusedWindowId);
  const windows = useShell((s) => s.windows);
  const appDescriptors = useAppDescriptors();
  const orionEnabled = appDescriptors.some((descriptor) => descriptor.id === "orion");
  const archivesEnabled = usePluginManager(
    (state) => state.hydrated && !state.disabledIds.includes(BUILTIN_APP_PLUGIN_IDS.archives),
  );

  const project = useProjectStore((s) => s.active);
  const recents = useProjectStore((s) => s.recents);
  const switchToProject = useProjectStore((s) => s.switchToProject);
  const loadRecents = useProjectStore((s) => s.loadRecents);
  const openTab = useWorkspace((s) => s.openTab);

  // Pull recents whenever the palette opens so the list is fresh (cheap —
  // single sqlite query). loadRecents itself is a no-op if it races.
  useEffect(() => {
    if (open && orionEnabled) void loadRecents();
  }, [open, orionEnabled, loadRecents]);

  // Cross-app activity feed (the shared terminal memory). Pulled on open so
  // "what was I just doing" is one ⌘K away.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    recentActivity({ limit: 16 })
      .then((rows) => {
        if (!cancelled) setActivity(rows);
      })
      .catch((e) => {
        log.warn("spotlight activity load failed", e);
        if (!cancelled) setActivity([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const allCommands = useCommandSnapshot();
  const commands = useMemo(
    () => allCommands.filter((c) => (c.when ? c.when() : true)),
    [allCommands],
  );

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [archiveHits, setArchiveHits] = useState<SearchHit[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (!orionEnabled || !project) {
      setFiles([]);
      return;
    }
    ipc
      .readDirTree(project.root_path, 8)
      .then((tree) => {
        if (cancelled) return;
        const out: string[] = [];
        flattenFiles(tree, project.root_path, out);
        setFiles(out);
      })
      .catch((e) => log.error("spotlight readDirTree failed", e));
    return () => {
      cancelled = true;
    };
  }, [open, orionEnabled, project]);

  const isCommandsOnly = query.startsWith(">");
  const trimmedQuery = isCommandsOnly ? query.slice(1).trim() : query.trim();

  // Live FTS5 against the Archives index (notes/projects/journal/chats/
  // assets) on every keystroke, debounced lightly. Skipped in commands-only
  // mode so `>` is unambiguously the command channel.
  useEffect(() => {
    if (!open || !archivesEnabled || isCommandsOnly || !trimmedQuery) {
      setArchiveHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchHybrid(trimmedQuery, 12)
        .then((rows) => {
          if (!cancelled) setArchiveHits(rows);
        })
        .catch((e) => {
          log.warn("spotlight archive search failed", e);
          if (!cancelled) setArchiveHits([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, archivesEnabled, isCommandsOnly, trimmedQuery]);

  const entries: SpotlightEntry[] = useMemo(() => {
    const apps: SpotlightEntry[] = appDescriptors.map((descriptor) => ({
      kind: "app",
      id: `app:${descriptor.id}`,
      label: `Open ${descriptor.name}`,
      hint: descriptor.spotlight.description,
      appId: descriptor.id,
      run: () => {
        openApp(descriptor.id);
        close();
      },
    }));

    const cmds: SpotlightEntry[] = commands.map((c) => ({
      kind: "command",
      id: `cmd:${c.id}`,
      label: c.label,
      hint: c.group,
      hotkey: formatHotkey(c.hotkey),
      commandId: c.id,
      run: () => {
        close();
        registry.run(c.id).catch((err) => log.error("command run failed", c.id, err));
      },
    }));

    const fileEntries: SpotlightEntry[] = orionEnabled && project
      ? files.slice(0, 200).map((f) => ({
          kind: "file",
          id: `file:${f}`,
          label: f.split(/[\\/]/).pop() ?? f,
          hint: f,
          filePath: `${project.root_path}/${f}`,
          run: () => {
            close();
            openTab(
              { kind: "file", path: `${project.root_path}/${f}` },
              {
                label: f.split(/[\\/]/).pop() ?? f,
                preferRole: "editor",
              },
            );
            openApp("orion");
          },
        }))
      : [];

    const archiveEntries: SpotlightEntry[] = (archivesEnabled ? archiveHits : [])
      .filter((hit) => hit.chatOrigin !== "xdesign" || appRegistry.has("xdesign"))
      .filter((hit) => hit.chatOrigin !== "orion" || orionEnabled)
      .map((h) => ({
      kind: "archive",
      id: `archive:${h.entityType}:${h.entityId}`,
      label: h.title,
      hint: h.snippet
        ? h.snippet.replace(/[〔〕]/g, "")
        : kindHintForHit(h),
      run: () => {
        close();
        void routeToSearchHit(h);
      },
    }));

    const activityEntries: SpotlightEntry[] = activity
      .filter((entry) => appRegistry.has(entry.source))
      .map((a) => ({
      kind: "activity",
      id: `activity:${a.id}`,
      label: a.title,
      hint: `${appRegistry.get(a.source)?.name ?? a.source} · ${a.summary || a.kind}`,
      appId: a.source,
      run: () => {
        close();
        // Best-effort jump: Orion file edits reopen the file; everything else
        // surfaces the source app where the user left off.
        if (
          a.source === "orion" &&
          a.ref_id &&
          /[\\/]/.test(a.ref_id) &&
          project
        ) {
          openTab(
            { kind: "file", path: a.ref_id },
            { label: a.ref_id.split(/[\\/]/).pop() ?? a.ref_id, preferRole: "editor" },
          );
        }
        if (appRegistry.has(a.source)) openApp(a.source);
      },
    }));

    // Recent projects: skip the currently-active one (no-op switch anyway).
    const projectEntries: SpotlightEntry[] = (orionEnabled ? recents : [])
      .filter((p) => p.id !== project?.id)
      .slice(0, 8)
      .map((p) => ({
        kind: "project",
        id: `project:${p.id}`,
        label: `Switch to ${p.name}`,
        hint: p.root_path,
        run: () => {
          close();
          void switchToProject(p);
        },
      }));

    if (isCommandsOnly) return cmds;
    return [
      ...apps,
      ...projectEntries,
      ...archiveEntries,
      ...activityEntries,
      ...cmds,
      ...fileEntries,
    ];
  }, [
    commands,
    files,
    project,
    recents,
    openApp,
    openTab,
    close,
    switchToProject,
    isCommandsOnly,
    archiveHits,
    activity,
    appDescriptors,
    archivesEnabled,
    orionEnabled,
  ]);

  const fuse = useMemo(
    () =>
      new Fuse(
        entries.filter((e) => e.kind !== "archive"),
        {
          keys: [
            { name: "label", weight: 0.7 },
            { name: "hint", weight: 0.3 },
          ],
          threshold: 0.4,
          ignoreLocation: true,
        },
      ),
    [entries],
  );

  const visible: SpotlightEntry[] = useMemo(() => {
    if (!trimmedQuery) {
      if (isCommandsOnly) return entries.slice(0, 20);
      // Default: 3 apps + recent projects + a few high-value commands + a
      // few recent files.
      const apps = entries.filter((e) => e.kind === "app");
      const projects = entries.filter((e) => e.kind === "project").slice(0, 5);
      const recent = entries.filter((e) => e.kind === "activity").slice(0, 6);
      const cmds = entries
        .filter((e) => e.kind === "command")
        .slice(0, 6);
      const fileSlice = entries.filter((e) => e.kind === "file").slice(0, 6);
      return [...apps, ...recent, ...projects, ...cmds, ...fileSlice];
    }
    // Archive hits keep their FTS-rank ordering (already scored on the DB
    // side); we mix them with Fuse-ranked everything-else.
    const archives = entries.filter((e) => e.kind === "archive");
    const fuseHits = fuse.search(trimmedQuery, { limit: 14 }).map((r) => r.item);
    return [...archives, ...fuseHits];
  }, [entries, trimmedQuery, isCommandsOnly, fuse]);

  useEffect(() => {
    setSelected(0);
  }, [trimmedQuery, isCommandsOnly]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const selEl = el.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    if (selEl) selEl.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const sectionFor = (e: SpotlightEntry): string => {
    switch (e.kind) {
      case "app":
        return "Applications";
      case "project":
        return "Projects";
      case "command":
        return "Commands";
      case "file":
        return "Files";
      case "chat":
        return "Chats";
      case "note":
        return "Notes";
      case "archive":
        return "Archive";
      case "activity":
        return "Recent";
    }
  };

  const sections: Array<{ label: string; items: SpotlightEntry[] }> = [];
  let lastLabel: string | null = null;
  for (const e of visible) {
    const s = sectionFor(e);
    if (s !== lastLabel) {
      sections.push({ label: s, items: [] });
      lastLabel = s;
    }
    sections[sections.length - 1]!.items.push(e);
  }

  const flatIndex = (sectionIdx: number, itemIdx: number): number => {
    let n = 0;
    for (let i = 0; i < sectionIdx; i++) n += sections[i]!.items.length;
    return n + itemIdx;
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, visible.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = visible[selected];
      if (entry) entry.run();
      return;
    }
  };

  // Suppress unused warnings for fields we'll use in Phase B/C.
  void focusedId;
  void windows;

  return (
    <div
      className="ot-spotlight-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="ot-spotlight" onMouseDown={(e) => e.stopPropagation()}>
        <ThemeBorder />
        <div className="ot-spotlight-input">
          <Sparkles size={16} color="var(--neon-green)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              isCommandsOnly
                ? "Search commands…"
                : "Search apps, files, commands…"
            }
          />
          <span className="esc">ESC</span>
        </div>

        <div ref={listRef} className="ot-spotlight-list scroll">
          {visible.length === 0 && (
            <div className="ot-spotlight-empty">No results.</div>
          )}
          {sections.map((section, sIdx) => (
            <div key={section.label}>
              <div className="ot-spotlight-section">{section.label}</div>
              {section.items.map((entry, iIdx) => {
                const idx = flatIndex(sIdx, iIdx);
                const selectedNow = idx === selected;
                return (
                  <div
                    key={entry.id}
                    data-idx={idx}
                    className={`ot-spotlight-item${selectedNow ? " selected" : ""}`}
                    onMouseEnter={() => setSelected(idx)}
                    onClick={() => entry.run()}
                  >
                    <span style={{ width: 14, display: "inline-flex", color: "var(--t-tertiary)" }}>
                      {entry.kind === "archive" ? (
                        <ArchiveIcon size={11} color="var(--neon-green)" />
                      ) : entry.kind === "project" ? (
                        <Folder size={11} color="var(--neon-cyan)" />
                      ) : entry.kind === "activity" ? (
                        <Clock size={11} color="var(--neon-violet)" />
                      ) : (
                        <Search size={11} />
                      )}
                    </span>
                    <span className="label">
                      <div className="primary">{entry.label}</div>
                      {entry.hint && <div className="secondary">{entry.hint}</div>}
                    </span>
                    {entry.hotkey && <span className="hotkey">{entry.hotkey}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="ot-spotlight-footer">
          <span>↑↓ nav · ↵ open · esc close</span>
          <span className="listening">
            <span className="dot" />
            claude · listening
          </span>
        </div>
      </div>
    </div>
  );
}

function kindHintForHit(h: SearchHit): string {
  if (h.entityType === "chat") return "chat";
  if (h.entityType === "asset") return "asset";
  switch (h.noteKind) {
    case "project":
      return "project";
    case "journal":
      return "journal";
    case "note":
    default:
      return "note";
  }
}

