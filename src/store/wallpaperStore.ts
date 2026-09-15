import { create } from "zustand";
import { setAppState } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { serialQueue } from "@/lib/serialQueue";
import { toast } from "@/store/toastStore";

export type WallpaperMode = "default" | "custom";
// Extend this union (and OVERLAY_KINDS below) to add new overlays.
export type OverlayKind = "none" | "matrix" | "core";
export const STOCK_WALLPAPER_URL = "/wallpapers/stock.png";

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
export const OVERLAY_KINDS: OverlayKind[] = ["none", "matrix", "core"];

const writeInOrder = serialQueue();
function persist(state: WallpaperState) {
  return writeInOrder(() => setAppState("wallpaper", state));
}
function persistPreference(state: WallpaperState) {
  void persist(state).catch((error) => {
    log.warn("wallpaper preference save failed", error);
    toast.error("Wallpaper setting wasn't saved", { body: "Your choice is visible now, but may not survive a restart. Please retry.", dedupeKey: "wallpaper-save" });
  });
}

export const useWallpaperStore = create<WallpaperStore>((set, get) => ({
  mode: "default",
  customPath: null,
  originalName: null,
  overlay: "none",
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
    await persist(next);
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
    await persist(next);
    if (previous) {
      ipc.wallpaperClearFile(previous).catch((err) =>
        log.warn("wallpaper_clear_file failed", err),
      );
    }
  },

  setOverlay: (overlay) => {
    if (!OVERLAY_KINDS.includes(overlay)) return;
    set({ overlay });
    persistPreference({ ...get(), overlay });
  },

  setOverlayIntensity: (value) => {
    const v = clamp01(value);
    set({ overlayIntensity: v });
    persistPreference({ ...get(), overlayIntensity: v });
  },

  setMatrixHue: (value) => {
    const v = clampHue(value);
    set({ matrixHue: v });
    persistPreference({ ...get(), matrixHue: v });
  },

  setCoreHue: (value) => {
    const v = clampHue(value);
    set({ coreHue: v });
    persistPreference({ ...get(), coreHue: v });
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
