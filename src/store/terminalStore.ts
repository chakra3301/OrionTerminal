import { create } from "zustand";
import { setAppState } from "@/lib/db";

type TerminalState = {
  open: boolean;
  height: number;
  ptyId: string | null;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setHeight: (h: number) => void;
  setPtyId: (id: string | null) => void;
};

export const useTerminalStore = create<TerminalState>((set, get) => ({
  open: false,
  height: 30,
  ptyId: null,
  toggle: () => {
    const next = !get().open;
    set({ open: next });
    void setAppState("terminal_open", next);
  },
  setOpen: (open) => {
    set({ open });
    void setAppState("terminal_open", open);
  },
  setHeight: (h) => {
    set({ height: h });
    void setAppState("terminal_height", h);
  },
  setPtyId: (id) => set({ ptyId: id }),
}));
