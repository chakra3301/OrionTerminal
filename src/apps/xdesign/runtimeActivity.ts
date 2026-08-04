type Activity = {
  count: number;
  reason: string;
};

const activities = new Map<string, Activity>();

export function beginXDesignActivity(id: string, reason: string): () => void {
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

export async function trackXDesignActivity<T>(
  id: string,
  reason: string,
  work: () => Promise<T>,
): Promise<T> {
  const end = beginXDesignActivity(id, reason);
  try {
    return await work();
  } finally {
    end();
  }
}

export function setXDesignActivity(
  id: string,
  active: boolean,
  reason: string,
): void {
  if (active) activities.set(id, { count: 1, reason });
  else activities.delete(id);
}

export function xdesignActivityReason(): string | null {
  return activities.values().next().value?.reason ?? null;
}

export function clearXDesignActivities(): void {
  activities.clear();
}
