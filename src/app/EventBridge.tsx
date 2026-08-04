import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ContentBlock } from "@/store/chatStore";
import {
  useAppChat,
  appForStream,
  forgetStream,
} from "@/store/appChatStore";
import { useShell, type AppId } from "@/shell/store/useShell";
import { ipc } from "@/lib/ipc";
import {
  isOrionEditorTool,
  isOrionHermesWriteTool,
} from "@/lib/orionToolMatch";
import { beginOrionActivity } from "@/apps/orion/runtimeActivity";
import { useHermes, type HermesStatus, type HermesColumn } from "@/store/hermesStore";
import { usePluginManager } from "@/store/pluginManagerStore";
import { BUILTIN_APP_PLUGIN_IDS } from "@/plugins/builtinApps";
import { internalEventRegistry } from "@/plugins/internalEventRegistry";
import { internalActionRegistry } from "@/plugins/internalActionRegistry";
import { appRegistry } from "@/plugins/appRegistry";
import { useSpotify } from "@/store/spotifyStore";
import { log } from "@/lib/log";

/** UI actions the MCP server can request via the local TCP bridge. Each
 * kind maps to a store mutation in the frontend. */
type UiAction =
  | { kind: "open_app"; payload: { app: AppId } }
  | { kind: "switch_project"; payload: { name_or_id: string } }
  | {
      kind: "open_note";
      payload: { id: string; kind?: "note" | "journal" | "project" };
    }
  | { kind: "open_file"; payload: { path: string } }
  | { kind: "run_in_terminal"; payload: { command: string } }
  | {
      kind: "xdesign_add_rect";
      payload: { x: number; y: number; w: number; h: number; fill?: string; radius?: number };
    }
  | {
      kind: "xdesign_add_text";
      payload: { x: number; y: number; text: string; fontSize?: number; fill?: string };
    }
  | {
      kind: "xdesign_add_ellipse";
      payload: { x: number; y: number; w: number; h: number; fill?: string };
    }
  | {
      kind: "xdesign_add_frame";
      payload: { x: number; y: number; w: number; h: number; fill?: string };
    }
  | { kind: "xdesign_get_canvas"; payload: Record<string, never> }
  | { kind: "xdesign_get_selection"; payload: Record<string, never> }
  | { kind: "xdesign_apply"; payload: { ops: unknown[] } }
  | { kind: string; payload: unknown };

/** The bridge wraps every action with a request id so the frontend can reply
 * via `ui_bridge_respond`. */
type UiActionEnvelope = UiAction & { requestId: string };

/** Returns data for read-back (query) kinds; void for fire-and-forget
 * actions. Throwing here surfaces an error back to the calling MCP tool. */
async function handleUiAction(action: UiAction): Promise<unknown> {
  const contributed = await internalActionRegistry.dispatch(action.kind, action.payload);
  if (contributed.handled) return contributed.value;
  if (action.kind === "open_note") throw new Error("Archives plugin is disabled");
  if (["switch_project", "open_file", "run_in_terminal", "staged_edit"].includes(action.kind)) {
    throw new Error("Orion editor plugin is disabled");
  }
  if (action.kind.startsWith("xdesign_")) throw new Error("XDesign plugin is disabled");
  if (action.kind === "open_app") {
    const app = (action.payload as { app?: unknown } | undefined)?.app;
    if (typeof app !== "string" || !["archives", "orion", "xdesign", "command", "hermes"].includes(app)) {
      throw new Error("open_app: invalid app");
    }
    if (!appRegistry.has(app)) throw new Error(`${app} plugin is disabled`);
    useShell.getState().openApp(app as AppId);
    return;
  }
  log.warn("ui:action unknown kind:", action.kind);
}


/** Global map: tool_use_id → tool_name. Populated whenever we observe an
 * assistant tool_use block. Read when the matching user tool_result lands
 * so we know what to invalidate. Module-scope so it survives across
 * EventBridge re-mounts and chatId boundaries. */
const toolUseIdToName = new Map<
  string,
  { name: string; chatId: string; endOrionActivity?: () => void }
>();

function clearToolActivitiesForChat(chatId: string): void {
  for (const [toolUseId, tracked] of toolUseIdToName) {
    if (tracked.chatId !== chatId) continue;
    tracked.endOrionActivity?.();
    toolUseIdToName.delete(toolUseId);
  }
}

let hermesRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleHermesRefresh() {
  if (hermesRefreshTimer) clearTimeout(hermesRefreshTimer);
  // refresh() (not load()) so a live swarm's in-memory state survives ROSIE's
  // board writes landing via her MCP tools.
  hermesRefreshTimer = setTimeout(() => {
    hermesRefreshTimer = null;
    void useHermes.getState().refresh();
  }, 250);
}

type ClaudeEnvelope = {
  chatId: string;
  event: ClaudeEvent;
};

type ClaudeEvent =
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

type UserContentBlock =
  | {
      type: "tool_result";
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    }
  | { type: string; [k: string]: unknown };

function extractAssistantText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function handleAppChatClaudeEvent(env: ClaudeEnvelope): boolean {
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

function trackOrionToolSideEffects(env: ClaudeEnvelope) {
  const ev = env.event;
  if (ev.type === "assistant") {
    const msg = (ev as { message?: { content?: ContentBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && !toolUseIdToName.has(block.id)) {
          toolUseIdToName.set(block.id, {
            name: block.name,
            chatId: env.chatId,
            ...(isOrionEditorTool(block.name) && appRegistry.has("orion")
              ? {
                  endOrionActivity: beginOrionActivity(
                    `ai-tool:${block.id}`,
                    "Wait for the Orion editor tool call to finish before disabling the plugin.",
                  ),
                }
              : {}),
          });
        }
      }
    }
  } else if (ev.type === "user") {
    const msg = (ev as { message?: { content?: UserContentBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type !== "tool_result") continue;
        const tr = block as Extract<UserContentBlock, { type: "tool_result" }>;
        const tracked = toolUseIdToName.get(tr.tool_use_id);
        const name = tracked?.name;
        if (name && !tr.is_error) {
          internalEventRegistry.dispatch("claude:tool-result", { toolName: name });
          if (
            isOrionHermesWriteTool(name) &&
            usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.hermes)
          ) {
            scheduleHermesRefresh();
          }
        }
        tracked?.endOrionActivity?.();
        toolUseIdToName.delete(tr.tool_use_id);
      }
    }
  } else if (ev.type === "result") {
    clearToolActivitiesForChat(env.chatId);
  }
}

function handleClaude(env: ClaudeEnvelope) {
  trackOrionToolSideEffects(env);
  if (handleAppChatClaudeEvent(env)) return;
  internalEventRegistry.dispatch("orion.claude.event", env);
}

export function EventBridge() {
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    listen<unknown>("inline:delta", (e) => {
      internalEventRegistry.dispatch("orion.inline.delta", e.payload);
    }).then((u) => unlisteners.push(u));

    listen<unknown>("inline:final", (e) => {
      internalEventRegistry.dispatch("orion.inline.final", e.payload);
    }).then((u) => unlisteners.push(u));

    listen<unknown>("inline:done", (e) => {
      internalEventRegistry.dispatch("orion.inline.done", e.payload);
    }).then((u) => unlisteners.push(u));

    listen<unknown>("inline:error", (e) => {
      internalEventRegistry.dispatch("orion.inline.error", e.payload);
    }).then((u) => unlisteners.push(u));

    listen<ClaudeEnvelope>("claude:event", (e) => handleClaude(e.payload)).then(
      (u) => unlisteners.push(u),
    );

    // Native events stay kernel-owned; active plugins contribute disposable,
    // schema-validating handlers through the internal event registry.
    listen<unknown>("cc:event", (e) => {
      internalEventRegistry.dispatch("cc:event", e.payload);
    }).then((u) => unlisteners.push(u));

    listen<unknown>("cc:exit", (e) => {
      internalEventRegistry.dispatch("cc:exit", e.payload);
    }).then((u) => unlisteners.push(u));

    // OS-level Spotify media hotkeys (registered in Rust). Single code path:
    // the global shortcut fires here even when Orion is unfocused.
    listen<string>("spotify:hotkey", (e) => {
      const action = e.payload;
      if (action === "playpause" || action === "next" || action === "previous") {
        void useSpotify.getState().control(action);
      }
    }).then((u) => unlisteners.push(u));

    // Hermes swarm — the engine streams each agent's assistant text + status
    // and rolls the task up; mirror it into the store for the live board.
    listen<{ taskId: string; agentId: string; text: string }>(
      "hermes:agent",
      (e) => {
        if (!usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.hermes)) return;
        useHermes
          .getState()
          .applyAgentText(e.payload.taskId, e.payload.agentId, e.payload.text);
      },
    ).then((u) => unlisteners.push(u));

    listen<{
      taskId: string;
      agentId: string;
      status: HermesStatus;
      output: string;
      error: string;
      sessionId: string | null;
    }>("hermes:agentStatus", (e) => {
      if (!usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.hermes)) return;
      useHermes.getState().applyAgentStatus(e.payload);
    }).then((u) => unlisteners.push(u));

    listen<{ taskId: string; status: HermesStatus; columnId: HermesColumn }>(
      "hermes:task",
      (e) => {
        if (!usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.hermes)) return;
        useHermes.getState().applyTask(e.payload);
      },
    ).then((u) => unlisteners.push(u));

    listen<unknown>("repolens:website", (e) => {
      internalEventRegistry.dispatch("repolens:website", e.payload);
    }).then((u) => unlisteners.push(u));

    // UI-action bridge: out-of-process MCP server → main app via TCP →
    // Tauri event → here. Lets agents drive UI-state changes (open_app,
    // switch_project) that can't be done by a direct DB write.
    listen<UiActionEnvelope>("ui:action", (e) => {
      const { requestId } = e.payload;
      // Always reply so the bridge connection never waits out its timeout —
      // {ok:true, data} for queries, {ok:true} for actions, {ok:false} on throw.
      handleUiAction(e.payload)
        .then((data) => {
          void ipc.uiBridgeRespond(requestId, true, data ?? null, null);
        })
        .catch((err) => {
          log.warn("ui:action handler failed", err);
          void ipc.uiBridgeRespond(
            requestId,
            false,
            null,
            err instanceof Error ? err.message : String(err),
          );
        });
    }).then((u) => unlisteners.push(u));

    listen<unknown>("terminal:data", () => {
      internalEventRegistry.dispatch("orion.file.refresh", null);
    }).then((u) => unlisteners.push(u));

    listen<unknown>("fs:changed", () => {
      internalEventRegistry.dispatch("orion.file.refresh", null);
    }).then((u) => unlisteners.push(u));

    listen<{ chatId: string; code: number | null; error: string | null }>(
      "claude:exit",
      (e) => {
        clearToolActivitiesForChat(e.payload.chatId);
        // App-chat (Archives/XDesign over CLI)?
        const app = appForStream(e.payload.chatId);
        if (app) {
          const store = useAppChat.getState();
          if (e.payload.error) {
            store.setError(app, e.payload.error);
          } else {
            // Normal exit without a `result` event → still flip running off.
            const t = store.threads[app];
            if (t.running) store.finishAssistant(app, null);
          }
          forgetStream(e.payload.chatId);
          return;
        }
        internalEventRegistry.dispatch("orion.claude.exit", e.payload);
      },
    ).then((u) => unlisteners.push(u));

    // Messages-API chat stream (Archives + XDesign rails).
    listen<{ chatId: string; text: string }>("chat:delta", (e) => {
      const app = appForStream(e.payload.chatId);
      if (!app) return;
      useAppChat.getState().appendDelta(app, e.payload.text);
    }).then((u) => unlisteners.push(u));

    listen<{ chatId: string; totalCostUsd: number | null }>(
      "chat:done",
      (e) => {
        const app = appForStream(e.payload.chatId);
        if (!app) return;
        useAppChat.getState().finishAssistant(app, e.payload.totalCostUsd);
        forgetStream(e.payload.chatId);
      },
    ).then((u) => unlisteners.push(u));

    listen<{ chatId: string; message: string }>("chat:error", (e) => {
      const app = appForStream(e.payload.chatId);
      if (!app) {
        log.warn("[chat error]", e.payload.message);
        return;
      }
      useAppChat.getState().setError(app, e.payload.message);
      forgetStream(e.payload.chatId);
    }).then((u) => unlisteners.push(u));

    return () => {
      for (const u of unlisteners) u();
    };
  }, []);

  return null;
}
