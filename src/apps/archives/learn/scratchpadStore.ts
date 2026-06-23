// Persistent state for the Learn scratchpad widget. Notes are kept per-topic
// and the widget's open/collapsed/position survive across sessions via app_state.
import { create } from "zustand";
import { getAppState, setAppState } from "@/lib/db";

type Persisted = {
  notes: Record<string, string>; // topicId -> text
  open: boolean;
  collapsed: boolean;
  pos: { x: number; y: number } | null; // null = default anchor (top-right)
};

type ScratchpadState = Persisted & {
  loaded: boolean;
  load: () => Promise<void>;
  setNote: (topicId: string, text: string) => void;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setPos: (pos: { x: number; y: number }) => void;
};

const KEY = "learn_scratchpad";
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(get: () => ScratchpadState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = get();
    void setAppState<Persisted>(KEY, { notes: s.notes, open: s.open, collapsed: s.collapsed, pos: s.pos });
  }, 400);
}

export const useScratchpad = create<ScratchpadState>((set, get) => ({
  notes: {},
  open: false,
  collapsed: false,
  pos: null,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const saved = await getAppState<Persisted>(KEY);
    set({
      notes: saved?.notes ?? {},
      open: saved?.open ?? false,
      collapsed: saved?.collapsed ?? false,
      pos: saved?.pos ?? null,
      loaded: true,
    });
  },

  setNote: (topicId, text) => {
    set((s) => ({ notes: { ...s.notes, [topicId]: text } }));
    persist(get);
  },
  setOpen: (open) => { set({ open }); persist(get); },
  toggleOpen: () => { set((s) => ({ open: !s.open })); persist(get); },
  setCollapsed: (collapsed) => { set({ collapsed }); persist(get); },
  setPos: (pos) => { set({ pos }); persist(get); },
}));
