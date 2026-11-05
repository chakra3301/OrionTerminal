import { useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc";

type Reading<T> = { value: T | null; status: "loading" | "ready" | "error" };

function useReading<T>(enabled: boolean, intervalMs: number, read: () => Promise<T>) {
  const [reading, setReading] = useState<Reading<T>>({ value: null, status: "loading" });
  const pending = useRef<Promise<T> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let pulling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async () => {
      if (!alive || document.hidden || pulling) return;
      pulling = true;
      clearTimeout(timer);
      let request: Promise<T> | null = null;
      try {
        // Reopening during an existing read joins it instead of launching a
        // duplicate scan or waiting another full polling interval.
        request = pending.current ?? read();
        pending.current = request;
        const value = await request;
        if (alive) setReading({ value, status: "ready" });
      } catch {
        if (alive) setReading({ value: null, status: "error" });
      } finally {
        if (pending.current === request) pending.current = null;
        pulling = false;
        if (alive && !document.hidden) timer = setTimeout(() => void pull(), intervalMs);
      }
    };
    void pull();
    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else void pull();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, read]);

  return reading;
}

export function useMonitorReadings(enabled: boolean, claudeEnabled = true) {
  return {
    system: useReading(enabled, 2000, ipc.systemStats),
    usage: useReading(enabled && claudeEnabled, 30_000, ipc.claudeUsage),
    // Retained shape for legacy callers. Actual account quotas now use the
    // read-only subscription_quota connector, never a print-mode /usage turn.
    limits: useReading(false, 90_000, ipc.claudeLimits),
  };
}
