import { invoke, isTauri } from "@tauri-apps/api/core";
import { flushActive, snapshotActiveDoc, useXDProjects, type XDDoc } from "./projectsStore";
import { usePhotoWorkspace } from "./photo/runtime";
import { usePencilWorkspace, withPencilTask } from "./pencil/runtime";
import { trackXDesignActivity } from "./runtimeActivity";

export type ProjectCheckpoint = { id: string; label: string; createdAt: number; bytes: number; automatic: boolean };
function desktop() { if (!isTauri()) throw new Error("Project history is available in the Orion Terminal desktop app."); }
function activeProject() {
  desktop();
  const { activeId, transitioning, registry } = useXDProjects.getState();
  const meta = registry.find(item => item.id === activeId);
  if (!activeId || !meta || meta.kind && meta.kind !== "design" || transitioning || usePhotoWorkspace.getState().busy || usePencilWorkspace.getState().busy) throw new Error("Wait for the design project and its current operation to finish.");
  return meta;
}
export function listProjectCheckpoints(projectId: string): Promise<ProjectCheckpoint[]> {
  desktop(); return invoke("xdesign_checkpoint_list", { projectId });
}
export async function createProjectCheckpoint(label: string): Promise<void> {
  const project = activeProject();
  if (!label.trim() || new TextEncoder().encode(label.trim()).length > 256) throw new Error("Use a checkpoint name of 1–256 bytes.");
  await withPencilTask(() => trackXDesignActivity("canvas-export", "Wait for the checkpoint to finish saving before switching projects.", async () => {
    await flushActive();
    await invoke("xdesign_checkpoint_create", { projectId: project.id, document: JSON.stringify(snapshotActiveDoc()), label: label.trim() });
  }));
}
export async function restoreProjectCheckpoint(checkpoint: ProjectCheckpoint): Promise<void> {
  const project = activeProject();
  await useXDProjects.getState().importDesignProject(projectId => invoke<{ name: string; document: XDDoc }>("xdesign_checkpoint_restore", {
    projectId: project.id, newProjectId: projectId, checkpointId: checkpoint.id,
    name: `${project.name} — ${checkpoint.automatic ? new Date(checkpoint.createdAt).toLocaleString() : checkpoint.label}`,
  }));
}
export async function deleteProjectCheckpoint(checkpointId: string): Promise<void> {
  const project = activeProject();
  await withPencilTask(() => trackXDesignActivity("canvas-export", "Wait for the checkpoint to finish deleting before switching projects.", () => invoke("xdesign_checkpoint_delete", { projectId: project.id, checkpointId })));
}
