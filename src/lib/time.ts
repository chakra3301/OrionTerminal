/** Day-granular relative date: "today" / "yesterday" / "Nd ago" / "Mon D". */
export function formatRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** Minute-granular relative time: "just now" / "Nm" / "Nh" / "Nd" / "Mon D". */
export function relativeTime(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Clamp v into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
