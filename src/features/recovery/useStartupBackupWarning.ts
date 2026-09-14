import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "@/store/toastStore";

export function useStartupBackupWarning(ready: boolean): void {
  useEffect(() => {
    if (!ready || !isTauri()) return;
    let disposed = false;
    const show = (body: string) => {
      if (!disposed) toast.error("Database backup needs attention", { body, durationMs: 0, dedupeKey: "startup-database-backup" });
    };
    void invoke<string | null>("database_backup_warning")
      .then((warning) => { if (warning) show(warning); })
      .catch(() => show("Could not check the startup database backup. Do not assume a recent recovery snapshot exists; preserve your database and older backups."));
    return () => { disposed = true; };
  }, [ready]);
}
