import { useXDesign } from "../store";
import { editPencilImage, pencilPhotoDocumentId } from "../pencil/runtime";
import { controlsLocked, editImage, findLegacyImage, finishSmartContents, resumeSmartContents, usePhotoWorkspace, type OpenPhotoTab } from "./runtime";
import type { PhotoTab } from "./types";

export const sameTab = (a: PhotoTab, b: PhotoTab) => a.source === b.source && a.placementId === b.placementId;
export const tabKey = (tab: PhotoTab) => `${tab.source}:${tab.placementId}`;

export function activeTab(): PhotoTab | null {
  const { shapeId, source } = usePhotoWorkspace.getState();
  return shapeId ? { source, placementId: shapeId } : null;
}

/** The document a tab's placement shows now, or null once the placement is gone. */
export function tabDocumentId(tab: PhotoTab): string | null {
  if (tab.source === "pencil") return pencilPhotoDocumentId(tab.placementId);
  return findLegacyImage(tab.placementId)?.shape.photoDocumentId ?? null;
}

export function liveTabs(): OpenPhotoTab[] {
  const current = activeTab();
  return usePhotoWorkspace.getState().tabs.filter(tab => (current && sameTab(tab, current)) || tabDocumentId(tab));
}

export function pruneTabs(): void {
  const live = liveTabs();
  if (live.length !== usePhotoWorkspace.getState().tabs.length) usePhotoWorkspace.setState({ tabs: live });
}

export function rememberTab(tab: PhotoTab, patch: Partial<Pick<OpenPhotoTab, "draftId" | "label" | "view">>): void {
  usePhotoWorkspace.setState(state => ({ tabs: state.tabs.map(item => sameTab(item, tab) ? { ...item, ...patch } : item) }));
}

const dropTab = (tab: PhotoTab) => usePhotoWorkspace.setState(state => ({ tabs: state.tabs.filter(item => !sameTab(item, tab)) }));

export async function activateTab(tab: PhotoTab): Promise<void> {
  const workspace = usePhotoWorkspace.getState(), current = activeTab();
  if (controlsLocked(workspace) || (current && sameTab(current, tab))) return;
  // Opening another image ends the contents session in the editor, but its draft stays, so coming back reopens it.
  if (current) rememberTab(current, { draftId: workspace.smartTrail[0]?.childId });
  const draftId = workspace.tabs.find(item => sameTab(item, tab))?.draftId;
  if (draftId && useXDesign.getState().photoDrafts.some(draft => draft.id === draftId)) await resumeSmartContents(draftId);
  else await (tab.source === "pencil" ? editPencilImage(tab.placementId) : editImage(tab.placementId));
  rememberTab(tab, { draftId: undefined });
}

export async function cycleTab(step: 1 | -1): Promise<void> {
  const tabs = liveTabs(), current = activeTab();
  if (!current || tabs.length < 2) return;
  const index = tabs.findIndex(tab => sameTab(tab, current));
  await activateTab(tabs[(index + step + tabs.length) % tabs.length]!);
}

/** Open contents: in the editor for the active tab, a remembered draft for the others. */
function hasContents(tab: PhotoTab): boolean {
  const workspace = usePhotoWorkspace.getState(), current = activeTab();
  if (current && sameTab(tab, current)) return workspace.smartTrail.length > 0;
  const draftId = workspace.tabs.find(item => sameTab(item, tab))?.draftId;
  return !!draftId && useXDesign.getState().photoDrafts.some(draft => draft.id === draftId);
}

/** Contents left open in a tab reach its image before the tab closes, as closing the active tab saves them. */
async function saveContents(tabs: PhotoTab[]): Promise<void> {
  for (const tab of tabs.filter(hasContents)) {
    await activateTab(tab);
    for (let left = usePhotoWorkspace.getState().smartTrail.length; left; left--) await finishSmartContents(true);
  }
}

const neighbour = (tab: PhotoTab) => {
  const tabs = liveTabs(), index = tabs.findIndex(item => sameTab(item, tab));
  return tabs[index + 1] ?? tabs[index - 1];
};

/** Closing the editor yourself means the project reopens on the board. Automatic closes keep it. */
export function closeImageEditor(): void {
  if (usePhotoWorkspace.getState().busy) return;
  usePhotoWorkspace.getState().close();
  useXDesign.setState({ photoResume: null });
}

export async function closeTab(tab = activeTab()): Promise<void> {
  const workspace = usePhotoWorkspace.getState(), current = activeTab();
  if (controlsLocked(workspace) || !tab) return;
  if (!current || !sameTab(tab, current)) {
    if (current && hasContents(tab)) { await saveContents([tab]); await activateTab(current); }
    dropTab(tab); return;
  }
  if (workspace.smartTrail.length) { await finishSmartContents(true); return; }
  const next = neighbour(tab);
  if (!next) { closeImageEditor(); return; }
  // The tab stays until its neighbour has opened, so a failed switch leaves it as it was.
  await activateTab(next);
  dropTab(tab);
}

export async function closeAllTabs(): Promise<void> {
  if (controlsLocked(usePhotoWorkspace.getState())) return;
  const tabs = liveTabs();
  if (tabs.some(hasContents)) await saveContents(tabs);
  closeImageEditor();
}

export async function closeOtherTabs(): Promise<void> {
  const current = activeTab();
  if (controlsLocked(usePhotoWorkspace.getState()) || !current) return;
  const others = liveTabs().filter(tab => !sameTab(tab, current));
  if (others.some(hasContents)) { await saveContents(others); await activateTab(current); }
  usePhotoWorkspace.setState(state => ({ tabs: state.tabs.filter(tab => sameTab(tab, current)) }));
}

/** The active tab's image was deleted or undone away: show its neighbour, as closing it would. */
export function closeVanishedTab(): void {
  const workspace = usePhotoWorkspace.getState(), current = activeTab();
  // Once it's unlisted, the neighbour is already opening.
  if (workspace.busy || !current || !workspace.tabs.some(tab => sameTab(tab, current))) return;
  const next = neighbour(current);
  dropTab(current);
  if (!next) { workspace.close(); return; }
  activateTab(next).catch(() => usePhotoWorkspace.getState().close());
}

/** Tabs left by Back to design still belong to their project; any other active project clears them. */
export function staleTabProject(activeId: string | null): boolean {
  const { projectId, tabProject } = usePhotoWorkspace.getState();
  return !!projectId && projectId !== activeId || !!tabProject && tabProject !== activeId;
}

export function leaveImageEditor(): void {
  if (usePhotoWorkspace.getState().busy) return;
  usePhotoWorkspace.getState().leave();
  useXDesign.setState({ photoResume: null });
}
