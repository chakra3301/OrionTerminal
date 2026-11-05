import { useEffect, useRef, useState, useSyncExternalStore } from "react";

let preference: MediaQueryList | undefined;
const reducedMotion = () => {
  preference ??= typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : undefined;
  return preference?.matches ?? false;
};
const motionAllowed = () => !reducedMotion() && typeof document !== "undefined" && !document.hidden;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
function subscribe(listener: () => void) {
  reducedMotion();
  if (!listeners.size) {
    preference?.addEventListener("change", notify);
    document.addEventListener("visibilitychange", notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      preference?.removeEventListener("change", notify);
      document.removeEventListener("visibilitychange", notify);
    }
  };
}

export function useVisualActivity<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  const motion = useSyncExternalStore(subscribe, motionAllowed, () => false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, visible, active: enabled && motion && visible };
}
