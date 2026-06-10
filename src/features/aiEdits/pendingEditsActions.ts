import { ipc } from "@/lib/ipc";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { useTabsStore } from "@/store/tabsStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { useWorkspace, allTabs } from "@/components/workspace/workspaceStore";
import { log } from "@/lib/log";
import { toast } from "@/store/toastStore";
import {
  computeHunks,
  foldHunkIntoOriginal,
  dropHunkFromUpdated,
} from "@/features/aiEdits/lineDiff";

function closeTabsMatching(predicate: (path: string) => boolean, kind: "file" | "diff-review") {
  const ws = useWorkspace.getState();
  for (const t of allTabs(ws.root)) {
    if (t.descriptor.kind === kind && predicate(t.descriptor.path)) {
      ws.closeTab(t.id);
    }
  }
}

/** Keep the agent's change. Disk already holds `updated`; just clear the review. */
export function acceptEdit(path: string): void {
  const e = usePendingEdits.getState().edits[path];
  if (!e) return;
  useTabsStore.getState().markLoaded(path, e.updated);
  usePendingEdits.getState().remove(path);
  closeTabsMatching((p) => p === path, "diff-review");
}

/** Revert the agent's change — restore the original (or delete a new file). */
export async function rejectEdit(path: string): Promise<void> {
  const e = usePendingEdits.getState().edits[path];
  if (!e) return;
  try {
    if (e.isNew) {
      await ipc.deletePath(path);
      useTabsStore.getState().dropBuffer(path);
      closeTabsMatching((p) => p === path, "file");
    } else {
      await ipc.saveFileAtomic(path, e.original);
      useTabsStore.getState().markLoaded(path, e.original);
    }
  } catch (err) {
    log.error("reject edit failed", path, err);
  }
  usePendingEdits.getState().remove(path);
  closeTabsMatching((p) => p === path, "diff-review");
  useFileTreeRefresh.getState().bump();
}

export function acceptAllEdits(): void {
  for (const path of [...usePendingEdits.getState().order]) acceptEdit(path);
}

export async function rejectAllEdits(): Promise<void> {
  for (const path of [...usePendingEdits.getState().order]) await rejectEdit(path);
}

/** Keep ONE hunk: fold it into `original` so it leaves the remaining diff.
 * Disk already holds it (the agent wrote `updated`), so no write needed.
 * Resolving the last hunk resolves the whole file. */
export function acceptHunk(path: string, index: number): void {
  const e = usePendingEdits.getState().edits[path];
  if (!e || e.isNew) return;
  const hunks = computeHunks(e.original, e.updated);
  if (!hunks[index]) return;
  if (hunks.length === 1) {
    acceptEdit(path);
    return;
  }
  usePendingEdits
    .getState()
    .patch(path, { original: foldHunkIntoOriginal(e.original, hunks, index) });
}

/** Revert ONE hunk: rebuild `updated` without it and write that to disk.
 * `original` may already contain previously-accepted hunks, so rejecting
 * the last remaining hunk = plain rejectEdit (restores `original`). */
export async function rejectHunk(path: string, index: number): Promise<void> {
  const e = usePendingEdits.getState().edits[path];
  if (!e || e.isNew) return;
  const hunks = computeHunks(e.original, e.updated);
  if (!hunks[index]) return;
  if (hunks.length === 1) {
    await rejectEdit(path);
    return;
  }
  const nextUpdated = dropHunkFromUpdated(e.original, hunks, index);
  try {
    await ipc.saveFileAtomic(path, nextUpdated);
  } catch (err) {
    log.error("reject hunk failed", path, err);
    toast.error("Couldn't revert that change", {
      body: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  useTabsStore.getState().markLoaded(path, nextUpdated);
  usePendingEdits.getState().patch(path, { updated: nextUpdated });
  useFileTreeRefresh.getState().bump();
}
