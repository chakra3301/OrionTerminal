import { useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Folder,
  ExternalLink,
  X,
} from "lucide-react";
import { useState } from "react";
import { ulid } from "ulid";
import { useProjectStore } from "@/store/projectStore";
import { ipc } from "@/lib/ipc";
import { promptText } from "@/components/PromptModal";
import { confirmAction } from "@/components/ConfirmModal";
import { toast } from "@/store/toastStore";
import { upsertProject, type ProjectRow } from "@/lib/db";

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

/** Collapse a long absolute path to `~/…/parent/leaf` for the card subtitle. */
function prettyPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

async function openFolder(): Promise<void> {
  const picked = await openDialog({
    directory: true,
    multiple: false,
    title: "Open project folder",
  });
  if (!picked || typeof picked !== "string") return;
  await useProjectStore.getState().openProjectAtPath(picked);
}

async function newProject(): Promise<void> {
  const parent = await openDialog({
    directory: true,
    multiple: false,
    title: "Choose where to create the project",
  });
  if (!parent || typeof parent !== "string") return;
  const name = await promptText({
    title: "New project",
    label: "Folder name",
    placeholder: "my-app",
    confirmLabel: "Create",
  });
  if (!name) return;
  const safe = name.trim().replace(/[\\/]/g, "-");
  if (!safe) return;
  const path = `${parent.replace(/[\\/]+$/, "")}/${safe}`;
  try {
    if (await ipc.pathExists(path)) {
      toast.error("A folder with that name already exists");
      return;
    }
    await ipc.createPath(path, true);
  } catch (e) {
    toast.error("Could not create project folder");
    void e;
    return;
  }
  await useProjectStore.getState().openProjectAtPath(path);
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);

  const open = () => void useProjectStore.getState().switchToProject(project);

  const commitRename = async () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== project.name) {
      await upsertProject({ ...project, name: next });
      void useProjectStore.getState().loadRecents();
    } else {
      setDraft(project.name);
    }
  };

  const remove = async () => {
    setMenuOpen(false);
    const ok = await confirmAction({
      title: `Remove "${project.name}" from recents?`,
      body: "This only forgets the project here — the folder on disk is left untouched.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) await useProjectStore.getState().removeRecent(project.id);
  };

  return (
    <div className="or-home-card">
      <button
        type="button"
        className="or-home-card-preview"
        onClick={open}
        title={project.root_path}
      >
        <Folder size={42} strokeWidth={1.25} />
      </button>
      <div className="or-home-card-meta">
        <div className="or-home-card-info">
          {renaming ? (
            <input
              className="or-home-rename-input"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") {
                  setDraft(project.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="or-home-card-name"
              onClick={open}
              onDoubleClick={() => {
                setDraft(project.name);
                setRenaming(true);
              }}
            >
              {project.name}
            </button>
          )}
          <span className="or-home-card-path" title={project.root_path}>
            {prettyPath(project.root_path)}
          </span>
          <span className="or-home-card-time">
            {relativeTime(project.last_opened_at)}
          </span>
        </div>
        <div className="or-home-card-actions">
          <button
            type="button"
            className="or-home-card-menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Project options"
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <>
              <div
                className="or-home-menu-scrim"
                onClick={() => setMenuOpen(false)}
              />
              <div className="or-home-menu">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void ipc.revealInOs(project.root_path);
                  }}
                >
                  <ExternalLink size={13} /> Reveal in Finder
                </button>
                <button type="button" className="danger" onClick={() => void remove()}>
                  <X size={13} /> Remove from recents
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function OrionHome() {
  const recents = useProjectStore((s) => s.recents);

  useEffect(() => {
    void useProjectStore.getState().loadRecents();
  }, []);

  return (
    <div className="or-home">
      <header className="or-home-header">
        <div>
          <h1 className="or-home-title">Orion</h1>
          <p className="or-home-sub">Open a folder to start coding.</p>
        </div>
        <div className="or-home-actions-row">
          <button
            type="button"
            className="or-home-btn or-home-btn-ghost"
            onClick={() => void newProject()}
          >
            <FolderPlus size={16} /> New project
          </button>
          <button
            type="button"
            className="or-home-btn or-home-btn-primary"
            onClick={() => void openFolder()}
          >
            <FolderOpen size={16} /> Open folder
          </button>
        </div>
      </header>

      {recents.length === 0 ? (
        <div className="or-home-empty">
          <button
            type="button"
            className="or-home-empty-new"
            onClick={() => void openFolder()}
          >
            <FolderOpen size={28} />
            <span>Open your first project</span>
          </button>
        </div>
      ) : (
        <div className="or-home-section">
          <h2 className="or-home-section-title">Recent</h2>
          <div className="or-home-grid">
            {recents.map((p) => (
              <ProjectCard key={p.id ?? ulid()} project={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
