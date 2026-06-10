import { create } from "zustand";
import type { SelectionContext } from "@/store/focusStore";

export type InlineEditMode = "edit" | "ask";

type InlineEditState = {
  visible: boolean;
  prompt: string;
  /** "edit" rewrites the selection in place; "ask" (⌥↵) answers a question
   * about it without touching the buffer. */
  mode: InlineEditMode;
  streaming: boolean;
  /** Stream finished — edit mode enters review, ask mode shows the answer. */
  done: boolean;
  error: string | null;
  streamId: string | null;
  ctx: SelectionContext | null;
  streamedReplacement: string;

  show: (ctx: SelectionContext) => void;
  setPrompt: (p: string) => void;
  startStream: (streamId: string, mode: InlineEditMode) => void;
  appendDelta: (text: string) => void;
  /** Authoritative cleaned text (fence-stripped) replacing the raw deltas. */
  setFinal: (text: string) => void;
  finishStream: () => void;
  setError: (msg: string | null) => void;
  reset: () => void;
};

export const useInlineEditStore = create<InlineEditState>((set) => ({
  visible: false,
  prompt: "",
  mode: "edit",
  streaming: false,
  done: false,
  error: null,
  streamId: null,
  ctx: null,
  streamedReplacement: "",

  show: (ctx) =>
    set({
      visible: true,
      prompt: "",
      mode: "edit",
      streaming: false,
      done: false,
      error: null,
      streamId: null,
      ctx,
      streamedReplacement: "",
    }),
  setPrompt: (p) => set({ prompt: p }),
  startStream: (streamId, mode) =>
    set({
      streaming: true,
      done: false,
      error: null,
      streamId,
      mode,
      streamedReplacement: "",
    }),
  appendDelta: (text) =>
    set((s) => ({ streamedReplacement: s.streamedReplacement + text })),
  setFinal: (text) => set({ streamedReplacement: text }),
  finishStream: () => set({ streaming: false, streamId: null, done: true }),
  setError: (msg) => set({ error: msg, streaming: false, streamId: null }),
  reset: () =>
    set({
      visible: false,
      prompt: "",
      mode: "edit",
      streaming: false,
      done: false,
      error: null,
      streamId: null,
      ctx: null,
      streamedReplacement: "",
    }),
}));
