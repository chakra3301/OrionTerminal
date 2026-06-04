import { create } from "zustand";
import type { SelectionContext } from "@/store/focusStore";

type InlineEditState = {
  visible: boolean;
  prompt: string;
  streaming: boolean;
  error: string | null;
  streamId: string | null;
  ctx: SelectionContext | null;
  streamedReplacement: string;

  show: (ctx: SelectionContext) => void;
  setPrompt: (p: string) => void;
  startStream: (streamId: string) => void;
  appendDelta: (text: string) => void;
  finishStream: () => void;
  setError: (msg: string | null) => void;
  reset: () => void;
};

export const useInlineEditStore = create<InlineEditState>((set) => ({
  visible: false,
  prompt: "",
  streaming: false,
  error: null,
  streamId: null,
  ctx: null,
  streamedReplacement: "",

  show: (ctx) =>
    set({
      visible: true,
      prompt: "",
      streaming: false,
      error: null,
      streamId: null,
      ctx,
      streamedReplacement: "",
    }),
  setPrompt: (p) => set({ prompt: p }),
  startStream: (streamId) =>
    set({ streaming: true, error: null, streamId, streamedReplacement: "" }),
  appendDelta: (text) =>
    set((s) => ({ streamedReplacement: s.streamedReplacement + text })),
  finishStream: () => set({ streaming: false, streamId: null }),
  setError: (msg) => set({ error: msg, streaming: false, streamId: null }),
  reset: () =>
    set({
      visible: false,
      prompt: "",
      streaming: false,
      error: null,
      streamId: null,
      ctx: null,
      streamedReplacement: "",
    }),
}));
