import { ipc } from "@/lib/ipc";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { useTabsStore } from "@/store/tabsStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { useWorkspace, allTabs } from "@/components/workspace/workspaceStore";
import { log } from "@/lib/log";

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
