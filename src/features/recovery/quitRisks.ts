import { useRecovery } from "./recoveryStore";
import { useNotesStore } from "@/store/notesStore";
import { useTabsStore } from "@/store/tabsStore";
import { useXDesignSaveState } from "@/apps/xdesign/saveState";
import { pluginDisableReason, usePluginManager } from "@/store/pluginManagerStore";
import { BUILTIN_APP_PLUGIN_IDS } from "@/plugins/builtinApps";

export function quitRisks(bootReady: boolean): string[] {
  const risks: string[] = [];
  if (!bootReady) risks.push("Startup is still in progress.");
  if (useRecovery.getState().pending || useRecovery.getState().error) risks.push("Local note/file recovery is pending or failed. Save normally; recovery copies may be incomplete.");
  const notes = useNotesStore.getState().pendingWrites.size;
  if (notes) risks.push(`${notes} Archives note(s) have unsaved changes or pending writes. Use Save now or Retry save in the note.`);
  const files = Object.values(useTabsStore.getState().fileBuffers).filter((b) => b.loaded && b.contents !== b.original).length;
  if (files) risks.push(`${files} Orion file(s) have unsaved changes. Save them before quitting.`);
  const { documents, names } = useXDesignSaveState.getState();
  if (Object.keys(documents).length || Object.keys(names).length) risks.push("XDesign has unsaved documents or unfinished names. Save, retry, or discard the name draft first.");
  if (usePluginManager.getState().busyIds.length) risks.push("A plugin change is still in progress.");
  for (const id of [BUILTIN_APP_PLUGIN_IDS.orion, BUILTIN_APP_PLUGIN_IDS.archives, BUILTIN_APP_PLUGIN_IDS.xdesign, BUILTIN_APP_PLUGIN_IDS.hermes, BUILTIN_APP_PLUGIN_IDS.command]) {
    const reason = pluginDisableReason(id);
    if (reason) risks.push(reason.replace(/before disabling (?:the plugin|XDesign)/g, "before quitting"));
  }
  return [...new Set(risks)];
}
