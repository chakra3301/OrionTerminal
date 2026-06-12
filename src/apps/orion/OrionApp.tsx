import { File as FileIcon, FolderTree, Sparkles, Terminal as TerminalIcon, Eye, Folder, StickyNote, Bot, Image as ImageIcon, Film, Music, FileText, AlertCircle, Search, GitPullRequestArrow, FileDiff } from "lucide-react";
import { mediaTypeForPath } from "@/lib/mediaTypes";
import { OrionMediaViewer } from "@/apps/orion/MediaViewer";
import { useProjectStore } from "@/store/projectStore";
import { useTabsStore, isFileTabDirty } from "@/store/tabsStore";
import { registry } from "@/commands/registry";
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
import { OrionFileTree } from "@/apps/orion/FileTree";
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
import { NoteEditor } from "@/features/notes/NoteEditor";
import { useNotesStore } from "@/store/notesStore";

const orionRegistry: ContentRegistry = {
  render: (tab: Tab) => {
    switch (tab.descriptor.kind) {
      case "files-tree":
        return <OrionFileTree />;
      case "preview":
        return <OrionPreview />;
      case "terminal":
        return <OrionTerminalPanel id={tab.descriptor.id} />;
      case "claude":
        return <OrionClaudeRail />;
      case "claude-code":
        return <OrionClaudeCodePanel />;
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
    switch (tab.descriptor.kind) {
      case "files-tree":
        return <FolderTree size={11} color="var(--t-tertiary)" />;
      case "preview":
        return <Eye size={11} color="var(--neon-cyan)" />;
      case "terminal":
        return <TerminalIcon size={11} color="var(--neon-green)" />;
      case "claude":
        return <Sparkles size={11} color="var(--neon-cyan)" />;
      case "claude-code":
        return <Bot size={11} color="var(--neon-violet)" />;
      case "problems":
        return <AlertCircle size={11} color="var(--neon-magenta)" />;
      case "search":
        return <Search size={11} color="var(--t-secondary)" />;
      case "changes":
        return <GitPullRequestArrow size={11} color="var(--neon-yellow)" />;
      case "diff-review":
        return <FileDiff size={11} color="var(--neon-cyan)" />;
      case "file": {
        const m = mediaTypeForPath(tab.descriptor.path);
        if (m?.kind === "image")
          return <ImageIcon size={11} color="var(--neon-cyan)" />;
        if (m?.kind === "video")
          return <Film size={11} color="var(--neon-cyan)" />;
        if (m?.kind === "audio")
          return <Music size={11} color="var(--neon-cyan)" />;
        if (m?.kind === "pdf")
          return <FileText size={11} color="var(--neon-cyan)" />;
        return <FileIcon size={11} color="var(--t-tertiary)" />;
      }
      case "note":
        return <StickyNote size={11} color="var(--neon-green)" />;
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
        label: "Orix47 — AI rail",
        icon: <Sparkles size={13} color="var(--neon-cyan)" />,
        onSelect: () => open({ kind: "claude" }),
      },
      {
        id: "claude-code",
        label: "Claude Code",
        icon: <Bot size={13} color="var(--neon-violet)" />,
        onSelect: () => open({ kind: "claude-code", id: ulid() }),
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
        icon: <TerminalIcon size={13} color="var(--neon-green)" />,
        onSelect: () => open({ kind: "terminal", id: ulid() }),
      },
      {
        id: "preview",
        label: "Preview",
        icon: <Eye size={13} color="var(--neon-cyan)" />,
        onSelect: () => open({ kind: "preview" }),
      },
      {
        id: "files-tree",
        label: "Explorer",
        icon: <FolderTree size={13} color="var(--t-tertiary)" />,
        onSelect: () => open({ kind: "files-tree" }),
      },
    ];
  },
};

export function OrionApp() {
  const project = useProjectStore((s) => s.active);

  if (!project) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 32,
          color: "var(--t-secondary)",
        }}
      >
        <Folder size={32} color="var(--t-tertiary)" />
        <div style={{ fontSize: 14 }}>No project open</div>
        <button
          type="button"
          onClick={() => registry.run("file.openProject")}
          style={{
            padding: "8px 16px",
            borderRadius: "var(--r-sm)",
            background: "rgba(0, 224, 255, 0.10)",
            border: "1px solid rgba(0, 224, 255, 0.30)",
            color: "var(--neon-cyan)",
            cursor: "pointer",
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Open Folder…
        </button>
        <div
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            color: "var(--t-tertiary)",
            marginTop: 8,
          }}
        >
          ⌘K palette · ⌘L new chat · ⌘` terminal
        </div>
      </div>
    );
  }

  return (
    <div className="or-app">
      <Workspace registry={orionRegistry} />
      <OrionStatusBar />
      <QuickOpen />
    </div>
  );
}
