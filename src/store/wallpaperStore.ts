import { create } from "zustand";
import { setAppState } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

export type WallpaperMode = "default" | "custom";
export type OverlayKind = "aurora" | "matrix" | "stars";

export type WallpaperState = {
  mode: WallpaperMode;
  customPath: string | null;
  originalName: string | null;
  overlay: OverlayKind;
  overlayIntensity: number;
};

type WallpaperStore = WallpaperState & {
  hydrate: (s: Partial<WallpaperState>) => void;
  setCustomFromPath: (sourcePath: string) => Promise<void>;
  clearCustom: () => Promise<void>;
  setOverlay: (overlay: OverlayKind) => void;
  setOverlayIntensity: (value: number) => void;
};

const DEFAULT_OVERLAY = 0.6;
const OVERLAY_KINDS: OverlayKind[] = ["aurora", "matrix", "stars"];

function persist(state: WallpaperState) {
  void setAppState("wallpaper", state);
}

export const useWallpaperStore = create<WallpaperStore>((set, get) => ({
  mode: "default",
  customPath: null,
  originalName: null,
  overlay: "aurora",
  overlayIntensity: DEFAULT_OVERLAY,

  hydrate: (s) =>
    set((prev) => ({
      ...prev,
      ...s,
      overlay:
        s.overlay && OVERLAY_KINDS.includes(s.overlay) ? s.overlay : prev.overlay,
      overlayIntensity:
        typeof s.overlayIntensity === "number"
          ? clamp01(s.overlayIntensity)
          : prev.overlayIntensity,
    })),

  setCustomFromPath: async (sourcePath) => {
    const previous = get().customPath;
    const stored = await ipc.wallpaperStoreFile(sourcePath);
    const next: WallpaperState = {
      ...get(),
      mode: "custom",
      customPath: stored.filePath,
      originalName: stored.originalName,
    };
    set(next);
    persist(next);
    if (previous && previous !== stored.filePath) {
      ipc.wallpaperClearFile(previous).catch((err) =>
        log.warn("wallpaper_clear_file (previous) failed", err),
      );
    }
  },

  clearCustom: async () => {
    const previous = get().customPath;
    const next: WallpaperState = {
      ...get(),
      mode: "default",
      customPath: null,
      originalName: null,
    };
    set(next);
    persist(next);
    if (previous) {
      ipc.wallpaperClearFile(previous).catch((err) =>
        log.warn("wallpaper_clear_file failed", err),
      );
    }
  },

  setOverlay: (overlay) => {
    set({ overlay });
    persist({ ...get(), overlay });
  },

  setOverlayIntensity: (value) => {
    const v = clamp01(value);
    set({ overlayIntensity: v });
    persist({ ...get(), overlayIntensity: v });
  },
}));

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_OVERLAY;
  return Math.max(0, Math.min(1, n));
}
