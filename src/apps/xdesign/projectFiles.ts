import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { flushActive, snapshotActiveDoc, useXDProjects, validateDesignDoc, type XDDoc } from "./projectsStore";
import { trackXDesignActivity } from "./runtimeActivity";
import { withPencilTask } from "./pencil/runtime";
import { usePhotoWorkspace } from "./photo/runtime";

export async function openProjectFile(sourcePath?: string): Promise<void> {
  if (!isTauri()) throw new Error("Open portable XDesign projects in the Orion Terminal desktop app.");
  const path = sourcePath ?? await open({ multiple: false, filters: [{ name: "XDesign project", extensions: ["xdesign"] }] });
  if (typeof path !== "string") return;
  await useXDProjects.getState().importDesignProject(async (projectId, assets) => {
    const imported = await assets.run(operationId => invoke<{ name: string; document: XDDoc }>("xdesign_project_import", { projectId, path, operationId }));
    if (typeof imported.name !== "string") throw new Error("Invalid XDesign project name");
    validateDesignDoc(imported.document);
    return imported;
  });
}

export async function saveProjectFile(): Promise<void> {
  if (!isTauri()) throw new Error("Save portable XDesign projects in the Orion Terminal desktop app.");
  const { activeId, registry } = useXDProjects.getState();
  const project = registry.find(item => item.id === activeId);
  if (!activeId || !project || project.kind && project.kind !== "design") throw new Error("Open a design project to save a project file.");
  const path = await save({ defaultPath: `${project.name.replace(/[\\/:*?"<>|]/g, "-")}.xdesign`, filters: [{ name: "XDesign project", extensions: ["xdesign"] }] });
  if (!path) return;
  if (useXDProjects.getState().activeId !== activeId || useXDProjects.getState().transitioning || usePhotoWorkspace.getState().busy) throw new Error("The project changed or an image operation is still running. Try saving again.");
  await withPencilTask(() => trackXDesignActivity("canvas-export", "Wait for the project file to finish saving before switching projects.", async () => {
    await flushActive();
    const document = snapshotActiveDoc(); validateDesignDoc(document);
    await invoke("xdesign_project_export", { projectId: activeId, path, name: project.name, document });
  }));
}
