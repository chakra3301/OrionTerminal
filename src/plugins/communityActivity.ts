const inFlight = new Map<string, number>();

export function beginCommunityPluginCall(pluginId: string): () => void {
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
}
