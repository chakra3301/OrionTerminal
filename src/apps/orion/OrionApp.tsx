import { FolderTree, Sparkles, Terminal as TerminalIcon, Eye, StickyNote, Bot, AlertCircle, Search, GitPullRequestArrow, FileDiff, Columns2 } from "lucide-react";
import { useEffect } from "react";
import { confirmAction } from "@/components/ConfirmModal";
import { registry as commands } from "@/commands/registry";
import { OrionSidebar } from "@/apps/orion/OrionSidebar";
import { mediaTypeForPath } from "@/lib/mediaTypes";
import { FileTypeIcon } from "@/lib/fileIcon";
import { OrionMediaViewer } from "@/apps/orion/MediaViewer";
import { useProjectStore } from "@/store/projectStore";
import { useTabsStore, isFileTabDirty } from "@/store/tabsStore";
import {
  Workspace,
  type ContentRegistry,
  type AddMenuItem,
} from "@/components/workspace/Workspace";
import { ulid } from "ulid";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import type {
  LayoutPanel,
  Tab,
  TabDescriptor,
} from "@/components/workspace/types";
import { OrionEditor } from "@/apps/orion/Editor";
import { OrionPreview } from "@/apps/orion/Preview";
import { OrionTerminalPanel } from "@/apps/orion/Terminal";
import { OrionClaudeCodePanel } from "@/apps/orion/ClaudeCodePanel";
import { OrionProblemsPanel } from "@/apps/orion/ProblemsPanel";
import { OrionSearchPanel } from "@/apps/orion/SearchPanel";
import { OrionChangesPanel } from "@/apps/orion/ChangesPanel";
import { OrionDiffReview } from "@/apps/orion/DiffReview";
import { OrionStatusBar } from "@/apps/orion/StatusBar";
import { OrionClaudeRail } from "@/apps/orion/OrionClaudeRail";
import { QuickOpen } from "@/apps/orion/QuickOpen";
import { OrionHome } from "@/apps/orion/OrionHome";
import { NoteEditor } from "@/features/notes/NoteEditor";
import { useNotesStore } from "@/store/notesStore";

const orionRegistry: ContentRegistry = {
  render: (tab: Tab) => {
    switch (tab.descriptor.kind) {
      case "files-tree":
        return <OrionSidebar />;
      case "preview":
        return <OrionPreview />;
      case "terminal":
        return (
          <OrionTerminalPanel
            id={tab.descriptor.id}
            initialCommand={tab.descriptor.initialCommand}
          />
        );
      case "claude":
        return <OrionClaudeRail />;
      case "claude-code":
        return (
          <OrionClaudeCodePanel
            agent={tab.descriptor.agent ?? "claude"}
            tabId={tab.id}
            initialView={tab.descriptor.view}
          />
        );
      case "problems":
        return <OrionProblemsPanel />;
      case "search":
        return <OrionSearchPanel />;
      case "changes":
        return <OrionChangesPanel />;
      case "diff-review":
        return <OrionDiffReview path={tab.descriptor.path} />;
      case "file":
        return mediaTypeForPath(tab.descriptor.path) ? (
          <OrionMediaViewer path={tab.descriptor.path} />
        ) : (
          <OrionEditor path={tab.descriptor.path} />
        );
      case "note":
        return <NoteEditor noteId={tab.descriptor.noteId} />;
      default:
        return null;
    }
  },
  icon: (tab: Tab) => {
    // Quiet monochrome glyphs; the active tab lifts them to ink in CSS.
    const d = tab.descriptor;
    switch (d.kind) {
      case "files-tree":
        return <FolderTree size={14} />;
      case "preview":
        return <Eye size={14} />;
      case "terminal":
        return <TerminalIcon size={14} />;
      case "claude":
        return <Sparkles size={14} />;
      case "claude-code":
        return <Bot size={14} />;
      case "problems":
        return <AlertCircle size={14} />;
      case "search":
        return <Search size={14} />;
      case "changes":
        return <GitPullRequestArrow size={14} />;
      case "diff-review":
        return <FileDiff size={14} />;
      case "file": {
        return <FileTypeIcon path={d.path} />;
      }
      case "note":
        return <StickyNote size={14} />;
      default:
        return null;
    }
  },
  label: (tab: Tab) => {
    if (tab.descriptor.kind === "note") {
      const note = useNotesStore.getState().notes.get(tab.descriptor.noteId);
      return note?.title?.trim() || "Untitled";
    }
    return tab.label;
  },
  isDirty: (tab: Tab) => {
    if (tab.descriptor.kind === "file") {
      return isFileTabDirty(tab, useTabsStore.getState().fileBuffers);
    }
    if (tab.descriptor.kind === "note") {
      return useNotesStore.getState().pendingWrites.has(tab.descriptor.noteId);
    }
    return false;
  },
  confirmClose: async (tab: Tab) => {
    if (tab.descriptor.kind !== "file" || !isFileTabDirty(tab, useTabsStore.getState().fileBuffers)) return true;
    return confirmAction({
      title: `Close ${tab.label}?`,
      body: "Your changes will be lost if you don't save them.",
      confirmLabel: "Close without saving",
      danger: true,
    });
  },
  tabActions: (panel: LayoutPanel) => {
    if (panel.role === "explorer" || panel.role === "claude" || panel.role === "terminal") return null;
    const active = panel.tabs.find((t) => t.id === panel.activeTabId);
    if (active?.descriptor.kind !== "file") return null;
    return (
      <button
        type="button"
        className="ot-panel-tab-add"
        title="Split Editor Right (⌘\\)"
        aria-label="Split Editor Right"
        onClick={() => {
          useWorkspace.getState().focusPanel(panel.id);
          useWorkspace.getState().splitFocusedPanel();
        }}
      >
        <Columns2 size={14} />
      </button>
    );
  },
  emptyEditor: () => <OrionEmptyEditor />,
  persistent: (tab: Tab) =>
    tab.descriptor.kind === "claude-code" ||
    tab.descriptor.kind === "terminal",
  addMenu: (panel: LayoutPanel): AddMenuItem[] => {
    // Explorer stays clean — just the file tree, no opener.
    if (panel.role === "explorer") return [];

    // Open into the panel the "+" was clicked on (singleton tabs like
    // claude-code still activate an existing instance if already open).
    const open = (descriptor: TabDescriptor) =>
      useWorkspace.getState().openTab(descriptor, { panelId: panel.id });

    const ai: AddMenuItem[] = [
      {
        id: "claude",
        label: "Orix47",
        icon: <Sparkles size={13} />,
        onSelect: () => open({ kind: "claude" }),
      },
      {
        id: "claude-code",
        label: "Claude Code",
        icon: <Bot size={13} />,
        onSelect: () =>
          open({ kind: "claude-code", id: ulid(), agent: "claude" }),
      },
      {
        id: "codex-code",
        label: "Codex",
        icon: <Bot size={13} />,
        onSelect: () =>
          open({ kind: "claude-code", id: ulid(), agent: "codex" }),
      },
      {
        id: "hermes-code",
        label: "Hermes",
        icon: <Bot size={13} />,
        onSelect: () =>
          open({ kind: "claude-code", id: ulid(), agent: "hermes" }),
      },
      {
        id: "pi-code",
        label: "Pi",
        icon: <Bot size={13} />,
        onSelect: () => open({ kind: "claude-code", id: ulid(), agent: "pi" }),
      },
    ];

    // The right rail is AI-only.
    if (panel.role === "claude") return ai;

    // The bottom terminal dock is terminal-only — no opener (like the
    // explorer). Keeps non-terminal panes out of the slim bottom strip; drag a
    // tab there explicitly if you really want it.
    if (panel.role === "terminal") return [];

    // The middle (editor) — and any other panel — can open everything.
    return [
      ...ai,
      {
        id: "terminal",
        label: "Terminal",
        icon: <TerminalIcon size={13} />,
        onSelect: () => open({ kind: "terminal", id: ulid() }),
      },
      {
        id: "preview",
        label: "Preview",
        icon: <Eye size={13} />,
        onSelect: () => open({ kind: "preview" }),
      },
    ];
  },
};

const EMPTY_SHORTCUTS: { label: string; keys: string[]; command: string }[] = [
  { label: "Go to File", keys: ["⌘", "P"], command: "file.openFile" },
  { label: "Search in Files", keys: ["⇧", "⌘", "F"], command: "search.inFiles" },
  { label: "Toggle Terminal", keys: ["⌘", "`"], command: "terminal.toggle" },
  { label: "Toggle Agent", keys: ["⌘", "J"], command: "panel.toggleRightRail" },
  { label: "Spotlight", keys: ["⌘", "K"], command: "palette.open" },
];

/** The editor area with nothing open: Cursor's quiet shortcut sheet. */
function OrionEmptyEditor() {
  return (
    <div className="or-empty-editor">
      <div className="or-empty-editor-list">
        {EMPTY_SHORTCUTS.map((s) => (
          <button key={s.command} type="button" className="or-empty-editor-row" onClick={() => void commands.run(s.command)}>
            <span className="l">{s.label}</span>
            <span className="k">{s.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OrionApp() {
  const project = useProjectStore((s) => s.active);

  // Editing a preview tab keeps it, as in Cursor.
  useEffect(() => useTabsStore.subscribe((state, prev) => {
    for (const path of Object.keys(state.fileBuffers)) {
      const now = state.fileBuffers[path], before = prev.fileBuffers[path];
      if (now && before?.loaded && now.loaded && now.contents !== before.contents) useWorkspace.getState().pinFile(path);
    }
  }), []);

  if (!project) {
    return <OrionHome />;
  }

  return (
    <div className="or-app">
      <Workspace registry={orionRegistry} />
      <OrionStatusBar />
      <QuickOpen />
    </div>
  );
}
