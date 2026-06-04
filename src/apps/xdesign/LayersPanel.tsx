import { useMemo, useState } from "react";
import type { MouseEvent } from "react";
import {
  Layers,
  Square as RectIcon,
  Circle as EllipseIcon,
  Type as TextIcon,
  Image as ImageIcon,
  Frame as FrameIcon,
  PenTool as PathIcon,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Trash2,
  FileText,
} from "lucide-react";
import {
  useXDesign,
  collectDescendantIds,
  type Shape,
  type ShapePatch,
} from "@/apps/xdesign/store";
import { XDesignVariablesPanel } from "@/apps/xdesign/VariablesPanel";

const LAYER_DRAG_MIME = "application/x-xdesign-layer";

function PagesList() {
  const pages = useXDesign((s) => s.pages);
  const activePageId = useXDesign((s) => s.activePageId);
  const switchPage = useXDesign((s) => s.switchPage);
  const newPage = useXDesign((s) => s.newPage);
  const renamePage = useXDesign((s) => s.renamePage);
  const deletePage = useXDesign((s) => s.deletePage);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="xd-pages">
      <div className="xd-pages-head">
        <span>Pages</span>
        <button
          type="button"
          className="xd-pages-add"
          title="New page"
          onClick={() => newPage()}
        >
          <Plus size={11} />
        </button>
      </div>
      {pages.map((p) => {
        const isActive = p.id === activePageId;
        const isEditing = editingId === p.id;
        return (
          <div
            key={p.id}
            className={`xd-page-row${isActive ? " active" : ""}`}
            onClick={() => {
              if (!isEditing) switchPage(p.id);
            }}
            onDoubleClick={() => {
              setEditingId(p.id);
              setDraft(p.name);
            }}
          >
            <FileText size={11} />
            {isEditing ? (
              <input
                className="xd-page-name-input"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft.trim()) renamePage(p.id, draft.trim());
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    setEditingId(null);
                    setDraft(p.name);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="xd-page-name">{p.name}</span>
            )}
            {pages.length > 1 && (
              <button
                type="button"
                className="xd-page-del"
                title="Delete page"
                onClick={(e) => {
                  e.stopPropagation();
                  deletePage(p.id);
                }}
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function KindIcon({ kind }: { kind: Shape["kind"] }) {
  if (kind === "rect") return <RectIcon size={11} />;
  if (kind === "ellipse") return <EllipseIcon size={11} />;
  if (kind === "image") return <ImageIcon size={11} />;
  if (kind === "frame") return <FrameIcon size={11} />;
  if (kind === "path") return <PathIcon size={11} />;
  return <TextIcon size={11} />;
}

type TreeNode = { shape: Shape; depth: number; childCount: number };

function buildTree(shapes: Shape[]): TreeNode[] {
  // Reversed so highest z-order appears first in the panel.
  const ordered = shapes.slice().reverse();
  const childrenByParent = new Map<string, Shape[]>();
  for (const s of ordered) {
    const p = s.parentId ?? null;
    if (!p) continue;
    const arr = childrenByParent.get(p) ?? [];
    arr.push(s);
    childrenByParent.set(p, arr);
  }
  const roots = ordered.filter((s) => !s.parentId);
  const out: TreeNode[] = [];
  const walk = (s: Shape, depth: number) => {
    const kids = childrenByParent.get(s.id) ?? [];
    out.push({ shape: s, depth, childCount: kids.length });
    for (const c of kids) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

export function XDesignLayersPanel() {
  const shapes = useXDesign((s) => s.shapes);
  const selection = useXDesign((s) => s.selection);
  const select = useXDesign((s) => s.select);
  const toggleInSelection = useXDesign((s) => s.toggleInSelection);
  const moveLayer = useXDesign((s) => s.moveLayer);
  const updateShape = useXDesign((s) => s.updateShape);
  const pushHistory = useXDesign((s) => s.pushHistory);
  const deleteShapes = useXDesign((s) => s.deleteShapes);
  const reparent = useXDesign((s) => s.reparent);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);

  const tree = useMemo(() => buildTree(shapes), [shapes]);

  // Filter out rows whose ancestor is collapsed.
  const visible = useMemo(() => {
    if (collapsed.size === 0) return tree;
    const collapsedSet = collapsed;
    const collapsedAncestors = new Set<string>();
    return tree.filter((node) => {
      // If any ancestor is collapsed, hide.
      const pid = node.shape.parentId;
      if (pid && collapsedAncestors.has(pid)) {
        collapsedAncestors.add(node.shape.id);
        return false;
      }
      if (collapsedSet.has(node.shape.id)) collapsedAncestors.add(node.shape.id);
      return true;
    });
  }, [tree, collapsed]);

  const onRowClick = (e: MouseEvent, id: string) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleInSelection(id);
    } else {
      select(id);
    }
  };

  const toggleCollapse = (id: string) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="xd-layers scroll">
      <PagesList />
      <XDesignVariablesPanel />
      <div
        className={`heading${dropTarget === "root" ? " drop-into" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(LAYER_DRAG_MIME)) return;
          if (!dragId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTarget("root");
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropTarget(null);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(LAYER_DRAG_MIME)) return;
          if (!dragId) return;
          e.preventDefault();
          reparent(dragId, null);
          setDragId(null);
          setDropTarget(null);
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Layers size={11} /> Layers
        </span>
        <span className="xd-layers-count">{shapes.length}</span>
      </div>
      {visible.length === 0 ? (
        <div className="xd-layers-empty">
          No layers yet. Pick a tool and drag on the canvas.
        </div>
      ) : (
        visible.map(({ shape: sh, depth, childCount }) => {
          const isSel = selection.has(sh.id);
          const isFrame = sh.kind === "frame";
          const isCollapsed = collapsed.has(sh.id);
          return (
            <div
              key={sh.id}
              className={[
                "xd-layer-row",
                isSel ? "active" : "",
                isFrame ? "frame" : "",
                sh.hidden ? "hidden" : "",
                sh.locked ? "locked" : "",
                sh.isMain ? "main" : "",
                sh.linkedMainId ? "instance" : "",
                dragId === sh.id ? "dragging" : "",
                dropTarget === sh.id ? "drop-into" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={(e) => onRowClick(e, sh.id)}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(LAYER_DRAG_MIME, sh.id);
                e.dataTransfer.effectAllowed = "move";
                setDragId(sh.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropTarget(null);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(LAYER_DRAG_MIME)) return;
                if (!dragId || dragId === sh.id) return;
                // Don't allow dropping a shape into its own descendant.
                const desc = collectDescendantIds(shapes, dragId);
                if (desc.includes(sh.id)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTarget(sh.id);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDropTarget(null);
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes(LAYER_DRAG_MIME)) return;
                if (!dragId || dragId === sh.id) return;
                e.preventDefault();
                // Frames receive children; other kinds are treated as
                // "drop next to this layer" (re-parent to its parent).
                const newParent =
                  sh.kind === "frame" ? sh.id : sh.parentId ?? null;
                reparent(dragId, newParent);
                setDragId(null);
                setDropTarget(null);
              }}
            >
              {isFrame && childCount > 0 ? (
                <button
                  type="button"
                  className="xd-layer-chevron"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapse(sh.id);
                  }}
                  title={isCollapsed ? "Expand" : "Collapse"}
                >
                  {isCollapsed ? (
                    <ChevronRight size={10} />
                  ) : (
                    <ChevronDown size={10} />
                  )}
                </button>
              ) : (
                <span className="xd-layer-chevron-spacer" />
              )}
              <KindIcon kind={sh.kind} />
              <span className="xd-layer-name">{sh.name}</span>
              <div className="xd-layer-actions">
                <button
                  type="button"
                  className={`xd-layer-action${sh.hidden ? " on" : ""}`}
                  title={sh.hidden ? "Show" : "Hide"}
                  onClick={(e) => {
                    e.stopPropagation();
                    pushHistory();
                    updateShape(sh.id, { hidden: !sh.hidden } as ShapePatch);
                  }}
                >
                  {sh.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
                <button
                  type="button"
                  className={`xd-layer-action${sh.locked ? " on" : ""}`}
                  title={sh.locked ? "Unlock" : "Lock"}
                  onClick={(e) => {
                    e.stopPropagation();
                    pushHistory();
                    updateShape(sh.id, { locked: !sh.locked } as ShapePatch);
                  }}
                >
                  {sh.locked ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
                <button
                  type="button"
                  className="xd-layer-action"
                  title="Bring forward"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveLayer(sh.id, 1);
                  }}
                >
                  <ChevronUp size={11} />
                </button>
                <button
                  type="button"
                  className="xd-layer-action"
                  title="Send backward"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveLayer(sh.id, -1);
                  }}
                >
                  <ChevronDown size={11} />
                </button>
                <button
                  type="button"
                  className="xd-layer-action danger"
                  title={
                    childCount > 0
                      ? "Delete (frame + all children)"
                      : "Delete"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    // Deleting a frame cascades to its descendants.
                    deleteShapes(collectDescendantIds(shapes, sh.id));
                  }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
