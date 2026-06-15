// src/apps/archives/learn/figure.ts
export type Pt = { x: number; y: number };
export type Figure = { name: string; outline: Pt[]; anchors: Pt[] };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function asPoints(v: unknown): Pt[] {
  if (!Array.isArray(v)) return [];
  const out: Pt[] = [];
  for (const p of v) {
    const x = (p as any)?.x;
    const y = (p as any)?.y;
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      out.push({ x: clamp01(x), y: clamp01(y) });
    }
  }
  return out;
}

/** Strip ``` fences and slice the outermost {...}; returns null if no object found. */
function salvageJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

export function parseFigure(raw: string): Figure | null {
  const o = salvageJson(raw);
  if (!o) return null;
  const outline = asPoints(o.outline);
  const anchors = asPoints(o.anchors);
  if (outline.length === 0 || anchors.length === 0) return null;
  return { name: typeof o.name === "string" ? o.name : "", outline, anchors };
}

/** Map node ids (in given order) to anchors by index. Surplus nodes get no anchor. */
export function assignAnchors(nodeIds: string[], anchors: Pt[]): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  for (let i = 0; i < nodeIds.length && i < anchors.length; i++) {
    out[nodeIds[i]!] = anchors[i]!;
  }
  return out;
}
