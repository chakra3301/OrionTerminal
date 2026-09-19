import { useEffect, useRef, useState } from "react";
import { getAppState, setAppState } from "@/lib/db";
import { serialQueue } from "@/lib/serialQueue";
import { toast } from "@/store/toastStore";
import { MonitorNotch } from "./notch/MonitorNotch";
import { monitorCells, providerCells } from "./notch/monitorCells";
import { useProviderUsage } from "@/store/providerUsageStore";
import { useProvidersStore } from "@/store/providersStore";
import { DEFAULT_AI_METRICS, DEFAULT_NOTCH, normalizeNotch, providerMetricId, type NotchPreferences } from "./notch/notchPreferences";
import { useMonitorReadings } from "./useMonitorReadings";
import { useNotchProviders } from "./notch/useNotchProviders";
import { useSubscriptionQuotas } from "./notch/useSubscriptionQuotas";
import { subscriptionQuotaCells } from "./notch/subscriptionQuotaCells";

const saveLayout = serialQueue();

export function MonitorWidget() {
  const [preferences, setPreferences] = useState<NotchPreferences | null>(null);
  const preferencesRef = useRef(DEFAULT_NOTCH);
  const canSave = useRef(false);
  const revision = useRef(0);
  const [active, setActive] = useState(false);
  const [now, setNow] = useState(Date.now);
  const providers = useProvidersStore(s => s.providers);
  const connectedProviders = useNotchProviders(providers, active);
  const claudeEnabled = connectedProviders.some(p => p.kind === "anthropic");
  const subscription = useSubscriptionQuotas(connectedProviders, active && preferences != null);
  const ledger = useProviderUsage();
  useEffect(() => { void ledger.load(); }, [ledger.load]);
  useEffect(() => {
    if (!active) return;
    const updateTime = () => { if (!document.hidden) setNow(Date.now()); };
    updateTime();
    const timer = setInterval(updateTime, 30_000);
    document.addEventListener("visibilitychange", updateTime);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", updateTime); };
  }, [active]);
  const readings = useMonitorReadings(preferences != null && active, claudeEnabled);

  useEffect(() => {
    let alive = true;
    void getAppState<unknown>("widget.monitor", true).then(value => {
      if (!alive) return;
      const next = normalizeNotch(value);
      preferencesRef.current = next;
      canSave.current = true;
      setPreferences(next);
    }).catch(() => {
      if (!alive) return;
      setPreferences(DEFAULT_NOTCH);
      toast.warning("Monitor layout couldn't be loaded", { body: "Using defaults temporarily. Your saved layout has not been overwritten; restart to retry.", dedupeKey: "monitor-layout" });
    });
    return () => { alive = false; };
  }, []);

  function update(change: Partial<NotchPreferences>) {
    const next = normalizeNotch({ ...preferencesRef.current, ...change });
    preferencesRef.current = next;
    setPreferences(next);
    if (!canSave.current) return;
    const current = ++revision.current;
    void saveLayout(() => setAppState("widget.monitor", next)).catch(() => {
      if (current !== revision.current) return;
      toast.warning("Notch customization wasn't saved", { body: "Your changes are visible but may not survive a restart. Change an option to retry.", dedupeKey: "monitor-layout" });
    });
  }

  const connectedIds = connectedProviders.filter(p => p.kind !== "anthropic").map(p => providerMetricId(p.id));
  const connectedKey = connectedIds.join("|");
  useEffect(() => {
    if (!preferences) return;
    const known = new Set(Array.isArray(preferences.knownProviders) ? preferences.knownProviders : [...DEFAULT_AI_METRICS, ...preferences.metrics.filter(id => id.startsWith("provider:"))]);
    const fresh = connectedIds.filter(id => !known.has(id));
    if (fresh.length) update({ knownProviders: [...known, ...fresh], metrics: [...preferences.metrics, ...fresh] });
  }, [connectedKey, preferences]);

  const cells = subscriptionQuotaCells([...monitorCells(readings, claudeEnabled), ...providerCells(connectedProviders, ledger.records, ledger.active, now, ledger.saveError, ledger.limitedUntil)], connectedProviders, subscription.readings, now, subscription.allowKeychain);
  return preferences && <MonitorNotch preferences={preferences} cells={cells} onChange={update} onActiveChange={setActive} />;
}
