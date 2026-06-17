// Deterministic emblem geometry for skills — a seeded star/rune outline and a
// hex-to-rgb helper, so each skill renders a distinct animated SVG emblem (echoing
// the Learn mastery badge figure) instead of an emoji.

export type Pt = { x: number; y: number };

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded star/rune outline in a normalized 0..1 box (centered on 0.5,0.5). */
export function skillSigil(seed: string): Pt[] {
  const rand = mulberry32(hashStr(seed || "x"));
  const spikes = 4 + Math.floor(rand() * 4); // 4..7 spikes
  const rot = rand() * Math.PI * 2;
  const outer = 0.42 + rand() * 0.06;
  const inner = 0.16 + rand() * 0.12;
  const total = spikes * 2;
  const pts: Pt[] = [];
  for (let i = 0; i < total; i++) {
    const a = rot + (i / total) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    pts.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r });
  }
  return pts;
}

/** "#rrggbb" → "r, g, b" triplet for rgba(var(--acc-rgb), a); violet fallback. */
export function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return "177, 76, 255";
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
