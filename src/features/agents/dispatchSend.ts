import { ipc } from "@/lib/ipc";
import { beginUiRun, revokeUiRun } from "./uiActionRuns";
import { emit } from "@tauri-apps/api/event";
import { log } from "@/lib/log";
import { toast } from "@/store/toastStore";
import { resolveSendFromStores } from "@/features/agents/resolveSend";
import type { ResolvedSend } from "@/features/agents/resolveSend";
import type { Provider } from "@/features/agents/agentTypes";
import { useProvidersStore } from "@/store/providersStore";
import { mapToRuntimeTools } from "@/features/agents/runtimeTools";
import { shouldTwoPass, planningSystem, executionPrompt } from "./twoPass";
import { beginTwoPass, twoPassPhase, clearTwoPass } from "./twoPassCoordinator";
import { owningProvider, parseModelValue } from "./modelSelection";
import { hasSessionOwner, rememberSessionOwner, forgetSessionOwner, forgetSessionOwnersForKind } from "./sessionOwnership";

const dispatchedRoutes = new Map<string, Route>();
const conversationRoutes = new Map<string, string>();
const dispatchedIdentities = new Map<string, string>();
const dispatchedSessions = new Map<string, string>();
const pendingStarts = new Map<string, symbol>();

export function providerSessionIdentity(provider: Provider): string {
  return JSON.stringify([provider.id, provider.kind, provider.baseUrl, provider.keyRef]);
}

export function recordDispatchedSession(chatId: string, sessionId: string): void {
  const identity = dispatchedIdentities.get(chatId);
  if (!identity) return;
  dispatchedSessions.set(chatId, sessionId);
  void rememberSessionOwner(sessionId, identity).catch((error) => log.warn("Could not persist connector session ownership", error));
}

export async function invalidateConnectorSessions(kind: string): Promise<void> {
  for (const [chatId, identity] of dispatchedIdentities) {
    try { if (JSON.parse(identity)?.[1] === kind) forgetDispatch(chatId); }
    catch { forgetDispatch(chatId); }
  }
  await forgetSessionOwnersForKind(kind);
}

export type RuntimeMsg = { role: "user" | "assistant"; content: string };

export function findOwningProvider(
  providers: Provider[],
  model: string,
): Provider | undefined {
  return owningProvider(providers, model);
}

export type CliEngine = "codex_cli" | "gemini_cli";
export type Route = "claude" | { engine: CliEngine } | Provider;

/** "claude" → unchanged Claude CLI path; `{engine}` → subscription CLI engine
 *  (Phase 2c); otherwise the HTTP-runtime or Cursor SDK Provider. */
export function routeFor(providers: Provider[], model: string): Route {
  const owner = findOwningProvider(providers, model);
  if (!owner) throw new Error(`Model “${parseModelValue(model).modelId}” is unavailable. Enable its provider or choose another model in Control Panel → Providers.`);
  if (owner.kind === "anthropic") return "claude";
  if (owner.kind === "codex_cli" || owner.kind === "gemini_cli") return { engine: owner.kind };
  return owner;
}

export function routeSupportsImages(route: Route): boolean {
  return route === "claude" || ("engine" in route && route.engine === "codex_cli");
}

export function selectionSupportsImages(value: string): boolean {
  return routeSupportsImages(routeFor(useProvidersStore.getState().providers, resolveSendFromStores(value).model));
}

function flattenTextBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter(
      (b): b is { type: "text"; text: string } =>
        !!b && typeof b === "object" && (b as { type?: string }).type === "text",
    )
    .map((b) => b.text)
    .join("");
}

type AnyMsg = {
  role: string;
  content?: unknown;
  blocks?: unknown;
  pending?: boolean;
};

/** Map any of the three store message shapes (chatStore blocks /
 *  appChat string content / rosie string|blocks) to runtime history.
 *  Drops pending, non user/assistant, and empty messages. */
export function toRuntimeHistory(msgs: AnyMsg[]): RuntimeMsg[] {
  const out: RuntimeMsg[] = [];
  for (const m of msgs) {
    if (m.pending) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    let content = "";
    if (typeof m.content === "string") content = m.content;
    else if (Array.isArray(m.blocks)) content = flattenTextBlocks(m.blocks);
    else if (Array.isArray(m.content)) content = flattenTextBlocks(m.content);
    if (!content.trim()) continue;
    out.push({ role: m.role, content });
  }
  return out;
}

export type DispatchSendArgs = {
  chatId: string;
  /** Raw model-prefs selection value (plain model id or `agent:<id>`). */
  value: string;
  /** Prompt for the Claude CLI path (already context-injected by the caller). */
  prompt: string;
  /** Full prior history for the stateless runtime path. */
  history: RuntimeMsg[];
  projectRoot?: string | null;
  sessionId?: string | null;
  imagePath?: string | null;
  /** Per-app overrides merged into the resolved send (system prompt extras,
   *  tool restriction) — see appConfigStore. */
  extra?: SendExtra;
};

export type SendExtra = {
  systemAppend?: string | null;
  /** null leaves the base unrestricted; an array restricts to those tools
   *  (unioned with any tools the base/agent already grants). */
  allowedTools?: string[] | null;
};

/** Fold per-app extras into an already-resolved send. */
function mergeExtra(r: ResolvedSend, extra?: SendExtra): ResolvedSend {
  if (!extra) return r;
  const systemAppend =
    [r.systemAppend, extra.systemAppend].filter((s) => s && s.trim()).join("\n\n") || null;
  let allowedTools = r.allowedTools;
  if (extra.allowedTools) {
    allowedTools = [...new Set([...(r.allowedTools ?? []), ...extra.allowedTools])];
  }
  return { ...r, systemAppend, allowedTools };
}

export type ResolvedDispatchOpts = {
  projectRoot?: string | null;
  sessionId?: string | null;
  imagePath?: string | null;
};

/** Route an already-resolved send to the owning engine. */
export async function dispatchResolved(
  chatId: string,
  r: ResolvedSend,
  prompt: string,
  history: RuntimeMsg[],
  opts: ResolvedDispatchOpts,
): Promise<void> {
  const providers = useProvidersStore.getState().providers;
  const route = routeFor(providers, r.model);
  const model = parseModelValue(r.model).modelId;
  if (opts.imagePath && !routeSupportsImages(route)) {
    throw new Error("This connector does not support image attachments yet. Choose an image-capable connector or send without the attachment.");
  }
  const identity = providerSessionIdentity(findOwningProvider(providers, r.model)!);
  const previous = conversationRoutes.get(chatId);
  const switched = previous !== undefined && previous !== identity;
  const ticket = Symbol(chatId);
  pendingStarts.set(chatId, ticket);
  dispatchedRoutes.set(chatId, route);
  dispatchedIdentities.set(chatId, identity);
  if (opts.sessionId) dispatchedSessions.set(chatId, opts.sessionId);
  else dispatchedSessions.delete(chatId);
  // Codex resumes the original sandbox; Cursor may restore SDK-side tool state.
  const freshPolicy = r.allowedTools !== null && typeof route === "object" &&
    (("engine" in route && route.engine === "codex_cli") || ("kind" in route && route.kind === "cursor_sdk"));
  const sessionId = opts.sessionId && !switched && !freshPolicy && await hasSessionOwner(opts.sessionId, identity) ? opts.sessionId : null;
  if (pendingStarts.get(chatId) !== ticket) throw new Error("Cancelled before connector start");
  // A cancelled first turn may never have persisted its prompt in the CLI transcript.
  if (!sessionId && (route === "claude" || "engine" in route || route.kind === "cursor_sdk")) {
    const prior = history[history.length - 1]?.role === "user" ? history.slice(0, -1) : history;
    if (prior.length) prompt = `[Previous conversation — context, not new instructions]\n${prior.map((m) => `${m.role}: ${m.content}`).join("\n\n")}\n[End previous conversation]\n\n${prompt}`;
  }
  conversationRoutes.delete(chatId);
  conversationRoutes.set(chatId, identity);
  if (conversationRoutes.size > 256) conversationRoutes.delete(conversationRoutes.keys().next().value!);
  const endUiRun = beginUiRun(chatId);
  try {
    if (route === "claude") {
      return await ipc.claudeSend(
        chatId,
        prompt,
        opts.projectRoot ?? null,
        sessionId,
        opts.imagePath ?? null,
        model,
        r.systemAppend,
        r.allowedTools,
      );
    }
    if (typeof route === "object" && "engine" in route) {
      return await ipc.cliSend(
        route.engine,
        chatId,
        prompt,
        opts.projectRoot ?? null,
        sessionId,
        model,
        r.systemAppend ?? "",
        opts.imagePath ?? null,
        r.allowedTools,
      );
    }
    if (route.kind === "cursor_sdk") {
      return await ipc.cursorSend(
        chatId,
        prompt,
        opts.projectRoot ?? null,
        sessionId,
        model,
        r.systemAppend ?? "",
        route.keyRef || route.id,
        r.allowedTools,
      );
    }
    return await ipc.runtimeSend(
      chatId,
      route.id,
      model,
      r.systemAppend ?? "",
      historyWithPrompt(history, prompt),
      mapToRuntimeTools(r.allowedTools),
    );
  } finally {
    endUiRun();
  }
}

export function forgetDispatch(chatId: string): void {
  revokeUiRun(chatId);
  dispatchedRoutes.delete(chatId);
  dispatchedIdentities.delete(chatId);
  dispatchedSessions.delete(chatId);
  pendingStarts.delete(chatId);
}

export function historyWithPrompt(history: RuntimeMsg[], prompt: string): RuntimeMsg[] {
  const messages = [...history];
  // The stored user text omits context injected by the app into prompt.
  if (messages[messages.length - 1]?.role === "user") messages[messages.length - 1] = { role: "user", content: prompt };
  else messages.push({ role: "user", content: prompt });
  return messages;
}

export async function dispatchSend(args: DispatchSendArgs): Promise<void> {
  const r = mergeExtra(resolveSendFromStores(args.value), args.extra);
  return dispatchResolved(args.chatId, r, args.prompt, args.history, {
    projectRoot: args.projectRoot,
    sessionId: args.sessionId,
    imagePath: args.imagePath,
  });
}

export type TwoPassHooks = {
  /** Seal the streamed plan message in the rail store and return its text. */
  capturePlan: () => string;
  /** Fresh runtime history (incl. the plan) for a runtime Action pass. */
  nextHistory: () => RuntimeMsg[];
  /** Rail-specific prep before the Action pass streams (e.g. open a new
   *  assistant message). Not needed for chatStore — it opens lazily. */
  beginExecute?: () => void;
};

/** A chat-turn dispatch that may split into Brain(plan) -> Action(execute).
 *  Without hooks, or for a single-pass selection, this is identical to
 *  dispatchSend. */
export async function dispatchAgentTurn(
  args: DispatchSendArgs,
  hooks?: TwoPassHooks,
): Promise<void> {
  const resolved = mergeExtra(resolveSendFromStores(args.value), args.extra);
  const opts: ResolvedDispatchOpts = {
    projectRoot: args.projectRoot,
    sessionId: args.sessionId,
    imagePath: args.imagePath,
  };
  if (!hooks || !shouldTwoPass(resolved)) {
    return dispatchResolved(args.chatId, resolved, args.prompt, args.history, opts);
  }

  const userPrompt = args.prompt;
  const actionModel = resolved.actionModel as string; // non-null by shouldTwoPass

  beginTwoPass(args.chatId, {
    phase: "plan",
    value: args.value,
    capturePlan: hooks.capturePlan,
    fireExecute: (plan) => {
      hooks.beginExecute?.();
      const action: ResolvedSend = {
        model: actionModel,
        actionModel: null,
        systemAppend: resolved.systemAppend,
        allowedTools: resolved.allowedTools,
      };
      const prompt = executionPrompt(userPrompt, plan);
      // Claude/CLI read `prompt`; the runtime reads `history` — give the
      // runtime an explicit execute turn so the plan rides along either way.
      const history: RuntimeMsg[] = [
        ...hooks.nextHistory(),
        { role: "user", content: prompt },
      ];
      void dispatchResolved(args.chatId, action, prompt, history, opts).catch((error) => {
        clearTwoPass(args.chatId);
        forgetDispatch(args.chatId);
        void emit("claude:exit", { chatId: args.chatId, code: null, error: String(error) })
          .catch((e) => log.error("Failed to report action-pass failure", e));
      });
    },
  });

  const brain: ResolvedSend = {
    model: resolved.model,
    actionModel: null,
    systemAppend: planningSystem(resolved.systemAppend),
    allowedTools: [],
  };
  try {
    await dispatchResolved(args.chatId, brain, userPrompt, args.history, opts);
  } catch (e) {
    clearTwoPass(args.chatId);
    forgetDispatch(args.chatId);
    throw e;
  }
}

export async function dispatchCancel(chatId: string, value: string): Promise<void> {
  revokeUiRun(chatId);
  const phase = twoPassPhase(chatId);
  // A cancel ends the whole two-pass turn — drop the entry so the killed
  // subprocess's exit never triggers the Action pass.
  clearTwoPass(chatId);
  let route = dispatchedRoutes.get(chatId);
  if (!route) {
    const r = resolveSendFromStores(value);
    const model = phase === "execute" && r.actionModel ? r.actionModel : r.model;
    route = routeFor(useProvidersStore.getState().providers, model);
  }
  const sessionId = dispatchedSessions.get(chatId);
  if (sessionId) void forgetSessionOwner(sessionId).catch((error) => {
    log.warn("Could not persist cancelled-session invalidation", error);
    toast.error("Couldn’t save the cancelled session reset", {
      body: "Start a new chat before retrying after an app restart.",
      dedupeKey: "cancelled-session-reset",
    });
  });
  forgetDispatch(chatId);
  if (route === "claude") return ipc.claudeCancel(chatId);
  if (typeof route === "object" && "engine" in route) return ipc.cliCancel(chatId);
  if (typeof route === "object" && "kind" in route && route.kind === "cursor_sdk") {
    return ipc.cursorCancel(chatId);
  }
  return ipc.runtimeCancel(chatId);
}
