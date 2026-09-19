import { useEffect, useRef, useState } from "react";
import { ipc, type SubscriptionQuota } from "@/lib/ipc";
import type { Provider } from "@/features/agents/agentTypes";
import { connectionIdentity } from "./useNotchProviders";

export type QuotaReading = { value: SubscriptionQuota | null; loading: boolean; error: string | null };
const pending = new Map<string, Promise<SubscriptionQuota>>();
export function useSubscriptionQuotas(providers: Provider[], expanded: boolean) {
  const eligible = providers.filter(p => p.enabled && (p.kind === "anthropic" || p.kind === "codex_cli"));
  const signature = JSON.stringify(eligible.map(connectionIdentity));
  const current = useRef({ signature, eligible }); current.current = { signature, eligible };
  const refreshRef = useRef<(interactive?: string) => Promise<void>>(async () => {});
  const [state, setState] = useState<{ signature: string; rows: Record<string, QuotaReading> }>({ signature: "", rows: {} });
  useEffect(() => {
    if (!expanded || !current.current.eligible.length) return;
    let alive = true, pulling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async (interactive?: string) => {
      if (!alive || document.hidden || (pulling && !interactive)) return;
      pulling = true; clearTimeout(timer);
      const selected = current.current.eligible;
      setState(s => ({ signature, rows: Object.fromEntries(selected.map(p => [p.id, { value: s.signature === signature ? s.rows[p.id]?.value ?? null : null, loading: true, error: null }])) }));
      await Promise.all(selected.map(async p => {
        const key = `${connectionIdentity(p)}:${interactive === p.id}`;
        let request = pending.get(key);
        if (!request) {
          request = ipc.subscriptionQuota(p.id, interactive === p.id);
          pending.set(key, request);
          void request.finally(() => { if (pending.get(key) === request) pending.delete(key); }).catch(() => {});
        }
        let row: QuotaReading;
        try { row = { value: await request, loading: false, error: null }; }
        catch { row = { value: null, loading: false, error: "Subscription usage couldn't be read. Retrying shortly." }; }
        if (alive && current.current.signature === signature) setState(s => ({ signature, rows: { ...(s.signature === signature ? s.rows : {}), [p.id]: row } }));
      }));
      pulling = false;
      if (alive && !document.hidden) timer = setTimeout(() => void refresh(), 60_000);
    };
    refreshRef.current = refresh;
    void refresh();
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); refreshRef.current = async () => {}; };
  }, [signature, expanded]);
  return { readings: state.signature === signature ? state.rows : {}, allowKeychain: (providerId: string) => { void refreshRef.current(providerId); } };
}
