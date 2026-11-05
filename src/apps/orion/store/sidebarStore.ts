import { create } from "zustand";

export type OrionSidebarView = "explorer" | "search" | "scm";

/** Which view the left sidebar shows, like Cursor's Explorer / Search / Source Control. */
type SidebarState = {
  view: OrionSidebarView;
  /** Bumped to ask the search view to focus its input (⇧⌘F while already open). */
  focusSeq: number;
  setView: (view: OrionSidebarView) => void;
  showSearch: () => void;
};

export const useOrionSidebar = create<SidebarState>((set) => ({
  view: "explorer",
  focusSeq: 0,
  setView: (view) => set({ view }),
  showSearch: () => set((s) => ({ view: "search", focusSeq: s.focusSeq + 1 })),
}));
