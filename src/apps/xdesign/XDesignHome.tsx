import { useEffect, useState } from "react";
import { Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { confirmAction } from "@/components/ConfirmModal";
import { toast } from "@/store/toastStore";
import {
  useXDProjects,
  loadDoc,
  type XDDoc,
  type XDProjectMeta,
} from "./projectsStore";
import { ProjectThumb } from "./ProjectThumb";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

function ProjectCard({
  meta,
  doc,
}: {
  meta: XDProjectMeta;
  doc: XDDoc | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(meta.name);

  const open = () => void useXDProjects.getState().openProject(meta.id);

  const commitRename = () => {
    setRenaming(false);
    if (draft.trim() && draft.trim() !== meta.name) {
      void useXDProjects.getState().renameProject(meta.id, draft);
    } else {
      setDraft(meta.name);
    }
  };

  const remove = async () => {
    setMenuOpen(false);
    const ok = await confirmAction({
      title: `Delete "${meta.name}"?`,
      body: "This permanently removes the project and its canvas.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) {
      await useXDProjects.getState().deleteProject(meta.id);
      toast.info(`Deleted "${meta.name}"`);
    }
  };

  return (
    <div className="xd-home-card">
      <button
        type="button"
        className="xd-home-card-preview"
        onClick={open}
        onDoubleClick={open}
        title={`Open ${meta.name}`}
      >
        <ProjectThumb doc={doc} />
      </button>
      <div className="xd-home-card-meta">
        <div className="xd-home-card-info">
          {renaming ? (
            <input
              className="xd-home-rename-input"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setDraft(meta.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="xd-home-card-name"
              onClick={open}
              onDoubleClick={() => {
                setDraft(meta.name);
                setRenaming(true);
              }}
            >
              {meta.name}
            </button>
          )}
          <span className="xd-home-card-time">{relativeTime(meta.updatedAt)}</span>
        </div>
        <div className="xd-home-card-actions">
          <button
            type="button"
            className="xd-home-card-menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Project options"
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <>
              <div
                className="xd-home-menu-scrim"
                onClick={() => setMenuOpen(false)}
              />
              <div className="xd-home-menu">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDraft(meta.name);
                    setRenaming(true);
                  }}
                >
                  <Pencil size={13} /> Rename
                </button>
                <button type="button" className="danger" onClick={() => void remove()}>
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function XDesignHome() {
  const registry = useXDProjects((s) => s.registry);
  const [docs, setDocs] = useState<Record<string, XDDoc | null>>({});

  // Lazy-load each project's doc for its thumbnail. Re-runs when the registry
  // changes (new / deleted / renamed-bump) so previews stay fresh.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      registry.map(async (m) => [m.id, await loadDoc(m.id)] as const),
    ).then((pairs) => {
      if (!cancelled) setDocs(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [registry]);

  const sorted = [...registry].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="xd-home">
      <header className="xd-home-header">
        <div>
          <h1 className="xd-home-title">XDesign</h1>
          <p className="xd-home-sub">Your design projects, all in one place.</p>
        </div>
        <button
          type="button"
          className="xd-home-new"
          onClick={() => void useXDProjects.getState().newProject()}
        >
          <Plus size={16} /> New project
        </button>
      </header>

      {sorted.length === 0 ? (
        <div className="xd-home-empty">
          <button
            type="button"
            className="xd-home-empty-new"
            onClick={() => void useXDProjects.getState().newProject()}
          >
            <Plus size={28} />
            <span>Create your first project</span>
          </button>
        </div>
      ) : (
        <div className="xd-home-section">
          <h2 className="xd-home-section-title">Recent</h2>
          <div className="xd-home-grid">
            {sorted.map((m) => (
              <ProjectCard key={m.id} meta={m} doc={docs[m.id] ?? null} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
