import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { log } from "@/lib/log";
import { createQuitCoordinator } from "./quitCoordinator";
import { quitRisks } from "./quitRisks";

export function useQuitGuard(bootReady: boolean): void {
  const ready = useRef(bootReady); ready.current = bootReady;
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false, off: (() => void) | undefined;
    const coordinator = createQuitCoordinator({
      risks: () => quitRisks(ready.current),
      confirm: (risks) => confirm(
        `${risks.map((r) => `• ${r}`).join("\n")}\n\nQuit without saving? Memory-only drafts will be lost. Running operations may finish or be interrupted; quitting is not rollback. Keep working to save or stop them first.`,
        { title: "Quit Orion Terminal?", kind: "warning", okLabel: "Quit without saving", cancelLabel: "Keep working" },
      ),
      decide: (requestId, allow) => invoke("app_quit_decide", { requestId, allow }),
      freeze: () => {
        const wasInert = document.body.inert; document.body.inert = true;
        return () => { document.body.inert = wasInert; };
      },
      report: (error) => {
        log.error("Quit check failed", error);
        void message("Orion could not complete its quit check and has stayed open. Save your work before trying again.", { title: "Quit paused", kind: "error" }).catch(() => {});
      },
    });
    void (async () => {
      const unlisten = await listen<string>("app:quit-requested", (event) => { void coordinator.request(event.payload); });
      if (disposed) { unlisten(); return; }
      off = unlisten;
      const pending = await invoke<string | null>("app_quit_pending");
      if (pending && !disposed) await coordinator.request(pending);
    })().catch((error) => log.error("Quit listener failed; native exit remains guarded", error));
    return () => { disposed = true; coordinator.dispose(); off?.(); };
  }, []);
}
