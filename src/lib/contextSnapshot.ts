import { invoke } from "@tauri-apps/api/core";
import { useShell } from "@/shell/store/useShell";
import { useProjectStore } from "@/store/projectStore";
import { useWorkspace, allTabs } from "@/components/workspace/workspaceStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useNotesStore } from "@/store/notesStore";
import { log } from "@/lib/log";

/** What the user is looking at, snapshotted to disk for the MCP server's
 * `orion_get_context` tool. Kept small + JSON-clean so the agent reads it
 * with minimal noise. */
function buildSnapshot() {
  const shell = useShell.getState();
  const project = useProjectStore.getState().active;
  const ws = useWorkspace.getState();
  const archives = useArchives.getState();
  const notes = useNotesStore.getState().notes;

  const focused = shell.windows.find((w) => w.id === shell.focusedWindowId);
  const focusedPanel = ws.focusedPanelId
    ? ws.findPanel(ws.focusedPanelId)
    : null;
  const activeTab =
    focusedPanel?.tabs.find((t) => t.id === focusedPanel.activeTabId) ?? null;
  const tabSummary = activeTab
    ? {
        kind: activeTab.descriptor.kind,
        label: activeTab.label,
        // Pull a few descriptor fields when present so the agent knows
        // *which* file / note is open without us echoing the whole obj.
        path:
          activeTab.descriptor.kind === "file"
            ? activeTab.descriptor.path
            : undefined,
        note_id:
          activeTab.descriptor.kind === "note"
            ? activeTab.descriptor.noteId
            : undefined,
      }
    : null;

  let openNote = null;
  if (focused?.app === "archives") {
    const id =
      archives.openNoteId ??
      archives.openProjectId ??
      archives.selectedNoteId ??
      null;
    if (id) {
      const n = notes.get(id);
      if (n) {
        openNote = {
          id: n.id,
          title: n.title || "Untitled",
          kind: n.kind,
        };
      }
    }
  }

  // Count of file tabs across all panels so the agent gets a sense of how
  // much the user has open in Orion.
  const allFileTabs = allTabs(ws.root).filter(
    (t) => t.descriptor.kind === "file",
  );

  return {
    updated_at: Date.now(),
    focused_app: focused?.app ?? null,
    visible_apps: shell.windows
      .filter((w) => !w.minimized)
      .map((w) => w.app),
    active_project: project
      ? { id: project.id, name: project.name, root_path: project.root_path }
      : null,
    active_archives_view:
      focused?.app === "archives" ? archives.view : null,
    open_note: openNote,
    active_tab: tabSummary,
    open_file_paths: allFileTabs
      .map((t) =>
        t.descriptor.kind === "file" ? t.descriptor.path : null,
      )
      .filter((p): p is string => !!p)
      .slice(0, 20),
  };
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let lastJson = "";

async function writeSnapshot(): Promise<void> {
  try {
    const snap = buildSnapshot();
    const json = JSON.stringify(snap);
    if (json === lastJson) return; // no-op when nothing relevant changed
    lastJson = json;
    await invoke("context_snapshot_write", { json });
  } catch (e) {
    log.warn("context snapshot write failed", e);
  }
}

/** Schedule a snapshot write. Debounced 300ms — UI state can churn during
 * a tab drag / window resize and we don't want to spam the disk. */
export function scheduleContextSnapshot(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void writeSnapshot();
  }, 300);
}

/** Subscribe to the relevant stores so the snapshot stays fresh. Called
 * once at app boot from App.tsx. The function returns an unsubscribe that
 * we don't actually use today (stores live forever). */
export function startContextSnapshotter(): () => void {
  const unsubs: Array<() => void> = [];
  unsubs.push(useShell.subscribe(scheduleContextSnapshot));
  unsubs.push(useProjectStore.subscribe(scheduleContextSnapshot));
  unsubs.push(useWorkspace.subscribe(scheduleContextSnapshot));
  unsubs.push(useArchives.subscribe(scheduleContextSnapshot));
  // Write an initial snapshot right away so the first agent turn sees
  // something even if the user hasn't touched the UI yet.
  scheduleContextSnapshot();
  return () => unsubs.forEach((u) => u());
}
