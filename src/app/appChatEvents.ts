/**
 * Native chat-stream events (`claude:event`, `claude:exit`, `chat:*`) routed
 * into the per-app chat rails. Shared by Orion Terminal's EventBridge and the
 * standalone Archives 47 app so both stream replies the same way.
 */
import type { ContentBlock } from "@/store/chatStore";
import { useAppChat, appForStream, forgetStream } from "@/store/appChatStore";
import { log } from "@/lib/log";

export type ClaudeEnvelope = {
  chatId: string;
  event: ClaudeEvent;
};

export type ClaudeEvent =
  | { type: "system"; subtype?: string; session_id?: string }
  | { type: "assistant"; message?: { content?: ContentBlock[] } }
  | { type: "user"; message?: { content?: Array<UserContentBlock> } }
  | {
      type: "result";
      total_cost_usd?: number;
      session_id?: string;
      is_error?: boolean;
    }
  | { type: "stderr"; text?: string }
  | { type: string; [k: string]: unknown };

export type UserContentBlock =
  | {
      type: "tool_result";
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    }
  | { type: string; [k: string]: unknown };

export type ClaudeExit = { chatId: string; code: number | null; error: string | null };

export function extractAssistantText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Returns false when the stream doesn't belong to an app chat rail. */
export function handleAppChatClaudeEvent(env: ClaudeEnvelope): boolean {
  const app = appForStream(env.chatId);
  if (!app) return false;
  const ev = env.event;
  const t = ev.type;
  const store = useAppChat.getState();

  if (t === "system") {
    const subtype = (ev as { subtype?: string }).subtype;
    if (subtype === "init") {
      const sid = (ev as { session_id?: string }).session_id;
      if (sid) store.setSessionId(app, sid);
    }
    return true;
  }
  if (t === "assistant") {
    const msg = (ev as { message?: { content?: ContentBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      const text = extractAssistantText(msg.content);
      if (text) store.setAssistantContent(app, text);
    }
    return true;
  }
  if (t === "result") {
    const cost = (ev as { total_cost_usd?: number }).total_cost_usd;
    const isError = (ev as { is_error?: boolean }).is_error;
    const errors = (ev as { errors?: string[] }).errors;
    if (isError && errors?.length) {
      store.setError(app, errors.join("\n"));
    }
    store.finishAssistant(app, typeof cost === "number" ? cost : null);
    forgetStream(env.chatId);
    return true;
  }
  if (t === "stderr") {
    const text = (ev as { text?: string }).text;
    if (text) log.warn("[claude stderr]", text);
    return true;
  }
  return true; // we handled (or ignored) the event for this app
}

/** Returns false when the exit doesn't belong to an app chat rail. */
export function handleAppChatClaudeExit(payload: ClaudeExit): boolean {
  const app = appForStream(payload.chatId);
  if (!app) return false;
  const store = useAppChat.getState();
  if (payload.error) {
    store.setError(app, payload.error);
  } else {
    // Normal exit without a `result` event → still flip running off.
    const t = store.threads[app];
    if (t.running) store.finishAssistant(app, null);
  }
  forgetStream(payload.chatId);
  return true;
}

/** Messages-API chat stream (`chat:delta|done|error`). */
export function handleAppChatDelta(payload: { chatId: string; text: string }): void {
  const app = appForStream(payload.chatId);
  if (!app) return;
  useAppChat.getState().appendDelta(app, payload.text);
}

export function handleAppChatDone(payload: { chatId: string; totalCostUsd: number | null }): void {
  const app = appForStream(payload.chatId);
  if (!app) return;
  useAppChat.getState().finishAssistant(app, payload.totalCostUsd);
  forgetStream(payload.chatId);
}

export function handleAppChatError(payload: { chatId: string; message: string }): void {
  const app = appForStream(payload.chatId);
  if (!app) {
    log.warn("[chat error]", payload.message);
    return;
  }
  useAppChat.getState().setError(app, payload.message);
  forgetStream(payload.chatId);
}

/** tool_use_id → tool name, so a later tool_result knows which tool finished. */
export function createToolResultTracker() {
  const names = new Map<string, { name: string; chatId: string }>();
  return {
    /** Records tool_use blocks; returns the names of tools whose results succeeded. */
    observe(env: ClaudeEnvelope): { started: Array<{ id: string; name: string }>; finished: string[] } {
      const ev = env.event;
      const started: Array<{ id: string; name: string }> = [];
      const finished: string[] = [];
      if (ev.type === "assistant") {
        const msg = (ev as { message?: { content?: ContentBlock[] } }).message;
        for (const block of msg?.content ?? []) {
          if (block.type === "tool_use" && !names.has(block.id)) {
            names.set(block.id, { name: block.name, chatId: env.chatId });
            started.push({ id: block.id, name: block.name });
          }
        }
      } else if (ev.type === "user") {
        const msg = (ev as { message?: { content?: UserContentBlock[] } }).message;
        for (const block of msg?.content ?? []) {
          if (block.type !== "tool_result") continue;
          const tr = block as Extract<UserContentBlock, { type: "tool_result" }>;
          const tracked = names.get(tr.tool_use_id);
          if (tracked && !tr.is_error) finished.push(tracked.name);
          names.delete(tr.tool_use_id);
        }
      }
      return { started, finished };
    },
    forgetChat(chatId: string): void {
      for (const [id, tracked] of names) if (tracked.chatId === chatId) names.delete(id);
    },
  };
}
