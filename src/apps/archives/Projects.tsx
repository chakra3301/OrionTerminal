import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  ChevronRight,
  ChevronDown,
  FolderKanban,
  Trash2,
  FileText,
  Star,
} from "lucide-react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { useNotesStore, type Note } from "@/store/notesStore";
import { useArchives } from "@/apps/archives/useArchives";
import { NoteEditor } from "@/features/notes/NoteEditor";
import { NoteCollectionChip } from "@/apps/archives/NoteCollectionChip";
import { NoteTagsRow } from "@/apps/archives/NoteTagsRow";
import { useContextMenu } from "@/components/ContextMenu";
import { noteMenuItems } from "@/apps/archives/itemMenus";
import { log } from "@/lib/log";

const PROJECT_DRAG_MIME = "application/x-orion-project-node";

export function ArchivesProjects() {
  const notes = useNotesStore((s) => s.notes);
  const loaded = useNotesStore((s) => s.loaded);
  const removeNote = useNotesStore((s) => s.remove);
  const saveParent = useNotesStore((s) => s.saveParent);
  const openProjectId = useArchives((s) => s.openProjectId);
  const setOpenProjectId = useArchives((s) => s.setOpenProjectId);
  const toggleExpanded = useArchives((s) => s.toggleProjectExpanded);
  const expanded = useArchives((s) => s.expandedProjectIds);
  const ctx = useContextMenu();

  // Group all kind='project' notes by parent_id once so the tree render is
  // O(n) instead of O(n^2).
  const selectedCollectionId = useArchives((s) => s.selectedCollectionId);
  const tree = useMemo(
    () => buildProjectTree(notes, selectedCollectionId),
    [notes, selectedCollectionId],
  );
  const total = tree.allIds.length;

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);

  const handleDrop = async (target: string | null) => {
    const sourceId = draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (!sourceId) return;
    if (sourceId === target) return;
    // Cycle protection: cannot drop onto self or a descendant.
    if (target) {
      const descendants = collectDescendants(sourceId, tree.byParent);
      if (descendants.includes(target)) return;
    }
    try {
      await saveParent(sourceId, target);
      // Auto-expand the new parent so the moved node is visible.
      if (target && !expanded.has(target)) toggleExpanded(target);
    } catch (e) {
      log.error("re-parent failed", e);
    }
  };

  // Default selection on first load: the most-recently-touched root project.
  useEffect(() => {
    if (openProjectId && notes.has(openProjectId)) return;
    const first = tree.roots[0];
    setOpenProjectId(first?.id ?? null);
  }, [openProjectId, notes, tree.roots, setOpenProjectId]);

  const createRoot = async () => {
    try {
      const note = await useNotesStore.getState().create(null, "project");
      setOpenProjectId(note.id);
    } catch (e) {
      log.error("project create failed", e);
    }
  };

  const createSubpage = async (parentId: string) => {
    try {
      const note = await useNotesStore.getState().create(parentId, "project");
      // Auto-expand the parent so the new subpage is visible.
      useArchives.getState().expandedProjectIds.has(parentId) ||
        useArchives.getState().toggleProjectExpanded(parentId);
      setOpenProjectId(note.id);
    } catch (e) {
      log.error("subpage create failed", e);
    }
  };

  const handleDelete = async (note: Note) => {
    const ok = await confirmDialog(
      `Delete "${note.title || "Untitled"}" and all its subpages?`,
      { title: "Delete project", kind: "warning" },
    );
    if (!ok) return;
    // Recursively delete all descendants first (ON DELETE CASCADE isn't set
    // on notes.parent_id, so we do it explicitly to keep the DB clean).
    const all = collectDescendants(note.id, tree.byParent);
    for (const id of all) {
      try {
        await removeNote(id);
      } catch (e) {
        log.warn("delete subpage failed", id, e);
      }
    }
    if (openProjectId && all.includes(openProjectId)) {
      const newRoot = tree.roots.find((r) => r.id !== note.id) ?? null;
      setOpenProjectId(newRoot?.id ?? null);
    }
  };

  if (!loaded && notes.size === 0) {
    return <div className="ar-journal-loading">Loading projects…</div>;
  }

  if (total === 0) {
    return (
      <div className="ar-empty-state ar-journal-empty">
        <FolderKanban size={22} color="var(--neon-cyan)" />
        <div className="title">No projects yet.</div>
        <div className="hint">
          Start one per idea or initiative. Nest subpages inside like in Notion.
        </div>
        <button
          type="button"
          className="ar-new-btn"
          onClick={() => void createRoot()}
        >
          <Plus size={12} /> New project
        </button>
      </div>
    );
  }

  const selected = openProjectId ? notes.get(openProjectId) : null;

  const openNodeMenu = (e: React.MouseEvent, n: Note) =>
    ctx.openAt(
      e,
      noteMenuItems(n, {
        noun: "project",
        onOpen: () => setOpenProjectId(n.id),
        extra: [
          {
            label: "New subpage",
            icon: <Plus size={13} />,
            onClick: () => void createSubpage(n.id),
          },
        ],
        onDelete: () => void handleDelete(n),
      }),
    );

  const isDraggingDescendant = (id: string) => {
    if (!draggingId) return false;
    if (id === draggingId) return true;
    return collectDescendants(draggingId, tree.byParent).includes(id);
  };

  return (
    <div className="ar-projects">
      {ctx.menu}
      <aside className="ar-projects-rail scroll">
        <div
          className={`ar-projects-rail-head${
            dropTarget === "root" ? " drop-target" : ""
          }`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(PROJECT_DRAG_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTarget("root");
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDropTarget(null);
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.types.includes(PROJECT_DRAG_MIME)) return;
            e.preventDefault();
            void handleDrop(null);
          }}
        >
          <span>Projects</span>
          <button
            type="button"
            className="ar-rail-add"
            onClick={() => void createRoot()}
            title="New project"
          >
            <Plus size={11} />
          </button>
        </div>
        <ProjectTree
          nodes={tree.roots}
          depth={0}
          byParent={tree.byParent}
          openProjectId={openProjectId}
          onOpen={setOpenProjectId}
          onAddSubpage={(id) => void createSubpage(id)}
          onDelete={(n) => void handleDelete(n)}
          onContextMenu={openNodeMenu}
          draggingId={draggingId}
          dropTarget={dropTarget}
          onDragStart={setDraggingId}
          onDragEnd={() => {
            setDraggingId(null);
            setDropTarget(null);
          }}
          onDragOverNode={(id) => setDropTarget(id)}
          onDropNode={(id) => void handleDrop(id)}
          isInvalidDropTarget={isDraggingDescendant}
        />
      </aside>
      <div className="ar-projects-editor note-page">
        {selected ? (
          <>
            <div className="ar-note-meta-bar">
              <NoteCollectionChip noteId={selected.id} />
              <NoteTagsRow noteId={selected.id} />
            </div>
            <NoteEditor key={selected.id} noteId={selected.id} />
          </>
        ) : (
          <div className="ar-empty-state" style={{ flex: 1 }}>
            <div className="title">No page selected.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectTree({
  nodes,
  depth,
  byParent,
  openProjectId,
  onOpen,
  onAddSubpage,
  onDelete,
  onContextMenu,
  draggingId,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOverNode,
  onDropNode,
  isInvalidDropTarget,
}: {
  nodes: Note[];
  depth: number;
  byParent: Map<string | null, Note[]>;
  openProjectId: string | null;
  onOpen: (id: string) => void;
  onAddSubpage: (id: string) => void;
  onDelete: (n: Note) => void;
  onContextMenu: (e: React.MouseEvent, n: Note) => void;
  draggingId: string | null;
  dropTarget: string | "root" | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverNode: (id: string) => void;
  onDropNode: (id: string) => void;
  isInvalidDropTarget: (id: string) => boolean;
}) {
  const expanded = useArchives((s) => s.expandedProjectIds);
  const toggle = useArchives((s) => s.toggleProjectExpanded);

  return (
    <div className="ar-project-tree">
      {nodes.map((n) => {
        const children = byParent.get(n.id) ?? [];
        const hasChildren = children.length > 0;
        const isExpanded = expanded.has(n.id);
        const isActive = n.id === openProjectId;
        const isDragging = draggingId === n.id;
        const invalid = isInvalidDropTarget(n.id);
        const isDropTarget = dropTarget === n.id && !invalid;
        return (
          <div key={n.id}>
            <div
              className={[
                "ar-project-tree-item",
                isActive ? "active" : "",
                isDragging ? "dragging" : "",
                isDropTarget ? "drop-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ paddingLeft: 6 + depth * 14 }}
              draggable
              onContextMenu={(e) => onContextMenu(e, n)}
              onDragStart={(e) => {
                e.dataTransfer.setData(PROJECT_DRAG_MIME, n.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart(n.id);
              }}
              onDragEnd={onDragEnd}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(PROJECT_DRAG_MIME)) return;
                if (invalid) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                onDragOverNode(n.id);
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes(PROJECT_DRAG_MIME)) return;
                e.preventDefault();
                if (invalid) return;
                onDropNode(n.id);
              }}
            >
              <button
                type="button"
                className="ar-project-tree-chevron"
                onClick={() => toggle(n.id)}
                title={hasChildren ? (isExpanded ? "Collapse" : "Expand") : ""}
                disabled={!hasChildren}
              >
                {hasChildren ? (
                  isExpanded ? (
                    <ChevronDown size={11} />
                  ) : (
                    <ChevronRight size={11} />
                  )
                ) : (
                  <span style={{ width: 11, display: "inline-block" }} />
                )}
              </button>
              <button
                type="button"
                className="ar-project-tree-label"
                onClick={() => onOpen(n.id)}
                title={n.title || "Untitled"}
              >
                <FileText size={11} className="ar-project-tree-icon" />
                <span>{n.title.trim() || "Untitled"}</span>
                {n.favorite && (
                  <Star
                    size={9}
                    fill="currentColor"
                    style={{ color: "var(--neon-yellow)", flexShrink: 0 }}
                  />
                )}
              </button>
              <div className="ar-project-tree-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onAddSubpage(n.id)}
                  title="Add subpage"
                >
                  <Plus size={11} />
                </button>
                <button
                  type="button"
                  className="icon-btn ar-notes-danger"
                  onClick={() => onDelete(n)}
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
            {hasChildren && isExpanded && (
              <ProjectTree
                nodes={children}
                depth={depth + 1}
                byParent={byParent}
                openProjectId={openProjectId}
                onOpen={onOpen}
                onAddSubpage={onAddSubpage}
                onDelete={onDelete}
                onContextMenu={onContextMenu}
                draggingId={draggingId}
                dropTarget={dropTarget}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOverNode={onDragOverNode}
                onDropNode={onDropNode}
                isInvalidDropTarget={isInvalidDropTarget}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

type ProjectTreeData = {
  roots: Note[];
  byParent: Map<string | null, Note[]>;
  allIds: string[];
};

function buildProjectTree(
  notes: Map<string, Note>,
  selectedCollectionId: string | null,
): ProjectTreeData {
  // First pass: collect every project. We always include the full tree so a
  // subpage inside a filtered project is still reachable; the filter just
  // controls which ROOTS are shown.
  const byParent = new Map<string | null, Note[]>();
  const allIds: string[] = [];
  for (const note of notes.values()) {
    if (note.kind !== "project") continue;
    allIds.push(note.id);
    const key = note.parentId ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(note);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  const roots = byParent.get(null) ?? [];
  const filteredRoots = selectedCollectionId
    ? roots.filter((r) => r.collectionId === selectedCollectionId)
    : roots;
  const visibleIds = selectedCollectionId
    ? collectVisibleIds(filteredRoots, byParent)
    : allIds;
  return { roots: filteredRoots, byParent, allIds: visibleIds };
}

function collectVisibleIds(
  roots: Note[],
  byParent: Map<string | null, Note[]>,
): string[] {
  const out: string[] = [];
  const walk = (n: Note) => {
    out.push(n.id);
    for (const c of byParent.get(n.id) ?? []) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

function collectDescendants(
  rootId: string,
  byParent: Map<string | null, Note[]>,
): string[] {
  // Returns rootId + every descendant id, leaves-first so deletes don't break
  // foreign-key references (notes.parent_id has no ON DELETE CASCADE).
  const order: string[] = [];
  const walk = (id: string) => {
    const children = byParent.get(id) ?? [];
    for (const c of children) walk(c.id);
    order.push(id);
  };
  walk(rootId);
  return order;
}
