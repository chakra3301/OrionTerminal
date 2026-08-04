import { create } from "zustand";
import { ipc, type GitStatus } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { log } from "@/lib/log";
import { trackOrionActivity } from "@/apps/orion/runtimeActivity";

/** Live git status for the active project. Refreshes are debounced and
 * single-flight; triggers are wired once at boot (project switch, the fs
 * watcher's tree bumps, window focus) plus explicit refreshes after
 * stage/commit/push actions. */

export type GitFileState = {
  path: string;
  index: string;
  worktree: string;
};

type GitState = {
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  /** project-relative path → status letters */
  files: Map<string, GitFileState>;
  refresh: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let queued = false;
let generation = 0;

async function load(): Promise<void> {
  const project = useProjectStore.getState().active;
  if (!project) {
    useGit.setState({ isRepo: false, branch: "", ahead: 0, behind: 0, files: new Map() });
    return;
  }
  if (inFlight) {
    queued = true;
    return;
  }
  const runGeneration = generation;
  inFlight = true;
  try {
    await trackOrionActivity(
      "git-status",
      "Wait for Orion's Git status refresh to finish before disabling the plugin.",
      async () => {
        const status: GitStatus = await ipc.gitStatus(project.root_path);
        if (runGeneration !== generation) return;
        const files = new Map<string, GitFileState>();
        for (const file of status.files) files.set(file.path, file);
        useGit.setState({
          isRepo: status.is_repo,
          branch: status.branch,
          ahead: status.ahead,
          behind: status.behind,
          files,
        });
      },
    );
  } catch (e) {
    log.warn("git status failed", e);
  } finally {
    inFlight = false;
    if (queued && runGeneration === generation) {
      queued = false;
      void load();
    }
  }
}

export const useGit = create<GitState>(() => ({
  isRepo: false,
  branch: "",
  ahead: 0,
  behind: 0,
  files: new Map(),
  refresh: () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void load();
    }, 250);
  },
}));

let wired = false;
let stopGitWatch: (() => void) | null = null;

export function resetGitRuntime(): void {
  generation += 1;
  queued = false;
  if (timer) clearTimeout(timer);
  timer = null;
  useGit.setState({ isRepo: false, branch: "", ahead: 0, behind: 0, files: new Map() });
}

/** Owner-scoped trigger wiring for the Orion editor plugin. */
export function startGitWatch(): () => void {
  if (wired) return stopGitWatch ?? (() => {});
  wired = true;
  const onFocus = () => useGit.getState().refresh();
  const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
    if (state.active?.id !== previous.active?.id) useGit.getState().refresh();
  });
  const unsubscribeTree = useFileTreeRefresh.subscribe(() => useGit.getState().refresh());
  window.addEventListener("focus", onFocus);
  useGit.getState().refresh();
  let disposed = false;
  stopGitWatch = () => {
    if (disposed) return;
    disposed = true;
    wired = false;
    stopGitWatch = null;
    unsubscribeProject();
    unsubscribeTree();
    window.removeEventListener("focus", onFocus);
    resetGitRuntime();
  };
  return stopGitWatch;
}

/** Project-relative path for an absolute one (gutter/tree lookups). */
export function gitRelPath(absPath: string): string | null {
  const root = useProjectStore.getState().active?.root_path;
  if (!root || !absPath.startsWith(root)) return null;
  return absPath.slice(root.length).replace(/^\//, "");
}
