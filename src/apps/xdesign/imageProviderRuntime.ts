import type { Provider } from "@/features/agents/agentTypes";
import { ipc } from "@/lib/ipc";
import { pickImageProvider } from "./imageGen";

const STATUS_TTL_MS = 15_000;
let cached: { ready: boolean; expiresAt: number } | null = null;
let loading: Promise<boolean> | null = null;
let generation = 0;

export async function codexSubscriptionImageReady(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && cached && cached.expiresAt > now) return cached.ready;
  if (!force && loading) return loading;
  const started = generation;
  const request = ipc.cliStatus("codex_cli")
    .then((status) => {
      const ready = status.imageReady === true && status.authMode === "chatgpt";
      if (started !== generation) return false;
      cached = { ready, expiresAt: Date.now() + STATUS_TTL_MS };
      return ready;
    })
    .catch(() => {
      if (started === generation) cached = { ready: false, expiresAt: Date.now() + STATUS_TTL_MS };
      return false;
    })
    .finally(() => {
      if (loading === request) loading = null;
    });
  loading = request;
  return request;
}

export async function resolveImageProvider(providers: Provider[]): Promise<Provider | null> {
  const codexConfigured = providers.some(
    (provider) => provider.enabled && provider.kind === "codex_cli",
  );
  const codexReady = codexConfigured
    ? await codexSubscriptionImageReady()
    : false;
  return pickImageProvider(providers, codexReady);
}

export function invalidateCodexImageStatus(): void {
  generation++;
  cached = null;
  loading = null;
}
