import { create } from "zustand";
import { ipc, type GitStatus } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { log } from "@/lib/log";

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
  inFlight = true;
  try {
    const s: GitStatus = await ipc.gitStatus(project.root_path);
    const files = new Map<string, GitFileState>();
    for (const f of s.files) files.set(f.path, f);
    useGit.setState({
      isRepo: s.is_repo,
      branch: s.branch,
      ahead: s.ahead,
      behind: s.behind,
      files,
    });
  } catch (e) {
    log.warn("git status failed", e);
  } finally {
    inFlight = false;
    if (queued) {
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

/** Mount-once trigger wiring (called from App boot). */
export function startGitWatch(): void {
  if (wired) return;
  wired = true;
  useGit.getState().refresh();
  useProjectStore.subscribe((s, prev) => {
    if (s.active?.id !== prev.active?.id) useGit.getState().refresh();
  });
  // The Rust fs watcher bumps this store on any project file change —
  // saves, external edits, git operations from a terminal.
  useFileTreeRefresh.subscribe(() => useGit.getState().refresh());
  window.addEventListener("focus", () => useGit.getState().refresh());
}

/** Project-relative path for an absolute one (gutter/tree lookups). */
export function gitRelPath(absPath: string): string | null {
  const root = useProjectStore.getState().active?.root_path;
  if (!root || !absPath.startsWith(root)) return null;
  return absPath.slice(root.length).replace(/^\//, "");
}
