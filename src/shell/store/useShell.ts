import { create } from "zustand";
import { ulid } from "ulid";

export type AppId = "archives" | "orion" | "xdesign" | "hermes" | "command";

export type WindowState = {
  id: string;
  app: AppId;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  preMaximize?: { x: number; y: number; w: number; h: number };
};

type ShellState = {
  windows: WindowState[];
  focusedWindowId: string | null;
  maxZ: number;
  spotlightOpen: boolean;

  openApp: (app: AppId) => string;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  restoreWindow: (id: string) => void;

  openSpotlight: () => void;
  closeSpotlight: () => void;
  toggleSpotlight: () => void;

  /** Bulk-restore from persisted state. Clamps positions/sizes against the
   * current viewport so a window saved on a larger display doesn't end up
   * partially off-screen. Returns true if anything was restored. */
  restoreWindows: (
    windows: WindowState[],
    focusedWindowId: string | null,
  ) => boolean;
};

const DEFAULT_SIZE: Record<AppId, { w: number; h: number }> = {
  orion:    { w: 1280, h: 800 },
  archives: { w: 1080, h: 720 },
  xdesign:  { w: 1180, h: 760 },
  // Hermes is a dashboard — open large; clamped to the viewport in openApp.
  hermes:   { w: 1760, h: 1080 },
  command:  { w: 1280, h: 820 },
};

function clampY(y: number): number {
  return Math.max(40, y);
}

export const useShell = create<ShellState>((set, get) => ({
  windows: [],
  focusedWindowId: null,
  maxZ: 10,
  spotlightOpen: false,

  openApp: (app) => {
    const existing = get().windows.find((w) => w.app === app);
    if (existing) {
      if (existing.minimized) {
        get().restoreWindow(existing.id);
      } else {
        get().focusWindow(existing.id);
      }
      return existing.id;
    }
    const id = ulid();
    const offset = get().windows.length * 24;
    const size = DEFAULT_SIZE[app];
    // Clamp the default to the viewport so a large default (e.g. the Hermes
    // dashboard) fills a big screen but never overflows a small one.
    const w = Math.min(size.w, window.innerWidth - 48);
    const h = Math.min(size.h, window.innerHeight - 104);
    const x = Math.max(24, Math.round((window.innerWidth - w) / 2) + offset);
    const y = clampY(Math.round((window.innerHeight - h) / 2) + offset);
    const nextZ = get().maxZ + 1;
    const next: WindowState = {
      id,
      app,
      x,
      y,
      w,
      h,
      z: nextZ,
      minimized: false,
      maximized: false,
    };
    set((s) => ({
      windows: [...s.windows, next],
      focusedWindowId: id,
      maxZ: nextZ,
    }));
    return id;
  },

  closeWindow: (id) => {
    set((s) => {
      const next = s.windows.filter((w) => w.id !== id);
      const focused = s.focusedWindowId === id
        ? next.length > 0
          ? next.reduce((a, b) => (b.z > a.z ? b : a)).id
          : null
        : s.focusedWindowId;
      return { windows: next, focusedWindowId: focused };
    });
  },

  minimizeWindow: (id) => {
    set((s) => {
      const next = s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w));
      const focused = s.focusedWindowId === id
        ? next
            .filter((w) => !w.minimized)
            .reduce<WindowState | null>((acc, w) => (acc && acc.z > w.z ? acc : w), null)?.id ?? null
        : s.focusedWindowId;
      return { windows: next, focusedWindowId: focused };
    });
  },

  toggleMaximize: (id) => {
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized && w.preMaximize) {
          return {
            ...w,
            maximized: false,
            x: w.preMaximize.x,
            y: w.preMaximize.y,
            w: w.preMaximize.w,
            h: w.preMaximize.h,
            preMaximize: undefined,
          };
        }
        return {
          ...w,
          maximized: true,
          preMaximize: { x: w.x, y: w.y, w: w.w, h: w.h },
          x: 12,
          y: 44,
          w: window.innerWidth - 24,
          h: window.innerHeight - 44 - 80,
        };
      }),
    }));
  },

  focusWindow: (id) => {
    const cur = get();
    const w = cur.windows.find((x) => x.id === id);
    if (!w) return;
    if (cur.focusedWindowId === id && w.z === cur.maxZ) return;
    const nextZ = cur.maxZ + 1;
    set({
      focusedWindowId: id,
      maxZ: nextZ,
      windows: cur.windows.map((x) => (x.id === id ? { ...x, z: nextZ } : x)),
    });
  },

  moveWindow: (id, x, y) => {
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, x, y: clampY(y) } : w,
      ),
    }));
  },

  resizeWindow: (id, w, h) => {
    set((s) => ({
      windows: s.windows.map((win) => (win.id === id ? { ...win, w, h } : win)),
    }));
  },

  restoreWindow: (id) => {
    const cur = get();
    const nextZ = cur.maxZ + 1;
    set({
      maxZ: nextZ,
      focusedWindowId: id,
      windows: cur.windows.map((w) =>
        w.id === id ? { ...w, minimized: false, z: nextZ } : w,
      ),
    });
  },

  openSpotlight: () => set({ spotlightOpen: true }),
  closeSpotlight: () => set({ spotlightOpen: false }),
  toggleSpotlight: () => set((s) => ({ spotlightOpen: !s.spotlightOpen })),

  restoreWindows: (windows, focusedWindowId) => {
    if (!Array.isArray(windows) || windows.length === 0) return false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MIN_W = 480;
    const MIN_H = 320;
    const MENUBAR_H = 44;
    const DOCK_GUARD = 80;
    let maxZ = 10;
    const clamped: WindowState[] = windows.map((w) => {
      const cw = Math.max(MIN_W, Math.min(w.w, Math.max(MIN_W, vw - 48)));
      const ch = Math.max(MIN_H, Math.min(w.h, Math.max(MIN_H, vh - MENUBAR_H - DOCK_GUARD)));
      const cx = Math.max(12, Math.min(w.x, Math.max(12, vw - cw - 12)));
      const cy = Math.max(
        MENUBAR_H,
        Math.min(w.y, Math.max(MENUBAR_H, vh - ch - DOCK_GUARD)),
      );
      maxZ = Math.max(maxZ, w.z);
      return { ...w, x: cx, y: cy, w: cw, h: ch };
    });
    const valid = focusedWindowId &&
      clamped.some((w) => w.id === focusedWindowId)
      ? focusedWindowId
      : clamped.find((w) => !w.minimized)?.id ?? clamped[0]?.id ?? null;
    set({ windows: clamped, focusedWindowId: valid, maxZ });
    return true;
  },
}));

export function focusedApp(s: ShellState): AppId | null {
  const w = s.windows.find((x) => x.id === s.focusedWindowId);
  return w ? w.app : null;
}

export const APP_NAMES: Record<AppId, string> = {
  archives: "Archives 47",
  orion: "Orion",
  xdesign: "XDesign",
  hermes: "Hermes",
  command: "Command Center",
};
