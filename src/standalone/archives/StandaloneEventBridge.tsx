/**
 * Native events for the standalone app: assistant streams, RepoLens website
 * progress, and the UI-action bridge the assistant's note tools use to open
 * what they created. Orion-only events (editor, XDesign, Hermes, Spotify,
 * terminal) are never listened for.
 */
import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { observeProviderUsage } from "@/store/providerUsageStore";
import { internalActionRegistry } from "@/plugins/internalActionRegistry";
import { internalEventRegistry } from "@/plugins/internalEventRegistry";
import { uiActionGuard, type UiActionLifetime } from "@/features/agents/uiActionRuns";
import { forgetDispatch, recordDispatchedSession } from "@/features/agents/dispatchSend";
import {
  createToolResultTracker,
  handleAppChatClaudeEvent,
  handleAppChatClaudeExit,
  handleAppChatDelta,
  handleAppChatDone,
  handleAppChatError,
  type ClaudeEnvelope,
  type ClaudeExit,
} from "@/app/appChatEvents";

type UiActionEnvelope = { kind: string; payload: unknown; requestId: string } & UiActionLifetime;

/** Only Archives' own actions are honoured; everything else is refused. */
export async function handleStandaloneUiAction(action: { kind: string; payload: unknown } & UiActionLifetime): Promise<unknown> {
  const assertActive = uiActionGuard(action);
  assertActive();
  const result = await internalActionRegistry.dispatch(action.kind, action.payload, assertActive);
  if (result.handled) return result.value;
  if (action.kind === "open_app") return; // Archives is already the whole window.
  throw new Error(`Not available in Archives 47: ${action.kind}`);
}

const tools = createToolResultTracker();

export function handleStandaloneClaudeEvent(env: ClaudeEnvelope): void {
  observeProviderUsage(env.event);
  if (env.event.type === "system" && env.event.subtype === "init" && typeof env.event.session_id === "string") {
    recordDispatchedSession(env.chatId, env.event.session_id);
  }
  const { finished } = tools.observe(env);
  for (const toolName of finished) internalEventRegistry.dispatch("claude:tool-result", { toolName });
  if (env.event.type === "result") tools.forgetChat(env.chatId);
  if (!handleAppChatClaudeEvent(env)) internalEventRegistry.dispatch("archives.claude.event", env);
}

export function StandaloneEventBridge() {
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    const keep = (p: Promise<UnlistenFn>) => void p.then((u) => unlisteners.push(u));

    keep(listen<ClaudeEnvelope>("claude:event", (e) => handleStandaloneClaudeEvent(e.payload)));
    keep(listen<ClaudeExit>("claude:exit", (e) => {
      forgetDispatch(e.payload.chatId);
      tools.forgetChat(e.payload.chatId);
      handleAppChatClaudeExit(e.payload);
    }));
    keep(listen<{ chatId: string; text: string }>("chat:delta", (e) => handleAppChatDelta(e.payload)));
    keep(listen<{ chatId: string; totalCostUsd: number | null }>("chat:done", (e) => handleAppChatDone(e.payload)));
    keep(listen<{ chatId: string; message: string }>("chat:error", (e) => handleAppChatError(e.payload)));
    keep(listen<unknown>("repolens:website", (e) => internalEventRegistry.dispatch("repolens:website", e.payload)));
    keep(listen<UiActionEnvelope>("ui:action", (e) => {
      const { requestId } = e.payload;
      handleStandaloneUiAction(e.payload)
        .then((data) => void ipc.uiBridgeRespond(requestId, true, data ?? null, null))
        .catch((err) => {
          log.warn("ui:action handler failed", err);
          void ipc.uiBridgeRespond(requestId, false, null, err instanceof Error ? err.message : String(err));
        });
    }));

    return () => unlisteners.forEach((u) => u());
  }, []);
  return null;
}
