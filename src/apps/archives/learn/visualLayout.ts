// Pure SVG-geometry helpers for the two genuinely geometric lesson visuals:
// a circular "cycle" loop and a top-down "tree" DAG. Flow / timeline / compare /
// analogy render as plain HTML in the component (text wraps; no geometry needed).
// All functions are pure and unit-tested — components only emit SVG from these.

import type { TreeItem } from "./learnTypes";

// ── Cycle (circular loop) ──────────────────────────────────────────────────

export type CyclePoint = { x: number; y: number; angle: number };
export type CycleLayout = {
  size: number;
  r: number;
  cx: number;
  cy: number;
  pts: CyclePoint[];
  arcs: { d: string }[];
};

const round = (n: number) => +n.toFixed(1);

/** Lay `count` nodes evenly around a circle, with clockwise arc segments between them. */
export function cycleLayout(count: number): CycleLayout | null {
  if (count < 2) return null;
  const r = Math.min(96, Math.max(48, 36 + count * 7));
  const margin = 46; // room for labels outside the ring
  const cx = r + margin;
  const cy = r + margin;
  const size = (r + margin) * 2;
  const pts: CyclePoint[] = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    pts.push({ x: round(cx + r * Math.cos(angle)), y: round(cy + r * Math.sin(angle)), angle });
  }
  const arcs = pts.map((p, i) => {
    const q = pts[(i + 1) % count]!;
    return { d: `M${p.x},${p.y} A${r},${r} 0 0,1 ${q.x},${q.y}` };
  });
  return { size, r, cx, cy, pts, arcs };
}

// ── Tree (top-down hierarchy / DAG) ────────────────────────────────────────

export const TREE_NODE_W = 124;
export const TREE_NODE_H = 40;
const HGAP = 22;
const VGAP = 46;
const TPAD = 10;

export type TreeBox = { x: number; y: number; w: number; h: number; index: number };
export type TreeLayout = {
  width: number;
  height: number;
  nodes: TreeBox[];
  edges: { from: number; to: number; d: string }[];
};

/** Compute each node's depth by walking its parent chain (cycle-safe). */
function depthOf(nodes: TreeItem[], i: number): number {
  let depth = 0;
  let cur = nodes[i]?.parent ?? null;
  const seen = new Set<number>([i]);
  while (cur != null && cur >= 0 && cur < nodes.length && !seen.has(cur)) {
    seen.add(cur);
    depth++;
    cur = nodes[cur]!.parent ?? null;
  }
  return depth;
}

/** Lay a parent-indexed node list as centered horizontal rows, one per depth. */
export function treeLayout(nodes: TreeItem[]): TreeLayout | null {
  if (!nodes.length) return null;
  const depths = nodes.map((_, i) => depthOf(nodes, i));
  const maxDepth = Math.max(...depths);
  const byDepth: number[][] = [];
  for (let d = 0; d <= maxDepth; d++) byDepth[d] = [];
  nodes.forEach((_, i) => byDepth[depths[i]!]!.push(i));

  const maxRow = Math.max(...byDepth.map((row) => row.length));
  const width = TPAD * 2 + maxRow * (TREE_NODE_W + HGAP) - HGAP;
  const height = TPAD * 2 + (maxDepth + 1) * (TREE_NODE_H + VGAP) - VGAP;

  const boxes: (TreeBox | undefined)[] = new Array(nodes.length);
  for (let d = 0; d <= maxDepth; d++) {
    const row = byDepth[d]!;
    const rowW = row.length * (TREE_NODE_W + HGAP) - HGAP;
    const startX = TPAD + (width - TPAD * 2 - rowW) / 2;
    const y = TPAD + d * (TREE_NODE_H + VGAP);
    row.forEach((idx, j) => {
      boxes[idx] = { x: round(startX + j * (TREE_NODE_W + HGAP)), y: round(y), w: TREE_NODE_W, h: TREE_NODE_H, index: idx };
    });
  }
  const nodeBoxes = boxes.filter((b): b is TreeBox => !!b);

  const edges = nodes
    .map((n, i) => ({ parent: n.parent, child: i }))
    .filter((e) => e.parent != null && e.parent >= 0 && e.parent < nodes.length && boxes[e.parent] && boxes[e.child])
    .map((e) => {
      const a = boxes[e.parent!]!;
      const b = boxes[e.child]!;
      const x1 = a.x + a.w / 2;
      const y1 = a.y + a.h;
      const x2 = b.x + b.w / 2;
      const y2 = b.y;
      const my = (y1 + y2) / 2;
      return { from: e.parent!, to: e.child, d: `M${x1},${y1} C${x1},${round(my)} ${x2},${round(my)} ${x2},${y2}` };
    });

  return { width, height, nodes: nodeBoxes, edges };
}
