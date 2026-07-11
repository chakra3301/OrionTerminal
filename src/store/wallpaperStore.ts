import { create } from "zustand";
import { setAppState } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

export type WallpaperMode = "default" | "custom";
// Extend this union (and OVERLAY_KINDS below) to add new overlays.
export type OverlayKind = "matrix" | "core";

export type WallpaperState = {
  mode: WallpaperMode;
  customPath: string | null;
  originalName: string | null;
  overlay: OverlayKind;
  overlayIntensity: number;
  matrixHue: number;
  coreHue: number;
};

type WallpaperStore = WallpaperState & {
  hydrate: (s: Partial<WallpaperState>) => void;
  setCustomFromPath: (sourcePath: string) => Promise<void>;
  clearCustom: () => Promise<void>;
  setOverlay: (overlay: OverlayKind) => void;
  setOverlayIntensity: (value: number) => void;
  setMatrixHue: (value: number) => void;
  setCoreHue: (value: number) => void;
};

const DEFAULT_OVERLAY = 0.6;
const DEFAULT_HUE = 145;
const DEFAULT_CORE_HUE = 354;
export const OVERLAY_KINDS: OverlayKind[] = ["matrix", "core"];

function persist(state: WallpaperState) {
  void setAppState("wallpaper", state);
}

export const useWallpaperStore = create<WallpaperStore>((set, get) => ({
  mode: "default",
  customPath: null,
  originalName: null,
  overlay: "matrix",
  overlayIntensity: DEFAULT_OVERLAY,
  matrixHue: DEFAULT_HUE,
  coreHue: DEFAULT_CORE_HUE,

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
      matrixHue:
        typeof s.matrixHue === "number"
          ? clampHue(s.matrixHue)
          : prev.matrixHue,
      coreHue:
        typeof s.coreHue === "number" ? clampHue(s.coreHue) : prev.coreHue,
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
    if (!OVERLAY_KINDS.includes(overlay)) return;
    set({ overlay });
    persist({ ...get(), overlay });
  },

  setOverlayIntensity: (value) => {
    const v = clamp01(value);
    set({ overlayIntensity: v });
    persist({ ...get(), overlayIntensity: v });
  },

  setMatrixHue: (value) => {
    const v = clampHue(value);
    set({ matrixHue: v });
    persist({ ...get(), matrixHue: v });
  },

  setCoreHue: (value) => {
    const v = clampHue(value);
    set({ coreHue: v });
    persist({ ...get(), coreHue: v });
  },
}));

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_OVERLAY;
  return Math.max(0, Math.min(1, n));
}

function clampHue(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_HUE;
  return Math.max(0, Math.min(360, Math.round(n)));
}
