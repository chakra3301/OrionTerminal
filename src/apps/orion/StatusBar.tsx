import { GitBranch } from "lucide-react";
import { useTabsStore, isFileTabDirty } from "@/store/tabsStore";
import { useProjectStore } from "@/store/projectStore";
import { useNotesStore } from "@/store/notesStore";
import { useStatusStore } from "@/store/statusStore";
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

  const activeTab = activeTabInFocused(root, focusedPanelId);
  const fileDirty = activeTab ? isFileTabDirty(activeTab, fileBuffers) : false;
  const noteDirty =
    activeTab?.descriptor.kind === "note" &&
    pendingNoteWrites.has(activeTab.descriptor.noteId);
  const dirty = fileDirty || noteDirty;

  const label = activeTab?.label ?? "—";
  const extension =
    activeTab?.descriptor.kind === "file"
      ? activeTab.descriptor.path.split(".").pop()?.toUpperCase() ?? "TXT"
      : activeTab?.descriptor.kind ?? "—";

  return (
    <div className="or-statusbar">
      <span className="branch">
        <GitBranch size={10} />
        <span>{project?.name ?? "no project"}</span>
      </span>
      <span className="item">⨯ 0</span>
      <span className="item">⚠ 0</span>
      <span className="item" style={{ color: "var(--t-secondary)" }}>
        {label}
      </span>
      {dirty && (
        <span className="item" style={{ color: "var(--neon-yellow)" }}>
          ● unsaved
        </span>
      )}
      <div style={{ flex: 1 }} />
      {hint && <span className="item" style={{ color: "var(--neon-cyan)" }}>{hint}</span>}
      <span className="item">{extension}</span>
      <span className="item">UTF-8</span>
      <span className="item cyan">⌘K claude</span>
    </div>
  );
}
