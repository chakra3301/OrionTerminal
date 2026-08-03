const activeReasons = new Map<string, string>();

export function setArchivesActivity(
  source: string,
  active: boolean,
  reason: string,
): void {
  if (active) activeReasons.set(source, reason);
  else activeReasons.delete(source);
}

export function archivesActivityReason(): string | null {
  return activeReasons.values().next().value ?? null;
}

export function clearArchivesActivities(): void {
  activeReasons.clear();
}

let activitySequence = 0;

export async function withArchivesActivity<T>(
  source: string,
  reason: string,
  task: () => Promise<T>,
): Promise<T> {
  const id = `${source}:${activitySequence++}`;
  activeReasons.set(id, reason);
  try {
    return await task();
  } finally {
    activeReasons.delete(id);
  }
}
