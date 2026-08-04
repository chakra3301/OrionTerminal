import { create } from "zustand";
import { ulid } from "ulid";
import {
  deleteProject,
  getProjectById,
  getProjectByPath,
  listProjects,
  setAppState,
  upsertProject,
  type ProjectRow,
} from "@/lib/db";
import { log } from "@/lib/log";
import { trackOrionActivity } from "@/apps/orion/runtimeActivity";

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
  /** Return to the Home / start screen without forgetting recents. */
  goHome: () => Promise<void>;
  /** Forget a project from recents (folder on disk is untouched). If it's the
   * active project, drops back to Home. */
  removeRecent: (id: string) => Promise<void>;
};

function deriveName(rootPath: string): string {
  const parts = rootPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? rootPath;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  active: null,
  recents: [],
  setActive: (project) =>
    trackOrionActivity(
      "project-state-save",
      "Wait for Orion to finish saving project state before disabling the plugin.",
      async () => {
        set({ active: project });
        await setAppState("last_project_id", project?.id ?? null);
      },
    ),
  openProjectAtPath: (rootPath) =>
    trackOrionActivity(
      "project-open",
      "Wait for Orion to finish opening the project before disabling the plugin.",
      async () => {
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
    ),
  hydrateFromId: async (id) => {
    const project = await getProjectById(id);
    if (project) set({ active: project });
    void get().loadRecents();
  },
  loadRecents: () =>
    trackOrionActivity(
      "project-recents-load",
      "Wait for Orion's recent projects to finish loading before disabling the plugin.",
      async () => {
        try {
          const rows = await listProjects();
          set({ recents: rows });
        } catch (error) {
          log.warn("loadRecents failed", error);
        }
      },
    ),
  goHome: () =>
    trackOrionActivity(
      "project-home",
      "Wait for Orion to finish closing the project before disabling the plugin.",
      async () => {
        set({ active: null });
        await setAppState("last_project_id", null);
        void get().loadRecents();
      },
    ),
  removeRecent: (id) =>
    trackOrionActivity(
      "project-remove",
      "Wait for Orion to finish updating recent projects before disabling the plugin.",
      async () => {
        try {
          await deleteProject(id);
        } catch (error) {
          log.warn("removeRecent failed", error);
        }
        if (get().active?.id === id) {
          set({ active: null });
          await setAppState("last_project_id", null);
        }
        void get().loadRecents();
      },
    ),
  switchToProject: (project) =>
    trackOrionActivity(
      "project-switch",
      "Wait for Orion to finish switching projects before disabling the plugin.",
      async () => {
        if (get().active?.id === project.id) return;
        const now = Date.now();
        const bumped: ProjectRow = { ...project, last_opened_at: now };
        await upsertProject(bumped);
        set({ active: bumped });
        await setAppState("last_project_id", bumped.id);
        log.info("project switched:", bumped.name, bumped.root_path);
        void get().loadRecents();
      },
    ),
}));
