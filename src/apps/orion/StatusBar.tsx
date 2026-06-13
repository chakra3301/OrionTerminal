import { GitBranch, FolderGit2, Check } from "lucide-react";
import { useTabsStore, isFileTabDirty } from "@/store/tabsStore";
import { useProjectStore } from "@/store/projectStore";
import { useNotesStore } from "@/store/notesStore";
import { useStatusStore } from "@/store/statusStore";
import { useDiagnosticsStore } from "@/store/diagnosticsStore";
import { useEditorStatusStore } from "@/store/editorStatusStore";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { useGit } from "@/store/gitStore";
import { useLspStatus } from "@/features/lsp/lspManager";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import type { LayoutNode, Tab } from "@/components/workspace/types";

function LspIndicator() {
  const lspServers = useLspStatus((s) => s.servers);
  if (lspServers.length === 0) return null;
  return (
    <span className="item" style={{ color: "var(--neon-violet)" }} title="Language servers running">
      ⚙ {lspServers.join(" ")}
    </span>
  );
}

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

  const isRepo = useGit((s) => s.isRepo);
  const branch = useGit((s) => s.branch);
  const ahead = useGit((s) => s.ahead);
  const behind = useGit((s) => s.behind);
  const gitDirty = useGit((s) => s.files.size);
  const { openFromButton, menu } = useContextMenu();

  const openBranchMenu = (el: HTMLElement) => {
    const root = project?.root_path;
    if (!root) return;
    void ipc
      .gitBranches(root)
      .then(({ current, branches }) => {
        const items: MenuItem[] = branches.map((b) => ({
          label: b,
          icon: b === current ? <Check size={12} /> : <GitBranch size={12} />,
          disabled: b === current,
          onClick: () => {
            void ipc
              .gitCheckout(root, b)
              .then(() => toast.success(`Switched to ${b}`))
              .catch((e) =>
                toast.error("Checkout failed", {
                  body: e instanceof Error ? e.message : String(e),
                }),
              )
              .finally(() => useGit.getState().refresh());
          },
        }));
        openFromButton(el, items);
      })
      .catch((e) =>
        toast.error("Couldn't list branches", {
          body: e instanceof Error ? e.message : String(e),
        }),
      );
  };

  return (
    <div className="or-statusbar">
      <span className="branch">
        <FolderGit2 size={10} />
        <span>{project?.name ?? "no project"}</span>
      </span>
      {isRepo && branch && (
        <button
          type="button"
          className="or-status-btn"
          title="Switch branch"
          onClick={(e) => openBranchMenu(e.currentTarget)}
        >
          <span className="item" style={{ color: "var(--neon-green)" }}>
            <GitBranch size={10} /> {branch}
            {ahead > 0 && ` ↑${ahead}`}
            {behind > 0 && ` ↓${behind}`}
            {gitDirty > 0 && ` ·${gitDirty}`}
          </span>
        </button>
      )}
      {menu}
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
      <LspIndicator />
      <span className="item">{extension}</span>
      <span className="item">UTF-8</span>
      <span className="item cyan">⌘K claude</span>
    </div>
  );
}
