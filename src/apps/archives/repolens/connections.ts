// Connections — a pure, local semantic ego-graph. Center = the open repo;
// neighbors = other library repos that share capability tags / layers. No AI,
// no edge store: relatedness is computed from the taxonomy we already have.
// egoLayout (radial placement) is ported from graph.js.

import { layerOf } from "./taxonomy";

const CX = 200,
  CY = 150,
  RADIUS = 112;

export type EgoNode = { id: string; x: number; y: number; ring: number };

export function egoLayout(centerId: string, neighbors: { id: string }[]): EgoNode[] {
  const list = neighbors || [];
  const out: EgoNode[] = [{ id: centerId, x: CX, y: CY, ring: 0 }];
  const n = list.length || 1;
  list.forEach((nb, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push({
      id: nb.id,
      x: +(CX + RADIUS * Math.cos(angle)).toFixed(1),
      y: +(CY + RADIUS * Math.sin(angle)).toFixed(1),
      ring: 1,
    });
  });
  return out;
}

export type ConnNeighbor = { repoId: string; name: string; shared: string[]; weight: number };
type LibRow = { repo_id: string; analysis: { capabilities?: string[] } };

/** Rank library repos by capability overlap with the center (exact tags weigh
 * double; shared layers add). Returns the top-K, strongest first. */
export function buildConnections(
  center: { repoId: string; capabilities?: string[] },
  library: LibRow[],
  topK = 8,
): ConnNeighbor[] {
  const centerCaps = new Set(center.capabilities || []);
  const centerLayers = new Set((center.capabilities || []).map(layerOf));
  const out: ConnNeighbor[] = [];
  for (const r of library) {
    if (r.repo_id === center.repoId) continue;
    const caps = r.analysis.capabilities || [];
    const sharedCaps = caps.filter((c) => centerCaps.has(c));
    const sharedLayers = [...new Set(caps.map(layerOf).filter((l) => centerLayers.has(l)))];
    const weight = sharedCaps.length * 2 + sharedLayers.length;
    if (weight <= 0) continue;
    out.push({
      repoId: r.repo_id,
      name: r.repo_id.split("/").pop() || r.repo_id,
      shared: sharedLayers,
      weight,
    });
  }
  out.sort((a, b) => b.weight - a.weight || a.repoId.localeCompare(b.repoId));
  return out.slice(0, topK);
}
