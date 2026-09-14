/**
 * Shared transcript feed between `modelAssist.ts` (the chat-turn driver)
 * and `modelAssistTools.ts` (the tool executor). Tool execution now happens
 * OUTSIDE the chat loop's control — the Claude CLI subprocess calls
 * `orion_model_*` MCP tools autonomously via `EventBridge.tsx`'s UI-action
 * bridge — so the executor pushes its own "tool ran" / "render captured"
 * chips here instead of the loop observing tool_use blocks itself. A leaf
 * module both sides can depend on without a cycle.
 */

import { create } from "zustand";

export type AssistItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; label: string; ok: boolean }
  | { kind: "render"; dataUrl: string }
  | { kind: "loop-stop"; reason: string };

type ModelFeedState = {
  items: AssistItem[];
  push: (item: AssistItem) => void;
  clear: () => void;
};

export const useModelFeed = create<ModelFeedState>((set) => ({
  items: [],
  push: (item) => set((s) => ({ items: [...s.items, item] })),
  clear: () => set({ items: [] }),
}));
