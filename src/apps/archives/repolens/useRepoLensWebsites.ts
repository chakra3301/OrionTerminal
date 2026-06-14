import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { listRips, type WebsiteRipRow } from "./repolensWebsitesDb";
import { parseUrl, isTerminal } from "./websiteRip";
import { toast } from "@/store/toastStore";
import { useProjectStore } from "@/store/projectStore";
import { useShell } from "@/shell/store/useShell";
import { useWorkspace } from "@/components/workspace/workspaceStore";

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
  openInOrion: (id: string) => Promise<void>;
  applyEvent: (e: WebsiteEvent) => void;
};

export const useRepoLensWebsites = create<State>((set, get) => ({
  rips: [],
  loaded: false,

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
      await ipc.repolensWebsiteRip(parsed.url, model);
      await get().load();
    } catch (e) {
      toast.error(`Rip failed to start: ${String(e)}`);
    }
  },

  cancel: async (id) => {
    await ipc.repolensWebsiteCancel(id);
    await get().load();
  },

  continueRip: async (id) => {
    await ipc.repolensWebsiteContinue(id);
    await get().load();
  },

  remove: async (id) => {
    await ipc.repolensWebsiteDelete(id);
    set((s) => ({ rips: s.rips.filter((r) => r.id !== id) }));
  },

  openInOrion: async (id) => {
    const row = get().rips.find((r) => r.id === id);
    if (!row) return;
    await useProjectStore.getState().openProjectAtPath(row.project_path);
    useShell.getState().openApp("orion");
    // Replace whatever was open with a clean view of the clone, then land on
    // its entry file. The per-project workspace swap (App.tsx
    // `useProjectScopedLayout`) hydrates the new project's layout asynchronously
    // after a DB read, so we defer past it, then explicitly reset to a fresh
    // layout (guaranteeing the previous project's tabs are gone) and open the
    // first entry file that exists.
    setTimeout(() => {
      void (async () => {
        const { defaultOrionLayout } = await import(
          "@/components/workspace/workspaceStore"
        );
        useWorkspace.getState().resetLayout(defaultOrionLayout);
        const candidates = [
          `${row.project_path}/src/app/page.tsx`,
          `${row.project_path}/README.md`,
          `${row.project_path}/package.json`,
        ];
        for (const path of candidates) {
          const exists = await ipc.pathExists(path).catch(() => false);
          if (exists) {
            useWorkspace.getState().openTab(
              { kind: "file", path },
              { label: path.split("/").pop() ?? "page.tsx", preferRole: "editor" },
            );
            return;
          }
        }
      })();
    }, 300);
    toast.info("Run `npm run dev` in the terminal to preview the clone.");
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
}));
