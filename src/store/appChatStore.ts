import { create } from "zustand";
import { ulid } from "ulid";

export type AppChatId = "archives" | "orion" | "xdesign" | "hermes" | "command";

export type AppChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
};

export type AppChatThread = {
  threadId: string;
  title: string;
  messages: AppChatMessage[];
  running: boolean;
  /** Id of the in-flight assistant message — tokens stream into this id. */
  pendingAssistantId: string | null;
  /**
   * For the Messages-API transport: per-turn streamId currently registered
   * with the Rust side. Unused by the CLI transport (which keys events on
   * the stable threadId).
   */
  activeStreamId: string | null;
  /**
   * CLI subscription transport only — the session id returned by the CLI's
   * `system / init` event. Passed back to `claude_send` on the next turn
   * for conversation resumption.
   */
  sessionId: string | null;
  totalCostUsd: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

type AppChatState = {
  threads: Record<AppChatId, AppChatThread>;
  appendUser: (app: AppChatId, content: string) => void;
  beginAssistant: (app: AppChatId, streamId: string) => string;
  /** Messages-API transport: append a single delta to the pending message. */
  appendDelta: (app: AppChatId, text: string) => void;
  /** CLI transport: replace the pending message's content with the full snapshot. */
  setAssistantContent: (app: AppChatId, content: string) => void;
  setSessionId: (app: AppChatId, sessionId: string) => void;
  finishAssistant: (app: AppChatId, totalCostUsd: number | null) => void;
  setError: (app: AppChatId, message: string) => void;
  setRunning: (app: AppChatId, running: boolean) => void;
  newThread: (app: AppChatId) => void;
  /** Hydrate a thread from a persisted ChatRow when the user resumes one. */
  restoreThread: (app: AppChatId, thread: AppChatThread) => void;
};

function makeThread(): AppChatThread {
  const now = Date.now();
  return {
    threadId: ulid(),
    title: "",
    messages: [],
    running: false,
    pendingAssistantId: null,
    activeStreamId: null,
    sessionId: null,
    totalCostUsd: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const useAppChat = create<AppChatState>((set) => ({
  threads: {
    archives: makeThread(),
    orion: makeThread(),
    xdesign: makeThread(),
    // Hermes has no chat rail (ROSIE orchestrates it via MCP tools), but the
    // The built-in rail thread map includes it as an inert entry.
    hermes: makeThread(),
    // Command Center routes chat through cc_messages, not this rail; inert.
    command: makeThread(),
  },

  appendUser: (app, content) =>
    set((s) => {
      const t = s.threads[app];
      const msg: AppChatMessage = {
        id: ulid(),
        role: "user",
        content,
      };
      const isFirst = t.messages.length === 0;
      return {
        threads: {
          ...s.threads,
          [app]: {
            ...t,
            messages: [...t.messages, msg],
            error: null,
            title: isFirst && !t.title ? content.slice(0, 80) : t.title,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  beginAssistant: (app, streamId) => {
    const id = ulid();
    set((s) => {
      const t = s.threads[app];
      const msg: AppChatMessage = {
        id,
        role: "assistant",
        content: "",
        pending: true,
      };
      return {
        threads: {
          ...s.threads,
          [app]: {
            ...t,
            messages: [...t.messages, msg],
            pendingAssistantId: id,
            activeStreamId: streamId,
            running: true,
          },
        },
      };
    });
    return id;
  },

  appendDelta: (app, text) =>
    set((s) => {
      const t = s.threads[app];
      const id = t.pendingAssistantId;
      if (!id) return s;
      return {
        threads: {
          ...s.threads,
          [app]: {
            ...t,
            messages: t.messages.map((m) =>
              m.id === id ? { ...m, content: m.content + text } : m,
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setAssistantContent: (app, content) =>
    set((s) => {
      const t = s.threads[app];
      const id = t.pendingAssistantId;
      if (!id) return s;
      return {
        threads: {
          ...s.threads,
          [app]: {
            ...t,
            messages: t.messages.map((m) =>
              m.id === id ? { ...m, content } : m,
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setSessionId: (app, sessionId) =>
    set((s) => ({
      threads: { ...s.threads, [app]: { ...s.threads[app], sessionId } },
    })),

  finishAssistant: (app, totalCostUsd) =>
    set((s) => {
      const t = s.threads[app];
      const id = t.pendingAssistantId;
      return {
        threads: {
          ...s.threads,
          [app]: {
            ...t,
            messages: t.messages.map((m) =>
              m.id === id ? { ...m, pending: false } : m,
            ),
            pendingAssistantId: null,
            activeStreamId: null,
            running: false,
            totalCostUsd:
              typeof totalCostUsd === "number"
                ? t.totalCostUsd + totalCostUsd
                : t.totalCostUsd,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setError: (app, message) =>
    set((s) => {
      const t = s.threads[app];
      const id = t.pendingAssistantId;
      return {
        threads: {
          ...s.threads,
          [app]: {
            ...t,
            messages: id
              ? t.messages.filter((m) => m.id !== id)
              : t.messages,
            pendingAssistantId: null,
            activeStreamId: null,
            running: false,
            error: message,
          },
        },
      };
    }),

  setRunning: (app, running) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [app]: { ...s.threads[app], running },
      },
    })),

  newThread: (app) =>
    set((s) => ({
      threads: { ...s.threads, [app]: makeThread() },
    })),

  restoreThread: (app, thread) =>
    set((s) => ({
      threads: { ...s.threads, [app]: thread },
    })),
}));

/**
 * Map streamId → appId so the event bridge can route incoming `chat:*`
 * events to the right thread without storing the streamId on every event.
 */
const STREAM_TO_APP = new Map<string, AppChatId>();

export function registerStream(streamId: string, app: AppChatId) {
  STREAM_TO_APP.set(streamId, app);
}

export function appForStream(streamId: string): AppChatId | null {
  return STREAM_TO_APP.get(streamId) ?? null;
}

export function forgetStream(streamId: string) {
  STREAM_TO_APP.delete(streamId);
}
