import { ipc } from "@/lib/ipc";
import { resolveSendFromStores } from "@/features/agents/resolveSend";
import type { Provider } from "@/features/agents/agentTypes";
import { useProvidersStore } from "@/store/providersStore";
import { mapToRuntimeTools } from "@/features/agents/runtimeTools";

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
};

export async function dispatchSend(args: DispatchSendArgs): Promise<void> {
  const r = resolveSendFromStores(args.value);
  const providers = useProvidersStore.getState().providers;
  const route = routeFor(providers, r.model);
  if (route === "claude") {
    return ipc.claudeSend(
      args.chatId,
      args.prompt,
      args.projectRoot ?? null,
      args.sessionId ?? null,
      args.imagePath ?? null,
      r.model,
      r.systemAppend,
      r.allowedTools,
    );
  }
  if (typeof route === "object" && "engine" in route) {
    return ipc.cliSend(
      route.engine,
      args.chatId,
      args.prompt,
      args.projectRoot ?? null,
      args.sessionId ?? null,
      r.model,
      r.systemAppend ?? "",
    );
  }
  return ipc.runtimeSend(
    args.chatId,
    route.kind,
    route.baseUrl,
    route.keyRef,
    r.model,
    r.systemAppend ?? "",
    args.history,
    mapToRuntimeTools(r.allowedTools),
  );
}

export async function dispatchCancel(chatId: string, value: string): Promise<void> {
  const r = resolveSendFromStores(value);
  const providers = useProvidersStore.getState().providers;
  const route = routeFor(providers, r.model);
  if (route === "claude") return ipc.claudeCancel(chatId);
  if (typeof route === "object" && "engine" in route) return ipc.cliCancel(chatId);
  return ipc.runtimeCancel(chatId);
}
