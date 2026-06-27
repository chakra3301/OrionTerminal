import { create } from "zustand";

export type CpSection = "providers" | "agents" | "skills" | "app-orion" | "app-archives" | "app-xdesign" | "account" | "key" | "theme" | "wallpaper" | "mcp" | "shortcuts" | "about";

type CpState = {
  open: boolean;
  section: CpSection;
  show: (section?: CpSection) => void;
  hide: () => void;
  setSection: (s: CpSection) => void;
};

export const useControlPanel = create<CpState>((set) => ({
  open: false,
  section: "providers",
  show: (section) => set((s) => ({ open: true, section: section ?? s.section })),
  hide: () => set({ open: false }),
  setSection: (section) => set({ section }),
}));
