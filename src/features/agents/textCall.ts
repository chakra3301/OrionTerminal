import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AssistantTextAccumulator, type AssistantTextEvent } from "./assistantText";
export { assistantTextFromEvent, mergeAssistantText } from "./assistantText";
import { ulid } from "ulid";
import { dispatchResolved, forgetDispatch, routeFor, type Route } from "@/features/agents/dispatchSend";
import { ipc } from "@/lib/ipc";
import { useProvidersStore } from "@/store/providersStore";
import { resolveSendFromStores } from "@/features/agents/resolveSend";
import { owningProvider, parseModelValue } from "@/features/agents/modelSelection";
import { providerSessionIdentity } from "./dispatchSend";
import { useModelPrefs, type ModelSurface } from "@/store/modelPrefsStore";
import { ANALYSIS_SYSTEM_PROMPT } from "@/features/repoAnalysis/sourceText";

const TIMEOUT_MS = 180_000;
const SYSTEM = ANALYSIS_SYSTEM_PROMPT;

type ModelEvent = {
  chatId: string;
  event: AssistantTextEvent & {
    text?: string;
    is_error?: boolean;
    errors?: string[];
  };
};

type ExitEvent = {
  chatId: string;
  code: number | null;
  error: string | null;
};

async function cancelRoute(route: Route, chatId: string): Promise<void> {
  if (route === "claude") { await ipc.claudeCancel(chatId); return; }
  if ("engine" in route) {
    await ipc.cliCancel(chatId);
  } else if (route.kind === "cursor_sdk") {
    await ipc.cursorCancel(chatId);
  } else {
    await ipc.runtimeCancel(chatId);
  }
}

export type AnalysisOptions = { signal?: AbortSignal; imagePath?: string; beforeSend?: () => void; responseByteLimit?: number; reviewedProviderIdentity?: string };

async function runStreamedModel(prompt: string, model: string, route: Route, options: AnalysisOptions = {}): Promise<string> {
  const chatId = `text-${ulid()}`;
  if (options.signal?.aborted) throw new Error("Analysis cancelled.");
  let output = "";
  const textStream = new AssistantTextAccumulator();
  let stderr = "";
  let resultError = "";
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unEvent: UnlistenFn | null = null;
  let unExit: UnlistenFn | null = null;
  let resolveResult!: (value: string) => void;
  let rejectResult!: (reason: Error) => void;

  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const cleanup = () => {
    forgetDispatch(chatId);
    if (timer) clearTimeout(timer);
    unEvent?.();
    unExit?.();
    options.signal?.removeEventListener("abort", abort);
  };
  const finish = (error?: string, cancel = false) => {
    if (settled) return;
    settled = true;
    if (cancel) void cancelRoute(route, chatId).catch(() => undefined);
    cleanup();
    if (error) rejectResult(new Error(error));
    else if (output.trim()) resolveResult(output.trim());
    else rejectResult(new Error(stderr.trim() || "The selected model returned no text."));
  };

  const abort = () => finish("Analysis cancelled.", true);
  options.signal?.addEventListener("abort", abort, { once: true });
  timer = setTimeout(() => finish("Model timed out after 180s — try again or choose a faster model.", true), TIMEOUT_MS);

  void (async () => {
  const projectRoot = await ipc.analysisWorkDir();
  if (settled) return;
  const eventListener = await listen<ModelEvent>("claude:event", ({ payload }) => {
    if (settled || payload.chatId !== chatId) return;
    try { output = textStream.accept(payload.event) ?? output; }
    catch (error) { finish(String(error), true); return; }
    if (options.responseByteLimit ? new TextEncoder().encode(output).length > options.responseByteLimit : output.length > 128_000) { finish("Analysis exceeded the response limit.", true); return; }
    if (payload.event.type === "stderr" && payload.event.text) {
      stderr = `${stderr}\n${payload.event.text}`.trim().slice(-4096);
    }
    if (payload.event.type === "result" && payload.event.is_error) {
      resultError = payload.event.errors?.join("\n") || "The selected model failed.";
    }
  });
  if (settled) { eventListener(); return; }
  unEvent = eventListener;
  const exitListener = await listen<ExitEvent>("claude:exit", ({ payload }) => {
      if (payload.chatId !== chatId) return;
      finish(payload.error || resultError || (payload.code !== null && payload.code !== 0 ? `The selected model exited with code ${payload.code}.` : undefined));
    });
  if (settled) { exitListener(); return; }
  unExit = exitListener;

  await dispatchResolved(
    chatId,
    { model, actionModel: null, systemAppend: SYSTEM, allowedTools: [] },
    prompt,
    [{ role: "user", content: prompt }],
    { projectRoot, imagePath: options.imagePath, ...(options.beforeSend ? { onReady: options.beforeSend } : {}), ...(options.reviewedProviderIdentity === undefined ? {} : { reviewedProviderIdentity: options.reviewedProviderIdentity }) },
  );
  })().catch((error) => finish(error instanceof Error ? error.message : String(error)));

  return result;
}

export async function runExplicitModelAnalysis(prompt: string, model: string, expectedProvider: string, options: Pick<AnalysisOptions, "signal" | "beforeSend"> = {}): Promise<string> {
  const check = () => {
    if (options.signal?.aborted) throw new Error("Analysis cancelled.");
    if (!parseModelValue(model).providerId || model.startsWith("agent:")) throw new Error("Choose an explicit provider-qualified model, not an agent.");
    const owner = owningProvider(useProvidersStore.getState().providers, model);
    if (!owner || providerSessionIdentity(owner) !== expectedProvider) throw new Error("Analysis provider changed or is unavailable. Review the upload again.");
    options.beforeSend?.();
  };
  check();
  return runStreamedModel(prompt, model, routeFor(useProvidersStore.getState().providers, model), { ...options, beforeSend: check, responseByteLimit: 32_768, reviewedProviderIdentity: expectedProvider });
}

export async function runSurfaceAnalysis(prompt: string, surface: ModelSurface, options: AnalysisOptions = {}): Promise<string> {
  const resolved = resolveSendFromStores(useModelPrefs.getState().modelFor(surface));
  const route = routeFor(useProvidersStore.getState().providers, resolved.model);
  const fullPrompt = resolved.systemAppend ? `${resolved.systemAppend}\n\n${prompt}` : prompt;
  return runStreamedModel(fullPrompt, resolved.model, route, options);
}

export async function runTextModel(prompt: string, model: string): Promise<string> {
  const providers = useProvidersStore.getState().providers;
  const resolved = resolveSendFromStores(model);
  const route = routeFor(providers, resolved.model);
  const fullPrompt = resolved.systemAppend ? `${resolved.systemAppend}\n\n${prompt}` : prompt;
  if (route === "claude") {
    const reply = await ipc.repolensClaudeCall(fullPrompt, parseModelValue(resolved.model).modelId);
    return reply.result;
  }
  return runStreamedModel(fullPrompt, resolved.model, route);
}
