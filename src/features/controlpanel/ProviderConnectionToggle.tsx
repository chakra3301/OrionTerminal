import { useRef, useState } from "react";
import type { Provider } from "@/features/agents/agentTypes";
import { useProvidersStore } from "@/store/providersStore";
import { invalidateCodexImageStatus } from "@/apps/xdesign/imageProviderRuntime";

/** On/off for a provider in Orion's model selection. Turning it off keeps chats, settings and
 *  credentials and never signs out of CLI accounts, so it is reversible and needs no confirm. */
export function ProviderConnectionToggle({ provider }: { provider: Provider }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const toggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      await useProvidersStore.getState().setEnabled(provider.id, !provider.enabled);
      invalidateCodexImageStatus();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <>
    <button type="button" className={`ot-switch${provider.enabled ? " on" : ""}`} role="switch" aria-checked={provider.enabled}
      aria-label={`${provider.name} in Orion`} disabled={busy} onClick={() => void toggle()} />
    {error && <div role="alert" className="cp-form-error cp-prov-error">{error}</div>}
  </>;
}
