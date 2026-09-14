import { useEffect, useState } from "react";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  LayoutGrid,
  Globe,
  Presentation,
  Film,
  ImageIcon,
  Sparkles,
  Box,
  type LucideIcon,
} from "lucide-react";
import { confirmAction } from "@/components/ConfirmModal";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";
import {
  useXDProjects,
  loadDoc,
  type XDDoc,
  type XDProjectMeta,
} from "./projectsStore";
import { useRailIntent, type RailIntentMode } from "./railIntentStore";
import { ProjectThumb } from "./ProjectThumb";
import { ProjectNameInput } from "./ProjectNameInput";
import { useXDesignSaveState } from "./saveState";

// Project start types. "Blank canvas" is the default normal project; the rest
// create a project then arm the matching AI flow in the Claude rail.
type StartType = {
  id: string;
  label: string;
  desc: string;
  Icon: LucideIcon;
  /** Tool flow to arm after creating the project (null = plain canvas). */
  intent: RailIntentMode | null;
  name: string;
  /** Project kind — "fx" opens the shader compositor, "model" opens the img2model studio, instead of the canvas. */
  kind?: "fx" | "model";
};

const START_TYPES: StartType[] = [
  { id: "blank", label: "Blank canvas", desc: "Start from an empty board", Icon: LayoutGrid, intent: null, name: "Untitled" },
  { id: "webpage", label: "Webpage", desc: "Experimental · webpage saved with project", Icon: Globe, intent: "webpage", name: "Webpage" },
  { id: "deck", label: "Slide deck", desc: "Build a presentable deck", Icon: Presentation, intent: "deck", name: "Deck" },
  { id: "motion", label: "Motion", desc: "Experimental · verify playback and export", Icon: Film, intent: "motion", name: "Motion" },
  { id: "image", label: "Image generator", desc: "Generate a raster image", Icon: ImageIcon, intent: "image", name: "Image" },
  { id: "fx", label: "FX scene", desc: "Basic FX tested · advanced output experimental", Icon: Sparkles, intent: null, name: "FX Scene", kind: "fx" },
  { id: "model", label: "3D model", desc: "Experimental · reference image to procedural 3D", Icon: Box, intent: null, name: "3D Model", kind: "model" },
];

async function startProject(t: StartType): Promise<void> {
  await useXDProjects
    .getState()
    .newProject(t.intent || t.kind ? t.name : undefined, t.kind ?? "design");
  if (t.intent) useRailIntent.getState().request(t.intent);
}

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
  const draft = useXDesignSaveState((s) => s.names[meta.id]);

  const open = () => { void useXDProjects.getState().openProject(meta.id).catch(() => {}); };

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
        {meta.kind === "fx" && <span className="xd-fx-badge">FX</span>}
        {meta.kind === "model" && <span className="xd-fx-badge xd-model-badge">3D</span>}
      </button>
      <div className="xd-home-card-meta">
        <div className="xd-home-card-info">
          {renaming || draft ? (
            <ProjectNameInput id={meta.id} name={meta.name} className="xd-home-rename-input"
              onFinish={() => setRenaming(false)} />
          ) : (
            <button
              type="button"
              className="xd-home-card-name"
              onClick={open}
              onDoubleClick={() => {
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
                    setRenaming(true);
                  }}
                >
                  <Pencil size={13} /> Rename
                </button>
                <button type="button" className="danger" onClick={() => { void remove().catch(() => {}); }}>
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

function NewProjectMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="xd-home-new-wrap">
      <button
        type="button"
        className="xd-home-new"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={16} /> New project
      </button>
      {open && (
        <>
          <div className="xd-home-menu-scrim" onClick={() => setOpen(false)} />
          <div className="xd-home-start-menu">
            {START_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="xd-home-start-item"
                onClick={() => {
                  setOpen(false);
                  void startProject(t).catch(() => {});
                }}
              >
                <t.Icon size={16} />
                <span className="xd-home-start-text">
                  <span className="xd-home-start-label">{t.label}</span>
                  <span className="xd-home-start-desc">{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function XDesignHome() {
  const registry = useXDProjects((s) => s.registry);
  const ready = useXDProjects((s) => s.ready);
  const loadError = useXDProjects((s) => s.loadError);
  const [docs, setDocs] = useState<Record<string, XDDoc | null>>({});

  // Lazy-load each project's doc for its thumbnail. Re-runs when the registry
  // changes (new / deleted / renamed-bump) so previews stay fresh.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      registry.map(async (m) => [m.id, await loadDoc(m.id)] as const),
    ).then((pairs) => {
      if (!cancelled) setDocs(Object.fromEntries(pairs));
    }).catch((error) => log.warn("XDesign thumbnail load failed", error));
    return () => {
      cancelled = true;
    };
  }, [registry]);

  if (!ready) return <div className="xd-home">
    <h1>XDesign</h1>
    <p role={loadError ? "alert" : "status"}>{loadError ?? "Loading projects…"}</p>
    {loadError && <button type="button" className="xd-home-new"
      onClick={() => { void useXDProjects.getState().init().catch(() => {}); }}>Retry loading projects</button>}
  </div>;

  const sorted = [...registry].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="xd-home">
      <header className="xd-home-header">
        <div>
          <h1 className="xd-home-title">XDesign</h1>
          <p className="xd-home-sub">Your design projects, all in one place.</p>
        </div>
        <NewProjectMenu />
      </header>

      <div className="xd-home-section">
        <h2 className="xd-home-section-title">Start something new</h2>
        <div className="xd-home-start-grid">
          {START_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="xd-home-start-card"
              onClick={() => void startProject(t).catch(() => {})}
            >
              <t.Icon size={20} />
              <span className="xd-home-start-label">{t.label}</span>
              <span className="xd-home-start-desc">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="xd-home-empty">
          <span className="xd-home-empty-hint">
            No projects yet — pick a starting point above.
          </span>
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
