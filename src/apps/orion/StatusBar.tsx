import { GitBranch } from "lucide-react";
import { useTabsStore, isFileTabDirty } from "@/store/tabsStore";
import { useProjectStore } from "@/store/projectStore";
import { useNotesStore } from "@/store/notesStore";
import { useStatusStore } from "@/store/statusStore";
import { useDiagnosticsStore } from "@/store/diagnosticsStore";
import { useEditorStatusStore } from "@/store/editorStatusStore";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import type { LayoutNode, Tab } from "@/components/workspace/types";

function activeTabInFocused(
  root: LayoutNode,
  focusedPanelId: string | null,
): Tab | null {
  if (!focusedPanelId) return null;
  function recur(n: LayoutNode): Tab | null {
    if (n.kind === "panel") {
      if (n.id !== focusedPanelId) return null;
      return n.tabs.find((t) => t.id === n.activeTabId) ?? null;
    }
    for (const c of n.children) {
      const hit = recur(c);
      if (hit) return hit;
    }
    return null;
  }
  return recur(root);
}

export function OrionStatusBar() {
  const project = useProjectStore((s) => s.active);
  const root = useWorkspace((s) => s.root);
  const focusedPanelId = useWorkspace((s) => s.focusedPanelId);
  const fileBuffers = useTabsStore((s) => s.fileBuffers);
  const pendingNoteWrites = useNotesStore((s) => s.pendingWrites);
  const hint = useStatusStore((s) => s.hint);
  const errorCount = useDiagnosticsStore((s) => s.errorCount);
  const warningCount = useDiagnosticsStore((s) => s.warningCount);
  const pendingCount = usePendingEdits((s) => s.order.length);
  const es = useEditorStatusStore();

  const activeTab = activeTabInFocused(root, focusedPanelId);
  const fileDirty = activeTab ? isFileTabDirty(activeTab, fileBuffers) : false;
  const noteDirty =
    activeTab?.descriptor.kind === "note" &&
    pendingNoteWrites.has(activeTab.descriptor.noteId);
  const dirty = fileDirty || noteDirty;

  const label = activeTab?.label ?? "—";
  const isFile = activeTab?.descriptor.kind === "file";
  const extension =
    activeTab?.descriptor.kind === "file"
      ? activeTab.descriptor.path.split(".").pop()?.toUpperCase() ?? "TXT"
      : activeTab?.descriptor.kind ?? "—";

  const openProblems = () =>
    useWorkspace.getState().openTab({ kind: "problems" });
  const openChanges = () =>
    useWorkspace.getState().openTab({ kind: "changes" });

  return (
    <div className="or-statusbar">
      <span className="branch">
        <GitBranch size={10} />
        <span>{project?.name ?? "no project"}</span>
      </span>
      <button
        type="button"
        className="or-status-btn"
        onClick={openProblems}
        title="Problems"
      >
        <span
          className="item"
          style={errorCount ? { color: "var(--neon-magenta)" } : undefined}
        >
          ⨯ {errorCount}
        </span>
        <span
          className="item"
          style={warningCount ? { color: "var(--neon-yellow)" } : undefined}
        >
          ⚠ {warningCount}
        </span>
      </button>
      <span className="item" style={{ color: "var(--t-secondary)" }}>
        {label}
      </span>
      {dirty && (
        <span className="item" style={{ color: "var(--neon-yellow)" }}>
          ● unsaved
        </span>
      )}
      {pendingCount > 0 && (
        <button
          type="button"
          className="or-status-btn"
          onClick={openChanges}
          title="Review AI changes"
        >
          <span className="item" style={{ color: "var(--neon-yellow)" }}>
            ◆ {pendingCount} {pendingCount === 1 ? "change" : "changes"}
          </span>
        </button>
      )}
      <div style={{ flex: 1 }} />
      {hint && (
        <span className="item" style={{ color: "var(--neon-cyan)" }}>
          {hint}
        </span>
      )}
      {isFile && es.line > 0 && (
        <span className="item">
          Ln {es.line}, Col {es.column}
          {es.selectionChars > 0 && ` (${es.selectionChars} sel)`}
        </span>
      )}
      {isFile && es.indentKind && (
        <span className="item">
          {es.indentKind === "spaces" ? "Spaces" : "Tabs"}: {es.indentSize}
        </span>
      )}
      {isFile && es.language && <span className="item">{es.language}</span>}
      <span className="item">{extension}</span>
      <span className="item">UTF-8</span>
      <span className="item cyan">⌘K claude</span>
    </div>
  );
}
