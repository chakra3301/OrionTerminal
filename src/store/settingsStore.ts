import { create } from "zustand";

type SettingsState = {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));
