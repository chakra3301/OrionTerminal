import { useRef, useState } from "react";
import type { Provider } from "@/features/agents/agentTypes";
import { useProvidersStore } from "@/store/providersStore";
import { confirmAction } from "@/components/ConfirmModal";
import { invalidateCodexImageStatus } from "@/apps/xdesign/imageProviderRuntime";

export function ProviderConnectionToggle({ provider }: { provider: Provider }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const toggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      if (provider.enabled && !await confirmAction({
        title: `Disconnect ${provider.name} from Orion?`,
        body: "Disables this provider in Orion model selection and automatic image-provider selection. Chats, settings and credentials are kept. Existing requests may finish. This does not sign out other apps or separate specialist CLI tools; use the account sign-out control to remove a shared CLI session.",
        confirmLabel: "Disconnect", danger: true,
      })) return;
      await useProvidersStore.getState().setEnabled(provider.id, !provider.enabled);
      invalidateCodexImageStatus();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div style={{ marginTop: 8 }}>
    <button type="button" className={provider.enabled ? "cp-link-danger" : "cp-btn"} disabled={busy} onClick={() => void toggle()}>
      {busy ? "Updating…" : provider.enabled ? "Disconnect from Orion" : "Enable provider"}
    </button>
    {error && <div role="alert" className="cp-form-error">{error}</div>}
  </div>;
}
