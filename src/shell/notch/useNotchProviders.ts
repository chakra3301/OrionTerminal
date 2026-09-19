import { useEffect, useState } from "react";
import type { Provider } from "@/features/agents/agentTypes";
import { ipc } from "@/lib/ipc";

export const connectionIdentity = (p: Provider) => JSON.stringify([p.id, p.kind, p.baseUrl, p.keyRef]);
const pending = new Map<string, Promise<boolean>>();

export async function providerConnected(p: Provider): Promise<boolean> {
  if (!p.enabled) return false;
  switch (p.kind) {
    case "anthropic": return (await ipc.claudeStatus()).loggedIn;
    case "codex_cli": return (await ipc.cliStatus("codex_cli")).subscriptionReady;
    case "gemini_cli": return (await ipc.cliStatus("gemini_cli")).loggedIn;
    case "cursor_sdk": return (await ipc.cursorStatus()).ready;
    case "nous_oauth": return !!p.keyRef && await ipc.nousOauthStatus(p.keyRef);
    case "openai_compat":
    case "custom":
      if (!p.keyRef.trim()) return !!p.baseUrl.trim();
      return ipc.providerKeyStatus(p.keyRef);
    default: return !!p.keyRef.trim() && await ipc.providerKeyStatus(p.keyRef);
  }
}

export function useNotchProviders(providers: Provider[], expanded: boolean): Provider[] {
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pulling = false;
    const refresh = async () => {
      if (!alive || document.hidden || pulling) return;
      pulling = true;
      const rows = await Promise.all(providers.filter(p => p.enabled).map(async p => {
        const identity = connectionIdentity(p);
        let request = pending.get(identity);
        if (!request) {
          request = providerConnected(p).catch(() => false);
          pending.set(identity, request);
          void request.finally(() => { if (pending.get(identity) === request) pending.delete(identity); });
        }
        return [identity, await request] as const;
      }));
      pulling = false;
      if (!alive) return;
      setConnected(Object.fromEntries(rows));
      if (expanded && !document.hidden) timer = setTimeout(() => void refresh(), 60_000);
    };
    void refresh();
    const visibility = () => { clearTimeout(timer); if (expanded && !document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [providers, expanded]);
  // A disconnected/removed provider vanishes synchronously, even if its last
  // status probe is still in flight. Idle connected providers stay visible.
  return providers.filter(p => p.enabled && connected[connectionIdentity(p)] === true);
}
