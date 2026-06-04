import { create } from "zustand";

type StatusState = {
  hint: string | null;
  setHint: (text: string, durationMs?: number) => void;
  clear: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

export const useStatusStore = create<StatusState>((set) => ({
  hint: null,
  setHint: (text, durationMs = 2000) => {
    if (timer) clearTimeout(timer);
    set({ hint: text });
    timer = setTimeout(() => set({ hint: null }), durationMs);
  },
  clear: () => {
    if (timer) clearTimeout(timer);
    set({ hint: null });
  },
}));
