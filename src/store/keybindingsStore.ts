import { create } from "zustand";

type KeybindingsState = {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
};

export const useKeybindingsStore = create<KeybindingsState>((set, get) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));
