import { create } from "zustand";
import { ulid } from "ulid";
import {
  insertCheckpoint,
  setCheckpointLabel,
  addCheckpointFile,
  listCheckpoints,
  getCheckpointFiles,
  pruneCheckpoints,
  type CheckpointRow,
} from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { useTabsStore } from "@/store/tabsStore";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { useChatStore } from "@/store/chatStore";
import { useGit } from "@/store/gitStore";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";

/** Cursor-style checkpoints: the pre-image of every file an agent burst
 * touches, captured at its FIRST edit (so the snapshot is pre-turn even
 * when the agent edits a file repeatedly). A burst closes when the Orion
 * chat turn finishes or after 90s of edit silence. Restores never destroy
 * history — the current state is snapshotted first. */

const CLOSE_AFTER_MS = 90_000;
const KEEP = 20;

type CheckpointsState = {
  list: CheckpointRow[];
  refresh: () => void;
};

export const useCheckpoints = create<CheckpointsState>(() => ({
  list: [],
  refresh: () => {
    const project = useProjectStore.getState().active;
    if (!project) {
      useCheckpoints.setState({ list: [] });
      return;
    }
    void listCheckpoints(project.id, KEEP)
      .then((list) => useCheckpoints.setState({ list }))
      .catch((e) => log.warn("checkpoints list failed", e));
  },
}));

let activeId: string | null = null;
let capturedPaths = new Set<string>();
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function armClose() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    finalizeCheckpoint();
  }, CLOSE_AFTER_MS);
}

export function finalizeCheckpoint(): void {
  if (!activeId) return;
  activeId = null;
  capturedPaths = new Set();
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  const project = useProjectStore.getState().active;
  if (project) void pruneCheckpoints(project.id, KEEP).catch(() => {});
  useCheckpoints.getState().refresh();
}

// An ended Orion chat turn closes the burst (the 90s timer covers agents
// that stage edits outside the chat rail, e.g. ROSIE).
useChatStore.subscribe((s, prev) => {
  if (prev.running && !s.running) finalizeCheckpoint();
});

export async function captureForStagedEdit(edit: {
  path: string;
  original: string;
  isNew: boolean;
}): Promise<void> {
  const project = useProjectStore.getState().active;
  if (!project) return;
  try {
    if (!activeId) {
      activeId = ulid();
      capturedPaths = new Set();
      await insertCheckpoint(activeId, project.id, "agent edits");
      useCheckpoints.getState().refresh();
    }
    if (!capturedPaths.has(edit.path)) {
      capturedPaths.add(edit.path);
      await addCheckpointFile(activeId, edit.path, edit.original, !edit.isNew);
      await setCheckpointLabel(
        activeId,
        `agent edits · ${capturedPaths.size} file${capturedPaths.size === 1 ? "" : "s"}`,
      );
      useCheckpoints.getState().refresh();
    }
    armClose();
  } catch (e) {
    log.warn("checkpoint capture failed", e);
  }
}

/** Write a checkpoint's pre-images back to disk. The current state of the
 * same files is snapshotted first ("before restore"), so a restore is
 * always itself restorable. */
export async function restoreCheckpoint(id: string, label: string): Promise<void> {
  const project = useProjectStore.getState().active;
  if (!project) return;
  finalizeCheckpoint();
  try {
    const files = await getCheckpointFiles(id);
    if (files.length === 0) return;

    const backupId = ulid();
    await insertCheckpoint(backupId, project.id, "before restore");
    for (const f of files) {
      let current: string | null = null;
      try {
        current = await ipc.readFile(f.path);
      } catch {
        current = null; // file currently absent
      }
      await addCheckpointFile(backupId, f.path, current ?? "", current !== null);
    }
    await setCheckpointLabel(
      backupId,
      `before restore · ${files.length} file${files.length === 1 ? "" : "s"}`,
    );

    for (const f of files) {
      usePendingEdits.getState().remove(f.path);
      if (f.existed) {
        await ipc.saveFileAtomic(f.path, f.content);
        useTabsStore.getState().markLoaded(f.path, f.content);
      } else {
        await ipc.deletePath(f.path).catch(() => {});
        useTabsStore.getState().dropBuffer(f.path);
      }
    }
    useFileTreeRefresh.getState().bump();
    useGit.getState().refresh();
    useCheckpoints.getState().refresh();
    toast.success("Checkpoint restored", { body: label });
  } catch (e) {
    log.error("checkpoint restore failed", e);
    toast.error("Restore failed", {
      body: e instanceof Error ? e.message : String(e),
    });
  }
}
