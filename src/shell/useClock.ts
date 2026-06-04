import { useSyncExternalStore } from "react";

let now = new Date();
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

function ensureInterval() {
  if (interval !== null) return;
  interval = setInterval(() => {
    now = new Date();
    for (const l of listeners) l();
  }, 1000);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  ensureInterval();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };
}

function getSnapshot(): Date {
  return now;
}

export function useClock(): Date {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
