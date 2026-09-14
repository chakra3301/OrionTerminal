import { useTabsStore } from "@/store/tabsStore";
import { ipc } from "@/lib/ipc";
import { serialQueue } from "@/lib/serialQueue";
import { logActivity } from "@/lib/db";
import { log } from "@/lib/log";
import { toast } from "@/store/toastStore";
import { trackOrionActivity } from "./runtimeActivity";

const queues = new Map<string, { run: ReturnType<typeof serialQueue>; count: number }>();

export function saveFileBuffer(path: string): Promise<boolean> {
  const buffer = useTabsStore.getState().fileBuffers[path];
  if (!buffer?.loaded) return Promise.resolve(false);
  return saveFileSnapshot(path, buffer.contents);
}

export function saveFileSnapshot(path: string, contents: string): Promise<boolean> {
  let queue = queues.get(path);
  if (!queue) { queue = { run: serialQueue(), count: 0 }; queues.set(path, queue); }
  const current = queue;
  current.count++;
  return trackOrionActivity(`file-save:${path}`, "Wait for Orion to finish saving files before disabling the plugin.", () =>
    current.run(async () => {
      try {
        await ipc.saveFileAtomic(path, contents);
        useTabsStore.getState().markSaved(path, contents);
      } catch (error) {
        log.error("save failed", path, error);
        toast.error("File was not saved", { body: "Check your editor buffer and retry Save before quitting. No successful save was acknowledged.", dedupeKey: `file-save:${path}` });
        return false;
      }
      void logActivity({ source: "orion", kind: "file.save", title: path.split("/").pop() || path, refId: path })
        .catch((error) => log.warn("file activity log failed", error));
      void import("@/features/context/codebaseIndexer").then((m) => m.scheduleCodeFileReindex(path))
        .catch((error) => log.warn("file indexing schedule failed", error));
      return true;
    }),
  ).finally(() => { if (--current.count === 0) queues.delete(path); });
}
