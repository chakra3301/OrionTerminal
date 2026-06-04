import { create } from "zustand";
import { setAppState } from "@/lib/db";

type PanelSizes = { sidebar: number; main: number; right: number };

type LayoutState = {
  sidebarOpen: boolean;
  rightOpen: boolean;
  sizes: PanelSizes;
  toggleSidebar: () => void;
  toggleRight: () => void;
  setRightOpen: (open: boolean) => void;
  setSizes: (sizes: PanelSizes) => void;
  hydrate: (s: Partial<{ sidebarOpen: boolean; rightOpen: boolean; sizes: PanelSizes }>) => void;
};

const DEFAULT_SIZES: PanelSizes = { sidebar: 18, main: 60, right: 22 };

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(sizes: PanelSizes) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void setAppState("panel_sizes", sizes);
  }, 400);
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarOpen: true,
  rightOpen: true,
  sizes: DEFAULT_SIZES,
  toggleSidebar: () => {
    const next = !get().sidebarOpen;
    set({ sidebarOpen: next });
    void setAppState("sidebar_open", next);
  },
  toggleRight: () => {
    const next = !get().rightOpen;
    set({ rightOpen: next });
    void setAppState("right_rail_open", next);
  },
  setRightOpen: (open) => {
    set({ rightOpen: open });
    void setAppState("right_rail_open", open);
  },
  setSizes: (sizes) => {
    set({ sizes });
    schedulePersist(sizes);
  },
  hydrate: (s) => set((prev) => ({ ...prev, ...s })),
}));
