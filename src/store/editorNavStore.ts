import { create } from "zustand";

export type RevealTarget = {
  path: string;
  line: number;
  column: number;
  /** Bumped on every request so revealing the same spot twice still fires. */
  nonce: number;
};

type EditorNavState = {
  pending: RevealTarget | null;
  /** Ask whichever editor owns `path` to scroll to and focus a position. */
  reveal: (path: string, line: number, column?: number) => void;
  /** An editor for `path` claims the pending reveal (returns it, clears it). */
  consume: (path: string) => RevealTarget | null;
};

export const useEditorNavStore = create<EditorNavState>((set, get) => ({
  pending: null,
  reveal: (path, line, column = 1) =>
    set((s) => ({
      pending: { path, line, column, nonce: (s.pending?.nonce ?? 0) + 1 },
    })),
  consume: (path) => {
    const p = get().pending;
    if (!p || p.path !== path) return null;
    set({ pending: null });
    return p;
  },
}));
