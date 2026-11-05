import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { listRips, type WebsiteRipRow } from "./repolensWebsitesDb";
import { parseUrl, isTerminal } from "./websiteRip";
import { toast } from "@/store/toastStore";
import { useProvidersStore } from "@/store/providersStore";
import { websiteModelSelection } from "./models";
import { archivesHost } from "@/apps/archives/host";

type WebsiteEvent = {
  id: string;
  status: WebsiteRipRow["status"];
  phase: string;
  logDelta?: string;
  thumbnailPath?: string;
  sessionId?: string | null;
};

type State = {
  rips: WebsiteRipRow[];
  loaded: boolean;
  load: () => Promise<void>;
  rip: (rawUrl: string, model: string | null) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  continueRip: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Open a finished clone in the host's editor; a no-op when the host has none. */
  openClone: (id: string) => Promise<void>;
  applyEvent: (e: WebsiteEvent) => void;
  extracting: Set<string>;
  extractDesign: (id: string, model: string | null) => Promise<void>;
};

export const useRepoLensWebsites = create<State>((set, get) => ({
  rips: [],
  loaded: false,
  extracting: new Set<string>(),

  load: async () => {
    const rips = await listRips();
    set({ rips, loaded: true });
  },

  rip: async (rawUrl, model) => {
    const parsed = parseUrl(rawUrl);
    if (!parsed) {
      toast.error("Enter a valid URL");
      return;
    }
    if (get().rips.some((r) => r.status === "running")) {
      toast.info("A rip is already running — it'll need to finish first.");
      return;
    }
    try {
      const selected = websiteModelSelection(useProvidersStore.getState().providers, model);
      await ipc.repolensWebsiteRip(parsed.url, selected);
      await get().load();
    } catch (e) {
      toast.error(`Rip failed to start: ${String(e)}`);
    }
  },

  cancel: async (id) => {
    try {
      await ipc.repolensWebsiteCancel(id);
      await get().load();
    } catch (error) { toast.error("Website agent was not stopped", { body: String(error) }); }
  },

  continueRip: async (id) => {
    try {
      await ipc.repolensWebsiteContinue(id);
      await get().load();
    } catch (error) { toast.error("Website agent could not continue", { body: String(error) }); }
  },

  remove: async (id) => {
    try {
      await ipc.repolensWebsiteDelete(id);
      set((s) => ({ rips: s.rips.filter((r) => r.id !== id) }));
    } catch (error) { toast.error("Website project was not deleted", { body: String(error) }); }
  },

  openClone: async (id) => {
    const open = archivesHost().openWebsiteClone;
    const row = get().rips.find((r) => r.id === id);
    if (!open || !row) return;
    await open(row.project_path, row.id);
  },

  applyEvent: (e) => {
    set((s) => {
      const i = s.rips.findIndex((r) => r.id === e.id);
      if (i === -1) {
        void get().load();
        return s;
      }
      const cur = s.rips[i];
      if (!cur) return s;
      // Never downgrade a finished rip back to an active state: a late
      // thumbnail emit (which carries status "running") can arrive in the ms
      // after the run already marked the rip done/error/cancelled.
      const status =
        isTerminal(cur.status) && !isTerminal(e.status) ? cur.status : e.status;
      const next: WebsiteRipRow = {
        ...cur,
        status,
        phase: e.phase || cur.phase,
        log: e.logDelta ? `${cur.log}${e.logDelta}\n` : cur.log,
        thumbnail_path: e.thumbnailPath ?? cur.thumbnail_path,
        session_id: e.sessionId ?? cur.session_id,
        updated_at: Date.now(),
      };
      const rips = [...s.rips];
      rips[i] = next;
      return { rips };
    });
    if (isTerminal(e.status)) {
      if (e.status === "done") toast.success("Website clone finished");
      if (e.status === "error") toast.error("Website rip failed");
    }
  },

  extractDesign: async (id, model) => {
    if (get().extracting.has(id)) return;
    set((s) => ({ extracting: new Set(s.extracting).add(id) }));
    try {
      const selected = websiteModelSelection(useProvidersStore.getState().providers, model);
      const json = await ipc.repolensWebsiteExtractDesign(id, selected);
      set((s) => {
        const rips = s.rips.map((r) =>
          r.id === id ? { ...r, design_json: json, design_at: Date.now() } : r,
        );
        return { rips };
      });
      toast.success("Design MD ready");
    } catch (e) {
      toast.error(`Extract failed: ${String(e)}`);
    } finally {
      set((s) => {
        const next = new Set(s.extracting);
        next.delete(id);
        return { extracting: next };
      });
    }
  },
}));
