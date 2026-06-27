import { ipc } from "@/lib/ipc";
import { resolveSendFromStores } from "@/features/agents/resolveSend";
import type { ResolvedSend } from "@/features/agents/resolveSend";
import type { Provider } from "@/features/agents/agentTypes";
import { useProvidersStore } from "@/store/providersStore";
import { mapToRuntimeTools } from "@/features/agents/runtimeTools";
import { shouldTwoPass, planningSystem, executionPrompt } from "./twoPass";
import { beginTwoPass, twoPassPhase, clearTwoPass } from "./twoPassCoordinator";

export type RuntimeMsg = { role: "user" | "assistant"; content: string };

export function findOwningProvider(
  providers: Provider[],
  model: string,
): Provider | undefined {
  return providers.find((p) => p.models.some((m) => m.id === model));
}

export type CliEngine = "codex_cli" | "gemini_cli";
export type Route = "claude" | { engine: CliEngine } | Provider;

/** "claude" → unchanged Claude CLI path; `{engine}` → subscription CLI engine
 *  (Phase 2c); otherwise the HTTP-runtime Provider to use. */
export function routeFor(providers: Provider[], model: string): Route {
  const owner = findOwningProvider(providers, model);
  if (!owner || owner.kind === "anthropic") return "claude";
  if (owner.kind === "codex_cli" || owner.kind === "gemini_cli") return { engine: owner.kind };
  return owner;
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

/** Route an already-resolved send to the owning engine. Byte-identical IPC
 *  output to the pre-refactor dispatchSend body. */
export async function dispatchResolved(
  chatId: string,
  r: ResolvedSend,
  prompt: string,
  history: RuntimeMsg[],
  opts: ResolvedDispatchOpts,
): Promise<void> {
  const providers = useProvidersStore.getState().providers;
  const route = routeFor(providers, r.model);
  if (route === "claude") {
    return ipc.claudeSend(
      chatId,
      prompt,
      opts.projectRoot ?? null,
      opts.sessionId ?? null,
      opts.imagePath ?? null,
      r.model,
      r.systemAppend,
      r.allowedTools,
    );
  }
  if (typeof route === "object" && "engine" in route) {
    return ipc.cliSend(
      route.engine,
      chatId,
      prompt,
      opts.projectRoot ?? null,
      opts.sessionId ?? null,
      r.model,
      r.systemAppend ?? "",
    );
  }
  return ipc.runtimeSend(
    chatId,
    route.kind,
    route.baseUrl,
    route.keyRef,
    r.model,
    r.systemAppend ?? "",
    history,
    mapToRuntimeTools(r.allowedTools),
  );
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
      void dispatchResolved(args.chatId, action, prompt, history, opts);
    },
  });

  const brain: ResolvedSend = {
    model: resolved.model,
    actionModel: null,
    systemAppend: planningSystem(resolved.systemAppend),
    allowedTools: [],
  };
  return dispatchResolved(args.chatId, brain, userPrompt, args.history, opts);
}

export async function dispatchCancel(chatId: string, value: string): Promise<void> {
  const phase = twoPassPhase(chatId);
  // A cancel ends the whole two-pass turn — drop the entry so the killed
  // subprocess's exit never triggers the Action pass.
  clearTwoPass(chatId);
  const r = resolveSendFromStores(value);
  const model = phase === "execute" && r.actionModel ? r.actionModel : r.model;
  const providers = useProvidersStore.getState().providers;
  const route = routeFor(providers, model);
  if (route === "claude") return ipc.claudeCancel(chatId);
  if (typeof route === "object" && "engine" in route) return ipc.cliCancel(chatId);
  return ipc.runtimeCancel(chatId);
}
