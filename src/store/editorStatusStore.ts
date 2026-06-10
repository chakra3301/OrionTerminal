import { create } from "zustand";

export type EditorStatus = {
  line: number;
  column: number;
  selectionChars: number;
  selectionLines: number;
  language: string | null;
  indentKind: "spaces" | "tabs" | null;
  indentSize: number;
};

const EMPTY: EditorStatus = {
  line: 0,
  column: 0,
  selectionChars: 0,
  selectionLines: 0,
  language: null,
  indentKind: null,
  indentSize: 2,
};

type EditorStatusState = EditorStatus & {
  set: (s: EditorStatus) => void;
  clear: () => void;
};

export const useEditorStatusStore = create<EditorStatusState>((set) => ({
  ...EMPTY,
  set: (s) => set(s),
  clear: () => set(EMPTY),
}));
