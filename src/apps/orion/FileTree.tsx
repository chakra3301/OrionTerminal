import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  FolderSearch,
  GitBranch,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { confirmAction } from "@/components/ConfirmModal";
import { toast } from "@/store/toastStore";
import { ipc, type TreeNode } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { useTabsStore, isPathDirty } from "@/store/tabsStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { useWorkspace, allTabs } from "@/components/workspace/workspaceStore";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { promptText } from "@/components/PromptModal";
import { registry } from "@/commands/registry";
import { log } from "@/lib/log";
import { useFileDropZone } from "@/lib/fileDrop";

type RowContext = (e: React.MouseEvent, node: TreeNode) => void;

function TreeRow({
  node,
  depth,
  onContext,
}: {
  node: TreeNode;
  depth: number;
  onContext: RowContext;
}) {
  const [open, setOpen] = useState(depth === 0);
  const openTab = useWorkspace((s) => s.openTab);
  const root = useWorkspace((s) => s.root);
  const fileBuffers = useTabsStore((s) => s.fileBuffers);

  // Active = some panel has this file as its active tab.
  const isActive = !node.is_dir && tabIsActiveAnywhere(root, node.path);
  const dirty = !node.is_dir && isPathDirty(node.path, fileBuffers);

  const onClick = () => {
    if (node.is_dir) {
      setOpen((o) => !o);
    } else {
      openTab(
        { kind: "file", path: node.path },
        { label: node.name, preferRole: "editor" },
      );
    }
  };

  const classes = [
    "or-tree-item",
    open ? "open" : "",
    isActive ? "active" : "",
    dirty ? "dirty" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <div
        className={classes}
        style={{ paddingLeft: 12 + depth * 12 }}
        onClick={onClick}
        onContextMenu={(e) => onContext(e, node)}
        title={node.path}
      >
        {node.is_dir ? (
          open ? (
            <ChevronDown size={10} color="var(--t-tertiary)" />
          ) : (
            <ChevronRight size={10} color="var(--t-tertiary)" />
          )
        ) : (
          <span style={{ width: 10, display: "inline-block" }} />
        )}
        {node.is_dir ? (
          open ? (
            <FolderOpen size={13} color="var(--neon-cyan)" />
          ) : (
            <Folder size={13} color="var(--t-secondary)" />
          )
        ) : (
          <FileIcon size={12} color="var(--t-secondary)" />
        )}
        <span>{node.name}</span>
        {dirty && (
          <span
            style={{
              marginLeft: "auto",
              color: "var(--neon-yellow)",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            •
          </span>
        )}
      </div>
      {open && node.is_dir && node.children && (
        <div>
          {node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              onContext={onContext}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function tabIsActiveAnywhere(
  node: ReturnType<typeof useWorkspace.getState>["root"],
  path: string,
): boolean {
  if (node.kind === "panel") {
    const active = node.tabs.find((t) => t.id === node.activeTabId);
    return !!active && active.descriptor.kind === "file" && active.descriptor.path === path;
  }
  return node.children.some((c) => tabIsActiveAnywhere(c, path));
}

const parentDir = (p: string) => p.replace(/[\\/][^\\/]*$/, "") || p;
const joinPath = (dir: string, name: string) => `${dir}/${name}`;

export function OrionFileTree() {
  const project = useProjectStore((s) => s.active);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTab = useWorkspace((s) => s.openTab);
  const { openAt, menu } = useContextMenu();

  // Drop files from Finder onto the tree → open each as a workspace tab.
  // (Doesn't copy them into the project — opening matches VS Code's
  // drag-into-tabs behavior; if they're outside the project, they still open
  // read-only-ish via the editor's path handling.)
  useFileDropZone(panelRef, "orion-files", (e) => {
    if (e.type === "enter") setDropOver(true);
    else if (e.type === "leave") setDropOver(false);
    else {
      setDropOver(false);
      for (const path of e.paths) {
        const label = path.split(/[\\/]/).pop() || path;
        openTab({ kind: "file", path }, { label, preferRole: "editor" });
      }
    }
  });

  const refresh = useCallback(async () => {
    if (!project) {
      setTree(null);
      return;
    }
    setLoading(true);
    try {
      const t = await ipc.readDirTree(project.root_path, 6);
      setTree(t);
    } catch (e) {
      log.error("readDirTree failed", e);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const closeTabsFor = (path: string) => {
    const ws = useWorkspace.getState();
    for (const t of allTabs(ws.root)) {
      if (t.descriptor.kind === "file" && t.descriptor.path === path) {
        ws.closeTab(t.id);
      }
    }
  };

  const doNewFile = async (dir: string) => {
    const name = await promptText({
      title: "New File",
      label: `in ${dir.split(/[\\/]/).pop()}`,
      placeholder: "component.tsx",
      confirmLabel: "Create",
    });
    if (!name) return;
    const target = joinPath(dir, name);
    try {
      await ipc.createPath(target, false);
      await refresh();
      openTab({ kind: "file", path: target }, { label: name, preferRole: "editor" });
    } catch (e) {
      log.error("create file failed", e);
    }
  };

  const doNewFolder = async (dir: string) => {
    const name = await promptText({
      title: "New Folder",
      label: `in ${dir.split(/[\\/]/).pop()}`,
      confirmLabel: "Create",
    });
    if (!name) return;
    try {
      await ipc.createPath(joinPath(dir, name), true);
      await refresh();
    } catch (e) {
      log.error("create folder failed", e);
    }
  };

  const doRename = async (node: TreeNode) => {
    const next = await promptText({
      title: "Rename",
      initialValue: node.name,
      confirmLabel: "Rename",
    });
    if (!next || next === node.name) return;
    const target = joinPath(parentDir(node.path), next);
    const wasOpen =
      !node.is_dir &&
      allTabs(useWorkspace.getState().root).some(
        (t) => t.descriptor.kind === "file" && t.descriptor.path === node.path,
      );
    try {
      await ipc.renamePath(node.path, target);
      if (wasOpen) {
        closeTabsFor(node.path);
        openTab({ kind: "file", path: target }, { label: next, preferRole: "editor" });
      }
      await refresh();
    } catch (e) {
      log.error("rename failed", e);
      toast.error(`Couldn't rename ${node.name}`, {
        body: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const doDelete = async (node: TreeNode) => {
    const ok = await confirmAction({
      title: `Delete ${node.name}?`,
      body: "This deletes it from disk permanently. It cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await ipc.deletePath(node.path);
      closeTabsFor(node.path);
      await refresh();
    } catch (e) {
      log.error("delete failed", e);
      toast.error(`Couldn't delete ${node.name}`, {
        body: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const buildMenu = (node: TreeNode): MenuItem[] => {
    const items: MenuItem[] = [];
    if (node.is_dir) {
      items.push({
        label: "New File…",
        icon: <FilePlus size={13} />,
        onClick: () => void doNewFile(node.path),
      });
      items.push({
        label: "New Folder…",
        icon: <FolderPlus size={13} />,
        onClick: () => void doNewFolder(node.path),
      });
      items.push({ type: "separator" });
    }
    items.push({
      label: "Rename…",
      icon: <Pencil size={13} />,
      onClick: () => void doRename(node),
    });
    items.push({
      label: "Copy Path",
      icon: <Copy size={13} />,
      onClick: () => void navigator.clipboard.writeText(node.path),
    });
    items.push({
      label: "Reveal in Finder",
      icon: <FolderSearch size={13} />,
      onClick: () =>
        void ipc.revealInOs(node.path).catch((e) => log.error("reveal", e)),
    });
    items.push({ type: "separator" });
    items.push({
      label: "Delete",
      icon: <Trash2 size={13} />,
      danger: true,
      onClick: () => void doDelete(node),
    });
    return items;
  };

  const onRowContext: RowContext = (e, node) => openAt(e, buildMenu(node));

  const onRootContext = (e: React.MouseEvent) => {
    if (!project) return;
    openAt(e, [
      {
        label: "New File…",
        icon: <FilePlus size={13} />,
        onClick: () => void doNewFile(project.root_path),
      },
      {
        label: "New Folder…",
        icon: <FolderPlus size={13} />,
        onClick: () => void doNewFolder(project.root_path),
      },
      { type: "separator" },
      {
        label: "Refresh",
        onClick: () => void refresh(),
      },
    ]);
  };

  useEffect(() => {
    if (!project) return;
    const unlisten = listen("claude:exit", () => {
      void refresh();
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [project, refresh]);

  // Mid-stream refresh: EventBridge bumps this counter whenever a
  // file-modifying tool (Write/Edit/MultiEdit/NotebookEdit) tool_result comes
  // back, so the tree can show new files before the turn finishes.
  const refreshVersion = useFileTreeRefresh((s) => s.version);
  useEffect(() => {
    if (refreshVersion === 0) return;
    void refresh();
  }, [refreshVersion, refresh]);

  useEffect(() => {
    return registry.register({
      id: "files.refresh",
      label: "Files: Refresh tree",
      keywords: ["reload", "tree", "files"],
      group: "File",
      run: () => {
        void refresh();
      },
    });
  }, [refresh]);

  return (
    <div
      ref={panelRef}
      className={`or-files-panel${dropOver ? " drop-over" : ""}`}
    >
      <div className="or-files-header">
        <span>EXPLORER</span>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            type="button"
            onClick={() => project && doNewFile(project.root_path)}
            disabled={!project}
            title="New file"
            className="or-files-hbtn"
          >
            <FilePlus size={12} />
          </button>
          <button
            type="button"
            onClick={() => project && doNewFolder(project.root_path)}
            disabled={!project}
            title="New folder"
            className="or-files-hbtn"
          >
            <FolderPlus size={12} />
          </button>
        </div>
      </div>

      <div className="or-tree-scroll scroll" onContextMenu={onRootContext}>
        {!project && (
          <div style={{ padding: 14, fontSize: 12, color: "var(--t-tertiary)" }}>
            <p style={{ marginBottom: 8 }}>No project open.</p>
            <button
              type="button"
              onClick={() => registry.run("file.openProject")}
              style={{
                color: "var(--neon-cyan)",
                background: "none",
                border: 0,
                cursor: "pointer",
                padding: 0,
                font: "inherit",
                textDecoration: "underline",
              }}
            >
              Open a folder…
            </button>
          </div>
        )}
        {project && loading && (
          <div style={{ padding: 14, fontSize: 12, color: "var(--t-tertiary)" }}>
            Loading…
          </div>
        )}
        {project && !loading && tree && (
          <div className="or-tree">
            {tree.children?.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={0}
                onContext={onRowContext}
              />
            ))}
          </div>
        )}
      </div>

      {project && (
        <div className="or-files-footer">
          <div className="branch">
            <GitBranch size={11} color="var(--neon-green)" />
            <span>{project.name}</span>
          </div>
          <div>orion · workspace</div>
        </div>
      )}
      {menu}
    </div>
  );
}
