import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useNotesStore } from "@/store/notesStore";
import { useTabsStore } from "@/store/tabsStore";
import { toast } from "@/store/toastStore";
import { collectDrafts, createDraftWriter } from "./draftJournal";
import { useRecovery } from "./recoveryStore";

export function useDraftRecovery(ready: boolean): void {
  useEffect(() => {
    if (!ready || !isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const fail = () => {
      if (disposed) return;
      useRecovery.setState({ error: "Local draft recovery could not start. Save your work normally; do not rely on crash recovery." });
      toast.error("Draft recovery unavailable", { body: "Save your work normally. Restart to retry local recovery.", durationMs: 0, dedupeKey: "draft-recovery" });
    };
    void (async () => {
      const session = await invoke<string>("drafts_begin");
      if (disposed) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      useRecovery.setState({ pending: false, error: null });
      const writer = createDraftWriter((revision, json) => invoke("drafts_write", { session, revision, json }), (pending, error) => {
        useRecovery.setState({ pending: pending || timer !== undefined, error });
        if (error) toast.error("Recovery copy was not written", { body: error, durationMs: 0, dedupeKey: "draft-recovery", action: { label: "Retry recovery", run: () => writer.retry() } });
      });
      const capture = () => {
        clearTimeout(timer); timer = undefined;
        try { writer.update(collectDrafts()); writer.retry(); useRecovery.setState({ pending: writer.isPending() }); } catch { fail(); }
      };
      const queueCapture = () => { useRecovery.setState({ pending: true }); clearTimeout(timer); timer = setTimeout(capture, 150); };
      const notes = useNotesStore.subscribe((next, previous) => { if (next.drafts !== previous.drafts || (next.drafts.size && next.notes !== previous.notes)) queueCapture(); });
      const files = useTabsStore.subscribe(queueCapture);
      stop = () => { clearTimeout(timer); notes(); files(); writer.dispose(); };
      useRecovery.setState({ retry: capture });
      capture(); await useRecovery.getState().refresh();
      if (!disposed && (useRecovery.getState().sessions.length || useRecovery.getState().listError)) {
        toast.info("Local recovery copies found", { body: "Review notes and files from a previous session. Saved copies can be older than your last edits.", durationMs: 0, dedupeKey: "draft-recovery-found", action: { label: "Review recovery", run: () => useRecovery.setState({ open: true }) } });
      }
    })().catch(fail);
    return () => { disposed = true; stop?.(); useRecovery.setState({ retry: null }); };
  }, [ready]);
}
