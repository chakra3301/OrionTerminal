import { create } from "zustand";
import { ulid } from "ulid";

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  result?: { content: unknown; isError?: boolean };
};
export type ContentBlock = TextBlock | ToolUseBlock;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  blocks: ContentBlock[];
  createdAt: number;
  pending?: boolean;
};

export type Chat = {
  id: string;
  title: string;
  sessionId: string | null;
  projectId: string | null;
  messages: ChatMessage[];
  totalCostUsd: number;
  createdAt: number;
  updatedAt: number;
};

type ChatState = {
  active: Chat | null;
  panelOpen: boolean;
  running: boolean;
  pendingAssistantId: string | null;

  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;

  newChat: (projectId: string | null) => Chat;
  setActive: (chat: Chat | null) => void;

  appendUserMessage: (text: string) => void;
  onAssistantBlocks: (blocks: ContentBlock[]) => void;
  onToolResult: (
    toolUseId: string,
    result: { content: unknown; isError?: boolean },
  ) => void;
  finishTurn: () => void;
  setSessionId: (sid: string) => void;
  addCost: (usd: number) => void;
  setRunning: (running: boolean) => void;
};

function newMessage(
  role: ChatMessage["role"],
  blocks: ContentBlock[] = [],
): ChatMessage {
  return {
    id: ulid(),
    role,
    blocks,
    createdAt: Date.now(),
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  active: null,
  panelOpen: true,
  running: false,
  pendingAssistantId: null,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (open) => set({ panelOpen: open }),

  newChat: (projectId) => {
    const now = Date.now();
    const chat: Chat = {
      id: ulid(),
      title: "New chat",
      sessionId: null,
      projectId,
      messages: [],
      totalCostUsd: 0,
      createdAt: now,
      updatedAt: now,
    };
    set({ active: chat, panelOpen: true, pendingAssistantId: null });
    return chat;
  },

  setActive: (chat) =>
    set({ active: chat, pendingAssistantId: null, running: false }),

  appendUserMessage: (text) =>
    set((s) => {
      if (!s.active) return s;
      const msg = newMessage("user", [{ type: "text", text }]);
      return {
        active: {
          ...s.active,
          messages: [...s.active.messages, msg],
          updatedAt: Date.now(),
          title:
            s.active.messages.length === 0 ? text.slice(0, 60) : s.active.title,
        },
      };
    }),

  onAssistantBlocks: (blocks) => {
    const s = get();
    if (!s.active) return;
    let id = s.pendingAssistantId;
    if (!id) {
      const msg: ChatMessage = { ...newMessage("assistant"), pending: true };
      id = msg.id;
      set({
        pendingAssistantId: id,
        active: {
          ...s.active,
          messages: [...s.active.messages, msg],
          updatedAt: Date.now(),
        },
      });
    }
    const targetId = id;
    set((cur) => {
      if (!cur.active) return cur;
      return {
        active: {
          ...cur.active,
          messages: cur.active.messages.map((m) =>
            m.id === targetId ? { ...m, blocks } : m,
          ),
          updatedAt: Date.now(),
        },
      };
    });
  },

  onToolResult: (toolUseId, result) =>
    set((s) => {
      if (!s.active) return s;
      return {
        active: {
          ...s.active,
          messages: s.active.messages.map((m) => ({
            ...m,
            blocks: m.blocks.map((b) =>
              b.type === "tool_use" && b.id === toolUseId
                ? { ...b, result }
                : b,
            ),
          })),
          updatedAt: Date.now(),
        },
      };
    }),

  finishTurn: () =>
    set((s) => {
      if (!s.active) return s;
      const id = s.pendingAssistantId;
      return {
        pendingAssistantId: null,
        running: false,
        active: {
          ...s.active,
          messages: s.active.messages.map((m) =>
            m.id === id ? { ...m, pending: false } : m,
          ),
          updatedAt: Date.now(),
        },
      };
    }),

  setSessionId: (sid) =>
    set((s) =>
      s.active ? { active: { ...s.active, sessionId: sid } } : s,
    ),

  addCost: (usd) =>
    set((s) =>
      s.active
        ? {
            active: { ...s.active, totalCostUsd: s.active.totalCostUsd + usd },
          }
        : s,
    ),

  setRunning: (running) => set({ running }),
}));
