// Accent helper for control-panel emblems.

/** "#rrggbb" -> "r, g, b" triplet for rgba(var(--acc-rgb), a); violet fallback. */
export function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return "177, 76, 255";
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
