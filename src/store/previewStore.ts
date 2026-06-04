import { create } from "zustand";
import { setAppState } from "@/lib/db";

export type PreviewMode = "markdown" | "web";

export type PreviewState = {
  mode: PreviewMode;
  url: string;
  followActive: boolean;
  pinnedPath: string | null;
};

type PreviewStore = PreviewState & {
  /** Bumped to force-reload the iframe even when the URL is unchanged.
   * (Reloading via `setUrl(url)` short-circuits in Zustand because the value
   * didn't change → selector subscribers don't re-run → iframe key stays
   * the same → no remount.) */
  reloadNonce: number;
  hydrate: (s: Partial<PreviewState>) => void;
  setMode: (mode: PreviewMode) => void;
  setUrl: (url: string) => void;
  setFollowActive: (follow: boolean) => void;
  pinPath: (path: string | null) => void;
  reload: () => void;
};

const DEFAULTS: PreviewState = {
  mode: "markdown",
  url: "http://localhost:3000",
  followActive: true,
  pinnedPath: null,
};

function persist(state: PreviewState) {
  void setAppState("preview", state);
}

export const usePreviewStore = create<PreviewStore>((set, get) => ({
  ...DEFAULTS,
  reloadNonce: 0,

  hydrate: (s) =>
    set((prev) => ({
      ...prev,
      ...s,
      mode: s.mode === "markdown" || s.mode === "web" ? s.mode : prev.mode,
      followActive:
        typeof s.followActive === "boolean" ? s.followActive : prev.followActive,
    })),

  reload: () => set((s) => ({ reloadNonce: s.reloadNonce + 1 })),

  setMode: (mode) => {
    set({ mode });
    persist({ ...get(), mode });
  },

  setUrl: (url) => {
    set({ url });
    persist({ ...get(), url });
  },

  setFollowActive: (followActive) => {
    set({ followActive });
    persist({ ...get(), followActive });
  },

  pinPath: (pinnedPath) => {
    set({ pinnedPath, followActive: pinnedPath ? false : true });
    persist({ ...get(), pinnedPath, followActive: pinnedPath ? false : true });
  },
}));
