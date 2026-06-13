import { useXDesign } from "@/apps/xdesign/store";
import { useProjectStore } from "@/store/projectStore";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { useTabsStore } from "@/store/tabsStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { useShell } from "@/shell/store/useShell";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";
import { generateComponent } from "@/apps/xdesign/designToReact";

/**
 * Export the selected frame to React + Orion design tokens, written into the
 * project's src/components/ as a REVIEWABLE STAGED EDIT (reuses the Phase-1
 * pending-edit + DiffReview flow). The wedge Figma structurally can't do:
 * real code into the real repo next door, accept/reject like any AI edit.
 */
export async function exportSelectionToCode(): Promise<void> {
  const xd = useXDesign.getState();
  const project = useProjectStore.getState().active;
  if (!project) {
    toast.warning("Open a project in Orion first", {
      body: "Design→code writes the component into the project's file tree.",
    });
    return;
  }

  // Prefer a selected frame; fall back to the first selected shape.
  const selected = [...xd.selection]
    .map((id) => xd.shapes.find((s) => s.id === id))
    .filter(Boolean);
  const root = (selected.find((s) => s!.kind === "frame") ?? selected[0]) as
    | (typeof xd.shapes)[number]
    | undefined;
  if (!root) {
    toast.warning("Select a frame to export to React");
    return;
  }

  const gen = generateComponent(root.id, xd.shapes, xd.variables);
  if (!gen) {
    toast.error("Couldn't generate code for that selection");
    return;
  }

  const path = `${project.root_path}/src/components/${gen.componentName}.tsx`;
  const code = `${gen.code}`;
  try {
    let original = "";
    let existed = false;
    try {
      existed = await ipc.pathExists(path);
      if (existed) original = await ipc.readFile(path);
    } catch {
      /* treat as new */
    }
    // Disk holds `updated` so Accept keeps it / Reject restores `original`
    // (or deletes the new file) — exactly the staged-edit contract.
    await ipc.saveFileAtomic(path, code);

    usePendingEdits.getState().stage({ path, original, updated: code, isNew: !existed });
    useTabsStore.getState().markLoaded(path, code);
    useFileTreeRefresh.getState().bump();
    useShell.getState().openApp("orion");
    useWorkspace.getState().openTab({ kind: "diff-review", path });
    toast.success(`Exported <${gen.componentName} /> — review in Orion`, {
      body: `src/components/${gen.componentName}.tsx`,
    });
  } catch (e) {
    log.error("export to code failed", e);
    toast.error("Export to code failed", {
      body: e instanceof Error ? e.message : String(e),
    });
  }
}
