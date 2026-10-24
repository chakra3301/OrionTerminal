import type { InstalledCommunityPlugin } from "./communityTypes";

export function communityPluginVersion(record?: InstalledCommunityPlugin): string {
  return JSON.stringify([record?.fingerprint, record?.installedAt, record?.enabled, record?.quarantined]);
}

const inFlight = new Map<string, number>();
const changing = new Set<string>();

export function beginCommunityPluginChange(pluginId: string): () => void {
  const reason = communityPluginDisableReason(pluginId);
  if (reason || changing.has(pluginId)) throw new Error(reason || "Plugin change already in progress.");
  changing.add(pluginId);
  let ended = false;
  return () => { if (!ended) { ended = true; changing.delete(pluginId); } };
}

export function isCommunityPluginChanging(pluginId: string): boolean { return changing.has(pluginId); }

export function beginCommunityPluginCall(pluginId: string): () => void {
  if (changing.has(pluginId)) throw new Error("Plugin update in progress; retry after it finishes.");
  inFlight.set(pluginId, (inFlight.get(pluginId) ?? 0) + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const next = (inFlight.get(pluginId) ?? 1) - 1;
    if (next <= 0) inFlight.delete(pluginId);
    else inFlight.set(pluginId, next);
  };
}

export function communityPluginDisableReason(pluginId: string): string | null {
  const count = inFlight.get(pluginId) ?? 0;
  return count > 0
    ? `Wait for ${count} privileged plugin request${count === 1 ? "" : "s"} to finish before disabling it.`
    : null;
}

export function resetCommunityActivity(): void {
  inFlight.clear();
  changing.clear();
}
