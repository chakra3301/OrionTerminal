import { useRecovery } from "@/features/recovery/recoveryStore";
import { useNotesStore } from "@/store/notesStore";
import { archivesDisableReason } from "@/apps/archives/pluginContributions";

/** What quitting Archives 47 right now would lose. */
export function archivesQuitRisks(bootReady: boolean): string[] {
  const risks: string[] = [];
  if (!bootReady) risks.push("Startup is still in progress.");
  const recovery = useRecovery.getState();
  if (recovery.pending || recovery.error) risks.push("Local note recovery is pending or failed. Save normally; recovery copies may be incomplete.");
  const notes = useNotesStore.getState().pendingWrites.size;
  if (notes) risks.push(`${notes} note(s) have unsaved changes or pending writes. Use Save now or Retry save in the note.`);
  const busy = archivesDisableReason();
  if (busy) risks.push(busy.replace(/before disabling the plugin/g, "before quitting"));
  return [...new Set(risks)];
}
