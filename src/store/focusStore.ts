import { create } from "zustand";

export type SelectionContext = {
  path: string;
  language: string;
  selectionText: string;
  selStart: number;
  selEnd: number;
  fullContent: string;
  contextBefore: string;
  contextAfter: string;
};

type FocusState = {
  editorFocused: boolean;
  hasSelection: boolean;
  setEditorFocus: (focused: boolean) => void;
  setHasSelection: (has: boolean) => void;
  getSelectionContext: (() => SelectionContext | null) | null;
  setSelectionContextProvider: (
    fn: (() => SelectionContext | null) | null,
  ) => void;
  /** Runs a Monaco action (e.g. "editor.action.formatDocument") on the focused editor. */
  runEditorAction: ((actionId: string) => void) | null;
  setEditorActionRunner: (fn: ((actionId: string) => void) | null) => void;
};

export const useFocusStore = create<FocusState>((set) => ({
  editorFocused: false,
  hasSelection: false,
  setEditorFocus: (focused) => set({ editorFocused: focused }),
  setHasSelection: (has) => set({ hasSelection: has }),
  getSelectionContext: null,
  setSelectionContextProvider: (fn) => set({ getSelectionContext: fn }),
  runEditorAction: null,
  setEditorActionRunner: (fn) => set({ runEditorAction: fn }),
}));
