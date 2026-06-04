import { create } from "zustand";
import { ulid } from "ulid";
import {
  getProjectById,
  getProjectByPath,
  listProjects,
  setAppState,
  upsertProject,
  type ProjectRow,
} from "@/lib/db";
import { log } from "@/lib/log";

type ProjectState = {
  active: ProjectRow | null;
  /** Recent projects, freshest first. Refreshed lazily by `loadRecents` and
   * after any open/switch so the list stays current. */
  recents: ProjectRow[];
  setActive: (project: ProjectRow | null) => Promise<void>;
  openProjectAtPath: (rootPath: string) => Promise<ProjectRow>;
  hydrateFromId: (id: string) => Promise<void>;
  /** Refresh `recents` from the DB. Cheap (one query). */
  loadRecents: () => Promise<void>;
  /** Open a project by row — same effect as openProjectAtPath but skips the
   * path lookup when the caller already has the row. */
  switchToProject: (project: ProjectRow) => Promise<void>;
};

function deriveName(rootPath: string): string {
  const parts = rootPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? rootPath;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  active: null,
  recents: [],
  setActive: async (project) => {
    set({ active: project });
    await setAppState("last_project_id", project?.id ?? null);
  },
  openProjectAtPath: async (rootPath) => {
    const existing = await getProjectByPath(rootPath);
    const now = Date.now();
    const project: ProjectRow = existing
      ? { ...existing, last_opened_at: now }
      : {
          id: ulid(),
          name: deriveName(rootPath),
          root_path: rootPath,
          last_opened_at: now,
        };
    await upsertProject(project);
    set({ active: project });
    await setAppState("last_project_id", project.id);
    log.info("project opened:", project.name, project.root_path);
    void get().loadRecents();
    return project;
  },
  hydrateFromId: async (id) => {
    const project = await getProjectById(id);
    if (project) set({ active: project });
    void get().loadRecents();
  },
  loadRecents: async () => {
    try {
      const rows = await listProjects();
      set({ recents: rows });
    } catch (e) {
      log.warn("loadRecents failed", e);
    }
  },
  switchToProject: async (project) => {
    // No-op if already active. Bumps last_opened_at so it sticks at the
    // top of recents.
    if (get().active?.id === project.id) return;
    const now = Date.now();
    const bumped: ProjectRow = { ...project, last_opened_at: now };
    await upsertProject(bumped);
    set({ active: bumped });
    await setAppState("last_project_id", bumped.id);
    log.info("project switched:", bumped.name, bumped.root_path);
    void get().loadRecents();
  },
}));
