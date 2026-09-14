import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { RecoverySession } from "./draftJournal";
export const useRecovery = create<{
  open: boolean; sessions: RecoverySession[]; pending: boolean; error: string | null; listError: string | null;
  retry: (() => void) | null; refresh: () => Promise<void>;
}>((set) => ({
  open: false, sessions: [], pending: false, error: null, listError: null, retry: null,
  refresh: async () => {
    try { set({ sessions: await invoke<RecoverySession[]>("drafts_list"), listError: null }); }
    catch { set({ listError: "Could not read recovery copies. Preserve the draft-recovery directory; no copies have been removed." }); }
  },
}));
