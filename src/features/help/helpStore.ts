import { create } from "zustand";

type HelpState = {
  open: boolean;
  sectionId: string | null;
  show: (sectionId?: string) => void;
  hide: () => void;
  toggle: () => void;
};

export const useHelp = create<HelpState>((set, get) => ({
  open: false,
  sectionId: null,
  show: (sectionId) =>
    set({ open: true, sectionId: sectionId ?? get().sectionId ?? null }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));
