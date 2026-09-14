import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { dispatchSend, dispatchCancel, forgetDispatch, routeFor, type DispatchSendArgs } from "./dispatchSend";
import { AssistantTextAccumulator, type AssistantTextEvent } from "./assistantText";
import { log } from "@/lib/log";
import { ipc } from "@/lib/ipc";
import { resolveSendFromStores } from "./resolveSend";
import { useProvidersStore } from "@/store/providersStore";

type Event = AssistantTextEvent & {
  is_error?: boolean;
  errors?: string[];
};

export function runAgentTurn(
  args: DispatchSendArgs,
  options: { signal?: AbortSignal; onText?: (text: string) => void; timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    let output = "";
    const textStream = new AssistantTextAccumulator();
    let resultError = "";
    const unlisteners: UnlistenFn[] = [];
    const keep = (u: UnlistenFn) => { if (settled) u(); else unlisteners.push(u); };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      unlisteners.forEach((u) => u());
      forgetDispatch(args.chatId);
      if (error) reject(error);
      else resolve(output);
    };
    const stop = (message: string) => {
      if (started) void dispatchCancel(args.chatId, args.value).catch((e) => log.warn("Agent cancellation failed", e));
      finish(new Error(message));
    };
    const abort = () => stop("Cancelled");
    const timer = setTimeout(() => stop("The selected connector timed out. Progress already applied is kept."), options.timeoutMs ?? 180_000);
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener("abort", abort, { once: true });

    const events = listen<{ chatId: string; event: Event }>("claude:event", ({ payload }) => {
      if (settled || payload.chatId !== args.chatId) return;
      try {
        const text = textStream.accept(payload.event);
        if (text !== null) {
          output = text;
          options.onText?.(output);
        }
      } catch (error) { stop(String(error)); return; }
      if (payload.event.type === "result" && payload.event.is_error) {
        resultError = payload.event.errors?.join("\n") || "The selected model failed.";
      }
    }).then(keep);
    const exits = listen<{ chatId: string; code: number | null; error: string | null }>("claude:exit", ({ payload }) => {
      if (settled || payload.chatId !== args.chatId) return;
      const error = payload.error || resultError || (payload.code !== null && payload.code !== 0 ? `Connector exited with code ${payload.code}` : "");
      finish(error ? new Error(error) : undefined);
    }).then(keep);
    void Promise.all([events, exits]).then(async () => {
      if (settled) return;
      const route = routeFor(useProvidersStore.getState().providers, resolveSendFromStores(args.value).model);
      const cli = route === "claude" || "engine" in route || route.kind === "cursor_sdk";
      const prompt = cli && !args.sessionId && args.history.length > 1
        ? `${args.history.slice(0, -1).map((m) => `${m.role}: ${m.content}`).join("\n\n")}\n\nuser: ${args.prompt}`
        : args.prompt;
      const projectRoot = args.projectRoot ?? await ipc.analysisWorkDir();
      if (settled) return;
      started = true;
      await dispatchSend({ ...args, prompt, projectRoot });
    }).catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}
