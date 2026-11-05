import { create } from "zustand";
import { ulid } from "ulid";
import { setArchivesActivity } from "../runtimeActivity";
import { useAssetsStore } from "@/store/assetsStore";
import { downloadApi, isDownloadActive, type DownloadEngines, type DownloadJob, type DownloadPreset, type DownloadOptions, type DownloadPreferences, type DownloadCookieChoice, type DownloadQueueStatus, type DownloadPlaylist, parseBatchLinks } from "./downloadTypes";

type State = {
  jobs: DownloadJob[]; engines: DownloadEngines | null; error: string | null;
  pending: string | null; loading: boolean; uncertain: boolean;
  preferences: DownloadPreferences | null; preferencesError: string | null; archiveCount: number | null;
  queue: DownloadQueueStatus; playlist: DownloadPlaylist | null; scanId: string | null;
  batchDraft: string; playlistDraft: string;
  batch: (input: string) => Promise<boolean>;
  runQueue: (concurrency: number) => Promise<void>;
  holdQueue: () => Promise<void>;
  addToQueue: (id: string, preset: DownloadPreset, options: DownloadOptions) => Promise<void>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  scanPlaylist: (url: string) => Promise<boolean>;
  stopScan: () => Promise<void>;
  queuePlaylist: (id: string, indices: number[]) => Promise<boolean>;
  loadPreferences: () => Promise<void>;
  savePreferences: (settings: DownloadPreferences) => Promise<boolean>;
  forget: (id: string) => Promise<void>;
  export: (assetId: string) => Promise<string | null>;
  refresh: () => Promise<void>;
  checkEngines: () => Promise<void>;
  inspect: (url: string, cookies?: DownloadCookieChoice) => Promise<boolean>;
  start: (id: string, preset: DownloadPreset, options?: DownloadOptions, cookies?: DownloadCookieChoice) => Promise<void>;
  playableCopy: (assetId: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  save: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};
let timer: ReturnType<typeof setTimeout> | undefined;
let refreshPromise: Promise<void> | null = null;
let revision = 0;
let preferencesRevision = 0;
const autoImports = new Set<string>();
const queueImports = new Set<string>();
let scanRevision = 0;

function activity() {
  const s = useDownloads.getState();
  setArchivesActivity("media-downloads", !!s.pending || s.uncertain || s.queue.running || s.jobs.some(isDownloadActive),
    "A media download or import is running. Finish or stop it before disabling the plugin.");
}
function poll() {
  clearTimeout(timer); timer = undefined;
  const s = useDownloads.getState();
  if (s.uncertain || s.queue.running || s.jobs.some(isDownloadActive) || autoImports.size || queueImports.size) {
    timer = setTimeout(() => void useDownloads.getState().refresh(), 1000);
  }
}
async function saveDownloaded(id: string) {
  const assetId = await downloadApi.import(id);
  const localCopy = useDownloads.getState().jobs.find((j) => j.id === id)?.sourceAssetId;
  await useAssetsStore.getState().acceptDownload(assetId, !localCopy);
  try { useDownloads.setState({ archiveCount: await downloadApi.archiveCount() }); }
  catch { useDownloads.setState({ archiveCount: null }); }
}
async function action(label: string, work: () => Promise<void>): Promise<boolean> {
  if (useDownloads.getState().pending) return false;
  revision++;
  useDownloads.setState({ pending: label, error: null }); activity();
  let ok = true;
  try { await work(); }
  catch (error) { useDownloads.setState({ error: String(error) }); ok = false; }
  finally {
    revision++;
    useDownloads.setState({ pending: null });
    if (refreshPromise) await refreshPromise;
    await useDownloads.getState().refresh(); activity();
  }
  return ok;
}

export const useDownloads = create<State>((set, get) => ({
  jobs: [], engines: null, error: null, pending: null, loading: false, uncertain: false,
  preferences: null, preferencesError: null, archiveCount: null,
  queue: { running: false, concurrency: 1, error: null }, playlist: null, scanId: null, batchDraft: "", playlistDraft: "",
  batch: (input) => action("Queuing links", async () => { await downloadApi.batch(parseBatchLinks(input)); }),
  runQueue: async (concurrency) => { await action("Running queue", async () => {
    set({ uncertain: true });
    const result = await downloadApi.queueRun(concurrency);
    result.ids.forEach((id) => queueImports.add(id)); set({ queue: result.status });
  }); },
  holdQueue: async () => { await action("Holding queue", async () => { set({ queue: await downloadApi.queueHold() }); }); },
  addToQueue: async (id, preset, options) => { await action("Adding to queue", async () => { await downloadApi.queueAdd(id, preset, options); }); },
  pause: async (id) => { await action("Pausing transfer", async () => { await downloadApi.queuePause(id); queueImports.delete(id); }); },
  resume: async (id) => { await action("Returning to queue", async () => { await downloadApi.queueResume(id); }); },
  reorder: async (ids) => { await action("Reordering queue", async () => { await downloadApi.queueReorder(ids); }); },
  scanPlaylist: async (url) => {
    let accepted = false;
    const version = ++scanRevision;
    const ok = await action("Reading playlist", async () => {
      const id = ulid(); set({ scanId: id, playlist: null });
      try { const review = await downloadApi.playlist(id, url.trim()); if (version === scanRevision) { set({ playlist: review }); accepted = true; } }
      finally { if (get().scanId === id) set({ scanId: null }); }
    });
    return ok && accepted;
  },
  stopScan: async () => {
    const id = get().scanId; if (!id) return;
    ++scanRevision;
    try { await downloadApi.stop(id); } catch (error) { set({ error: String(error) }); }
  },
  queuePlaylist: async (id, indices) => action("Queuing playlist selection", async () => {
    await downloadApi.playlistQueue(id, indices);
    if (get().playlist?.id === id) set({ playlist: null });
  }),
  loadPreferences: async () => {
    const version = ++preferencesRevision;
    try {
      const [preferences, archiveCount] = await Promise.all([downloadApi.preferences(), downloadApi.archiveCount()]);
      if (version === preferencesRevision) set({ preferences, archiveCount, preferencesError: null });
    } catch (error) { if (version === preferencesRevision) set({ preferencesError: String(error) }); }
  },
  savePreferences: async (settings) => action("Saving defaults", async () => {
    ++preferencesRevision;
    const preferences = await downloadApi.preferences(settings);
    ++preferencesRevision;
    set({ preferences, preferencesError: null });
  }),
  forget: async (id) => { await action("Forgetting source archive", async () => {
    await downloadApi.forget(id); set({ archiveCount: await downloadApi.archiveCount() });
  }); },
  export: async (assetId) => {
    let exported: string | null = null;
    await action("Exporting a copy", async () => { exported = await downloadApi.export(assetId); });
    return exported;
  },
  checkEngines: async () => {
    try { set({ engines: await downloadApi.engines() }); }
    catch (error) { set({ error: String(error) }); }
  },
  refresh: async () => {
    if (refreshPromise) return refreshPromise;
    if (get().pending) return;
    const version = revision;
    set({ loading: true });
    refreshPromise = (async () => {
      try {
        const [jobs, queue] = await Promise.all([downloadApi.list(), downloadApi.queueStatus()]);
        if (version !== revision) return;
        set({ jobs, queue, uncertain: false });
        for (const id of [...queueImports]) {
          const job = jobs.find((j) => j.id === id);
          if (!job || ["failed", "stopped", "interrupted", "paused", "skipped"].includes(job.state) || (job.state === "queued" && !queue.running) || (job.state === "ready" && job.error)) queueImports.delete(id);
          if (job?.state === "completed" && job.assetId) {
            queueImports.delete(id);
            try { await useAssetsStore.getState().acceptDownload(job.assetId, true); }
            catch (error) { set({ error: `Saved in Media; library refresh needs attention: ${String(error)}` }); }
          }
        }
        for (const id of [...autoImports]) {
          const job = jobs.find((j) => j.id === id);
          if (!job || ["failed", "stopped", "interrupted", "completed"].includes(job.state)) autoImports.delete(id);
          if (job?.state !== "ready" || get().pending) continue;
          autoImports.delete(id);
          set({ pending: "Saving to Media" }); activity();
          try { await saveDownloaded(id); set({ jobs: await downloadApi.list() }); }
          catch (error) { set({ error: `Media import needs attention: ${String(error)}` }); }
          finally { set({ pending: null }); }
        }
      } catch (error) { set({ error: String(error) }); }
      finally { set({ loading: false }); activity(); }
    })().finally(() => { refreshPromise = null; poll(); });
    await refreshPromise;
  },
  inspect: async (input, cookies) => {
    const url = input.trim();
    return action("Inspecting link", async () => {
      set({ uncertain: true });
      const id=ulid();
      if (cookies) await downloadApi.inspect(id, url, cookies);
      else await downloadApi.inspect(id, url);
    });
  },
  playableCopy: async (assetId) => {
    await action("Preparing playable copy", async () => {
      set({ uncertain: true });
      const id = await downloadApi.playableCopy(ulid(), assetId);
      autoImports.add(id);
      const jobs = await downloadApi.list();
      set({ jobs });
      const saved = jobs.find((j) => j.id === id);
      if (saved?.state === "completed" && saved.assetId) {
        autoImports.delete(id);
        await useAssetsStore.getState().acceptDownload(saved.assetId, false);
      }
    });
  },
  start: async (id, preset, options, cookies) => {
    await action("Starting download", async () => {
      set({ uncertain: true });
      if (cookies) await downloadApi.start(id, preset, options, cookies);
      else if (options) await downloadApi.start(id, preset, options);
      else await downloadApi.start(id, preset);
      autoImports.add(id);
    });
  },
  stop: async (id) => {
    await action("Stopping", async () => { await downloadApi.stop(id); autoImports.delete(id); queueImports.delete(id); });
  },
  save: async (id) => { await action("Saving to Media", () => saveDownloaded(id)); },
  remove: async (id) => {
    await action("Removing history entry", async () => { await downloadApi.remove(id); autoImports.delete(id); queueImports.delete(id); });
  },
}));
