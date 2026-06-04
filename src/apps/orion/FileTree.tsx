import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  Plus,
  GitBranch,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { ipc, type TreeNode } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { useTabsStore, isPathDirty } from "@/store/tabsStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { registry } from "@/commands/registry";
import { log } from "@/lib/log";
import { useFileDropZone } from "@/lib/fileDrop";

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
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
            <TreeRow key={c.path} node={c} depth={depth + 1} />
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

export function OrionFileTree() {
  const project = useProjectStore((s) => s.active);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTab = useWorkspace((s) => s.openTab);

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
        <button
          type="button"
          onClick={() => registry.run("file.openProject")}
          title="Open project"
          style={{
            background: "none",
            border: 0,
            color: "var(--t-tertiary)",
            cursor: "pointer",
            padding: 2,
          }}
        >
          <Plus size={11} />
        </button>
      </div>

      <div className="or-tree-scroll scroll">
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
              <TreeRow key={c.path} node={c} depth={0} />
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
    </div>
  );
}
