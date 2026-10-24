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
import { appRegistry } from "@/plugins/appRegistry";
import { beginXDesignActivity } from "@/apps/xdesign/runtimeActivity";
import { beginOrionActivity } from "@/apps/orion/runtimeActivity";

/**
 * Stage a complete React component in the active Orion project, preserving the
 * original file for Accept/Reject in the existing DiffReview workflow.
 */
export async function exportSelectionToCode(): Promise<void> {
  if (!appRegistry.has("orion")) {
    toast.warning("Enable the Orion editor plugin first", {
      body: "Design→code uses Orion's project and review workflow.",
    });
    return;
  }
  const xd = useXDesign.getState();
  const project = useProjectStore.getState().active;
  if (!project) {
    toast.warning("Open a project in Orion first", {
      body: "Design→code writes the component into the project's file tree.",
    });
    return;
  }

  const endXDesignActivity = beginXDesignActivity(
    "export-to-orion",
    "Wait for XDesign to finish exporting code before disabling the plugin.",
  );
  const endOrionActivity = beginOrionActivity(
    "xdesign-export",
    "Wait for XDesign's Orion export to finish before disabling the editor plugin.",
  );
  try {
    let gen: { componentName: string; code: string } | null = null;
    if (xd.pencilDocument) {
      const { usePencilWorkspace, exportPencil } = await import("./pencil/runtime");
      const editor = usePencilWorkspace.getState().editor;
      const selected = editor?.getSelectedNodes() ?? [];
      const root = selected.find(node => node.type === "FRAME" || node.type === "COMPONENT") ?? selected[0];
      if (!root) { toast.warning("Select a design layer to export to React"); return; }
      try {
        const componentName = (root.name.match(/[a-z][a-z0-9]*/gi) ?? [])
          .map(word => word[0]!.toUpperCase() + word.slice(1)).join("").slice(0, 80) || "DesignComponent";
        const code = new TextDecoder().decode(await exportPencil("REACT", 1, [root.id]));
        gen = { componentName, code };
      } catch (error) { toast.error("Design code export failed", { body: String(error) }); return; }
    } else {
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

      gen = generateComponent(root.id, xd.shapes, xd.variables);
    }
    if (!gen) {
      toast.error("Couldn't generate code for that selection");
      return;
    }

    const path = `${project.root_path}/src/components/${gen.componentName}.tsx`;
    const code = `${gen.code}`;
    if (useProjectStore.getState().active?.root_path !== project.root_path) throw new Error("The Orion project changed during code export");
    let original = "";
    let existed = false;
    existed = await ipc.pathExists(path);
    if (existed) original = await ipc.readFile(path);
    if (useProjectStore.getState().active?.root_path !== project.root_path || !appRegistry.has("orion")) throw new Error("The Orion workspace changed during code export");
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
  } finally {
    endXDesignActivity();
    endOrionActivity();
  }
}
