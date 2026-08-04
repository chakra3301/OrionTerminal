type Activity = {
  count: number;
  reason: string;
};

const activities = new Map<string, Activity>();

export function beginOrionActivity(id: string, reason: string): () => void {
  const current = activities.get(id);
  activities.set(id, {
    count: (current?.count ?? 0) + 1,
    reason,
  });
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const active = activities.get(id);
    if (!active || active.count <= 1) activities.delete(id);
    else activities.set(id, { ...active, count: active.count - 1 });
  };
}

export async function trackOrionActivity<T>(
  id: string,
  reason: string,
  work: () => Promise<T>,
): Promise<T> {
  const end = beginOrionActivity(id, reason);
  try {
    return await work();
  } finally {
    end();
  }
}

export function setOrionActivity(
  id: string,
  active: boolean,
  reason: string,
): void {
  if (active) activities.set(id, { count: 1, reason });
  else activities.delete(id);
}

export function orionActivityReason(): string | null {
  return activities.values().next().value?.reason ?? null;
}

export function clearOrionActivities(): void {
  activities.clear();
}
