// Pure SVG-diagram layout for the structural lenses — the geometry only; React
// components emit the SVG. Ported from diagram.js (layered lineage DAG + circular
// feedback loop). Built for small graphs (≤ ~10 nodes).

import type { DeepDive } from "./types";

const NODE_W = 132,
  NODE_H = 38,
  COL_GAP = 64,
  ROW_GAP = 16,
  PAD = 14;

export const DG = { NODE_W, NODE_H };

export const truncate = (s: string, n: number): string =>
  (s = String(s)).length > n ? s.slice(0, n - 1) + "…" : s;

export type LineageLayout = {
  width: number;
  height: number;
  nodes: { id: string; name: string; x: number; y: number }[];
  edges: { from: string; to: string; x1: number; y1: number; x2: number; y2: number; mx: number }[];
};

export function lineageLayout(
  atoms: DeepDive["atoms"],
  links: DeepDive["lineage"]["links"],
): LineageLayout | null {
  if (!atoms?.length || !links?.length) return null;
  const ids = atoms.map((a) => a.id);
  const idset = new Set(ids);
  const nameById = Object.fromEntries(atoms.map((a) => [a.id, a.name]));
  const valid = links.filter((l) => idset.has(l.from) && idset.has(l.to));
  if (!valid.length) return null;

  // depth = longest path from a root; relaxation bounded by node count (cycle-safe)
  const depth: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let i = 0; i < ids.length; i++) {
    let changed = false;
    for (const l of valid)
      if (depth[l.to]! < depth[l.from]! + 1) {
        depth[l.to] = depth[l.from]! + 1;
        changed = true;
      }
    if (!changed) break;
  }

  const cols: Record<number, string[]> = {};
  ids.forEach((id) => {
    (cols[depth[id]!] ||= []).push(id);
  });
  const maxDepth = Math.max(...ids.map((id) => depth[id]!));
  const maxRows = Math.max(...Object.values(cols).map((c) => c.length));
  const totalH = PAD * 2 + maxRows * (NODE_H + ROW_GAP) - ROW_GAP;

  const pos: Record<string, { x: number; y: number }> = {};
  for (let d = 0; d <= maxDepth; d++) {
    const col = cols[d] || [];
    const colH = col.length * (NODE_H + ROW_GAP) - ROW_GAP;
    const top = PAD + (totalH - PAD * 2 - colH) / 2;
    col.forEach((id, i) => {
      pos[id] = { x: PAD + d * (NODE_W + COL_GAP), y: top + i * (NODE_H + ROW_GAP) };
    });
  }
  const width = PAD * 2 + (maxDepth + 1) * (NODE_W + COL_GAP) - COL_GAP;

  const edges = valid.map((l) => {
    const a = pos[l.from]!,
      b = pos[l.to]!;
    const x1 = a.x + NODE_W,
      y1 = a.y + NODE_H / 2,
      x2 = b.x,
      y2 = b.y + NODE_H / 2;
    return { from: l.from, to: l.to, x1, y1, x2, y2, mx: (x1 + x2) / 2 };
  });
  const nodes = ids.map((id) => ({ id, name: nameById[id] ?? id, x: pos[id]!.x, y: pos[id]!.y }));

  return { width, height: Math.max(totalH, NODE_H + PAD * 2), nodes, edges };
}

export type LoopLayout = {
  r: number;
  pts: { x: number; y: number; label: string }[];
  /** Arc segments tracing the circle from each node to the next (clockwise). */
  arcs: { d: string }[];
};

export function loopLayout(cycle: string[]): LoopLayout | null {
  const nodes = (cycle || []).filter(Boolean);
  if (nodes.length < 2) return null;
  const R = 78,
    cx = 130,
    cy = 110;
  const pts = nodes.map((label, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length;
    return { x: +(cx + R * Math.cos(ang)).toFixed(1), y: +(cy + R * Math.sin(ang)).toFixed(1), label };
  });
  const arcs = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    // short clockwise arc along the circle (large-arc=0, sweep=1)
    return { d: `M${p.x},${p.y} A${R},${R} 0 0,1 ${q.x},${q.y}` };
  });
  return { r: R, pts, arcs };
}
