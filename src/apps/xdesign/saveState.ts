import { create } from "zustand";

type NameDraft = { value: string; saving: boolean; error?: string };
type SaveState = {
  documents: Record<string, { revision: number; error?: string }>;
  names: Record<string, NameDraft>;
};
let revision = 0;
export const useXDesignSaveState = create<SaveState>(() => ({ documents: {}, names: {} }));

export function markProjectDirty(id: string): number {
  const next = ++revision;
  useXDesignSaveState.setState((s) => ({ documents: { ...s.documents, [id]: { ...s.documents[id], revision: next } } }));
  return next;
}

export function projectSaveStarted(id: string): number {
  return useXDesignSaveState.getState().documents[id]?.revision ?? markProjectDirty(id);
}

export function projectSaveFinished(id: string, savedRevision: number, error?: string): void {
  useXDesignSaveState.setState((s) => {
    if (s.documents[id]?.revision !== savedRevision) return s;
    const documents = { ...s.documents };
    if (error) documents[id] = { revision: savedRevision, error };
    else delete documents[id];
    return { documents };
  });
}

export function setProjectNameDraft(id: string, draft: NameDraft | null): void {
  useXDesignSaveState.setState((s) => {
    const names = { ...s.names };
    if (draft) names[id] = draft;
    else delete names[id];
    return { names };
  });
}

export function discardProjectSaveState(id: string): void {
  useXDesignSaveState.setState((s) => {
    const documents = { ...s.documents }, names = { ...s.names };
    delete documents[id]; delete names[id];
    return { documents, names };
  });
}

export function unsavedXDesignReason(): string | null {
  const { documents, names } = useXDesignSaveState.getState();
  if (Object.keys(names).length) return "Save or discard the unfinished project name before disabling XDesign.";
  if (Object.keys(documents).length) return "XDesign has unsaved work. Use Retry save in its project tabs before disabling the plugin.";
  return null;
}
